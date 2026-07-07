# GM Command Reference

Server-validated admin tooling for the live alpha. All commands are executed
**server-authoritatively** — the client never mutates state.

## Access Control

| Role | Can use GM commands? |
| --- | --- |
| `admin` | ✅ Yes |
| `gm` | ✅ Yes |
| `player` | ❌ Rejected with "Access denied" |

The role gate is checked **server-side** on every `GM_COMMAND` message. The
client's `accountId` is resolved from the authenticated session — never trusted
from the message payload.

## Audit Trail

Every GM command is logged with:
- `accountId` — who ran it
- `charName` — character name
- `command` — the raw command string
- `targetPlayer` — first argument (if any)
- `result` — success/failure message
- `createdAt` — timestamp

Audit entries are kept in memory (last 500) and persisted via structured logging.
Retrieve recent entries via the `getAuditLog()` API or the admin endpoint.

## Commands

All commands are prefixed with `/` and sent as a `GM_COMMAND` message.

### Teleportation

| Command | Description |
| --- | --- |
| `/tp <mapId>` | Teleport **yourself** to a map's spawn point |
| `/tp <player> <mapId>` | Teleport a **named player** to a map's spawn point |
| `/summon <player>` | Teleport a **named player to your current location** |

**Examples:**
```
/tp meadowfield
/tp ShadowSlayer town_square
/summon ShadowSlayer
```

### Progression

| Command | Description |
| --- | --- |
| `/level <level>` | Set your level (1–250). Resets EXP to 0, recalculates AP |
| `/give exp <amount>` | Give EXP to yourself (capped at 10M per use) |
| `/give mesos <amount>` | Give mesos to yourself (capped at 100M per use) |
| `/give <itemId> [count]` | Give item(s) to yourself inventory (count: 1–100) |

**Examples:**
```
/level 50
/give exp 50000
/give mesos 1000000
/give sword_of_light 3
```

### Combat & Spawning

| Command | Description |
| --- | --- |
| `/spawn <mobId> [count]` | Spawn mob(s) at your position (count: 1–50, default 1) |
| `/boss <mobId>` | Spawn a single boss mob at your position |
| `/killall` | Kill all mobs on the current map |
| `/heal [player]` | Heal self (or named player) to full HP and MP |

**Examples:**
```
/spawn slime 10
/boss slime_boss
/killall
/heal
/heal ShadowSlayer
```

### Moderation

| Command | Description |
| --- | --- |
| `/mute <player> [minutes]` | Mute a player (default: 30 minutes) |
| `/unmute <player>` | Remove mute from a player |
| `/kick <player>` | Disconnect a player from the server |
| `/ban <player> [reason]` | Ban a player and disconnect them |
| `/unban <player>` | Remove a ban from a player |

**Examples:**
```
/mute TrollPlayer 60
/unmute TrollPlayer
/kick TrollPlayer
/bun TrollPlayer "Exploiting terrain glitch"
/unban TrollPlayer
```

### Debugging

| Command | Description |
| --- | --- |
| `/god` | Toggle **invincibility** — no damage from mobs or bosses |
| `/noclip` | Toggle **no-clip** — walk through terrain, walls, and void |

Both toggles are per-GM-session and tracked server-side. `/god` is checked in
the damage pipeline; `/noclip` bypasses gravity and foothold collision in the
movement tick.

**Examples:**
```
/god       # ON — you are invincible
/god       # OFF — normal damage
/noclip    # ON — fly through terrain
/noclip    # OFF — collision restored
```

### Announcements

| Command | Description |
| --- | --- |
| `/announce <text>` | Broadcast a server-wide announcement to all online players |

**Examples:**
```
/announce Server restarting in 5 minutes!
/announce Double XP event starts now!
```

### Utility

| Command | Description |
| --- | --- |
| `/help` | List all available GM commands |

### Full Command List

```
/tp <mapId>              — teleport self to map
/tp <player> <mapId>     — teleport player to map
/summon <player>         — teleport player to your location
/spawn <mobId> [count]   — spawn mob(s) at your position
/boss <mobId>            — spawn a boss
/give <itemId> [count]   — give item to self
/give mesos <amount>     — give mesos to self
/give exp <amount>       — give exp to self
/level <level>           — set your level
/heal [player]           — heal self (or named player) to full HP/MP
/killall                 — kill all mobs in the map
/mute <player> [mins]    — mute a player (default 30 min)
/unmute <player>         — unmute a player
/kick <player>           — kick a player
/ban <player> [reason]   — ban a player
/unban <player>          — unban a player
/god                     — toggle invincible
/noclip                  — toggle no-clip (debug: walk through terrain)
/announce <text>         — broadcast server announcement
```
