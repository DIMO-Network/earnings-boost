import { expect } from 'chai'
import hre, { ignition } from 'hardhat'
import { time, loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'

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
                //     const { dimoStaking, user1 } = await loadFixture(setup)
                //     await dimoStaking.connect(user1).stake(1, 1, true)
                //     expect(await dimoStaking.userBoosts(user1.address)).to.equal({
                //         level: level,
                // amount: stakingLevel.amount,
                // lockEndTime: block.timestamp + stakingLevel.lockPeriod,
                // attachedVehicleId: vehicleId,
                // autoRenew: autoRenew
                //     })
            })
        })

        context('Events', () => {
            it('Should emit Staked event with correct params', async () => {
                const { dimoStaking, user1 } = await loadFixture(setup)

                // await expect(
                //     dimoStaking.connect(user1).stake(1, 1, false)
                // ).to.emit(
                //     dimoStaking,
                //     'Staked'
                // ).withArgs(
                //     user1.address,
                //     C.boostLevels[1].amount,
                //     1,
                //     // check last param
                // )
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
})
