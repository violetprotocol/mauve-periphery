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

    modifier onlyFactoryOwner() {
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

    modifier onlyAllowedToInteract(address account) {
        // NID -> No Violet ID
        require(_checkIfAllowedToInteract(account), 'NID');
        _;
    }

    function _isEmergencyModeActivated() internal view returns (bool) {
        return isEmergencyMode;
    }

    function activateEmergencyMode() external onlyFactoryOwner {
        isEmergencyMode = true;
    }

    function _checkIfAllowedToInteract(address account) internal view virtual returns (bool) {
        uint256[] memory tokenIds = IUniswapV3FactoryReduced(factory).getMauveTokenIdsAllowedToInteract();

        IVioletID violetID = IVioletID(_violetID);
        uint256 length = tokenIds.length;
        for (uint256 i = 0; i < length; i++) {
            bool hasStatus = violetID.hasStatus(account, tokenIds[i]);
            if (hasStatus) {
                return true;
            }
        }
        return false;
    }
}
