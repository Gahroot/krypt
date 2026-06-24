# CryptoMaple — Vision, Research & Plan

A 2D side-scroller MMORPG in the spirit of old-school MapleStory — deep classes, rich itemization, and a
sprawling world that's "a little bit of everything." A **player-owned free market** where rare gear is
tradeable for crypto is the bonus layer on top.

> **North Star: build a game that's too good to fail.** A genuinely great standalone MMORPG comes first.
> The crypto economy (un-killable market, provably-fair drops, true ownership) is a *bonus* that makes a
> good game better — never the reason to play. If it isn't fun without crypto, crypto won't save it.

> Status: Research & Brainstorm — Phase 0. This doc is the foundation. Read top-to-bottom, it's scannable.

---

## 0. Decisions Locked

| Decision | Choice | Why |
|---|---|---|
| **Chain** | **Base** (Ethereum L2) | Ethereum-aligned, cheap mints, growing game ecosystem |
| **Client engine** | **Phaser 3 (TypeScript)** | Browser-native 2D, zero WASM-export friction, JS-native wallet integration |
| **Server** | **Colyseus (TypeScript)** | Purpose-built authoritative real-time multiplayer (anti-cheat by design) |
| **Chain SDK** | **viem + wagmi** | TS-native, one language across game/server/chain |
| **Core game systems** | **Reimplement MapleStory's class / rarity-potential / AP-SP systems, reskinned** | Mechanics aren't copyrightable; only art + names + lore are. We rebuild the systems, replace the skin. |
| **Name** | TBD (working title only) | "CryptoMaple" is trademark-adjacent to MapleStory — original name before launch |
| **Priority** | **Game-first; crypto is a bonus** | "Too good to fail" standalone game. The earn layer is upside, not the hook. |
| **Funding** | **Bootstrapped** | Just us, lean. No outside round for now. |
| **Team** | **Solo (just us)** | Parity the proven design first; recruit + diverge into uniqueness once there's a team. |
| **Content strategy** | **Parity-then-diverge** | Clone MapleStory's structure/feel closely now (see `WORLD.md`); make it our own after we grow. |

