const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PortfolioToken", () => {
  const MAX = ethers.parseEther("1000000");
  let owner, alice, bob, token;

  beforeEach(async () => {
    [owner, alice, bob] = await ethers.getSigners();
    const F = await ethers.getContractFactory("PortfolioToken");
    token = await F.deploy("Portfolio", "PFT", MAX, ethers.parseEther("1000"), owner.address);
  });

  it("mints the initial supply to the owner", async () => {
    expect(await token.balanceOf(owner.address)).to.equal(ethers.parseEther("1000"));
    expect(await token.MAX_SUPPLY()).to.equal(MAX);
  });

  it("lets only the owner mint, and only up to the cap", async () => {
    await expect(token.connect(alice).mint(alice.address, 1n)).to.be.revertedWithCustomError(
      token,
      "OwnableUnauthorizedAccount"
    );
    const available = MAX - (await token.totalSupply());
    await token.mint(alice.address, available);
    await expect(token.mint(alice.address, 1n))
      .to.be.revertedWithCustomError(token, "CapExceeded")
      .withArgs(1n, 0n);
  });

  it("rejects an initial mint above the cap", async () => {
    const F = await ethers.getContractFactory("PortfolioToken");
    await expect(F.deploy("X", "X", 10n, 11n, owner.address)).to.be.revertedWithCustomError(F, "CapExceeded");
  });

  it("transfers without any fee", async () => {
    await token.transfer(alice.address, ethers.parseEther("10"));
    expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("10"));
  });

  it("burning reduces total supply", async () => {
    await token.burn(ethers.parseEther("100"));
    expect(await token.totalSupply()).to.equal(ethers.parseEther("900"));
  });

  it("supports EIP-2612 permit", async () => {
    const value = ethers.parseEther("5");
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
    const nonce = await token.nonces(owner.address);
    const { chainId } = await ethers.provider.getNetwork();
    const sig = await owner.signTypedData(
      { name: "Portfolio", version: "1", chainId, verifyingContract: await token.getAddress() },
      {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      { owner: owner.address, spender: bob.address, value, nonce, deadline }
    );
    const { v, r, s } = ethers.Signature.from(sig);
    await token.permit(owner.address, bob.address, value, deadline, v, r, s);
    expect(await token.allowance(owner.address, bob.address)).to.equal(value);
  });

  it("renouncing ownership freezes supply", async () => {
    await token.renounceOwnership();
    await expect(token.mint(owner.address, 1n)).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
  });
});
