export type StakingData = {
    level: bigint
    amount: bigint
    lockEndTime: bigint
    vehicleId: bigint
}

export type StakingLevel = {
    amount: bigint
    lockPeriod: bigint
    points: bigint
}
