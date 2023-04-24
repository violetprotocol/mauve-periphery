// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;
pragma abicoder v2;

import '@violetprotocol/ethereum-access-token/contracts/AccessTokenConsumer.sol';
import '../interfaces/IEATMulticall.sol';
import './Multicall.sol';

/// @title Ethereum Access Token Multicall
/// @notice Enables calling multiple methods in a single call to the contract
abstract contract EATMulticall is Multicall, IEATMulticall, AccessTokenConsumer {
    constructor(address _EATVerifier) AccessTokenConsumer(_EATVerifier) {}

    uint256 private isMulticalling;
    uint256 private numberOfCalls;

    modifier multicalling(bytes[] calldata calls) {
        numberOfCalls = calls.length;
        isMulticalling = 2;
        _;
        isMulticalling = 1;
    }

    // be careful with external contract function calls made by functions you modify with this
    // keep in mind possible re-entrancy
    modifier onlySelfMulticall {
        _checkSelfMulticalling();
        _;
    }

    function _checkSelfMulticalling() internal {
        // NSMC -> Not self multi calling
        require(isMulticalling == 2 , 'NSMC');
        // UNC -> Unexpected number of calls
        require(numberOfCalls > 0, 'UNC');
        numberOfCalls--;
    }

    function multicall(
        uint8 v,
        bytes32 r,
        bytes32 s,
        uint256 expiry,
        bytes[] calldata data
    ) public payable override requiresAuth(v, r, s, expiry) multicalling(data) returns (bytes[] memory results) {
        // performs an external call to self for core multicall logic
        return super.multicall(data);
    }

    /// @inheritdoc IMulticall
    function multicall(bytes[] calldata) public payable override returns (bytes[] memory) {
        // NED -> non-EAT multicall disallowed
        revert('NED');
    }
}
