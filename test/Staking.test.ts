import { expect } from 'chai'
import { EventLog } from 'ethers'
import hre, { ignition } from 'hardhat'
import { time, loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'

import * as C from '../utils/constants'
import DIMOStakingTestModule from '../ignition/modules/DIMOStakingTest'
import type { DIMOStaking, MockERC20, MockERC721 } from '../typechain-types'

type StakingModule = {
    dimoStaking: DIMOStaking
    mockDimoToken: MockERC20
    mockVehicleId: MockERC721
}

describe('Staking', function () {
    async function setup() {
        const [deployer, user1, user2] = await hre.ethers.getSigners()
        const amount = hre.ethers.parseEther('1000000')

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

            expect(await dimoStaking.boostLevels(0)).to.eql(Object.values(C.boostLevels[0]))
            expect(await dimoStaking.boostLevels(1)).to.eql(Object.values(C.boostLevels[1]))
            expect(await dimoStaking.boostLevels(2)).to.eql(Object.values(C.boostLevels[2]))
        })
    })

    describe('stake', () => {
        context('Errors', () => {
            it('Should revert if level is invalid', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await expect(dimoStaking.connect(user1).stake(99, 1, false))
                    .to.be.revertedWithCustomError(dimoStaking, 'InvalidBoostLevel')
                    .withArgs(99)
            })
            it('Should revert if user already has a boost', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1, false)

                await expect(dimoStaking.connect(user1).stake(1, 1, false))
                    .to.be.revertedWithCustomError(dimoStaking, 'UserAlreadyHasBoost')
                    .withArgs(user1.address)
            })
            it('Should revert if staking contract does not have enough allowance', async () => {
                const { dimoStaking, user1, mockDimoToken } = await loadFixture(setup)

                await mockDimoToken.connect(user1).approve(await dimoStaking.getAddress(), 0)

                await expect(dimoStaking.connect(user1).stake(1, 2, false))
                    .to.be.revertedWithCustomError(mockDimoToken, 'ERC20InsufficientAllowance')
                    .withArgs(await dimoStaking.getAddress(), 0, C.boostLevels[1].amount)
            })
            it('Should revert if caller is not the vehicle ID owner', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await expect(dimoStaking.connect(user1).stake(1, 2, false))
                    .to.be.revertedWithCustomError(dimoStaking, 'Unauthorized')
                    .withArgs(user1.address)
            })
            it('Should revert if vehicle ID does not exist', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await expect(dimoStaking.connect(user1).stake(1, 99, false))
                    .to.be.revertedWithCustomError(dimoStaking, 'InvalidVehicleId')
                    .withArgs(99)
            })
        })

        context('State', () => {
            it('Should transfer correct amount of tokens to the Staking contract', async () => {
                const { dimoStaking, user1, mockDimoToken } = await loadFixture(setup)

                const amount = C.boostLevels[1].amount

                await expect(dimoStaking.connect(user1).stake(1, 1, false)).to.changeTokenBalances(
                    mockDimoToken,
                    [user1, dimoStaking],
                    [-amount, amount]
                )
            })
            it('Should correctly set Boost struct', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1, true)

                const lockEndTime = BigInt(await time.latest()) + C.boostLevels[1].lockPeriod
                const boostStruct = await dimoStaking.userBoosts(user1.address)

                expect(boostStruct.level).to.equal(1)
                expect(boostStruct.amount).to.equal(C.boostLevels[1].amount)
                expect(boostStruct.lockEndTime).to.equal(lockEndTime)
                expect(boostStruct.attachedVehicleId).to.equal(1)
                expect(boostStruct.autoRenew).to.be.true
            })
        })

        context('Events', () => {
            it('Should emit Staked event with correct params', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                const receipt = await (await dimoStaking.connect(user1).stake(1, 1, false)).wait()
                const eventArgs = (receipt?.logs[1] as EventLog).args
                const lockEndTime = BigInt(await time.latest()) + C.boostLevels[1].lockPeriod

                expect(eventArgs[0]).to.equal(user1.address)
                expect(eventArgs[1]).to.equal(C.boostLevels[1].amount)
                expect(eventArgs[2]).to.equal(1)
                expect(eventArgs[3]).to.equal(lockEndTime)
            })
            it('Should emit BoostAttached with correct params if Vehicle ID is set', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await expect(dimoStaking.connect(user1).stake(1, 1, false))
                    .to.emit(dimoStaking, 'BoostAttached')
                    .withArgs(user1.address, 1)
            })
            it('Should not emit BoostAttached if Vehicle ID is not set', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await expect(dimoStaking.connect(user1).stake(1, 0, false)).to.not.emit(dimoStaking, 'BoostAttached')
            })
        })
    })

    describe('upgradeStake', () => {
        context('Errors', () => {
            it('Should revert if caller does not have an active boost', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await expect(dimoStaking.connect(user1).upgradeStake(1, 1, false)).to.be.revertedWithCustomError(
                    dimoStaking,
                    'NoActiveBoost'
                )
            })
            it('Should revert if level is invalid', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1, false)

                await expect(dimoStaking.connect(user1).upgradeStake(99, 1, false))
                    .to.be.revertedWithCustomError(dimoStaking, 'InvalidBoostLevel')
                    .withArgs(99)
            })
            it('Should revert if staking contract does not have enough allowance', async () => {
                const { dimoStaking, user1, mockDimoToken } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1, false)

                await mockDimoToken.connect(user1).approve(await dimoStaking.getAddress(), 0)

                await expect(dimoStaking.connect(user1).upgradeStake(2, 1, false))
                    .to.be.revertedWithCustomError(mockDimoToken, 'ERC20InsufficientAllowance')
                    .withArgs(await dimoStaking.getAddress(), 0, C.boostLevels[2].amount - C.boostLevels[1].amount)
            })
            it('Should revert if caller is not the vehicle ID owner', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1, false)

                await expect(dimoStaking.connect(user1).upgradeStake(2, 2, false))
                    .to.be.revertedWithCustomError(dimoStaking, 'Unauthorized')
                    .withArgs(user1.address)
            })
            it('Should revert if vehicle ID does not exist', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1, false)

                await expect(dimoStaking.connect(user1).upgradeStake(2, 99, false))
                    .to.be.revertedWithCustomError(dimoStaking, 'InvalidVehicleId')
                    .withArgs(99)
            })
        })

        context('State', () => {
            it('Should transfer correct amount of tokens to the Staking contract', async () => {
                const { dimoStaking, user1, mockDimoToken } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1, false)

                const amount = C.boostLevels[2].amount - C.boostLevels[1].amount

                await expect(dimoStaking.connect(user1).upgradeStake(2, 1, false)).to.changeTokenBalances(
                    mockDimoToken,
                    [user1, dimoStaking],
                    [-amount, amount]
                )
            })
            it('Should correctly set Boost struct', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1, true)

                const lockEndTimeBefore = BigInt(await time.latest()) + C.boostLevels[1].lockPeriod
                const boostStructBefore = await dimoStaking.userBoosts(user1.address)

                expect(boostStructBefore.level).to.equal(1)
                expect(boostStructBefore.amount).to.equal(C.boostLevels[1].amount)
                expect(boostStructBefore.lockEndTime).to.equal(lockEndTimeBefore)
                expect(boostStructBefore.attachedVehicleId).to.equal(1)
                expect(boostStructBefore.autoRenew).to.be.true

                await dimoStaking.connect(user1).upgradeStake(2, 1, true)

                const lockEndTimeAfter = BigInt(await time.latest()) + C.boostLevels[2].lockPeriod
                const boostStructAfter = await dimoStaking.userBoosts(user1.address)

                expect(boostStructAfter.level).to.equal(2)
                expect(boostStructAfter.amount).to.equal(C.boostLevels[2].amount)
                expect(boostStructAfter.lockEndTime).to.equal(lockEndTimeAfter)
                expect(boostStructAfter.attachedVehicleId).to.equal(1)
                expect(boostStructAfter.autoRenew).to.be.true
            })
        })

        context('Events', () => {
            it('Should emit Staked event with correct params', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1, true)

                const receipt = await (await dimoStaking.connect(user1).upgradeStake(2, 1, false)).wait()
                const eventArgs = (receipt?.logs[1] as EventLog).args
                const lockEndTime = BigInt(await time.latest()) + C.boostLevels[2].lockPeriod

                expect(eventArgs[0]).to.equal(user1.address)
                expect(eventArgs[1]).to.equal(C.boostLevels[2].amount)
                expect(eventArgs[2]).to.equal(2)
                expect(eventArgs[3]).to.equal(lockEndTime)
            })
            it('Should emit BoostAttached event with correct params if Vehicle ID is set', async () => {
                const { dimoStaking, mockVehicleId, user1 } = await loadFixture(setup)

                // Mint another vehicle for user1 with ID 3
                await mockVehicleId.mint(user1.address)

                await dimoStaking.connect(user1).stake(1, 1, true)

                await expect(dimoStaking.connect(user1).upgradeStake(2, 3, false))
                    .to.emit(dimoStaking, 'BoostAttached')
                    .withArgs(user1.address, 3)
            })
            it('Should emit BoostDetached with correct params if Vehicle ID is set to 0', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1, true)

                await expect(dimoStaking.connect(user1).upgradeStake(2, 0, false))
                    .to.emit(dimoStaking, 'BoostDetached')
                    .withArgs(user1.address, 0)
            })
            it('Should not emit BoostAttached if Vehicle ID is the same already attached', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1, true)

                await expect(dimoStaking.connect(user1).upgradeStake(2, 1, false)).to.not.emit(
                    dimoStaking,
                    'BoostAttached'
                )
            })
            it('Should not emit BoostAttached if Vehicle ID is set to 0', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1, true)

                await expect(dimoStaking.connect(user1).upgradeStake(2, 0, false)).to.not.emit(
                    dimoStaking,
                    'BoostAttached'
                )
            })
        })
    })

    describe('withdraw', () => {
        context('Errors', () => {
            it('Should revert if caller does not have an active boost', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await expect(dimoStaking.connect(user1).withdraw()).to.be.revertedWithCustomError(
                    dimoStaking,
                    'NoActiveBoost'
                )
            })
            it('Should revert if tokens are still locked', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1, true)

                await expect(dimoStaking.connect(user1).withdraw()).to.be.revertedWithCustomError(
                    dimoStaking,
                    'TokensStillLocked'
                )
            })
            it('Should revert if auto renew is active', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1, true)

                await time.increase(C.boostLevels[1].lockPeriod + 99n)

                await expect(dimoStaking.connect(user1).withdraw()).to.be.revertedWithCustomError(
                    dimoStaking,
                    'AutoRenewActive'
                )
            })
        })

        context('State', () => {
            it('Should wipe caller Boost struct', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1, false)
                await time.increase(C.boostLevels[1].lockPeriod + 99n)

                await dimoStaking.connect(user1).withdraw()

                const boostStructAfter = await dimoStaking.userBoosts(user1.address)
                expect(boostStructAfter).to.eql([0n, 0n, 0n, 0n, false])
            })
            it('Should transfer correct amount of tokens to the caller', async () => {
                const { dimoStaking, user1, mockDimoToken } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1, false)
                await time.increase(C.boostLevels[1].lockPeriod + 99n)

                const amount = C.boostLevels[1].amount

                await expect(dimoStaking.connect(user1).withdraw()).to.changeTokenBalances(
                    mockDimoToken,
                    [user1, dimoStaking],
                    [amount, -amount]
                )
            })
        })

        context('Events', () => {
            it('Should emit Withdraw event with correct params', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1, false)
                await time.increase(C.boostLevels[1].lockPeriod + 99n)

                await expect(dimoStaking.connect(user1).withdraw())
                    .to.emit(dimoStaking, 'Withdrawn')
                    .withArgs(user1.address, C.boostLevels[1].amount)
            })
        })
    })

    describe('extendBoost', () => {
        context('Errors', () => {
            it('Should revert if caller does not have an active boost', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await expect(dimoStaking.connect(user1).extendBoost()).to.be.revertedWithCustomError(
                    dimoStaking,
                    'NoActiveBoost'
                )
            })
        })

        context('State', () => {
            it('Should update lock end time', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1, false)
                const lockEndTimeBefore = BigInt(await time.latest()) + C.boostLevels[1].lockPeriod
                const boostStructBefore = await dimoStaking.userBoosts(user1.address)

                expect(boostStructBefore[2]).to.equal(lockEndTimeBefore)

                await time.increase(99)

                await dimoStaking.connect(user1).extendBoost()
                const lockEndTimeAfter = BigInt(await time.latest()) + C.boostLevels[1].lockPeriod
                const boostStructAfter = await dimoStaking.userBoosts(user1.address)

                expect(boostStructAfter[2]).to.equal(lockEndTimeAfter)
            })
        })

        context('Events', () => {
            it('Should emit BoostExtended event with correct params', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1, false)
                await time.increase(99)

                // +1n because it takes 1 to execute the next transaction
                const newLockEndTime = BigInt(await time.latest()) + C.boostLevels[1].lockPeriod + 1n
                await expect(dimoStaking.connect(user1).extendBoost())
                    .to.emit(dimoStaking, 'BoostExtended')
                    .withArgs(user1.address, newLockEndTime)
            })
        })
    })

    describe('attachVehicle', () => {
        context('Errors', () => {
            it('Should revert if caller does not have an active boost', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await expect(dimoStaking.connect(user1).attachVehicle(1)).to.be.revertedWithCustomError(
                    dimoStaking,
                    'NoActiveBoost'
                )
            })
            it('Should revert if vehicle ID does not exist', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 0, false)

                await expect(dimoStaking.connect(user1).attachVehicle(99))
                    .to.be.revertedWithCustomError(dimoStaking, 'InvalidVehicleId')
                    .withArgs(99)
            })
            it('Should revert if caller is not the vehicle ID owner', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1, false)

                await expect(dimoStaking.connect(user1).attachVehicle(2))
                    .to.be.revertedWithCustomError(dimoStaking, 'Unauthorized')
                    .withArgs(user1.address)
            })
            it('Should revert if boost is already attached to a vehicle ID', async () => {
                const { dimoStaking, mockVehicleId, user1 } = await loadFixture(setup)

                // Mint another vehicle for user1 with ID 3
                await mockVehicleId.mint(user1.address)

                await dimoStaking.connect(user1).stake(1, 1, false)

                await expect(dimoStaking.connect(user1).attachVehicle(3)).to.be.revertedWithCustomError(
                    dimoStaking,
                    'BoostAlreadyAttached'
                )
            })
        })

        context('State', () => {
            it('Should attach a boost to a vehicle ID', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 0, false)
                const boostStructBefore = await dimoStaking.userBoosts(user1.address)
                expect(boostStructBefore[3]).to.equal(0)

                await dimoStaking.connect(user1).attachVehicle(1)

                const boostStructAfter = await dimoStaking.userBoosts(user1.address)
                expect(boostStructAfter[3]).to.equal(1)
            })
        })

        context('Events', () => {
            it('Should emit BoostAttached event with correct params', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 0, false)

                await expect(dimoStaking.connect(user1).attachVehicle(1))
                    .to.emit(dimoStaking, 'BoostAttached')
                    .withArgs(user1.address, 1)
            })
        })
    })

    describe('detachVehicle', () => {
        context('Errors', () => {
            it('Should revert if caller has not vehicle ID attached', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 0, false)

                await expect(dimoStaking.connect(user1).detachVehicle()).to.be.revertedWithCustomError(
                    dimoStaking,
                    'NoVehicleAttached'
                )
            })
        })

        context('State', () => {
            it('Should detach a vehicle ID', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1, false)
                const boostStructBefore = await dimoStaking.userBoosts(user1.address)
                expect(boostStructBefore[3]).to.equal(1)

                await dimoStaking.connect(user1).detachVehicle()

                const boostStructAfter = await dimoStaking.userBoosts(user1.address)
                expect(boostStructAfter[3]).to.equal(0)
            })
        })

        context('Events', () => {
            it('Should emit BoostDetached event with correct params', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                await dimoStaking.connect(user1).stake(1, 1, false)

                await expect(dimoStaking.connect(user1).detachVehicle())
                    .to.emit(dimoStaking, 'BoostDetached')
                    .withArgs(user1.address, 1)
            })
        })
    })
})
