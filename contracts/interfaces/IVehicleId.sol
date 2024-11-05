// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.10;

/**
 * @title IVehicleId
 * @notice This interface defines the functions for interacting with the IVehicleId contract
 */
interface IVehicleId {
    function ownerOf(uint256 tokenId) external view returns (address);

    function exists(uint256 tokenId) external view returns (bool);
}
