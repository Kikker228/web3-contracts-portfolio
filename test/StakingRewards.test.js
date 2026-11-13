const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("StakingRewards", () => {
  const DURATION = 7n * 86400n;
  const REWARD = ethers.parseEther("7000"); // 1000 / day
  let owner, alice, bob, stake, reward, staking;

  beforeEach(async () => {
    [owner, alice, bob] = await ethers.getSigners();
    const T = await ethers.getContractFactory("PortfolioToken");
    stake = await T.deploy("Stake", "STK", ethers.parseEther("1000000"), ethers.parseEther("100000"), owner.address);
    reward = await T.deploy("Reward", "RWD", ethers.parseEther("1000000"), ethers.parseEther("100000"), owner.address);
    const S = await ethers.getContractFactory("StakingRewards");
    staking = await S.deploy(await stake.getAddress(), await reward.getAddress(), DURATION, owner.address);
    for (const u of [alice, bob]) {
      await stake.transfer(u.address, ethers.parseEther("1000"));
      await stake.connect(u).approve(await staking.getAddress(), ethers.MaxUint256);
    }
  });

  const fund = async (amount = REWARD) => {
    await reward.transfer(await staking.getAddress(), amount);
    await staking.notifyRewardAmount(amount);
  };

  it("pays a single staker the whole reward over the period", async () => {
    await fund();
    await staking.connect(alice).stake(ethers.parseEther("100"));
    await time.increase(DURATION + 1n);
    expect(await staking.earned(alice.address)).to.be.closeTo(REWARD, ethers.parseEther("0.5"));
    await staking.connect(alice).exit();
    expect(await stake.balanceOf(alice.address)).to.equal(ethers.parseEther("1000"));
    expect(await reward.balanceOf(alice.address)).to.be.closeTo(REWARD, ethers.parseEther("0.5"));
  });

  it("splits rewards proportionally between stakers", async () => {
    await fund();
    await staking.connect(alice).stake(ethers.parseEther("100"));
    await staking.connect(bob).stake(ethers.parseEther("300"));
    await time.increase(DURATION + 1n);
    const a = await staking.earned(alice.address);
    const b = await staking.earned(bob.address);
    expect(b).to.be.closeTo(a * 3n, ethers.parseEther("1"));
    expect(a + b).to.be.closeTo(REWARD, ethers.parseEther("1"));
  });

  it("stops accruing after the period ends", async () => {
    await fund();
    await staking.connect(alice).stake(ethers.parseEther("100"));
    await time.increase(DURATION + 1n);
    const e1 = await staking.earned(alice.address);
    await time.increase(10n * 86400n);
    expect(await staking.earned(alice.address)).to.equal(e1);
  });

  it("rejects zero stake/withdraw and over-withdraw", async () => {
    await expect(staking.connect(alice).stake(0)).to.be.revertedWithCustomError(staking, "ZeroAmount");
    await expect(staking.connect(alice).withdraw(0)).to.be.revertedWithCustomError(staking, "ZeroAmount");
    await staking.connect(alice).stake(10n);
    await expect(staking.connect(alice).withdraw(11n)).to.be.revertedWithCustomError(staking, "InsufficientStake");
  });

  it("refuses to promise more rewards than the contract holds", async () => {
    await reward.transfer(await staking.getAddress(), REWARD / 2n);
    await expect(staking.notifyRewardAmount(REWARD)).to.be.revertedWithCustomError(staking, "RewardTooHigh");
  });

  it("only the owner can fund; duration changes only between periods", async () => {
    await expect(staking.connect(alice).notifyRewardAmount(1n)).to.be.revertedWithCustomError(staking, "OwnableUnauthorizedAccount");
    await fund();
    await expect(staking.setRewardsDuration(1n)).to.be.revertedWithCustomError(staking, "PeriodNotFinished");
    await time.increase(DURATION + 1n);
    await staking.setRewardsDuration(86400n);
    expect(await staking.rewardsDuration()).to.equal(86400n);
  });

  it("rolls leftover rewards into a new period", async () => {
    await fund();
    await time.increase(DURATION / 2n);
    await fund(REWARD);
    const total = await staking.getRewardForDuration();
    expect(total).to.be.closeTo(REWARD + REWARD / 2n, ethers.parseEther("1"));
  });

  it("works when staking and rewards token are the same token", async () => {
    const S = await ethers.getContractFactory("StakingRewards");
    const same = await S.deploy(await stake.getAddress(), await stake.getAddress(), DURATION, owner.address);
    await stake.connect(alice).approve(await same.getAddress(), ethers.MaxUint256);
    await same.connect(alice).stake(ethers.parseEther("500"));
    // reward larger than free balance must fail because staked principal is excluded
    await stake.transfer(await same.getAddress(), ethers.parseEther("700"));
    await expect(same.notifyRewardAmount(ethers.parseEther("1000"))).to.be.revertedWithCustomError(same, "RewardTooHigh");
    await same.notifyRewardAmount(ethers.parseEther("700"));
    await time.increase(DURATION + 1n);
    await same.connect(alice).exit();
    expect(await stake.balanceOf(alice.address)).to.be.closeTo(ethers.parseEther("1700"), ethers.parseEther("1"));
  });

  it("late joiner does not receive rewards from before they staked", async () => {
    await fund();
    await staking.connect(alice).stake(ethers.parseEther("100"));
    await time.increase(DURATION / 2n);
    await staking.connect(bob).stake(ethers.parseEther("100"));
    await time.increase(DURATION);
    const a = await staking.earned(alice.address);
    const b = await staking.earned(bob.address);
    expect(a).to.be.closeTo((REWARD * 3n) / 4n, ethers.parseEther("1"));
    expect(b).to.be.closeTo(REWARD / 4n, ethers.parseEther("1"));
  });
});
