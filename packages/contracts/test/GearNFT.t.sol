// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {GearNFT} from "../src/GearNFT.sol";

contract GearNFTTest is Test {
    GearNFT internal gear;
    address internal owner = address(this);
    address internal server = makeAddr("server"); // authoritative game-server signer
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        gear = new GearNFT(owner);
    }

    function test_Deploy_State() public view {
        assertEq(gear.name(), "CryptoMaple Legendary Gear");
        assertEq(gear.symbol(), "GEAR");
        assertEq(gear.owner(), owner);
        assertEq(gear.mintAuthorizer(), owner); // initial authorizer == owner
    }

    /// @dev Core behavior: only the configured authorizer can mint; minting assigns ownership + URI.
    function test_AuthorizerMint_AssignsOwnerAndUri() public {
        gear.setMintAuthorizer(server);

        vm.prank(server);
        gear.mintGear(alice, 1, "ipfs://gear/1.json");

        assertEq(gear.ownerOf(1), alice);
        assertEq(gear.tokenURI(1), "ipfs://gear/1.json");
    }

    function test_NonAuthorizerMint_Reverts() public {
        gear.setMintAuthorizer(server);

        // bob is not the authorizer — a client can never mint.
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(GearNFT.NotAuthorizer.selector, bob));
        gear.mintGear(bob, 2, "ipfs://gear/2.json");
    }
}
