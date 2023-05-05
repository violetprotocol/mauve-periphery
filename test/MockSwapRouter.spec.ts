import { Fixture } from 'ethereum-waffle'
import { BigNumber, constants, Contract, ContractTransaction, Wallet } from 'ethers'
import { waffle, ethers } from 'hardhat'
import {
  IWETH9,
  MockTimeNonfungiblePositionManager,
  MockTimeSwapRouter,
  TestERC20,
  AccessTokenVerifier,
} from '../typechain'
import completeFixture, { Domain } from './shared/completeFixture'
import { FeeAmount, TICK_SPACINGS } from './shared/constants'
import { encodePriceSqrt } from './shared/encodePriceSqrt'
import { expandTo18Decimals } from './shared/expandTo18Decimals'
import { expect } from './shared/expect'
import { encodePath } from './shared/path'
import { getMaxTick, getMinTick } from './shared/ticks'
import { computePoolAddress } from './shared/computePoolAddress'
import { CreatePoolIfNecessary } from './shared/createPoolIfNecessary'
import { generateAccessTokenForMulticall } from './shared/generateAccessToken'

describe('MockSwapRouter', function () {
  this.timeout(40000)
  let wallet: Wallet
  let trader: Wallet

  const swapRouterFixture: Fixture<{
    weth9: IWETH9
    factory: Contract
    router: MockTimeSwapRouter
    nft: MockTimeNonfungiblePositionManager
    tokens: [TestERC20, TestERC20, TestERC20]
    createAndInitializePoolIfNecessary: CreatePoolIfNecessary
    signer: Wallet
    domain: Domain
    verifier: AccessTokenVerifier
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

    return {
      weth9,
      factory,
      router,
      tokens,
      nft,
      createAndInitializePoolIfNecessary,
      signer,
      domain,
      verifier,
    }
  }

  let factory: Contract
  let weth9: IWETH9
  let router: MockTimeSwapRouter
  let nft: MockTimeNonfungiblePositionManager
  let tokens: [TestERC20, TestERC20, TestERC20]
  let getBalances: (
    who: string
  ) => Promise<{
    weth9: BigNumber
    token0: BigNumber
    token1: BigNumber
    token2: BigNumber
  }>
  let createAndInitializePoolIfNecessary: CreatePoolIfNecessary
  let signer: Wallet
  let domain: Domain
  let verifier: AccessTokenVerifier

  let loadFixture: ReturnType<typeof waffle.createFixtureLoader>

  before('create fixture loader', async () => {
    ;[wallet, trader] = await (ethers as any).getSigners()
    loadFixture = waffle.createFixtureLoader([wallet, trader])
  })

  // helper for getting weth and token balances
  beforeEach('load fixture', async () => {
    ;({
      router,
      weth9,
      factory,
      tokens,
      nft,
      createAndInitializePoolIfNecessary,
      signer,
      domain,
      verifier,
    } = await loadFixture(swapRouterFixture))

    getBalances = async (who: string) => {
      const balances = await Promise.all([
        weth9.balanceOf(who),
        tokens[0].balanceOf(who),
        tokens[1].balanceOf(who),
        tokens[2].balanceOf(who),
      ])
      return {
        weth9: balances[0],
        token0: balances[1],
        token1: balances[2],
        token2: balances[3],
      }
    }
  })

  // ensure the swap router never ends up with a balance
  afterEach('load fixture', async () => {
    const balances = await getBalances(router.address)
    expect(Object.values(balances).every((b) => b.eq(0))).to.be.eq(true)
    const balance = await waffle.provider.getBalance(router.address)
    expect(balance.eq(0)).to.be.eq(true)
  })

  it('bytecode size', async () => {
    expect(((await router.provider.getCode(router.address)).length - 2) / 2).to.matchSnapshot()
  })

  describe('swaps', () => {
    const liquidity = 1000000
    async function createPool(tokenAddressA: string, tokenAddressB: string) {
      if (tokenAddressA.toLowerCase() > tokenAddressB.toLowerCase())
        [tokenAddressA, tokenAddressB] = [tokenAddressB, tokenAddressA]

      await createAndInitializePoolIfNecessary(tokenAddressA, tokenAddressB, FeeAmount.MEDIUM, encodePriceSqrt(1, 1))

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
      await weth9.deposit({ value: liquidity })
      await weth9.approve(nft.address, constants.MaxUint256)
      return createPool(weth9.address, tokenAddress)
    }

    beforeEach('create 0-1 and 1-2 pools', async () => {
      await createPool(tokens[0].address, tokens[1].address)
      await createPool(tokens[1].address, tokens[2].address)
    })

    describe('#exactInput', () => {
      async function exactInput(
        tokens: string[],
        amountIn: number = 3,
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
          amountOutMinimum,
        }

        // ensure that the swap fails if the limit is any tighter
        params.amountOutMinimum += 1
        const exactInputFailCallData = [router.interface.encodeFunctionData('exactInput', [params])]
        const { eat: exactInputFailEAT, expiry: exactInputFailExpiry } = await generateAccessTokenForMulticall(
          signer,
          domain,
          trader,
          router,
          exactInputFailCallData
        )
        await expect(
          router
            .connect(trader)
            ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](
              exactInputFailEAT.v,
              exactInputFailEAT.r,
              exactInputFailEAT.s,
              exactInputFailExpiry,
              exactInputFailCallData,
              { value }
            )
        ).to.be.revertedWith('Too little received')
        params.amountOutMinimum -= 1

        const exactInputCallData = [router.interface.encodeFunctionData('exactInput', [params])]
        if (outputIsWETH9)
          exactInputCallData.push(
            router.interface.encodeFunctionData('unwrapWETH9', [amountOutMinimum, trader.address])
          )
        const { eat: exactInputEAT, expiry: exactInputExpiry } = await generateAccessTokenForMulticall(
          signer,
          domain,
          trader,
          router,
          exactInputCallData
        )
        // optimized for the gas test
        return router
          .connect(trader)
          ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](
            exactInputEAT.v,
            exactInputEAT.r,
            exactInputEAT.s,
            exactInputExpiry,
            exactInputCallData,
            { value }
          )
      }

      describe('single-pool', () => {
        it('0 -> 1', async () => {
          const pool = await factory.getPool(tokens[0].address, tokens[1].address, FeeAmount.MEDIUM)

          // get balances before
          const poolBefore = await getBalances(pool)
          const traderBefore = await getBalances(trader.address)

          await exactInput(tokens.slice(0, 2).map((token) => token.address))

          // get balances after
          const poolAfter = await getBalances(pool)
          const traderAfter = await getBalances(trader.address)

          expect(traderAfter.token0).to.be.eq(traderBefore.token0.sub(3))
          expect(traderAfter.token1).to.be.eq(traderBefore.token1.add(1))
          expect(poolAfter.token0).to.be.eq(poolBefore.token0.add(3))
          expect(poolAfter.token1).to.be.eq(poolBefore.token1.sub(1))
        })

        it('1 -> 0', async () => {
          const pool = await factory.getPool(tokens[1].address, tokens[0].address, FeeAmount.MEDIUM)

          // get balances before
          const poolBefore = await getBalances(pool)
          const traderBefore = await getBalances(trader.address)

          await exactInput(
            tokens
              .slice(0, 2)
              .reverse()
              .map((token) => token.address)
          )

          // get balances after
          const poolAfter = await getBalances(pool)
          const traderAfter = await getBalances(trader.address)

          expect(traderAfter.token0).to.be.eq(traderBefore.token0.add(1))
          expect(traderAfter.token1).to.be.eq(traderBefore.token1.sub(3))
          expect(poolAfter.token0).to.be.eq(poolBefore.token0.sub(1))
          expect(poolAfter.token1).to.be.eq(poolBefore.token1.add(3))
        })
      })

      describe('multi-pool', () => {
        it('0 -> 1 -> 2', async () => {
          const traderBefore = await getBalances(trader.address)

          await exactInput(
            tokens.map((token) => token.address),
            5,
            1
          )

          const traderAfter = await getBalances(trader.address)

          expect(traderAfter.token0).to.be.eq(traderBefore.token0.sub(5))
          expect(traderAfter.token2).to.be.eq(traderBefore.token2.add(1))
        })

        it('2 -> 1 -> 0', async () => {
          const traderBefore = await getBalances(trader.address)

          await exactInput(tokens.map((token) => token.address).reverse(), 5, 1)

          const traderAfter = await getBalances(trader.address)

          expect(traderAfter.token2).to.be.eq(traderBefore.token2.sub(5))
          expect(traderAfter.token0).to.be.eq(traderBefore.token0.add(1))
        })

        it('events', async () => {
          await expect(
            exactInput(
              tokens.map((token) => token.address),
              5,
              1
            )
          )
            .to.emit(tokens[0], 'Transfer')
            .withArgs(
              trader.address,
              computePoolAddress(factory.address, [tokens[0].address, tokens[1].address], FeeAmount.MEDIUM),
              5
            )
            .to.emit(tokens[1], 'Transfer')
            .withArgs(
              computePoolAddress(factory.address, [tokens[0].address, tokens[1].address], FeeAmount.MEDIUM),
              router.address,
              3
            )
            .to.emit(tokens[1], 'Transfer')
            .withArgs(
              router.address,
              computePoolAddress(factory.address, [tokens[1].address, tokens[2].address], FeeAmount.MEDIUM),
              3
            )
            .to.emit(tokens[2], 'Transfer')
            .withArgs(
              computePoolAddress(factory.address, [tokens[1].address, tokens[2].address], FeeAmount.MEDIUM),
              trader.address,
              1
            )
        })
      })

      describe('ETH input', () => {
        describe('WETH9', () => {
          beforeEach(async () => {
            await createPoolWETH9(tokens[0].address)
          })

          it('WETH9 -> 0', async () => {
            const pool = await factory.getPool(weth9.address, tokens[0].address, FeeAmount.MEDIUM)

            // get balances before
            const poolBefore = await getBalances(pool)
            const traderBefore = await getBalances(trader.address)

            await expect(exactInput([weth9.address, tokens[0].address]))
              .to.emit(weth9, 'Deposit')
              .withArgs(router.address, 3)

            // get balances after
            const poolAfter = await getBalances(pool)
            const traderAfter = await getBalances(trader.address)

            expect(traderAfter.token0).to.be.eq(traderBefore.token0.add(1))
            expect(poolAfter.weth9).to.be.eq(poolBefore.weth9.add(3))
            expect(poolAfter.token0).to.be.eq(poolBefore.token0.sub(1))
          })

          it('WETH9 -> 0 -> 1', async () => {
            const traderBefore = await getBalances(trader.address)

            await expect(exactInput([weth9.address, tokens[0].address, tokens[1].address], 5))
              .to.emit(weth9, 'Deposit')
              .withArgs(router.address, 5)

            const traderAfter = await getBalances(trader.address)

            expect(traderAfter.token1).to.be.eq(traderBefore.token1.add(1))
          })
        })
      })

      describe('ETH output', () => {
        describe('WETH9', () => {
          beforeEach(async () => {
            await createPoolWETH9(tokens[0].address)
            await createPoolWETH9(tokens[1].address)
          })

          it('0 -> WETH9', async () => {
            const pool = await factory.getPool(tokens[0].address, weth9.address, FeeAmount.MEDIUM)

            // get balances before
            const poolBefore = await getBalances(pool)
            const traderBefore = await getBalances(trader.address)

            await expect(exactInput([tokens[0].address, weth9.address]))
              .to.emit(weth9, 'Withdrawal')
              .withArgs(router.address, 1)

            // get balances after
            const poolAfter = await getBalances(pool)
            const traderAfter = await getBalances(trader.address)

            expect(traderAfter.token0).to.be.eq(traderBefore.token0.sub(3))
            expect(poolAfter.weth9).to.be.eq(poolBefore.weth9.sub(1))
            expect(poolAfter.token0).to.be.eq(poolBefore.token0.add(3))
          })

          it('0 -> 1 -> WETH9', async () => {
            // get balances before
            const traderBefore = await getBalances(trader.address)

            await expect(exactInput([tokens[0].address, tokens[1].address, weth9.address], 5))
              .to.emit(weth9, 'Withdrawal')
              .withArgs(router.address, 1)

            // get balances after
            const traderAfter = await getBalances(trader.address)

            expect(traderAfter.token0).to.be.eq(traderBefore.token0.sub(5))
          })
        })
      })
    })

    describe('#exactInputSingle', () => {
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
          sqrtPriceLimitX96:
            sqrtPriceLimitX96 ?? tokenIn.toLowerCase() < tokenOut.toLowerCase()
              ? BigNumber.from('4295128740')
              : BigNumber.from('1461446703485210103287273052203988822378723970341'),
          recipient: outputIsWETH9 ? constants.AddressZero : trader.address,
          deadline: 1,
          amountIn,
          amountOutMinimum,
        }

        // ensure that the swap fails if the limit is any tighter
        params.amountOutMinimum += 1
        const exactInputSingleFailCallData = [router.interface.encodeFunctionData('exactInputSingle', [params])]
        const {
          eat: exactInputSingleFailEAT,
          expiry: exactInputSingleFailExpiry,
        } = await generateAccessTokenForMulticall(signer, domain, trader, router, exactInputSingleFailCallData)
        await expect(
          router
            .connect(trader)
            ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](
              exactInputSingleFailEAT.v,
              exactInputSingleFailEAT.r,
              exactInputSingleFailEAT.s,
              exactInputSingleFailExpiry,
              exactInputSingleFailCallData,
              { value }
            )
        ).to.be.revertedWith('Too little received')

        params.amountOutMinimum -= 1
        const exactInputSingleCallData = [router.interface.encodeFunctionData('exactInputSingle', [params])]
        if (outputIsWETH9)
          exactInputSingleCallData.push(
            router.interface.encodeFunctionData('unwrapWETH9', [amountOutMinimum, trader.address])
          )
        const { eat: exactInputSingleEAT, expiry: exactInputSingleExpiry } = await generateAccessTokenForMulticall(
          signer,
          domain,
          trader,
          router,
          exactInputSingleCallData
        )
        // optimized for the gas test
        return router
          .connect(trader)
          ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](
            exactInputSingleEAT.v,
            exactInputSingleEAT.r,
            exactInputSingleEAT.s,
            exactInputSingleExpiry,
            exactInputSingleCallData,
            { value }
          )
      }

      it('0 -> 1', async () => {
        const pool = await factory.getPool(tokens[0].address, tokens[1].address, FeeAmount.MEDIUM)

        // get balances before
        const poolBefore = await getBalances(pool)
        const traderBefore = await getBalances(trader.address)

        await exactInputSingle(tokens[0].address, tokens[1].address)

        // get balances after
        const poolAfter = await getBalances(pool)
        const traderAfter = await getBalances(trader.address)

        expect(traderAfter.token0).to.be.eq(traderBefore.token0.sub(3))
        expect(traderAfter.token1).to.be.eq(traderBefore.token1.add(1))
        expect(poolAfter.token0).to.be.eq(poolBefore.token0.add(3))
        expect(poolAfter.token1).to.be.eq(poolBefore.token1.sub(1))
      })

      it('1 -> 0', async () => {
        const pool = await factory.getPool(tokens[1].address, tokens[0].address, FeeAmount.MEDIUM)

        // get balances before
        const poolBefore = await getBalances(pool)
        const traderBefore = await getBalances(trader.address)

        await exactInputSingle(tokens[1].address, tokens[0].address)

        // get balances after
        const poolAfter = await getBalances(pool)
        const traderAfter = await getBalances(trader.address)

        expect(traderAfter.token0).to.be.eq(traderBefore.token0.add(1))
        expect(traderAfter.token1).to.be.eq(traderBefore.token1.sub(3))
        expect(poolAfter.token0).to.be.eq(poolBefore.token0.sub(1))
        expect(poolAfter.token1).to.be.eq(poolBefore.token1.add(3))
      })

      describe('ETH input', () => {
        describe('WETH9', () => {
          beforeEach(async () => {
            await createPoolWETH9(tokens[0].address)
          })

          it('WETH9 -> 0', async () => {
            const pool = await factory.getPool(weth9.address, tokens[0].address, FeeAmount.MEDIUM)

            // get balances before
            const poolBefore = await getBalances(pool)
            const traderBefore = await getBalances(trader.address)

            await expect(exactInputSingle(weth9.address, tokens[0].address))
              .to.emit(weth9, 'Deposit')
              .withArgs(router.address, 3)

            // get balances after
            const poolAfter = await getBalances(pool)
            const traderAfter = await getBalances(trader.address)

            expect(traderAfter.token0).to.be.eq(traderBefore.token0.add(1))
            expect(poolAfter.weth9).to.be.eq(poolBefore.weth9.add(3))
            expect(poolAfter.token0).to.be.eq(poolBefore.token0.sub(1))
          })
        })
      })

      describe('ETH output', () => {
        describe('WETH9', () => {
          beforeEach(async () => {
            await createPoolWETH9(tokens[0].address)
            await createPoolWETH9(tokens[1].address)
          })

          it('0 -> WETH9', async () => {
            const pool = await factory.getPool(tokens[0].address, weth9.address, FeeAmount.MEDIUM)

            // get balances before
            const poolBefore = await getBalances(pool)
            const traderBefore = await getBalances(trader.address)

            await expect(exactInputSingle(tokens[0].address, weth9.address))
              .to.emit(weth9, 'Withdrawal')
              .withArgs(router.address, 1)

            // get balances after
            const poolAfter = await getBalances(pool)
            const traderAfter = await getBalances(trader.address)

            expect(traderAfter.token0).to.be.eq(traderBefore.token0.sub(3))
            expect(poolAfter.weth9).to.be.eq(poolBefore.weth9.sub(1))
            expect(poolAfter.token0).to.be.eq(poolBefore.token0.add(3))
          })
        })
      })
    })

    describe('#exactOutput', () => {
      async function exactOutput(
        tokens: string[],
        amountOut: number = 1,
        amountInMaximum: number = 3
      ): Promise<ContractTransaction> {
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

        // ensure that the swap fails if the limit is any tighter
        params.amountInMaximum -= 1
        const exactOutputFailCallData = [router.interface.encodeFunctionData('exactOutput', [params])]
        let { eat: exactOutputFailEAT, expiry: exactOutputFailExpiry } = await generateAccessTokenForMulticall(
          signer,
          domain,
          trader,
          router,
          exactOutputFailCallData
        )
        await expect(
          router
            .connect(trader)
            ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](
              exactOutputFailEAT.v,
              exactOutputFailEAT.r,
              exactOutputFailEAT.s,
              exactOutputFailExpiry,
              exactOutputFailCallData,
              { value }
            )
        ).to.be.revertedWith('Too much requested')
        params.amountInMaximum += 1

        const exactOutputCallData = [router.interface.encodeFunctionData('exactOutput', [params])]
        if (inputIsWETH9)
          exactOutputCallData.push(router.interface.encodeFunctionData('unwrapWETH9', [0, trader.address]))
        if (outputIsWETH9)
          exactOutputCallData.push(router.interface.encodeFunctionData('unwrapWETH9', [amountOut, trader.address]))
        const { eat: exactOutputEAT, expiry: exactOutputExpiry } = await generateAccessTokenForMulticall(
          signer,
          domain,
          trader,
          router,
          exactOutputCallData
        )
        return router
          .connect(trader)
          ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](
            exactOutputEAT.v,
            exactOutputEAT.r,
            exactOutputEAT.s,
            exactOutputExpiry,
            exactOutputCallData,
            { value }
          )
      }

      describe('single-pool', () => {
        it('0 -> 1', async () => {
          const pool = await factory.getPool(tokens[0].address, tokens[1].address, FeeAmount.MEDIUM)

          // get balances before
          const poolBefore = await getBalances(pool)
          const traderBefore = await getBalances(trader.address)

          await exactOutput(tokens.slice(0, 2).map((token) => token.address))

          // get balances after
          const poolAfter = await getBalances(pool)
          const traderAfter = await getBalances(trader.address)

          expect(traderAfter.token0).to.be.eq(traderBefore.token0.sub(3))
          expect(traderAfter.token1).to.be.eq(traderBefore.token1.add(1))
          expect(poolAfter.token0).to.be.eq(poolBefore.token0.add(3))
          expect(poolAfter.token1).to.be.eq(poolBefore.token1.sub(1))
        })

        it('1 -> 0', async () => {
          const pool = await factory.getPool(tokens[1].address, tokens[0].address, FeeAmount.MEDIUM)

          // get balances before
          const poolBefore = await getBalances(pool)
          const traderBefore = await getBalances(trader.address)

          await exactOutput(
            tokens
              .slice(0, 2)
              .reverse()
              .map((token) => token.address)
          )

          // get balances after
          const poolAfter = await getBalances(pool)
          const traderAfter = await getBalances(trader.address)

          expect(traderAfter.token0).to.be.eq(traderBefore.token0.add(1))
          expect(traderAfter.token1).to.be.eq(traderBefore.token1.sub(3))
          expect(poolAfter.token0).to.be.eq(poolBefore.token0.sub(1))
          expect(poolAfter.token1).to.be.eq(poolBefore.token1.add(3))
        })
      })

      describe('multi-pool', () => {
        it('0 -> 1 -> 2', async () => {
          const traderBefore = await getBalances(trader.address)

          await exactOutput(
            tokens.map((token) => token.address),
            1,
            5
          )

          const traderAfter = await getBalances(trader.address)

          expect(traderAfter.token0).to.be.eq(traderBefore.token0.sub(5))
          expect(traderAfter.token2).to.be.eq(traderBefore.token2.add(1))
        })

        it('2 -> 1 -> 0', async () => {
          const traderBefore = await getBalances(trader.address)

          await exactOutput(tokens.map((token) => token.address).reverse(), 1, 5)

          const traderAfter = await getBalances(trader.address)

          expect(traderAfter.token2).to.be.eq(traderBefore.token2.sub(5))
          expect(traderAfter.token0).to.be.eq(traderBefore.token0.add(1))
        })

        it('events', async () => {
          await expect(
            exactOutput(
              tokens.map((token) => token.address),
              1,
              5
            )
          )
            .to.emit(tokens[2], 'Transfer')
            .withArgs(
              computePoolAddress(factory.address, [tokens[2].address, tokens[1].address], FeeAmount.MEDIUM),
              trader.address,
              1
            )
            .to.emit(tokens[1], 'Transfer')
            .withArgs(
              computePoolAddress(factory.address, [tokens[1].address, tokens[0].address], FeeAmount.MEDIUM),
              computePoolAddress(factory.address, [tokens[2].address, tokens[1].address], FeeAmount.MEDIUM),
              3
            )
            .to.emit(tokens[0], 'Transfer')
            .withArgs(
              trader.address,
              computePoolAddress(factory.address, [tokens[1].address, tokens[0].address], FeeAmount.MEDIUM),
              5
            )
        })
      })

      describe('ETH input', () => {
        describe('WETH9', () => {
          beforeEach(async () => {
            await createPoolWETH9(tokens[0].address)
          })

          it('WETH9 -> 0', async () => {
            const pool = await factory.getPool(weth9.address, tokens[0].address, FeeAmount.MEDIUM)

            // get balances before
            const poolBefore = await getBalances(pool)
            const traderBefore = await getBalances(trader.address)

            await expect(exactOutput([weth9.address, tokens[0].address]))
              .to.emit(weth9, 'Deposit')
              .withArgs(router.address, 3)

            // get balances after
            const poolAfter = await getBalances(pool)
            const traderAfter = await getBalances(trader.address)

            expect(traderAfter.token0).to.be.eq(traderBefore.token0.add(1))
            expect(poolAfter.weth9).to.be.eq(poolBefore.weth9.add(3))
            expect(poolAfter.token0).to.be.eq(poolBefore.token0.sub(1))
          })

          it('WETH9 -> 0 -> 1', async () => {
            const traderBefore = await getBalances(trader.address)

            await expect(exactOutput([weth9.address, tokens[0].address, tokens[1].address], 1, 5))
              .to.emit(weth9, 'Deposit')
              .withArgs(router.address, 5)

            const traderAfter = await getBalances(trader.address)

            expect(traderAfter.token1).to.be.eq(traderBefore.token1.add(1))
          })
        })
      })

      describe('ETH output', () => {
        describe('WETH9', () => {
          beforeEach(async () => {
            await createPoolWETH9(tokens[0].address)
            await createPoolWETH9(tokens[1].address)
          })

          it('0 -> WETH9', async () => {
            const pool = await factory.getPool(tokens[0].address, weth9.address, FeeAmount.MEDIUM)

            // get balances before
            const poolBefore = await getBalances(pool)
            const traderBefore = await getBalances(trader.address)

            await expect(exactOutput([tokens[0].address, weth9.address]))
              .to.emit(weth9, 'Withdrawal')
              .withArgs(router.address, 1)

            // get balances after
            const poolAfter = await getBalances(pool)
            const traderAfter = await getBalances(trader.address)

            expect(traderAfter.token0).to.be.eq(traderBefore.token0.sub(3))
            expect(poolAfter.weth9).to.be.eq(poolBefore.weth9.sub(1))
            expect(poolAfter.token0).to.be.eq(poolBefore.token0.add(3))
          })

          it('0 -> 1 -> WETH9', async () => {
            // get balances before
            const traderBefore = await getBalances(trader.address)

            await expect(exactOutput([tokens[0].address, tokens[1].address, weth9.address], 1, 5))
              .to.emit(weth9, 'Withdrawal')
              .withArgs(router.address, 1)

            // get balances after
            const traderAfter = await getBalances(trader.address)

            expect(traderAfter.token0).to.be.eq(traderBefore.token0.sub(5))
          })
        })
      })
    })

    describe('#exactOutputSingle', () => {
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
          sqrtPriceLimitX96:
            sqrtPriceLimitX96 ?? tokenIn.toLowerCase() < tokenOut.toLowerCase()
              ? BigNumber.from('4295128740')
              : BigNumber.from('1461446703485210103287273052203988822378723970341'),
        }

        // ensure that the swap fails if the limit is any tighter
        params.amountInMaximum -= 1
        const exactOutputSingleFailCallData = [router.interface.encodeFunctionData('exactOutputSingle', [params])]
        const {
          eat: exactOutputSingleFailEAT,
          expiry: exactOutputSingleFailExpiry,
        } = await generateAccessTokenForMulticall(signer, domain, trader, router, exactOutputSingleFailCallData)
        await expect(
          router
            .connect(trader)
            ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](
              exactOutputSingleFailEAT.v,
              exactOutputSingleFailEAT.r,
              exactOutputSingleFailEAT.s,
              exactOutputSingleFailExpiry,
              exactOutputSingleFailCallData,
              { value }
            )
        ).to.be.revertedWith('Too much requested')
        params.amountInMaximum += 1

        const exactOutputSingleCallData = [router.interface.encodeFunctionData('exactOutputSingle', [params])]
        if (inputIsWETH9) exactOutputSingleCallData.push(router.interface.encodeFunctionData('refundETH'))
        if (outputIsWETH9)
          exactOutputSingleCallData.push(
            router.interface.encodeFunctionData('unwrapWETH9', [amountOut, trader.address])
          )
        const { eat: exactOutputSingleEAT, expiry: exactOutputSingleExpiry } = await generateAccessTokenForMulticall(
          signer,
          domain,
          trader,
          router,
          exactOutputSingleCallData
        )
        return router
          .connect(trader)
          ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](
            exactOutputSingleEAT.v,
            exactOutputSingleEAT.r,
            exactOutputSingleEAT.s,
            exactOutputSingleExpiry,
            exactOutputSingleCallData,
            { value }
          )
      }

      it('0 -> 1', async () => {
        const pool = await factory.getPool(tokens[0].address, tokens[1].address, FeeAmount.MEDIUM)

        // get balances before
        const poolBefore = await getBalances(pool)
        const traderBefore = await getBalances(trader.address)

        await exactOutputSingle(tokens[0].address, tokens[1].address)

        // get balances after
        const poolAfter = await getBalances(pool)
        const traderAfter = await getBalances(trader.address)

        expect(traderAfter.token0).to.be.eq(traderBefore.token0.sub(3))
        expect(traderAfter.token1).to.be.eq(traderBefore.token1.add(1))
        expect(poolAfter.token0).to.be.eq(poolBefore.token0.add(3))
        expect(poolAfter.token1).to.be.eq(poolBefore.token1.sub(1))
      })

      it('1 -> 0', async () => {
        const pool = await factory.getPool(tokens[1].address, tokens[0].address, FeeAmount.MEDIUM)

        // get balances before
        const poolBefore = await getBalances(pool)
        const traderBefore = await getBalances(trader.address)

        await exactOutputSingle(tokens[1].address, tokens[0].address)

        // get balances after
        const poolAfter = await getBalances(pool)
        const traderAfter = await getBalances(trader.address)

        expect(traderAfter.token0).to.be.eq(traderBefore.token0.add(1))
        expect(traderAfter.token1).to.be.eq(traderBefore.token1.sub(3))
        expect(poolAfter.token0).to.be.eq(poolBefore.token0.sub(1))
        expect(poolAfter.token1).to.be.eq(poolBefore.token1.add(3))
      })

      describe('ETH input', () => {
        describe('WETH9', () => {
          beforeEach(async () => {
            await createPoolWETH9(tokens[0].address)
          })

          it('WETH9 -> 0', async () => {
            const pool = await factory.getPool(weth9.address, tokens[0].address, FeeAmount.MEDIUM)

            // get balances before
            const poolBefore = await getBalances(pool)
            const traderBefore = await getBalances(trader.address)

            await expect(exactOutputSingle(weth9.address, tokens[0].address))
              .to.emit(weth9, 'Deposit')
              .withArgs(router.address, 3)

            // get balances after
            const poolAfter = await getBalances(pool)
            const traderAfter = await getBalances(trader.address)

            expect(traderAfter.token0).to.be.eq(traderBefore.token0.add(1))
            expect(poolAfter.weth9).to.be.eq(poolBefore.weth9.add(3))
            expect(poolAfter.token0).to.be.eq(poolBefore.token0.sub(1))
          })
        })
      })

      describe('ETH output', () => {
        describe('WETH9', () => {
          beforeEach(async () => {
            await createPoolWETH9(tokens[0].address)
            await createPoolWETH9(tokens[1].address)
          })

          it('0 -> WETH9', async () => {
            const pool = await factory.getPool(tokens[0].address, weth9.address, FeeAmount.MEDIUM)

            // get balances before
            const poolBefore = await getBalances(pool)
            const traderBefore = await getBalances(trader.address)

            await expect(exactOutputSingle(tokens[0].address, weth9.address))
              .to.emit(weth9, 'Withdrawal')
              .withArgs(router.address, 1)

            // get balances after
            const poolAfter = await getBalances(pool)
            const traderAfter = await getBalances(trader.address)

            expect(traderAfter.token0).to.be.eq(traderBefore.token0.sub(3))
            expect(poolAfter.weth9).to.be.eq(poolBefore.weth9.sub(1))
            expect(poolAfter.token0).to.be.eq(poolBefore.token0.add(3))
          })
        })
      })
    })

    describe('*WithFee', () => {
      const feeRecipient = '0xfEE0000000000000000000000000000000000000'

      it('#sweepTokenWithFee', async () => {
        const amountOutMinimum = 100
        const params = {
          path: encodePath([tokens[0].address, tokens[1].address], [FeeAmount.MEDIUM]),
          recipient: router.address,
          deadline: 1,
          amountIn: 102,
          amountOutMinimum,
        }

        const data = [
          router.interface.encodeFunctionData('exactInput', [params]),
          router.interface.encodeFunctionData('sweepTokenWithFee', [
            tokens[1].address,
            amountOutMinimum,
            trader.address,
            100,
            feeRecipient,
          ]),
        ]

        const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, trader, router, data)
        await router
          .connect(trader)
          ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, data)

        const balance = await tokens[1].balanceOf(feeRecipient)
        expect(balance.eq(1)).to.be.eq(true)
      })

      it('#unwrapWETH9WithFee', async () => {
        const startBalance = await waffle.provider.getBalance(feeRecipient)
        await createPoolWETH9(tokens[0].address)

        const amountOutMinimum = 100
        const params = {
          path: encodePath([tokens[0].address, weth9.address], [FeeAmount.MEDIUM]),
          recipient: router.address,
          deadline: 1,
          amountIn: 102,
          amountOutMinimum,
        }

        const data = [
          router.interface.encodeFunctionData('exactInput', [params]),
          router.interface.encodeFunctionData('unwrapWETH9WithFee', [
            amountOutMinimum,
            trader.address,
            100,
            feeRecipient,
          ]),
        ]

        const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, trader, router, data)
        await router
          .connect(trader)
          ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, data)
        const endBalance = await waffle.provider.getBalance(feeRecipient)
        expect(endBalance.sub(startBalance).eq(1)).to.be.eq(true)
      })
    })
  })
})
