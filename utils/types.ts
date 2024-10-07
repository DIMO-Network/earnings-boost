export type Boost = {
    level: BigInt
    amount: BigInt
    lockEndTime: BigInt
    attachedVehicleId: BigInt
    autoRenew: boolean
}

export type BoostLevel = {
    amount: BigInt
    lockPeriod: BigInt
    points: BigInt
}
