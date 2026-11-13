// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title PortfolioToken
/// @notice Plain ERC-20 with a hard supply cap, burn and EIP-2612 permit.
/// @dev No transfer taxes, no blacklist, no hidden owner powers: the owner can
///      only mint up to MAX_SUPPLY. Renounce ownership to freeze supply.
contract PortfolioToken is ERC20, ERC20Burnable, ERC20Permit, Ownable {
    uint256 public immutable MAX_SUPPLY;

    error CapExceeded(uint256 requested, uint256 available);

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 maxSupply_,
        uint256 initialMint_,
        address initialOwner
    ) ERC20(name_, symbol_) ERC20Permit(name_) Ownable(initialOwner) {
        MAX_SUPPLY = maxSupply_;
        if (initialMint_ > 0) _mintCapped(initialOwner, initialMint_);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mintCapped(to, amount);
    }

    function _mintCapped(address to, uint256 amount) private {
        uint256 available = MAX_SUPPLY - totalSupply();
        if (amount > available) revert CapExceeded(amount, available);
        _mint(to, amount);
    }
}
