import { abi as POOL_ABI } from '@violetprotocol/mauve-core/artifacts/contracts/MauvePool.sol/MauvePool.json'
import { Contract, Wallet } from 'ethers'
import { IMauvePool } from '../../typechain'

export default function poolAtAddress(address: string, wallet: Wallet): IMauvePool {
  return new Contract(address, POOL_ABI, wallet) as IMauvePool
}
