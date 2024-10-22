// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.27;

import '../Types.sol';

interface IBoost {
    function setBoostData(BoostData calldata boostData_) external;

    function withdraw() external returns (uint256);

    function extendBoost(uint256 newLockEndTime) external;

    function attachVehicle(uint256 vehicleId) external;

    function detachVehicle() external returns (uint256);

    function setAutoRenew(bool autoRenew) external;

    function delegate(address delegatee) external;

    function boostData() external view returns (BoostData memory);
}