**What MapleStory itself runs on (and why we don't touch it):** proprietary Wizet/Nexon C++ + DirectX
Windows client (circa 2002), assets packed in proprietary `.wz` binary archives. Outdated, Windows-only,
copyright-encumbered. Only takeaway: confirms the simple **2D sprite + tilemap** art approach.

---

## 1. The Thesis (TL;DR)

Old MapleStory had **two markets** that were a goldmine of player economy design:

1. **The Free Market (FM)** — physical rooms where players opened personal shops, priced in **Mesos** (earned in-game).
2. **The Maple Trading System (MTS)** — an auction house where players sold in-game gear for **NX Cash** (Nexon's real-money currency).

**Nexon killed the MTS "due to exploitation"** and was later **fined ~$9M** for secretly nerfing the odds
of "Cubes" (the gacha item that rerolls gear stats). Both failures are *centralization* failures:

- A marketplace they could shut down → they did.
- Hidden RNG odds they could rig → they did.

**Web3 fixes exactly this.** An on-chain marketplace can't be unilaterally closed. Drop/roll odds locked in
smart contracts + verifiable RNG = provably fair. Players truly *own* their god-roll gear as NFTs and can sell
it for a real token — no "item retrieval window," no rug.

**Pitch in one line:** *"The MapleStory free market you remember — but the marketplace lives on-chain, the
drop rates are provably fair, and the rare gear you grind is actually yours to sell."*

---

## 2. MapleStory Research — What Worked, What Failed

### The Free Market (FM) — ✅ Worked, beloved
- ~20+ rooms in a central hub. Players bought a **Store Permit** (cash-shop item) to open a personal shop.
- Named your shop, laid out items with **meso prices**, browsed room-to-room.
- **Why it mattered:** organic, social, emergent price discovery. It was a hangout, not just a UI.
- **Lesson:** the *social* aspect of trading is a feature, not a bug. Don't reduce it to a sterile search bar.

### The MTS (Maple Trading System) — ⚠️ Killed, the opportunity
- Auction house for *in-game gear* priced in **NX Cash** (real money).
- Tabs: **For Sale / Wanted / Auction (1–7 days) / My Page** (cart, offers, history).
- **Tax in NX:** buyer pays gross (Listing + tax), seller receives net. Tax = revenue sink.
- Players even used it as free storage.
- **Removed** from Global/SEA/Taiwan servers "due to exploitation." → *This is the gap we fill.*

### Rarity + Potential — the deep item economy (our NFT blueprint)
Gear had **two rarity layers** — this is what makes gear feel unique and tradeable:

| Layer | Shown by | Tiers |
|-------|----------|-------|
| **Base rank** (scrolling, star-force upgrades) | Item NAME color | gray → white → orange → blue → purple → yellow → green → red |
| **Potential** (random bonus stat lines) | Item BORDER color | Rare (blue) → Epic (purple) → Unique (gold) → Legendary (green) |

- **Cubes** reroll potential lines — the core gacha + monetization loop.
- A single god-roll Legendary piece became worth **thousands of dollars** on grey markets.
- Nexon was caught **secretly lowering cube success rates** → fined ~$9M (Korea FTC).

### Two currencies (the dual-economy model we copy)
- **Mesos** — earned by playing, soft currency, the FM currency.
- **NX Cash** — bought with real $, hard/premium currency, the MTS currency.
- Later: a **Meso Market** bridged them (mesos ↔ account-locked Maple Points).

---

## 2b. Systems We're Ripping & Reskinning

**Legal basis:** game *mechanics/systems* are not copyrightable; only the specific art, character names,
monster names, map names, and lore are. We reimplement the systems from scratch and replace the skin.
No MapleStory assets, names, or `.wz` files ever touch our codebase.

| System | What we copy (the mechanic) | What we change (the skin) |
|---|---|---|
| **Class system** | Job-advancement tree: base class → 2nd/3rd/4th job tiers, each unlocking new skills | New class names, new skill names/art, our own lore |
| **Rarity + Potential** | Two-layer model: base rank (upgrade path) + potential tier (rolled bonus stat lines) | New tier names/colors, our own stat pool |
| **AP system** | "Ability Points" — points gained on level-up, allocated to STR/DEX/INT/LUK + max HP/MP, with auto-assign | Possibly rename stats; keep the allocation feel |
| **SP system** | "Skill Points" — separate pool feeding the per-class skill tree, distinct from passive/ultimate tiers | New skill trees per reskinned class |
| **Cube reroll** | Spend currency to reroll potential stat lines (the gacha loop) | On-chain + VRF, **public immutable odds** (the anti-Nexon fix) |
| **Free Market** | Player-run personal shops in a social hub + global search | Our hub art; shops may be rentable NFTs |
| **MTS** | Auction house (For Sale / Wanted / Auction 1–7d / My Page), tax on listings | On-chain, un-killable, tax → treasury/burn |

**AP/SP reference (the exact mechanic we're cloning):** AP ("Ability Point") increases STR, DEX, INT, LUK,
and max HP/MP — ~5 AP granted per level-up with an auto-assign helper. SP (Skill Points) are a separate
pool spent on the class skill tree. Later tiers (Hyper Skills / Hyper Stats / V-Matrix) use their own point
pools and don't consume SP — we can adopt or drop those advanced tiers for MVP.

---

## 3. The Web3 Mapping

| MapleStory (then) | CryptoMaple (now) | Why it's better |
|---|---|---|
| MTS — shut down anytime | **On-chain NFT marketplace** | Can't be closed, trustless settlement |
| NX Cash (Nexon-issued) | **$MAPLE token** (on-chain, governance) | Player-owned, transparent supply |
| Mesos | **Mesos** (off-chain soft currency) | Fast, gasless gameplay loop |
| Rare gear (DB rows) | **NFTs** (ERC-1155 stackable / ERC-721 unique) | Real ownership, portable, sellable |
| Hidden cube odds (rigged) | **Provably-fair VRF** rolls in smart contracts | Auditable, can't be nerfed secretly |
| Store Permit shops | **Player-owned shops/spaces** (FM rooms) | Could themselves be ownable/rentable NFTs |
| NX tax to Nexon | **Protocol fee** → treasury / burn | Revenue to the community/DAO |

---

## 4. Game Concept

**Genre:** 2D side-scroller MMORPG (browser-first for crypto-native reach, client export later).

**Loop:** Grind mobs & bosses → gear drops with random rarity/potential → upgrade in town → sell surplus
on the **Soft Market (Mesos)** or, if it's rare enough, the **Premium Market ($MAPLE / crypto)**.

**Core pillars:**
1. **Simple, satisfying 2D action combat** — jump, attack, skills. MapleStory-simple = accessible = broad.
2. **Deep itemization** — the rarity + potential layering that makes each drop feel like a lottery ticket.
3. **A real economy** — two free markets that mirror FM + MTS. Trading is the endgame for many.
4. **True ownership** — rare gear = NFTs you actually hold and can sell for real value.

---

## 5. Dual-Market Design (the heart of it)

### Soft Market — "the Free Market"
- Currency: **Mesos** (off-chain, free, instant).
- All common/uncommon gear + consumables.
- Personal player shops (the FM-room social experience) + a global search board.
- Off-chain order book on our authoritative game server. Zero gas.

### Premium Market — "the MTS, but un-killable"
- Currency: **$MAPLE token** (+ accept stablecoin bridging).
- **Only designated "Premium" rarity+ gear (NFTs)** can list here — keeps gas/chain bloat sane.
- On-chain order book or gasless lazy-mint listings settled on-chain.
- **Listing tax in $MAPLE** (the old NX tax) → split between treasury + burn (deflationary sink).
- Auctions (1–7 day) + fixed-price + "Wanted" buy orders — directly port the MTS tabs.

> Design rule: **not everything is an NFT.** Only gear at/above a rarity threshold mints on-chain.
> Common drops stay off-chain Mesos-economy items. This protects UX and gas.

---

## 6. Rarity & Item (NFT) Design

Two-layer rarity, ported straight from MapleStory but on-chain:

- **Base Rank** (upgrade path): Normal → Enhanced → Star-forged → Mythic. Raised via in-game crafting/upgrades.
- **Potential Tier** (rolled at drop): Rare → Epic → Unique → **Legendary**.
- **Legendary+ auto-mints as NFT** at the moment of a confirmed boss drop (server-authoritative).
- Rerolling potential (the "Cube") = an on-chain action using $MAPLE + **Chainlink VRF** for the roll.
- **Odds are public, in the contract, and immutable.** (This is the direct answer to Nexon's $9M fine.)

NFT metadata: rank, potential tier, stat lines, origin (which boss/dungeon), mint date, upgrade history.
ERC-1155 for stackable materials/consumables; ERC-721 for unique equipment.

---

## 7. Tokenomics (first draft — needs pressure-testing)

**$MAPLE — utility + governance token (on-chain)**
- **Utility:** Premium Market currency, listing fees, potential-rerolls (Cubes), Store Permit / shop rental, cosmetics.
- **Sinks (deflationary):** % of every market fee burned or sent to treasury; Cube rolls consume $MAPLE.
- **Governance:** vote on new content, fee rates, rarity balance (replaces "Nexon decides in secret").
- **Distribution (illustrative — to finalize):** play-to-earn rewards (capped), liquidity, team (vested), DAO treasury. **Avoid pure Ponzi P2E** — see Risks.

**Mesos — off-chain soft currency**
- Earned by grinding, spent on upgrades/repairs/consumables. Standard MMO inflation sinks apply.

**Critical principle:** the token must have *real utility sinks* tied to gameplay, not just "number go up"
speculation. The market fee + Cube burn are the anchors.

---

## 8. Tech Architecture (proposed)

**Stack: TypeScript end-to-end** — one language across client, server, and chain. Small team moves fast.

```
┌─────────────────────────────────────────────────────┐
│  CLIENT — Phaser 3 (TypeScript), browser-native 2D   │
│  Wallet: viem + wagmi, account abstraction           │
│  (social login → smart wallet, export to self-custody)│
└───────────────┬─────────────────────────────────────┘
                │  Colyseus room state sync (WebSocket)
                │  (authoritative — client never trusted)
┌───────────────▼─────────────────────────────────────┐
│  GAME SERVER — Colyseus (TypeScript, Node)           │
│  - Combat, mesos, drops, FM soft-market order book   │
│  - Confirms boss kills → signs NFT-mint authorization │
└───────────────┬─────────────────────────────────────┘
                │  viem (server-side signer / indexer)
┌───────────────▼─────────────────────────────────────┐
│  BLOCKCHAIN — Base (Ethereum L2), Solidity/Foundry   │
│  - ERC-721 (unique gear) + ERC-1155 (stackables)     │
│  - $MAPLE token contract                              │
│  - On-chain Premium Market (NFT marketplace)         │
│  - Chainlink VRF for provably-fair rolls             │
└──────────────────────────────────────────────────────┘
```

Key choices & why:
- **Phaser 3 (TS)** — browser-native 2D side-scroller, no WASM-export friction, JS-native wallet libs drop straight in. (Chosen over Godot because MMO netcode + wallet integration are the deciding factors, and a unified TS stack wins both.)
- **Colyseus (TS)** — purpose-built authoritative real-time multiplayer; anti-cheat by design. The client can't mint gear or it'll be duped instantly. NFT mints are *server-signed* on confirmed gameplay events only.
- **Base (Ethereum L2)** — cheap mints/trades (mainnet gas would kill a gear economy), Ethereum-aligned, growing game ecosystem. Contracts in Solidity + Foundry.
- **Account abstraction** (social login → smart wallet) so non-crypto players are in-game in <30s; export to self-custody later. THE make-or-break UX decision for Web3 games.
- **Don't over-chain:** combat + mesos stay off-chain for speed. Only ownership + the premium market live on-chain.

---

## 9. Risks & Hard Truths (read this twice)

1. **"Web3 game" is a damaged brand.** Axie-style play-to-earn crashed because economies were speculative Ponzis, not games.
   → **De-risk: build a genuinely fun game first; crypto is the market layer, not the whole point.** If it's not fun without crypto, crypto won't save it.
2. **Authoritative server ≠ "decentralized game."** The game logic is centralized; only *ownership + the market* are decentralized. Be honest about this in the pitch. (It's still a massive improvement over Nexon.)
3. **Inflation will eat you alive** if mints/rewards aren't capped. Every reward needs a matching sink.
4. **Regulatory:** selling gear for crypto + a tradeable token can trip securities / money-transmitter rules depending on jurisdiction. **Get a Web3-gaming lawyer before launch, not after.**
5. **An MMO is enormous.** This is a multi-year, multi-person effort. The crypto angle is a *market differentiator*, not a shortcut around the work.

---

## 10. MVP Scope (the smallest thing that proves the idea)

Resist building the whole MMO. Ship this first:

- **One playable class**, basic 2D movement + attack + 1 skill.
- **One town hub** with the Free Market (Soft Market, Mesos) UI.
- **One dungeon + one boss** that drops gear with the two-layer rarity.
- **Gear ≥ "Legendary" potential mints as an NFT** (testnet first).
- **The Premium Market** — list/buy NFT gear for $MAPLE (testnet), with the tax-to-treasury flow.
- **One Cube/reroll action** using VRF so the "provably fair" claim is demonstrable.
- **Account-abstraction login** so a new player is in the game in <30 seconds.

That MVP alone is a compelling demo to your crypto contacts: *grind → get a real NFT → sell it on a fair market.*

---

## 11. Roadmap (rough phases)

- **Phase 0 — Now:** This doc. Align on scope, pick the L2 + engine, validate tokenomics with a token-engineering review.
- **Phase 1 — Prototype (weeks):** Single-room client + server, fake mesos, one mob dropping off-chain items. Prove the feel.
- **Phase 2 — On-chain items (weeks–months):** NFT contracts, VRF Cube, mint-on-boss-kill, testnet Premium Market.
- **Phase 3 — Closed alpha:** Real combat, the FM, the Premium Market together. Friends + your crypto contacts.
- **Phase 4 — Open beta + TGE:** Token launch, mainnet market, more content. (Lawyer checkpoint before this.)
- **Phase 5 — Live ops:** Seasons, new bosses/classes, DAO governance of balance.

---

## 12. Open Questions for You (decide these next)

- ~~**Engine**~~ → **LOCKED: Phaser 3 + Colyseus (TypeScript).**
- ~~**Chain**~~ → **LOCKED: Base (Ethereum L2).**
- ~~**Funding**~~ → **LOCKED: Bootstrapped, just us.**
- ~~**Team**~~ → **LOCKED: Solo to start; recruit + diverge later.**
- ~~**Emission**~~ → **LOCKED: conservative; earn is a bonus, not the hook.**
- ~~**Setting vibe**~~ → **LOCKED: parity MapleStory's "calm start → a little bit of everything" (see `WORLD.md`).**
1. **Name/brand:** working title only — need an original name (current placeholder is trademark-adjacent to MapleStory). Affects repo/package naming when we scaffold.
2. **MVP slice:** confirm we build the *calm starter* first — pastoral starter town + one melee class (the MapleStory Henesys/Warrior equivalent). It's the lowest-risk, most-iconic vertical slice.

---

*Next action: scaffold the Phase-1 prototype repo — Phaser client + Colyseus server monorepo, one starter town, one mob, fake mesos. Say go and I'll build it.*
