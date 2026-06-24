// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155Supply} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ItemStack
 * @notice Stackable game items as ERC-1155 (Phase 2, DEFERRED): materials & consumables — the things
 *         that are fungible-within-a-type (many identical Cubes), as opposed to unique gear (see {GearNFT}).
 *
 * Pattern: this follows the verified AVAXGods on-chain-game item pattern — a single ERC-1155 collection
 * where each game item type is a fixed `uint256` token id, `ERC1155Supply` tracks per-id totals, and a
 * gated `mintItem` is the only emission path. Per OpenZeppelin v5, `ERC1155Supply` is wired by overriding
 * the single `_update` hook (the v5 replacement for the removed `_beforeTokenTransfer`/`_afterTokenTransfer`).
 *
 * Minting authority: like the rest of CryptoMaple, item grants are server-authoritative. The authoritative
 * game server (`minter`) mints on confirmed gameplay (e.g. a crafting turn-in or a shop purchase). Clients
 * never mint. `owner` is the admin (DAO/timelock in production) and may rotate the `minter`.
 */
contract ItemStack is ERC1155, ERC1155Supply, Ownable {
    // ─── Token-id catalog (examples, one constant per stackable item type) ──────────────────────
    /// @notice "Cube" — consumed to reroll an item's Potential lines via Chainlink VRF (the anti-Nexon gacha).
    uint256 public constant CUBE = 0;
    /// @notice Enhancement Scroll — raises an item's Base rank (Normal → Enhanced → ...).
    uint256 public constant ENHANCEMENT_SCROLL = 1;
    /// @notice Star-forge Catalyst — material spent on star-forging upgrades.
    uint256 public constant STARFORGE_CATALYST = 2;
    /// @notice Revival Feather — a consumable that prevents an on-death penalty.
    uint256 public constant REVIVAL_FEATHER = 3;

    /// @notice Address authorized to mint besides the owner — the authoritative game server signer.
    address public minter;

    event MinterUpdated(address indexed previousMinter, address indexed newMinter);

    /// @dev Reverts when a non-owner/non-minter calls a mint-gated function.
    error NotAuthorizedMinter(address caller);

    /// @param initialOwner Admin (DAO/timelock in production); also the initial minter until rotated.
    /// @param baseUri ERC-1155 metadata URI template, e.g. "https://api.cryptomaple.xyz/item/{id}.json".
    constructor(address initialOwner, string memory baseUri) ERC1155(baseUri) Ownable(initialOwner) {
        minter = initialOwner;
    }

    /// @dev Restricts to the contract owner or the configured server `minter`.
    modifier onlyMinter() {
        if (msg.sender != owner() && msg.sender != minter) revert NotAuthorizedMinter(msg.sender);
        _;
    }

    /// @notice Rotate the server minter. Owner-only.
    function setMinter(address newMinter) external onlyOwner {
        emit MinterUpdated(minter, newMinter);
        minter = newMinter;
    }

    /// @notice Update the metadata URI template. Owner-only.
    function setURI(string memory newUri) external onlyOwner {
        _setURI(newUri);
    }

    /**
     * @notice Mint `amount` of stackable item `id` to `to`. Owner/minter-gated.
     * @dev `ERC1155Supply.totalSupply(id)` increases by `amount` (asserted in tests).
     * @param to Recipient.
     * @param id One of the token-id constants above (or a future item type).
     * @param amount Quantity to mint.
     * @param data Forwarded to the ERC-1155 receiver hook (use "" when unused).
     */
    function mintItem(address to, uint256 id, uint256 amount, bytes memory data) external onlyMinter {
        _mint(to, id, amount, data);
    }

    // ─── OpenZeppelin v5 multiple-inheritance wiring ────────────────────────────────────────────
    /// @dev Single hook both {ERC1155} and {ERC1155Supply} override in v5; `super` threads through both.
    function _update(address from, address to, uint256[] memory ids, uint256[] memory values)
        internal
        override(ERC1155, ERC1155Supply)
    {
        super._update(from, to, ids, values);
    }
}
