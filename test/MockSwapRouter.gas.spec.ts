import { abi as IMauvePoolABI } from '@violetprotocol/mauve-core/artifacts/contracts/interfaces/IMauvePool.sol/IMauvePool.json'
import { Fixture } from 'ethereum-waffle'
import { BigNumber, constants, ContractTransaction, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import {
  IMauvePool,
  IWETH9,
  MockTimeSwapRouter,
  TestERC20,
  AccessTokenVerifier,
  IMauveFactoryReduced,
} from '../typechain'
import completeFixture, { Domain } from './shared/completeFixture'
import { FeeAmount, TICK_SPACINGS } from './shared/constants'
import { CreatePoolIfNecessary } from './shared/createPoolIfNecessary'
import { encodePriceSqrt } from './shared/encodePriceSqrt'
import { expandTo18Decimals } from './shared/expandTo18Decimals'
import { expect } from './shared/expect'
import { encodePath } from './shared/path'
import snapshotGasCost from './shared/snapshotGasCost'
import { getMaxTick, getMinTick } from './shared/ticks'
import { generateAccessTokenForMulticall } from './shared/generateAccessToken'
import { swapRouterBytes32 } from './shared/roles'

describe('MockSwapRouter gas tests', function () {
  this.timeout(40000)
  let wallet: Wallet
  let trader: Wallet

  const swapRouterFixture: Fixture<{
    weth9: IWETH9
    router: MockTimeSwapRouter
    tokens: [TestERC20, TestERC20, TestERC20]
    pools: [IMauvePool, IMauvePool, IMauvePool]
    signer: Wallet
    domain: Domain
    verifier: AccessTokenVerifier
    factory: IMauveFactoryReduced
  }> = async (wallets, provider) => {
    const {
      weth9,
      factory,
      router,
      tokens,
      nft,
      createAndInitializePoolIfNecessary,
      signer,
      domain,
      verifier,
    } = await completeFixture(wallets, provider)

    // approve & fund wallets
    for (const token of tokens) {
      await token.approve(router.address, constants.MaxUint256)
      await token.approve(nft.address, constants.MaxUint256)
      await token.connect(trader).approve(router.address, constants.MaxUint256)
      await token.transfer(trader.address, expandTo18Decimals(1_000_000))
    }

    const liquidity = 1000000
    async function createPool(tokenAddressA: string, tokenAddressB: string) {
      if (tokenAddressA.toLowerCase() > tokenAddressB.toLowerCase())
        [tokenAddressA, tokenAddressB] = [tokenAddressB, tokenAddressA]

      await createAndInitializePoolIfNecessary(
        tokenAddressA,
        tokenAddressB,
        FeeAmount.MEDIUM,
        encodePriceSqrt(100005, 100000) // we don't want to cross any ticks
      )

      const mintParams = {
        token0: tokenAddressA,
        token1: tokenAddressB,
        fee: FeeAmount.MEDIUM,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        recipient: wallet.address,
        amount0Desired: 1000000,
        amount1Desired: 1000000,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      }
      const mintMulticallParameters = [nft.interface.encodeFunctionData('mint', [mintParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(
        signer,
        domain,
        wallet,
        nft,
        mintMulticallParameters
      )

      await nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](
        eat.v,
        eat.r,
        eat.s,
        expiry,
        mintMulticallParameters
      )
    }

    async function createPoolWETH9(tokenAddress: string) {
      await weth9.deposit({ value: liquidity * 2 })
      await weth9.approve(nft.address, constants.MaxUint256)
      return createPool(weth9.address, tokenAddress)
    }

    // create pools
    await createPool(tokens[0].address, tokens[1].address)
    await createPool(tokens[1].address, tokens[2].address)
    await createPoolWETH9(tokens[0].address)

    const poolAddresses = await Promise.all([
      factory.getPool(tokens[0].address, tokens[1].address, FeeAmount.MEDIUM),
      factory.getPool(tokens[1].address, tokens[2].address, FeeAmount.MEDIUM),
      factory.getPool(weth9.address, tokens[0].address, FeeAmount.MEDIUM),
    ])

    const pools = poolAddresses.map((poolAddress) => new ethers.Contract(poolAddress, IMauvePoolABI, wallet)) as [
      IMauvePool,
      IMauvePool,
      IMauvePool
    ]

    return {
      weth9,
      router,
      tokens,
      pools,
      signer,
      domain,
      verifier,
      factory,
    }
  }

  let weth9: IWETH9
  let router: MockTimeSwapRouter
  let tokens: [TestERC20, TestERC20, TestERC20]
  let pools: [IMauvePool, IMauvePool, IMauvePool]
  let signer: Wallet
  let domain: Domain
  let verifier: AccessTokenVerifier
  let factory: IMauveFactoryReduced

  let loadFixture: ReturnType<typeof waffle.createFixtureLoader>

  before('create fixture loader', async () => {
    const wallets = await (ethers as any).getSigners()
    ;[wallet, trader] = wallets

    loadFixture = waffle.createFixtureLoader(wallets)
  })

  beforeEach('load fixture', async () => {
    ;({ router, weth9, tokens, pools, signer, domain, verifier, factory } = await loadFixture(swapRouterFixture))
  })

  async function exactInput(
    tokens: string[],
    amountIn: number = 2,
    amountOutMinimum: number = 1
  ): Promise<ContractTransaction> {
    const inputIsWETH = weth9.address === tokens[0]
    const outputIsWETH9 = tokens[tokens.length - 1] === weth9.address

    const value = inputIsWETH ? amountIn : 0

    const params = {
      path: encodePath(tokens, new Array(tokens.length - 1).fill(FeeAmount.MEDIUM)),
      recipient: outputIsWETH9 ? constants.AddressZero : trader.address,
      deadline: 1,
      amountIn,
      amountOutMinimum: outputIsWETH9 ? 0 : amountOutMinimum, // save on calldata,
    }

    const data = [router.interface.encodeFunctionData('exactInput', [params])]
    if (outputIsWETH9) data.push(router.interface.encodeFunctionData('unwrapWETH9', [amountOutMinimum, trader.address]))

    const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, trader, router, data)

    // optimized for the gas test
    return router
      .connect(trader)
      ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, data, { value })
  }

  async function exactInputSingle(
    tokenIn: string,
    tokenOut: string,
    amountIn: number = 3,
    amountOutMinimum: number = 1,
    sqrtPriceLimitX96?: BigNumber
  ): Promise<ContractTransaction> {
    const inputIsWETH = weth9.address === tokenIn
    const outputIsWETH9 = tokenOut === weth9.address

    const value = inputIsWETH ? amountIn : 0

    const params = {
      tokenIn,
      tokenOut,
      fee: FeeAmount.MEDIUM,
      sqrtPriceLimitX96: sqrtPriceLimitX96 ?? 0,
      recipient: outputIsWETH9 ? constants.AddressZero : trader.address,
      deadline: 1,
      amountIn,
      amountOutMinimum: outputIsWETH9 ? 0 : amountOutMinimum, // save on calldata
    }

    const data = [router.interface.encodeFunctionData('exactInputSingle', [params])]
    if (outputIsWETH9) data.push(router.interface.encodeFunctionData('unwrapWETH9', [amountOutMinimum, trader.address]))

    const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, trader, router, data)
    // optimized for the gas test
    return router
      .connect(trader)
      ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, data, { value })
  }

  async function exactOutput(tokens: string[]): Promise<ContractTransaction> {
    const amountInMaximum = 10 // we don't care
    const amountOut = 1

    const inputIsWETH9 = tokens[0] === weth9.address
    const outputIsWETH9 = tokens[tokens.length - 1] === weth9.address

    const value = inputIsWETH9 ? amountInMaximum : 0

    const params = {
      path: encodePath(tokens.slice().reverse(), new Array(tokens.length - 1).fill(FeeAmount.MEDIUM)),
      recipient: outputIsWETH9 ? constants.AddressZero : trader.address,
      deadline: 1,
      amountOut,
      amountInMaximum,
    }

    const data = [router.interface.encodeFunctionData('exactOutput', [params])]
    if (inputIsWETH9) data.push(router.interface.encodeFunctionData('refundETH'))
    if (outputIsWETH9) data.push(router.interface.encodeFunctionData('unwrapWETH9', [amountOut, trader.address]))

    const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, trader, router, data)

    return router
      .connect(trader)
      ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, data, { value })
  }

  async function exactOutputSingle(
    tokenIn: string,
    tokenOut: string,
    amountOut: number = 1,
    amountInMaximum: number = 3,
    sqrtPriceLimitX96?: BigNumber
  ): Promise<ContractTransaction> {
    const inputIsWETH9 = tokenIn === weth9.address
    const outputIsWETH9 = tokenOut === weth9.address

    const value = inputIsWETH9 ? amountInMaximum : 0

    const params = {
      tokenIn,
      tokenOut,
      fee: FeeAmount.MEDIUM,
      recipient: outputIsWETH9 ? constants.AddressZero : trader.address,
      deadline: 1,
      amountOut,
      amountInMaximum,
      sqrtPriceLimitX96: sqrtPriceLimitX96 ?? 0,
    }

    const data = [router.interface.encodeFunctionData('exactOutputSingle', [params])]
    if (inputIsWETH9) data.push(router.interface.encodeFunctionData('unwrapWETH9', [0, trader.address]))
    if (outputIsWETH9) data.push(router.interface.encodeFunctionData('unwrapWETH9', [amountOut, trader.address]))

    const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, trader, router, data)
    return router
      .connect(trader)
      ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, data, { value })
  }

  // TODO should really throw this in the fixture
  beforeEach('intialize feeGrowthGlobals', async () => {
    await exactInput([tokens[0].address, tokens[1].address], 1, 0)
    await exactInput([tokens[1].address, tokens[0].address], 1, 0)
    await exactInput([tokens[1].address, tokens[2].address], 1, 0)
    await exactInput([tokens[2].address, tokens[1].address], 1, 0)
    await exactInput([tokens[0].address, weth9.address], 1, 0)
    await exactInput([weth9.address, tokens[0].address], 1, 0)
  })

  beforeEach('ensure feeGrowthGlobals are >0', async () => {
    const slots = await Promise.all(
      pools.map((pool) =>
        Promise.all([
          pool.feeGrowthGlobal0X128().then((f) => f.toString()),
          pool.feeGrowthGlobal1X128().then((f) => f.toString()),
        ])
      )
    )

    expect(slots).to.deep.eq([
      ['340290874192793283295456993856614', '340290874192793283295456993856614'],
      ['340290874192793283295456993856614', '340290874192793283295456993856614'],
      ['340290874192793283295456993856614', '340290874192793283295456993856614'],
    ])
  })

  beforeEach('ensure ticks are 0 before', async () => {
    const slots = await Promise.all(pools.map((pool) => pool.slot0().then(({ tick }) => tick)))
    expect(slots).to.deep.eq([0, 0, 0])
  })

  afterEach('ensure ticks are 0 after', async () => {
    const slots = await Promise.all(pools.map((pool) => pool.slot0().then(({ tick }) => tick)))
    expect(slots).to.deep.eq([0, 0, 0])
  })

  describe('#exactInput', () => {
    it('0 -> 1', async () => {
      await snapshotGasCost(exactInput(tokens.slice(0, 2).map((token) => token.address)))
    })

    it('0 -> 1 minimal', async () => {
      const calleeFactory = await ethers.getContractFactory('TestMauveCallee')
      const callee = await calleeFactory.deploy()

      await tokens[0].connect(trader).approve(callee.address, constants.MaxUint256)
      await factory.setRole(callee.address, swapRouterBytes32)
      await snapshotGasCost(callee.connect(trader).swapExact0For1(pools[0].address, 2, trader.address, '4295128740'))
      await factory.setRole(router.address, swapRouterBytes32)
    })

    it('0 -> 1 -> 2', async () => {
      await snapshotGasCost(
        exactInput(
          tokens.map((token) => token.address),
          3
        )
      )
    })

    it('WETH9 -> 0', async () => {
      await snapshotGasCost(
        exactInput(
          [weth9.address, tokens[0].address],
          weth9.address.toLowerCase() < tokens[0].address.toLowerCase() ? 2 : 3
        )
      )
    })

    it('0 -> WETH9', async () => {
      await snapshotGasCost(
        exactInput(
          [tokens[0].address, weth9.address],
          tokens[0].address.toLowerCase() < weth9.address.toLowerCase() ? 2 : 3
        )
      )
    })

    it('2 trades (via router)', async () => {
      await weth9.connect(trader).deposit({ value: 3 })
      await weth9.connect(trader).approve(router.address, constants.MaxUint256)
      const swap0 = {
        path: encodePath([weth9.address, tokens[0].address], [FeeAmount.MEDIUM]),
        recipient: constants.AddressZero,
        deadline: 1,
        amountIn: 3,
        amountOutMinimum: 0, // save on calldata
      }

      const swap1 = {
        path: encodePath([tokens[1].address, tokens[0].address], [FeeAmount.MEDIUM]),
        recipient: constants.AddressZero,
        deadline: 1,
        amountIn: 3,
        amountOutMinimum: 0, // save on calldata
      }

      const data = [
        router.interface.encodeFunctionData('exactInput', [swap0]),
        router.interface.encodeFunctionData('exactInput', [swap1]),
        router.interface.encodeFunctionData('sweepToken', [tokens[0].address, 2, trader.address]),
      ]

      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, trader, router, data)
      await snapshotGasCost(
        router.connect(trader)['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, data)
      )
    })

    it('3 trades (directly to sender)', async () => {
      await weth9.connect(trader).deposit({ value: 3 })
      await weth9.connect(trader).approve(router.address, constants.MaxUint256)
      const swap0 = {
        path: encodePath([weth9.address, tokens[0].address], [FeeAmount.MEDIUM]),
        recipient: trader.address,
        deadline: 1,
        amountIn: 3,
        amountOutMinimum: 1,
      }

      const swap1 = {
        path: encodePath([tokens[0].address, tokens[1].address], [FeeAmount.MEDIUM]),
        recipient: trader.address,
        deadline: 1,
        amountIn: 3,
        amountOutMinimum: 1,
      }

      const swap2 = {
        path: encodePath([tokens[1].address, tokens[2].address], [FeeAmount.MEDIUM]),
        recipient: trader.address,
        deadline: 1,
        amountIn: 3,
        amountOutMinimum: 1,
      }

      const data = [
        router.interface.encodeFunctionData('exactInput', [swap0]),
        router.interface.encodeFunctionData('exactInput', [swap1]),
        router.interface.encodeFunctionData('exactInput', [swap2]),
      ]

      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, trader, router, data)
      await snapshotGasCost(
        router.connect(trader)['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, data)
      )
    })
  })

  it('3 trades (directly to sender)', async () => {
    await weth9.connect(trader).deposit({ value: 3 })
    await weth9.connect(trader).approve(router.address, constants.MaxUint256)
    const swap0 = {
      path: encodePath([weth9.address, tokens[0].address], [FeeAmount.MEDIUM]),
      recipient: trader.address,
      deadline: 1,
      amountIn: 3,
      amountOutMinimum: 1,
    }

    const swap1 = {
      path: encodePath([tokens[1].address, tokens[0].address], [FeeAmount.MEDIUM]),
      recipient: trader.address,
      deadline: 1,
      amountIn: 3,
      amountOutMinimum: 1,
    }

    const data = [
      router.interface.encodeFunctionData('exactInput', [swap0]),
      router.interface.encodeFunctionData('exactInput', [swap1]),
    ]

    const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, trader, router, data)
    await snapshotGasCost(
      router.connect(trader)['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, data)
    )
  })

  describe('#exactInputSingle', () => {
    it('0 -> 1', async () => {
      await snapshotGasCost(exactInputSingle(tokens[0].address, tokens[1].address))
    })

    it('WETH9 -> 0', async () => {
      await snapshotGasCost(
        exactInputSingle(
          weth9.address,
          tokens[0].address,
          weth9.address.toLowerCase() < tokens[0].address.toLowerCase() ? 2 : 3
        )
      )
    })

    it('0 -> WETH9', async () => {
      await snapshotGasCost(
        exactInputSingle(
          tokens[0].address,
          weth9.address,
          tokens[0].address.toLowerCase() < weth9.address.toLowerCase() ? 2 : 3
        )
      )
    })
  })

  describe('#exactOutput', () => {
    it('0 -> 1', async () => {
      await snapshotGasCost(exactOutput(tokens.slice(0, 2).map((token) => token.address)))
    })

    it('0 -> 1 -> 2', async () => {
      await snapshotGasCost(exactOutput(tokens.map((token) => token.address)))
    })

    it('WETH9 -> 0', async () => {
      await snapshotGasCost(exactOutput([weth9.address, tokens[0].address]))
    })

    it('0 -> WETH9', async () => {
      await snapshotGasCost(exactOutput([tokens[0].address, weth9.address]))
    })
  })

  describe('#exactOutputSingle', () => {
    it('0 -> 1', async () => {
      await snapshotGasCost(exactOutputSingle(tokens[0].address, tokens[1].address))
    })

    it('WETH9 -> 0', async () => {
      await snapshotGasCost(exactOutputSingle(weth9.address, tokens[0].address))
    })

    it('0 -> WETH9', async () => {
      await snapshotGasCost(exactOutputSingle(tokens[0].address, weth9.address))
    })
  })
})
