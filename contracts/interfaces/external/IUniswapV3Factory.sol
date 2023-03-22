// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0;

/// @title The interface for the Uniswap V3 Factory
/// @notice The Uniswap V3 Factory facilitates creation of Uniswap V3 pools and control over the protocol fees
interface IUniswapV3Factory {
    /// @notice Updates the current Mauve Compliance Regime
    /// @dev Must be called by the current owner
    /// @param tokenIds The VioletID tokenIDs that compromise the new Mauve Compliance Regime
    function setMauveComplianceRegime(uint256[] memory tokenIds) external;
}
