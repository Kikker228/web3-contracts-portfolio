// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title TokenVesting
/// @notice Linear vesting with cliff for many beneficiaries of one ERC-20.
/// @dev Schedules are funded up-front: the contract must hold enough free
///      tokens when a schedule is created. Revocable schedules return the
///      unvested remainder to the owner; vested tokens stay claimable.
contract TokenVesting is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Schedule {
        address beneficiary;
        uint64 start;
        uint64 cliff;      // absolute timestamp
        uint64 end;        // absolute timestamp
        bool revocable;
        bool revoked;
        uint256 total;     // total tokens allocated
        uint256 released;  // already paid out
    }

    IERC20 public immutable token;
    uint256 public totalAllocated; // tokens reserved by active schedules, not yet released
    Schedule[] private _schedules;
    mapping(address => uint256[]) private _byBeneficiary;

    event ScheduleCreated(uint256 indexed id, address indexed beneficiary, uint256 total);
    event Released(uint256 indexed id, address indexed beneficiary, uint256 amount);
    event Revoked(uint256 indexed id, uint256 refunded);

    error ZeroAddress();
    error InvalidSchedule();
    error InsufficientFreeBalance(uint256 free, uint256 needed);
    error NotBeneficiary();
    error NothingToRelease();
    error NotRevocable();
    error AlreadyRevoked();
    error UnknownSchedule();

    constructor(IERC20 token_, address owner_) Ownable(owner_) {
        if (address(token_) == address(0)) revert ZeroAddress();
        token = token_;
    }

    function createSchedule(
        address beneficiary,
        uint64 start,
        uint64 cliffDuration,
        uint64 duration,
        uint256 amount,
        bool revocable
    ) external onlyOwner returns (uint256 id) {
        if (beneficiary == address(0)) revert ZeroAddress();
        if (duration == 0 || amount == 0 || cliffDuration > duration) revert InvalidSchedule();

        uint256 free = token.balanceOf(address(this)) - totalAllocated;
        if (free < amount) revert InsufficientFreeBalance(free, amount);

        id = _schedules.length;
        _schedules.push(
            Schedule({
                beneficiary: beneficiary,
                start: start,
                cliff: start + cliffDuration,
                end: start + duration,
                revocable: revocable,
                revoked: false,
                total: amount,
                released: 0
            })
        );
        _byBeneficiary[beneficiary].push(id);
        totalAllocated += amount;
        emit ScheduleCreated(id, beneficiary, amount);
    }

    function scheduleCount() external view returns (uint256) {
        return _schedules.length;
    }

    function getSchedule(uint256 id) external view returns (Schedule memory) {
        if (id >= _schedules.length) revert UnknownSchedule();
        return _schedules[id];
    }

    function schedulesOf(address beneficiary) external view returns (uint256[] memory) {
        return _byBeneficiary[beneficiary];
    }

    /// @notice Tokens vested so far (including already released).
    function vestedAmount(uint256 id) public view returns (uint256) {
        if (id >= _schedules.length) revert UnknownSchedule();
        Schedule storage s = _schedules[id];
        if (s.revoked) return s.total; // total was cut to the vested amount on revoke
        if (block.timestamp < s.cliff) return 0;
        if (block.timestamp >= s.end) return s.total;
        return (s.total * (block.timestamp - s.start)) / (s.end - s.start);
    }

    function releasable(uint256 id) public view returns (uint256) {
        return vestedAmount(id) - _schedules[id].released;
    }

    function release(uint256 id) external nonReentrant {
        if (id >= _schedules.length) revert UnknownSchedule();
        Schedule storage s = _schedules[id];
        if (msg.sender != s.beneficiary) revert NotBeneficiary();
        uint256 amount = releasable(id);
        if (amount == 0) revert NothingToRelease();

        s.released += amount;
        totalAllocated -= amount;
        token.safeTransfer(s.beneficiary, amount);
        emit Released(id, s.beneficiary, amount);
    }

    /// @notice Stop vesting. Unvested tokens go back to the owner.
    function revoke(uint256 id) external onlyOwner nonReentrant {
        if (id >= _schedules.length) revert UnknownSchedule();
        Schedule storage s = _schedules[id];
        if (!s.revocable) revert NotRevocable();
        if (s.revoked) revert AlreadyRevoked();

        uint256 vested = vestedAmount(id);
        uint256 refund = s.total - vested;
        s.total = vested;
        s.revoked = true;
        totalAllocated -= refund;
        if (refund > 0) token.safeTransfer(owner(), refund);
        emit Revoked(id, refund);
    }

    /// @notice Recover tokens that are not reserved by any schedule.
    function sweepFree(address to) external onlyOwner {
        uint256 free = token.balanceOf(address(this)) - totalAllocated;
        token.safeTransfer(to, free);
    }
}
