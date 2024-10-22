import { ethers } from 'hardhat'

import type { BoostLevel } from './types'

export const boostLevels: BoostLevel[] = [
    {
        amount: ethers.parseEther('5000'),
        lockPeriod: BigInt(180 * 24 * 60 * 60),
        points: 1000n,
    },
    {
        amount: ethers.parseEther('10000'),
        lockPeriod: BigInt(365 * 24 * 60 * 60),
        points: 2000n,
    },
    {
        amount: ethers.parseEther('15000'),
        lockPeriod: BigInt(730 * 24 * 60 * 60),
        points: 3000n,
    },
]
