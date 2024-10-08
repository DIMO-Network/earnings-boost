// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.27;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC721/IERC721.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol';

contract DIMOStaking is Initializable, AccessControlUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    struct DimoStakingStorage {
        address dimoToken;
        address vehicleIdProxy;
        mapping(address => Boost) userBoosts;
        mapping(uint256 => BoostLevel) boostLevels;
    }
    struct Boost {
        uint256 level;
        uint256 amount;
        uint256 lockEndTime;
        uint256 attachedVehicleId;
        bool autoRenew;
    }
    struct BoostLevel {
        uint256 amount;
        uint256 lockPeriod;
        uint256 points;
    }

    bytes32 constant ADMIN_ROLE = keccak256('ADMIN_ROLE');
    bytes32 constant UPGRADER_ROLE = keccak256('UPGRADER_ROLE');

    // keccak256(abi.encode(uint256(keccak256("DIMOStaking.storage")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant DIMO_STAKING_STORAGE = 0x85da7fe116410007e8db80000b74f31d3498f18fcacb661af6fab05d889a7100;

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

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // TODO Documentation
    function initialize(address dimoToken_, address vehicleIdProxy_) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);

        DimoStakingStorage storage $ = _getDimoStakingStorage();

        $.dimoToken = dimoToken_;
        $.vehicleIdProxy = vehicleIdProxy_;

        // Initialize boost levels
        $.boostLevels[0] = BoostLevel(5000 ether, 180 days, 1000);
        $.boostLevels[1] = BoostLevel(10000 ether, 365 days, 2000);
        $.boostLevels[2] = BoostLevel(15000 ether, 730 days, 3000);
    }

    // TODO Documentation
    function stake(uint256 level, uint256 vehicleId, bool autoRenew) external {
        DimoStakingStorage storage $ = _getDimoStakingStorage();

        if ($.userBoosts[msg.sender].amount > 0) {
            revert UserAlreadyHasBoost(msg.sender);
        }
        if (level > 2) {
            revert InvalidBoostLevel(level);
        }

        BoostLevel memory stakingLevel = $.boostLevels[level];
        require(IERC20($.dimoToken).transferFrom(msg.sender, address(this), stakingLevel.amount), 'Transfer failed');

        $.userBoosts[msg.sender] = Boost({
            level: level,
            amount: stakingLevel.amount,
            lockEndTime: block.timestamp + stakingLevel.lockPeriod,
            attachedVehicleId: vehicleId,
            autoRenew: autoRenew
        });

        emit Staked(msg.sender, stakingLevel.amount, level, $.userBoosts[msg.sender].lockEndTime);

        if (vehicleId != 0) {
            try IERC721($.vehicleIdProxy).ownerOf(vehicleId) returns (address vehicleIdOwner) {
                if (vehicleIdOwner != msg.sender) {
                    revert Unauthorized(msg.sender);
                }
                emit BoostAttached(msg.sender, vehicleId);
            } catch {
                revert InvalidVehicleId(vehicleId);
            }
        }
    }

    // TODO Documentation
    function upgradeStake(uint256 level, uint256 vehicleId, bool autoRenew) external {
        DimoStakingStorage storage $ = _getDimoStakingStorage();

        Boost memory boost = $.userBoosts[msg.sender];

        if (boost.amount == 0) {
            revert NoActiveBoost();
        }
        if (level > 2 || boost.level >= level) {
            revert InvalidBoostLevel(level);
        }

        BoostLevel memory stakingLevel = $.boostLevels[level];
        uint256 amountDiff = stakingLevel.amount - $.boostLevels[boost.level].amount;
        require(IERC20($.dimoToken).transferFrom(msg.sender, address(this), amountDiff), 'Transfer failed');

        uint256 currentAttachedVehicleId = boost.attachedVehicleId;

        $.userBoosts[msg.sender] = Boost({
            level: level,
            amount: stakingLevel.amount,
            lockEndTime: block.timestamp + stakingLevel.lockPeriod,
            attachedVehicleId: vehicleId,
            autoRenew: autoRenew
        });

        emit Staked(msg.sender, stakingLevel.amount, level, $.userBoosts[msg.sender].lockEndTime);

        if (vehicleId != currentAttachedVehicleId) {
            // TODO Should the user able to detach here?
            if (vehicleId == 0) {
                emit BoostDetached(msg.sender, vehicleId);
            } else {
                try IERC721($.vehicleIdProxy).ownerOf(vehicleId) returns (address vehicleIdOwner) {
                    if (vehicleIdOwner != msg.sender) {
                        revert Unauthorized(msg.sender);
                    }
                    emit BoostAttached(msg.sender, vehicleId);
                } catch {
                    revert InvalidVehicleId(vehicleId);
                }
            }
        }
    }

    // TODO Documentation
    function withdraw() external nonReentrant {
        DimoStakingStorage storage $ = _getDimoStakingStorage();

        Boost storage boost = $.userBoosts[msg.sender];
        if (boost.amount == 0) {
            revert NoActiveBoost();
        }
        if (block.timestamp < boost.lockEndTime) {
            revert TokensStillLocked();
        }
        // TODO Do we need this?
        if (boost.autoRenew) {
            revert AutoRenewActive();
        }
        // TODO Should dettach vehicle?

        uint256 amount = boost.amount;
        delete $.userBoosts[msg.sender];

        require(IERC20($.dimoToken).transfer(msg.sender, amount), 'Transfer failed');
        emit Withdrawn(msg.sender, amount);
    }

    // TODO Documentation
    function extendBoost() external {
        DimoStakingStorage storage $ = _getDimoStakingStorage();

        Boost storage boost = $.userBoosts[msg.sender];
        if (boost.amount == 0) {
            revert NoActiveBoost();
        }

        BoostLevel memory level = $.boostLevels[boost.level];
        boost.lockEndTime = block.timestamp + level.lockPeriod;

        emit BoostExtended(msg.sender, boost.lockEndTime);
    }

    // TODO Documentation
    function attachVehicle(uint256 vehicleId) external {
        // TODO handle vehicle ID transfer
        DimoStakingStorage storage $ = _getDimoStakingStorage();

        try IERC721($.vehicleIdProxy).ownerOf(vehicleId) returns (address vehicleIdOwner) {
            if (vehicleIdOwner != msg.sender) {
                revert Unauthorized(msg.sender);
            }

            Boost storage boost = $.userBoosts[msg.sender];

            if (boost.amount == 0) {
                revert NoActiveBoost();
            }
            // TODO Should we let the user reattach?
            if (boost.attachedVehicleId != 0) {
                revert BoostAlreadyAttached();
            }

            boost.attachedVehicleId = vehicleId;

            emit BoostAttached(msg.sender, vehicleId);
        } catch {
            revert InvalidVehicleId(vehicleId);
        }
    }

    // TODO Documentation
    function detachVehicle() external {
        DimoStakingStorage storage $ = _getDimoStakingStorage();

        Boost storage boost = $.userBoosts[msg.sender];
        if (boost.attachedVehicleId == 0) {
            revert NoVehicleAttached();
        }

        uint256 vehicleId = boost.attachedVehicleId;
        delete boost.attachedVehicleId;

        emit BoostDetached(msg.sender, vehicleId);
    }

    // TODO Documentation
    function setAutoRenew(bool autoRenew) external {
        _getDimoStakingStorage().userBoosts[msg.sender].autoRenew = autoRenew;
    }

    // TODO Documentation
    function dimoToken() external view returns (address) {
        return _getDimoStakingStorage().dimoToken;
    }

    // TODO Documentation
    function vehicleIdProxy() external view returns (address) {
        return _getDimoStakingStorage().vehicleIdProxy;
    }

    // TODO Documentation
    function userBoosts(address user) external view returns (Boost memory) {
        return _getDimoStakingStorage().userBoosts[user];
    }

    // TODO Documentation
    function boostLevels(uint256 level) external view returns (BoostLevel memory) {
        return _getDimoStakingStorage().boostLevels[level];
    }

    // TODO Documentation
    function getBoostLevel(address user) external view returns (uint256) {
        return _getDimoStakingStorage().userBoosts[user].level;
    }

    // TODO Documentation
    function getAttachedVehicle(address user) external view returns (uint256) {
        return _getDimoStakingStorage().userBoosts[user].attachedVehicleId;
    }

    // TODO Documentation
    function getLockEndTime(address user) external view returns (uint256) {
        return _getDimoStakingStorage().userBoosts[user].lockEndTime;
    }

    // TODO Documentation
    function getBoostPoints(address user) external view returns (uint256) {
        DimoStakingStorage storage $ = _getDimoStakingStorage();

        Boost memory boost = $.userBoosts[user];

        if (boost.amount == 0) return 0;
        if (boost.lockEndTime < block.timestamp && !boost.autoRenew) return 0;

        return $.boostLevels[boost.level].points;
    }

    // TODO Documentation
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(UPGRADER_ROLE) {}

    /**
     * @dev Returns a pointer to the storage namespace
     */
    function _getDimoStakingStorage() private pure returns (DimoStakingStorage storage $) {
        assembly {
            $.slot := DIMO_STAKING_STORAGE
        }
    }
}
