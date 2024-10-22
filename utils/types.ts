export type Boost = {
    level: bigint
    amount: bigint
    lockEndTime: bigint
    attachedVehicleId: bigint
    autoRenew: boolean
}

export type BoostLevel = {
    amount: bigint
    lockPeriod: bigint
    points: bigint
}
