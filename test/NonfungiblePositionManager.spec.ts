import { abi as IMauvePoolABI } from '@violetprotocol/mauve-core/artifacts/contracts/interfaces/IMauvePool.sol/IMauvePool.json'
import { Fixture } from 'ethereum-waffle'
import { BigNumberish, constants, Wallet, BigNumber, Contract } from 'ethers'
import { ethers, waffle } from 'hardhat'
import {
  IMauveFactoryReduced,
  IWETH9,
  MockTimeNonfungiblePositionManager,
  NonfungiblePositionManagerPositionsGasTest,
  TestERC20,
  TestPositionNFTOwner,
  AccessTokenVerifier,
  MockTimeSwapRouter,
  TestERC20Reentrant,
} from '../typechain'
import completeFixture, {
  Domain,
  MAUVE_VERIFIED_PARTNER_APP_TOKEN_ID,
  MAUVE_VERIFIED_ACCOUNT_TOKEN_ID,
} from './shared/completeFixture'
import { computePoolAddress } from './shared/computePoolAddress'
import { FeeAmount, MaxUint128, TICK_SPACINGS } from './shared/constants'
import { CreatePoolIfNecessary } from './shared/createPoolIfNecessary'
import { encodePriceSqrt } from './shared/encodePriceSqrt'
import { expandTo18Decimals } from './shared/expandTo18Decimals'
import { expect } from './shared/expect'
import { extractJSONFromURI } from './shared/extractJSONFromURI'
import getPermitNFTSignature from './shared/getPermitNFTSignature'
import { encodePath } from './shared/path'
import poolAtAddress from './shared/poolAtAddress'
import snapshotGasCost from './shared/snapshotGasCost'
import { getMaxTick, getMinTick } from './shared/ticks'
import { sortedTokens } from './shared/tokenSort'
import { generateAccessToken, generateAccessTokenForMulticall } from './shared/generateAccessToken'

