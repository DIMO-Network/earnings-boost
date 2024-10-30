import { expect } from 'chai'
import { ethers, ignition } from 'hardhat'
import { time, loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'

import * as C from '../utils/constants'
import { DIMOStakingTestModule } from '../ignition/modules/DIMOStakingTest'
import type { DIMOStaking, MockDimoToken, MockVehicleId } from '../typechain-types'

type StakingModule = {
    dimoStaking: DIMOStaking
    mockDimoToken: MockDimoToken
    mockVehicleId: MockVehicleId
}

describe('StakingBeacon', function () {
    async function setup() {
        const [deployer, user1, user2, user3] = await ethers.getSigners()
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

        await dimoStaking.connect(user1).stake(1, 1)
        const stakingBeaconAddress = await dimoStaking.stakerToStake(user1.address)
        const stakingBeacon1 = await ethers.getContractAt('StakingBeacon', stakingBeaconAddress)

        return { user1, user2, user3, dimoStaking, stakingBeacon1, mockDimoToken }
    }

    describe('createStakingData', () => {
        context('Errors', () => {
            it('Should revert if caller is not the DIMO Staking contract', async () => {
                const { stakingBeacon1, user1 } = await loadFixture(setup)

                await expect(stakingBeacon1.connect(user1).createStakingData(1, C.mockSakingData))
                    .to.be.revertedWithCustomError(stakingBeacon1, 'Unauthorized')
                    .withArgs(user1.address)
            })
        })
    })

    describe('upgradeStake', () => {
        context('Errors', () => {
            it('Should revert if caller is not the DIMO Staking contract', async () => {
                const { stakingBeacon1, user1 } = await loadFixture(setup)

                await expect(stakingBeacon1.connect(user1).upgradeStake(1, C.mockSakingData))
                    .to.be.revertedWithCustomError(stakingBeacon1, 'Unauthorized')
                    .withArgs(user1.address)
            })
        })
    })

    describe('withdraw', () => {
        context('Errors', () => {
            it('Should revert if caller is not the DIMO Staking contract', async () => {
                const { stakingBeacon1, user1 } = await loadFixture(setup)

                await expect(stakingBeacon1.connect(user1).withdraw(1))
                    .to.be.revertedWithCustomError(stakingBeacon1, 'Unauthorized')
                    .withArgs(user1.address)
            })
        })
    })

    describe('extendStaking', () => {
        context('Errors', () => {
            it('Should revert if caller is not the DIMO Staking contract', async () => {
                const { stakingBeacon1, user1 } = await loadFixture(setup)

                await expect(stakingBeacon1.connect(user1).extendStaking(1, C.stakingLevels[1].lockPeriod + 99n))
                    .to.be.revertedWithCustomError(stakingBeacon1, 'Unauthorized')
                    .withArgs(user1.address)
            })
        })
    })

    describe('attachVehicle', () => {
        context('Errors', () => {
            it('Should revert if caller is not the DIMO Staking contract', async () => {
                const { stakingBeacon1, user1 } = await loadFixture(setup)

                await expect(stakingBeacon1.connect(user1).attachVehicle(1, 1))
                    .to.be.revertedWithCustomError(stakingBeacon1, 'Unauthorized')
                    .withArgs(user1.address)
            })
        })
    })

    describe('detachVehicle', () => {
        context('Errors', () => {
            it('Should revert if caller is not the DIMO Staking contract', async () => {
                const { stakingBeacon1, user1 } = await loadFixture(setup)

                await expect(stakingBeacon1.connect(user1).detachVehicle(1))
                    .to.be.revertedWithCustomError(stakingBeacon1, 'Unauthorized')
                    .withArgs(user1.address)
            })
        })
    })

    describe('delegate', () => {
        context('Errors', () => {
            it('Should revert if caller is not the DIMO Staking contract or the staker', async () => {
                const { stakingBeacon1, user2 } = await loadFixture(setup)

                await expect(stakingBeacon1.connect(user2).delegate(user2.address))
                    .to.be.revertedWithCustomError(stakingBeacon1, 'Unauthorized')
                    .withArgs(user2.address)
            })
        })

        context('State', () => {
            it('Should correctly delegate staked tokens to your own account', async () => {
                const { dimoStaking, mockDimoToken, user2 } = await loadFixture(setup)
                const balanceUser2 = await mockDimoToken.balanceOf(user2.address)

                await mockDimoToken.connect(user2).delegate(user2.address)
                expect(await mockDimoToken.getVotes(user2.address)).to.equal(balanceUser2)

                await dimoStaking.connect(user2).stake(1, 2)
                const stakingBeaconAddress = await dimoStaking.stakerToStake(user2.address)
                const stakingBeacon2 = await ethers.getContractAt('StakingBeacon', stakingBeaconAddress)

                // Should lose the staking level amount in voting power when stake
                expect(await mockDimoToken.getVotes(user2.address)).to.equal(balanceUser2 - C.stakingLevels[1].amount)

                await stakingBeacon2.connect(user2).delegate(user2.address)
                expect(await mockDimoToken.getVotes(user2.address)).to.equal(balanceUser2)
            })
            it('Should correctly delegate staked tokens to another account', async () => {
                const { dimoStaking, mockDimoToken, user2, user3 } = await loadFixture(setup)

                await dimoStaking.connect(user2).stake(1, 2)
                const stakingBeaconAddress = await dimoStaking.stakerToStake(user2.address)
                const stakingBeacon2 = await ethers.getContractAt('StakingBeacon', stakingBeaconAddress)

                expect(await mockDimoToken.getVotes(user3.address)).to.equal(0)

                await stakingBeacon2.connect(user2).delegate(user3.address)

                expect(await mockDimoToken.getVotes(user3.address)).to.equal(C.stakingLevels[1].amount)
            })
        })

        context('On withdraw', () => {
            it('Should lose voting power if staker withdraws', async () => {
                const { dimoStaking, mockDimoToken, user2, user3 } = await loadFixture(setup)

                await dimoStaking.connect(user2).stake(1, 2)
                await dimoStaking.connect(user2).delegate(user3.address)

                expect(await mockDimoToken.getVotes(user3.address)).to.equal(C.stakingLevels[1].amount)

                await time.increase(C.stakingLevels[1].lockPeriod + 99n)

                await dimoStaking.connect(user2)['withdraw(uint256)'](2)

                expect(await mockDimoToken.getVotes(user3.address)).to.equal(0)
            })
        })
    })
})
