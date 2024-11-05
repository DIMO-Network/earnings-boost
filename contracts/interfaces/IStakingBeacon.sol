// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.27;

import '../Types.sol';

/**
 * @title IStakingBeacon
 * @notice This interface defines the functions for the IStakingBeacon contract
 */
interface IStakingBeacon {
    function withdraw(uint256 amount) external;

    function transferStake(uint256 amount, address to) external;

    function delegate(address delegatee) external;

    function dimoStaking() external view returns (address);

    function dimoToken() external view returns (address);

    function staker() external view returns (address);
}
