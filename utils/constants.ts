import { ethers } from 'hardhat'

import type { StakingLevel, StakingData } from './types'

export const name = 'DIMO Staking'
export const symbol = 'DSTK'

export const stakingLevels: StakingLevel[] = [
    {
        amount: ethers.parseEther('500'),
        lockPeriod: BigInt(180 * 24 * 60 * 60),
        points: 1000n,
    },
    {
        amount: ethers.parseEther('1500'),
        lockPeriod: BigInt(365 * 24 * 60 * 60),
        points: 2000n,
    },
    {
        amount: ethers.parseEther('4000'),
        lockPeriod: BigInt(730 * 24 * 60 * 60),
        points: 3000n,
    },
]

export const mockSakingData: StakingData = {
    level: 1n,
    amount: ethers.parseEther('500'),
    lockEndTime: 3999999999999n,
    vehicleId: 1n,
}
