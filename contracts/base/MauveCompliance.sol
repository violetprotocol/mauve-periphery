// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;
pragma abicoder v2;

import '../interfaces/external/IMauveFactoryReduced.sol';
import '../interfaces/external/IVioletID.sol';
import './PeripheryImmutableState.sol';

/// @title Mauve Compliance
/// @notice Defines extra rules for access control beyond what is provided by Violet EATs
abstract contract MauveCompliance is PeripheryImmutableState {
    address private immutable _violetID;
    bool private isEmergencyMode = false;

    constructor(address _violetId) {
        _violetID = _violetId;
    }

    modifier onlyFactoryOwner() {
        address factoryOwner = IMauveFactoryReduced(factory).roles('owner');
        // NFO -> Not Factory Owner
        require(msg.sender == factoryOwner, 'NFO');
        _;
    }

    modifier onlyWhenNotEmergencyMode() {
        // EMA -> Emergency Mode Activated
        require(!_isEmergencyModeActivated(), 'EMA');
        _;
    }

    modifier onlyAllowedToInteract(address from, address to) {
        // NID -> No Violet ID
        require(_checkIfAllowedToInteract(from) && _checkIfAllowedToInteract(to), 'NID');
        _;
    }

    function _isEmergencyModeActivated() internal view returns (bool) {
        return isEmergencyMode;
    }

    function setEmergencyMode(bool isEmergencyMode_) external onlyFactoryOwner {
        isEmergencyMode = isEmergencyMode_;
    }

    function _checkIfAllowedToInteract(address account) internal view virtual returns (bool) {
        uint256[] memory tokenIds = IMauveFactoryReduced(factory).getMauveTokenIdsAllowedToInteract();

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
