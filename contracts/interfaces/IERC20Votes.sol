// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.27;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/governance/utils/IVotes.sol';

/**
 * @title IERC20Votes
 * @notice This interface defines the IERC20Votes contract, combining the functionality of ERC20 tokens and voting capabilities
 */
interface IERC20Votes is IERC20, IVotes {}
