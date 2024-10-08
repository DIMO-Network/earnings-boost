// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.27;

import '@openzeppelin/contracts/token/ERC721/IERC721.sol';
import '@openzeppelin/contracts/utils/ReentrancyGuard.sol';

import './interfaces/IERC20Votes.sol';

contract Boost is ReentrancyGuard {
    struct BoostLevel {
        uint256 amount;
        uint256 lockPeriod;
        uint256 points;
    }

    address public dimoToken;
    address public vehicleIdProxy;
    address public beneficiary;
    uint256 public level;
    uint256 public amount;
    uint256 public lockEndTime;
    uint256 public attachedVehicleId;
    bool public autoRenew;

    mapping(uint256 => BoostLevel) boostLevels;

    event Staked(address indexed user, uint256 amount, uint256 level, uint256 lockEndTime);
    event Withdrawn(address indexed user, uint256 amount);
    event BoostAttached(address indexed user, uint256 indexed vehicleId);
    event BoostDetached(address indexed user, uint256 indexed vehicleId);
    event BoostExtended(address indexed user, uint256 newLockEndTime);

    error InvalidBoostLevel(uint256 level);
    error UserAlreadyHasBoost(address user);
    error TokensStillLocked();
    error AutoRenewActive();
    error Unauthorized(address addr);
    error InvalidVehicleId(uint256 vehicleId);
    error NoActiveBoost();
    error BoostAlreadyAttached();
    error NoVehicleAttached();

    // TODO Documentation
    constructor(
        address dimoToken_,
        address vehicleIdProxy_,
        address beneficiary_,
        uint256 level_,
        uint256 amount_,
        uint256 lockEndTime_,
        uint256 vehicleId,
        bool autoRenew_
    ) {
        dimoToken = dimoToken_;
        vehicleIdProxy = vehicleIdProxy_;

        // Initialize boost levels
        boostLevels[0] = BoostLevel(5000 ether, 180 days, 1000);
        boostLevels[1] = BoostLevel(10000 ether, 365 days, 2000);
        boostLevels[2] = BoostLevel(15000 ether, 730 days, 3000);

        beneficiary = beneficiary_;
        level = level_;
        amount = amount_;
        lockEndTime = lockEndTime_;
        attachedVehicleId = vehicleId;
        autoRenew = autoRenew_;

        emit Staked(beneficiary_, amount_, level_, lockEndTime_);

        if (vehicleId != 0) {
            try IERC721(vehicleIdProxy).ownerOf(vehicleId) returns (address vehicleIdOwner) {
                if (vehicleIdOwner != beneficiary_) {
                    revert Unauthorized(beneficiary_);
                }
                emit BoostAttached(beneficiary_, vehicleId);
            } catch {
                revert InvalidVehicleId(vehicleId);
            }
        }
    }

    // TODO Documentation
    // function upgradeStake(uint256 level_, uint256 vehicleId, bool autoRenew_) external {
    //     if (amount == 0) {
    //         revert NoActiveBoost();
    //     }
    //     if (level_ > 2 || level >= level_) {
    //         revert InvalidBoostLevel(level_);
    //     }

    //     BoostLevel memory stakingLevel = $.boostLevels[level_];
    //     uint256 amountDiff = stakingLevel.amount - $.boostLevels[boost.level].amount;
    //     require(IERC20($.dimoToken).transferFrom(msg.sender, address(this), amountDiff), 'Transfer failed');

    //     uint256 currentAttachedVehicleId = boost.attachedVehicleId;

    //     $.userBoosts[msg.sender] = Boost({
    //         level: level,
    //         amount: stakingLevel.amount,
    //         lockEndTime: block.timestamp + stakingLevel.lockPeriod,
    //         attachedVehicleId: vehicleId,
    //         autoRenew: autoRenew_
    //     });

    //     emit Staked(msg.sender, stakingLevel.amount, level_, $.userBoosts[msg.sender].lockEndTime);

    //     if (vehicleId != currentAttachedVehicleId) {
    //         // TODO Should the user able to detach here?
    //         if (vehicleId == 0) {
    //             emit BoostDetached(msg.sender, vehicleId);
    //         } else {
    //             try IERC721($.vehicleIdProxy).ownerOf(vehicleId) returns (address vehicleIdOwner) {
    //                 if (vehicleIdOwner != msg.sender) {
    //                     revert Unauthorized(msg.sender);
    //                 }
    //                 emit BoostAttached(msg.sender, vehicleId);
    //             } catch {
    //                 revert InvalidVehicleId(vehicleId);
    //             }
    //         }
    //     }
    // }

    // TODO Documentation
    function withdraw() external nonReentrant {
        if (amount == 0) {
            revert NoActiveBoost();
        }
        if (block.timestamp < lockEndTime) {
            revert TokensStillLocked();
        }
        // TODO Do we need this?
        if (autoRenew) {
            revert AutoRenewActive();
        }
        // TODO Should dettach vehicle?
        // delete attachedVehicleId;

        delete beneficiary;
        delete level;
        delete amount;
        delete lockEndTime;
        delete autoRenew;

        require(IERC20(dimoToken).transfer(beneficiary, amount), 'Transfer failed');
        emit Withdrawn(beneficiary, amount);
    }

    // TODO Documentation
    function extendBoost() external {
        if (amount == 0) {
            revert NoActiveBoost();
        }

        lockEndTime = block.timestamp + boostLevels[level].lockPeriod;

        emit BoostExtended(beneficiary, lockEndTime);
    }

    // TODO Documentation
    function attachVehicle(uint256 vehicleId) external {
        // TODO handle vehicle ID transfer
        try IERC721(vehicleIdProxy).ownerOf(vehicleId) returns (address vehicleIdOwner) {
            if (vehicleIdOwner != beneficiary) {
                revert Unauthorized(beneficiary);
            }
            if (amount == 0) {
                revert NoActiveBoost();
            }
            // TODO Should we let the user reattach?
            if (attachedVehicleId != 0) {
                revert BoostAlreadyAttached();
            }

            attachedVehicleId = vehicleId;

            emit BoostAttached(beneficiary, vehicleId);
        } catch {
            revert InvalidVehicleId(vehicleId);
        }
    }

    // TODO Documentation
    function detachVehicle() external {
        if (attachedVehicleId == 0) {
            revert NoVehicleAttached();
        }

        uint256 vehicleId = attachedVehicleId;
        delete attachedVehicleId;

        emit BoostDetached(beneficiary, vehicleId);
    }

    // TODO Documentation
    function setAutoRenew(bool autoRenew_) external {
        autoRenew = autoRenew_;
    }

    // TODO Documentation
    function delegate(address delegatee) external {
        if (msg.sender != beneficiary) {
            revert Unauthorized(msg.sender);
        }

        IERC20Votes(dimoToken).delegate(delegatee);
    }

    // TODO Documentation
    function getBoostPoints() external view returns (uint256) {
        if (amount == 0) return 0;
        if (lockEndTime < block.timestamp && !autoRenew) return 0;

        return boostLevels[level].points;
    }
}
