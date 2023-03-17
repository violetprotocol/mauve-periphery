import { Fixture } from 'ethereum-waffle'
import { ethers } from 'hardhat'
import { v3RouterFixture } from './externalFixtures'
import { constants, Wallet } from 'ethers'
import {
  IWETH9,
  MockTimeNonfungiblePositionManager,
  MockTimeSwapRouter,
  NonfungibleTokenPositionDescriptor,
  TestERC20,
  IUniswapV3Factory,
  AccessTokenVerifier,
} from '../../typechain'
import { CreatePoolIfNecessary, createPoolIfNecessary } from './createPoolIfNecessary'
import { parseEther } from 'ethers/lib/utils'
import { EAT_ISSUER_PK } from './eatSigner'
import { positionManagerBytes32 } from './roles'

export type Domain = {
  name: string
  version: string
  chainId: number
  verifyingContract: string
}

const completeFixture: Fixture<{
  weth9: IWETH9
  factory: IUniswapV3Factory
  router: MockTimeSwapRouter
  nft: MockTimeNonfungiblePositionManager
  nftDescriptor: NonfungibleTokenPositionDescriptor
  tokens: [TestERC20, TestERC20, TestERC20]
  createAndInitializePoolIfNecessary: CreatePoolIfNecessary
  signer: Wallet
  domain: Domain
  verifier: AccessTokenVerifier
}> = async ([wallet], provider) => {
  const { weth9, factory, router, verifier } = await v3RouterFixture([wallet], provider)

  const signer = new ethers.Wallet(EAT_ISSUER_PK, provider)
  await wallet.sendTransaction({ to: signer.address, value: parseEther('1') })
  await verifier.connect(signer).rotateIntermediate(signer.address)
  await verifier.connect(signer).activateIssuers([signer.address])
  const domain = {
    name: 'Ethereum Access Token',
    version: '1',
    chainId: await wallet.getChainId(),
    verifyingContract: verifier.address,
  }

  const tokenFactory = await ethers.getContractFactory('TestERC20')
  const tokens: [TestERC20, TestERC20, TestERC20] = [
    (await tokenFactory.deploy(constants.MaxUint256.div(2))) as TestERC20, // do not use maxu256 to avoid overflowing
    (await tokenFactory.deploy(constants.MaxUint256.div(2))) as TestERC20,
    (await tokenFactory.deploy(constants.MaxUint256.div(2))) as TestERC20,
  ]

  const nftDescriptorLibraryFactory = await ethers.getContractFactory('NFTDescriptor')
  const nftDescriptorLibrary = await nftDescriptorLibraryFactory.deploy()
  const positionDescriptorFactory = await ethers.getContractFactory('NonfungibleTokenPositionDescriptor', {
    libraries: {
      NFTDescriptor: nftDescriptorLibrary.address,
    },
  })
  const nftDescriptor = (await positionDescriptorFactory.deploy(
    tokens[0].address,
    // 'ETH' as a bytes32 string
    '0x4554480000000000000000000000000000000000000000000000000000000000'
  )) as NonfungibleTokenPositionDescriptor

  //NONFUNGIBLEPOSITIONMANAGER SETUP
  const positionManagerFactory = await ethers.getContractFactory('MockTimeNonfungiblePositionManager')
  const nft = (await positionManagerFactory.deploy(
    factory.address,
    weth9.address,
    nftDescriptor.address,
    verifier.address
  )) as MockTimeNonfungiblePositionManager

  await factory.setRole(nft.address, positionManagerBytes32)

  const createAndInitializePoolIfNecessary: CreatePoolIfNecessary = createPoolIfNecessary(factory, wallet)

  tokens.sort((a, b) => (a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1))

  return {
    weth9,
    factory,
    router,
    tokens,
    nft,
    nftDescriptor,
    createAndInitializePoolIfNecessary,
    signer,
    verifier,
    domain,
  }
}

export default completeFixture
