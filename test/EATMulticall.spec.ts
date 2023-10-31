import { Wallet } from 'ethers'
import { ethers } from 'hardhat'
import { TestEATMulticall } from '../typechain/TestEATMulticall'
import { AccessTokenVerifier } from '../typechain/AccessTokenVerifier'
import { expect } from './shared/expect'
import { messages } from '@violetprotocol/ethereum-access-token-helpers'

import snapshotGasCost from './shared/snapshotGasCost'
import { parseEther } from 'ethers/lib/utils'
import { generateAccessTokenForMulticall } from '../utils/generateAccessToken'

// generated randomly from privatekeys.pw
// DO NOT USE IN SENSITIVE PLACES
const EAT_ISSUER_PK = '18eaafaa63636879094c86a953e6fcba4abaefae3baec1d4e5b952c10828d4c2'

describe('EATMulticall', async () => {
  let signer: Wallet
  let wallets: Wallet[]

  let testMulticall: TestEATMulticall
  let verifier: AccessTokenVerifier

  let domain: messages.Domain

  before('setup', async () => {
    wallets = await (ethers as any).getSigners()
    signer = new ethers.Wallet(EAT_ISSUER_PK, wallets[0].provider)

    //We need to fund the signer address to broadcast the rotate/activateIssuers transactions
    await wallets[0].sendTransaction({ to: signer.address, value: parseEther('1') })

    const verifierFactory = await ethers.getContractFactory('AccessTokenVerifier')
    verifier = <AccessTokenVerifier>await verifierFactory.deploy(signer.address)

    await verifier.connect(signer).rotateIntermediate(signer.address)
    await verifier.connect(signer).activateIssuers([signer.address])

    domain = {
      name: 'Ethereum Access Token',
      version: '1',
      chainId: await wallets[0].getChainId(),
      verifyingContract: verifier.address,
    }
  })

  beforeEach('create multicall', async () => {
    const multicallTestFactory = await ethers.getContractFactory('TestEATMulticall')
    testMulticall = await multicallTestFactory.deploy(verifier.address)
  })

  it('revert messages are returned', async () => {
    const parameters = [testMulticall.interface.encodeFunctionData('functionThatRevertsWithError', ['abcdef'])]

    const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, wallets[0], testMulticall, parameters)
    await expect(
      testMulticall['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, parameters)
    ).to.be.revertedWith('abcdef')
  })

  it('return data is properly encoded', async () => {
    const parameters = [testMulticall.interface.encodeFunctionData('functionThatReturnsTuple', [1, 2])]

    const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, wallets[0], testMulticall, parameters)
    const [data] = await testMulticall.callStatic['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](
      eat.v,
      eat.r,
      eat.s,
      expiry,
      parameters
    )

    const {
      tuple: { a, b },
    } = testMulticall.interface.decodeFunctionResult('functionThatReturnsTuple', data)
    expect(b).to.eq(1)
    expect(a).to.eq(2)
  })

  it('direct vanilla multicall without EAT is blocked', async () => {
    await expect(
      testMulticall.callStatic['multicall(bytes[])']([
        testMulticall.interface.encodeFunctionData('functionThatReturnsTuple', ['1', '2']),
      ])
    ).to.be.revertedWith('NED')
  })

  describe('context is preserved', () => {
    it('msg.value', async () => {
      const parameters = [testMulticall.interface.encodeFunctionData('pays')]

      const { eat, expiry } = await generateAccessTokenForMulticall(
        signer,
        domain,
        wallets[0],
        testMulticall,
        parameters
      )
      await testMulticall['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, parameters, {
        value: 3,
      })
      expect(await testMulticall.paid()).to.eq(3)
    })

    it('msg.value used twice', async () => {
      const parameters = [
        testMulticall.interface.encodeFunctionData('pays'),
        testMulticall.interface.encodeFunctionData('pays'),
      ]

      const { eat, expiry } = await generateAccessTokenForMulticall(
        signer,
        domain,
        wallets[0],
        testMulticall,
        parameters
      )

      await testMulticall['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, parameters, {
        value: 3,
      })
      expect(await testMulticall.paid()).to.eq(6)
    })

    it('msg.sender', async () => {
      expect(await testMulticall.returnSender()).to.eq(wallets[0].address)
    })
  })

  it('gas cost of pay w/o multicall', async () => {
    await snapshotGasCost(testMulticall.pays({ value: 3 }))
  })

  it('gas cost of pay w/ multicall', async () => {
    const parameters = [testMulticall.interface.encodeFunctionData('pays')]

    const { eat, expiry } = await generateAccessTokenForMulticall(signer, domain, wallets[0], testMulticall, parameters)
    await snapshotGasCost(
      testMulticall['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](eat.v, eat.r, eat.s, expiry, parameters, {
        value: 3,
      })
    )
  })

  describe('function only callable from self multicall', async () => {
    it('should succeed with multicall', async () => {
      const parameters = [testMulticall.interface.encodeFunctionData('function1ThatCanOnlyBeMulticalled')]

      const { eat, expiry } = await generateAccessTokenForMulticall(
        signer,
        domain,
        wallets[0],
        testMulticall,
        parameters
      )
      const [data] = await testMulticall.callStatic['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](
        eat.v,
        eat.r,
        eat.s,
        expiry,
        parameters
      )

      const str = testMulticall.interface.decodeFunctionResult('function1ThatCanOnlyBeMulticalled', data).str
      expect(str).to.equal('hello from function 1')
    })

    it('should not succeed to re-enter with multicall', async () => {
      const parameters = [
        testMulticall.interface.encodeFunctionData('function2ThatCanOnlyBeMulticalled'),
        testMulticall.interface.encodeFunctionData('functionThatReturnsTuple', [1, 2]),
      ]

      const { eat, expiry } = await generateAccessTokenForMulticall(
        signer,
        domain,
        wallets[0],
        testMulticall,
        parameters
      )
      const returned = await testMulticall.callStatic['multicall(uint8,bytes32,bytes32,uint256,bytes[])'](
        eat.v,
        eat.r,
        eat.s,
        expiry,
        parameters
      )
      const str = testMulticall.interface.decodeFunctionResult('function1ThatCanOnlyBeMulticalled', returned[0]).str

      expect(str).to.equal('CFL')
    })

    it('should fail without multicall', async () => {
      await expect(testMulticall.function1ThatCanOnlyBeMulticalled()).to.be.revertedWith('NSMC')
    })
  })
})
