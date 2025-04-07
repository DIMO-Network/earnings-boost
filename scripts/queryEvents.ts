import { ethers } from 'hardhat'

async function main() {
    const dimoRegistryInstance = await ethers.getContractAt('DIMOStaking', '0xA010a42DE263592E631d3DCDC621ae7BFfCca338')
    const eventStakedFilter = dimoRegistryInstance.filters.Staked()
    const eventWithdrawnFilter = dimoRegistryInstance.filters.Withdrawn()
    const eventAttachFilter = dimoRegistryInstance.filters.VehicleAttached()
    const eventDetachFilter = dimoRegistryInstance.filters.VehicleDetached()

    let eventPromisses = [eventStakedFilter, eventWithdrawnFilter, eventAttachFilter, eventDetachFilter].map(
        (eventFilter) => dimoRegistryInstance.queryFilter(eventFilter, 19861776, 20161776)
    )
    const events = await Promise.all(eventPromisses)
    const flattenedEvents = events.flat()
    const sortedEvents = flattenedEvents.sort((a, b) => a.blockNumber - b.blockNumber)

    const stakeId = 123n

    for (const event of sortedEvents) {
        if (event.args[1] == stakeId) {
            console.log(event.fragment.name)
            console.log(event.transactionHash)
            console.log(event.args)
            console.log()
        }
    }
}

main()
    .catch((error) => {
        console.error(error)
        process.exitCode = 1
    })
    .finally(() => {
        process.exit()
    })
