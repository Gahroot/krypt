# @maple/contracts — Phase 2 on-chain layer (DEFERRED)

Foundry (Solidity) package for CryptoMaple's **Phase 2** on-chain layer. Target chain: **Base** (Ethereum L2).

> **Status: stubs + passing unit tests only.** This is the deliberately-deferred crypto layer (see
> [`PLANNING.md`](../../PLANNING.md) §11 Roadmap). There are **no deploy scripts, no testnet/mainnet
> broadcasts, no RPC endpoints, and no keys** here. Deployment is a later, separate milestone behind a
> security review. The live game runs entirely off-chain today (`@maple/server` + `@maple/client`).

## Contracts (`src/`)

| Contract | Standard | Role |
|---|---|---|
| `MapleToken.sol` | ERC-20 (`is ERC20, Ownable`) | **$MAPLE** — Premium Market currency + governance. Owner-only `mint` (capped/vested behind a timelock in production). |
| `ItemStack.sol` | ERC-1155 (`is ERC1155, ERC1155Supply, Ownable`) | Stackable materials/consumables (Cubes, scrolls…). The verified AVAXGods item pattern; owner/minter-gated `mintItem`; v5 `_update` override for supply tracking. |
| `GearNFT.sol` | ERC-721 (`is ERC721, ERC721URIStorage, Ownable`) | Unique **Legendary** gear. Mints are **server-authorized** (`mintAuthorizer`) on confirmed gameplay — clients never mint. |
| `VRFHandler.sol` | Chainlink VRF 2.5 (`is VRFConsumerBaseV2Plus`) | A **replaceable** randomness bridge. Per the Cyfrin audit rule, immutable game contracts must not call VRF directly; this swappable handler requests randomness and forwards it to an `IRandomnessConsumer`. |
| `PremiumMarket.sol` | `is Ownable, ReentrancyGuard` | On-chain marketplace: list/buy/cancel `GearNFT` priced in `MapleToken`, taking a basis-points protocol fee to a treasury. Mirrors the off-chain `MarketRoom` semantics (fee = `price * feeBps / 10_000`, default 250 = 2.5%). |

Each contract has a matching `test/<Name>.t.sol` asserting deploy + a core behavior (17 tests total).

## Prerequisites

Foundry (`forge`) must be installed:

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup            # installs forge, cast, anvil, chisel
forge --version
```

## Install dependencies

Dependencies are vendored into `lib/` (git-ignored). The canonical command is `forge install`, but in this
monorepo `forge install` resolves the project root to the **outer** repo's `.git` and rejects the nested
`lib` path. Install with the equivalent `--no-git` vendored clone instead:

```bash
cd packages/contracts
git clone --depth 1 --recurse-submodules https://github.com/foundry-rs/forge-std lib/forge-std
git clone --depth 1 --branch v5.6.0 https://github.com/OpenZeppelin/openzeppelin-contracts lib/openzeppelin-contracts
git clone --depth 1 https://github.com/smartcontractkit/chainlink-brownie-contracts lib/chainlink-brownie-contracts
```

Pins: **OpenZeppelin v5.6.0** (v5 constructor style — `Ownable(initialOwner)`) and **Chainlink VRF 2.5**
(`VRFConsumerBaseV2Plus` + `VRFV2PlusClient`). Remappings are in `foundry.toml`.

## Build & test

```bash
cd packages/contracts
forge build
forge test         # 17 tests across 5 suites, all passing
forge fmt --check  # formatting
```

## Notes

- `solc 0.8.24`, optimizer on, `evm_version = "cancun"` (Dencun is live on Base).
- `MapleToken.mint` is an unbounded owner mint **stub** — production must cap/vest emission behind a
  DAO/timelock, not an EOA.
- `VRFHandler` is intentionally swappable so a future VRF change can't brick immutable game contracts.
- This package is not a Node/pnpm workspace member (no `package.json`); it builds with Foundry only.
