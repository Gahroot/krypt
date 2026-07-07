# Alpha Plan

What "alpha is working" means, how we learn from it, and when we ship to beta.

---

## 1 — Tester Targets

| Wave | Count | When | Who |
|------|-------|------|-----|
| **Internal** | 2–3 | Week 1 | Core dev + 1 trusted friend |
| **Wave 1** | 10–15 | Week 3–4 | Friends / ex-MapleStory players who can break things |
| **Wave 2** | 30–50 | Week 6–8 | Open invite via a short form (target gamers, not crypto tourists) |

**Hard cap: 50 concurrent players.** The server must stay stable at this ceiling before we call alpha done.

---

## 2 — Must-Work Core Loop

Every tester must be able to do this **start to finish without filing a blocker bug**:

1. **Login** → create account or reconnect a session
2. **Character create** → pick class, stat allocation, spawn in starter map
3. **Grind** → kill mobs, collect mesos + gear drops, see rarity + potential rolls
4. **Level** → gain EXP, allocate AP, unlock skills, feel the power curve
5. **2nd Job advancement** → reach Lv 30, talk to NPC, complete job quest, equip new skills
6. **Party** → invite a friend, share EXP, see party UI sync correctly
7. **Market / trade** → list an item for mesos, another player buys it, inventory updates for both

**If any step crashes or soft-locks for >2 testers, it's a P0 blocker.**

---

## 3 — Success Metrics

| Metric | Target | How to measure |
|--------|--------|----------------|
| **% reaching Lv 10** | ≥ 80% of testers | Server-side analytics / player table |
| **% reaching 2nd Job (Lv 30)** | ≥ 40% of testers | Same |
| **Avg session length** | ≥ 25 min | Session duration logs |
| **Crash-free sessions** | ≥ 95% | Client error boundary logs + server disconnects |
| **Dupe incidents** | **0** (hard gate) | Item/meso audit: total supply Δ must match expected drops |
| **Avg items listed on market** | ≥ 5 per active player | Market DB query |
| **Reported blockers** | ≤ 3 open at any time | `/admin/reports` |

---

## 4 — Daily Feedback-Triage Routine

**Every morning (or end of dev day):**

1. **Read `/admin/feedback`** — player-submitted feedback (bugs, suggestions, rage).
2. **Read `/admin/reports`** — crash reports, disconnect events, server errors.
3. **Check analytics** — player count, session lengths, level distribution, drop rates vs expected.
4. **Triaging:**
   - **P0** (crash / data loss / dupe): fix immediately, hot-redeploy.
   - **P1** (core loop broken for >1 player): fix same day, ship next deploy.
   - **P2** (UX annoyance / edge case): add to sprint, prioritize by frequency.
   - **P3** (nice-to-have / wishlist): log and ignore until beta.
5. **Write a 3-line daily log** in `docs/alpha-logs/YYYY-MM-DD.md`:
   - What shipped
   - Top bug / insight
   - What's next

---

## 5 — Alpha → Beta Exit Criteria

All of the following must be true for **7 consecutive days** before we open beta:

| # | Criterion |
|---|-----------|
| 1 | ≥ 50 concurrent players tested with **zero P0 bugs** open |
| 2 | Crash-free session rate **≥ 95%** sustained |
| 3 | Dupe incidents = **0** (audited) |
| 4 | ≥ 40% of testers reached **2nd Job** |
| 5 | ≥ 5 avg items listed per active player on market |
| 6 | Session length **≥ 25 min** average |
| 7 | All core loop steps (1–7 above) work **without intervention** |

**When all 7 are green for a week → ship beta.**

---

## 6 — Legal Baseline (Alpha)

Every new account (guest, email, or wallet) must accept a short Terms of Service / Privacy notice before entering the alpha. The notice covers:

- **Data collected:** email (if provided), wallet address (if linked), gameplay analytics, session data.
- **Alpha nature:** progress may be wiped between waves; no item or currency has real-money value.
- **Code of conduct:** no exploits, harassment, or real-money trading during alpha.

Acceptance is recorded server-side with a timestamp and version string on the `account_auth` table (migration `021_tos_acceptance`). The in-game HUD shows a persistent "Closed Alpha — Wipes possible · Test currency only" banner.

### ⚠️ Lawyer checkpoint before beta

Per [`PLANNING.md` Risk #4](../PLANNING.md#9-risks--hard-truths-read-this-twice) — selling gear for crypto + a tradeable token can trigger securities / money-transmitter rules depending on jurisdiction — **a Web3-gaming lawyer must review and approve before any of the following steps:**

1. Introducing a tradeable token ($MAPLE) or any real-money transaction.
2. Minting NFTs with transferable value.
3. Opening the market to non-alpha testers (open beta).
4. Any marketing that implies real-money earnings.

**This is a hard gate. Do not proceed to beta or token launch without legal sign-off.**

---

## 7 — What Alpha Is NOT

- **Not a demo.** Testers get a real build with real wipes between waves.
- **Not marketing.** No public social posts. Word-of-mouth only.
- **Not feature-complete.** 2nd job, party, and market are in. Bosses, pets, cash shop are beta+.

> **Alpha is working when 50 real players can grind, trade, and break things — and the server doesn't blink.**
