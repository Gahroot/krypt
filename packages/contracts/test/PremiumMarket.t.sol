// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {MapleToken} from "../src/MapleToken.sol";
import {GearNFT} from "../src/GearNFT.sol";
import {PremiumMarket} from "../src/PremiumMarket.sol";

contract PremiumMarketTest is Test {
    MapleToken internal maple;
    GearNFT internal gear;
    PremiumMarket internal market;

    address internal admin = address(this);
    address internal treasury = makeAddr("treasury");
    address internal seller = makeAddr("seller");
    address internal buyer = makeAddr("buyer");

    uint256 internal constant TOKEN_ID = 1;
    uint256 internal constant PRICE = 100 ether;

    function setUp() public {
        maple = new MapleToken(admin);
        gear = new GearNFT(admin); // admin is the mint authorizer
        market = new PremiumMarket(admin, IERC20(address(maple)), IERC721(address(gear)), treasury);

        // Seller earns a Legendary gear NFT; buyer holds $MAPLE.
        gear.mintGear(seller, TOKEN_ID, "ipfs://gear/1.json");
        maple.mint(buyer, 1_000 ether);
    }

    function test_Deploy_State() public view {
        assertEq(address(market.paymentToken()), address(maple));
        assertEq(address(market.gear()), address(gear));
        assertEq(market.treasury(), treasury);
        assertEq(market.feeBps(), 250); // 2.5%, mirrors the off-chain MarketRoom
    }

    /// @dev Core behavior: a full list → buy moves the NFT to the buyer and splits payment with the fee.
    function test_ListThenBuy_MovesNftAndSplitsFee() public {
        // Seller lists (escrows the NFT into the market).
        vm.startPrank(seller);
        gear.approve(address(market), TOKEN_ID);
        uint256 listingId = market.list(TOKEN_ID, PRICE);
        vm.stopPrank();
        assertEq(gear.ownerOf(TOKEN_ID), address(market)); // escrowed

        // Buyer pays in $MAPLE.
        vm.startPrank(buyer);
        maple.approve(address(market), PRICE);
        market.buy(listingId);
        vm.stopPrank();

        uint256 expectedFee = (PRICE * 250) / 10_000; // 2.5 ether

        assertEq(gear.ownerOf(TOKEN_ID), buyer, "NFT delivered to buyer");
        assertEq(maple.balanceOf(treasury), expectedFee, "fee to treasury");
        assertEq(maple.balanceOf(seller), PRICE - expectedFee, "net proceeds to seller");
        assertEq(maple.balanceOf(buyer), 1_000 ether - PRICE, "buyer debited full price");

        (,,, bool active) = market.listings(listingId);
        assertFalse(active, "listing closed");
    }

    function test_Cancel_ReturnsEscrowedNft() public {
        vm.startPrank(seller);
        gear.approve(address(market), TOKEN_ID);
        uint256 listingId = market.list(TOKEN_ID, PRICE);
        market.cancel(listingId);
        vm.stopPrank();

        assertEq(gear.ownerOf(TOKEN_ID), seller, "NFT returned to seller");
    }

    function test_BuyOwnListing_Reverts() public {
        vm.startPrank(seller);
        gear.approve(address(market), TOKEN_ID);
        uint256 listingId = market.list(TOKEN_ID, PRICE);
        vm.expectRevert(abi.encodeWithSelector(PremiumMarket.CannotBuyOwnListing.selector, listingId));
        market.buy(listingId);
        vm.stopPrank();
    }
}
