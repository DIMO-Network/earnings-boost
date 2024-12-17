import hre, { ethers, network } from 'hardhat'

async function main() {
    let [deployer, user1] = await ethers.getSigners()

    if (network.name === 'hardhat' || network.name === 'localhost') {
        // 0xCED3c922200559128930180d3f0bfFd4d9f4F123 -> polygon
        // 0x1741eC2915Ab71Fc03492715b5640133dA69420B -> deployer
        // 0x8E58b98d569B0679713273c5105499C249e9bC84 -> amoy

        await network.provider.request({
            method: 'hardhat_impersonateAccount',
            params: ['0x8E58b98d569B0679713273c5105499C249e9bC84'],
        })

        deployer = await ethers.getSigner('0x8E58b98d569B0679713273c5105499C249e9bC84')

        await user1.sendTransaction({
            to: deployer.address,
            value: ethers.parseEther('100'),
        })
    }

    const StakingDevFactory = await hre.ethers.getContractFactory('DIMOStakingDev', deployer)
    const stakingDev = await hre.ethers.getContractAt('DIMOStakingDev', '0xA010a42DE263592E631d3DCDC621ae7BFfCca338')
    const stakingDevImpl = await StakingDevFactory.deploy()

    await stakingDevImpl.waitForDeployment()

    console.log('DIMO Staking Dev deployed to: ', await stakingDevImpl.getAddress())

    await stakingDev.connect(deployer).upgradeToAndCall(await stakingDevImpl.getAddress(), '0x')
}

main().catch(console.error)
