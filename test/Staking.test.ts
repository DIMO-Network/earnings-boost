import { expect } from 'chai'
import { EventLog } from 'ethers'
import { ethers, ignition } from 'hardhat'
import { time, loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'

import * as C from '../utils/constants'
import DIMOStakingTestModule from '../ignition/modules/DIMOStakingTest'
import type { DIMOStaking, MockDimoToken, MockVehicleId } from '../typechain-types'

type StakingModule = {
    dimoStaking: DIMOStaking
    mockDimoToken: MockDimoToken
    mockVehicleId: MockVehicleId
}

describe('Staking', function () {
    async function setup() {
        const [deployer, user1, user2] = await ethers.getSigners()
        const amount = ethers.parseEther('1000000')

        const { dimoStaking, mockDimoToken, mockVehicleId } = (await ignition.deploy(
            DIMOStakingTestModule
        )) as unknown as StakingModule

        await mockDimoToken.mint(user1.address, amount)
        await mockDimoToken.connect(user1).approve(await dimoStaking.getAddress(), amount)
        await mockVehicleId.mint(user1.address)
        await mockVehicleId.mint(user2.address)

        return { deployer, user1, user2, dimoStaking, mockDimoToken, mockVehicleId }
    }

    describe('Deployment', function () {
        it('Should set DIMO Token address', async function () {
            const { dimoStaking, mockDimoToken } = await loadFixture(setup)

            expect(await dimoStaking.dimoToken()).to.equal(await mockDimoToken.getAddress())
        })
        it('Should set Vehicle ID address', async function () {
            const { dimoStaking, mockVehicleId } = await loadFixture(setup)

            expect(await dimoStaking.vehicleIdProxy()).to.equal(await mockVehicleId.getAddress())
        })
        it('Should set boost levels', async function () {
            const { dimoStaking } = await loadFixture(setup)

            expect(await dimoStaking.stakingLevels(0)).to.eql(Object.values(C.stakingLevels[0]))
            expect(await dimoStaking.stakingLevels(1)).to.eql(Object.values(C.stakingLevels[1]))
            expect(await dimoStaking.stakingLevels(2)).to.eql(Object.values(C.stakingLevels[2]))
        })
        it('Should set name an symbol', async function () {
            const { dimoStaking } = await loadFixture(setup)

            expect(await dimoStaking.name()).to.equal(C.name)
            expect(await dimoStaking.symbol()).to.equal(C.symbol)
        })
    })

    describe('stake', () => {
        context('Errors', () => {
            it('Should revert if level is invalid', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await expect(dimoStaking.connect(user1).stake(99, 1))
                    .to.be.revertedWithCustomError(dimoStaking, 'InvalidStakingLevel')
                    .withArgs(99)
            })
            it('Should revert if staking contract does not have enough allowance', async () => {
                const { dimoStaking, user1, mockDimoToken } = await loadFixture(setup)

                await mockDimoToken.connect(user1).approve(await dimoStaking.getAddress(), 0)

                await expect(dimoStaking.connect(user1).stake(1, 2)).to.be.revertedWith('ERC20: insufficient allowance')
            })
            it('Should revert if caller is not the vehicle ID owner', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await expect(dimoStaking.connect(user1).stake(1, 2))
                    .to.be.revertedWithCustomError(dimoStaking, 'Unauthorized')
                    .withArgs(user1.address, 2)
            })
            it('Should revert if vehicle ID is already attached', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1)

                await expect(dimoStaking.connect(user1).stake(1, 1))
                    .to.be.revertedWithCustomError(dimoStaking, 'VehicleAlreadyAttached')
                    .withArgs(1)
            })
            it('Should revert if vehicle ID does not exist', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await expect(dimoStaking.connect(user1).stake(1, 99))
                    .to.be.revertedWithCustomError(dimoStaking, 'InvalidVehicleId')
                    .withArgs(99)
            })
        })

        context('State', () => {
            context('Staker does not have a Staking Beacon', () => {
                it('Should correctly create a new Staking Beacon contract', async () => {
                    const { dimoStaking, user1 } = await loadFixture(setup)

                    expect(await dimoStaking.stakerToStake(user1.address)).to.equal(ethers.ZeroAddress)

                    const receipt = await (await dimoStaking.connect(user1).stake(1, 1)).wait()
                    const eventArgs = (receipt?.logs[2] as EventLog).args
                    const stakeId = eventArgs[1] as bigint
                    const stakingBeacon = await ethers.getContractAt('StakingBeacon', eventArgs[2])

                    expect(stakeId).to.equal(1)

                    const lockEndTime = BigInt(await time.latest()) + C.stakingLevels[1].lockPeriod
                    const stakingData = await stakingBeacon.stakingData(stakeId)

                    expect(stakingData.level).to.equal(1)
                    expect(stakingData.amount).to.equal(C.stakingLevels[1].amount)
                    expect(stakingData.lockEndTime).to.be.closeTo(lockEndTime, 5n)
                    expect(stakingData.vehicleId).to.equal(1)
                })
                it('Should transfer correct amount of tokens to the Staking Beacon contract', async () => {
                    const { dimoStaking, user1, mockDimoToken } = await loadFixture(setup)

                    const stakerBalanceBefore = await mockDimoToken.balanceOf(user1)

                    const amount = C.stakingLevels[1].amount

                    const receipt = await (await dimoStaking.connect(user1).stake(1, 1)).wait()
                    const eventArgs = (receipt?.logs[2] as EventLog).args
                    const deployedStakingBeacon = eventArgs[2]

                    const stakerBalanceAfter = await mockDimoToken.balanceOf(user1)
                    const beaconBalanceAfter = await mockDimoToken.balanceOf(deployedStakingBeacon)

                    expect(stakerBalanceAfter).to.equal(stakerBalanceBefore - amount)
                    expect(beaconBalanceAfter).to.equal(amount)
                })
            })

            context('Staker already has a Staking Beacon', () => {
                it('Should correctly set Staking Data struct', async () => {
                    const { dimoStaking, user1, mockVehicleId } = await loadFixture(setup)

                    await dimoStaking.connect(user1).stake(1, 1)
                    // Mint another vehicle for user1 with ID 3
                    await mockVehicleId.mint(user1.address)

                    const receipt = await (await dimoStaking.connect(user1).stake(1, 3)).wait()
                    const eventArgs = (receipt?.logs[2] as EventLog).args
                    const stakeId = eventArgs[1] as bigint
                    const stakingBeacon = await ethers.getContractAt('StakingBeacon', eventArgs[2])

                    expect(stakeId).to.equal(2)

                    const lockEndTime = BigInt(await time.latest()) + C.stakingLevels[1].lockPeriod
                    const stakingData = await stakingBeacon.stakingData(stakeId)

                    expect(stakingData.level).to.equal(1)
                    expect(stakingData.amount).to.equal(C.stakingLevels[1].amount)
                    expect(stakingData.lockEndTime).to.be.closeTo(lockEndTime, 5n)
                    expect(stakingData.vehicleId).to.equal(3)
                })
                it('Should transfer correct amount of tokens to the Staking Beacon contract', async () => {
                    const { dimoStaking, user1, mockDimoToken, mockVehicleId } = await loadFixture(setup)

                    const receipt1 = await (await dimoStaking.connect(user1).stake(1, 1)).wait()
                    const eventArgs1 = (receipt1?.logs[2] as EventLog).args
                    const stakingBeaconAddress = eventArgs1[2] as string

                    const stakerBalanceBefore = await mockDimoToken.balanceOf(user1)
                    const stakingBeaconBalanceBefore = await mockDimoToken.balanceOf(stakingBeaconAddress)

                    // Mint another vehicle for user1 with ID 3
                    await mockVehicleId.mint(user1.address)

                    const amount = C.stakingLevels[1].amount

                    const receipt2 = await (await dimoStaking.connect(user1).stake(1, 3)).wait()
                    const eventArgs2 = (receipt2?.logs[2] as EventLog).args
                    const stakingBeacon = eventArgs2[2]

                    const stakerBalanceAfter = await mockDimoToken.balanceOf(user1)
                    const beaconBalanceAfter = await mockDimoToken.balanceOf(stakingBeacon)

                    expect(stakerBalanceAfter).to.equal(stakerBalanceBefore - amount)
                    expect(beaconBalanceAfter).to.equal(stakingBeaconBalanceBefore + amount)
                })
            })
        })

        context('Events', () => {
            context('Staker does not have a Staking Beacon', () => {
                it('Should emit Staked event with correct params', async () => {
                    const { dimoStaking, user1 } = await loadFixture(setup)

                    const receipt = await (await dimoStaking.connect(user1).stake(1, 1)).wait()
                    const event = receipt?.logs[2] as EventLog
                    const args = event.args
                    const lockEndTime = BigInt(await time.latest()) + C.stakingLevels[1].lockPeriod

                    expect(event.fragment.name).to.equal('Staked')
                    expect(args[0]).to.equal(user1.address) // user
                    expect(args[1]).to.equal(1) // stakeId
                    expect(args[2]).to.not.equal(ethers.ZeroAddress) // stakingBeacon
                    expect(ethers.isAddress(args[2])).to.be.true // stakingBeacon
                    expect(args[3]).to.equal(C.stakingLevels[1].amount) // amount
                    expect(args[4]).to.equal(1) // level
                    expect(args[5]).to.be.closeTo(lockEndTime, 5n) // lockEndTime
                })
                it('Should emit VehicleAttached with correct params if Vehicle ID is set', async () => {
                    const { dimoStaking, user1 } = await loadFixture(setup)

                    await expect(dimoStaking.connect(user1).stake(1, 1))
                        .to.emit(dimoStaking, 'VehicleAttached')
                        .withArgs(user1.address, 1, 1)
                })
                it('Should not emit VehicleAttached if Vehicle ID is not set', async () => {
                    const { dimoStaking, user1 } = await loadFixture(setup)

                    await expect(dimoStaking.connect(user1).stake(1, 0)).to.not.emit(dimoStaking, 'VehicleAttached')
                })
            })

            context('Staker already has a Staking Beacon', () => {
                it('Should emit Staked event with correct params', async () => {
                    const { dimoStaking, user1, mockVehicleId } = await loadFixture(setup)

                    await dimoStaking.connect(user1).stake(1, 1)
                    // Mint another vehicle for user1 with ID 3
                    await mockVehicleId.mint(user1.address)

                    const receipt = await (await dimoStaking.connect(user1).stake(1, 3)).wait()
                    const event = receipt?.logs[2] as EventLog
                    const args = event.args
                    const lockEndTime = BigInt(await time.latest()) + C.stakingLevels[1].lockPeriod

                    expect(event.fragment.name).to.equal('Staked')
                    expect(args[0]).to.equal(user1.address) // user
                    expect(args[1]).to.equal(2) // stakeId
                    expect(args[2]).to.not.equal(ethers.ZeroAddress) // stakingBeacon
                    expect(ethers.isAddress(args[2])).to.be.true // stakingBeacon
                    expect(args[3]).to.equal(C.stakingLevels[1].amount) // amount
                    expect(args[4]).to.equal(1) // level
                    expect(args[5]).to.be.closeTo(lockEndTime, 5n) // lockEndTime
                })
                it('Should emit VehicleAttached with correct params if Vehicle ID is set', async () => {
                    const { dimoStaking, user1, mockVehicleId } = await loadFixture(setup)

                    await dimoStaking.connect(user1).stake(1, 1)
                    // Mint another vehicle for user1 with ID 3
                    await mockVehicleId.mint(user1.address)

                    await expect(dimoStaking.connect(user1).stake(1, 3))
                        .to.emit(dimoStaking, 'VehicleAttached')
                        .withArgs(user1.address, 2, 3)
                })
                it('Should not emit VehicleAttached if Vehicle ID is not set', async () => {
                    const { dimoStaking, user1 } = await loadFixture(setup)

                    await dimoStaking.connect(user1).stake(1, 1)

                    await expect(dimoStaking.connect(user1).stake(1, 0)).to.not.emit(dimoStaking, 'VehicleAttached')
                })
            })
        })
    })

    describe('upgradeStake', () => {
        context('Errors', () => {
            it('Should revert if caller does not have a Staking Beacon', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await expect(dimoStaking.connect(user1).upgradeStake(1, 1, 1))
                    .to.be.revertedWithCustomError(dimoStaking, 'NoActiveStaking')
                    .withArgs(user1.address)
            })
            it('Should revert if level is invalid', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1)

                await expect(dimoStaking.connect(user1).upgradeStake(1, 99, 1))
                    .to.be.revertedWithCustomError(dimoStaking, 'InvalidStakingLevel')
                    .withArgs(99)
            })
            it('Should revert if staking contract does not have enough allowance', async () => {
                const { dimoStaking, user1, mockDimoToken } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1)

                await mockDimoToken.connect(user1).approve(await dimoStaking.getAddress(), 0)

                await expect(dimoStaking.connect(user1).upgradeStake(1, 2, 1)).to.be.revertedWith(
                    'ERC20: insufficient allowance'
                )
            })
            it('Should revert if stake ID is invalid', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)
                const stakingBeacon = (await ethers.getContractFactory('StakingBeacon')).interface

                await dimoStaking.connect(user1).stake(1, 1)

                await expect(dimoStaking.connect(user1).upgradeStake(2, 2, 1))
                    .to.be.revertedWithCustomError({ interface: stakingBeacon }, 'InvalidStakeId')
                    .withArgs(2)
            })
            it('Should revert if a another vehicle ID is already attached', async () => {
                const { dimoStaking, user1, mockVehicleId } = await loadFixture(setup)

                // Mint another vehicle for user1 with ID 3
                await mockVehicleId.mint(user1)

                await dimoStaking.connect(user1).stake(1, 1)
                await dimoStaking.connect(user1).stake(1, 3)

                await expect(dimoStaking.connect(user1).upgradeStake(1, 2, 3))
                    .to.be.revertedWithCustomError(dimoStaking, 'VehicleAlreadyAttached')
                    .withArgs(3)
            })
            it('Should revert if caller is not the vehicle ID owner', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1)

                await expect(dimoStaking.connect(user1).upgradeStake(1, 2, 2))
                    .to.be.revertedWithCustomError(dimoStaking, 'Unauthorized')
                    .withArgs(user1.address, 2)
            })
            it('Should revert if vehicle ID does not exist', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1)

                await expect(dimoStaking.connect(user1).upgradeStake(1, 2, 99))
                    .to.be.revertedWithCustomError(dimoStaking, 'InvalidVehicleId')
                    .withArgs(99)
            })
        })

        context('State', () => {
            it('Should correctly set Staking Data struct', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                const receipt = await (await dimoStaking.connect(user1).stake(1, 1)).wait()
                const eventArgs = (receipt?.logs[2] as EventLog).args
                const stakeId = eventArgs[1] as bigint
                const stakingBeacon = await ethers.getContractAt('StakingBeacon', eventArgs[2])
                const lockEndTimeBefore = BigInt(await time.latest()) + C.stakingLevels[1].lockPeriod

                const boostStructBefore = await stakingBeacon.stakingData(stakeId)

                expect(boostStructBefore.level).to.equal(1)
                expect(boostStructBefore.amount).to.equal(C.stakingLevels[1].amount)
                expect(boostStructBefore.lockEndTime).to.be.closeTo(lockEndTimeBefore, 5n)
                expect(boostStructBefore.vehicleId).to.equal(1)

                await time.increase(1000n)

                await dimoStaking.connect(user1).upgradeStake(1, 2, 1)

                const lockEndTimeAfter = BigInt(await time.latest()) + C.stakingLevels[2].lockPeriod
                const boostStructAfter = await stakingBeacon.stakingData(stakeId)

                expect(boostStructAfter.level).to.equal(2)
                expect(boostStructAfter.amount).to.equal(C.stakingLevels[2].amount)
                expect(boostStructAfter.lockEndTime).to.be.closeTo(lockEndTimeAfter, 5n)
                expect(boostStructAfter.vehicleId).to.equal(1)
            })
            it('Should transfer correct amount of tokens to the Staking Beacon contract', async () => {
                const { dimoStaking, user1, mockDimoToken } = await loadFixture(setup)

                const receipt = await (await dimoStaking.connect(user1).stake(1, 1)).wait()
                const eventArgs = (receipt?.logs[2] as EventLog).args
                const deployedStakingBeacon = eventArgs[2]

                const stakerBalanceBefore = await mockDimoToken.balanceOf(user1)
                const beaconBalanceBefore = await mockDimoToken.balanceOf(deployedStakingBeacon)

                const amountDiff = C.stakingLevels[2].amount - C.stakingLevels[1].amount

                await dimoStaking.connect(user1).upgradeStake(1, 2, 1)

                const stakerBalanceAfter = await mockDimoToken.balanceOf(user1)
                const beaconBalanceAfter = await mockDimoToken.balanceOf(deployedStakingBeacon)

                expect(stakerBalanceAfter).to.equal(stakerBalanceBefore - amountDiff)
                expect(beaconBalanceAfter).to.equal(beaconBalanceBefore + amountDiff)
            })
        })

        context('Events', () => {
            it('Should emit Staked event with correct params', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1)

                const receipt = await (await dimoStaking.connect(user1).upgradeStake(1, 2, 1)).wait()
                const event = receipt?.logs[2] as EventLog
                const args = event.args
                const lockEndTime = BigInt(await time.latest()) + C.stakingLevels[2].lockPeriod

                expect(event.fragment.name).to.equal('Staked')
                expect(args[0]).to.equal(user1.address) // user
                expect(args[1]).to.equal(1) // stakeId
                expect(args[2]).to.not.equal(ethers.ZeroAddress) // stakingBeacon
                expect(ethers.isAddress(args[2])).to.be.true // stakingBeacon
                expect(args[3]).to.equal(C.stakingLevels[2].amount) // amount
                expect(args[4]).to.equal(2) // level
                expect(args[5]).to.be.closeTo(lockEndTime, 5n) // lockEndTime
            })
            it('Should emit VehicleAttached event with correct params if Vehicle ID is set', async () => {
                const { dimoStaking, mockVehicleId, user1 } = await loadFixture(setup)

                // Mint another vehicle for user1 with ID 3
                await mockVehicleId.mint(user1.address)

                await dimoStaking.connect(user1).stake(1, 1)

                await expect(dimoStaking.connect(user1).upgradeStake(1, 2, 3))
                    .to.emit(dimoStaking, 'VehicleAttached')
                    .withArgs(user1.address, 1, 3)
            })
            it('Should emit VehicleDetached with correct params if Vehicle ID is set to 0', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1)

                await expect(dimoStaking.connect(user1).upgradeStake(1, 2, 0))
                    .to.emit(dimoStaking, 'VehicleDetached')
                    .withArgs(user1.address, 1, 1)
            })
            it('Should not emit VehicleAttached if Vehicle ID is the same already attached', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1)

                await expect(dimoStaking.connect(user1).upgradeStake(1, 2, 1)).to.not.emit(
                    dimoStaking,
                    'VehicleAttached'
                )
            })
            it('Should not emit VehicleAttached if Vehicle ID is set to 0', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1)

                await expect(dimoStaking.connect(user1).upgradeStake(1, 2, 0)).to.not.emit(
                    dimoStaking,
                    'VehicleAttached'
                )
            })
        })
    })

    describe('withdraw(uint256)', () => {
        context('Errors', () => {
            it('Should revert if caller does not have a Staking Beacon', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await expect(dimoStaking.connect(user1)['withdraw(uint256)'](1))
                    .to.be.revertedWithCustomError(dimoStaking, 'NoActiveStaking')
                    .withArgs(user1.address)
            })
            it('Should revert if stake ID is invalid', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)
                const stakingBeacon = (await ethers.getContractFactory('StakingBeacon')).interface

                await dimoStaking.connect(user1).stake(1, 1)

                await expect(dimoStaking.connect(user1)['withdraw(uint256)'](2))
                    .to.be.revertedWithCustomError({ interface: stakingBeacon }, 'InvalidStakeId')
                    .withArgs(2)
            })
            it('Should revert if tokens are still locked', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1)

                await expect(dimoStaking.connect(user1)['withdraw(uint256)'](1))
                    .to.be.revertedWithCustomError(dimoStaking, 'TokensStillLocked')
                    .withArgs(1)
            })
        })

        context('State', () => {
            it('Should wipe staker Staking Data struct', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                const receipt = await (await dimoStaking.connect(user1).stake(1, 1)).wait()
                const eventArgs = (receipt?.logs[2] as EventLog).args
                const stakingBeacon = await ethers.getContractAt('StakingBeacon', eventArgs[2])

                await time.increase(C.stakingLevels[1].lockPeriod + 99n)

                await dimoStaking.connect(user1)['withdraw(uint256)'](1)

                const boostStructAfter = await stakingBeacon.stakingData(user1.address)
                expect(boostStructAfter).to.eql([0n, 0n, 0n, 0n])
            })
            it('Should transfer correct amount of tokens to the staker', async () => {
                const { dimoStaking, user1, mockDimoToken } = await loadFixture(setup)

                const receipt = await (await dimoStaking.connect(user1).stake(1, 1)).wait()
                const eventArgs = (receipt?.logs[2] as EventLog).args
                const stakingBeacon = await ethers.getContractAt('StakingBeacon', eventArgs[2])

                const stakerBalanceBefore = await mockDimoToken.balanceOf(user1)

                await time.increase(C.stakingLevels[1].lockPeriod + 99n)

                await dimoStaking.connect(user1)['withdraw(uint256)'](1)

                const stakerBalanceAfter = await mockDimoToken.balanceOf(user1)
                const beaconBalanceAfter = await mockDimoToken.balanceOf(stakingBeacon)

                expect(stakerBalanceAfter).to.equal(stakerBalanceBefore + C.stakingLevels[1].amount)
                expect(beaconBalanceAfter).to.equal(0)
            })
        })

        context('Events', () => {
            it('Should emit Withdraw event with correct params', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1)
                await time.increase(C.stakingLevels[1].lockPeriod + 99n)

                await expect(dimoStaking.connect(user1)['withdraw(uint256)'](1))
                    .to.emit(dimoStaking, 'Withdrawn')
                    .withArgs(user1.address, 1, C.stakingLevels[1].amount)
            })
            it('Should emit VehicleDetached event with correct params if a Vehicle ID is attached', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1)
                await time.increase(C.stakingLevels[1].lockPeriod + 99n)

                await expect(dimoStaking.connect(user1)['withdraw(uint256)'](1))
                    .to.emit(dimoStaking, 'VehicleDetached')
                    .withArgs(user1.address, 1, 1)
            })
            it('Should not emit VehicleDetached if no Vehicle ID is attached', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 0)
                await time.increase(C.stakingLevels[1].lockPeriod + 99n)

                await expect(dimoStaking.connect(user1)['withdraw(uint256)'](1)).to.not.emit(
                    dimoStaking,
                    'VehicleDetached'
                )
            })
        })
    })

    // TODO test withdraw(uint256[])
    describe('withdraw(uint256[])', () => {})

    describe('extendStaking', () => {
        context('Errors', () => {
            it('Should revert if caller does not have an active boost', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await expect(dimoStaking.connect(user1).extendStaking(1))
                    .to.be.revertedWithCustomError(dimoStaking, 'NoActiveStaking')
                    .withArgs(user1.address)
            })
            it('Should revert if stake ID is invalid', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)
                const stakingBeacon = (await ethers.getContractFactory('StakingBeacon')).interface

                await dimoStaking.connect(user1).stake(1, 1)

                await expect(dimoStaking.connect(user1).extendStaking(2))
                    .to.be.revertedWithCustomError({ interface: stakingBeacon }, 'InvalidStakeId')
                    .withArgs(2)
            })
        })

        context('State', () => {
            it('Should update lock end time', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                const receipt = await (await dimoStaking.connect(user1).stake(1, 1)).wait()
                const eventArgs = (receipt?.logs[2] as EventLog).args
                const stakingBeacon = await ethers.getContractAt('StakingBeacon', eventArgs[2])
                const stakingDataBefore = await stakingBeacon.stakingData(1)
                const lockEndTimeBefore = BigInt(await time.latest()) + C.stakingLevels[1].lockPeriod

                expect(stakingDataBefore[2]).to.be.closeTo(lockEndTimeBefore, 5n)

                await time.increase(99)

                await dimoStaking.connect(user1).extendStaking(1)
                const lockEndTimeAfter = BigInt(await time.latest()) + C.stakingLevels[1].lockPeriod
                const stakingDataAfter = await stakingBeacon.stakingData(1)

                expect(stakingDataAfter[2]).to.be.closeTo(lockEndTimeAfter, 5n)
            })
        })

        context('Events', () => {
            it('Should emit StakingExtended event with correct params', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1)
                await time.increase(99)

                // +1n because it takes 1 to execute the next transaction
                const newLockEndTime = BigInt(await time.latest()) + C.stakingLevels[1].lockPeriod + 1n
                await expect(dimoStaking.connect(user1).extendStaking(1))
                    .to.emit(dimoStaking, 'StakingExtended')
                    .withArgs(user1.address, 1, newLockEndTime)
            })
        })
    })

    describe('attachVehicle', () => {
        context('Errors', () => {
            it('Should revert if caller does not have an active boost', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await expect(dimoStaking.connect(user1).attachVehicle(1, 1))
                    .to.be.revertedWithCustomError(dimoStaking, 'NoActiveStaking')
                    .withArgs(user1.address)
            })
            it('Should revert if vehicle ID does not exist', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 0)

                await expect(dimoStaking.connect(user1).attachVehicle(1, 99))
                    .to.be.revertedWithCustomError(dimoStaking, 'InvalidVehicleId')
                    .withArgs(99)
            })
            it('Should revert if staker is not the vehicle ID owner', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1)

                await expect(dimoStaking.connect(user1).attachVehicle(1, 2))
                    .to.be.revertedWithCustomError(dimoStaking, 'Unauthorized')
                    .withArgs(user1.address, 2)
            })
            it('Should revert if vehicle ID is already attached', async () => {
                const { dimoStaking, mockVehicleId, user1 } = await loadFixture(setup)

                // Mint another vehicle for user1 with IDs 3 and 4
                await mockVehicleId.mint(user1.address)
                await mockVehicleId.mint(user1.address)

                await dimoStaking.connect(user1).stake(1, 0) // stake ID 1
                await dimoStaking.connect(user1).stake(1, 3) // stake ID 2

                await expect(dimoStaking.connect(user1).attachVehicle(1, 3))
                    .to.be.revertedWithCustomError(dimoStaking, 'VehicleAlreadyAttached')
                    .withArgs(3)
            })
        })

        context('State', () => {
            it('Should attach a stake ID to a vehicle ID', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                const receipt = await (await dimoStaking.connect(user1).stake(1, 0)).wait()
                const eventArgs = (receipt?.logs[2] as EventLog).args
                const stakingBeacon = await ethers.getContractAt('StakingBeacon', eventArgs[2])
                const stakingDataBefore = await stakingBeacon.stakingData(1)

                expect(stakingDataBefore.vehicleId).to.equal(0)

                await dimoStaking.connect(user1).attachVehicle(1, 1)

                const stakingDataAfter = await stakingBeacon.stakingData(1)
                expect(stakingDataAfter.vehicleId).to.equal(1)
            })
        })

        context('Events', () => {
            it('Should emit VehicleAttached event with correct params', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 0)

                await expect(dimoStaking.connect(user1).attachVehicle(1, 1))
                    .to.emit(dimoStaking, 'VehicleAttached')
                    .withArgs(user1.address, 1, 1)
            })
        })
    })

    describe('detachVehicle', () => {
        // TODO Separate tests in context if we allow caller to be the staker and the vehicle ID owner
        context('Errors', () => {
            it('Should revert if stake ID has no vehicle ID attached', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 0)

                await expect(dimoStaking.connect(user1).detachVehicle(1))
                    .to.be.revertedWithCustomError(dimoStaking, 'NoActiveStaking')
                    .withArgs(user1.address)
            })
            // TODO Change description/test if we allow caller to be the vehicle ID owner
            it('Should revert if caller is not the staker', async () => {
                const { dimoStaking, user1, user2 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1)

                await expect(dimoStaking.connect(user2).detachVehicle(1))
                    .to.be.revertedWithCustomError(dimoStaking, 'Unauthorized')
                    .withArgs(user2.address, 1)
            })
        })

        context('State', () => {
            it('Should detach a vehicle ID', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                const receipt = await (await dimoStaking.connect(user1).stake(1, 1)).wait()
                const eventArgs = (receipt?.logs[2] as EventLog).args
                const stakingBeacon = await ethers.getContractAt('StakingBeacon', eventArgs[2])
                const stakingDataBefore = await stakingBeacon.stakingData(1)

                expect(stakingDataBefore.vehicleId).to.equal(1)

                await dimoStaking.connect(user1).detachVehicle(1)

                const stakingDataAfter = await stakingBeacon.stakingData(1)
                expect(stakingDataAfter.vehicleId).to.equal(0)
            })
        })

        context('Events', () => {
            it('Should emit VehicleDetached event with correct params', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1)

                await expect(dimoStaking.connect(user1).detachVehicle(1))
                    .to.emit(dimoStaking, 'VehicleDetached')
                    .withArgs(user1.address, 1, 1)
            })
        })
    })

    describe('delegate', () => {
        context('Errors', () => {
            it('Should revert if caller does not have a Staking Beacon', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await expect(dimoStaking.connect(user1).delegate(user1.address))
                    .to.be.revertedWithCustomError(dimoStaking, 'NoActiveStaking')
                    .withArgs(user1.address)
            })
        })

        context('State', () => {
            it('Should correctly delegate staked tokens to your own account', async () => {
                const { dimoStaking, mockDimoToken, user1 } = await loadFixture(setup)
                const balanceUser1 = await mockDimoToken.balanceOf(user1.address)

                await mockDimoToken.connect(user1).delegate(user1.address)
                expect(await mockDimoToken.getVotes(user1.address)).to.equal(balanceUser1)

                await dimoStaking.connect(user1).stake(1, 1)

                // Should lose the staking level amount in voting power when stake
                expect(await mockDimoToken.getVotes(user1.address)).to.equal(balanceUser1 - C.stakingLevels[1].amount)

                await dimoStaking.connect(user1).delegate(user1.address)
                expect(await mockDimoToken.getVotes(user1.address)).to.equal(balanceUser1)
            })
            it('Should correctly delegate staked tokens to another account', async () => {
                const { dimoStaking, mockDimoToken, user1, user2 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1)

                expect(await mockDimoToken.getVotes(user2.address)).to.equal(0)

                await dimoStaking.connect(user1).delegate(user2.address)

                expect(await mockDimoToken.getVotes(user2.address)).to.equal(C.stakingLevels[1].amount)
            })
        })
    })
})
