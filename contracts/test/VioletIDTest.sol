// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @dev Provides a mapping from an address to a 256-bit unsigned integer where each bit, identified by its `index`,
 * is used as a boolean flag to represent a different "status".
 * Inspired by OpenZeppelin Contracts (utils/structs/BitMaps.sol)
 **/
contract StatusMap {
    mapping(address => uint256) internal statusesByAccount;

    /**
     * @dev Returns whether the bit at `index` is set for a specific account.
     */
    function _isStatusSet(address account, uint8 index) internal view returns (bool) {
        uint256 mask = 1 << index;
        return statusesByAccount[account] & mask != 0;
    }

    /**
     * @dev Returns whether a specific set of bits are set for a given account.
     */
    function _areStatusesSet(address account, uint256 mask) internal view returns (bool) {
        return statusesByAccount[account] & mask == mask;
    }

    /**
     * @dev Sets the bit at `index` to the boolean `value` for the account `account`.
     */
    function _setStatusTo(
        address account,
        uint256 index,
        bool value
    ) internal {
        if (value) {
            _setStatus(account, index);
        } else {
            _unsetStatus(account, index);
        }
    }

    /**
     * @dev Sets multiple bits for the account `account` using a provided `indicesMask`.
     */
    function _setMultipleStatuses(address account, uint256 indicesMask) internal {
        statusesByAccount[account] |= indicesMask;
    }

    /**
     * @dev Sets the bit at `index` for the account `account`.
     */
    function _setStatus(address account, uint256 index) internal {
        uint256 mask = 1 << (index);
        statusesByAccount[account] |= mask;
    }

    /**
     * @dev Unsets multiple bits for the account `account` using a provided `indicesMask`.
     */
    function _unsetMultipleStatuses(address account, uint256 indicesMask) internal {
        statusesByAccount[account] &= ~indicesMask;
    }

    /**
     * @dev Unsets the bit at `index` for the account `account`.
     */
    function _unsetStatus(address account, uint256 index) internal {
        uint256 mask = 1 << index;
        statusesByAccount[account] &= ~mask;
    }

    /**
     * @dev Calculates the list of `statuses` given a `indicesMask`.
     */
    function getStatusIndexesFromIndicesMask(uint256 indicesMask) external pure returns (uint8[] memory statuses) {
        uint256 numberOfStatuses;
        uint8[256] memory tempStatusArray;

        // iterate indices of bits as long as indicesMask has a value
        for (uint8 i = 0; indicesMask > 0; i++) {
            // If statusCombination has a value at the current bit then a status is set, record it in temp array
            if (indicesMask & 1 != 0) {
                tempStatusArray[numberOfStatuses] = i;
                numberOfStatuses += 1;
            }

            // Bitshift indices mask by one place
            indicesMask = indicesMask >> 1;
        }

        // instantiate fixed length array
        statuses = new uint8[](numberOfStatuses);

        // store values from temp array to new array
        for (uint8 i = 0; i < numberOfStatuses; i++) {
            statuses[i] = tempStatusArray[i];
        }
    }

    /**
     * @dev Calculates the `indicesMask` given a list of status indexes as `statusIds`.
     */
    function getStatusCombinationId(uint8[] calldata statusIds) external pure returns (uint256 indicesMask) {
        for (uint256 i = 0; i < statusIds.length; i++) {
            uint256 status = 1 << statusIds[i];
            indicesMask += status;
        }
    }
}

/**
 * @dev VioletID contract
 *
 * Implements IVioletID with additional features:
 *      - AccessControl
 *      - Pausable
 *      - Upgradeable
 *      - Ethereum Access Token compatible
 */
contract VioletIDTest is StatusMap {
    constructor() {}

    /**
     * @dev See {IVioletID-hasStatus}
     */
    function hasStatus(address account, uint8 statusId) public view returns (bool) {
        return _isStatusSet(account, statusId);
    }

    /**
     * @dev See {IVioletID-hasStatuses}
     */
    function hasStatuses(address account, uint256 statusCombinationId) public view returns (bool) {
        return _areStatusesSet(account, statusCombinationId);
    }

    /**
     * @dev See {IVioletID-grantStatus}
     *
     * Only callable if contract is not paused
     * Only callable by ADMIN_ROLE
     */
    function grantStatus(address account, uint8 statusId) public {
        _setStatus(account, statusId);
    }

    /**
     * @dev See {IVioletID-grantStatuses}
     *
     * Only callable if contract is not paused
     * Only callable by ADMIN_ROLE
     */
    function grantStatuses(address account, uint256 statusCombinationId) public {
        _setMultipleStatuses(account, statusCombinationId);
    }

    /**
     * @dev See {IVioletID-revokeStatus}
     *
     * Only callable if contract is not paused
     * Only callable by ADMIN_ROLE
     */
    function revokeStatus(address account, uint8 statusId) public {
        _unsetStatus(account, statusId);
    }

    /**
     * @dev See {IVioletID-revokeStatuses}
     *
     * Only callable if contract is not paused
     * Only callable by ADMIN_ROLE
     */
    function revokeStatuses(address account, uint256 statusCombinationId) public {
        _unsetMultipleStatuses(account, statusCombinationId);
    }
}
