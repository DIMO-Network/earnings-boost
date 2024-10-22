// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.27;

import '@openzeppelin/contracts/token/ERC721/IERC721.sol';

import './Types.sol';
import './interfaces/IERC20Votes.sol';

contract Boost {
    address public dimoStaking;
    address public dimoToken;
    address public vehicleIdProxy;
    address public immutable beneficiary;

    BoostData public boostData;

    error TokensStillLocked();
    error Unauthorized(address addr);
    error NoActiveBoost();
    error NoVehicleAttached();

    modifier onlyDimoStaking() {
        if (msg.sender != dimoStaking) {
            revert Unauthorized(msg.sender);
        }
        _;
    }

    // TODO Documentation
    constructor(address dimoToken_, address vehicleIdProxy_, address beneficiary_, BoostData memory boostData_) {
        dimoStaking = msg.sender;
        dimoToken = dimoToken_;
        vehicleIdProxy = vehicleIdProxy_;

        beneficiary = beneficiary_;
        boostData = boostData_;
    }

    // TODO Documentation
    function setBoostData(BoostData calldata boostData_) external onlyDimoStaking {
        boostData = boostData_;
    }

    // TODO Documentation
    function withdraw() external onlyDimoStaking returns (uint256 amountWithdrawn) {
        if (boostData.amount == 0) {
            revert NoActiveBoost();
        }
        if (block.timestamp < boostData.lockEndTime) {
            revert TokensStillLocked();
        }

        amountWithdrawn = boostData.amount;

        require(IERC20(dimoToken).transfer(beneficiary, amountWithdrawn), 'Transfer failed');

        delete boostData;
    }

    // TODO Documentation
    function extendBoost(uint256 newLockEndTime) external onlyDimoStaking {
        if (boostData.amount == 0) {
            revert NoActiveBoost();
        }

        boostData.lockEndTime = newLockEndTime;
    }

    // TODO Documentation
    function attachVehicle(uint256 vehicleId) external onlyDimoStaking {
        if (boostData.amount == 0) {
            revert NoActiveBoost();
        }

        boostData.vehicleId = vehicleId;
    }

    // TODO Documentation
    function detachVehicle() external onlyDimoStaking returns (uint256 detachedVehicle) {
        if (boostData.amount == 0) {
            revert NoActiveBoost();
        }
        if (boostData.vehicleId == 0) {
            revert NoVehicleAttached();
        }

        detachedVehicle = boostData.vehicleId;
        delete boostData.vehicleId;
    }

    // TODO Documentation
    function delegate(address delegatee) external {
        if (msg.sender != dimoStaking && msg.sender != beneficiary) {
            revert Unauthorized(msg.sender);
        }

        IERC20Votes(dimoToken).delegate(delegatee);
    }
}
