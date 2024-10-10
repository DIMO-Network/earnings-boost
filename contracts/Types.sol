// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.27;

struct BoostData {
    uint256 level;
    uint256 amount;
    uint256 lockEndTime;
    uint256 vehicleId;
    bool autoRenew;
}
