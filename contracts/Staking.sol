// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.27;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC721/IERC721.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol';

import './StakingBeacon.sol';
import './Types.sol';
import './interfaces/IStakingBeacon.sol';
import './interfaces/IVehicleId.sol';

contract DIMOStaking is Initializable, ERC721Upgradeable, AccessControlUpgradeable, UUPSUpgradeable {
    struct DimoStakingStorage {
        address dimoToken;
        address vehicleIdProxy;
        uint256 currentStakeId;
        // TODO Maybe we should ignore the level, it does not mean much
        mapping(uint256 => StakingLevel) stakingLevels;
        // TODO I am not really using this mapping now, should remove?
        mapping(uint256 stakeId => address stakerContract) stakeIdToStake;
        mapping(address staker => address stakerContract) stakerToStake;
        mapping(uint256 vehicleTokenId => uint256 stakeId) vehicleIdToStakeId;
    }
    struct StakingLevel {
        uint256 amount;
        uint256 lockPeriod;
        uint256 points;
    }

    bytes32 constant ADMIN_ROLE = keccak256('ADMIN_ROLE');
    bytes32 constant UPGRADER_ROLE = keccak256('UPGRADER_ROLE');

    // keccak256(abi.encode(uint256(keccak256("DIMOStaking.storage")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant DIMO_STAKING_STORAGE = 0x85da7fe116410007e8db80000b74f31d3498f18fcacb661af6fab05d889a7100;

    event Staked(
        address indexed user,
        uint256 indexed stakeId,
        address indexed stakingBeacon,
        uint256 amount,
        uint256 level,
        uint256 lockEndTime
    );
    event Withdrawn(address indexed user, uint256 indexed stakeId, uint256 amount);
    event VehicleAttached(address indexed user, uint256 indexed stakeId, uint256 indexed vehicleId);
    event VehicleDetached(address indexed user, uint256 indexed stakeId, uint256 indexed vehicleId);
    event StakingExtended(address indexed user, uint256 indexed stakeId, uint256 newLockEndTime);

    error InvalidStakingLevel(uint256 level);
    error TokensStillLocked(uint256 stakeId);
    error Unauthorized(address addr, uint256 vehicleId);
    error InvalidVehicleId(uint256 vehicleId);
    error NoActiveStaking(address user);
    error VehicleAlreadyAttached(uint256 vehicleId);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // TODO Documentation
    function initialize(address dimoToken_, address vehicleIdProxy_) external initializer {
        __AccessControl_init();
        __ERC721_init('DIMO Staking', 'DSTK');
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);

        DimoStakingStorage storage $ = _getDimoStakingStorage();

        $.dimoToken = dimoToken_;
        $.vehicleIdProxy = vehicleIdProxy_;

        // Initialize staking levels
        $.stakingLevels[0] = StakingLevel(500 ether, 180 days, 1000);
        $.stakingLevels[1] = StakingLevel(1500 ether, 365 days, 2000);
        $.stakingLevels[2] = StakingLevel(4000 ether, 730 days, 3000);
    }

    // TODO Documentation
    // If staker has no StakingBeacon, create one and a stake ID. Otherwise, just a new stake ID
    function stake(uint256 level, uint256 vehicleId) external {
        DimoStakingStorage storage $ = _getDimoStakingStorage();

        if (level > 2) {
            revert InvalidStakingLevel(level);
        }

        uint256 currentStakeId = ++$.currentStakeId;
        StakingLevel memory stakingLevel = $.stakingLevels[level];
        StakingData memory stakingData = StakingData({
            level: level,
            amount: stakingLevel.amount,
            lockEndTime: block.timestamp + stakingLevel.lockPeriod,
            vehicleId: vehicleId
        });

        address stakingBeaconAddress = $.stakerToStake[msg.sender];
        if (stakingBeaconAddress == address(0)) {
            // Creates a new StakingBeacon
            stakingBeaconAddress = address(
                new StakingBeacon($.dimoToken, $.vehicleIdProxy, msg.sender, currentStakeId, stakingData)
            );

            $.stakerToStake[msg.sender] = stakingBeaconAddress;
        } else {
            // Creates a stakeId in an existing StakingBeacon
            IStakingBeacon(stakingBeaconAddress).createStakingData(currentStakeId, stakingData);
        }

        $.stakeIdToStake[currentStakeId] = stakingBeaconAddress;

        require(
            IERC20($.dimoToken).transferFrom(msg.sender, stakingBeaconAddress, stakingLevel.amount),
            'Transfer failed'
        );

        emit Staked(
            msg.sender,
            currentStakeId,
            stakingBeaconAddress,
            stakingLevel.amount,
            level,
            stakingData.lockEndTime
        );

        if (vehicleId != 0) {
            if (!IVehicleId($.vehicleIdProxy).exists(vehicleId)) {
                revert InvalidVehicleId(vehicleId);
            }

            uint256 attachedStakeId = $.vehicleIdToStakeId[vehicleId];
            if (attachedStakeId != 0) {
                // If vehicle ID is already attached and not expired
                if (getBaselinePoints(vehicleId) > 0) {
                    revert VehicleAlreadyAttached(vehicleId);
                }

                // Expired Stake will have Vehicle detached
                IStakingBeacon($.stakeIdToStake[attachedStakeId]).detachVehicle(attachedStakeId);

                emit VehicleDetached(msg.sender, attachedStakeId, vehicleId);
            }

            $.vehicleIdToStakeId[vehicleId] = currentStakeId;
            emit VehicleAttached(msg.sender, currentStakeId, vehicleId);
        }
    }

    // TODO Documentation
    function upgradeStake(uint256 stakeId, uint256 level, uint256 vehicleId) external {
        DimoStakingStorage storage $ = _getDimoStakingStorage();
        IStakingBeacon staking = IStakingBeacon($.stakerToStake[msg.sender]);

        if (address(staking) == address(0)) {
            revert NoActiveStaking(msg.sender);
        }

        StakingData memory stakingData = staking.stakingData(stakeId);

        if (level > 2 || stakingData.level >= level) {
            revert InvalidStakingLevel(level);
        }

        StakingLevel memory stakingLevel = $.stakingLevels[level];
        uint256 amountDiff = stakingLevel.amount - $.stakingLevels[stakingData.level].amount;
        require(IERC20($.dimoToken).transferFrom(msg.sender, address(staking), amountDiff), 'Transfer failed');

        uint256 currentAttachedVehicleId = stakingData.vehicleId;

        StakingData memory newStakingData = StakingData({
            level: level,
            amount: stakingLevel.amount,
            lockEndTime: block.timestamp + stakingLevel.lockPeriod,
            vehicleId: vehicleId
        });

        staking.upgradeStake(stakeId, newStakingData);

        emit Staked(msg.sender, stakeId, address(staking), newStakingData.amount, level, newStakingData.lockEndTime);

        if (vehicleId != currentAttachedVehicleId) {
            if (vehicleId == 0) {
                delete $.vehicleIdToStakeId[currentAttachedVehicleId];
                emit VehicleDetached(msg.sender, stakeId, currentAttachedVehicleId);
            } else if (IVehicleId($.vehicleIdProxy).exists(vehicleId)) {
                uint256 attachedStakeId = $.vehicleIdToStakeId[vehicleId];
                if (attachedStakeId != 0) {
                    // If vehicle ID is already attached and not expired
                    if (getBaselinePoints(vehicleId) > 0) {
                        revert VehicleAlreadyAttached(vehicleId);
                    }

                    // Current attached Vehicle ID will be replaced
                    delete $.vehicleIdToStakeId[currentAttachedVehicleId];
                    // Expired Stake will have Vehicle detached
                    IStakingBeacon($.stakeIdToStake[attachedStakeId]).detachVehicle(vehicleId);

                    emit VehicleDetached(msg.sender, attachedStakeId, vehicleId);
                }

                $.vehicleIdToStakeId[vehicleId] = stakeId;
                emit VehicleAttached(msg.sender, stakeId, vehicleId);
            } else {
                revert InvalidVehicleId(vehicleId);
            }
        }
    }

    // TODO Documentation
    function withdraw(uint256 stakeId) external {
        IStakingBeacon staking = IStakingBeacon(_getDimoStakingStorage().stakerToStake[msg.sender]);

        if (address(staking) == address(0)) {
            revert NoActiveStaking(msg.sender);
        }

        StakingData memory stakingData = staking.stakingData(stakeId);

        if (block.timestamp < stakingData.lockEndTime) {
            revert TokensStillLocked(stakeId);
        }
        if (stakingData.vehicleId != 0) {
            emit VehicleDetached(msg.sender, stakeId, stakingData.vehicleId);
        }

        uint256 amountWithdrawn = staking.withdraw(stakeId);

        emit Withdrawn(msg.sender, stakeId, amountWithdrawn);
    }

    // TODO Documentation
    function withdraw(uint256[] calldata stakeIds) external {
        IStakingBeacon staking = IStakingBeacon(_getDimoStakingStorage().stakerToStake[msg.sender]);

        if (address(staking) == address(0)) {
            revert NoActiveStaking(msg.sender);
        }

        uint256 stakeId;
        uint256 amountWithdrawn;
        StakingData memory stakingData;
        for (uint256 i = 0; i < stakeIds.length; i++) {
            stakeId = stakeIds[i];
            stakingData = staking.stakingData(stakeId);

            if (block.timestamp < stakingData.lockEndTime) {
                revert TokensStillLocked(stakeId);
            }
            if (stakingData.vehicleId != 0) {
                emit VehicleDetached(msg.sender, stakeId, stakingData.vehicleId);
            }

            amountWithdrawn = staking.withdraw(stakeId);

            emit Withdrawn(msg.sender, stakeId, amountWithdrawn);
        }
    }

    // TODO Documentation
    function extendStaking(uint256 stakeId) external {
        DimoStakingStorage storage $ = _getDimoStakingStorage();
        IStakingBeacon staking = IStakingBeacon($.stakerToStake[msg.sender]);

        if (address(staking) == address(0)) {
            revert NoActiveStaking(msg.sender);
        }

        StakingData memory stakingData = staking.stakingData(stakeId);

        uint256 newLockEndTime = block.timestamp + $.stakingLevels[stakingData.level].lockPeriod;

        staking.extendStaking(stakeId, newLockEndTime);

        emit StakingExtended(msg.sender, stakeId, newLockEndTime);
    }

    // TODO Documentation
    function attachVehicle(uint256 stakeId, uint256 vehicleId) external {
        // TODO handle vehicle ID transfer
        DimoStakingStorage storage $ = _getDimoStakingStorage();

        if ($.vehicleIdToStakeId[vehicleId] != 0) {
            revert VehicleAlreadyAttached(vehicleId);
        }

        if (!IVehicleId($.vehicleIdProxy).exists(vehicleId)) {
            revert InvalidVehicleId(vehicleId);
        }

        // TODO Detach vehicleId if stakeId is expired?

        IStakingBeacon staking = IStakingBeacon(_getDimoStakingStorage().stakerToStake[msg.sender]);

        if (address(staking) == address(0)) {
            revert NoActiveStaking(msg.sender);
        }

        $.vehicleIdToStakeId[vehicleId] = stakeId;
        staking.attachVehicle(stakeId, vehicleId);

        emit VehicleAttached(msg.sender, stakeId, vehicleId);
    }

    // TODO Documentation
    function detachVehicle(uint256 vehicleId) external {
        DimoStakingStorage storage $ = _getDimoStakingStorage();
        uint256 stakeId = $.vehicleIdToStakeId[vehicleId];
        address stakingBeaconAddress = $.stakeIdToStake[stakeId];

        if (stakingBeaconAddress == address(0)) {
            revert NoActiveStaking(msg.sender);
        }

        try IERC721($.vehicleIdProxy).ownerOf(vehicleId) returns (address vehicleIdOwner) {
            if (msg.sender != vehicleIdOwner && msg.sender != IStakingBeacon(stakingBeaconAddress).staker()) {
                revert Unauthorized(msg.sender, vehicleId);
            }
        } catch {
            // TODO This will only be reached if a vehicle ID is attached, then burned. Won't need if we have a burning hook
            revert InvalidVehicleId(vehicleId);
        }

        delete $.vehicleIdToStakeId[vehicleId];
        IStakingBeacon(stakingBeaconAddress).detachVehicle(vehicleId);

        emit VehicleDetached(msg.sender, stakeId, vehicleId);
    }

    // TODO Documentation
    function delegate(address delegatee) external {
        IStakingBeacon staking = IStakingBeacon(_getDimoStakingStorage().stakerToStake[msg.sender]);

        if (address(staking) == address(0)) {
            revert NoActiveStaking(msg.sender);
        }

        staking.delegate(delegatee);
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
    function stakingLevels(uint256 level) external view returns (StakingLevel memory) {
        return _getDimoStakingStorage().stakingLevels[level];
    }

    // TODO Documentation
    function stakeIdToStake(uint256 stakeId) external view returns (address) {
        return _getDimoStakingStorage().stakeIdToStake[stakeId];
    }

    // TODO Documentation
    function stakerToStake(address user) external view returns (address) {
        return _getDimoStakingStorage().stakerToStake[user];
    }

    // TODO Documentation
    function vehicleIdToStakeId(uint256 vehicleId) external view returns (uint256) {
        return _getDimoStakingStorage().vehicleIdToStakeId[vehicleId];
    }

    // TODO Documentation
    function getBaselinePoints(uint256 vehicleId) public view returns (uint256) {
        DimoStakingStorage storage $ = _getDimoStakingStorage();
        uint256 stakeId = $.vehicleIdToStakeId[vehicleId];

        if (stakeId == 0) {
            return 0;
        }

        IStakingBeacon staking = IStakingBeacon($.stakeIdToStake[stakeId]);
        StakingData memory stakingData = staking.stakingData(stakeId);

        // TODO stakingData.amount == 0 and stakingData.vehicleId == 0 might be redundant
        if (stakingData.amount == 0 || stakingData.lockEndTime < block.timestamp || stakingData.vehicleId == 0)
            return 0;

        return $.stakingLevels[stakingData.level].points;
    }

    // TODO Documentation
    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721Upgradeable, AccessControlUpgradeable) returns (bool) {
        return super.supportsInterface(interfaceId);
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
