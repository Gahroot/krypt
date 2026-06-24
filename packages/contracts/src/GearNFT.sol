// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title GearNFT
 * @notice Unique equipment as ERC-721 (Phase 2, DEFERRED): one token per god-roll piece. Only gear that
 *         rolls the top Potential tier (LEGENDARY, per the shared package's `isMintWorthy`) ever mints
 *         this keeps chain volume sane and makes true ownership meaningful. Stackable materials/consumables
 *         live in {ItemStack} (ERC-1155) instead.
 *
 * Authorization model (the anti-dupe rule): mints are authorized by the authoritative game server on a
 * CONFIRMED gameplay event (a boss drop the server validated). CLIENTS NEVER MINT — if they could, gear
 * would be duped instantly. The server holds the `mintAuthorizer` key and is the only address allowed to
 * call {mintGear}. `owner` (DAO/timelock in production) administers the contract and may rotate that key.
 *
 * Token id == the off-chain item instance uid (numeric), so the NFT and the game DB row are 1:1. The
 * tokenURI points at metadata describing rank, Potential tier, stat lines, origin boss, and mint date.
 */
contract GearNFT is ERC721, ERC721URIStorage, Ownable {
    /// @notice The authoritative game-server signer permitted to mint. Clients are never authorized.
    address public mintAuthorizer;

    event MintAuthorizerUpdated(address indexed previousAuthorizer, address indexed newAuthorizer);
    event GearMinted(address indexed to, uint256 indexed tokenId, string uri);

    /// @dev Reverts when a caller other than the server `mintAuthorizer` attempts to mint.
    error NotAuthorizer(address caller);

    /// @param initialOwner Admin (DAO/timelock in production); also the initial authorizer until rotated.
    constructor(address initialOwner) ERC721("CryptoMaple Legendary Gear", "GEAR") Ownable(initialOwner) {
        mintAuthorizer = initialOwner;
    }

    /// @dev Restricts to the configured authoritative server signer.
    modifier onlyAuthorizer() {
        if (msg.sender != mintAuthorizer) revert NotAuthorizer(msg.sender);
        _;
    }

    /// @notice Rotate the server signer permitted to mint. Owner-only.
    function setMintAuthorizer(address newAuthorizer) external onlyOwner {
        emit MintAuthorizerUpdated(mintAuthorizer, newAuthorizer);
        mintAuthorizer = newAuthorizer;
    }

    /**
     * @notice Mint a unique gear NFT. Callable ONLY by the server `mintAuthorizer` on confirmed gameplay.
     * @dev Uses `_safeMint` so contract recipients must implement {IERC721Receiver}.
     * @param to Player wallet that earned the drop.
     * @param tokenId The off-chain item instance uid, mirrored on-chain (1:1 with the game DB row).
     * @param uri Metadata URI (rank, Potential tier, stat lines, origin boss, mint date).
     */
    function mintGear(address to, uint256 tokenId, string memory uri) external onlyAuthorizer {
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        emit GearMinted(to, tokenId, uri);
    }

    // ─── OpenZeppelin v5 multiple-inheritance wiring (ERC721 + ERC721URIStorage) ────────────────
    function tokenURI(uint256 tokenId) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC721URIStorage) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
