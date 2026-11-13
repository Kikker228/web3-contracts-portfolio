# Web3 Contracts Portfolio (Solidity 0.8.26, Hardhat)

Three small, readable, well-tested contracts built on OpenZeppelin v5. No hidden
owner powers, no transfer taxes, no upgradeability tricks.

| Contract | What it does |
|---|---|
| `PortfolioToken` | ERC-20 with hard supply cap, burn, EIP-2612 permit, owner-only capped mint |
| `TokenVesting` | Linear vesting with cliff for many beneficiaries, optional revocation, pre-funded schedules |
| `StakingRewards` | Stake a token, earn rewards streamed linearly over a period (Synthetix-style accounting) |

## Design notes
- Custom errors instead of revert strings (cheaper, clearer in tests).
- `SafeERC20` and `ReentrancyGuard` on every function that moves tokens.
- Vesting schedules are funded up front; `totalAllocated` makes over-allocation impossible and `sweepFree` can never touch allocated tokens.
- Staking: the owner can only fund reward periods. They cannot touch staked principal. `notifyRewardAmount` checks the contract really holds the rewards (staked principal excluded when both tokens are the same).
- Assumes standard ERC-20s (no fee-on-transfer / rebasing tokens).

## Run
```bash
npm install
npx hardhat test          # 28 tests
npx hardhat run scripts/deploy.js   # local in-process network
```
If your machine cannot download the native Solidity compiler, run with `USE_SOLCJS=1`.

## Status
Unit-tested only. Not audited. Do not deploy to mainnet with real funds without an independent review.
