// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";
import {VRFHandler, IRandomnessConsumer} from "../src/VRFHandler.sol";

/// @dev Minimal callback surface of {VRFConsumerBaseV2Plus} the mock coordinator drives.
interface IVRFCallback {
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external;
}

/// @dev Stand-in for the Chainlink VRF 2.5 coordinator: hands out ids and replays the fulfillment call.
contract MockVRFCoordinator {
    uint256 public lastRequestId;

    function requestRandomWords(VRFV2PlusClient.RandomWordsRequest calldata) external returns (uint256) {
        return ++lastRequestId;
    }

    /// @dev Simulates the off-chain VRF node calling back; msg.sender becomes this coordinator's address,
    ///      satisfying the base contract's `onlyCoordinator` guard on `rawFulfillRandomWords`.
    function fulfill(address consumer, uint256 requestId, uint256[] calldata randomWords) external {
        IVRFCallback(consumer).rawFulfillRandomWords(requestId, randomWords);
    }
}

/// @dev A game contract that requests randomness through the handler and records what it receives.
contract MockConsumer is IRandomnessConsumer {
    uint256 public lastRequestId;
    uint256[] public lastWords;
    uint256 public fulfilledCount;

    function ask(VRFHandler handler, uint32 numWords) external returns (uint256) {
        return handler.requestRandomness(numWords);
    }

    function onRandomnessFulfilled(uint256 requestId, uint256[] calldata randomWords) external {
        lastRequestId = requestId;
        lastWords = randomWords;
        fulfilledCount++;
    }
}

contract VRFHandlerTest is Test {
    MockVRFCoordinator internal coord;
    VRFHandler internal handler;
    MockConsumer internal consumer;

    function setUp() public {
        coord = new MockVRFCoordinator();
        handler = new VRFHandler(address(coord), keccak256("base-gas-lane"), 1);
        consumer = new MockConsumer();
        handler.setConsumer(address(consumer), true);
    }

    function test_Deploy_State() public view {
        assertEq(address(handler.s_vrfCoordinator()), address(coord));
        assertEq(handler.owner(), address(this)); // ConfirmedOwner sets deployer
        assertTrue(handler.isConsumer(address(consumer)));
    }

    /// @dev Core behavior: a registered consumer requests, and the verified words are forwarded back to it.
    function test_RequestThenFulfill_ForwardsToConsumer() public {
        uint256 requestId = consumer.ask(handler, 2);
        assertEq(handler.requestConsumer(requestId), address(consumer));

        uint256[] memory words = new uint256[](2);
        words[0] = 42;
        words[1] = 99;
        coord.fulfill(address(handler), requestId, words);

        assertEq(consumer.fulfilledCount(), 1);
        assertEq(consumer.lastRequestId(), requestId);
        assertEq(consumer.lastWords(0), 42);
        assertEq(consumer.lastWords(1), 99);
        // Forwarded request mapping is cleared after delivery.
        assertEq(handler.requestConsumer(requestId), address(0));
    }

    function test_UnregisteredConsumer_Reverts() public {
        MockConsumer rogue = new MockConsumer();
        vm.expectRevert(abi.encodeWithSelector(VRFHandler.NotAuthorizedConsumer.selector, address(rogue)));
        rogue.ask(handler, 1);
    }
}
