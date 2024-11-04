// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.10;

import {ERC721} from 'openzeppelin-contracts-4.8/token/ERC721/ERC721.sol';

/**
 * @title MockVehicleId
 * @dev Mocks the Vehicle ID with OZ 4.8.0 to be used in tests
 */
contract MockVehicleId is ERC721 {
    uint256 tokenCount;

    constructor() ERC721('Mock Vehicle ID', 'MVID') {}

    function mint(address account) external {
        _mint(account, ++tokenCount);
    }

    function burn(uint256 tokenId) external {
        _burn(tokenId);
    }

    function exists(uint256 tokenId) external view returns (bool) {
        return _exists(tokenId);
    }
}
