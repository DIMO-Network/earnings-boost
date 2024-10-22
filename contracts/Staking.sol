// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.27;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC721/IERC721.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol';

import './Boost.sol';
import './Types.sol';
import './interfaces/IBoost.sol';

contract DIMOStaking is Initializable, AccessControlUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    struct DimoStakingStorage {
        address dimoToken;
        address vehicleIdProxy;
        address boost;
        mapping(address => address) userBoosts;
        // TODO Maybe we should ignore the level, it does not mean much
        mapping(uint256 => BoostLevel) boostLevels;
    }
    struct StakeInput {
        address beneficiary;
        uint256 level;
        uint256 vehicleId;
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

    event Staked(address indexed user, address indexed boost, uint256 amount, uint256 level, uint256 lockEndTime);
    event Withdrawn(address indexed user, uint256 amount);
    event BoostAttached(address indexed user, uint256 indexed vehicleId);
    event BoostDetached(address indexed user, uint256 indexed vehicleId);
    event BoostExtended(address indexed user, uint256 newLockEndTime);

    error InvalidBoostLevel(uint256 level);
    error UserAlreadyHasBoost(address user);
    error TokensStillLocked();
    error Unauthorized(address addr, uint256 vehicleId);
    error InvalidVehicleId(uint256 vehicleId);
    error NoActiveBoost();
    error BoostAlreadyAttached();
    error NoVehicleAttached();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // TODO Documentation
    function initialize(address dimoToken_, address vehicleIdProxy_, address boost_) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);

        DimoStakingStorage storage $ = _getDimoStakingStorage();

        $.dimoToken = dimoToken_;
        $.vehicleIdProxy = vehicleIdProxy_;
        $.boost = boost_;

        // Initialize boost levels
        $.boostLevels[0] = BoostLevel(500 ether, 180 days, 1000);
        $.boostLevels[1] = BoostLevel(1500 ether, 365 days, 2000);
        $.boostLevels[2] = BoostLevel(4000 ether, 730 days, 3000);
    }

    // TODO Documentation
    function stake(StakeInput calldata stakeInput) external {
        DimoStakingStorage storage $ = _getDimoStakingStorage();

        if (stakeInput.level > 2) {
            revert InvalidBoostLevel(stakeInput.level);
        }

        BoostLevel memory boostLevel = $.boostLevels[stakeInput.level];
        BoostData memory boostData = BoostData({
            level: stakeInput.level,
            amount: boostLevel.amount,
            lockEndTime: block.timestamp + boostLevel.lockPeriod,
            vehicleId: stakeInput.vehicleId
        });

        address boost = $.userBoosts[msg.sender];
        if (boost != address(0)) {
            BoostData memory currentBoostData = IBoost(boost).boostData();

            if (currentBoostData.amount > 0) {
                revert UserAlreadyHasBoost(msg.sender);
            }

            IBoost(boost).setBoostData(boostData);
        } else {
            boost = address(new Boost($.dimoToken, $.vehicleIdProxy, stakeInput.beneficiary, boostData));
        }

        require(IERC20($.dimoToken).transferFrom(msg.sender, boost, boostLevel.amount), 'Transfer failed');

        emit Staked(msg.sender, boost, boostLevel.amount, stakeInput.level, boostData.lockEndTime);

        if (stakeInput.vehicleId != 0) {
            try IERC721($.vehicleIdProxy).ownerOf(stakeInput.vehicleId) returns (address vehicleIdOwner) {
                if (vehicleIdOwner != stakeInput.beneficiary) {
                    revert Unauthorized(stakeInput.beneficiary, stakeInput.vehicleId);
                }
                emit BoostAttached(stakeInput.beneficiary, boostData.vehicleId);
            } catch {
                revert InvalidVehicleId(stakeInput.vehicleId);
            }
        }
    }

    // TODO Documentation
    function upgradeStake(uint256 level, uint256 vehicleId) external {
        DimoStakingStorage storage $ = _getDimoStakingStorage();

        if ($.userBoosts[msg.sender] == address(0)) {
            revert NoActiveBoost();
        }

        IBoost boost = IBoost($.userBoosts[msg.sender]);
        BoostData memory currentBoostData = boost.boostData();

        if (level > 2 || currentBoostData.level >= level) {
            revert InvalidBoostLevel(level);
        }

        BoostLevel memory stakingLevel = $.boostLevels[level];
        uint256 amountDiff = stakingLevel.amount - $.boostLevels[currentBoostData.level].amount;
        require(IERC20($.dimoToken).transferFrom(msg.sender, address(this), amountDiff), 'Transfer failed');

        uint256 currentAttachedVehicleId = currentBoostData.vehicleId;

        BoostData memory newBoostData = BoostData({
            level: level,
            amount: stakingLevel.amount,
            lockEndTime: block.timestamp + stakingLevel.lockPeriod,
            vehicleId: vehicleId
        });

        boost.setBoostData(newBoostData);

        emit Staked(msg.sender, address(boost), newBoostData.amount, level, newBoostData.lockEndTime);

        if (vehicleId != currentAttachedVehicleId) {
            // TODO Should the user able to detach here?
            if (vehicleId == 0) {
                emit BoostDetached(msg.sender, currentAttachedVehicleId);
            } else {
                try IERC721($.vehicleIdProxy).ownerOf(vehicleId) returns (address vehicleIdOwner) {
                    if (vehicleIdOwner != msg.sender) {
                        revert Unauthorized(msg.sender, vehicleId);
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

        if ($.userBoosts[msg.sender] == address(0)) {
            revert NoActiveBoost();
        }

        IBoost boost = IBoost($.userBoosts[msg.sender]);
        BoostData memory currentBoostData = boost.boostData();

        if (currentBoostData.vehicleId != 0) {
            emit BoostDetached(msg.sender, currentBoostData.vehicleId);
        }

        uint256 amountWithdrawn = boost.withdraw();

        emit Withdrawn(msg.sender, amountWithdrawn);
    }

    // TODO Documentation
    function extendBoost() external {
        DimoStakingStorage storage $ = _getDimoStakingStorage();

        if ($.userBoosts[msg.sender] == address(0)) {
            revert NoActiveBoost();
        }

        IBoost boost = IBoost($.userBoosts[msg.sender]);
        BoostData memory currentBoostData = boost.boostData();

        uint256 newLockEndTime = block.timestamp + $.boostLevels[currentBoostData.level].lockPeriod;

        boost.extendBoost(newLockEndTime);

        emit BoostExtended(msg.sender, newLockEndTime);
    }

    // TODO Documentation
    function attachVehicle(uint256 vehicleId) external {
        // TODO handle vehicle ID transfer
        DimoStakingStorage storage $ = _getDimoStakingStorage();

        try IERC721($.vehicleIdProxy).ownerOf(vehicleId) returns (address vehicleIdOwner) {
            if (vehicleIdOwner != msg.sender) {
                revert Unauthorized(msg.sender, vehicleId);
            }

            if ($.userBoosts[msg.sender] == address(0)) {
                revert NoActiveBoost();
            }

            IBoost($.userBoosts[msg.sender]).attachVehicle(vehicleId);

            emit BoostAttached(msg.sender, vehicleId);
        } catch {
            revert InvalidVehicleId(vehicleId);
        }
    }

    // TODO Documentation
    function detachVehicle() external {
        DimoStakingStorage storage $ = _getDimoStakingStorage();

        if ($.userBoosts[msg.sender] == address(0)) {
            revert NoActiveBoost();
        }

        uint256 detachedVehicle = IBoost($.userBoosts[msg.sender]).detachVehicle();

        emit BoostDetached(msg.sender, detachedVehicle);
    }

    // TODO Documentation
    function delegate(address delegatee) external {
        DimoStakingStorage storage $ = _getDimoStakingStorage();

        if ($.userBoosts[msg.sender] == address(0)) {
            revert NoActiveBoost();
        }

        IBoost($.userBoosts[msg.sender]).delegate(delegatee);
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
    function userBoosts(address user) external view returns (address) {
        return _getDimoStakingStorage().userBoosts[user];
    }

    // TODO Documentation
    function boostLevels(uint256 level) external view returns (BoostLevel memory) {
        return _getDimoStakingStorage().boostLevels[level];
    }

    // TODO Documentation
    function getBoostPoints(address user) external view returns (uint256) {
        DimoStakingStorage storage $ = _getDimoStakingStorage();

        if ($.userBoosts[user] == address(0)) {
            return 0;
        }

        BoostData memory currentBoostData = IBoost($.userBoosts[user]).boostData();

        if (currentBoostData.amount == 0) return 0;
        if (currentBoostData.lockEndTime < block.timestamp) return 0;

        return $.boostLevels[currentBoostData.level].points;
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
