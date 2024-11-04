// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.10;

import {ERC20} from 'openzeppelin-contracts-4.8/token/ERC20/ERC20.sol';
import {ERC20Permit} from 'openzeppelin-contracts-4.8/token/ERC20/extensions/draft-ERC20Permit.sol';
import {ERC20Votes} from 'openzeppelin-contracts-4.8/token/ERC20/extensions/ERC20Votes.sol';

/**
 * @title MockDimoToken
 * @dev Mocks the ERC20 DIMO token with OZ 4.8.0 to be used in tests
 */
contract MockDimoToken is ERC20, ERC20Permit, ERC20Votes {
    uint256 tokenCount;

    constructor() ERC20('Mock DIMO Token', 'TKN') ERC20Permit('Mock DIMO Token') {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _mint(address to, uint256 amount) internal override(ERC20, ERC20Votes) {
        super._mint(to, amount);
    }

    function _burn(address account, uint256 amount) internal override(ERC20, ERC20Votes) {
        super._burn(account, amount);
    }

    function _afterTokenTransfer(address from, address to, uint256 amount) internal override(ERC20, ERC20Votes) {
        super._afterTokenTransfer(from, to, amount);
    }
}
