// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.27;

import '@openzeppelin/contracts/token/ERC721/IERC721.sol';

import './Types.sol';
import './interfaces/IERC20Votes.sol';

/**
 * @title StakingBeacon
 * @notice This contract acts as a beacon for staked DIMO tokens, managing withdrawals, stake transfers, and voting delegation
 * Each staker has a corresponding StakingBeacon contract that holds their staked tokens
 */
contract StakingBeacon {
    address public immutable dimoStaking;
    address public immutable dimoToken;
    address public immutable staker;

    error Unauthorized(address addr);

    modifier onlyDimoStaking() {
        if (msg.sender != dimoStaking) {
            revert Unauthorized(msg.sender);
        }
        _;
    }

    /**
     * @notice Constructs a new StakingBeacon contract
     * @param dimoToken_ The address of the DIMO token contract
     * @param staker_ The address of the staker
     */
    constructor(address dimoToken_, address staker_) {
        dimoStaking = msg.sender;
        dimoToken = dimoToken_;
        staker = staker_;
    }

    /**
     * @notice Withdraws staked tokens to the staker
     * @dev Only callable by the DIMO Staking contract
     * @param amount The amount of tokens to withdraw
     */
    function withdraw(uint256 amount) external onlyDimoStaking {
        require(IERC20(dimoToken).transfer(staker, amount), 'Transfer failed');
    }

    /**
     * @notice Transfers staked tokens to a new StakingBeacon contract
     * @dev Only callable by the DIMO Staking contract
     * @param amount The amount of tokens to transfer
     * @param to The address of the recipient StakingBeacon contract
     */
    function transferStake(uint256 amount, address to) external onlyDimoStaking {
        require(IERC20(dimoToken).transfer(to, amount), 'Transfer failed');
    }

    /**
     * @notice Delegates voting power of staked tokens to a delegatee
     * @dev Callable by either the DIMO Staking contract or the staker
     * @param delegatee The address to delegate voting power to
     */
    function delegate(address delegatee) external {
        if (msg.sender != dimoStaking && msg.sender != staker) {
            revert Unauthorized(msg.sender);
        }

        IERC20Votes(dimoToken).delegate(delegatee);
    }
}
