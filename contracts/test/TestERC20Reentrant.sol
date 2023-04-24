// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.7.6;

import '@openzeppelin/contracts/drafts/ERC20Permit.sol';
import '../interfaces/INonfungiblePositionManager.sol';
import '../interfaces/IERC721Permit.sol';

contract TestERC20Reentrant is ERC20Permit {
    address payable positionManager;
    event CustomError(string reason);

    constructor(uint256 amountToMint) ERC20('Test ERC20 Reentrant', 'TESTR') ERC20Permit('Test ERC20 Reentrant') {
        _mint(msg.sender, amountToMint);
    }

    function setPositionManagerAddress(address payable positionManager_) public {
        positionManager = positionManager_;
    }

    function transferFrom(address sender, address recipient, uint256 amount) public override returns (bool) {
        return super.transferFrom(sender, recipient, amount);
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        // Condition to avoid interfering giving out tokens during fixture creation
        if (amount > 1000) {
            return super.transfer(to, amount);
        } else {
            bool result = super.transfer(to, amount);
            try INonfungiblePositionManager(positionManager).burn(2) {} catch Error(string memory reason) {
                emit CustomError(reason);
            }
            return result;
        }
    }

    receive() external payable {}
}
