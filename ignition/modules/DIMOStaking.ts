import { buildModule } from '@nomicfoundation/hardhat-ignition/modules'

const ProxyModule = buildModule('ProxyModule', (m) => {
    // Deploy the implementation contract
    const implementation = m.contract('DIMOStaking')

    // Encode the initialize function call for the contract.
    const initialize = m.encodeFunctionCall(implementation, 'initialize', [])

    // Deploy the ERC1967 Proxy, pointing to the implementation
    const proxy = m.contract('ERC1967Proxy', [implementation, initialize])

    return { proxy }
})

const DIMOStakingModule = buildModule('DIMOStakingModule', (m) => {
    // Get the proxy from the previous module.
    const { proxy } = m.useModule(ProxyModule)

    // Create a contract instance using the deployed proxy's address.
    const dimoStaking = m.contractAt('DIMOStaking', proxy)

    return { dimoStaking, proxy }
})

export default DIMOStakingModule
