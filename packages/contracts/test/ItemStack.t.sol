// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ItemStack} from "../src/ItemStack.sol";

contract ItemStackTest is Test {
    ItemStack internal items;
    address internal owner = address(this);
    address internal server = makeAddr("server");
    address internal alice = makeAddr("alice");

    function setUp() public {
        items = new ItemStack(owner, "https://api.cryptomaple.xyz/item/{id}.json");
    }

    function test_Deploy_State() public view {
        assertEq(items.owner(), owner);
        assertEq(items.minter(), owner); // initial minter == owner
        assertEq(items.totalSupply(items.CUBE()), 0);
        assertFalse(items.exists(items.CUBE()));
    }

    /// @dev Core behavior: minting a stackable item increments its ERC1155Supply total.
    function test_Mint_IncrementsSupply() public {
        items.mintItem(alice, items.CUBE(), 5, "");
        assertEq(items.balanceOf(alice, items.CUBE()), 5);
        assertEq(items.totalSupply(items.CUBE()), 5);
        assertTrue(items.exists(items.CUBE()));
    }

    function test_RotatedMinter_CanMint() public {
        items.setMinter(server);
        assertEq(items.minter(), server);

        // Read the id before pranking: an external call in argument position would consume the prank.
        uint256 scrollId = items.ENHANCEMENT_SCROLL();
        vm.prank(server);
        items.mintItem(alice, scrollId, 3, "");
        assertEq(items.totalSupply(scrollId), 3);
    }

    function test_UnauthorizedMint_Reverts() public {
        // alice is neither owner nor the configured minter.
        uint256 cubeId = items.CUBE();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ItemStack.NotAuthorizedMinter.selector, alice));
        items.mintItem(alice, cubeId, 1, "");
    }
}
