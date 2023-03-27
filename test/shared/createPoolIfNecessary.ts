import { BigNumber, constants, Wallet } from 'ethers'
import { IMauveFactoryReduced, IMauvePool__factory } from '../../typechain'
import { FeeAmount } from './constants'

export type CreatePoolIfNecessary = (
  token0: string,
  token1: string,
  fee: FeeAmount,
  initialSqrtPriceX96: BigNumber,
  value?: { value: number }
) => Promise<string>

export const createPoolIfNecessary = (factory: IMauveFactoryReduced, wallet: Wallet) => async (
  token0: string,
  token1: string,
  fee: FeeAmount,
  initialSqrtPriceX96: BigNumber
) => {
  const pool = await factory.getPool(token0, token1, fee)

  if (pool == constants.AddressZero) {
    try {
      const createdPoolTx = await factory.createPool(token0, token1, fee)
      const txReceipt = await createdPoolTx.wait()
      const poolAddress = txReceipt.events?.[0].args?.pool

      if (!poolAddress) {
        throw new Error('Failed to get pool address from creation')
      }

      const poolContract = await IMauvePool__factory.connect(poolAddress, wallet)
      await poolContract.initialize(initialSqrtPriceX96)

      return poolAddress
    } catch (error) {
      throw new Error(`Failed to create new pool: ${error}`)
    }
  } else {
    try {
      const poolContract = await IMauvePool__factory.connect(pool, wallet)
      const { sqrtPriceX96 } = await poolContract.slot0()
      if (sqrtPriceX96.eq(0)) {
        await poolContract.initialize(initialSqrtPriceX96)
      }
      return poolContract.address
    } catch (error) {
      throw new Error(`Failed to handle already deployed pool: ${error}`)
    }
  }
}
