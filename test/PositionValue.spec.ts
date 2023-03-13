import { waffle, ethers } from 'hardhat'
import { constants, BigNumberish, Contract, Wallet } from 'ethers'
import { Fixture } from 'ethereum-waffle'
import {
  PositionValueTest,
  SwapRouter,
  MockTimeNonfungiblePositionManager,
  IUniswapV3Pool,
  TestERC20,
  IUniswapV3Factory,
  AccessTokenVerifier,
} from '../typechain'
import { FeeAmount, MaxUint128, TICK_SPACINGS } from './shared/constants'
import { getMaxTick, getMinTick } from './shared/ticks'
import { encodePriceSqrt } from './shared/encodePriceSqrt'
import { expandTo18Decimals } from './shared/expandTo18Decimals'
import { encodePath } from './shared/path'
import { computePoolAddress } from './shared/computePoolAddress'
import completeFixture, { Domain } from './shared/completeFixture'
import snapshotGasCost from './shared/snapshotGasCost'

import { expect } from './shared/expect'

import { abi as IUniswapV3PoolABI } from '@violetprotocol/mauve-v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json'
import { CreatePoolIfNecessary } from './shared/createPoolIfNecessary'
import { generateAccessToken } from './shared/generateAccessToken'

describe('PositionValue', async () => {
  const [...wallets] = waffle.provider.getWallets()
  const positionValueCompleteFixture: Fixture<{
    positionValue: PositionValueTest
    tokens: [TestERC20, TestERC20, TestERC20]
    nft: MockTimeNonfungiblePositionManager
    router: SwapRouter
    factory: IUniswapV3Factory
    createAndInitializePoolIfNecessary: CreatePoolIfNecessary
    signer: Wallet
    domain: Domain
    verifier: AccessTokenVerifier
  }> = async (wallets, provider) => {
    const {
      nft,
      router,
      tokens,
      factory,
      createAndInitializePoolIfNecessary,
      signer,
      domain,
      verifier,
    } = await completeFixture(wallets, provider)
    const positionValueFactory = await ethers.getContractFactory('PositionValueTest')
    const positionValue = (await positionValueFactory.deploy()) as PositionValueTest

    for (const token of tokens) {
      await token.approve(nft.address, constants.MaxUint256)
      await token.connect(wallets[0]).approve(nft.address, constants.MaxUint256)
      await token.transfer(wallets[0].address, expandTo18Decimals(1_000_000))
    }

    return {
      positionValue,
      tokens,
      nft,
      router,
      factory,
      createAndInitializePoolIfNecessary,
      signer,
      domain,
      verifier,
    }
  }

  let pool: Contract
  let tokens: [TestERC20, TestERC20, TestERC20]
  let positionValue: PositionValueTest
  let nft: MockTimeNonfungiblePositionManager
  let router: SwapRouter
  let factory: IUniswapV3Factory
  let createAndInitializePoolIfNecessary: CreatePoolIfNecessary
  let signer: Wallet
  let domain: Domain
  let verifier: AccessTokenVerifier
  let amountDesired: BigNumberish

  let loadFixture: ReturnType<typeof waffle.createFixtureLoader>
  before('create fixture loader', async () => {
    loadFixture = waffle.createFixtureLoader(wallets)
  })

  beforeEach(async () => {
    ;({
      positionValue,
      tokens,
      nft,
      router,
      factory,
      createAndInitializePoolIfNecessary,
      signer,
      domain,
      verifier,
    } = await loadFixture(positionValueCompleteFixture))
    await createAndInitializePoolIfNecessary(
      tokens[0].address,
      tokens[1].address,
      FeeAmount.MEDIUM,
      encodePriceSqrt(1, 1)
    )

    const poolAddress = computePoolAddress(factory.address, [tokens[0].address, tokens[1].address], FeeAmount.MEDIUM)
    pool = new ethers.Contract(poolAddress, IUniswapV3PoolABI, wallets[0])
  })

  describe('#total', () => {
    let tokenId: number
    let sqrtRatioX96: BigNumberish

    beforeEach(async () => {
      amountDesired = expandTo18Decimals(100_000)

      await nft.mint({
        token0: tokens[0].address,
        token1: tokens[1].address,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        fee: FeeAmount.MEDIUM,
        recipient: wallets[0].address,
        amount0Desired: amountDesired,
        amount1Desired: amountDesired,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 10,
      })

      const swapAmount = expandTo18Decimals(1_000)
      await tokens[0].approve(router.address, swapAmount)
      await tokens[1].approve(router.address, swapAmount)

      // accmuluate token0 fees
      await router.exactInput({
        recipient: wallets[0].address,
        deadline: 1,
        path: encodePath([tokens[0].address, tokens[1].address], [FeeAmount.MEDIUM]),
        amountIn: swapAmount,
        amountOutMinimum: 0,
      })

      // accmuluate token1 fees
      await router.exactInput({
        recipient: wallets[0].address,
        deadline: 1,
        path: encodePath([tokens[1].address, tokens[0].address], [FeeAmount.MEDIUM]),
        amountIn: swapAmount,
        amountOutMinimum: 0,
      })

      sqrtRatioX96 = (await pool.slot0()).sqrtPriceX96
    })

    it('returns the correct amount', async () => {
      const principal = await positionValue.principal(nft.address, 1, sqrtRatioX96)
      const fees = await positionValue.fees(nft.address, 1)
      const total = await positionValue.total(nft.address, 1, sqrtRatioX96)

      expect(total[0]).to.equal(principal[0].add(fees[0]))
      expect(total[1]).to.equal(principal[1].add(fees[1]))
    })

    it('gas', async () => {
      await snapshotGasCost(positionValue.totalGas(nft.address, 1, sqrtRatioX96))
    })
  })

  describe('#principal', () => {
    let sqrtRatioX96: BigNumberish

    beforeEach(async () => {
      amountDesired = expandTo18Decimals(100_000)
      sqrtRatioX96 = (await pool.slot0()).sqrtPriceX96
    })

    it('returns the correct values when price is in the middle of the range', async () => {
      await nft.mint({
        token0: tokens[0].address,
        token1: tokens[1].address,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        fee: FeeAmount.MEDIUM,
        recipient: wallets[0].address,
        amount0Desired: amountDesired,
        amount1Desired: amountDesired,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 10,
      })

      const principal = await positionValue.principal(nft.address, 1, sqrtRatioX96)
      expect(principal.amount0).to.equal('99999999999999999999999')
      expect(principal.amount1).to.equal('99999999999999999999999')
    })

    it('returns the correct values when range is below current price', async () => {
      await nft.mint({
        token0: tokens[0].address,
        token1: tokens[1].address,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: -60,
        fee: FeeAmount.MEDIUM,
        recipient: wallets[0].address,
        amount0Desired: amountDesired,
        amount1Desired: amountDesired,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 10,
      })

      const principal = await positionValue.principal(nft.address, 1, sqrtRatioX96)
      expect(principal.amount0).to.equal('0')
      expect(principal.amount1).to.equal('99999999999999999999999')
    })

    it('returns the correct values when range is below current price', async () => {
      await nft.mint({
        token0: tokens[0].address,
        token1: tokens[1].address,
        tickLower: 60,
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        fee: FeeAmount.MEDIUM,
        recipient: wallets[0].address,
        amount0Desired: amountDesired,
        amount1Desired: amountDesired,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 10,
      })

      const principal = await positionValue.principal(nft.address, 1, sqrtRatioX96)
      expect(principal.amount0).to.equal('99999999999999999999999')
      expect(principal.amount1).to.equal('0')
    })

    it('returns the correct values when range is skewed above price', async () => {
      await nft.mint({
        token0: tokens[0].address,
        token1: tokens[1].address,
        tickLower: -6_000,
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        fee: FeeAmount.MEDIUM,
        recipient: wallets[0].address,
        amount0Desired: amountDesired,
        amount1Desired: amountDesired,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 10,
      })

      const principal = await positionValue.principal(nft.address, 1, sqrtRatioX96)
      expect(principal.amount0).to.equal('99999999999999999999999')
      expect(principal.amount1).to.equal('25917066770240321655335')
    })

    it('returns the correct values when range is skewed below price', async () => {
      await nft.mint({
        token0: tokens[0].address,
        token1: tokens[1].address,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: 6_000,
        fee: FeeAmount.MEDIUM,
        recipient: wallets[0].address,
        amount0Desired: amountDesired,
        amount1Desired: amountDesired,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 10,
      })

      const principal = await positionValue.principal(nft.address, 1, sqrtRatioX96)
      expect(principal.amount0).to.equal('25917066770240321655335')
      expect(principal.amount1).to.equal('99999999999999999999999')
    })

    it('gas', async () => {
      await nft.mint({
        token0: tokens[0].address,
        token1: tokens[1].address,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        fee: FeeAmount.MEDIUM,
        recipient: wallets[0].address,
        amount0Desired: amountDesired,
        amount1Desired: amountDesired,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 10,
      })

      await snapshotGasCost(positionValue.principalGas(nft.address, 1, sqrtRatioX96))
    })
  })

  describe('#fees', () => {
    let tokenId: number

    beforeEach(async () => {
      amountDesired = expandTo18Decimals(100_000)
      tokenId = 2

      await nft.mint({
        token0: tokens[0].address,
        token1: tokens[1].address,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        fee: FeeAmount.MEDIUM,
        recipient: wallets[0].address,
        amount0Desired: amountDesired,
        amount1Desired: amountDesired,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 10,
      })
    })

    describe('when price is within the position range', () => {
      beforeEach(async () => {
        await nft.mint({
          token0: tokens[0].address,
          token1: tokens[1].address,
          tickLower: TICK_SPACINGS[FeeAmount.MEDIUM] * -1_000,
          tickUpper: TICK_SPACINGS[FeeAmount.MEDIUM] * 1_000,
          fee: FeeAmount.MEDIUM,
          recipient: wallets[0].address,
          amount0Desired: amountDesired,
          amount1Desired: amountDesired,
          amount0Min: 0,
          amount1Min: 0,
          deadline: 10,
        })

        const swapAmount = expandTo18Decimals(1_000)
        await tokens[0].approve(router.address, swapAmount)
        await tokens[1].approve(router.address, swapAmount)

        // accmuluate token0 fees
        await router.exactInput({
          recipient: wallets[0].address,
          deadline: 1,
          path: encodePath([tokens[0].address, tokens[1].address], [FeeAmount.MEDIUM]),
          amountIn: swapAmount,
          amountOutMinimum: 0,
        })

        // accmuluate token1 fees
        await router.exactInput({
          recipient: wallets[0].address,
          deadline: 1,
          path: encodePath([tokens[1].address, tokens[0].address], [FeeAmount.MEDIUM]),
          amountIn: swapAmount,
          amountOutMinimum: 0,
        })
      })

      it('return the correct amount of fees', async () => {
        const collectParameters = {
          tokenId: tokenId,
          recipient: wallets[0].address,
          amount0Max: MaxUint128,
          amount1Max: MaxUint128,
        }
        const parameters = [nft.interface.encodeFunctionData('collect', [collectParameters])]
        const { eat, expiry } = await generateAccessToken(signer, domain, wallets[0], nft, parameters)

        const [response] = await nft.callStatic['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](
          eat.v,
          eat.r,
          eat.s,
          expiry,
          parameters
        )
        const { amount0, amount1 } = nft.interface.decodeFunctionResult('collect', response)
        const feeAmounts = await positionValue.fees(nft.address, tokenId)

        expect(feeAmounts[0]).to.equal(amount0)
        expect(feeAmounts[1]).to.equal(amount1)
      })

      it('returns the correct amount of fees if tokensOwed fields are greater than 0', async () => {
        await nft.increaseLiquidity({
          tokenId: tokenId,
          amount0Desired: 100,
          amount1Desired: 100,
          amount0Min: 0,
          amount1Min: 0,
          deadline: 1,
        })

        const swapAmount = expandTo18Decimals(1_000)
        await tokens[0].approve(router.address, swapAmount)

        // accmuluate more token0 fees after clearing initial amount
        await router.exactInput({
          recipient: wallets[0].address,
          deadline: 1,
          path: encodePath([tokens[0].address, tokens[1].address], [FeeAmount.MEDIUM]),
          amountIn: swapAmount,
          amountOutMinimum: 0,
        })

        const collectParameters = {
          tokenId: tokenId,
          recipient: wallets[0].address,
          amount0Max: MaxUint128,
          amount1Max: MaxUint128,
        }
        const parameters = [nft.interface.encodeFunctionData('collect', [collectParameters])]
        const { eat, expiry } = await generateAccessToken(signer, domain, wallets[0], nft, parameters)

        const [response] = await nft.callStatic['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](
          eat.v,
          eat.r,
          eat.s,
          expiry,
          parameters
        )
        const { amount0, amount1 } = nft.interface.decodeFunctionResult('collect', response)
        const feeAmounts = await positionValue.fees(nft.address, tokenId)

        expect(feeAmounts[0]).to.equal(amount0)
        expect(feeAmounts[1]).to.equal(amount1)
      })

      it('gas', async () => {
        await snapshotGasCost(positionValue.feesGas(nft.address, tokenId))
      })
    })

    describe('when price is below the position range', async () => {
      beforeEach(async () => {
        await nft.mint({
          token0: tokens[0].address,
          token1: tokens[1].address,
          tickLower: TICK_SPACINGS[FeeAmount.MEDIUM] * -10,
          tickUpper: TICK_SPACINGS[FeeAmount.MEDIUM] * 10,
          fee: FeeAmount.MEDIUM,
          recipient: wallets[0].address,
          amount0Desired: expandTo18Decimals(10_000),
          amount1Desired: expandTo18Decimals(10_000),
          amount0Min: 0,
          amount1Min: 0,
          deadline: 10,
        })

        await tokens[0].approve(router.address, constants.MaxUint256)
        await tokens[1].approve(router.address, constants.MaxUint256)

        // accumulate token1 fees
        await router.exactInput({
          recipient: wallets[0].address,
          deadline: 1,
          path: encodePath([tokens[1].address, tokens[0].address], [FeeAmount.MEDIUM]),
          amountIn: expandTo18Decimals(1_000),
          amountOutMinimum: 0,
        })

        // accumulate token0 fees and push price below tickLower
        await router.exactInput({
          recipient: wallets[0].address,
          deadline: 1,
          path: encodePath([tokens[0].address, tokens[1].address], [FeeAmount.MEDIUM]),
          amountIn: expandTo18Decimals(50_000),
          amountOutMinimum: 0,
        })
      })

      it('returns the correct amount of fees', async () => {
        const collectParameters = {
          tokenId: tokenId,
          recipient: wallets[0].address,
          amount0Max: MaxUint128,
          amount1Max: MaxUint128,
        }
        const parameters = [nft.interface.encodeFunctionData('collect', [collectParameters])]
        const { eat, expiry } = await generateAccessToken(signer, domain, wallets[0], nft, parameters)

        const [response] = await nft.callStatic['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](
          eat.v,
          eat.r,
          eat.s,
          expiry,
          parameters
        )
        const { amount0, amount1 } = nft.interface.decodeFunctionResult('collect', response)

        const feeAmounts = await positionValue.fees(nft.address, tokenId)
        expect(feeAmounts[0]).to.equal(amount0)
        expect(feeAmounts[1]).to.equal(amount1)
      })

      it('gas', async () => {
        await snapshotGasCost(positionValue.feesGas(nft.address, tokenId))
      })
    })

    describe('when price is above the position range', async () => {
      beforeEach(async () => {
        await nft.mint({
          token0: tokens[0].address,
          token1: tokens[1].address,
          tickLower: TICK_SPACINGS[FeeAmount.MEDIUM] * -10,
          tickUpper: TICK_SPACINGS[FeeAmount.MEDIUM] * 10,
          fee: FeeAmount.MEDIUM,
          recipient: wallets[0].address,
          amount0Desired: expandTo18Decimals(10_000),
          amount1Desired: expandTo18Decimals(10_000),
          amount0Min: 0,
          amount1Min: 0,
          deadline: 10,
        })

        await tokens[0].approve(router.address, constants.MaxUint256)
        await tokens[1].approve(router.address, constants.MaxUint256)

        // accumulate token0 fees
        await router.exactInput({
          recipient: wallets[0].address,
          deadline: 1,
          path: encodePath([tokens[0].address, tokens[1].address], [FeeAmount.MEDIUM]),
          amountIn: expandTo18Decimals(1_000),
          amountOutMinimum: 0,
        })

        // accumulate token1 fees and push price above tickUpper
        await router.exactInput({
          recipient: wallets[0].address,
          deadline: 1,
          path: encodePath([tokens[1].address, tokens[0].address], [FeeAmount.MEDIUM]),
          amountIn: expandTo18Decimals(50_000),
          amountOutMinimum: 0,
        })
      })

      it('returns the correct amount of fees', async () => {
        const collectParameters = {
          tokenId: tokenId,
          recipient: wallets[0].address,
          amount0Max: MaxUint128,
          amount1Max: MaxUint128,
        }
        const parameters = [nft.interface.encodeFunctionData('collect', [collectParameters])]
        const { eat, expiry } = await generateAccessToken(signer, domain, wallets[0], nft, parameters)

        const [response] = await nft.callStatic['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](
          eat.v,
          eat.r,
          eat.s,
          expiry,
          parameters
        )
        const { amount0, amount1 } = nft.interface.decodeFunctionResult('collect', response)
        const feeAmounts = await positionValue.fees(nft.address, tokenId)
        expect(feeAmounts[0]).to.equal(amount0)
        expect(feeAmounts[1]).to.equal(amount1)
      })

      it('gas', async () => {
        await snapshotGasCost(positionValue.feesGas(nft.address, tokenId))
      })
    })
  })
})
