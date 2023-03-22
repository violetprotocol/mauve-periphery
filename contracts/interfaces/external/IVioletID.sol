// SPDX-License-Identifier: MIT

/// @title VioletID interface
/// @notice Allows checking for VioletID registration status to allow or disallow accounts
pragma solidity >=0.7.5;

interface IVioletID {
    function isRegistered(address account, uint256 tokenId) external view returns (bool);

    function isBaseRegistered(address account) external view returns (bool);

    function numberOfBaseRegistered() external view returns (uint256);
}
