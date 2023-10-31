import { Wallet } from 'ethers'
import { MockTimeNonfungiblePositionManager } from '../../typechain'
import { FeeAmount, TICK_SPACINGS } from './constants'
import { CreatePoolIfNecessary } from './createPoolIfNecessary'
import { encodePriceSqrt } from './encodePriceSqrt'
import { getMaxTick, getMinTick } from './ticks'
import { generateAccessTokenForMulticall } from '../../utils'
import { Domain } from './completeFixture'

export async function createPool(
  nft: MockTimeNonfungiblePositionManager,
  wallet: Wallet,
  tokenAddressA: string,
  tokenAddressB: string,
  createAndInitializePoolIfNecessary: CreatePoolIfNecessary,
  signer: Wallet,
  domain: Domain
) {
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

  const multicallParameters = [nft.interface.encodeFunctionData('mint', [mintParams])]
  const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, wallet, nft, multicallParameters)

  await nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, multicallParameters)
}

export async function createPoolWithMultiplePositions(
  nft: MockTimeNonfungiblePositionManager,
  wallet: Wallet,
  tokenAddressA: string,
  tokenAddressB: string,
  createAndInitializePoolIfNecessary: CreatePoolIfNecessary,
  signer: Wallet,
  domain: Domain
) {
  if (tokenAddressA.toLowerCase() > tokenAddressB.toLowerCase())
    [tokenAddressA, tokenAddressB] = [tokenAddressB, tokenAddressA]

  await createAndInitializePoolIfNecessary(tokenAddressA, tokenAddressB, FeeAmount.MEDIUM, encodePriceSqrt(1, 1))

  const liquidityParams1 = {
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

  const multicallParameters1 = [nft.interface.encodeFunctionData('mint', [liquidityParams1])]
  const { eat: eat1, expiry: expiry1 } = await generateAccessTokenForMulticall(
    signer,
    domain,
    wallet,
    nft,
    multicallParameters1
  )

  await nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat1.v, eat1.r, eat1.s, expiry1, multicallParameters1)

  const liquidityParams2 = {
    token0: tokenAddressA,
    token1: tokenAddressB,
    fee: FeeAmount.MEDIUM,
    tickLower: -60,
    tickUpper: 60,
    recipient: wallet.address,
    amount0Desired: 100,
    amount1Desired: 100,
    amount0Min: 0,
    amount1Min: 0,
    deadline: 1,
  }

  const multicallParameters2 = [nft.interface.encodeFunctionData('mint', [liquidityParams2])]
  const { eat: eat2, expiry: expiry2 } = await generateAccessTokenForMulticall(
    signer,
    domain,
    wallet,
    nft,
    multicallParameters2
  )

  await nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat2.v, eat2.r, eat2.s, expiry2, multicallParameters2)

  const liquidityParams3 = {
    token0: tokenAddressA,
    token1: tokenAddressB,
    fee: FeeAmount.MEDIUM,
    tickLower: -120,
    tickUpper: 120,
    recipient: wallet.address,
    amount0Desired: 100,
    amount1Desired: 100,
    amount0Min: 0,
    amount1Min: 0,
    deadline: 1,
  }

  const multicallParameters3 = [nft.interface.encodeFunctionData('mint', [liquidityParams3])]
  const { eat: eat3, expiry: expiry3 } = await generateAccessTokenForMulticall(
    signer,
    domain,
    wallet,
    nft,
    multicallParameters3
  )

  await nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat3.v, eat3.r, eat3.s, expiry3, multicallParameters3)
}

export async function createPoolWithZeroTickInitialized(
  nft: MockTimeNonfungiblePositionManager,
  wallet: Wallet,
  tokenAddressA: string,
  tokenAddressB: string,
  createAndInitializePoolIfNecessary: CreatePoolIfNecessary,
  signer: Wallet,
  domain: Domain
) {
  if (tokenAddressA.toLowerCase() > tokenAddressB.toLowerCase())
    [tokenAddressA, tokenAddressB] = [tokenAddressB, tokenAddressA]

  await createAndInitializePoolIfNecessary(tokenAddressA, tokenAddressB, FeeAmount.MEDIUM, encodePriceSqrt(1, 1))

  const liquidityParams1 = {
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

  const multicallParameters1 = [nft.interface.encodeFunctionData('mint', [liquidityParams1])]
  const { eat: eat1, expiry: expiry1 } = await generateAccessTokenForMulticall(
    signer,
    domain,
    wallet,
    nft,
    multicallParameters1
  )

  await nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat1.v, eat1.r, eat1.s, expiry1, multicallParameters1)

  const liquidityParams2 = {
    token0: tokenAddressA,
    token1: tokenAddressB,
    fee: FeeAmount.MEDIUM,
    tickLower: 0,
    tickUpper: 60,
    recipient: wallet.address,
    amount0Desired: 100,
    amount1Desired: 100,
    amount0Min: 0,
    amount1Min: 0,
    deadline: 1,
  }

  const multicallParameters2 = [nft.interface.encodeFunctionData('mint', [liquidityParams2])]
  const { eat: eat2, expiry: expiry2 } = await generateAccessTokenForMulticall(
    signer,
    domain,
    wallet,
    nft,
    multicallParameters2
  )

  await nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat2.v, eat2.r, eat2.s, expiry2, multicallParameters2)

  const liquidityParams3 = {
    token0: tokenAddressA,
    token1: tokenAddressB,
    fee: FeeAmount.MEDIUM,
    tickLower: -120,
    tickUpper: 0,
    recipient: wallet.address,
    amount0Desired: 100,
    amount1Desired: 100,
    amount0Min: 0,
    amount1Min: 0,
    deadline: 1,
  }

  const multicallParameters3 = [nft.interface.encodeFunctionData('mint', [liquidityParams3])]
  const { eat: eat3, expiry: expiry3 } = await generateAccessTokenForMulticall(
    signer,
    domain,
    wallet,
    nft,
    multicallParameters3
  )

  await nft['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat3.v, eat3.r, eat3.s, expiry3, multicallParameters3)
}
