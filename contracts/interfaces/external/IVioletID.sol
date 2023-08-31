// SPDX-License-Identifier: MIT

/// @title VioletID interface
/// @notice Allows checking for VioletID registration status to allow or disallow accounts
/// @dev Make sure to keep this in sync with the interface from @violetprotocol/violetid!
pragma solidity >=0.7.5;

interface IVioletID {
    function hasStatus(address account, uint256 tokenId) external view returns (bool);
}
