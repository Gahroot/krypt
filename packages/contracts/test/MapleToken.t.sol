// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MapleToken} from "../src/MapleToken.sol";

contract MapleTokenTest is Test {
    MapleToken internal token;
    address internal owner = address(this);
    address internal alice = makeAddr("alice");

    function setUp() public {
        token = new MapleToken(owner);
    }

    function test_Deploy_Metadata() public view {
        assertEq(token.name(), "CryptoMaple");
        assertEq(token.symbol(), "MAPLE");
        assertEq(token.decimals(), 18);
        assertEq(token.owner(), owner);
        assertEq(token.totalSupply(), 0);
    }

    /// @dev Core behavior: owner mint increases the recipient balance and total supply.
    function test_OwnerMint_IncreasesBalance() public {
        token.mint(alice, 1_000 ether);
        assertEq(token.balanceOf(alice), 1_000 ether);
        assertEq(token.totalSupply(), 1_000 ether);
    }

    function test_NonOwnerMint_Reverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        token.mint(alice, 1 ether);
    }
}
