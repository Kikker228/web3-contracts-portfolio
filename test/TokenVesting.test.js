const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("TokenVesting", () => {
  const DAY = 86400n;
  const AMOUNT = ethers.parseEther("1000");
  let owner, alice, bob, token, vesting, start;

  beforeEach(async () => {
    [owner, alice, bob] = await ethers.getSigners();
    const T = await ethers.getContractFactory("PortfolioToken");
    token = await T.deploy("Portfolio", "PFT", ethers.parseEther("1000000"), ethers.parseEther("100000"), owner.address);
    const V = await ethers.getContractFactory("TokenVesting");
    vesting = await V.deploy(await token.getAddress(), owner.address);
    await token.transfer(await vesting.getAddress(), ethers.parseEther("10000"));
    start = BigInt(await time.latest()) + 10n;
  });

  const create = (who = alice, revocable = true) =>
    vesting.createSchedule(who.address, start, 30n * DAY, 100n * DAY, AMOUNT, revocable);

  it("creates schedules and tracks them per beneficiary", async () => {
    await create();
    expect(await vesting.scheduleCount()).to.equal(1n);
    expect(await vesting.schedulesOf(alice.address)).to.deep.equal([0n]);
    expect(await vesting.totalAllocated()).to.equal(AMOUNT);
  });

  it("refuses to over-allocate", async () => {
    await vesting.createSchedule(alice.address, start, 0, 10n * DAY, ethers.parseEther("10000"), false);
    await expect(create(bob)).to.be.revertedWithCustomError(vesting, "InsufficientFreeBalance");
  });

  it("validates inputs", async () => {
    await expect(vesting.createSchedule(ethers.ZeroAddress, start, 0, DAY, 1n, false)).to.be.revertedWithCustomError(vesting, "ZeroAddress");
    await expect(vesting.createSchedule(alice.address, start, 0, 0, 1n, false)).to.be.revertedWithCustomError(vesting, "InvalidSchedule");
    await expect(vesting.createSchedule(alice.address, start, 2n * DAY, DAY, 1n, false)).to.be.revertedWithCustomError(vesting, "InvalidSchedule");
    await expect(vesting.createSchedule(alice.address, start, 0, DAY, 0, false)).to.be.revertedWithCustomError(vesting, "InvalidSchedule");
  });

  it("releases nothing before the cliff", async () => {
    await create();
    await time.increaseTo(start + 29n * DAY);
    expect(await vesting.releasable(0)).to.equal(0n);
    await expect(vesting.connect(alice).release(0)).to.be.revertedWithCustomError(vesting, "NothingToRelease");
  });

  it("vests linearly after the cliff", async () => {
    await create();
    await time.increaseTo(start + 50n * DAY);
    await vesting.connect(alice).release(0);
    expect(await token.balanceOf(alice.address)).to.be.closeTo(AMOUNT / 2n, ethers.parseEther("0.01"));
  });

  it("releases everything after the end and cannot be double-claimed", async () => {
    await create();
    await time.increaseTo(start + 101n * DAY);
    await vesting.connect(alice).release(0);
    expect(await token.balanceOf(alice.address)).to.equal(AMOUNT);
    await expect(vesting.connect(alice).release(0)).to.be.revertedWithCustomError(vesting, "NothingToRelease");
    expect(await vesting.totalAllocated()).to.equal(0n);
  });

  it("only the beneficiary can release", async () => {
    await create();
    await time.increaseTo(start + 101n * DAY);
    await expect(vesting.connect(bob).release(0)).to.be.revertedWithCustomError(vesting, "NotBeneficiary");
  });

  it("revoke returns the unvested part and keeps the vested part claimable", async () => {
    await create();
    await time.increaseTo(start + 50n * DAY);
    const before = await token.balanceOf(owner.address);
    await vesting.revoke(0);
    const refunded = (await token.balanceOf(owner.address)) - before;
    expect(refunded).to.be.closeTo(AMOUNT / 2n, ethers.parseEther("0.02"));

    await time.increaseTo(start + 200n * DAY);
    await vesting.connect(alice).release(0);
    expect(await token.balanceOf(alice.address)).to.be.closeTo(AMOUNT / 2n, ethers.parseEther("0.02"));
    expect(await vesting.totalAllocated()).to.equal(0n);
  });

  it("revoke before the cliff refunds everything", async () => {
    await create();
    await vesting.revoke(0);
    expect(await vesting.totalAllocated()).to.equal(0n);
    await time.increaseTo(start + 200n * DAY);
    await expect(vesting.connect(alice).release(0)).to.be.revertedWithCustomError(vesting, "NothingToRelease");
  });

  it("non-revocable schedules cannot be revoked; double revoke fails", async () => {
    await create(alice, false);
    await expect(vesting.revoke(0)).to.be.revertedWithCustomError(vesting, "NotRevocable");
    await create(bob, true);
    await vesting.revoke(1);
    await expect(vesting.revoke(1)).to.be.revertedWithCustomError(vesting, "AlreadyRevoked");
  });

  it("only the owner can create/revoke; unknown ids revert", async () => {
    await expect(
      vesting.connect(alice).createSchedule(alice.address, start, 0, DAY, 1n, false)
    ).to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount");
    await expect(vesting.getSchedule(5)).to.be.revertedWithCustomError(vesting, "UnknownSchedule");
  });

  it("sweepFree never touches allocated tokens", async () => {
    await create();
    await vesting.sweepFree(bob.address);
    expect(await token.balanceOf(await vesting.getAddress())).to.equal(AMOUNT);
    expect(await token.balanceOf(bob.address)).to.equal(ethers.parseEther("9000"));
  });
});
