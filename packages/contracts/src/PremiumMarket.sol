// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title PremiumMarket
 * @notice The on-chain Premium Market (Phase 2, DEFERRED): the un-killable, trustless successor to
 *         MapleStory's MTS. Sellers list {GearNFT} (unique Legendary gear) for a {MapleToken} ($MAPLE)
 *         price; buyers settle on-chain; the protocol takes a basis-points fee to a treasury (the
 *         reskinned NX tax → community/DAO, see PLANNING.md §3 / §5).
 *
 * @dev This MIRRORS the off-chain `MarketRoom` (the soft-Mesos Free Market) semantics, but trustless:
 *      - list:   escrow the NFT into the market (requires prior `approve`), record {seller, price}.
 *      - cancel: only the seller; return the escrowed NFT.
 *      - buy:    not the seller; pull `price` $MAPLE from the buyer, send `fee` to treasury and
 *                `price - fee` to the seller, deliver the NFT to the buyer.
 *      Fee math is identical to off-chain: `fee = price * feeBps / 10_000` (floored), default 250 = 2.5%.
 *
 * Skeleton scope: fixed-price listings only. The MTS auction (1–7 day) and "Wanted" buy-order tabs are
 * intentionally out of scope here and noted as TODO for a later milestone. Not audited; not deployed.
 */
contract PremiumMarket is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice $MAPLE, the settlement currency.
    IERC20 public immutable paymentToken;
    /// @notice The gear collection eligible to trade here.
    IERC721 public immutable gear;

    /// @notice Protocol fee in basis points taken from each sale (mirrors MarketRoom's `feeBps`). 250 = 2.5%.
    uint16 public feeBps = 250;
    /// @notice Hard cap on the fee so governance can never set a confiscatory rate. 1000 = 10%.
    uint16 public constant MAX_FEE_BPS = 1000;
    /// @notice Recipient of protocol fees (treasury / burn address).
    address public treasury;

    struct Listing {
        address seller;
        uint256 tokenId;
        uint256 price; // in $MAPLE (18 decimals)
        bool active;
    }

    /// @notice listingId → listing. Ids increment from 1; 0 is reserved as "none".
    mapping(uint256 listingId => Listing) public listings;
    /// @notice Monotonic listing id counter (last issued id).
    uint256 public lastListingId;

    event Listed(uint256 indexed listingId, address indexed seller, uint256 indexed tokenId, uint256 price);
    event Cancelled(uint256 indexed listingId, address indexed seller, uint256 indexed tokenId);
    event Bought(
        uint256 indexed listingId,
        address indexed buyer,
        address indexed seller,
        uint256 tokenId,
        uint256 price,
        uint256 fee
    );
    event FeeBpsUpdated(uint16 previousFeeBps, uint16 newFeeBps);
    event TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);

    error ZeroAddress();
    error ZeroPrice();
    error FeeTooHigh(uint16 feeBps);
    error ListingNotActive(uint256 listingId);
    error NotSeller(uint256 listingId, address caller);
    error CannotBuyOwnListing(uint256 listingId);

    /**
     * @param initialOwner Admin (DAO/timelock in production) able to tune fee + treasury.
     * @param paymentToken_ $MAPLE token address.
     * @param gear_ GearNFT collection address.
     * @param treasury_ Fee recipient (treasury / burn).
     */
    constructor(address initialOwner, IERC20 paymentToken_, IERC721 gear_, address treasury_) Ownable(initialOwner) {
        if (address(paymentToken_) == address(0) || address(gear_) == address(0) || treasury_ == address(0)) {
            revert ZeroAddress();
        }
        paymentToken = paymentToken_;
        gear = gear_;
        treasury = treasury_;
    }

    // ─── Owner config ───────────────────────────────────────────────────────────────────────────
    /// @notice Update the protocol fee (basis points), capped by {MAX_FEE_BPS}. Owner-only.
    function setFeeBps(uint16 newFeeBps) external onlyOwner {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh(newFeeBps);
        emit FeeBpsUpdated(feeBps, newFeeBps);
        feeBps = newFeeBps;
    }

    /// @notice Update the treasury (fee recipient). Owner-only.
    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    // ─── Market actions ───────────────────────────────────────────────────────────────────────────
    /**
     * @notice List a gear NFT for a fixed $MAPLE price. The market escrows the NFT.
     * @dev Caller must `approve` this market for `tokenId` first. Mirrors MarketRoom escrow-on-list.
     * @return listingId The new listing's id.
     */
    function list(uint256 tokenId, uint256 price) external nonReentrant returns (uint256 listingId) {
        if (price == 0) revert ZeroPrice();

        // Escrow: pull the NFT in. `transferFrom` reverts unless caller owns + approved it.
        gear.transferFrom(msg.sender, address(this), tokenId);

        listingId = ++lastListingId;
        listings[listingId] = Listing({seller: msg.sender, tokenId: tokenId, price: price, active: true});
        emit Listed(listingId, msg.sender, tokenId, price);
    }

    /**
     * @notice Cancel a listing and return the escrowed NFT. Seller-only.
     */
    function cancel(uint256 listingId) external nonReentrant {
        Listing storage l = listings[listingId];
        if (!l.active) revert ListingNotActive(listingId);
        if (l.seller != msg.sender) revert NotSeller(listingId, msg.sender);

        l.active = false;
        gear.safeTransferFrom(address(this), l.seller, l.tokenId);
        emit Cancelled(listingId, l.seller, l.tokenId);
    }

    /**
     * @notice Buy a listed NFT. Pulls `price` $MAPLE from the buyer, routes `fee` to treasury and the
     *         remainder to the seller, then delivers the NFT. Buyer must `approve` $MAPLE first.
     * @dev Fee math mirrors the off-chain market exactly: `fee = price * feeBps / 10_000`.
     */
    function buy(uint256 listingId) external nonReentrant {
        Listing storage l = listings[listingId];
        if (!l.active) revert ListingNotActive(listingId);
        if (l.seller == msg.sender) revert CannotBuyOwnListing(listingId);

        uint256 price = l.price;
        address seller = l.seller;
        uint256 tokenId = l.tokenId;
        uint256 fee = (price * feeBps) / 10_000;

        // Effects before interactions (listing closed first; nonReentrant also guards).
        l.active = false;

        // Settle payment: buyer → treasury (fee) + buyer → seller (net).
        paymentToken.safeTransferFrom(msg.sender, treasury, fee);
        paymentToken.safeTransferFrom(msg.sender, seller, price - fee);

        // Deliver the NFT to the buyer.
        gear.safeTransferFrom(address(this), msg.sender, tokenId);
        emit Bought(listingId, msg.sender, seller, tokenId, price, fee);
    }
}
