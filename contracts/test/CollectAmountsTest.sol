// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.4;

// This contract is created for tests purposes
// So that we can compare the revert reason of collectAmounts on NonfungiblePositionManager.sol
// See /test/NonfungiblePositionManager.spec.sol:1229 for more information 
contract CollectAmountsTest {
    error CollectAmounts(uint256 amount0, uint256 amount1);
}
