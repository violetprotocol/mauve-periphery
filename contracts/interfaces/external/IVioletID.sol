// SPDX-License-Identifier: MIT

/// @title VioletID interface
/// @notice Allows checking for VioletID registration status to allow or disallow accounts
/// @dev Make sure to keep this in sync with the interface from @violetprotocol/violetid!
pragma solidity >=0.7.5;

interface IVioletID {
    event GrantedStatus(address account, uint256 tokenId);
    event RevokedStatus(address account, uint256 tokenId, bytes reason);

    function grantStatus(
        address account,
        uint256 tokenId,
        bytes memory data
    ) external;

    function revokeStatus(
        address account,
        uint256 tokenId,
        bytes memory reason
    ) external;

    function hasStatus(address account, uint256 tokenId) external view returns (bool);

    function hasMauveVerificationStatus(address account) external view returns (bool);

    function numberWithMauveVerificationStatus() external view returns (uint256);
}
