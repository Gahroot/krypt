// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MapleToken ($MAPLE)
 * @notice The on-chain utility + governance token of the CryptoMaple Premium Market (Phase 2, DEFERRED).
 *
 * Role in the economy (see PLANNING.md §7 Tokenomics):
 *   - Premium Market currency (the reskinned "NX Cash").
 *   - Pays listing fees / protocol tax (see {PremiumMarket}).
 *   - Burned/spent on Potential rerolls ("Cubes") — the deflationary sink.
 *
 * Supply policy (STUB — finalize before any audit/deploy):
 *   - Minting is owner-only. In production the owner is the DAO/treasury timelock, NOT an EOA, and
 *     emission is gated by a vested, capped schedule (play-to-earn rewards, liquidity, team vesting).
 *   - No hard cap is enforced on-chain yet. A real deployment should either set an immutable MAX_SUPPLY
 *     cap here (e.g. via OZ ERC20Capped) or move emission behind a minter/timelock contract.
 *   - `decimals()` is the ERC20 default of 18.
 */
contract MapleToken is ERC20, Ownable {
    /// @param initialOwner The address that may mint (DAO treasury / timelock in production).
    /// @dev OpenZeppelin v5 requires the owner be passed explicitly to {Ownable}.
    constructor(address initialOwner) ERC20("CryptoMaple", "MAPLE") Ownable(initialOwner) {}

    /**
     * @notice Mint new $MAPLE. Owner-only.
     * @dev STUB: production emission must be capped/vested behind a timelock, not an unbounded owner mint.
     * @param to Recipient of the freshly minted tokens.
     * @param amount Amount in wei (18 decimals).
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
