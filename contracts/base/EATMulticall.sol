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

    bool private isMulticalling;
    modifier multicalling {
        isMulticalling = true;
        _;
        isMulticalling = false;
    }

    // be careful with external contract function calls made by functions you modify with this
    // keep in mind possible re-entrancy
    modifier onlySelfMulticall {
        // NSMC -> Not self multi calling
        require(_isSelfMulticalling(), 'NSMC');
        _;
    }

    function _isSelfMulticalling() internal view returns (bool) {
        return isMulticalling;
    }

    function multicall(
        uint8 v,
        bytes32 r,
        bytes32 s,
        uint256 expiry,
        bytes[] calldata data
    ) public payable override requiresAuth(v, r, s, expiry) multicalling returns (bytes[] memory results) {
        // performs an external call to self for core multicall logic
        return super.multicall(data);
    }

    /// @inheritdoc IMulticall
    function multicall(bytes[] calldata) public payable override returns (bytes[] memory) {
        // NED -> non-EAT multicall disallowed
        revert('NED');
    }
}
