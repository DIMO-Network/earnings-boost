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

    error Unauthorized(address addr);
    error InvalidStakeId(uint256 stakeId);
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
    }

    // TODO Documentation
    function createStakingData(uint256 stakeId, StakingData calldata stakingData_) external onlyDimoStaking {
        if (stakingData[stakeId].amount != 0) {
            revert InvalidStakeId(stakeId);
        }

        stakingData[stakeId] = stakingData_;
    }

    // TODO Documentation
    function upgradeStake(uint256 stakeId, StakingData calldata stakingData_) external onlyDimoStaking {
        if (stakingData[stakeId].amount == 0) {
            revert InvalidStakeId(stakeId);
        }

        stakingData[stakeId] = stakingData_;
    }

    // TODO Documentation
    function withdraw(uint256 stakeId) external onlyDimoStaking returns (uint256 amountWithdrawn) {
        StakingData memory stakingData_ = stakingData[stakeId];

        if (stakingData_.amount == 0) {
            revert InvalidStakeId(stakeId);
        }

        amountWithdrawn = stakingData_.amount;

        require(IERC20(dimoToken).transfer(staker, amountWithdrawn), 'Transfer failed');

        delete stakingData[stakeId];
    }

    // TODO Documentation
    function extendStaking(uint256 stakeId, uint256 newLockEndTime) external onlyDimoStaking {
        StakingData storage stakingData_ = stakingData[stakeId];

        if (stakingData_.amount == 0) {
            revert InvalidStakeId(stakeId);
        }

        stakingData_.lockEndTime = newLockEndTime;
    }

    // TODO Documentation
    function attachVehicle(uint256 stakeId, uint256 vehicleId) external onlyDimoStaking {
        StakingData storage stakingData_ = stakingData[stakeId];

        if (stakingData_.amount == 0) {
            revert InvalidStakeId(stakeId);
        }

        stakingData_.vehicleId = vehicleId;
    }

    // TODO Documentation
    function detachVehicle(uint256 stakeId) external onlyDimoStaking {
        uint256 vehicleId = stakingData[stakeId].vehicleId;

        if (vehicleId == 0) {
            revert NoVehicleAttached(stakeId);
        }

        delete stakingData[stakeId].vehicleId;
    }

    // TODO Documentation find a better name
    function transferStake(uint256 stakeId, address to) external onlyDimoStaking {
        require(IERC20(dimoToken).transfer(to, stakingData[stakeId].amount), 'Transfer failed');
        delete stakingData[stakeId];
    }

    // TODO Documentation
    function delegate(address delegatee) external {
        if (msg.sender != dimoStaking && msg.sender != staker) {
            revert Unauthorized(msg.sender);
        }

        IERC20Votes(dimoToken).delegate(delegatee);
    }
}
