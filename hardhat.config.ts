import * as dotenv from 'dotenv'

import { HardhatUserConfig } from 'hardhat/config'
import '@nomicfoundation/hardhat-toolbox'
import 'hardhat-abi-exporter'

dotenv.config()

const config: HardhatUserConfig = {
    solidity: {
        compilers: [
            {
                version: '0.8.10',
            },
            {
                version: '0.8.27',
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 200,
                    },
                },
            },
        ],
    },
    networks: {
        polygon: {
            url: process.env.POLYGON_URL || '',
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
        },
        amoy: {
            url: process.env.AMOY_URL || '',
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
        },
    },
    etherscan: {
        apiKey: {
            polygon: process.env.POLYGONSCAN_API_KEY || '',
            polygonAmoy: process.env.POLYGONSCAN_API_KEY || '',
        },
        customChains: [
            {
                network: 'polygonAmoy',
                chainId: 80002,
                urls: {
                    apiURL: 'https://api-amoy.polygonscan.com/api',
                    browserURL: 'https://amoy.polygonscan.com/',
                },
            },
        ],
    },
    ignition: {
        strategyConfig: {
            create2: {
                salt: '0x0000000000000000000000000000000000000000000000000000000000000000',
            },
        },
    },
    abiExporter: {
        path: './abis',
        runOnCompile: true,
        only: [':DIMOStaking$', ':DIMOStakingDev$', ':StakingBeacon$'],
        format: 'json',
    },
}

export default config
