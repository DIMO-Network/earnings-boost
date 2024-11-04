// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.10;

// TODO Documentation
interface IVehicleId {
    function ownerOf(uint256 tokenId) external view returns (address);

    function exists(uint256 tokenId) external view returns (bool);
}
