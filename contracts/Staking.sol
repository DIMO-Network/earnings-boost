// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.27;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC721/IERC721.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/access/extensions/AccessControlDefaultAdminRulesUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol';

import './StakingBeacon.sol';
import './Types.sol';
import './interfaces/IStakingBeacon.sol';
import './interfaces/IVehicleId.sol';

/**
 * @title DIMOStaking
 * @notice This contract allows users to stake their $DIMO tokens to earn rewards boosts
 * Users can stake different quantities of $DIMO for different durations to receive a corresponding boost level
 * The contract utilizes a StakingBeacon contract to manage the staked tokens and delegate voting power
 * @dev Burning Vehicle IDs is not directly handled. The functions always check token existence.
 */
contract DIMOStaking is Initializable, ERC721Upgradeable, AccessControlDefaultAdminRulesUpgradeable, UUPSUpgradeable {
    struct DimoStakingStorage {
        address dimoToken;
        address vehicleIdProxy;
        uint256 currentStakeId;
        mapping(uint256 => StakingLevel) stakingLevels;
        mapping(uint256 stakeId => StakingData) stakeIdToStakingData;
        mapping(uint256 stakeId => address stakerContract) stakeIdToStake;
        mapping(address staker => address stakerContract) stakerToStake;
        mapping(uint256 vehicleTokenId => uint256 stakeId) vehicleIdToStakeId;
    }
    struct StakingLevel {
        uint256 amount;
        uint256 lockPeriod;
        uint256 points;
    }

    uint8 constant MAX_STAKING_LEVEL = 2;
    bytes32 constant UPGRADER_ROLE = keccak256('UPGRADER_ROLE');

    // keccak256(abi.encode(uint256(keccak256("DIMOStaking.storage")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant DIMO_STAKING_STORAGE = 0x85da7fe116410007e8db80000b74f31d3498f18fcacb661af6fab05d889a7100;

    event Staked(
        address indexed user,
        uint256 indexed stakeId,
        address indexed stakingBeacon,
        uint8 level,
        uint256 amount,
        uint256 lockEndTime
    );
    event Withdrawn(address indexed user, uint256 indexed stakeId, uint256 amount);
    event VehicleAttached(address indexed user, uint256 indexed stakeId, uint256 indexed vehicleId);
    event VehicleDetached(address indexed user, uint256 indexed stakeId, uint256 indexed vehicleId);
    event StakingExtended(address indexed user, uint256 indexed stakeId, uint256 newLockEndTime);

    error InvalidStakingLevel(uint8 level);
    error InvalidStakeId(uint256 stakeId);
    error TokensStillLocked(uint256 stakeId);
    error Unauthorized(address addr, uint256 vehicleId);
    error InvalidVehicleId(uint256 vehicleId);
    error NoActiveStaking();
    error VehicleAlreadyAttached(uint256 vehicleId);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the DIMOStaking contract
     * @param dimoToken_ Address of the DIMO token contract
     * @param vehicleIdProxy_ Address of the VehicleId proxy contract
     */
    function initialize(address dimoToken_, address vehicleIdProxy_) external initializer {
        __AccessControlDefaultAdminRules_init(3 days, msg.sender);
        __ERC721_init('DIMO Staking', 'DSTK');
        __UUPSUpgradeable_init();

        _grantRole(UPGRADER_ROLE, msg.sender);

        DimoStakingStorage storage $ = _getDimoStakingStorage();

        $.dimoToken = dimoToken_;
        $.vehicleIdProxy = vehicleIdProxy_;

        // Initialize staking levels
        $.stakingLevels[0] = StakingLevel(500 ether, 180 days, 1000);
        $.stakingLevels[1] = StakingLevel(1500 ether, 365 days, 2000);
        $.stakingLevels[2] = StakingLevel(4000 ether, 730 days, 3000);
    }

    /**
     * @notice Stakes DIMO tokens for a specific level and optionally attaches a Vehicle ID
     * @dev If the staker has no existing StakingBeacon, a new one is created
     * A new Stake ID is minted regardless
     * @param level The staking level (0-2)
     * @param vehicleId The ID of the Vehicle to attach (can be 0 for no attachment)
     */
    function stake(uint8 level, uint256 vehicleId) external {
        DimoStakingStorage storage $ = _getDimoStakingStorage();

        if (level > MAX_STAKING_LEVEL) {
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
            stakingBeaconAddress = address(new StakingBeacon($.dimoToken, msg.sender));

            $.stakerToStake[msg.sender] = stakingBeaconAddress;
        }

        $.stakeIdToStake[currentStakeId] = stakingBeaconAddress;
        $.stakeIdToStakingData[currentStakeId] = stakingData;

        require(
            IERC20($.dimoToken).transferFrom(msg.sender, stakingBeaconAddress, stakingLevel.amount),
            'Transfer failed'
        );

        _safeMint(msg.sender, currentStakeId);

        emit Staked(
            msg.sender,
            currentStakeId,
            stakingBeaconAddress,
            level,
            stakingLevel.amount,
            stakingData.lockEndTime
        );

        if (vehicleId != 0) {
            if (!IVehicleId($.vehicleIdProxy).exists(vehicleId)) {
                revert InvalidVehicleId(vehicleId);
            }

            uint256 attachedStakeId = $.vehicleIdToStakeId[vehicleId];
            if (attachedStakeId != 0) {
                // If vehicle ID is already attached and not expired
                if (isVehicleAttachedAndActive(vehicleId)) {
                    revert VehicleAlreadyAttached(vehicleId);
                }

                // Expired Stake will have Vehicle detached
                delete $.stakeIdToStakingData[attachedStakeId].vehicleId;

                emit VehicleDetached(ownerOf(attachedStakeId), attachedStakeId, vehicleId);
            }

            $.vehicleIdToStakeId[vehicleId] = currentStakeId;
            emit VehicleAttached(msg.sender, currentStakeId, vehicleId);
        }
    }

    /**
     * @notice Upgrades an existing stake to a higher level and optionally attaches a Vehicle ID
     * @param stakeId The ID of the Stake to upgrade
     * @param level The new staking level (1-2)
     * @param vehicleId The ID of the Vehicle to attach (can be 0 for no attachment)
     */
    function upgradeStake(uint256 stakeId, uint8 level, uint256 vehicleId) external {
        // It also reverts if stakeId does not exist
        if (msg.sender != ownerOf(stakeId)) {
            revert InvalidStakeId(stakeId);
        }

        DimoStakingStorage storage $ = _getDimoStakingStorage();
        IStakingBeacon staking = IStakingBeacon($.stakerToStake[msg.sender]);
        StakingData memory stakingData = $.stakeIdToStakingData[stakeId];

        if (level > MAX_STAKING_LEVEL || stakingData.level >= level) {
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

        $.stakeIdToStakingData[stakeId] = newStakingData;

        emit Staked(msg.sender, stakeId, address(staking), level, newStakingData.amount, newStakingData.lockEndTime);

        if (vehicleId != currentAttachedVehicleId) {
            if (vehicleId == 0) {
                delete $.vehicleIdToStakeId[currentAttachedVehicleId];
                emit VehicleDetached(msg.sender, stakeId, currentAttachedVehicleId);
            } else if (IVehicleId($.vehicleIdProxy).exists(vehicleId)) {
                uint256 attachedStakeId = $.vehicleIdToStakeId[vehicleId];
                if (attachedStakeId != 0) {
                    // If vehicle ID is already attached and not expired
                    if (isVehicleAttachedAndActive(vehicleId)) {
                        revert VehicleAlreadyAttached(vehicleId);
                    }

                    // Current attached Vehicle ID will be replaced
                    delete $.vehicleIdToStakeId[currentAttachedVehicleId];
                    // Expired Stake will have Vehicle detached
                    delete $.stakeIdToStakingData[attachedStakeId].vehicleId;

                    emit VehicleDetached(ownerOf(attachedStakeId), attachedStakeId, vehicleId);
                }

                $.vehicleIdToStakeId[vehicleId] = stakeId;
                emit VehicleAttached(msg.sender, stakeId, vehicleId);
            } else {
                revert InvalidVehicleId(vehicleId);
            }
        }
    }

    /**
     * @notice Withdraws staked DIMO tokens for a specific Stake ID
     * @dev Reverts if the Stake ID does not exist or if the tokens are still locked
     * @param stakeId The ID of the Stake to withdraw
     */
    function withdraw(uint256 stakeId) external {
        // It also reverts if stakeId does not exist
        if (msg.sender != ownerOf(stakeId)) {
            revert InvalidStakeId(stakeId);
        }

        DimoStakingStorage storage $ = _getDimoStakingStorage();
        IStakingBeacon staking = IStakingBeacon($.stakerToStake[msg.sender]);
        StakingData memory stakingData = $.stakeIdToStakingData[stakeId];

        if (block.timestamp <= stakingData.lockEndTime) {
            revert TokensStillLocked(stakeId);
        }
        if (stakingData.vehicleId != 0) {
            emit VehicleDetached(msg.sender, stakeId, stakingData.vehicleId);
        }

        uint256 amountWithdrawn = $.stakeIdToStakingData[stakeId].amount;

        staking.withdraw(amountWithdrawn);

        delete $.stakeIdToStakingData[stakeId];

        emit Withdrawn(msg.sender, stakeId, amountWithdrawn);
    }

    /**
     * @notice Withdraws staked DIMO tokens for multiple Stake IDs
     * @dev Reverts if any Stake ID does not exist or if any tokens are still locked
     * @param stakeIds The IDs of the Stakes to withdraw
     */
    function withdraw(uint256[] calldata stakeIds) external {
        DimoStakingStorage storage $ = _getDimoStakingStorage();
        IStakingBeacon staking = IStakingBeacon($.stakerToStake[msg.sender]);

        uint256 stakeId;
        uint256 amountWithdrawn;
        StakingData memory stakingData;
        for (uint256 i = 0; i < stakeIds.length; i++) {
            stakeId = stakeIds[i];
            stakingData = $.stakeIdToStakingData[stakeId];

            // It also reverts if stakeId does not exist
            if (msg.sender != ownerOf(stakeId)) {
                revert InvalidStakeId(stakeId);
            }
            if (block.timestamp <= stakingData.lockEndTime) {
                revert TokensStillLocked(stakeId);
            }
            if (stakingData.vehicleId != 0) {
                emit VehicleDetached(msg.sender, stakeId, stakingData.vehicleId);
            }

            amountWithdrawn = $.stakeIdToStakingData[stakeId].amount;

            staking.withdraw(amountWithdrawn);

            delete $.stakeIdToStakingData[stakeId];

            emit Withdrawn(msg.sender, stakeId, amountWithdrawn);
        }
    }

    /**
     * @notice Extends the lock period of an existing Stake
     * @dev Reverts if the Stake ID does not exist
     * @param stakeId The ID of the Stake to extend
     */
    function extendStaking(uint256 stakeId) external {
        // It also reverts if stakeId does not exist
        if (msg.sender != ownerOf(stakeId)) {
            revert InvalidStakeId(stakeId);
        }

        DimoStakingStorage storage $ = _getDimoStakingStorage();
        StakingData memory stakingData = $.stakeIdToStakingData[stakeId];

        uint256 newLockEndTime = block.timestamp + $.stakingLevels[stakingData.level].lockPeriod;

        $.stakeIdToStakingData[stakeId].lockEndTime = newLockEndTime;

        emit StakingExtended(msg.sender, stakeId, newLockEndTime);
    }

    /**
     * @notice Attaches a vehicle ID to an existing Stake
     * @dev Reverts if the Stake ID does not exist,
     * the Vehicle ID does not exist,
     * or the Vehicle ID is already attached to an active Stake ID
     * @param stakeId The ID of the Stake to attach the Vehicle to
     * @param vehicleId The ID of the Vehicle to attach
     */
    function attachVehicle(uint256 stakeId, uint256 vehicleId) external {
        // It also reverts if stakeId does not exist
        if (msg.sender != ownerOf(stakeId)) {
            revert InvalidStakeId(stakeId);
        }

        DimoStakingStorage storage $ = _getDimoStakingStorage();

        if (!IVehicleId($.vehicleIdProxy).exists(vehicleId)) {
            revert InvalidVehicleId(vehicleId);
        }

        uint256 attachedStakeId = $.vehicleIdToStakeId[vehicleId];
        if (stakeId == attachedStakeId) {
            revert VehicleAlreadyAttached(vehicleId);
        } else if (attachedStakeId != 0) {
            // If vehicle ID is already attached and not expired
            if (isVehicleAttachedAndActive(vehicleId)) {
                revert VehicleAlreadyAttached(vehicleId);
            }

            // Expired Stake will have Vehicle detached
            delete $.stakeIdToStakingData[attachedStakeId].vehicleId;

            emit VehicleDetached(ownerOf(attachedStakeId), attachedStakeId, vehicleId);
        }

        uint256 currentAttachedVehicleId = $.stakeIdToStakingData[stakeId].vehicleId;
        if (currentAttachedVehicleId != 0) {
            delete $.vehicleIdToStakeId[currentAttachedVehicleId];
            emit VehicleDetached(msg.sender, stakeId, currentAttachedVehicleId);
        }

        $.vehicleIdToStakeId[vehicleId] = stakeId;
        $.stakeIdToStakingData[stakeId].vehicleId = vehicleId;

        emit VehicleAttached(msg.sender, stakeId, vehicleId);
    }

    /**
     * @notice Detaches a vehicle ID from a Stake
     * @dev Reverts if the Stake ID has no Vehicle ID attached
     * or if the caller is not the staker or Vehicle ID owner
     * @param vehicleId The ID of the Vehicle to detach
     */
    function detachVehicle(uint256 vehicleId) external {
        DimoStakingStorage storage $ = _getDimoStakingStorage();
        uint256 stakeId = $.vehicleIdToStakeId[vehicleId];
        address stakingBeaconAddress = $.stakeIdToStake[stakeId];

        if (stakingBeaconAddress == address(0)) {
            revert NoActiveStaking();
        }

        try IVehicleId($.vehicleIdProxy).ownerOf(vehicleId) returns (address vehicleIdOwner) {
            if (msg.sender != vehicleIdOwner && msg.sender != IStakingBeacon(stakingBeaconAddress).staker()) {
                revert Unauthorized(msg.sender, vehicleId);
            }
        } catch {
            // This will only be reached if a vehicle ID is attached, then burned
            // Staker can still attach another available existing vehicle
            revert InvalidVehicleId(vehicleId);
        }

        delete $.vehicleIdToStakeId[vehicleId];
        delete $.stakeIdToStakingData[stakeId].vehicleId;

        emit VehicleDetached(msg.sender, stakeId, vehicleId);
    }

    /**
     * @notice Delegates voting power of staked tokens to a delegatee
     * @dev Reverts if the caller does not have an active Stake
     * @param delegatee The address to delegate voting power to
     */
    function delegate(address delegatee) external {
        IStakingBeacon staking = IStakingBeacon(_getDimoStakingStorage().stakerToStake[msg.sender]);

        if (address(staking) == address(0)) {
            revert NoActiveStaking();
        }

        staking.delegate(delegatee);
    }

    /**
     * @notice Returns the address of the DIMO token contract
     * @return The address of the DIMO token contract
     */
    function dimoToken() external view returns (address) {
        return _getDimoStakingStorage().dimoToken;
    }

    /**
     * @notice Returns the address of the VehicleId proxy contract
     * @return The address of the VehicleId proxy contract
     */
    function vehicleIdProxy() external view returns (address) {
        return _getDimoStakingStorage().vehicleIdProxy;
    }

    /**
     * @notice Returns the StakingLevel struct for a specific level
     * @param level The staking level (0-2)
     * @return The StakingLevel struct for the specified level
     */
    function stakingLevels(uint8 level) external view returns (StakingLevel memory) {
        return _getDimoStakingStorage().stakingLevels[level];
    }

    /**
     * @notice Returns the StakingData struct for a specific Stake ID
     * @param stakeId The ID of the Stake
     * @return The StakingData struct for the specified Stake ID
     */
    function stakeIdToStakingData(uint256 stakeId) external view returns (StakingData memory) {
        return _getDimoStakingStorage().stakeIdToStakingData[stakeId];
    }

    /**
     * @notice Returns the address of the StakingBeacon contract for a specific Stake ID
     * @param stakeId The ID of the Stake
     * @return The address of the StakingBeacon contract for the specified Stake ID
     */
    function stakeIdToStake(uint256 stakeId) external view returns (address) {
        return _getDimoStakingStorage().stakeIdToStake[stakeId];
    }

    /**
     * @notice Returns the address of the StakingBeacon contract for a specific user
     * @param user The address of the user
     * @return The address of the StakingBeacon contract for the specified user
     */
    function stakerToStake(address user) external view returns (address) {
        return _getDimoStakingStorage().stakerToStake[user];
    }

    /**
     * @notice Returns the stake ID associated with a specific Vehicle ID
     * @param vehicleId The ID of the Vehicle
     * @return The stake ID associated with the specified Vehicle ID
     */
    function vehicleIdToStakeId(uint256 vehicleId) external view returns (uint256) {
        return _getDimoStakingStorage().vehicleIdToStakeId[vehicleId];
    }

    /**
     * @notice Returns the baseline points for a Vehicle based on its active stake
     * @dev Returns 0 if the Vehicle is not attached to any stake, has been burned, or the stake has expired
     * @param vehicleId The ID of the Vehicle
     * @return The baseline points for the specified Vehicle ID
     */
    function getBaselinePoints(uint256 vehicleId) external view returns (uint256) {
        DimoStakingStorage storage $ = _getDimoStakingStorage();

        if (!IVehicleId($.vehicleIdProxy).exists(vehicleId)) {
            return 0;
        }

        uint256 stakeId = $.vehicleIdToStakeId[vehicleId];
        if (stakeId == 0) {
            return 0;
        }

        StakingData memory stakingData = $.stakeIdToStakingData[stakeId];

        if ($.stakeIdToStakingData[stakeId].lockEndTime < block.timestamp) {
            return 0;
        }

        return $.stakingLevels[stakingData.level].points;
    }

    /**
     * @notice Transfers a Stake ID to a new owner
     * @dev Creates a new Staking Beacon if the recipient does not have one
     * @param from The current owner of the Stake ID
     * @param to The new owner of the Stake ID
     * @param tokenId The ID of the Stake to transfer
     */
    function transferFrom(address from, address to, uint256 tokenId) public override {
        super.transferFrom(from, to, tokenId);

        DimoStakingStorage storage $ = _getDimoStakingStorage();
        address stakingTo = $.stakerToStake[to];

        if (stakingTo == address(0)) {
            // Creates a new StakingBeacon
            stakingTo = address(new StakingBeacon($.dimoToken, to));
            $.stakerToStake[to] = stakingTo;
        }

        StakingData memory stakingData = $.stakeIdToStakingData[tokenId];

        IStakingBeacon($.stakeIdToStake[tokenId]).transferStake(stakingData.amount, stakingTo);
        $.stakeIdToStake[tokenId] = stakingTo;

        emit Withdrawn(from, tokenId, stakingData.amount);

        emit Staked(to, tokenId, stakingTo, stakingData.level, stakingData.amount, stakingData.lockEndTime);
    }

    /**
     * @notice See {IERC165-supportsInterface}.
     */
    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721Upgradeable, AccessControlDefaultAdminRulesUpgradeable) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    /**
     * @notice Authorizes an upgrade of the contract
     * @dev Only accounts with the UPGRADER_ROLE can upgrade the contract
     * @param newImplementation The address of the new implementation contract
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(UPGRADER_ROLE) {}

    /**
     * @notice Checks if a Vehicle is attached to an active Stake
     * @dev Assumes the Vehicle is attached as this function is only called in contexts where this is a requirement
     * @param vehicleId The ID of the Vehicle
     * @return True if the Vehicle is attached to an active Stake, false otherwise
     */
    function isVehicleAttachedAndActive(uint256 vehicleId) private view returns (bool) {
        DimoStakingStorage storage $ = _getDimoStakingStorage();
        uint256 stakeId = _getDimoStakingStorage().vehicleIdToStakeId[vehicleId];

        return block.timestamp <= $.stakeIdToStakingData[stakeId].lockEndTime;
    }

    /**
     * @dev Returns a pointer to the storage namespace
     */
    function _getDimoStakingStorage() private pure returns (DimoStakingStorage storage $) {
        assembly {
            $.slot := DIMO_STAKING_STORAGE
        }
    }
}
