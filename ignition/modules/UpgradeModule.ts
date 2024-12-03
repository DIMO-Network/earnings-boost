import { buildModule } from '@nomicfoundation/hardhat-ignition/modules'

const UpgradeModule = buildModule('UpgradeModule', (m) => {
    const proxyAddress = m.getParameter('DIMOStakingProxy')
    console.log(proxyAddress)
    const dimoStakingProxy = m.contractAt('DIMOStaking', proxyAddress)

    const implementation = m.contract('DIMOStaking', [], { id: 'DIMOStakingUpgraded' })

    m.call(dimoStakingProxy, 'upgradeToAndCall', [implementation, '0x'])

    return { dimoStakingProxy }
})

export default UpgradeModule
