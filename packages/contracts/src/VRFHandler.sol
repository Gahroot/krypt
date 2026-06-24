// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {VRFConsumerBaseV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

/**
 * @title IRandomnessConsumer
 * @notice Callback any CryptoMaple game contract implements to receive VRF output from {VRFHandler}.
 * @dev The game contract (e.g. the on-chain "Cube" Potential-reroller) implements this; it never imports
 *      or talks to Chainlink directly — see the {VRFHandler} security note below.
 */
interface IRandomnessConsumer {
    /// @param requestId The id returned by {VRFHandler.requestRandomness}.
    /// @param randomWords The verified random words delivered by the VRF coordinator.
    function onRandomnessFulfilled(uint256 requestId, uint256[] calldata randomWords) external;
}

/**
 * @title VRFHandler
 * @notice A REPLACEABLE bridge between Chainlink VRF 2.5 and CryptoMaple's immutable game contracts
 *         (Phase 2, DEFERRED). It is the only VRF-aware piece in the system: it requests randomness and
 *         forwards the verified result back to the requesting {IRandomnessConsumer}.
 *
 * @dev Why a separate, swappable handler (the Cyfrin audit rule):
 *      Immutable game contracts must NOT call Chainlink VRF directly. VRF is an evolving external dependency
 *      (coordinator migrations, v2 → v2.5, billing-model changes). If a permanent, un-upgradeable contract
 *      hard-wired the coordinator, a VRF change could brick it forever. So the provably-fair RNG used by the
 *      Cube reroll lives behind this thin, replaceable adapter: the game contracts only know
 *      {IRandomnessConsumer}, and governance can deploy a new handler and re-point consumers if VRF changes —
 *      without touching the immutable game logic.
 *
 * Inheritance note: {VRFConsumerBaseV2Plus} brings its own `ConfirmedOwner` (so `owner()` / `onlyOwner`
 * come from Chainlink here, NOT OpenZeppelin's Ownable). The deployer is the initial owner.
 *
 * STATUS: skeleton. The request parameters and the forward-on-fulfill flow are wired; subscription funding,
 * consumer registration on the live coordinator, and the consumer-side reroll math are out of scope here.
 */
contract VRFHandler is VRFConsumerBaseV2Plus {
    // ─── VRF request configuration (owner-tunable) ──────────────────────────────────────────────
    /// @notice Gas-lane key hash for the target network (Base). Set per deployment.
    bytes32 public keyHash;
    /// @notice Funded VRF 2.5 subscription id (uint256 in 2.5, widened from the uint64 of 2.0).
    uint256 public subscriptionId;
    /// @notice Block confirmations to wait before fulfillment.
    uint16 public requestConfirmations = 3;
    /// @notice Gas budget the coordinator forwards to {rawFulfillRandomWords} → {fulfillRandomWords}.
    uint32 public callbackGasLimit = 200_000;
    /// @notice Whether to pay for VRF in native gas token instead of LINK.
    bool public nativePayment;

    /// @notice Game contracts allowed to request randomness through this handler.
    mapping(address consumer => bool allowed) public isConsumer;
    /// @notice Tracks which consumer to forward each in-flight request's result to.
    mapping(uint256 requestId => address consumer) public requestConsumer;

    event ConsumerSet(address indexed consumer, bool allowed);
    event RandomnessRequested(uint256 indexed requestId, address indexed consumer, uint32 numWords);
    event RandomnessForwarded(uint256 indexed requestId, address indexed consumer);
    event VRFConfigUpdated(
        bytes32 keyHash,
        uint256 subscriptionId,
        uint16 requestConfirmations,
        uint32 callbackGasLimit,
        bool nativePayment
    );

    error NotAuthorizedConsumer(address caller);
    error UnknownRequest(uint256 requestId);

    /**
     * @param vrfCoordinator The VRF 2.5 coordinator address for the target chain (Base).
     * @param _keyHash Gas-lane key hash.
     * @param _subscriptionId Funded subscription id.
     */
    constructor(address vrfCoordinator, bytes32 _keyHash, uint256 _subscriptionId)
        VRFConsumerBaseV2Plus(vrfCoordinator)
    {
        keyHash = _keyHash;
        subscriptionId = _subscriptionId;
    }

    /// @dev Restricts requests to registered game contracts.
    modifier onlyConsumer() {
        if (!isConsumer[msg.sender]) revert NotAuthorizedConsumer(msg.sender);
        _;
    }

    // ─── Owner config ───────────────────────────────────────────────────────────────────────────
    /// @notice Register/unregister a game contract permitted to request randomness. Owner-only.
    function setConsumer(address consumer, bool allowed) external onlyOwner {
        isConsumer[consumer] = allowed;
        emit ConsumerSet(consumer, allowed);
    }

    /// @notice Update VRF request parameters. Owner-only.
    function setVRFConfig(
        bytes32 _keyHash,
        uint256 _subscriptionId,
        uint16 _requestConfirmations,
        uint32 _callbackGasLimit,
        bool _nativePayment
    ) external onlyOwner {
        keyHash = _keyHash;
        subscriptionId = _subscriptionId;
        requestConfirmations = _requestConfirmations;
        callbackGasLimit = _callbackGasLimit;
        nativePayment = _nativePayment;
        emit VRFConfigUpdated(_keyHash, _subscriptionId, _requestConfirmations, _callbackGasLimit, _nativePayment);
    }

    // ─── Request → fulfill flow ───────────────────────────────────────────────────────────────────
    /**
     * @notice Request `numWords` verifiable random words. Callable only by a registered consumer.
     * @dev Forwards the canonical VRF 2.5 request to the coordinator via {s_vrfCoordinator}. The caller is
     *      recorded so {fulfillRandomWords} can forward the result back to exactly this consumer.
     * @param numWords How many random words to draw (e.g. one per Cube line being rerolled).
     * @return requestId The coordinator's request id; surfaces to the consumer for correlation.
     */
    function requestRandomness(uint32 numWords) external onlyConsumer returns (uint256 requestId) {
        requestId = s_vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: keyHash,
                subId: subscriptionId,
                requestConfirmations: requestConfirmations,
                callbackGasLimit: callbackGasLimit,
                numWords: numWords,
                extraArgs: VRFV2PlusClient._argsToBytes(VRFV2PlusClient.ExtraArgsV1({nativePayment: nativePayment}))
            })
        );
        requestConsumer[requestId] = msg.sender;
        emit RandomnessRequested(requestId, msg.sender, numWords);
    }

    /**
     * @notice VRF callback. Invoked by the base contract's `rawFulfillRandomWords` after the coordinator
     *         proof is verified, so only the trusted coordinator path reaches here.
     * @dev Forwards the verified randomness to the originating consumer through {IRandomnessConsumer}.
     */
    function fulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) internal override {
        address consumer = requestConsumer[requestId];
        if (consumer == address(0)) revert UnknownRequest(requestId);
        delete requestConsumer[requestId];

        IRandomnessConsumer(consumer).onRandomnessFulfilled(requestId, randomWords);
        emit RandomnessForwarded(requestId, consumer);
    }
}
