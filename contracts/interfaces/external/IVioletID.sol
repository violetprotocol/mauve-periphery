// SPDX-License-Identifier: MIT

/// @title VioletID interface
/// @notice Allows checking for VioletID registration status to allow or disallow accounts
pragma solidity >=0.7.5;

interface IVioletID {
    event GrantedStatus(address account, uint256 tokenId);
    event RevokedStatus(address account, uint256 tokenId, bytes reason);

    function grantStatus(address account, uint256 tokenId, bytes memory data) external;

    function revokeStatus(address account, uint256 tokenId, bytes memory reason) external;

    function hasStatus(address account, uint256 tokenId) external view returns (bool);

    function hasVioletVerificationStatus(address account) external view returns (bool);

    function numberWithVioletVerificationStatus() external view returns (uint256);
}
