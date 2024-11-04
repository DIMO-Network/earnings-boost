// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.27;

import '../Types.sol';

interface IStakingBeacon {
    function createStakingData(uint256 stakeId, StakingData calldata stakingData_) external;

    function upgradeStake(uint256 stakeId, StakingData calldata stakingData_) external;

    function withdraw(uint256 stakeId) external returns (uint256);

    function extendStaking(uint256 stakeId, uint256 newLockEndTime) external;

    function attachVehicle(uint256 stakeId, uint256 vehicleId) external;

    function detachVehicle(uint256 stakeId) external;

    function transferStake(uint256 stakeId, address to) external;

    function delegate(address delegatee) external;

    function staker() external view returns (address);

    function stakingData(uint256 stakeId) external view returns (StakingData memory);
}
