// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.7.5;
pragma abicoder v2;

/// @title VioletID interface
/// @notice Allows checking for VioletID registration status to allow or disallow accounts
interface IVioletID {
    /// @notice Checks if `account` owns a VioletID token or not
    /// @param account The address to be checked
    function isRegistered(address account) external payable returns (bool);
}
