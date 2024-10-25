export type StakingData = {
    level: bigint
    amount: bigint
    lockEndTime: bigint
    attachedVehicleId: bigint
}

export type StakingLevel = {
    amount: bigint
    lockPeriod: bigint
    points: bigint
}
