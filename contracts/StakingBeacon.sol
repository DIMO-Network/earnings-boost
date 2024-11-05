// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.27;

import '@openzeppelin/contracts/token/ERC721/IERC721.sol';

import './Types.sol';
import './interfaces/IERC20Votes.sol';

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

    // TODO Documentation
    constructor(address dimoToken_, address staker_) {
        dimoStaking = msg.sender;
        dimoToken = dimoToken_;
        staker = staker_;
    }

    // TODO Documentation
    function withdraw(uint256 amount) external onlyDimoStaking {
        require(IERC20(dimoToken).transfer(staker, amount), 'Transfer failed');
    }

    // TODO Documentation find a better name
    function transferStake(uint256 amount, address to) external onlyDimoStaking {
        require(IERC20(dimoToken).transfer(to, amount), 'Transfer failed');
    }

    // TODO Documentation
    function delegate(address delegatee) external {
        if (msg.sender != dimoStaking && msg.sender != staker) {
            revert Unauthorized(msg.sender);
        }

        IERC20Votes(dimoToken).delegate(delegatee);
    }
}
