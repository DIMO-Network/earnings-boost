export type Boost = {
    level: bigint
    amount: bigint
    lockEndTime: bigint
    attachedVehicleId: bigint
}

export type BoostLevel = {
    amount: bigint
    lockPeriod: bigint
    points: bigint
}
