import {
  abi as FACTORY_ABI,
  bytecode as FACTORY_BYTECODE,
} from '@violetprotocol/mauve-core/artifacts/contracts/MauveFactory.sol/MauveFactory.json'
import {
  abi as VIOLETID_ABI,
  bytecode as VIOLETID_BYTECODE,
} from '@violetprotocol/violetid/artifacts/contracts/VioletID.sol/VioletID.json'
import { Fixture } from 'ethereum-waffle'
import { ethers, waffle } from 'hardhat'
import { AccessTokenVerifier, IMauveFactoryReduced, IWETH9, MockTimeSwapRouter } from '../../typechain'

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

const coreFactoryFixture: Fixture<IMauveFactoryReduced> = async ([wallet]) => {
  return (await waffle.deployContract(wallet, {
    bytecode: FACTORY_BYTECODE,
    abi: FACTORY_ABI,
  })) as IMauveFactoryReduced
}

export const routerFixture: Fixture<{
  weth9: IWETH9
  factory: IMauveFactoryReduced
  router: MockTimeSwapRouter
  verifier: AccessTokenVerifier
}> = async ([wallet], provider) => {
  const { weth9 } = await wethFixture([wallet], provider)
  const factory = await coreFactoryFixture([wallet], provider)

  // ETHEREUM ACCESS TOKEN SETUP
  const signer = new ethers.Wallet(EAT_ISSUER_PK, provider)
  const verifierFactory = await ethers.getContractFactory('AccessTokenVerifier')
  const verifier = <AccessTokenVerifier>await verifierFactory.deploy(signer.address)

  const router = (await (
    await ethers.getContractFactory('MockTimeSwapRouter')
  ).deploy(factory.address, weth9.address, verifier.address)) as MockTimeSwapRouter
  await factory.setRole(router.address, swapRouterBytes32)

  return { factory, weth9, router, verifier }
}

export const violetIDFixture: Fixture<Contract> = async ([wallet], provider) => {
  return await waffle.deployContract(wallet, {
    bytecode: VIOLETID_BYTECODE,
    abi: VIOLETID_ABI,
  })
}
