# Earnings Boost

## Purpose
The DIMO Staking contracts implement a system for users to lock up their DIMO tokens (an ERC20 token) to receive rewards boosts. This mechanism, detailed in [DIP-2: Amendment 4](https://docs.dimo.org/governance/amendments/dip2a4), incentivizes long-term engagement with the DIMO ecosystem. Users who lock a specified quantity of DIMO tokens for a chosen duration receive a boost to their weekly baseline earnings, similar to the Streak Level bonus.

## How it Works
The DIMO Staking system employs several key components:
   * [`DIMOStaking`](https://github.com/DIMO-Network/earnings-boost/blob/main/contracts/Staking.sol) contract: This contract is the primary entry point for users to interact with the staking system. It manages staking levels, stake creation, upgrades, withdrawals, vehicle attachments, and delegations.
   * [`StakingBeacon`](https://github.com/DIMO-Network/earnings-boost/blob/main/contracts/StakingBeacon.sol) contract: Each user who stakes DIMO tokens has an associated `StakingBeacon` contract. This contract holds the staked tokens and facilitates token transfers during withdrawals and stake transfers.
   * [`IERC20Votes`](https://github.com/DIMO-Network/earnings-boost/blob/main/contracts/interfaces/IERC20Votes.sol) interface: This interface defines the DIMO token as an ERC20 token with voting capabilities. Users can delegate their voting power to other addresses, even while their tokens are staked.
   * [`IVehicleId`](https://github.com/DIMO-Network/earnings-boost/blob/main/contracts/interfaces/IVehicleId.sol) interface: This interface interacts with the [Vehicle ID](https://github.com/DIMO-Network/dimo-identity/blob/main/contracts/NFTs/VehicleId.sol) contract, allowing users to attach their stakes to specific vehicles. This enables per-vehicle rewards boosts as described in DIP-2.
   * [`Types`](https://github.com/DIMO-Network/earnings-boost/blob/main/contracts/Types.sol): This file defines common data structures used within the staking system, such as `StakingData` and `StakingLevel`.

## Staking Process:
1. Users stake DIMO tokens by calling the `stake` function in the `DIMOStaking` contract.
    * They specify a staking level (which determines the lock-up amount, duration, and points earned) and optionally a vehicle ID to attach to their stake.
    * A `StakingBeacon` contract is created for the user if they don't already have one, and the specified amount of DIMO tokens is transferred from the user's wallet to their `StakingBeacon` contract.
2. Users can upgrade their existing stakes to higher levels using the `upgradeStake` function, which extends the lock-up period and increases the rewards boost.
    * They can also attach or detach a Vehicle ID to their stake during the upgrade.
3. Users can withdraw their staked tokens using the withdraw function once the lock-up period has expired.
    * The staked tokens are transferred back to the user's wallet from their `StakingBeacon` contract.
4. Users can attach and detach Vehicle IDs to their active stakes using the `attachVehicle` and `detachVehicle` functions.
    * Detaching a vehicle can be done by either the staker or the owner of the Vehicle ID.
5. Users can delegate their voting power to another address using the delegate function, which interacts with the `IERC20Votes` functionality of the DIMO token.


## How to run

You can execute the following commands to build the project and run additional scripts:

```sh
# Installs dependencies
npm i

# Clears cache, compiles contracts, generates typechain files
npm run build

# Commands to check and fix linting errors in typescript and solidity files
npm run lint
npm run lint:fix
npm run lint:ts
npm run lint:ts:fix
npm run lint:sol
npm run lint:sol:fix
```

## Testing

The test suite is organized in different files according to the contract name `<ContractName>.test.ts`. Each file groups the tests by function name, covering, respectively, reverts, state modification and events. You can run the test suite with the following commands:

```sh
# Runs test suite
npm run test

# Runs solidity coverage
npm run coverage

# Runs test suite with gas report
npm run gas-reporter
```

## Deploy

```sh
npx hardhat ignition deploy ./ignition/modules/DIMOStaking.ts --network <network>
```

In case of reconciliation failed, you can wipe the `journal.jsonl`. Make sure to use the last `futureId` in the journal.

```sh
npx hardhat ignition wipe chain-<id> --network futureId
```

## Verification

```sh
npx hardhat ignition deployments
```

output
```sh
chain-31337
chain-80002
chain-137
```

```sh
npx hardhat ignition verify chain-<id>
```

## Audit

[Sayfer audit - November 2024](https://sayfer.io/audits/smart-contract-audit-report-for-dimo-3/)
