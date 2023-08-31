// SPDX-License-Identifier: MIT

/// @title A reduced VioletID interface
/// @notice Allows checking for VioletID statuses
/// @dev Make sure to keep this in sync with the interface from @violetprotocol/violetid!
pragma solidity >=0.7.5;

interface IVioletID {
    function hasStatus(address account, uint256 tokenId) external view returns (bool);
}
