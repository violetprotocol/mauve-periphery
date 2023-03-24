// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;
pragma abicoder v2;

import '../interfaces/external/IUniswapV3FactoryReduced.sol';
import '../interfaces/external/IVioletID.sol';
import './PeripheryImmutableState.sol';

/// @title NFT positions
/// @notice Wraps Uniswap V3 positions in the ERC721 non-fungible token interface
abstract contract MauveCompliance is PeripheryImmutableState {
    address private immutable _violetID;
    bool private isEmergencyMode = false;

    constructor(address _violetId) {
        _violetID = _violetId;
    }

    modifier onlyFactoryOwner {
        address factoryOwner = IUniswapV3FactoryReduced(factory).roles('owner');
        // NFO -> Not Factory Owner
        require(msg.sender == factoryOwner, 'NFO');
        _;
    }

    modifier onlyWhenNotEmergencyMode() {
        // EMA -> Emergency Mode Activated
        require(!_isEmergencyModeActivated(), 'EMA');
        _;
    }

    modifier onlyMauveCompliant(address account) {
        _checkMauveCompliant(account);
        _;
    }

    function _isEmergencyModeActivated() internal view returns (bool) {
        return isEmergencyMode;
    }

    function activateEmergencyMode() external onlyFactoryOwner {
        isEmergencyMode = true;
    }

    function _checkMauveCompliant(address account) internal view virtual {
        uint256[] memory tokenIds = IUniswapV3FactoryReduced(factory).getMauveComplianceRegime();

        for (uint256 i = 0; i < tokenIds.length; i++) {
            // NID -> No Violet ID
            require(IVioletID(_violetID).hasStatus(account, tokenIds[i]), 'NID');
        }
    }
}