describe('NonfungiblePositionManager', () => {
  let wallets: Wallet[]
  let wallet: Wallet, other: Wallet

  const nftFixture: Fixture<{
    nft: MockTimeNonfungiblePositionManager
    factory: IMauveFactoryReduced
    tokens: [TestERC20, TestERC20, TestERC20]
    reentrantToken: TestERC20Reentrant
    weth9: IWETH9
    router: MockTimeSwapRouter
    createAndInitializePoolIfNecessary: CreatePoolIfNecessary
    signer: Wallet
    domain: Domain
    verifier: AccessTokenVerifier
    violetID: Contract
  }> = async (wallets, provider) => {
    const {
      weth9,
      factory,
      tokens,
      reentrantToken,
      nft,
      router,
      createAndInitializePoolIfNecessary,
      signer,
      domain,
      verifier,
      violetID,
    } = await completeFixture(wallets, provider)

    const allTokens = [...tokens, reentrantToken]
    // approve & fund wallets
    for (const token of allTokens) {
      await token.approve(nft.address, constants.MaxUint256)
      await token.connect(other).approve(nft.address, constants.MaxUint256)
      await token.transfer(other.address, expandTo18Decimals(1_000_000))
    }

    return {
      nft,
      factory,
      tokens,
      reentrantToken,
      weth9,
      router,
      createAndInitializePoolIfNecessary,
      signer,
      domain,
      verifier,
      violetID,
    }
  }

  let factory: IMauveFactoryReduced
  let nft: MockTimeNonfungiblePositionManager
  let tokens: [TestERC20, TestERC20, TestERC20]
  let reentrantToken: TestERC20Reentrant
  let weth9: IWETH9
  let router: MockTimeSwapRouter
  let createAndInitializePoolIfNecessary: CreatePoolIfNecessary
  let signer: Wallet
  let domain: Domain
  let verifier: AccessTokenVerifier
  let violetID: Contract

  let loadFixture: ReturnType<typeof waffle.createFixtureLoader>

  before('create fixture loader', async () => {
    wallets = await (ethers as any).getSigners()
    ;[wallet, other] = wallets

    loadFixture = waffle.createFixtureLoader(wallets)
  })

  beforeEach('load fixture', async () => {
    ;;({
      nft,
      factory,
      tokens,
      reentrantToken,
      weth9,
      router,
      createAndInitializePoolIfNecessary,
      signer,
      domain,
      verifier,
      violetID,
    } = await loadFixture(nftFixture))
  })

  it('bytecode size', async () => {
    expect(((await nft.provider.getCode(nft.address)).length - 2) / 2).to.matchSnapshot()
  })

  describe('#createAndInitializePoolIfNecessary', () => {
    it('creates the pool at the expected address', async () => {
      const expectedAddress = computePoolAddress(
        factory.address,
        [tokens[0].address, tokens[1].address],
        FeeAmount.MEDIUM
      )
      const code = await wallet.provider.getCode(expectedAddress)
      expect(code).to.eq('0x')
      const poolAddress = await createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )
      expect(poolAddress).to.eq(expectedAddress)
      const codeAfter = await wallet.provider.getCode(expectedAddress)
      expect(codeAfter).to.not.eq('0x')
    })

    it('is payable', async () => {
      await createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1),
        { value: 1 }
      )
    })

    it('works if pool is created but not initialized', async () => {
      const expectedAddress = computePoolAddress(
        factory.address,
        [tokens[0].address, tokens[1].address],
        FeeAmount.MEDIUM
      )
      await factory.createPool(tokens[0].address, tokens[1].address, FeeAmount.MEDIUM)
      const code = await wallet.provider.getCode(expectedAddress)
      expect(code).to.not.eq('0x')
      await createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(2, 1)
      )
    })

    it('works if pool is created and initialized', async () => {
      const expectedAddress = computePoolAddress(
        factory.address,
        [tokens[0].address, tokens[1].address],
        FeeAmount.MEDIUM
      )
      await factory.createPool(tokens[0].address, tokens[1].address, FeeAmount.MEDIUM)
      const pool = new ethers.Contract(expectedAddress, IMauvePoolABI, wallet)

      await pool.initialize(encodePriceSqrt(3, 1))
      const code = await wallet.provider.getCode(expectedAddress)
      expect(code).to.not.eq('0x')
      await createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(4, 1)
      )
    })
  })

  describe('#mint', () => {
    it('fails if pool does not exist', async () => {
      const mintParams = {
        token0: tokens[0].address,
        token1: tokens[1].address,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        amount0Desired: 100,
        amount1Desired: 100,
        amount0Min: 0,
        amount1Min: 0,
        recipient: wallet.address,
        deadline: 1,
        fee: FeeAmount.MEDIUM,
      }
      const mintMulticallParameters = [nft.interface.encodeFunctionData('mint', [mintParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(
        signer,
        domain,
        wallet,
        nft,
        mintMulticallParameters
      )

      await expect(
        nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, mintMulticallParameters)
      ).to.be.reverted
    })

    it('fails if cannot transfer', async () => {
      await createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )
      await tokens[0].approve(nft.address, 0)

      const mintParams = {
        token0: tokens[0].address,
        token1: tokens[1].address,
        fee: FeeAmount.MEDIUM,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        amount0Desired: 100,
        amount1Desired: 100,
        amount0Min: 0,
        amount1Min: 0,
        recipient: wallet.address,
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

      await expect(
        nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, mintMulticallParameters)
      ).to.be.revertedWith('STF')
    })

    it('creates a token', async () => {
      await createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )

      const mintParams = {
        token0: tokens[0].address,
        token1: tokens[1].address,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        fee: FeeAmount.MEDIUM,
        recipient: other.address,
        amount0Desired: 15,
        amount1Desired: 15,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 10,
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
      expect(await nft.balanceOf(other.address)).to.eq(1)
      expect(await nft.tokenOfOwnerByIndex(other.address, 0)).to.eq(1)
      const {
        fee,
        token0,
        token1,
        tickLower,
        tickUpper,
        liquidity,
        tokensOwed0,
        tokensOwed1,
        feeGrowthInside0LastX128,
        feeGrowthInside1LastX128,
      } = await nft.positions(1)
      expect(token0).to.eq(tokens[0].address)
      expect(token1).to.eq(tokens[1].address)
      expect(fee).to.eq(FeeAmount.MEDIUM)
      expect(tickLower).to.eq(getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]))
      expect(tickUpper).to.eq(getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]))
      expect(liquidity).to.eq(15)
      expect(tokensOwed0).to.eq(0)
      expect(tokensOwed1).to.eq(0)
      expect(feeGrowthInside0LastX128).to.eq(0)
      expect(feeGrowthInside1LastX128).to.eq(0)
    })

    it('fails if in emergency mode', async () => {
      await createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )

      const mintParams = {
        token0: tokens[0].address,
        token1: tokens[1].address,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        fee: FeeAmount.MEDIUM,
        recipient: other.address,
        amount0Desired: 15,
        amount1Desired: 15,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 10,
      }
      const mintMulticallParameters = [nft.interface.encodeFunctionData('mint', [mintParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(
        signer,
        domain,
        wallet,
        nft,
        mintMulticallParameters
      )

      await nft.setEmergencyMode(true)
      await expect(
        nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, mintMulticallParameters)
      ).to.be.reverted
    })

    it('minting works again after disabling emergency mode', async () => {
      await createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )

      const mintParams = {
        token0: tokens[0].address,
        token1: tokens[1].address,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        fee: FeeAmount.MEDIUM,
        recipient: other.address,
        amount0Desired: 15,
        amount1Desired: 15,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 10,
      }
      const mintMulticallParameters = [nft.interface.encodeFunctionData('mint', [mintParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(
        signer,
        domain,
        wallet,
        nft,
        mintMulticallParameters
      )

      await nft.setEmergencyMode(true)
      await expect(
        nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, mintMulticallParameters)
      ).to.be.reverted

      await nft.setEmergencyMode(false)

      await expect(
        nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, mintMulticallParameters)
      ).to.not.be.reverted

      expect(await nft.balanceOf(other.address)).to.eq(1)
    })

    it('can use eth via multicall', async () => {
      const [token0, token1] = sortedTokens(weth9, tokens[0])

      // remove any approval
      await weth9.approve(nft.address, 0)

      await createAndInitializePoolIfNecessary(token0.address, token1.address, FeeAmount.MEDIUM, encodePriceSqrt(1, 1))

      const mintData = nft.interface.encodeFunctionData('mint', [
        {
          token0: token0.address,
          token1: token1.address,
          tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          fee: FeeAmount.MEDIUM,
          recipient: other.address,
          amount0Desired: 100,
          amount1Desired: 100,
          amount0Min: 0,
          amount1Min: 0,
          deadline: 1,
        },
      ])

      const refundETHData = nft.interface.encodeFunctionData('refundETH')

      const mintMulticallParameters = [mintData, refundETHData]
      const { eat, expiry } = await generateAccessTokenForMulticall(
        signer,
        domain,
        wallet,
        nft,
        mintMulticallParameters
      )

      const balanceBefore = await wallet.getBalance()

      const tx = await nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](
        eat.v,
        eat.r,
        eat.s,
        expiry,
        mintMulticallParameters,
        { value: expandTo18Decimals(1) }
      )

      const receipt = await tx.wait()
      const balanceAfter = await wallet.getBalance()
      expect(balanceBefore).to.eq(balanceAfter.add(receipt.gasUsed.mul(tx.gasPrice)).add(100))
    })

    it('gas first mint for pool', async () => {
      await createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )
      const mintParams = {
        token0: tokens[0].address,
        token1: tokens[1].address,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        fee: FeeAmount.MEDIUM,
        recipient: wallet.address,
        amount0Desired: 100,
        amount1Desired: 100,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 10,
      }
      const mintMulticallParameters = [nft.interface.encodeFunctionData('mint', [mintParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(
        signer,
        domain,
        wallet,
        nft,
        mintMulticallParameters
      )

      await snapshotGasCost(
        nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, mintMulticallParameters)
      )
    })

    it('gas first mint for pool using eth with zero refund', async () => {
      const [token0, token1] = sortedTokens(weth9, tokens[0])
      await createAndInitializePoolIfNecessary(token0.address, token1.address, FeeAmount.MEDIUM, encodePriceSqrt(1, 1))

      const parameters = [
        nft.interface.encodeFunctionData('mint', [
          {
            token0: token0.address,
            token1: token1.address,
            tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
            tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
            fee: FeeAmount.MEDIUM,
            recipient: wallet.address,
            amount0Desired: 100,
            amount1Desired: 100,
            amount0Min: 0,
            amount1Min: 0,
            deadline: 10,
          },
        ]),
        nft.interface.encodeFunctionData('refundETH'),
      ]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, wallet, nft, parameters)

      await snapshotGasCost(
        nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, parameters, { value: 100 })
      )
    })

    it('gas first mint for pool using eth with non-zero refund', async () => {
      const [token0, token1] = sortedTokens(weth9, tokens[0])
      await createAndInitializePoolIfNecessary(token0.address, token1.address, FeeAmount.MEDIUM, encodePriceSqrt(1, 1))

      const parameters = [
        nft.interface.encodeFunctionData('mint', [
          {
            token0: token0.address,
            token1: token1.address,
            tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
            tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
            fee: FeeAmount.MEDIUM,
            recipient: wallet.address,
            amount0Desired: 100,
            amount1Desired: 100,
            amount0Min: 0,
            amount1Min: 0,
            deadline: 10,
          },
        ]),
        nft.interface.encodeFunctionData('refundETH'),
      ]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, wallet, nft, parameters)

      await snapshotGasCost(
        nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, parameters, {
          value: 1000,
        })
      )
    })

    it('gas mint on same ticks', async () => {
      await createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )

      const mintParamsFromOtherWallet = {
        token0: tokens[0].address,
        token1: tokens[1].address,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        fee: FeeAmount.MEDIUM,
        recipient: other.address,
        amount0Desired: 100,
        amount1Desired: 100,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 10,
      }

      const mintMulticallParametersFromOtherWallet = [
        nft.connect(other).interface.encodeFunctionData('mint', [mintParamsFromOtherWallet]),
      ]
      const { eat: eatOtherWallet, expiry: expiryOtherWallet } = await generateAccessTokenForMulticall(
        signer,
        domain,
        other,
        nft,
        mintMulticallParametersFromOtherWallet
      )

      await nft
        .connect(other)
        ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](
          eatOtherWallet.v,
          eatOtherWallet.r,
          eatOtherWallet.s,
          expiryOtherWallet,
          mintMulticallParametersFromOtherWallet
        )

      const mintParams = {
        token0: tokens[0].address,
        token1: tokens[1].address,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        fee: FeeAmount.MEDIUM,
        recipient: wallet.address,
        amount0Desired: 100,
        amount1Desired: 100,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 10,
      }

      const mintMulticallParameters = [nft.interface.encodeFunctionData('mint', [mintParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(
        signer,
        domain,
        wallet,
        nft,
        mintMulticallParameters
      )

      await snapshotGasCost(
        nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, mintMulticallParameters)
      )
    })

    it('gas mint for same pool, different ticks', async () => {
      await createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )

      const mintToOtherWalletParams = {
        token0: tokens[0].address,
        token1: tokens[1].address,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        fee: FeeAmount.MEDIUM,
        recipient: other.address,
        amount0Desired: 100,
        amount1Desired: 100,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 10,
      }
      const mintToOtherWalletParameters = [nft.interface.encodeFunctionData('mint', [mintToOtherWalletParams])]
      const { eat: eatToOtherWallet, expiry: expiryOtherWallet } = await generateAccessTokenForMulticall(
        signer,
        domain,
        other,
        nft,
        mintToOtherWalletParameters
      )

      await nft
        .connect(other)
        ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](
          eatToOtherWallet.v,
          eatToOtherWallet.r,
          eatToOtherWallet.s,
          expiryOtherWallet,
          mintToOtherWalletParameters
        )

      const mintParams = {
        token0: tokens[0].address,
        token1: tokens[1].address,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]) + TICK_SPACINGS[FeeAmount.MEDIUM],
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]) - TICK_SPACINGS[FeeAmount.MEDIUM],
        fee: FeeAmount.MEDIUM,
        recipient: wallet.address,
        amount0Desired: 100,
        amount1Desired: 100,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 10,
      }

      const mintParameters = [nft.interface.encodeFunctionData('mint', [mintParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, wallet, nft, mintParameters)

      await snapshotGasCost(
        nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, mintParameters)
      )
    })
  })

  describe('#increaseLiquidity', () => {
    const tokenId = 1
    beforeEach('create a position', async () => {
      await createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )

      const mintParams = {
        token0: tokens[0].address,
        token1: tokens[1].address,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        fee: FeeAmount.MEDIUM,
        recipient: other.address,
        amount0Desired: 1000,
        amount1Desired: 1000,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      }

      const multicallParameters = [nft.interface.encodeFunctionData('mint', [mintParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, wallet, nft, multicallParameters)

      await nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, multicallParameters)
    })

    it('increases position liquidity', async () => {
      const increasesLiquidityParams = {
        tokenId: tokenId,
        amount0Desired: 100,
        amount1Desired: 100,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      }
      const multicallParameters = [nft.interface.encodeFunctionData('increaseLiquidity', [increasesLiquidityParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, wallet, nft, multicallParameters)

      await nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, multicallParameters)
      const { liquidity } = await nft.positions(tokenId)
      expect(liquidity).to.eq(1100)
    })

    it('should not increase position liquidity in emergency mode', async () => {
      const increasesLiquidityParams = {
        tokenId: tokenId,
        amount0Desired: 100,
        amount1Desired: 100,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      }
      const multicallParameters = [nft.interface.encodeFunctionData('increaseLiquidity', [increasesLiquidityParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, wallet, nft, multicallParameters)

      await nft.setEmergencyMode(true)
      await expect(
        nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, multicallParameters)
      ).to.be.reverted
    })

    it('should increase position liquidity after disabling emergency mode', async () => {
      const increasesLiquidityParams = {
        tokenId: tokenId,
        amount0Desired: 100,
        amount1Desired: 100,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      }
      const multicallParameters = [nft.interface.encodeFunctionData('increaseLiquidity', [increasesLiquidityParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, wallet, nft, multicallParameters)

      await nft.setEmergencyMode(true)

      await nft.setEmergencyMode(false)

      await expect(
        nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, multicallParameters)
      ).to.not.be.reverted
      const { liquidity } = await nft.positions(tokenId)
      expect(liquidity).to.eq(1100)
    })

    it('can be paid with ETH', async () => {
      const [token0, token1] = sortedTokens(tokens[0], weth9)

      const tokenId = 1

      await createAndInitializePoolIfNecessary(token0.address, token1.address, FeeAmount.MEDIUM, encodePriceSqrt(1, 1))

      const mintData = nft.interface.encodeFunctionData('mint', [
        {
          token0: token0.address,
          token1: token1.address,
          fee: FeeAmount.MEDIUM,
          tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          recipient: other.address,
          amount0Desired: 100,
          amount1Desired: 100,
          amount0Min: 0,
          amount1Min: 0,
          deadline: 1,
        },
      ])
      const refundETHData = nft.interface.encodeFunctionData('unwrapWETH9', [0, other.address])
      const mintParameters = [mintData, refundETHData]
      const { eat: mintEat, expiry: mintExpiry } = await generateAccessTokenForMulticall(
        signer,
        domain,
        wallet,
        nft,
        mintParameters
      )

      await nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](
        mintEat.v,
        mintEat.r,
        mintEat.s,
        mintExpiry,
        mintParameters,
        { value: expandTo18Decimals(1) }
      )

      const increaseLiquidityData = nft.interface.encodeFunctionData('increaseLiquidity', [
        {
          tokenId: tokenId,
          amount0Desired: 100,
          amount1Desired: 100,
          amount0Min: 0,
          amount1Min: 0,
          deadline: 1,
        },
      ])
      const increaseLiquidityParameters = [increaseLiquidityData, refundETHData]
      const { eat: increaseLiquidityEat, expiry: increaseLiquidityExpiry } = await generateAccessTokenForMulticall(
        signer,
        domain,
        wallet,
        nft,
        increaseLiquidityParameters
      )

      await nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](
        increaseLiquidityEat.v,
        increaseLiquidityEat.r,
        increaseLiquidityEat.s,
        increaseLiquidityExpiry,
        increaseLiquidityParameters,
        { value: expandTo18Decimals(1) }
      )
    })

    it('gas', async () => {
      const increasesLiquidityParams = {
        tokenId: tokenId,
        amount0Desired: 100,
        amount1Desired: 100,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      }
      const multicallParameters = [nft.interface.encodeFunctionData('increaseLiquidity', [increasesLiquidityParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, wallet, nft, multicallParameters)

      await snapshotGasCost(
        nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, multicallParameters)
      )
    })
  })

  describe('#decreaseLiquidity', () => {
    const tokenId = 1
    beforeEach('create a position', async () => {
      await createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )

      const mintParams = {
        token0: tokens[0].address,
        token1: tokens[1].address,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        fee: FeeAmount.MEDIUM,
        recipient: other.address,
        amount0Desired: 100,
        amount1Desired: 100,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      }

      const multicallParameters = [nft.interface.encodeFunctionData('mint', [mintParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, wallet, nft, multicallParameters)
      await nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, multicallParameters)
    })

    it('emits an event')

    it('fails if past deadline', async () => {
      await nft.setTime(2)

      const decreaseLiquidityParams = {
        tokenId: tokenId,
        liquidity: 50,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      }
      const multicallParameters = [nft.interface.encodeFunctionData('decreaseLiquidity', [decreaseLiquidityParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, other, nft, multicallParameters)

      await expect(
        nft
          .connect(other)
          ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, multicallParameters)
      ).to.be.revertedWith('Transaction too old')
    })

    it('cannot be called by other addresses', async () => {
      const decreaseLiquidityParams = {
        tokenId: tokenId,
        liquidity: 50,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      }
      const multicallParameters = [nft.interface.encodeFunctionData('decreaseLiquidity', [decreaseLiquidityParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, wallet, nft, multicallParameters)

      await expect(
        nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, multicallParameters)
      ).to.be.revertedWith('NA')
    })

    it('decreases position liquidity', async () => {
      const decreaseLiquidityParams = {
        tokenId: tokenId,
        liquidity: 25,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      }
      const multicallParameters = [nft.interface.encodeFunctionData('decreaseLiquidity', [decreaseLiquidityParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, other, nft, multicallParameters)

      await nft
        .connect(other)
        ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, multicallParameters)
      const { liquidity } = await nft.positions(tokenId)
      expect(liquidity).to.eq(75)
    })

    it('should not decreaseLiquidity with EAT when in emergency mode', async () => {
      const decreaseLiquidityParams = {
        tokenId: tokenId,
        liquidity: 25,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      }
      const multicallParameters = [nft.interface.encodeFunctionData('decreaseLiquidity', [decreaseLiquidityParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, other, nft, multicallParameters)

      await nft.setEmergencyMode(true)
      await expect(
        nft
          .connect(other)
          ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, multicallParameters)
      ).to.be.reverted
    })

    it('should decreaseLiquidity with EAT after disabling emergency mode', async () => {
      const decreaseLiquidityParams = {
        tokenId: tokenId,
        liquidity: 25,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      }
      const multicallParameters = [nft.interface.encodeFunctionData('decreaseLiquidity', [decreaseLiquidityParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, other, nft, multicallParameters)

      await nft.setEmergencyMode(true)

      await nft.setEmergencyMode(false)
      await nft
        .connect(other)
        ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, multicallParameters)
      const { liquidity } = await nft.positions(tokenId)
      expect(liquidity).to.eq(75)
    })

    it('should decreaseLiquidity with VID when in emergency mode', async () => {
      const decreaseLiquidityParams = {
        tokenId: tokenId,
        liquidity: 25,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      }
      await violetID.grantStatus(other.address, MAUVE_VERIFIED_ACCOUNT_TOKEN_ID, '0x00')
      expect(await violetID.hasMauveVerificationStatus(other.address)).to.be.true
      await nft.setEmergencyMode(true)

      await expect(nft.connect(other).decreaseLiquidity(decreaseLiquidityParams)).to.not.be.reverted
    })

    it('should decreaseLiquidity with another VID when in emergency mode', async () => {
      const decreaseLiquidityParams = {
        tokenId: tokenId,
        liquidity: 25,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      }
      await violetID.grantStatus(other.address, MAUVE_VERIFIED_PARTNER_APP_TOKEN_ID, '0x00')
      expect(await violetID.hasStatus(other.address, MAUVE_VERIFIED_PARTNER_APP_TOKEN_ID)).to.be.true
      await nft.setEmergencyMode(true)

      await expect(nft.connect(other).decreaseLiquidity(decreaseLiquidityParams)).to.not.be.reverted
    })

    // @TODO: Discuss if multicall should be payable and checking if subsequent calls receive the value
    it('is payable', async () => {
      const decreaseLiquidityParams = {
        tokenId: tokenId,
        liquidity: 25,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      }
      const multicallParameters = [nft.interface.encodeFunctionData('decreaseLiquidity', [decreaseLiquidityParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, other, nft, multicallParameters)

      await nft
        .connect(other)
        ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, multicallParameters, {
          value: 1,
        })
    })

    it('accounts for tokens owed', async () => {
      const decreaseLiquidityParams = {
        tokenId: tokenId,
        liquidity: 25,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      }
      const multicallParameters = [nft.interface.encodeFunctionData('decreaseLiquidity', [decreaseLiquidityParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, other, nft, multicallParameters)

      await nft
        .connect(other)
        ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, multicallParameters)
      const { tokensOwed0, tokensOwed1 } = await nft.positions(tokenId)
      expect(tokensOwed0).to.eq(24)
      expect(tokensOwed1).to.eq(24)
    })

    it('can decrease for all the liquidity', async () => {
      const decreaseLiquidityParams = {
        tokenId: tokenId,
        liquidity: 100,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      }
      const multicallParameters = [nft.interface.encodeFunctionData('decreaseLiquidity', [decreaseLiquidityParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, other, nft, multicallParameters)

      await nft
        .connect(other)
        ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, multicallParameters)
      const { liquidity } = await nft.positions(tokenId)
      expect(liquidity).to.eq(0)
    })

    it('cannot decrease for more than all the liquidity', async () => {
      const decreaseLiquidityParams = {
        tokenId: tokenId,
        liquidity: 101,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      }
      const multicallParameters = [nft.interface.encodeFunctionData('decreaseLiquidity', [decreaseLiquidityParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, other, nft, multicallParameters)

      await expect(
        nft
          .connect(other)
          ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, multicallParameters)
      ).to.be.reverted
    })

    it('cannot decrease for more than the liquidity of the nft position', async () => {
      const mintParams = {
        token0: tokens[0].address,
        token1: tokens[1].address,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        fee: FeeAmount.MEDIUM,
        recipient: other.address,
        amount0Desired: 200,
        amount1Desired: 200,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      }
      const multicallParameters = [nft.interface.encodeFunctionData('mint', [mintParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, wallet, nft, multicallParameters)

      await nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, multicallParameters)

      const decreaseLiquidityParams = {
        tokenId: tokenId,
        liquidity: 101,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      }
      const multicallParametersDecrease = [
        nft.interface.encodeFunctionData('decreaseLiquidity', [decreaseLiquidityParams]),
      ]
      const { eat: decreaseEat, expiry: decreaseExpiry } = await generateAccessTokenForMulticall(
        signer,
        domain,
        other,
        nft,
        multicallParametersDecrease
      )

      await expect(
        nft
          .connect(other)
          ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](
            decreaseEat.v,
            decreaseEat.r,
            decreaseEat.s,
            decreaseExpiry,
            multicallParametersDecrease
          )
      ).to.be.reverted
    })

    it('gas partial decrease', async () => {
      const decreaseLiquidityParams = {
        tokenId: tokenId,
        liquidity: 50,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      }
      const multicallParameters = [nft.interface.encodeFunctionData('decreaseLiquidity', [decreaseLiquidityParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, other, nft, multicallParameters)
      await snapshotGasCost(
        nft
          .connect(other)
          ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, multicallParameters)
      )
    })

    it('gas complete decrease', async () => {
      const decreaseLiquidityParams = {
        tokenId: tokenId,
        liquidity: 100,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      }
      const multicallParameters = [nft.interface.encodeFunctionData('decreaseLiquidity', [decreaseLiquidityParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, other, nft, multicallParameters)
      await snapshotGasCost(
        nft
          .connect(other)
          ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, multicallParameters)
      )
    })
  })

  describe('#collect', () => {
    const tokenId = 1
    const prologueToCollect = async (tokenId_ = tokenId, caller = other, liquidity = 50) => {
      const decreaseLiquidityParams = {
        tokenId: tokenId_,
        liquidity,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      }
      const decreaseMulticallParameters = [
        nft.interface.encodeFunctionData('decreaseLiquidity', [decreaseLiquidityParams]),
      ]
      const { eat: decreaseEat, expiry: decreaseExpiry } = await generateAccessTokenForMulticall(
        signer,
        domain,
        caller,
        nft,
        decreaseMulticallParameters
      )
      await nft
        .connect(caller)
        ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](
          decreaseEat.v,
          decreaseEat.r,
          decreaseEat.s,
          decreaseExpiry,
          decreaseMulticallParameters
        )
    }
    beforeEach('create a position', async () => {
      await createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )

      const mintParams = {
        token0: tokens[0].address,
        token1: tokens[1].address,
        fee: FeeAmount.MEDIUM,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        recipient: other.address,
        amount0Desired: 100,
        amount1Desired: 100,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      }

      const multicallParameters = [nft.interface.encodeFunctionData('mint', [mintParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, wallet, nft, multicallParameters)

      await nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, multicallParameters)
    })

    it('emits an event')

    it('cannot be called by other addresses through multicall', async () => {
      await prologueToCollect()
      const collectParams = {
        tokenId: tokenId,
        recipient: wallet.address,
        amount0Max: MaxUint128,
        amount1Max: MaxUint128,
      }

      const parameters = [nft.interface.encodeFunctionData('collect', [collectParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, wallet, nft, parameters)
      await expect(
        nft.connect(wallet)['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, parameters)
      ).to.be.revertedWith('NA')
    })

    it('cannot be called with 0 for both amounts', async () => {
      const collectParams = {
        tokenId: tokenId,
        recipient: wallet.address,
        amount0Max: 0,
        amount1Max: 0,
      }
      const parameters = [nft.connect(other).interface.encodeFunctionData('collect', [collectParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, other, nft, parameters)

      await expect(
        nft.connect(other)['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, parameters)
      ).to.be.reverted
    })

    it('no op if no tokens are owed', async () => {
      const collectParams = {
        tokenId: tokenId,
        recipient: wallet.address,
        amount0Max: MaxUint128,
        amount1Max: MaxUint128,
      }
      const parameters = [nft.connect(other).interface.encodeFunctionData('collect', [collectParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, other, nft, parameters)

      await expect(
        nft.connect(other)['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, parameters)
      )
        .to.not.emit(tokens[0], 'Transfer')
        .to.not.emit(tokens[1], 'Transfer')
    })

    it('transfers tokens owed from burn', async () => {
      await prologueToCollect()

      const poolAddress = computePoolAddress(factory.address, [tokens[0].address, tokens[1].address], FeeAmount.MEDIUM)
      const collectParams = {
        tokenId: tokenId,
        recipient: wallet.address,
        amount0Max: MaxUint128,
        amount1Max: MaxUint128,
      }

      const parameters = [nft.connect(other).interface.encodeFunctionData('collect', [collectParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, other, nft, parameters)
      await expect(
        nft.connect(other)['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, parameters)
      )
        .to.emit(tokens[0], 'Transfer')
        .withArgs(poolAddress, wallet.address, 49)
        .to.emit(tokens[1], 'Transfer')
        .withArgs(poolAddress, wallet.address, 49)
    })

    it('returns amount values from collect without EAT', async () => {
      await prologueToCollect()

      const collectParams = {
        tokenId: tokenId,
        recipient: wallet.address,
        amount0Max: MaxUint128,
        amount1Max: MaxUint128,
      }

      let ABI = ['function CollectAmounts(uint256 amount0, uint256 amount1)']

      let iface = new ethers.utils.Interface(ABI)
      const expectedError = iface.encodeFunctionData('CollectAmounts', [49, 49])
      const mock = await ethers.getContractAt('CollectAmountsTest', nft.address)

      nft
        .connect(other)
        .callStatic.collectAmounts(collectParams)
        .then((tx) => {
          console.log('******* THIS SHOULD NOT HAPPEN ********')
          console.log(tx)
          expect(true).to.be.equal(false)
        })
        .catch((txError) => {
          const errorData = txError.data
          expect(errorData).to.be.equal(expectedError)
        })

      await expect(nft.connect(other).callStatic.collectAmounts(collectParams)).to.be.revertedWithCustomError(
        mock,
        'CollectAmounts'
      )
    })

    it('should not collect with EAT when in emergency mode', async () => {
      await prologueToCollect()

      const collectParams = {
        tokenId: tokenId,
        recipient: wallet.address,
        amount0Max: MaxUint128,
        amount1Max: MaxUint128,
      }

      const parameters = [nft.connect(other).interface.encodeFunctionData('collect', [collectParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, other, nft, parameters)
      await nft.setEmergencyMode(true)
      await expect(
        nft.connect(other)['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, parameters)
      ).to.be.reverted
    })

    it('should collect with EAT after disabling emergency mode', async () => {
      await prologueToCollect()

      const collectParams = {
        tokenId: tokenId,
        recipient: wallet.address,
        amount0Max: MaxUint128,
        amount1Max: MaxUint128,
      }

      const balanceToken0Before = await tokens[0].balanceOf(wallet.address)
      const balanceToken1Before = await tokens[1].balanceOf(wallet.address)

      const parameters = [nft.connect(other).interface.encodeFunctionData('collect', [collectParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, other, nft, parameters)
      await nft.setEmergencyMode(true)

      await nft.setEmergencyMode(false)
      await expect(
        nft.connect(other)['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, parameters)
      ).to.not.be.reverted
      const balanceToken0After = await tokens[0].balanceOf(wallet.address)
      const balanceToken1After = await tokens[1].balanceOf(wallet.address)

      expect(balanceToken0After).to.eq(balanceToken0Before.add(49))
      expect(balanceToken1After).to.eq(balanceToken1Before.add(49))
    })

    it('should collect with VID while in emergency mode', async () => {
      await prologueToCollect()

      await violetID.grantStatus(other.address, MAUVE_VERIFIED_ACCOUNT_TOKEN_ID, '0x00')
      expect(await violetID.hasMauveVerificationStatus(other.address)).to.be.true
      await nft.setEmergencyMode(true)
      const collectParams = {
        tokenId: tokenId,
        recipient: wallet.address,
        amount0Max: MaxUint128,
        amount1Max: MaxUint128,
      }
      await expect(nft.connect(other).collect(collectParams)).to.not.be.reverted
    })

    it('should collect with another VID approved token while in emergency mode', async () => {
      await prologueToCollect()

      await violetID.grantStatus(other.address, MAUVE_VERIFIED_PARTNER_APP_TOKEN_ID, '0x00')
      expect(await violetID.hasStatus(other.address, MAUVE_VERIFIED_PARTNER_APP_TOKEN_ID)).to.be.true
      await nft.setEmergencyMode(true)
      const collectParams = {
        tokenId: tokenId,
        recipient: wallet.address,
        amount0Max: MaxUint128,
        amount1Max: MaxUint128,
      }
      await expect(nft.connect(other).collect(collectParams)).to.not.be.reverted
    })

    it('should not collect with VID while not in emergency mode', async () => {
      await prologueToCollect()

      await violetID.grantStatus(other.address, MAUVE_VERIFIED_ACCOUNT_TOKEN_ID, '0x00')
      expect(await violetID.hasMauveVerificationStatus(other.address)).to.be.true
      const collectParams = {
        tokenId: tokenId,
        recipient: wallet.address,
        amount0Max: MaxUint128,
        amount1Max: MaxUint128,
      }
      await expect(nft.connect(other).collect(collectParams)).to.be.reverted
    })

    it('should not let tokens with arbitrary callbacks on transfer re-enter', async () => {
      const oneHundredETH = ethers.utils.parseEther('100')

      // #### SETUP ####
      // # Create Pool
      await createAndInitializePoolIfNecessary(
        tokens[0].address,
        reentrantToken.address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )
      // # Mint
      const mintParams = {
        token0: tokens[0].address,
        token1: reentrantToken.address,
        fee: FeeAmount.MEDIUM,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        recipient: wallet.address,
        amount0Desired: 100,
        amount1Desired: 100,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      }
      const multicallParameters = [nft.interface.encodeFunctionData('mint', [mintParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, wallet, nft, multicallParameters)
      // Mint position and send extra ETH along with it
      await nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, multicallParameters, {
        value: oneHundredETH,
      })
      expect(await nft.ownerOf(2)).to.eq(wallet.address)

      // # Decrease liquidity, increase tokens owed
      await prologueToCollect(2, wallet)

      await nft.connect(wallet).setApprovalForAll(reentrantToken.address, true)

      // #### COLLECT ####
      const collectParams = {
        tokenId: 2,
        recipient: wallet.address,
        amount0Max: MaxUint128,
        amount1Max: MaxUint128,
      }

      const parameters = [nft.interface.encodeFunctionData('collect', [collectParams])]
      const { eat: eat1, expiry: expiry1 } = await generateAccessTokenForMulticall(
        signer,
        domain,
        wallet,
        nft,
        parameters
      )

      // When called to transfer the fees to collect, the TestERC20Reentrant tries to re-enter the NonfungiblePositionManager contract,
      // calling burn() to burn token with ID 2. It is expected that 'UNC' (unexpected number of calls) is caught as revert reasoned and logged,
      //  without re-entrancy protection this would emit 'NC' since the position is not cleared yet.
      await expect(
        nft
          .connect(wallet)
          ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat1.v, eat1.r, eat1.s, expiry1, parameters)
      )
        .to.emit(reentrantToken, 'CustomError')
        .withArgs('UNC')
    })

    it('gas transfers both', async () => {
      const decreaseLiquidityParams = {
        tokenId: tokenId,
        liquidity: 50,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      }
      const decreaseMulticallParameters = [
        nft.interface.encodeFunctionData('decreaseLiquidity', [decreaseLiquidityParams]),
      ]
      const { eat: decreaseEat, expiry: decreaseExpiry } = await generateAccessTokenForMulticall(
        signer,
        domain,
        other,
        nft,
        decreaseMulticallParameters
      )
      await nft
        .connect(other)
        ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](
          decreaseEat.v,
          decreaseEat.r,
          decreaseEat.s,
          decreaseExpiry,
          decreaseMulticallParameters
        )

      const collectParams = {
        tokenId: tokenId,
        recipient: wallet.address,
        amount0Max: MaxUint128,
        amount1Max: MaxUint128,
      }
      const parameters = [nft.connect(other).interface.encodeFunctionData('collect', [collectParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, other, nft, parameters)
      await snapshotGasCost(
        nft.connect(other)['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, parameters)
      )
    })

    it('gas transfers token0 only', async () => {
      const decreaseLiquidityParams = {
        tokenId: tokenId,
        liquidity: 50,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      }
      const decreaseMulticallParameters = [
        nft.interface.encodeFunctionData('decreaseLiquidity', [decreaseLiquidityParams]),
      ]
      const { eat: decreaseEat, expiry: decreaseExpiry } = await generateAccessTokenForMulticall(
        signer,
        domain,
        other,
        nft,
        decreaseMulticallParameters
      )
      await nft
        .connect(other)
        ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](
          decreaseEat.v,
          decreaseEat.r,
          decreaseEat.s,
          decreaseExpiry,
          decreaseMulticallParameters
        )
      const collectParams = {
        tokenId: tokenId,
        recipient: wallet.address,
        amount0Max: MaxUint128,
        amount1Max: 0,
      }
      const parameters = [nft.connect(other).interface.encodeFunctionData('collect', [collectParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, other, nft, parameters)
      await snapshotGasCost(
        nft.connect(other)['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, parameters)
      )
    })

    it('gas transfers token1 only', async () => {
      const decreaseLiquidityParams = {
        tokenId: tokenId,
        liquidity: 50,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      }
      const decreaseMulticallParameters = [
        nft.interface.encodeFunctionData('decreaseLiquidity', [decreaseLiquidityParams]),
      ]
      const { eat: decreaseEat, expiry: decreaseExpiry } = await generateAccessTokenForMulticall(
        signer,
        domain,
        other,
        nft,
        decreaseMulticallParameters
      )
      await nft
        .connect(other)
        ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](
          decreaseEat.v,
          decreaseEat.r,
          decreaseEat.s,
          decreaseExpiry,
          decreaseMulticallParameters
        )

      const collectParams = {
        tokenId: tokenId,
        recipient: wallet.address,
        amount0Max: 0,
        amount1Max: MaxUint128,
      }
      const parameters = [nft.connect(other).interface.encodeFunctionData('collect', [collectParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, other, nft, parameters)
      await snapshotGasCost(
        nft.connect(other)['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, parameters)
      )
    })
  })

  describe('#burn', () => {
    const tokenId = 1
    const prologueToBurn = async () => {
      const decreaseLiquidityParams = {
        tokenId: tokenId,
        liquidity: 100,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      }
      const decreaseMulticallParameters = [
        nft.interface.encodeFunctionData('decreaseLiquidity', [decreaseLiquidityParams]),
      ]
      const { eat: decreaseEat, expiry: decreaseExpiry } = await generateAccessTokenForMulticall(
        signer,
        domain,
        other,
        nft,
        decreaseMulticallParameters
      )
      await nft
        .connect(other)
        ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](
          decreaseEat.v,
          decreaseEat.r,
          decreaseEat.s,
          decreaseExpiry,
          decreaseMulticallParameters
        )

      const collectParams = {
        tokenId: tokenId,
        recipient: wallet.address,
        amount0Max: MaxUint128,
        amount1Max: MaxUint128,
      }
      const parameters = [nft.connect(other).interface.encodeFunctionData('collect', [collectParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, other, nft, parameters)
      await nft
        .connect(other)
        ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, parameters)
    }
    beforeEach('create a position', async () => {
      await createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )

      const mintParams = {
        token0: tokens[0].address,
        token1: tokens[1].address,
        fee: FeeAmount.MEDIUM,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        recipient: other.address,
        amount0Desired: 100,
        amount1Desired: 100,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      }

      const multicallParameters = [nft.interface.encodeFunctionData('mint', [mintParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, wallet, nft, multicallParameters)

      await nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, multicallParameters)
    })

    it('emits an event')

    it('cannot be called by other addresses', async () => {
      const burnParams = tokenId
      const multicallParameters = [nft.interface.encodeFunctionData('burn', [burnParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, wallet, nft, multicallParameters)
      await expect(
        nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, multicallParameters)
      ).to.be.revertedWith('NA')
    })

    it('cannot be called while there is still liquidity', async () => {
      const burnParams = tokenId
      const multicallParameters = [nft.connect(other).interface.encodeFunctionData('burn', [burnParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, other, nft, multicallParameters)
      await expect(
        nft
          .connect(other)
          ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, multicallParameters)
      ).to.be.revertedWith('NC')
    })

    it('cannot be called while there is still partial liquidity', async () => {
      const decreaseLiquidityParams = {
        tokenId: tokenId,
        liquidity: 50,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      }
      const decreaseMulticallParameters = [
        nft.interface.encodeFunctionData('decreaseLiquidity', [decreaseLiquidityParams]),
      ]
      const { eat: decreaseEat, expiry: decreaseExpiry } = await generateAccessTokenForMulticall(
        signer,
        domain,
        other,
        nft,
        decreaseMulticallParameters
      )
      await nft
        .connect(other)
        ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](
          decreaseEat.v,
          decreaseEat.r,
          decreaseEat.s,
          decreaseExpiry,
          decreaseMulticallParameters
        )

      const burnParams = tokenId
      const multicallParameters = [nft.connect(other).interface.encodeFunctionData('burn', [burnParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, other, nft, multicallParameters)
      await expect(
        nft
          .connect(other)
          ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, multicallParameters)
      ).to.be.revertedWith('NC')
    })

    it('cannot be called while there is still tokens owed', async () => {
      const decreaseLiquidityParams = {
        tokenId: tokenId,
        liquidity: 100,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      }
      const decreaseMulticallParameters = [
        nft.interface.encodeFunctionData('decreaseLiquidity', [decreaseLiquidityParams]),
      ]
      const { eat: decreaseEat, expiry: decreaseExpiry } = await generateAccessTokenForMulticall(
        signer,
        domain,
        other,
        nft,
        decreaseMulticallParameters
      )
      await nft
        .connect(other)
        ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](
          decreaseEat.v,
          decreaseEat.r,
          decreaseEat.s,
          decreaseExpiry,
          decreaseMulticallParameters
        )

      const burnParams = tokenId
      const multicallParameters = [nft.connect(other).interface.encodeFunctionData('burn', [burnParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, other, nft, multicallParameters)
      await expect(
        nft
          .connect(other)
          ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, multicallParameters)
      ).to.be.revertedWith('NC')
    })

    it('burns the token', async () => {
      await prologueToBurn()
      const burnParams = tokenId
      const multicallParameters = [nft.connect(other).interface.encodeFunctionData('burn', [burnParams])]
      const { eat: burnEat, expiry: burnExpiry } = await generateAccessTokenForMulticall(
        signer,
        domain,
        other,
        nft,
        multicallParameters
      )
      await expect(
        nft
          .connect(other)
          ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](
            burnEat.v,
            burnEat.r,
            burnEat.s,
            burnExpiry,
            multicallParameters
          )
      ).to.not.be.reverted
      await expect(nft.positions(tokenId)).to.be.revertedWith('ITI')
    })

    it('should not burn with EAT while in emergency mode', async () => {
      await prologueToBurn()
      const burnParams = tokenId
      const multicallParameters = [nft.connect(other).interface.encodeFunctionData('burn', [burnParams])]
      const { eat: burnEat, expiry: burnExpiry } = await generateAccessTokenForMulticall(
        signer,
        domain,
        other,
        nft,
        multicallParameters
      )
      await nft.setEmergencyMode(true)
      await expect(
        nft
          .connect(other)
          ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](
            burnEat.v,
            burnEat.r,
            burnEat.s,
            burnExpiry,
            multicallParameters
          )
      ).to.be.reverted
    })

    it('should burn with EAT after disabling emergency mode', async () => {
      await prologueToBurn()
      const burnParams = tokenId
      const multicallParameters = [nft.connect(other).interface.encodeFunctionData('burn', [burnParams])]
      const { eat: burnEat, expiry: burnExpiry } = await generateAccessTokenForMulticall(
        signer,
        domain,
        other,
        nft,
        multicallParameters
      )
      await nft.setEmergencyMode(true)

      await nft.setEmergencyMode(false)
      await expect(
        nft
          .connect(other)
          ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](
            burnEat.v,
            burnEat.r,
            burnEat.s,
            burnExpiry,
            multicallParameters
          )
      ).to.not.be.reverted
      await expect(nft.positions(tokenId)).to.be.revertedWith('ITI')
    })

    it('should burn with VID while in emergency mode', async () => {
      await prologueToBurn()

      await violetID.grantStatus(other.address, MAUVE_VERIFIED_ACCOUNT_TOKEN_ID, '0x00')
      expect(await violetID.hasMauveVerificationStatus(other.address)).to.be.true
      await nft.setEmergencyMode(true)

      await expect(nft.connect(other).burn(tokenId)).to.not.be.reverted
    })

    it('should burn with another VID approved token while in emergency mode', async () => {
      await prologueToBurn()

      await violetID.grantStatus(other.address, MAUVE_VERIFIED_PARTNER_APP_TOKEN_ID, '0x00')
      expect(await violetID.hasStatus(other.address, MAUVE_VERIFIED_PARTNER_APP_TOKEN_ID)).to.be.true
      await nft.setEmergencyMode(true)

      await expect(nft.connect(other).burn(tokenId)).to.not.be.reverted
    })

    it('gas', async () => {
      const decreaseLiquidityParams = {
        tokenId: tokenId,
        liquidity: 100,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      }
      const decreaseMulticallParameters = [
        nft.interface.encodeFunctionData('decreaseLiquidity', [decreaseLiquidityParams]),
      ]
      const { eat: decreaseEat, expiry: decreaseExpiry } = await generateAccessTokenForMulticall(
        signer,
        domain,
        other,
        nft,
        decreaseMulticallParameters
      )
      await nft
        .connect(other)
        ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](
          decreaseEat.v,
          decreaseEat.r,
          decreaseEat.s,
          decreaseExpiry,
          decreaseMulticallParameters
        )

      const collectParams = {
        tokenId: tokenId,
        recipient: wallet.address,
        amount0Max: MaxUint128,
        amount1Max: MaxUint128,
      }
      const parameters = [nft.connect(other).interface.encodeFunctionData('collect', [collectParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, other, nft, parameters)
      await nft
        .connect(other)
        ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, parameters)
      const burnParams = tokenId
      const multicallParameters = [nft.connect(other).interface.encodeFunctionData('burn', [burnParams])]
      const { eat: burnEat, expiry: burnExpiry } = await generateAccessTokenForMulticall(
        signer,
        domain,
        other,
        nft,
        multicallParameters
      )
      await snapshotGasCost(
        await nft
          .connect(other)
          ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](
            burnEat.v,
            burnEat.r,
            burnEat.s,
            burnExpiry,
            multicallParameters
          )
      )
    })
  })

  describe('#transferFrom, approve', () => {
    const tokenId = 1
    beforeEach('create a position', async () => {
      await createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )

      // other.address is getting a LP NFT
      const mintParams = {
        token0: tokens[0].address,
        token1: tokens[1].address,
        fee: FeeAmount.MEDIUM,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        recipient: other.address,
        amount0Desired: 100,
        amount1Desired: 100,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      }

      const multicallParameters = [nft.interface.encodeFunctionData('mint', [mintParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, wallet, nft, multicallParameters)

      await nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, multicallParameters)
    })

    context('approve', () => {
      it('can approve to VioletID holder without EAT', async () => {
        await violetID.grantStatus(wallet.address, MAUVE_VERIFIED_ACCOUNT_TOKEN_ID, '0x00')
        expect(await violetID.hasMauveVerificationStatus(wallet.address)).to.be.true

        await expect(nft.connect(other)['approve(address,uint256)'](wallet.address, tokenId)).to.not.be.reverted
        expect(await nft.getApproved(tokenId)).to.eq(wallet.address)
      })

      it('can approve to non VioletID holder without EAT', async () => {
        expect(await violetID.hasMauveVerificationStatus(wallet.address)).to.be.false

        await expect(nft.connect(other)['approve(address,uint256)'](wallet.address, tokenId)).to.not.be.reverted
        expect(await nft.getApproved(tokenId)).to.eq(wallet.address)
      })

      it('can setApprovalForAll to VioletID holder without EAT', async () => {
        await violetID.grantStatus(wallet.address, MAUVE_VERIFIED_ACCOUNT_TOKEN_ID, '0x00')
        expect(await violetID.hasMauveVerificationStatus(wallet.address)).to.be.true

        await expect(nft.connect(other)['setApprovalForAll(address,bool)'](wallet.address, true)).to.not.be.reverted
        expect(await nft['isApprovedForAll(address,address)'](other.address, wallet.address)).to.be.true
      })

      it('can setApprovalForAll to non VioletID holder without EAT', async () => {
        expect(await violetID.hasMauveVerificationStatus(wallet.address)).to.be.false

        await expect(nft.connect(other)['setApprovalForAll(address,bool)'](wallet.address, true)).to.not.be.reverted
        expect(await nft['isApprovedForAll(address,address)'](other.address, wallet.address)).to.be.true
      })
    })

    context('transferFrom', () => {
      context('with an EAT', () => {
        it('transferFrom can only be called by authorized or owner', async () => {
          const { eat, expiry } = await generateAccessToken(
            signer,
            domain,
            'transferFrom(uint8,bytes32,bytes32,uint256,address,address,uint256)',
            wallet,
            nft,
            [other.address, wallet.address, tokenId]
          )
          await expect(
            nft['transferFrom(uint8,bytes32,bytes32,uint256,address,address,uint256)'](
              eat.v,
              eat.r,
              eat.s,
              expiry,
              other.address,
              wallet.address,
              tokenId
            )
          ).to.be.revertedWith('ERC721: transfer caller is not owner nor approved')
        })

        it('changes the owner', async () => {
          const { eat, expiry } = await generateAccessToken(
            signer,
            domain,
            'transferFrom(uint8,bytes32,bytes32,uint256,address,address,uint256)',
            other,
            nft,
            [other.address, wallet.address, tokenId]
          )
          await nft
            .connect(other)
            ['transferFrom(uint8,bytes32,bytes32,uint256,address,address,uint256)'](
              eat.v,
              eat.r,
              eat.s,
              expiry,
              other.address,
              wallet.address,
              tokenId
            )
          expect(await nft.ownerOf(tokenId)).to.eq(wallet.address)
        })

        it('should not change owner with EAT with transferFrom in emergency mode', async () => {
          const { eat, expiry } = await generateAccessToken(
            signer,
            domain,
            'transferFrom(uint8,bytes32,bytes32,uint256,address,address,uint256)',
            other,
            nft,
            [other.address, wallet.address, tokenId]
          )
          await nft.setEmergencyMode(true)
          await expect(
            nft
              .connect(other)
              ['transferFrom(uint8,bytes32,bytes32,uint256,address,address,uint256)'](
                eat.v,
                eat.r,
                eat.s,
                expiry,
                other.address,
                wallet.address,
                tokenId
              )
          ).to.be.reverted
        })

        it('should change owner with EAT with transferFrom after disabling emergency mode', async () => {
          const { eat, expiry } = await generateAccessToken(
            signer,
            domain,
            'transferFrom(uint8,bytes32,bytes32,uint256,address,address,uint256)',
            other,
            nft,
            [other.address, wallet.address, tokenId]
          )
          await nft.setEmergencyMode(true)

          await nft.setEmergencyMode(false)

          await expect(
            nft
              .connect(other)
              ['transferFrom(uint8,bytes32,bytes32,uint256,address,address,uint256)'](
                eat.v,
                eat.r,
                eat.s,
                expiry,
                other.address,
                wallet.address,
                tokenId
              )
          ).to.not.be.reverted
          expect(await nft.ownerOf(tokenId)).to.eq(wallet.address)
        })
      })

      context('with a VID token', () => {
        it('should change owner with a VID token', async () => {
          await violetID.grantStatus(other.address, MAUVE_VERIFIED_ACCOUNT_TOKEN_ID, '0x00')
          await violetID.grantStatus(wallet.address, MAUVE_VERIFIED_ACCOUNT_TOKEN_ID, '0x00')
          expect(await violetID.hasMauveVerificationStatus(other.address)).to.be.true
          expect(await violetID.hasMauveVerificationStatus(wallet.address)).to.be.true

          await expect(
            nft.connect(other)['transferFrom(address,address,uint256)'](other.address, wallet.address, tokenId)
          ).to.not.be.reverted

          expect(await nft.ownerOf(tokenId)).to.eq(wallet.address)
        })

        it('should change owner with two VID tokens', async () => {
          await violetID.grantStatus(other.address, MAUVE_VERIFIED_ACCOUNT_TOKEN_ID, '0x00')
          await violetID.grantStatus(wallet.address, MAUVE_VERIFIED_ACCOUNT_TOKEN_ID, '0x00')
          expect(await violetID.hasMauveVerificationStatus(other.address)).to.be.true
          expect(await violetID.hasMauveVerificationStatus(wallet.address)).to.be.true
          // Grant another arbitrary Violet Token Id token to wallet.address
          await violetID.grantStatus(wallet.address, BigNumber.from(3), '0x00')
          expect(await violetID.hasStatus(wallet.address, BigNumber.from(3))).to.be.true

          await expect(
            nft.connect(other)['transferFrom(address,address,uint256)'](other.address, wallet.address, tokenId)
          ).to.not.be.reverted

          expect(await nft.ownerOf(tokenId)).to.eq(wallet.address)
        })

        it('should not change owner if `to` address does not have a VID token', async () => {
          await violetID.grantStatus(other.address, MAUVE_VERIFIED_ACCOUNT_TOKEN_ID, '0x00')
          expect(await violetID.hasMauveVerificationStatus(other.address)).to.be.true
          expect(await violetID.hasMauveVerificationStatus(wallet.address)).to.be.false

          await expect(
            nft.connect(other)['transferFrom(address,address,uint256)'](other.address, wallet.address, tokenId)
          ).to.be.reverted
          expect(await nft.ownerOf(tokenId)).to.not.eq(wallet.address)
        })

        it('should not change owner if `from` address does not have a VID token', async () => {
          await violetID.grantStatus(wallet.address, MAUVE_VERIFIED_ACCOUNT_TOKEN_ID, '0x00')
          expect(await violetID.hasMauveVerificationStatus(wallet.address)).to.be.true
          expect(await violetID.hasMauveVerificationStatus(other.address)).to.be.false

          await expect(
            nft.connect(other)['transferFrom(address,address,uint256)'](other.address, wallet.address, tokenId)
          ).to.be.reverted
          expect(await nft.ownerOf(tokenId)).to.not.eq(wallet.address)
        })

        it('should transfer with VID if emergencyMode is activated', async () => {
          await violetID.grantStatus(other.address, MAUVE_VERIFIED_ACCOUNT_TOKEN_ID, '0x00')
          await violetID.grantStatus(wallet.address, MAUVE_VERIFIED_ACCOUNT_TOKEN_ID, '0x00')
          expect(await violetID.hasMauveVerificationStatus(other.address)).to.be.true
          expect(await violetID.hasMauveVerificationStatus(wallet.address)).to.be.true

          await nft.setEmergencyMode(true)

          await expect(
            nft.connect(other)['transferFrom(address,address,uint256)'](other.address, wallet.address, tokenId)
          ).to.not.be.reverted
        })
      })
    })

    context('safeTransferFrom', () => {
      context('with an EAT', () => {
        it('safeTransferFrom can only be called by authorized or owner', async () => {
          const { eat, expiry } = await generateAccessToken(
            signer,
            domain,
            'safeTransferFrom(uint8,bytes32,bytes32,uint256,address,address,uint256)',
            wallet,
            nft,
            [other.address, wallet.address, tokenId]
          )
          await expect(
            nft['safeTransferFrom(uint8,bytes32,bytes32,uint256,address,address,uint256)'](
              eat.v,
              eat.r,
              eat.s,
              expiry,
              other.address,
              wallet.address,
              tokenId
            )
          ).to.be.revertedWith('ERC721: transfer caller is not owner nor approved')
        })

        it('should not change owner with EAT with safeTransferFrom in emergency mode', async () => {
          const { eat, expiry } = await generateAccessToken(
            signer,
            domain,
            'safeTransferFrom(uint8,bytes32,bytes32,uint256,address,address,uint256)',
            other,
            nft,
            [other.address, wallet.address, tokenId]
          )
          await nft.setEmergencyMode(true)
          await expect(
            nft
              .connect(other)
              ['safeTransferFrom(uint8,bytes32,bytes32,uint256,address,address,uint256)'](
                eat.v,
                eat.r,
                eat.s,
                expiry,
                other.address,
                wallet.address,
                tokenId
              )
          ).to.be.reverted
        })

        it('should change owner with EAT with safeTransferFrom after disabling emergency mode', async () => {
          const { eat, expiry } = await generateAccessToken(
            signer,
            domain,
            'safeTransferFrom(uint8,bytes32,bytes32,uint256,address,address,uint256)',
            other,
            nft,
            [other.address, wallet.address, tokenId]
          )
          await nft.setEmergencyMode(true)

          await nft.setEmergencyMode(false)

          await expect(
            nft
              .connect(other)
              ['safeTransferFrom(uint8,bytes32,bytes32,uint256,address,address,uint256)'](
                eat.v,
                eat.r,
                eat.s,
                expiry,
                other.address,
                wallet.address,
                tokenId
              )
          ).to.not.be.reverted
          expect(await nft.ownerOf(tokenId)).to.eq(wallet.address)
        })
      })
      context('with a VID token', () => {
        it('safeTransfer should execute with a Violet ID Token for Mauve', async () => {
          await violetID.grantStatus(other.address, MAUVE_VERIFIED_ACCOUNT_TOKEN_ID, '0x00')
          await violetID.grantStatus(wallet.address, MAUVE_VERIFIED_ACCOUNT_TOKEN_ID, '0x00')
          expect(await violetID.hasMauveVerificationStatus(other.address)).to.be.true
          expect(await violetID.hasMauveVerificationStatus(wallet.address)).to.be.true

          await expect(
            nft.connect(other)['safeTransferFrom(address,address,uint256)'](other.address, wallet.address, tokenId)
          ).to.not.be.reverted

          expect(await nft.ownerOf(tokenId)).to.eq(wallet.address)
        })

        it('safeTransfer should execute with another Violet ID Token for Mauve', async () => {
          await violetID.grantStatus(wallet.address, MAUVE_VERIFIED_PARTNER_APP_TOKEN_ID, '0x00')
          await violetID.grantStatus(other.address, MAUVE_VERIFIED_ACCOUNT_TOKEN_ID, '0x00')
          expect(await violetID.hasStatus(wallet.address, MAUVE_VERIFIED_ACCOUNT_TOKEN_ID)).to.be.false
          expect(await violetID.hasStatus(wallet.address, MAUVE_VERIFIED_PARTNER_APP_TOKEN_ID)).to.be.true
          expect(await violetID.hasMauveVerificationStatus(other.address)).to.be.true

          await expect(
            nft.connect(other)['safeTransferFrom(address,address,uint256)'](other.address, wallet.address, tokenId)
          ).to.not.be.reverted

          expect(await nft.ownerOf(tokenId)).to.eq(wallet.address)
        })

        it('safeTransfer should revert if `from` address does not have a VID token', async () => {
          await violetID.grantStatus(wallet.address, MAUVE_VERIFIED_ACCOUNT_TOKEN_ID, '0x00')
          expect(await violetID.hasMauveVerificationStatus(wallet.address)).to.be.true
          expect(await violetID.hasMauveVerificationStatus(other.address)).to.be.false

          await expect(
            nft.connect(other)['safeTransferFrom(address,address,uint256)'](other.address, wallet.address, tokenId)
          ).to.be.reverted
          expect(await nft.ownerOf(tokenId)).to.not.eq(wallet.address)
        })

        it('safeTransfer should revert if `to` address does not have a VID token', async () => {
          await violetID.grantStatus(other.address, MAUVE_VERIFIED_ACCOUNT_TOKEN_ID, '0x00')
          expect(await violetID.hasMauveVerificationStatus(other.address)).to.be.true
          expect(await violetID.hasMauveVerificationStatus(wallet.address)).to.be.false

          await expect(
            nft.connect(other)['safeTransferFrom(address,address,uint256)'](other.address, wallet.address, tokenId)
          ).to.be.reverted
          expect(await nft.ownerOf(tokenId)).to.not.eq(wallet.address)
        })

        it('safeTransfer should execute even if emergencyMode is activated', async () => {
          await violetID.grantStatus(other.address, MAUVE_VERIFIED_ACCOUNT_TOKEN_ID, '0x00')
          await violetID.grantStatus(wallet.address, MAUVE_VERIFIED_ACCOUNT_TOKEN_ID, '0x00')

          await nft.setEmergencyMode(true)

          await expect(
            nft.connect(other)['safeTransferFrom(address,address,uint256)'](other.address, wallet.address, tokenId)
          ).to.not.be.reverted
          expect(await nft.ownerOf(tokenId)).to.eq(wallet.address)
        })
      })
    })

    it('removes existing approval', async () => {
      await nft.connect(other)['approve(address,uint256)'](wallet.address, tokenId)
      expect(await nft.getApproved(tokenId)).to.eq(wallet.address)
      const { eat, expiry } = await generateAccessToken(
        signer,
        domain,
        'transferFrom(uint8,bytes32,bytes32,uint256,address,address,uint256)',
        wallet,
        nft,
        [other.address, wallet.address, tokenId]
      )
      await nft['transferFrom(uint8,bytes32,bytes32,uint256,address,address,uint256)'](
        eat.v,
        eat.r,
        eat.s,
        expiry,
        other.address,
        wallet.address,
        tokenId
      )
      expect(await nft.getApproved(tokenId)).to.eq(constants.AddressZero)
    })

    it('gas', async () => {
      const { eat, expiry } = await generateAccessToken(
        signer,
        domain,
        'transferFrom(uint8,bytes32,bytes32,uint256,address,address,uint256)',
        other,
        nft,
        [other.address, wallet.address, tokenId]
      )
      await snapshotGasCost(
        nft
          .connect(other)
          ['transferFrom(uint8,bytes32,bytes32,uint256,address,address,uint256)'](
            eat.v,
            eat.r,
            eat.s,
            expiry,
            other.address,
            wallet.address,
            tokenId
          )
      )
    })

    it('gas comes from approved', async () => {
      await nft.connect(other)['approve(address,uint256)'](wallet.address, tokenId)
      const { eat, expiry } = await generateAccessToken(
        signer,
        domain,
        'transferFrom(uint8,bytes32,bytes32,uint256,address,address,uint256)',
        wallet,
        nft,
        [other.address, wallet.address, tokenId]
      )
      await snapshotGasCost(
        nft['transferFrom(uint8,bytes32,bytes32,uint256,address,address,uint256)'](
          eat.v,
          eat.r,
          eat.s,
          expiry,
          other.address,
          wallet.address,
          tokenId
        )
      )
    })
  })

  describe('#permit', () => {
    it('emits an event')

    describe('owned by eoa', () => {
      const tokenId = 1
      beforeEach('create a position', async () => {
        await createAndInitializePoolIfNecessary(
          tokens[0].address,
          tokens[1].address,
          FeeAmount.MEDIUM,
          encodePriceSqrt(1, 1)
        )

        const mintParams = {
          token0: tokens[0].address,
          token1: tokens[1].address,
          fee: FeeAmount.MEDIUM,
          tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          recipient: other.address,
          amount0Desired: 100,
          amount1Desired: 100,
          amount0Min: 0,
          amount1Min: 0,
          deadline: 1,
        }

        const multicallParameters = [nft.interface.encodeFunctionData('mint', [mintParams])]
        const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, wallet, nft, multicallParameters)

        await nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, multicallParameters)
      })

      it('changes the operator of the position and increments the nonce', async () => {
        const { v, r, s } = await getPermitNFTSignature(other, nft, wallet.address, tokenId, 1)
        await nft.permit(wallet.address, tokenId, 1, v, r, s)
        expect((await nft.positions(tokenId)).nonce).to.eq(1)
        expect((await nft.positions(tokenId)).operator).to.eq(wallet.address)
      })

      it('cannot be called twice with the same signature', async () => {
        const { v, r, s } = await getPermitNFTSignature(other, nft, wallet.address, tokenId, 1)
        await nft.permit(wallet.address, tokenId, 1, v, r, s)
        await expect(nft.permit(wallet.address, tokenId, 1, v, r, s)).to.be.reverted
      })

      it('fails with invalid signature', async () => {
        const { v, r, s } = await getPermitNFTSignature(wallet, nft, wallet.address, tokenId, 1)
        await expect(nft.permit(wallet.address, tokenId, 1, v + 3, r, s)).to.be.revertedWith('Invalid signature')
      })

      it('fails with signature not from owner', async () => {
        const { v, r, s } = await getPermitNFTSignature(wallet, nft, wallet.address, tokenId, 1)
        await expect(nft.permit(wallet.address, tokenId, 1, v, r, s)).to.be.revertedWith('Unauthorized')
      })

      it('fails with expired signature', async () => {
        await nft.setTime(2)
        const { v, r, s } = await getPermitNFTSignature(other, nft, wallet.address, tokenId, 1)
        await expect(nft.permit(wallet.address, tokenId, 1, v, r, s)).to.be.revertedWith('Permit expired')
      })

      it('gas', async () => {
        const { v, r, s } = await getPermitNFTSignature(other, nft, wallet.address, tokenId, 1)
        await snapshotGasCost(nft.permit(wallet.address, tokenId, 1, v, r, s))
      })
    })
    describe('owned by verifying contract', () => {
      const tokenId = 1
      let testPositionNFTOwner: TestPositionNFTOwner

      beforeEach('deploy test owner and create a position', async () => {
        testPositionNFTOwner = (await (
          await ethers.getContractFactory('TestPositionNFTOwner')
        ).deploy()) as TestPositionNFTOwner

        await createAndInitializePoolIfNecessary(
          tokens[0].address,
          tokens[1].address,
          FeeAmount.MEDIUM,
          encodePriceSqrt(1, 1)
        )

        const mintParams = {
          token0: tokens[0].address,
          token1: tokens[1].address,
          fee: FeeAmount.MEDIUM,
          tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          recipient: testPositionNFTOwner.address,
          amount0Desired: 100,
          amount1Desired: 100,
          amount0Min: 0,
          amount1Min: 0,
          deadline: 1,
        }

        const multicallParameters = [nft.interface.encodeFunctionData('mint', [mintParams])]
        const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, wallet, nft, multicallParameters)

        await nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, multicallParameters)
      })

      it('changes the operator of the position and increments the nonce', async () => {
        const { v, r, s } = await getPermitNFTSignature(other, nft, wallet.address, tokenId, 1)
        await testPositionNFTOwner.setOwner(other.address)
        await nft.permit(wallet.address, tokenId, 1, v, r, s)
        expect((await nft.positions(tokenId)).nonce).to.eq(1)
        expect((await nft.positions(tokenId)).operator).to.eq(wallet.address)
      })

      it('fails if owner contract is owned by different address', async () => {
        const { v, r, s } = await getPermitNFTSignature(other, nft, wallet.address, tokenId, 1)
        await testPositionNFTOwner.setOwner(wallet.address)
        await expect(nft.permit(wallet.address, tokenId, 1, v, r, s)).to.be.revertedWith('Unauthorized')
      })

      it('fails with signature not from owner', async () => {
        const { v, r, s } = await getPermitNFTSignature(wallet, nft, wallet.address, tokenId, 1)
        await testPositionNFTOwner.setOwner(other.address)
        await expect(nft.permit(wallet.address, tokenId, 1, v, r, s)).to.be.revertedWith('Unauthorized')
      })

      it('fails with expired signature', async () => {
        await nft.setTime(2)
        const { v, r, s } = await getPermitNFTSignature(other, nft, wallet.address, tokenId, 1)
        await testPositionNFTOwner.setOwner(other.address)
        await expect(nft.permit(wallet.address, tokenId, 1, v, r, s)).to.be.revertedWith('Permit expired')
      })

      it('gas', async () => {
        const { v, r, s } = await getPermitNFTSignature(other, nft, wallet.address, tokenId, 1)
        await testPositionNFTOwner.setOwner(other.address)
        await snapshotGasCost(nft.permit(wallet.address, tokenId, 1, v, r, s))
      })
    })
  })

  describe('multicall exit', () => {
    const tokenId = 1
    beforeEach('create a position', async () => {
      await createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )

      const mintParams = {
        token0: tokens[0].address,
        token1: tokens[1].address,
        fee: FeeAmount.MEDIUM,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        recipient: other.address,
        amount0Desired: 100,
        amount1Desired: 100,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      }

      const multicallParameters = [nft.interface.encodeFunctionData('mint', [mintParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, wallet, nft, multicallParameters)

      await nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, multicallParameters)
    })

    async function exit({
      nft,
      liquidity,
      tokenId,
      amount0Min,
      amount1Min,
      recipient,
    }: {
      nft: MockTimeNonfungiblePositionManager
      tokenId: BigNumberish
      liquidity: BigNumberish
      amount0Min: BigNumberish
      amount1Min: BigNumberish
      recipient: string
    }) {
      const decreaseLiquidityData = nft.interface.encodeFunctionData('decreaseLiquidity', [
        { tokenId, liquidity, amount0Min, amount1Min, deadline: 1 },
      ])
      const collectData = nft.interface.encodeFunctionData('collect', [
        {
          tokenId,
          recipient,
          amount0Max: MaxUint128,
          amount1Max: MaxUint128,
        },
      ])
      const burnData = nft.interface.encodeFunctionData('burn', [tokenId])

      const parameters = [decreaseLiquidityData, collectData, burnData]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, other, nft, parameters)

      return nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, parameters)
    }

    it('executes all the actions', async () => {
      const pool = poolAtAddress(
        computePoolAddress(factory.address, [tokens[0].address, tokens[1].address], FeeAmount.MEDIUM),
        wallet
      )
      await expect(
        exit({
          nft: nft.connect(other),
          tokenId,
          liquidity: 100,
          amount0Min: 0,
          amount1Min: 0,
          recipient: wallet.address,
        })
      )
        .to.emit(pool, 'Burn')
        .to.emit(pool, 'Collect')
    })

    it('gas', async () => {
      await snapshotGasCost(
        exit({
          nft: nft.connect(other),
          tokenId,
          liquidity: 100,
          amount0Min: 0,
          amount1Min: 0,
          recipient: wallet.address,
        })
      )
    })
  })

  describe('#tokenURI', async () => {
    const tokenId = 1
    beforeEach('create a position', async () => {
      await createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )

      const mintParams = {
        token0: tokens[0].address,
        token1: tokens[1].address,
        fee: FeeAmount.MEDIUM,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        recipient: other.address,
        amount0Desired: 100,
        amount1Desired: 100,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      }

      const multicallParameters = [nft.interface.encodeFunctionData('mint', [mintParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, wallet, nft, multicallParameters)

      await nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, multicallParameters)
    })

    it('reverts for invalid token id', async () => {
      await expect(nft.tokenURI(tokenId + 1)).to.be.reverted
    })

    it('returns a data URI with correct mime type', async () => {
      expect(await nft.tokenURI(tokenId)).to.match(/data:application\/json;base64,.+/)
    })

    it('content is valid JSON and structure', async () => {
      const content = extractJSONFromURI(await nft.tokenURI(tokenId))
      expect(content).to.haveOwnProperty('name').is.a('string')
      expect(content).to.haveOwnProperty('description').is.a('string')
      expect(content).to.haveOwnProperty('image').is.a('string')
    })
  })

  describe('fees accounting', () => {
    beforeEach('create two positions', async () => {
      await createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )
      // nft 1 earns 25% of fees
      const mintParams = {
        token0: tokens[0].address,
        token1: tokens[1].address,
        fee: FeeAmount.MEDIUM,
        tickLower: getMinTick(FeeAmount.MEDIUM),
        tickUpper: getMaxTick(FeeAmount.MEDIUM),
        amount0Desired: 100,
        amount1Desired: 100,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
        recipient: wallet.address,
      }
      const multicallParameters = [nft.interface.encodeFunctionData('mint', [mintParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, wallet, nft, multicallParameters)

      await nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, multicallParameters)

      // nft 2 earns 75% of fees
      const mintParams2 = {
        token0: tokens[0].address,
        token1: tokens[1].address,
        fee: FeeAmount.MEDIUM,
        tickLower: getMinTick(FeeAmount.MEDIUM),
        tickUpper: getMaxTick(FeeAmount.MEDIUM),
        amount0Desired: 300,
        amount1Desired: 300,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
        recipient: wallet.address,
      }
      const multicallParameters2 = [nft.interface.encodeFunctionData('mint', [mintParams2])]
      const { eat: eat2, expiry: expiry2 } = await generateAccessTokenForMulticall(
        signer,
        domain,
        wallet,
        nft,
        multicallParameters2
      )

      await nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](
        eat2.v,
        eat2.r,
        eat2.s,
        expiry2,
        multicallParameters2
      )
    })

    describe('10k of token0 fees collect', () => {
      beforeEach('swap for ~10k of fees', async () => {
        const swapAmount = 3_333_333
        await tokens[0].approve(router.address, swapAmount)

        const exactInputParams = {
          recipient: wallet.address,
          deadline: 1,
          path: encodePath([tokens[0].address, tokens[1].address], [FeeAmount.MEDIUM]),
          amountIn: swapAmount,
          amountOutMinimum: 0,
        }
        const exactInputParamsEncoded = [router.interface.encodeFunctionData('exactInput', [exactInputParams])]
        const { eat: eat, expiry: expiry } = await generateAccessTokenForMulticall(
          signer,
          domain,
          wallet,
          router,
          exactInputParamsEncoded
        )

        await router['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](
          eat.v,
          eat.r,
          eat.s,
          expiry,
          exactInputParamsEncoded
        )
      })
      it('expected amounts', async () => {
        const collectParams1 = {
          tokenId: 1,
          recipient: wallet.address,
          amount0Max: MaxUint128,
          amount1Max: MaxUint128,
        }
        const parameters1 = [nft.interface.encodeFunctionData('collect', [collectParams1])]
        const { eat: eat1, expiry: expiry1 } = await generateAccessTokenForMulticall(
          signer,
          domain,
          wallet,
          nft,
          parameters1
        )

        const [response1] = await nft.callStatic['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](
          eat1.v,
          eat1.r,
          eat1.s,
          expiry1,
          parameters1
        )
        const { amount0: nft1Amount0, amount1: nft1Amount1 } = nft.interface.decodeFunctionResult('collect', response1)
        expect(nft1Amount0).to.eq(2501)
        expect(nft1Amount1).to.eq(0)

        const collectParams2 = {
          tokenId: 2,
          recipient: wallet.address,
          amount0Max: MaxUint128,
          amount1Max: MaxUint128,
        }
        const parameters2 = [nft.interface.encodeFunctionData('collect', [collectParams2])]
        const { eat: eat2, expiry: expiry2 } = await generateAccessTokenForMulticall(
          signer,
          domain,
          wallet,
          nft,
          parameters2
        )

        const [response2] = await nft.callStatic['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](
          eat2.v,
          eat2.r,
          eat2.s,
          expiry2,
          parameters2
        )
        const { amount0: nft2Amount0, amount1: nft2Amount1 } = nft.interface.decodeFunctionResult('collect', response2)
        expect(nft2Amount0).to.eq(7503)
        expect(nft2Amount1).to.eq(0)
      })

      it('actually collected', async () => {
        const poolAddress = computePoolAddress(
          factory.address,
          [tokens[0].address, tokens[1].address],
          FeeAmount.MEDIUM
        )

        const collectParams = {
          tokenId: 1,
          recipient: wallet.address,
          amount0Max: MaxUint128,
          amount1Max: MaxUint128,
        }
        const parameters = [nft.connect(wallet).interface.encodeFunctionData('collect', [collectParams])]
        const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, wallet, nft, parameters)

        const expectedToken1Balance = await tokens[1]['balanceOf(address)'](wallet.address)
        const tx1 = nft
          .connect(wallet)
          ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, parameters)
        await expect(tx1).to.emit(tokens[0], 'Transfer').withArgs(poolAddress, wallet.address, 2501)
        // This was added in lieu of:
        //   .to.not.emit(tokens[1], 'Transfer')
        // due to hardhat bugs that prevent checking a second event on a emit after new hardhat chai matchers were introduced
        expect(await tokens[1]['balanceOf(address)'](wallet.address)).to.equal(expectedToken1Balance)

        const collectParams2 = {
          tokenId: 2,
          recipient: wallet.address,
          amount0Max: MaxUint128,
          amount1Max: MaxUint128,
        }
        const parameters2 = [nft.connect(wallet).interface.encodeFunctionData('collect', [collectParams2])]
        const { eat: eat2, expiry: expiry2 } = await generateAccessTokenForMulticall(
          signer,
          domain,
          wallet,
          nft,
          parameters2
        )

        const tx2 = nft
          .connect(wallet)
          ['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat2.v, eat2.r, eat2.s, expiry2, parameters2)
        await expect(tx2).to.emit(tokens[0], 'Transfer').withArgs(poolAddress, wallet.address, 7503)
        // This was added in lieu of:
        //   .to.not.emit(tokens[1], 'Transfer')
        // due to hardhat bugs that prevent checking a second event on a emit after new hardhat chai matchers were introduced
        expect(await tokens[1]['balanceOf(address)'](wallet.address)).to.equal(expectedToken1Balance)
      })
    })
  })

  describe('#positions', async () => {
    it('gas', async () => {
      const positionsGasTestFactory = await ethers.getContractFactory('NonfungiblePositionManagerPositionsGasTest')
      const positionsGasTest = (await positionsGasTestFactory.deploy(
        nft.address
      )) as NonfungiblePositionManagerPositionsGasTest

      await createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )

      const mintParams = {
        token0: tokens[0].address,
        token1: tokens[1].address,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        fee: FeeAmount.MEDIUM,
        recipient: other.address,
        amount0Desired: 15,
        amount1Desired: 15,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 10,
      }

      const multicallParameters = [nft.interface.encodeFunctionData('mint', [mintParams])]
      const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, wallet, nft, multicallParameters)

      await nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, multicallParameters)

      await snapshotGasCost(positionsGasTest.getGasCostOfPositions(1))
    })
  })
})
