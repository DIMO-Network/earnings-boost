// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.27;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';

/**
 * @title MockERC20
 * @dev Mocks a generic ERC20 to be used in tests
 */
contract MockERC20 is ERC20 {
    uint256 tokenCount;

    constructor() ERC20('Mock ERC20', 'TKN') {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
