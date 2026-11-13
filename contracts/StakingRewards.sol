// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title StakingRewards
/// @notice Synthetix-style staking: stake `stakingToken`, earn `rewardsToken`
///         streamed linearly over a rewards period.
/// @dev Owner can only fund new reward periods. The owner has no way to touch
///      staked principal. Staking and rewards tokens must be standard ERC-20s
///      (no fee-on-transfer or rebasing tokens).
contract StakingRewards is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable stakingToken;
    IERC20 public immutable rewardsToken;

    uint256 public periodFinish;
    uint256 public rewardRate;          // reward tokens per second
    uint256 public rewardsDuration;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored; // scaled by 1e18

    uint256 public totalStaked;
    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardAdded(uint256 reward, uint256 newPeriodFinish);
    event RewardsDurationUpdated(uint256 newDuration);

    error ZeroAmount();
    error ZeroAddress();
    error PeriodNotFinished();
    error RewardTooHigh();
    error InsufficientStake();

    constructor(
        IERC20 stakingToken_,
        IERC20 rewardsToken_,
        uint256 rewardsDuration_,
        address owner_
    ) Ownable(owner_) {
        if (address(stakingToken_) == address(0) || address(rewardsToken_) == address(0)) {
            revert ZeroAddress();
        }
        if (rewardsDuration_ == 0) revert ZeroAmount();
        stakingToken = stakingToken_;
        rewardsToken = rewardsToken_;
        rewardsDuration = rewardsDuration_;
    }

    // ---------------------------------------------------------------- views

    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    function rewardPerToken() public view returns (uint256) {
        if (totalStaked == 0) return rewardPerTokenStored;
        return
            rewardPerTokenStored +
            ((lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * 1e18) / totalStaked;
    }

    function earned(address account) public view returns (uint256) {
        return
            (balanceOf[account] * (rewardPerToken() - userRewardPerTokenPaid[account])) / 1e18 +
            rewards[account];
    }

    function getRewardForDuration() external view returns (uint256) {
        return rewardRate * rewardsDuration;
    }

    // ------------------------------------------------------------- mutative

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    function stake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        if (amount == 0) revert ZeroAmount();
        totalStaked += amount;
        balanceOf[msg.sender] += amount;
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount);
    }

    function withdraw(uint256 amount) public nonReentrant updateReward(msg.sender) {
        if (amount == 0) revert ZeroAmount();
        if (amount > balanceOf[msg.sender]) revert InsufficientStake();
        totalStaked -= amount;
        balanceOf[msg.sender] -= amount;
        stakingToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function getReward() public nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            rewardsToken.safeTransfer(msg.sender, reward);
            emit RewardPaid(msg.sender, reward);
        }
    }

    /// @notice Withdraw everything and claim rewards in one call.
    function exit() external {
        withdraw(balanceOf[msg.sender]);
        getReward();
    }

    // ---------------------------------------------------------------- admin

    /// @notice Fund a reward period. Tokens must be transferred to this
    ///         contract before calling (checked against the balance).
    function notifyRewardAmount(uint256 reward) external onlyOwner updateReward(address(0)) {
        if (block.timestamp >= periodFinish) {
            rewardRate = reward / rewardsDuration;
        } else {
            uint256 remaining = periodFinish - block.timestamp;
            uint256 leftover = remaining * rewardRate;
            rewardRate = (reward + leftover) / rewardsDuration;
        }

        // Ensure the provided reward amount is not more than the balance in the
        // contract (staked principal is excluded when both tokens are the same).
        uint256 balance = rewardsToken.balanceOf(address(this));
        if (address(rewardsToken) == address(stakingToken)) balance -= totalStaked;
        if (rewardRate > balance / rewardsDuration) revert RewardTooHigh();

        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + rewardsDuration;
        emit RewardAdded(reward, periodFinish);
    }

    function setRewardsDuration(uint256 newDuration) external onlyOwner {
        if (block.timestamp <= periodFinish) revert PeriodNotFinished();
        if (newDuration == 0) revert ZeroAmount();
        rewardsDuration = newDuration;
        emit RewardsDurationUpdated(newDuration);
    }
}
