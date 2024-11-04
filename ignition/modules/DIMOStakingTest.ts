import { buildModule } from '@nomicfoundation/hardhat-ignition/modules'

const ProxyTestModule = buildModule('ProxyTestModule', (m) => {
    // Deploy the implementation contract
    const implementation = m.contract('DIMOStaking')
    const mockDimoToken = m.contract('MockDimoToken')
    const mockVehicleId = m.contract('MockVehicleId')

    // Encode the initialize function call for the contract.
    const initialize = m.encodeFunctionCall(implementation, 'initialize', [mockDimoToken, mockVehicleId])

    // Deploy the ERC1967 Proxy, pointing to the implementation
    const proxy = m.contract('ERC1967Proxy', [implementation, initialize])

    return { proxy, mockDimoToken, mockVehicleId }
})

const DIMOStakingTestModule = buildModule('DIMOStakingTestModule', (m) => {
    // Get the proxy from the previous module.
    const { proxy, mockDimoToken, mockVehicleId } = m.useModule(ProxyTestModule)

    // Create a contract instance using the deployed proxy's address.
    const dimoStaking = m.contractAt('DIMOStaking', proxy)

    return { dimoStaking, proxy, mockDimoToken, mockVehicleId }
})

export default DIMOStakingTestModule
