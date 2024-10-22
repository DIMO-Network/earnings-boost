// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.27;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/governance/utils/IVotes.sol';

interface IERC20Votes is IERC20, IVotes {}
