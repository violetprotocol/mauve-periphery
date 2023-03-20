import {
  abi as FACTORY_ABI,
  bytecode as FACTORY_BYTECODE,
} from '@violetprotocol/mauve-v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json'
import { abi as FACTORY_V2_ABI, bytecode as FACTORY_V2_BYTECODE } from '@uniswap/v2-core/build/UniswapV2Factory.json'
import { Fixture } from 'ethereum-waffle'
import { ethers, waffle } from 'hardhat'
import { AccessTokenVerifier, IUniswapV3Factory, IWETH9, MockTimeSwapRouter } from '../../typechain'

import WETH9 from '../contracts/WETH9.json'
import { Contract } from '@ethersproject/contracts'
import { constants } from 'ethers'
import { EAT_ISSUER_PK } from './eatSigner'
import { swapRouterBytes32 } from './roles'

const wethFixture: Fixture<{ weth9: IWETH9 }> = async ([wallet]) => {
  const weth9 = (await waffle.deployContract(wallet, {
    bytecode: WETH9.bytecode,
    abi: WETH9.abi,
  })) as IWETH9

  return { weth9 }
}

export const v2FactoryFixture: Fixture<{ factory: Contract }> = async ([wallet]) => {
  const factory = await waffle.deployContract(
    wallet,
    {
      bytecode: FACTORY_V2_BYTECODE,
      abi: FACTORY_V2_ABI,
    },
    [constants.AddressZero]
  )

  return { factory }
}

const v3CoreFactoryFixture: Fixture<IUniswapV3Factory> = async ([wallet]) => {
  return (await waffle.deployContract(wallet, {
    bytecode: FACTORY_BYTECODE,
    abi: FACTORY_ABI,
  })) as IUniswapV3Factory
}

export const v3RouterFixture: Fixture<{
  weth9: IWETH9
  factory: IUniswapV3Factory
  router: MockTimeSwapRouter
  verifier: AccessTokenVerifier
}> = async ([wallet], provider) => {
  const { weth9 } = await wethFixture([wallet], provider)
  const factory = await v3CoreFactoryFixture([wallet], provider)

  // ETHEREUM ACCESS TOKEN SETUP
  const signer = new ethers.Wallet(EAT_ISSUER_PK, provider)
  const verifierFactory = await ethers.getContractFactory('AccessTokenVerifier')
  const verifier = <AccessTokenVerifier>await verifierFactory.deploy(signer.address)

  const router = (await (await ethers.getContractFactory('MockTimeSwapRouter')).deploy(
    factory.address,
    weth9.address,
    verifier.address
  )) as MockTimeSwapRouter
  await factory.setRole(router.address, swapRouterBytes32);

  return { factory, weth9, router, verifier }
}
