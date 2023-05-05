// SPDX-License-Identifier: MIT
pragma solidity ^0.7.0;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC1155/ERC1155Burnable.sol";
import "../interfaces/external/IVioletID.sol";


// Mock the real VioletID contract just for testing in this repository.
contract VioletIDTest is
    ERC1155,
    Ownable,
    Pausable,
    ERC1155Burnable,
    IVioletID
{

    /// Public flag representing a verified entity status which has passed Violet Verification for Mauve
    uint256 public constant MAUVE_VERIFIED_ENTITY_STATUS_TOKENID = 0;

    constructor(string memory uri_) ERC1155(uri_) {
    }

    function setURI(string memory newuri) public onlyOwner {
        _setURI(newuri);
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    function grantStatus(address account, uint256 tokenId, bytes memory data) public override onlyOwner {
        require(!hasStatus(account, tokenId), "account already granted status");

        _mint(account, tokenId, 1, data);
        emit GrantedStatus(account, tokenId);
    }

    function revokeStatus(address account, uint256 tokenId, bytes memory reason) public override onlyOwner {
        require(hasStatus(account, tokenId), "account not in revocable status");

        _burn(account, tokenId, 1);
        emit RevokedStatus(account, tokenId, reason);
    }

    function hasStatus(address account, uint256 tokenId) public view override returns (bool) {
        return balanceOf(account, tokenId) > 0;
    }

    function hasMauveVerificationStatus(address account) public view override returns (bool) {
        return balanceOf(account, MAUVE_VERIFIED_ENTITY_STATUS_TOKENID) > 0;
    }

    function numberWithMauveVerificationStatus() public view override returns (uint256) {
        return 1_000_000;
    }

    function safeTransferFrom(address, address, uint256, uint256, bytes memory) public virtual override {
        revert("transfers disallowed");
    }

    /**
     * @dev See {IERC1155-safeBatchTransferFrom}.
     */
    function safeBatchTransferFrom(
        address,
        address,
        uint256[] memory,
        uint256[] memory,
        bytes memory
    ) public virtual override {
        revert("transfers disallowed");
    }
}
