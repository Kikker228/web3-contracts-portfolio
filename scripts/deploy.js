// Usage: npx hardhat run scripts/deploy.js --network <network>
// Deploys token, vesting and staking with the first signer as owner.
const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const Token = await ethers.getContractFactory("PortfolioToken");
  const token = await Token.deploy("Portfolio", "PFT", ethers.parseEther("1000000"), ethers.parseEther("100000"), deployer.address);
  await token.waitForDeployment();
  console.log("PortfolioToken:", await token.getAddress());

  const Vesting = await ethers.getContractFactory("TokenVesting");
  const vesting = await Vesting.deploy(await token.getAddress(), deployer.address);
  await vesting.waitForDeployment();
  console.log("TokenVesting:", await vesting.getAddress());

  const Staking = await ethers.getContractFactory("StakingRewards");
  const staking = await Staking.deploy(await token.getAddress(), await token.getAddress(), 30n * 86400n, deployer.address);
  await staking.waitForDeployment();
  console.log("StakingRewards:", await staking.getAddress());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
