import { expect } from 'chai'
import { EventLog } from 'ethers'
import { ethers, ignition } from 'hardhat'
import { time, loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'

import * as C from '../utils/constants'
import DIMOStakingDevTestModule from '../ignition/modules/DIMOStakingDevTest'
import type { DIMOStakingDev, MockDimoToken, MockVehicleId } from '../typechain-types'

type StakingModule = {
    dimoStaking: DIMOStakingDev
    mockDimoToken: MockDimoToken
    mockVehicleId: MockVehicleId
}

describe('Staking', function () {
    async function setup() {
        const [deployer, user1, user2] = await ethers.getSigners()
        const amount = ethers.parseEther('1000000')

        const { dimoStaking, mockDimoToken, mockVehicleId } = (await ignition.deploy(DIMOStakingDevTestModule, {
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

        const { dimoStaking, mockDimoToken, mockVehicleId } = (await ignition.deploy(DIMOStakingDevTestModule, {
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

    describe('setExpiration', () => {
        it('Should revert if stake ID does not exist', async () => {
            const { dimoStaking, user1 } = await loadFixture(setup)

            await expect(dimoStaking.connect(user1).setExpiration(1, 99))
                .to.be.revertedWithCustomError(dimoStaking, 'ERC721NonexistentToken')
                .withArgs(1)
        })
        it('Should revert if caller does not have a Staking Beacon', async () => {
            const { dimoStaking, user1, user2 } = await loadFixture(setup)

            await dimoStaking.connect(user1).stake(1, 1)

            await expect(dimoStaking.connect(user2).setExpiration(1, 99))
                .to.be.revertedWithCustomError(dimoStaking, 'InvalidStakeId')
                .withArgs(1)
        })
        it('Should set new expiration', async () => {
            const { dimoStaking, user1 } = await loadFixture(setup)

            await dimoStaking.connect(user1).stake(1, 1)

            const boostStructBefore = await dimoStaking.stakeIdToStakingData(1)
            const expirationBefore = boostStructBefore[2]

            await dimoStaking.connect(user1).setExpiration(1, 99)

            const boostStructAfter = await dimoStaking.stakeIdToStakingData(1)
            const expirationAfter = boostStructAfter[2]
            expect(expirationAfter).to.equal(99)
            expect(expirationBefore).to.not.equal(expirationAfter)
        })
        it('Should emit Staked event with correct params', async () => {
            const { dimoStaking, user1, user2 } = await loadFixture(setup)

            await dimoStaking.connect(user1).stake(1, 1)

            const receipt = await (await dimoStaking.connect(user1).setExpiration(1, 99)).wait()
            const event = receipt?.logs[0] as EventLog
            const args = event.args

            expect(event.fragment.name).to.equal('Staked')
            expect(args[0]).to.equal(user1.address) // user
            expect(args[1]).to.equal(1) // stakeId
            expect(args[2]).to.not.equal(ethers.ZeroAddress) // stakingBeacon
            expect(ethers.isAddress(args[2])).to.be.true // stakingBeacon
            expect(args[3]).to.equal(1) // level
            expect(args[4]).to.equal(C.stakingLevels[1].amount) // amount
            expect(args[5]).to.equal(99) // lockEndTime
            expect(args[6]).to.equal(C.stakingLevels[1].points) // points
        })
    })
})
