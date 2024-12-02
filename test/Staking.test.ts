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

        const { dimoStaking, mockDimoToken, mockVehicleId } = (await ignition.deploy(DIMOStakingTestModule, {
            defaultSender: deployer.address,
        })) as unknown as StakingModule

        await mockDimoToken.mint(user1.address, amount)
        await mockDimoToken.mint(user2.address, amount)
        await mockDimoToken.connect(user1).approve(await dimoStaking.getAddress(), amount)
        await mockDimoToken.connect(user2).approve(await dimoStaking.getAddress(), amount)
        await mockVehicleId.mint(user1.address)
        await mockVehicleId.mint(user2.address)

        return { user1, user2, dimoStaking, mockDimoToken, mockVehicleId }
    }
    async function setupMultipleStakes() {
        const [deployer, user1, user2] = await ethers.getSigners()
        const amount = ethers.parseEther('1000000')

        const { dimoStaking, mockDimoToken, mockVehicleId } = (await ignition.deploy(DIMOStakingTestModule, {
            defaultSender: deployer.address,
        })) as unknown as StakingModule

        await mockDimoToken.mint(user1.address, amount)
        await mockDimoToken.connect(user1).approve(await dimoStaking.getAddress(), amount)
        await mockVehicleId.mint(user1.address) // Vehicle ID 1
        await mockVehicleId.mint(user1.address) // Vehicle ID 2
        await mockVehicleId.mint(user1.address) // Vehicle ID 3

        await dimoStaking.connect(user1).stake(1, 1)
        await dimoStaking.connect(user1).stake(1, 2)
        await dimoStaking.connect(user1).stake(1, 3)

        const stakingBeaconAddress = await dimoStaking.stakerToStake(user1.address)
        const stakingBeacon1 = await ethers.getContractAt('StakingBeacon', stakingBeaconAddress)

        return { user1, user2, dimoStaking, stakingBeacon1, mockDimoToken, mockVehicleId }
    }

    describe('Deployment', () => {
        it('Should set DIMO Token address', async () => {
            const { dimoStaking, mockDimoToken } = await loadFixture(setup)

            expect(await dimoStaking.dimoToken()).to.equal(await mockDimoToken.getAddress())
        })
        it('Should set Vehicle ID address', async () => {
            const { dimoStaking, mockVehicleId } = await loadFixture(setup)

            expect(await dimoStaking.vehicleIdProxy()).to.equal(await mockVehicleId.getAddress())
        })
        it('Should set boost levels', async () => {
            const { dimoStaking } = await loadFixture(setup)

            expect(await dimoStaking.stakingLevels(0)).to.eql(Object.values(C.stakingLevels[0]))
            expect(await dimoStaking.stakingLevels(1)).to.eql(Object.values(C.stakingLevels[1]))
            expect(await dimoStaking.stakingLevels(2)).to.eql(Object.values(C.stakingLevels[2]))
        })
        it('Should set name an symbol', async () => {
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
                    const eventArgs = (receipt?.logs[3] as EventLog).args
                    const stakingBeaconAddress = eventArgs[2]

                    expect(await dimoStaking.stakerToStake(user1.address)).to.equal(stakingBeaconAddress)
                    expect(ethers.isAddress(stakingBeaconAddress)).to.be.true
                })
                it('Should correctly set Staking Data struct', async () => {
                    const { dimoStaking, user1 } = await loadFixture(setup)

                    expect(await dimoStaking.stakerToStake(user1.address)).to.equal(ethers.ZeroAddress)

                    const receipt = await (await dimoStaking.connect(user1).stake(1, 1)).wait()
                    const eventArgs = (receipt?.logs[3] as EventLog).args
                    const stakeId = eventArgs[1] as bigint

                    expect(stakeId).to.equal(1)

                    const lockEndTime = BigInt(await time.latest()) + C.stakingLevels[1].lockPeriod
                    const stakingData = await dimoStaking.stakeIdToStakingData(stakeId)

                    expect(stakingData.level).to.equal(1)
                    expect(stakingData.amount).to.equal(C.stakingLevels[1].amount)
                    expect(stakingData.lockEndTime).to.be.closeTo(lockEndTime, 5n)
                    expect(stakingData.vehicleId).to.equal(1)
                })
                it('Should correctly map Vehicle ID to Stake ID', async () => {
                    const { dimoStaking, user1 } = await loadFixture(setup)

                    expect(await dimoStaking.stakerToStake(user1.address)).to.equal(ethers.ZeroAddress)

                    const receipt = await (await dimoStaking.connect(user1).stake(1, 1)).wait()
                    const eventArgs = (receipt?.logs[3] as EventLog).args
                    const stakeId = eventArgs[1] as bigint

                    const stakeIdByVehicleId1 = await dimoStaking.vehicleIdToStakeId(1)

                    expect(stakeIdByVehicleId1).to.equal(stakeId)
                })
                it('Should not set vehicle ID if this parameter is 0', async () => {
                    const { dimoStaking, user1 } = await loadFixture(setup)

                    const receipt = await (await dimoStaking.connect(user1).stake(1, 0)).wait()
                    const eventArgs = (receipt?.logs[3] as EventLog).args
                    const stakeId = eventArgs[1] as bigint

                    const stakingData = await dimoStaking.stakeIdToStakingData(stakeId)

                    expect(stakingData.vehicleId).to.equal(0)
                })
                it('Should transfer correct amount of tokens to the Staking Beacon contract', async () => {
                    const { dimoStaking, user1, mockDimoToken } = await loadFixture(setup)

                    const stakerBalanceBefore = await mockDimoToken.balanceOf(user1)

                    const amount = C.stakingLevels[1].amount

                    const receipt = await (await dimoStaking.connect(user1).stake(1, 1)).wait()
                    const eventArgs = (receipt?.logs[3] as EventLog).args
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
                    const eventArgs = (receipt?.logs[3] as EventLog).args
                    const stakeId = eventArgs[1] as bigint

                    expect(stakeId).to.equal(2)

                    const lockEndTime = BigInt(await time.latest()) + C.stakingLevels[1].lockPeriod
                    const stakingData = await dimoStaking.stakeIdToStakingData(stakeId)

                    expect(stakingData.level).to.equal(1)
                    expect(stakingData.amount).to.equal(C.stakingLevels[1].amount)
                    expect(stakingData.lockEndTime).to.be.closeTo(lockEndTime, 5n)
                    expect(stakingData.vehicleId).to.equal(3)
                })
                it('Should correctly map Vehicle ID to Stake ID', async () => {
                    const { dimoStaking, user1, mockVehicleId } = await loadFixture(setup)

                    await dimoStaking.connect(user1).stake(1, 1)
                    // Mint another vehicle for user1 with ID 3
                    await mockVehicleId.mint(user1.address)

                    const receipt = await (await dimoStaking.connect(user1).stake(1, 3)).wait()
                    const eventArgs = (receipt?.logs[3] as EventLog).args
                    const stakeId = eventArgs[1] as bigint

                    const stakeIdByVehicleId3 = await dimoStaking.vehicleIdToStakeId(3)

                    expect(stakeIdByVehicleId3).to.equal(stakeId)
                })
                it('Should not set vehicle ID in the Staking Beacon contract if this parameter is 0', async () => {
                    const { dimoStaking, user1 } = await loadFixture(setup)

                    await dimoStaking.connect(user1).stake(1, 1)

                    const receipt = await (await dimoStaking.connect(user1).stake(1, 0)).wait()
                    const eventArgs = (receipt?.logs[3] as EventLog).args
                    const stakeId = eventArgs[1] as bigint

                    const stakingData = await dimoStaking.stakeIdToStakingData(stakeId)

                    expect(stakingData.vehicleId).to.equal(0)
                })
                it('Should transfer correct amount of tokens to the Staking Beacon contract', async () => {
                    const { dimoStaking, user1, mockDimoToken, mockVehicleId } = await loadFixture(setup)

                    const receipt1 = await (await dimoStaking.connect(user1).stake(1, 1)).wait()
                    const eventArgs1 = (receipt1?.logs[3] as EventLog).args
                    const stakingBeaconAddress = eventArgs1[2] as string

                    const stakerBalanceBefore = await mockDimoToken.balanceOf(user1)
                    const stakingBeaconBalanceBefore = await mockDimoToken.balanceOf(stakingBeaconAddress)

                    // Mint another vehicle for user1 with ID 3
                    await mockVehicleId.mint(user1.address)

                    const amount = C.stakingLevels[1].amount

                    const receipt2 = await (await dimoStaking.connect(user1).stake(1, 3)).wait()
                    const eventArgs2 = (receipt2?.logs[3] as EventLog).args
                    const stakingBeacon = eventArgs2[2]

                    const stakerBalanceAfter = await mockDimoToken.balanceOf(user1)
                    const beaconBalanceAfter = await mockDimoToken.balanceOf(stakingBeacon)

                    expect(stakerBalanceAfter).to.equal(stakerBalanceBefore - amount)
                    expect(beaconBalanceAfter).to.equal(stakingBeaconBalanceBefore + amount)
                })
                it('Should reattach Vehicle ID if it was attached to an expired stake', async () => {
                    const { dimoStaking, user1 } = await loadFixture(setup)

                    await dimoStaking.connect(user1).stake(1, 1)

                    expect(await dimoStaking.vehicleIdToStakeId(1)).to.equal(1)

                    await time.increase(C.stakingLevels[1].lockPeriod + 99n)

                    await dimoStaking.connect(user1).stake(1, 1)

                    const stakingData1 = await dimoStaking.stakeIdToStakingData(1)
                    const stakingData2 = await dimoStaking.stakeIdToStakingData(2)
                    const stakeIdByVehicleId1 = await dimoStaking.vehicleIdToStakeId(1)

                    expect(stakingData1.vehicleId).to.equal(0)
                    expect(stakingData2.vehicleId).to.equal(1)
                    expect(stakeIdByVehicleId1).to.equal(2)
                })
            })
        })

        context('Events', () => {
            context('Staker does not have a Staking Beacon', () => {
                it('Should emit Staked event with correct params', async () => {
                    const { dimoStaking, user1 } = await loadFixture(setup)

                    const receipt = await (await dimoStaking.connect(user1).stake(1, 1)).wait()
                    const event = receipt?.logs[3] as EventLog
                    const args = event.args
                    const lockEndTime = BigInt(await time.latest()) + C.stakingLevels[1].lockPeriod

                    expect(event.fragment.name).to.equal('Staked')
                    expect(args[0]).to.equal(user1.address) // user
                    expect(args[1]).to.equal(1) // stakeId
                    expect(args[2]).to.not.equal(ethers.ZeroAddress) // stakingBeacon
                    expect(ethers.isAddress(args[2])).to.be.true // stakingBeacon
                    expect(args[3]).to.equal(1) // level
                    expect(args[4]).to.equal(C.stakingLevels[1].amount) // amount
                    expect(args[5]).to.be.closeTo(lockEndTime, 5n) // lockEndTime
                    expect(args[6]).to.equal(C.stakingLevels[1].points) // points
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
                    const event = receipt?.logs[3] as EventLog
                    const args = event.args
                    const lockEndTime = BigInt(await time.latest()) + C.stakingLevels[1].lockPeriod

                    expect(event.fragment.name).to.equal('Staked')
                    expect(args[0]).to.equal(user1.address) // user
                    expect(args[1]).to.equal(2) // stakeId
                    expect(args[2]).to.not.equal(ethers.ZeroAddress) // stakingBeacon
                    expect(ethers.isAddress(args[2])).to.be.true // stakingBeacon
                    expect(args[3]).to.equal(1) // level
                    expect(args[4]).to.equal(C.stakingLevels[1].amount) // amount
                    expect(args[5]).to.be.closeTo(lockEndTime, 5n) // lockEndTime
                    expect(args[6]).to.equal(C.stakingLevels[1].points) // points
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
                it('Should emit VehicleDetached with correct params if it was attached to an expired stake of the caller', async () => {
                    const { dimoStaking, user1 } = await loadFixture(setup)

                    await dimoStaking.connect(user1).stake(1, 1)

                    await time.increase(C.stakingLevels[1].lockPeriod + 99n)

                    await expect(dimoStaking.connect(user1).stake(1, 1))
                        .to.emit(dimoStaking, 'VehicleDetached')
                        .withArgs(user1.address, 1, 1)
                })
                it('Should emit VehicleDetached with correct params if it was attached to an expired stake of another user', async () => {
                    const { dimoStaking, user1, user2 } = await loadFixture(setup)

                    await dimoStaking.connect(user1).stake(1, 1)
                    await dimoStaking.connect(user2).stake(1, 2)

                    await time.increase(C.stakingLevels[1].lockPeriod + 99n)

                    await expect(dimoStaking.connect(user1).stake(1, 2))
                        .to.emit(dimoStaking, 'VehicleDetached')
                        .withArgs(user2.address, 2, 2)
                })
            })
        })
    })

    describe('upgradeStake', () => {
        context('Errors', () => {
            it('Should revert if stake ID does not exist', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await expect(dimoStaking.connect(user1).upgradeStake(1, 1, 1))
                    .to.be.revertedWithCustomError(dimoStaking, 'ERC721NonexistentToken')
                    .withArgs(1)
            })
            it('Should revert if caller does not have a Staking Beacon', async () => {
                const { dimoStaking, user1, user2 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1)

                await expect(dimoStaking.connect(user2).upgradeStake(1, 1, 1))
                    .to.be.revertedWithCustomError(dimoStaking, 'InvalidStakeId')
                    .withArgs(1)
            })
            it('Should revert if level is not higher than the current level', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1)

                await expect(dimoStaking.connect(user1).upgradeStake(1, 1, 1))
                    .to.be.revertedWithCustomError(dimoStaking, 'InvalidStakingLevel')
                    .withArgs(1)
            })
            it('Should revert if level is higher than the max level', async () => {
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
                const { dimoStaking, user1, mockVehicleId } = await loadFixture(setup)

                const receipt = await (await dimoStaking.connect(user1).stake(1, 1)).wait()
                const eventArgs = (receipt?.logs[3] as EventLog).args
                const stakeId = eventArgs[1] as bigint
                const lockEndTimeBefore = BigInt(await time.latest()) + C.stakingLevels[1].lockPeriod

                const boostStructBefore = await dimoStaking.stakeIdToStakingData(stakeId)

                expect(boostStructBefore.level).to.equal(1)
                expect(boostStructBefore.amount).to.equal(C.stakingLevels[1].amount)
                expect(boostStructBefore.lockEndTime).to.be.closeTo(lockEndTimeBefore, 5n)
                expect(boostStructBefore.vehicleId).to.equal(1)

                await time.increase(1000n)

                // Mint another vehicle for user1 with ID 3
                await mockVehicleId.mint(user1.address)

                await dimoStaking.connect(user1).upgradeStake(1, 2, 3)

                const lockEndTimeAfter = BigInt(await time.latest()) + C.stakingLevels[2].lockPeriod
                const boostStructAfter = await dimoStaking.stakeIdToStakingData(stakeId)

                expect(boostStructAfter.level).to.equal(2)
                expect(boostStructAfter.amount).to.equal(C.stakingLevels[2].amount)
                expect(boostStructAfter.lockEndTime).to.be.closeTo(lockEndTimeAfter, 5n)
                expect(boostStructAfter.vehicleId).to.equal(3)
            })
            it('Should transfer correct amount of tokens to the Staking Beacon contract', async () => {
                const { dimoStaking, user1, mockDimoToken } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1)
                const deployedStakingBeacon = await dimoStaking.stakerToStake(user1.address)

                const stakerBalanceBefore = await mockDimoToken.balanceOf(user1)
                const beaconBalanceBefore = await mockDimoToken.balanceOf(deployedStakingBeacon)

                const amountDiff = C.stakingLevels[2].amount - C.stakingLevels[1].amount

                await dimoStaking.connect(user1).upgradeStake(1, 2, 1)

                const stakerBalanceAfter = await mockDimoToken.balanceOf(user1)
                const beaconBalanceAfter = await mockDimoToken.balanceOf(deployedStakingBeacon)

                expect(stakerBalanceAfter).to.equal(stakerBalanceBefore - amountDiff)
                expect(beaconBalanceAfter).to.equal(beaconBalanceBefore + amountDiff)
            })
            it('Should erase vehicle ID if this parameter is 0', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1)

                expect(await dimoStaking.vehicleIdToStakeId(1)).to.equal(1)

                await dimoStaking.connect(user1).upgradeStake(1, 2, 0)

                const stakingData = await dimoStaking.stakeIdToStakingData(1)
                const stakeIdByVehicleId = await dimoStaking.vehicleIdToStakeId(1)

                expect(stakingData.vehicleId).to.equal(0)
                expect(stakeIdByVehicleId).to.equal(0)
            })
            it('Should reattach Vehicle ID if it was attached to an expired stake', async () => {
                const { dimoStaking, user1, mockVehicleId } = await loadFixture(setup)

                // Mint another vehicle for user1 with ID 3
                await mockVehicleId.mint(user1.address)

                await dimoStaking.connect(user1).stake(1, 1) // Stake ID 1

                expect(await dimoStaking.vehicleIdToStakeId(1)).to.equal(1)

                // To expire Stake ID 1
                await time.increase(C.stakingLevels[1].lockPeriod + 99n)

                await dimoStaking.connect(user1).stake(1, 3) // Stake ID 2

                // To reattach Vehicle 1 from stake ID 1
                await dimoStaking.connect(user1).upgradeStake(2, 2, 1)

                const stakingData1 = await dimoStaking.stakeIdToStakingData(1)
                const stakingData2 = await dimoStaking.stakeIdToStakingData(2)
                const stakeIdByVehicleId1 = await dimoStaking.vehicleIdToStakeId(1)
                const stakeIdByVehicleId3 = await dimoStaking.vehicleIdToStakeId(3)

                expect(stakingData1.vehicleId).to.equal(0) // Expired Stake ID 1
                expect(stakingData2.vehicleId).to.equal(1) // Stake ID 2 with expired vehicle from Stake ID 1
                expect(stakeIdByVehicleId1).to.equal(2) // Vehicle ID 1 attached to the last Stake ID
                expect(stakeIdByVehicleId3).to.equal(0) // Vehicle ID 3 previously attached to Stake ID 2
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
                expect(args[3]).to.equal(2) // level
                expect(args[4]).to.equal(C.stakingLevels[2].amount) // amount
                expect(args[5]).to.be.closeTo(lockEndTime, 5n) // lockEndTime
                expect(args[6]).to.equal(C.stakingLevels[2].points) // points
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
            it('Should emit VehicleDetached with correct params if it was attached to an expired stake of the caller', async () => {
                const { dimoStaking, user1, mockVehicleId } = await loadFixture(setup)

                // Mint another vehicle for user1 with ID 3
                await mockVehicleId.mint(user1.address)

                await dimoStaking.connect(user1).stake(1, 1) // Stake ID 1
                await time.increase(C.stakingLevels[1].lockPeriod + 99n)

                await dimoStaking.connect(user1).stake(1, 3) // Stake ID 2

                // To reattache Vehicle 1 from stake ID 1
                await expect(dimoStaking.connect(user1).upgradeStake(2, 2, 1))
                    .to.emit(dimoStaking, 'VehicleDetached')
                    .withArgs(user1.address, 1, 1)
            })
            it('Should emit VehicleDetached with correct params if it was attached to an expired stake of another user', async () => {
                const { dimoStaking, user1, user2 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1) // Stake ID 1
                await dimoStaking.connect(user2).stake(1, 2) // Stake ID 2

                await time.increase(C.stakingLevels[1].lockPeriod + 99n)

                // To reattache Vehicle 1 from stake ID 1
                await expect(dimoStaking.connect(user1).upgradeStake(1, 2, 2))
                    .to.emit(dimoStaking, 'VehicleDetached')
                    .withArgs(user2.address, 2, 2)
            })
        })
    })

    describe('withdraw(uint256)', () => {
        context('Errors', () => {
            it('Should revert if stake ID does not exist', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await expect(dimoStaking.connect(user1)['withdraw(uint256)'](1))
                    .to.be.revertedWithCustomError(dimoStaking, 'ERC721NonexistentToken')
                    .withArgs(1)
            })
            it('Should revert if caller does not have a Staking Beacon', async () => {
                const { dimoStaking, user1, user2 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1)

                await expect(dimoStaking.connect(user2)['withdraw(uint256)'](1))
                    .to.be.revertedWithCustomError(dimoStaking, 'InvalidStakeId')
                    .withArgs(1)
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

                await dimoStaking.connect(user1).stake(1, 1)

                const boostStructBefore = await dimoStaking.stakeIdToStakingData(1)
                expect(boostStructBefore).to.not.eql([0n, 0n, 0n, 0n])

                await time.increase(C.stakingLevels[1].lockPeriod + 99n)

                await dimoStaking.connect(user1)['withdraw(uint256)'](1)

                const boostStructAfter = await dimoStaking.stakeIdToStakingData(1)
                expect(boostStructAfter).to.eql([0n, 0n, 0n, 0n])
            })
            it('Should update Vehicle ID to Stake ID mapping if a Vehicle ID is attached', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1)
                await time.increase(C.stakingLevels[1].lockPeriod + 99n)

                const vehicleIdToStakeIdBefore = await dimoStaking.vehicleIdToStakeId(1)
                expect(vehicleIdToStakeIdBefore).to.equal(1)

                await dimoStaking.connect(user1)['withdraw(uint256)'](1)

                const vehicleIdToStakeIdAfter = await dimoStaking.vehicleIdToStakeId(1)
                expect(vehicleIdToStakeIdAfter).to.equal(0)
            })
            it('Should transfer correct amount of tokens to the staker', async () => {
                const { dimoStaking, user1, mockDimoToken } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1)
                const stakingBeaconAddress = await dimoStaking.stakerToStake(user1.address)
                const stakingBeacon = await ethers.getContractAt('StakingBeacon', stakingBeaconAddress)

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
                    .withArgs(user1.address, 1, C.stakingLevels[1].amount, C.stakingLevels[1].points)
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

    describe('withdraw(uint256[])', () => {
        context('Errors', () => {
            it('Should revert if stake ID does not exist', async () => {
                const { dimoStaking, user1 } = await loadFixture(setupMultipleStakes)

                await expect(dimoStaking.connect(user1)['withdraw(uint256[])']([99, 1, 2, 3]))
                    .to.be.revertedWithCustomError(dimoStaking, 'ERC721NonexistentToken')
                    .withArgs(99)
            })
            it('Should revert if caller does not have a Staking Beacon', async () => {
                const { dimoStaking, user2 } = await loadFixture(setupMultipleStakes)

                await expect(dimoStaking.connect(user2)['withdraw(uint256[])']([1, 2, 3]))
                    .to.be.revertedWithCustomError(dimoStaking, 'InvalidStakeId')
                    .withArgs(1)
            })
            it('Should revert if tokens are still locked', async () => {
                const { dimoStaking, user1 } = await loadFixture(setupMultipleStakes)

                await expect(dimoStaking.connect(user1)['withdraw(uint256[])']([1, 2, 3]))
                    .to.be.revertedWithCustomError(dimoStaking, 'TokensStillLocked')
                    .withArgs(1)
            })
        })

        context('State', () => {
            it('Should wipe staker Staking Data struct', async () => {
                const { dimoStaking, user1 } = await loadFixture(setupMultipleStakes)

                let boostStructBefore
                for (let i = 1; i < 4; i++) {
                    boostStructBefore = await dimoStaking.stakeIdToStakingData(i)
                    expect(boostStructBefore).to.not.eql([0n, 0n, 0n, 0n])
                }

                await time.increase(C.stakingLevels[1].lockPeriod + 99n)

                await dimoStaking.connect(user1)['withdraw(uint256[])']([1, 2, 3])

                let boostStructAfter
                for (let i = 1; i < 4; i++) {
                    boostStructAfter = await dimoStaking.stakeIdToStakingData(i)
                    expect(boostStructAfter).to.eql([0n, 0n, 0n, 0n])
                }
            })
            it('Should update Vehicle ID to Stake ID mapping if a Vehicle ID is attached', async () => {
                const { dimoStaking, user1 } = await loadFixture(setupMultipleStakes)

                let vehicleIdToStakeIdBefore
                for (let i = 1; i < 4; i++) {
                    vehicleIdToStakeIdBefore = await dimoStaking.vehicleIdToStakeId(i)
                    expect(vehicleIdToStakeIdBefore).to.equal(i)
                }

                await time.increase(C.stakingLevels[1].lockPeriod + 99n)

                await dimoStaking.connect(user1)['withdraw(uint256[])']([1, 2, 3])

                let vehicleIdToStakeIdAfter
                for (let i = 1; i < 4; i++) {
                    vehicleIdToStakeIdAfter = await dimoStaking.vehicleIdToStakeId(i)
                    expect(vehicleIdToStakeIdAfter).to.equal(0)
                }
            })
            it('Should transfer correct amount of tokens to the staker', async () => {
                const { dimoStaking, stakingBeacon1, user1, mockDimoToken } = await loadFixture(setupMultipleStakes)

                const stakerBalanceBefore = await mockDimoToken.balanceOf(user1)

                await time.increase(C.stakingLevels[1].lockPeriod + 99n)

                await dimoStaking.connect(user1)['withdraw(uint256[])']([1, 2, 3])

                const stakerBalanceAfter = await mockDimoToken.balanceOf(user1)
                const beaconBalanceAfter = await mockDimoToken.balanceOf(stakingBeacon1)

                // 3 stakes
                expect(stakerBalanceAfter).to.equal(stakerBalanceBefore + C.stakingLevels[1].amount * 3n)
                expect(beaconBalanceAfter).to.equal(0)
            })
        })

        context('Events', () => {
            it('Should emit Withdraw event with correct params', async () => {
                const { dimoStaking, user1 } = await loadFixture(setupMultipleStakes)

                await time.increase(C.stakingLevels[1].lockPeriod + 99n)

                await expect(dimoStaking.connect(user1)['withdraw(uint256[])']([1, 2, 3]))
                    .to.emit(dimoStaking, 'Withdrawn')
                    .withArgs(user1.address, 1, C.stakingLevels[1].amount, C.stakingLevels[1].points)
                    .to.emit(dimoStaking, 'Withdrawn')
                    .withArgs(user1.address, 2, C.stakingLevels[1].amount, C.stakingLevels[1].points)
                    .to.emit(dimoStaking, 'Withdrawn')
                    .withArgs(user1.address, 3, C.stakingLevels[1].amount, C.stakingLevels[1].points)
            })
            it('Should emit VehicleDetached event with correct params if a Vehicle ID is attached', async () => {
                const { dimoStaking, user1 } = await loadFixture(setupMultipleStakes)

                await time.increase(C.stakingLevels[1].lockPeriod + 99n)

                await expect(dimoStaking.connect(user1)['withdraw(uint256[])']([1, 2, 3]))
                    .to.emit(dimoStaking, 'VehicleDetached')
                    .withArgs(user1.address, 1, 1)
                    .to.emit(dimoStaking, 'VehicleDetached')
                    .withArgs(user1.address, 2, 2)
                    .to.emit(dimoStaking, 'VehicleDetached')
                    .withArgs(user1.address, 3, 3)
            })
            it('Should not emit VehicleDetached if no Vehicle ID is attached', async () => {
                const { dimoStaking, user1 } = await loadFixture(setupMultipleStakes)

                await dimoStaking.connect(user1).detachVehicle(1)
                await dimoStaking.connect(user1).detachVehicle(2)
                await dimoStaking.connect(user1).detachVehicle(3)

                await time.increase(C.stakingLevels[1].lockPeriod + 99n)

                await expect(dimoStaking.connect(user1)['withdraw(uint256[])']([1, 2, 3])).to.not.emit(
                    dimoStaking,
                    'VehicleDetached'
                )
            })
        })
    })

    describe('extendStaking', () => {
        context('Errors', () => {
            it('Should revert if stake ID does not exist', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await expect(dimoStaking.connect(user1).extendStaking(1))
                    .to.be.revertedWithCustomError(dimoStaking, 'ERC721NonexistentToken')
                    .withArgs(1)
            })
            it('Should revert if caller does not have a Staking Beacon', async () => {
                const { dimoStaking, user1, user2 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1)

                await expect(dimoStaking.connect(user2).extendStaking(1))
                    .to.be.revertedWithCustomError(dimoStaking, 'InvalidStakeId')
                    .withArgs(1)
            })
        })

        context('State', () => {
            it('Should update lock end time', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1)
                const stakingDataBefore = await dimoStaking.stakeIdToStakingData(1)
                const lockEndTimeBefore = BigInt(await time.latest()) + C.stakingLevels[1].lockPeriod

                expect(stakingDataBefore[2]).to.be.closeTo(lockEndTimeBefore, 5n)

                await time.increase(99)

                await dimoStaking.connect(user1).extendStaking(1)
                const lockEndTimeAfter = BigInt(await time.latest()) + C.stakingLevels[1].lockPeriod
                const stakingDataAfter = await dimoStaking.stakeIdToStakingData(1)

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
                    .withArgs(user1.address, 1, newLockEndTime, C.stakingLevels[1].points)
            })
        })
    })

    describe('attachVehicle', () => {
        context('Errors', () => {
            it('Should revert if stake ID does not exist', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await expect(dimoStaking.connect(user1).attachVehicle(1, 1))
                    .to.be.revertedWithCustomError(dimoStaking, 'ERC721NonexistentToken')
                    .withArgs(1)
            })
            it('Should revert if caller does not have a Staking Beacon', async () => {
                const { dimoStaking, user1, user2 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1)

                await expect(dimoStaking.connect(user2).attachVehicle(1, 1))
                    .to.be.revertedWithCustomError(dimoStaking, 'InvalidStakeId')
                    .withArgs(1)
            })
            it('Should revert if vehicle ID does not exist', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 0)

                await expect(dimoStaking.connect(user1).attachVehicle(1, 99))
                    .to.be.revertedWithCustomError(dimoStaking, 'InvalidVehicleId')
                    .withArgs(99)
            })
            it('Should revert if vehicle ID is already attached to the same stake ID', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1)

                await expect(dimoStaking.connect(user1).attachVehicle(1, 1))
                    .to.be.revertedWithCustomError(dimoStaking, 'VehicleAlreadyAttached')
                    .withArgs(1)
            })
            it('Should revert if vehicle ID is already attached to another active stake ID', async () => {
                const { dimoStaking, user1, user2 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1) // stake ID 1
                await dimoStaking.connect(user2).stake(1, 2) // stake ID 2

                await expect(dimoStaking.connect(user1).attachVehicle(1, 2))
                    .to.be.revertedWithCustomError(dimoStaking, 'VehicleAlreadyAttached')
                    .withArgs(2)
            })
        })

        context('State', () => {
            it('Should attach a stake ID to a vehicle ID', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 0)
                const stakingDataBefore = await dimoStaking.stakeIdToStakingData(1)
                const stakeIdByVehicleIdBefore = await dimoStaking.vehicleIdToStakeId(1)
                expect(stakeIdByVehicleIdBefore).to.equal(0)

                expect(stakingDataBefore.vehicleId).to.equal(0)

                await dimoStaking.connect(user1).attachVehicle(1, 1)

                const stakingDataAfter = await dimoStaking.stakeIdToStakingData(1)
                const stakeIdByVehicleId = await dimoStaking.vehicleIdToStakeId(1)
                expect(stakingDataAfter.vehicleId).to.equal(1)
                expect(stakeIdByVehicleId).to.equal(1)
            })
            it('Should reattach Vehicle ID if it was attached to an expired stake', async () => {
                const { dimoStaking, user1, user2 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1)
                await dimoStaking.connect(user2).stake(1, 2)

                const stakingDataBefore1 = await dimoStaking.stakeIdToStakingData(1)
                const stakingDataBefore2 = await dimoStaking.stakeIdToStakingData(2)
                const stakeIdByVehicleIdBefore1 = await dimoStaking.vehicleIdToStakeId(1)
                const stakeIdByVehicleIdBefore2 = await dimoStaking.vehicleIdToStakeId(2)

                expect(stakingDataBefore1.vehicleId).to.equal(1)
                expect(stakeIdByVehicleIdBefore1).to.equal(1)
                expect(stakingDataBefore2.vehicleId).to.equal(2)
                expect(stakeIdByVehicleIdBefore2).to.equal(2)

                await time.increase(C.stakingLevels[1].lockPeriod + 99n)

                await dimoStaking.connect(user1).attachVehicle(1, 2)

                const stakingDataAfter1 = await dimoStaking.stakeIdToStakingData(1)
                const stakingDataAfter2 = await dimoStaking.stakeIdToStakingData(2)
                const stakeIdByVehicleId1 = await dimoStaking.vehicleIdToStakeId(1)
                const stakeIdByVehicleId2 = await dimoStaking.vehicleIdToStakeId(2)

                expect(stakingDataAfter1.vehicleId).to.equal(2) // Stake ID 1 attached to expired Vehicle ID 2
                expect(stakeIdByVehicleId1).to.equal(0) // Previous Vehicle ID 1 detached
                expect(stakingDataAfter2.vehicleId).to.equal(0) // Expired Vehicle ID 2 detached from Stake ID 2
                expect(stakeIdByVehicleId2).to.equal(1) // Expired Vehicle ID 2 attached to Stake ID 1
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
            it('Should emit VehicleDetached with correct params if it was attached to an expired stake of the caller', async () => {
                const { dimoStaking, user1, mockVehicleId } = await loadFixture(setup)

                // Mint another vehicle for user1 with ID 3
                await mockVehicleId.mint(user1.address)

                await dimoStaking.connect(user1).stake(1, 1)
                await dimoStaking.connect(user1).stake(1, 3)

                await time.increase(C.stakingLevels[1].lockPeriod + 99n)

                await expect(dimoStaking.connect(user1).attachVehicle(1, 3))
                    .to.emit(dimoStaking, 'VehicleDetached')
                    .withArgs(user1.address, 2, 3)
            })
            it('Should emit VehicleDetached with correct params if it was attached to an expired stake of another user', async () => {
                const { dimoStaking, user1, user2 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 0)
                await dimoStaking.connect(user2).stake(1, 2)

                await time.increase(C.stakingLevels[1].lockPeriod + 99n)

                await expect(dimoStaking.connect(user1).attachVehicle(1, 2))
                    .to.emit(dimoStaking, 'VehicleDetached')
                    .withArgs(user2.address, 2, 2)
            })
            it('Should emit VehicleDetached with correct params if there was another Vehicle ID already attached', async () => {
                const { dimoStaking, mockVehicleId, user1 } = await loadFixture(setup)

                // Mint another vehicle for user1 with ID 3
                await mockVehicleId.mint(user1.address)

                await dimoStaking.connect(user1).stake(1, 1)

                await expect(dimoStaking.connect(user1).attachVehicle(1, 3))
                    .to.emit(dimoStaking, 'VehicleDetached')
                    .withArgs(user1.address, 1, 1)
            })
        })
    })

    describe('detachVehicle', () => {
        context('Errors', () => {
            it('Should revert if stake ID has no vehicle ID attached', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 0)

                await expect(dimoStaking.connect(user1).detachVehicle(1)).to.be.revertedWithCustomError(
                    dimoStaking,
                    'NoActiveStaking'
                )
            })
            it('Should revert if caller is not the staker or vehicle ID owner', async () => {
                const { dimoStaking, user1, user2 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1)

                await expect(dimoStaking.connect(user2).detachVehicle(1))
                    .to.be.revertedWithCustomError(dimoStaking, 'Unauthorized')
                    .withArgs(user2.address, 1)
            })
            it('Should revert if vehicle ID has been burned', async () => {
                const { dimoStaking, mockVehicleId, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1)

                await mockVehicleId.burn(1)

                await expect(dimoStaking.connect(user1).detachVehicle(1))
                    .to.be.revertedWithCustomError(dimoStaking, 'InvalidVehicleId')
                    .withArgs(1)
            })
        })

        context('State', () => {
            context('Staker is the caller', () => {
                it('Should detach a Vehicle ID', async () => {
                    const { dimoStaking, user1 } = await loadFixture(setup)

                    await dimoStaking.connect(user1).stake(1, 1)
                    const stakingDataBefore = await dimoStaking.stakeIdToStakingData(1)
                    const stakeIdByVehicleIdBefore = await dimoStaking.vehicleIdToStakeId(1)

                    expect(stakingDataBefore.vehicleId).to.equal(1)
                    expect(stakeIdByVehicleIdBefore).to.equal(1)

                    await dimoStaking.connect(user1).detachVehicle(1)

                    const stakingDataAfter = await dimoStaking.stakeIdToStakingData(1)
                    const stakeIdByVehicleIdAfter = await dimoStaking.vehicleIdToStakeId(1)
                    expect(stakingDataAfter.vehicleId).to.equal(0)
                    expect(stakeIdByVehicleIdAfter).to.equal(0)
                })
            })

            context('Vehicle ID ower is the caller', () => {
                it('Should detach a Vehicle ID', async () => {
                    const { dimoStaking, user1, user2 } = await loadFixture(setup)

                    await dimoStaking.connect(user1).stake(1, 2) // Vehicle ID 2 belongs to user2
                    const stakingDataBefore = await dimoStaking.stakeIdToStakingData(1)
                    const stakeIdByVehicleIdBefore = await dimoStaking.vehicleIdToStakeId(2)

                    expect(stakingDataBefore.vehicleId).to.equal(2)
                    expect(stakeIdByVehicleIdBefore).to.equal(1)

                    await dimoStaking.connect(user2).detachVehicle(2)

                    const stakingDataAfter = await dimoStaking.stakeIdToStakingData(1)
                    const stakeIdByVehicleIdAfter = await dimoStaking.vehicleIdToStakeId(1)
                    expect(stakingDataAfter.vehicleId).to.equal(0)
                    expect(stakeIdByVehicleIdAfter).to.equal(0)
                })
            })
        })

        context('Events', () => {
            context('Staker is the caller', () => {
                it('Should emit VehicleDetached event with correct params', async () => {
                    const { dimoStaking, user1 } = await loadFixture(setup)

                    await dimoStaking.connect(user1).stake(1, 1)

                    await expect(dimoStaking.connect(user1).detachVehicle(1))
                        .to.emit(dimoStaking, 'VehicleDetached')
                        .withArgs(user1.address, 1, 1)
                })
            })

            context('Vehicle ID ower is the caller', () => {
                it('Should emit VehicleDetached event with correct params', async () => {
                    const { dimoStaking, user1, user2 } = await loadFixture(setup)

                    await dimoStaking.connect(user1).stake(1, 2) // Vehicle ID 2 belongs to user2

                    await expect(dimoStaking.connect(user2).detachVehicle(2))
                        .to.emit(dimoStaking, 'VehicleDetached')
                        .withArgs(user2.address, 1, 2)
                })
            })
        })
    })

    describe('delegate', () => {
        context('Errors', () => {
            it('Should revert if caller does not have a Staking Beacon', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await expect(dimoStaking.connect(user1).delegate(user1.address)).to.be.revertedWithCustomError(
                    dimoStaking,
                    'NoActiveStaking'
                )
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

        context('On withdraw', () => {
            it('Should lose voting power if staker withdraws', async () => {
                const { dimoStaking, mockDimoToken, user1, user2 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1)
                await dimoStaking.connect(user1).delegate(user2.address)

                expect(await mockDimoToken.getVotes(user2.address)).to.equal(C.stakingLevels[1].amount)

                await time.increase(C.stakingLevels[1].lockPeriod + 99n)

                await dimoStaking.connect(user1)['withdraw(uint256)'](1)

                expect(await mockDimoToken.getVotes(user2.address)).to.equal(0)
            })
        })
    })

    describe('getBaselinePoints', () => {
        it('Should return 0 if Vehicle is not attached to any Stake', async () => {
            const { dimoStaking } = await loadFixture(setup)

            expect(await dimoStaking.getBaselinePoints(1)).to.equal(0)
        })
        it('Should return 0 if Vehicle has been burned', async () => {
            const { dimoStaking, mockVehicleId, user1 } = await loadFixture(setup)

            await dimoStaking.connect(user1).stake(1, 1)

            expect(await dimoStaking.getBaselinePoints(1)).to.equal(C.stakingLevels[1].points)

            await mockVehicleId.burn(1)

            expect(await dimoStaking.getBaselinePoints(1)).to.equal(0)
        })
        it('Should return 0 if Stake is expired', async () => {
            const { dimoStaking, user1 } = await loadFixture(setup)

            await dimoStaking.connect(user1).stake(1, 1)

            await time.increase(C.stakingLevels[1].lockPeriod + 99n)

            expect(await dimoStaking.getBaselinePoints(1)).to.equal(0)
        })
        it('Should return correct amount of points for an active Stake', async () => {
            const { dimoStaking, user1 } = await loadFixture(setup)

            await dimoStaking.connect(user1).stake(1, 1)

            expect(await dimoStaking.getBaselinePoints(1)).to.equal(C.stakingLevels[1].points)
        })
    })

    context('On transfer', () => {
        context('State', () => {
            context('When recipient already has a Staking Beacon', () => {
                context('transferFrom', () => {
                    it('Should transfer map the Stake ID to the Staking Beacon address of the new user', async () => {
                        const { dimoStaking, user1, user2 } = await loadFixture(setup)

                        const receipt1 = await (await dimoStaking.connect(user1).stake(1, 1)).wait()
                        const eventArgs1 = (receipt1?.logs[3] as EventLog).args
                        const stakingBeaconAddress1 = eventArgs1[2]
                        const receipt2 = await (await dimoStaking.connect(user2).stake(1, 2)).wait()
                        const eventArgs2 = (receipt2?.logs[3] as EventLog).args
                        const stakingBeaconAddress2 = eventArgs2[2]

                        const stakingBeaconAddressBefore = await dimoStaking.stakeIdToStake(1)
                        expect(stakingBeaconAddressBefore).to.equal(stakingBeaconAddress1)

                        await dimoStaking.connect(user1).transferFrom(user1.address, user2.address, 1)

                        const stakingBeaconAddressAfter = await dimoStaking.stakeIdToStake(1)
                        expect(stakingBeaconAddressAfter).to.equal(stakingBeaconAddress2)
                    })
                    it('Should transfer the amount of tokens to the new user', async () => {
                        const { dimoStaking, mockDimoToken, user1, user2 } = await loadFixture(setup)

                        await dimoStaking.connect(user1).stake(1, 1)
                        await dimoStaking.connect(user2).stake(1, 2)

                        const stakingBeaconAddress1 = await dimoStaking.stakerToStake(user1.address)
                        const stakingBeaconAddress2 = await dimoStaking.stakerToStake(user2.address)

                        expect(await mockDimoToken.balanceOf(stakingBeaconAddress1)).to.equal(C.stakingLevels[1].amount)
                        expect(await mockDimoToken.balanceOf(stakingBeaconAddress2)).to.equal(C.stakingLevels[1].amount)

                        await dimoStaking.connect(user1).transferFrom(user1.address, user2.address, 1)

                        expect(await mockDimoToken.balanceOf(stakingBeaconAddress1)).to.equal(0)
                        expect(await mockDimoToken.balanceOf(stakingBeaconAddress2)).to.equal(
                            C.stakingLevels[1].amount * 2n
                        )
                    })
                })

                context('safeTransferFrom', () => {
                    it('Should transfer map the Stake ID to the Staking Beacon address of the new user', async () => {
                        const { dimoStaking, user1, user2 } = await loadFixture(setup)

                        const receipt1 = await (await dimoStaking.connect(user1).stake(1, 1)).wait()
                        const eventArgs1 = (receipt1?.logs[3] as EventLog).args
                        const stakingBeaconAddress1 = eventArgs1[2]
                        const receipt2 = await (await dimoStaking.connect(user2).stake(1, 2)).wait()
                        const eventArgs2 = (receipt2?.logs[3] as EventLog).args
                        const stakingBeaconAddress2 = eventArgs2[2]

                        const stakingBeaconAddressBefore = await dimoStaking.stakeIdToStake(1)
                        expect(stakingBeaconAddressBefore).to.equal(stakingBeaconAddress1)

                        await dimoStaking
                            .connect(user1)
                            ['safeTransferFrom(address,address,uint256)'](user1.address, user2.address, 1)

                        const stakingBeaconAddressAfter = await dimoStaking.stakeIdToStake(1)
                        expect(stakingBeaconAddressAfter).to.equal(stakingBeaconAddress2)
                    })
                    it('Should transfer the amount of tokens to the new user', async () => {
                        const { dimoStaking, mockDimoToken, user1, user2 } = await loadFixture(setup)

                        await dimoStaking.connect(user1).stake(1, 1)
                        await dimoStaking.connect(user2).stake(1, 2)

                        const stakingBeaconAddress1 = await dimoStaking.stakerToStake(user1.address)
                        const stakingBeaconAddress2 = await dimoStaking.stakerToStake(user2.address)

                        expect(await mockDimoToken.balanceOf(stakingBeaconAddress1)).to.equal(C.stakingLevels[1].amount)
                        expect(await mockDimoToken.balanceOf(stakingBeaconAddress2)).to.equal(C.stakingLevels[1].amount)

                        await dimoStaking
                            .connect(user1)
                            ['safeTransferFrom(address,address,uint256)'](user1.address, user2.address, 1)

                        expect(await mockDimoToken.balanceOf(stakingBeaconAddress1)).to.equal(0)
                        expect(await mockDimoToken.balanceOf(stakingBeaconAddress2)).to.equal(
                            C.stakingLevels[1].amount * 2n
                        )
                    })
                })
            })

            context('When recipient does not have a Staking Beacon', () => {
                context('transferFrom', () => {
                    it('Should correctly create a new Staking Beacon contract', async () => {
                        const { dimoStaking, user1, user2 } = await loadFixture(setup)

                        await dimoStaking.connect(user1).stake(1, 1)

                        const stakingBeaconAddressBefore = await dimoStaking.stakerToStake(user2.address)
                        expect(stakingBeaconAddressBefore).to.equal(ethers.ZeroAddress)

                        const receipt2 = await (
                            await dimoStaking.connect(user1).transferFrom(user1.address, user2.address, 1)
                        ).wait()
                        const eventArgs2 = (receipt2?.logs[3] as EventLog).args
                        const stakingBeaconAddress2 = eventArgs2[2]

                        const stakingBeaconAddressAfter = await dimoStaking.stakeIdToStake(1)
                        expect(ethers.isAddress(stakingBeaconAddressAfter)).to.be.true
                        expect(stakingBeaconAddressAfter).to.equal(stakingBeaconAddress2)
                        expect(await dimoStaking.stakerToStake(user2.address)).to.equal(stakingBeaconAddressAfter)
                        expect(stakingBeaconAddressAfter).to.not.equal(stakingBeaconAddressBefore)
                    })
                    it('Should transfer map the Stake ID to the Staking Beacon address of the new user', async () => {
                        const { dimoStaking, user1, user2 } = await loadFixture(setup)

                        const receipt1 = await (await dimoStaking.connect(user1).stake(1, 1)).wait()
                        const eventArgs1 = (receipt1?.logs[3] as EventLog).args
                        const stakingBeaconAddress1 = eventArgs1[2]

                        const stakingBeaconAddressBefore = await dimoStaking.stakeIdToStake(1)
                        expect(stakingBeaconAddressBefore).to.equal(stakingBeaconAddress1)

                        const receipt2 = await (
                            await dimoStaking.connect(user1).transferFrom(user1.address, user2.address, 1)
                        ).wait()
                        const eventArgs2 = (receipt2?.logs[3] as EventLog).args
                        const stakingBeaconAddress2 = eventArgs2[2]

                        const stakingBeaconAddressAfter = await dimoStaking.stakeIdToStake(1)
                        expect(stakingBeaconAddressAfter).to.equal(stakingBeaconAddress2)
                    })
                    it('Should transfer the amount of tokens to the new user', async () => {
                        const { dimoStaking, mockDimoToken, user1, user2 } = await loadFixture(setup)

                        await dimoStaking.connect(user1).stake(1, 1)

                        const stakingBeaconAddress1 = await dimoStaking.stakerToStake(user1.address)

                        expect(await mockDimoToken.balanceOf(stakingBeaconAddress1)).to.equal(C.stakingLevels[1].amount)

                        const receipt2 = await (
                            await dimoStaking.connect(user1).transferFrom(user1.address, user2.address, 1)
                        ).wait()
                        const eventArgs2 = (receipt2?.logs[3] as EventLog).args
                        const stakingBeaconAddress2 = eventArgs2[2]

                        expect(await mockDimoToken.balanceOf(stakingBeaconAddress1)).to.equal(0)
                        expect(await mockDimoToken.balanceOf(stakingBeaconAddress2)).to.equal(C.stakingLevels[1].amount)
                    })
                })

                context('safeTransferFrom', () => {
                    it('Should correctly create a new Staking Beacon contract', async () => {
                        const { dimoStaking, user1, user2 } = await loadFixture(setup)

                        await dimoStaking.connect(user1).stake(1, 1)

                        const stakingBeaconAddressBefore = await dimoStaking.stakerToStake(user2.address)
                        expect(stakingBeaconAddressBefore).to.equal(ethers.ZeroAddress)

                        const receipt2 = await (
                            await dimoStaking
                                .connect(user1)
                                ['safeTransferFrom(address,address,uint256)'](user1.address, user2.address, 1)
                        ).wait()
                        const eventArgs2 = (receipt2?.logs[3] as EventLog).args
                        const stakingBeaconAddress2 = eventArgs2[2]

                        const stakingBeaconAddressAfter = await dimoStaking.stakeIdToStake(1)
                        expect(ethers.isAddress(stakingBeaconAddressAfter)).to.be.true
                        expect(stakingBeaconAddressAfter).to.equal(stakingBeaconAddress2)
                        expect(await dimoStaking.stakerToStake(user2.address)).to.equal(stakingBeaconAddressAfter)
                        expect(stakingBeaconAddressAfter).to.not.equal(stakingBeaconAddressBefore)
                    })
                    it('Should transfer map the Stake ID to the Staking Beacon address of the new user', async () => {
                        const { dimoStaking, user1, user2 } = await loadFixture(setup)

                        const receipt1 = await (await dimoStaking.connect(user1).stake(1, 1)).wait()
                        const eventArgs1 = (receipt1?.logs[3] as EventLog).args
                        const stakingBeaconAddress1 = eventArgs1[2]

                        const stakingBeaconAddressBefore = await dimoStaking.stakeIdToStake(1)
                        expect(stakingBeaconAddressBefore).to.equal(stakingBeaconAddress1)

                        const receipt2 = await (
                            await dimoStaking
                                .connect(user1)
                                ['safeTransferFrom(address,address,uint256)'](user1.address, user2.address, 1)
                        ).wait()
                        const eventArgs2 = (receipt2?.logs[3] as EventLog).args
                        const stakingBeaconAddress2 = eventArgs2[2]

                        const stakingBeaconAddressAfter = await dimoStaking.stakeIdToStake(1)
                        expect(stakingBeaconAddressAfter).to.equal(stakingBeaconAddress2)
                    })
                    it('Should transfer the amount of tokens to the new user', async () => {
                        const { dimoStaking, mockDimoToken, user1, user2 } = await loadFixture(setup)

                        await dimoStaking.connect(user1).stake(1, 1)

                        const stakingBeaconAddress1 = await dimoStaking.stakerToStake(user1.address)

                        expect(await mockDimoToken.balanceOf(stakingBeaconAddress1)).to.equal(C.stakingLevels[1].amount)

                        const receipt2 = await (
                            await dimoStaking
                                .connect(user1)
                                ['safeTransferFrom(address,address,uint256)'](user1.address, user2.address, 1)
                        ).wait()
                        const eventArgs2 = (receipt2?.logs[3] as EventLog).args
                        const stakingBeaconAddress2 = eventArgs2[2]

                        expect(await mockDimoToken.balanceOf(stakingBeaconAddress1)).to.equal(0)
                        expect(await mockDimoToken.balanceOf(stakingBeaconAddress2)).to.equal(C.stakingLevels[1].amount)
                    })
                })
            })
        })

        context('Events', () => {
            context('When recipient already has a Staking Beacon', () => {
                context('transferFrom', () => {
                    it('Should emit Withdraw event with correct params', async () => {
                        const { dimoStaking, user1, user2 } = await loadFixture(setup)

                        await dimoStaking.connect(user1).stake(1, 1)
                        await dimoStaking.connect(user2).stake(1, 2)

                        await expect(dimoStaking.connect(user1).transferFrom(user1.address, user2.address, 1))
                            .to.emit(dimoStaking, 'Withdrawn')
                            .withArgs(user1.address, 1, C.stakingLevels[1].amount, C.stakingLevels[1].points)
                    })
                    it('Should emit Staked event with correct params', async () => {
                        const { dimoStaking, user1, user2 } = await loadFixture(setup)

                        await dimoStaking.connect(user1).stake(1, 1)
                        await dimoStaking.connect(user2).stake(1, 2)

                        const lockEndTime = (await dimoStaking.stakeIdToStakingData(1)).lockEndTime

                        const receipt = await (
                            await dimoStaking.connect(user1).transferFrom(user1.address, user2.address, 1)
                        ).wait()
                        const event = receipt?.logs[3] as EventLog
                        const args = event.args

                        expect(event.fragment.name).to.equal('Staked')
                        expect(args[0]).to.equal(user2.address) // user
                        expect(args[1]).to.equal(1) // stakeId
                        expect(args[2]).to.not.equal(ethers.ZeroAddress) // stakingBeacon
                        expect(ethers.isAddress(args[2])).to.be.true // stakingBeacon
                        expect(args[3]).to.equal(1) // level
                        expect(args[4]).to.equal(C.stakingLevels[1].amount) // amount
                        expect(args[5]).to.equal(lockEndTime) // lockEndTime
                        expect(args[6]).to.equal(C.stakingLevels[1].points) // points
                    })
                })

                context('safeTransferFrom', () => {
                    it('Should emit Withdraw event with correct params', async () => {
                        const { dimoStaking, user1, user2 } = await loadFixture(setup)

                        await dimoStaking.connect(user1).stake(1, 1)
                        await dimoStaking.connect(user2).stake(1, 2)

                        await expect(
                            dimoStaking
                                .connect(user1)
                                ['safeTransferFrom(address,address,uint256)'](user1.address, user2.address, 1)
                        )
                            .to.emit(dimoStaking, 'Withdrawn')
                            .withArgs(user1.address, 1, C.stakingLevels[1].amount, C.stakingLevels[1].points)
                    })
                    it('Should emit Staked event with correct params', async () => {
                        const { dimoStaking, user1, user2 } = await loadFixture(setup)

                        await dimoStaking.connect(user1).stake(1, 1)
                        await dimoStaking.connect(user2).stake(1, 2)

                        const lockEndTime = (await dimoStaking.stakeIdToStakingData(1)).lockEndTime

                        const receipt = await (
                            await dimoStaking
                                .connect(user1)
                                ['safeTransferFrom(address,address,uint256)'](user1.address, user2.address, 1)
                        ).wait()
                        const event = receipt?.logs[3] as EventLog
                        const args = event.args

                        expect(event.fragment.name).to.equal('Staked')
                        expect(args[0]).to.equal(user2.address) // user
                        expect(args[1]).to.equal(1) // stakeId
                        expect(args[2]).to.not.equal(ethers.ZeroAddress) // stakingBeacon
                        expect(ethers.isAddress(args[2])).to.be.true // stakingBeacon
                        expect(args[3]).to.equal(1) // level
                        expect(args[4]).to.equal(C.stakingLevels[1].amount) // amount
                        expect(args[5]).to.equal(lockEndTime) // lockEndTime
                        expect(args[6]).to.equal(C.stakingLevels[1].points) // points
                    })
                })
            })

            context('When recipient does not have a Staking Beacon', () => {
                context('transferFrom', () => {
                    it('Should emit Withdraw event with correct params', async () => {
                        const { dimoStaking, user1, user2 } = await loadFixture(setup)

                        await dimoStaking.connect(user1).stake(1, 1)

                        await expect(dimoStaking.connect(user1).transferFrom(user1.address, user2.address, 1))
                            .to.emit(dimoStaking, 'Withdrawn')
                            .withArgs(user1.address, 1, C.stakingLevels[1].amount, C.stakingLevels[1].points)
                    })
                    it('Should emit Staked event with correct params', async () => {
                        const { dimoStaking, user1, user2 } = await loadFixture(setup)

                        await dimoStaking.connect(user1).stake(1, 1)

                        const lockEndTime = (await dimoStaking.stakeIdToStakingData(1)).lockEndTime

                        const receipt = await (
                            await dimoStaking.connect(user1).transferFrom(user1.address, user2.address, 1)
                        ).wait()
                        const event = receipt?.logs[3] as EventLog
                        const args = event.args

                        expect(event.fragment.name).to.equal('Staked')
                        expect(args[0]).to.equal(user2.address) // user
                        expect(args[1]).to.equal(1) // stakeId
                        expect(args[2]).to.not.equal(ethers.ZeroAddress) // stakingBeacon
                        expect(ethers.isAddress(args[2])).to.be.true // stakingBeacon
                        expect(args[3]).to.equal(1) // level
                        expect(args[4]).to.equal(C.stakingLevels[1].amount) // amount
                        expect(args[5]).to.equal(lockEndTime) // lockEndTime
                        expect(args[6]).to.equal(C.stakingLevels[1].points) // points
                    })
                })

                context('safeTransferFrom', () => {
                    it('Should emit Withdraw event with correct params', async () => {
                        const { dimoStaking, user1, user2 } = await loadFixture(setup)

                        await dimoStaking.connect(user1).stake(1, 1)

                        await expect(
                            dimoStaking
                                .connect(user1)
                                ['safeTransferFrom(address,address,uint256)'](user1.address, user2.address, 1)
                        )
                            .to.emit(dimoStaking, 'Withdrawn')
                            .withArgs(user1.address, 1, C.stakingLevels[1].amount, C.stakingLevels[1].points)
                    })
                    it('Should emit Staked event with correct params', async () => {
                        const { dimoStaking, user1, user2 } = await loadFixture(setup)

                        await dimoStaking.connect(user1).stake(1, 1)

                        const lockEndTime = (await dimoStaking.stakeIdToStakingData(1)).lockEndTime

                        const receipt = await (
                            await dimoStaking
                                .connect(user1)
                                ['safeTransferFrom(address,address,uint256)'](user1.address, user2.address, 1)
                        ).wait()
                        const event = receipt?.logs[3] as EventLog
                        const args = event.args

                        expect(event.fragment.name).to.equal('Staked')
                        expect(args[0]).to.equal(user2.address) // user
                        expect(args[1]).to.equal(1) // stakeId
                        expect(args[2]).to.not.equal(ethers.ZeroAddress) // stakingBeacon
                        expect(ethers.isAddress(args[2])).to.be.true // stakingBeacon
                        expect(args[3]).to.equal(1) // level
                        expect(args[4]).to.equal(C.stakingLevels[1].amount) // amount
                        expect(args[5]).to.equal(lockEndTime) // lockEndTime
                        expect(args[6]).to.equal(C.stakingLevels[1].points) // points
                    })
                })
            })
        })
    })
})
