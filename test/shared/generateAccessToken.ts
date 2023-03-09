import { Wallet, BigNumber } from "ethers"
import { messages, utils } from "@violetprotocol/ethereum-access-token-helpers"
import { MockTimeNonfungiblePositionManager, TestEATMulticall } from "../../typechain"
import { splitSignature } from "ethers/lib/utils"

export const generateAccessToken = async (
  signer: Wallet,
  domain: messages.Domain,
  caller: Wallet,
  contract: MockTimeNonfungiblePositionManager | TestEATMulticall,
  parameters: any[]
) => {
  const token = {
    functionCall: {
      functionSignature: contract.interface.getSighash('multicall(uint8,bytes32,bytes32,uint256,bytes[])'),
      target: contract.address,
      caller: caller.address,
      parameters: utils.packParameters(contract.interface, 'multicall(uint8,bytes32,bytes32,uint256,bytes[])', [
        parameters,
      ]),
    },
    expiry: BigNumber.from(4833857428),
  }

  const eat = splitSignature(await utils.signAccessToken(signer, domain, token))

  return { eat, expiry: token.expiry }
}
