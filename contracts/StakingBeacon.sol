// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.27;

import '@openzeppelin/contracts/token/ERC721/IERC721.sol';

import './Types.sol';
import './interfaces/IERC20Votes.sol';

contract StakingBeacon {
    address public dimoStaking;
    address public dimoToken;
    address public vehicleIdProxy;
    address public immutable staker;

    mapping(uint256 stakeId => StakingData) public stakingData;
    mapping(uint256 vehicleId => uint256 stakeId) public vehicleIdToStakeId;

    error Unauthorized(address addr);
    error NoActiveStaking(uint256 stakeId);
    error NoVehicleAttached(uint256 stakeId);

    modifier onlyDimoStaking() {
        if (msg.sender != dimoStaking) {
            revert Unauthorized(msg.sender);
        }
        _;
    }

    // TODO Documentation
    constructor(
        address dimoToken_,
        address vehicleIdProxy_,
        address staker_,
        uint256 stakeId_,
        StakingData memory stakingData_
    ) {
        dimoStaking = msg.sender;
        dimoToken = dimoToken_;
        vehicleIdProxy = vehicleIdProxy_;
        staker = staker_;

        stakingData[stakeId_] = stakingData_;

        if (stakingData_.vehicleId != 0) {
            vehicleIdToStakeId[stakingData_.vehicleId] = stakeId_;
        }
    }

    // TODO Documentation
    function setStakingData(uint256 stakeId, StakingData calldata stakingData_) external onlyDimoStaking {
        stakingData[stakeId] = stakingData_;
    }

    // TODO Documentation
    function withdraw(uint256 stakeId) external onlyDimoStaking returns (uint256 amountWithdrawn) {
        StakingData memory stakingData_ = stakingData[stakeId];

        if (stakingData_.amount == 0) {
            revert NoActiveStaking(stakeId);
        }

        amountWithdrawn = stakingData_.amount;

        require(IERC20(dimoToken).transfer(staker, amountWithdrawn), 'Transfer failed');

        delete stakingData[stakeId];
    }

    // TODO Documentation
    function extendStaking(uint256 stakeId, uint256 newLockEndTime) external onlyDimoStaking {
        StakingData storage stakingData_ = stakingData[stakeId];

        if (stakingData_.amount == 0) {
            revert NoActiveStaking(stakeId);
        }

        stakingData_.lockEndTime = newLockEndTime;
    }

    // TODO Documentation
    function attachVehicle(uint256 stakeId, uint256 vehicleId) external onlyDimoStaking {
        StakingData storage stakingData_ = stakingData[stakeId];

        if (stakingData_.amount == 0) {
            revert NoActiveStaking(stakeId);
        }

        stakingData_.vehicleId = vehicleId;
        vehicleIdToStakeId[vehicleId] = stakeId;
    }

    // TODO Documentation
    function detachVehicle(uint256 vehicleId) external onlyDimoStaking returns (uint256 stakeId) {
        stakeId = vehicleIdToStakeId[vehicleId];

        if (stakeId == 0) {
            revert NoVehicleAttached(stakeId);
        }

        delete stakingData[stakeId].vehicleId;
        delete vehicleIdToStakeId[vehicleId];
    }

    // TODO Documentation
    function delegate(address delegatee) external {
        if (msg.sender != dimoStaking && msg.sender != staker) {
            revert Unauthorized(msg.sender);
        }

        IERC20Votes(dimoToken).delegate(delegatee);
    }
}
