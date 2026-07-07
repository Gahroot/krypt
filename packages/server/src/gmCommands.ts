/**
 * GM Command handler — server-validated admin tooling for the alpha.
 *
 * Every command is gated to accounts with `role === "admin"` (checked by the caller).
 * All commands execute server-authoritatively: the client never mutates state.
 *
 * Commands are text-based, parsed from a slash-prefixed string:
 *   /teleport <mapId>
 *   /teleport <playerName> <mapId>
 *   /spawn <mobId> [count]
 *   /boss <mobId>
 *   /give <itemId> [count]
 *   /give mesos <amount>
 *   /give exp <amount>
 *   /level <level>
 *   /killall
 *   /mute <playerName> [durationMinutes]
 *   /unmute <playerName>
 *   /kick <playerName>
 *   /ban <playerName> [reason]
 *   /unban <playerName>
 *   /heal [player]
 *   /summon <player>
 *   /god
 *   /noclip
 *   /announce <text>
 *   /help
 */
import type { Client } from "colyseus";
import { type TownState, type Player } from "./rooms/schema/index";
import { accountStore } from "./persistence/store";
import {
  getMobDef,
  getMap,
  MessageType,
  SP_PER_LEVEL,
  type ServerAnnouncementPayload,
} from "@maple/shared";
import { channelRegistry } from "./channelRegistry";
import { log } from "./logger";
import type { GmResultPayload } from "@maple/shared";
import { Mob } from "./rooms/schema/Mob";
import { InventoryItem } from "./rooms/schema/InventoryItem";

// ─── Invincibility tracking (module-level, avoids monkey-patching schema) ──
const _invinciblePlayers = new Set<string>();

// ─── Audit Log ──────────────────────────────────────────────────────────────

export interface GmAuditRecord {
  id: number;
  accountId: string;
  charName: string;
  command: string;
  targetPlayer: string;
  result: string;
  createdAt: number;
}

/** In-memory audit log. Persisted to DB on each write for durability. */
const auditLog: GmAuditRecord[] = [];
let auditSeq = 0;

/** Log a GM action to the audit log + DB. */
export function logGmAction(
  accountId: string,
  charName: string,
  command: string,
  targetPlayer: string,
  result: string,
): GmAuditRecord {
  const entry: GmAuditRecord = {
    id: ++auditSeq,
    accountId,
    charName,
    command,
    targetPlayer,
    result,
    createdAt: Date.now(),
  };
  auditLog.push(entry);
  // Keep only the last 500 entries in memory.
  if (auditLog.length > 500) auditLog.shift();
  log.info("gm_audit", {
    accountId,
    charName,
    command,
    targetPlayer,
    result,
  });
  return entry;
}

/** Get recent audit entries (for the admin endpoint). */
export function getAuditLog(limit = 50): GmAuditRecord[] {
  return auditLog.slice(-limit);
}

// ─── Command Router ──────────────────────────────────────────────────────────

export interface GmCommandContext {
  client: Client;
  room: { state: TownState; clients: Client[] };
  accountId: string;
  charName: string;
}

/**
 * Parse and execute a GM command string.
 * Returns a result message to send back to the client.
 */
export function handleGmCommand(ctx: GmCommandContext, raw: string): GmResultPayload {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) {
    return { success: false, message: "GM commands must start with '/'." };
  }

  // Split command into parts, preserving quoted strings.
  const parts = parseCommandParts(trimmed.slice(1)); // strip the leading /
  if (parts.length === 0) {
    return { success: false, message: "Empty command." };
  }

  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  try {
    const result = dispatchCommand(ctx, cmd, args);
    logGmAction(ctx.accountId, ctx.charName, trimmed, findTarget(args), result.message);
    return result;
  } catch (err) {
    const msg = `Command error: ${err instanceof Error ? err.message : String(err)}`;
    logGmAction(ctx.accountId, ctx.charName, trimmed, findTarget(args), msg);
    return { success: false, message: msg };
  }
}

/** Extract the likely target player name from args (first arg for most commands). */
function findTarget(args: string[]): string {
  return args[0] ?? "";
}

/** Parse a command string into parts, handling quoted strings. */
function parseCommandParts(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";

  for (const ch of input) {
    if (inQuote) {
      if (ch === quoteChar) {
        inQuote = false;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === " " || ch === "\t") {
      if (current.length > 0) {
        parts.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) parts.push(current);
  return parts;
}

// ─── Command Dispatch ────────────────────────────────────────────────────────

function dispatchCommand(ctx: GmCommandContext, cmd: string, args: string[]): GmResultPayload {
  switch (cmd) {
    case "help":
      return cmdHelp();
    case "teleport":
    case "tp":
      return cmdTeleport(ctx, args);
    case "summon":
      return cmdSummon(ctx, args);
    case "spawn":
      return cmdSpawn(ctx, args);
    case "boss":
      return cmdBoss(ctx, args);
    case "give":
      return cmdGive(ctx, args);
    case "level":
    case "lvl":
      return cmdLevel(ctx, args);
    case "heal":
      return cmdHeal(ctx, args);
    case "killall":
      return cmdKillAll(ctx);
    case "mute":
      return cmdMute(ctx, args);
    case "unmute":
      return cmdUnmute(ctx, args);
    case "kick":
      return cmdKick(ctx, args);
    case "ban":
      return cmdBan(ctx, args);
    case "unban":
      return cmdUnban(ctx, args);
    case "god":
      return cmdGod(ctx);
    case "noclip":
      return cmdNoclip(ctx);
    case "announce":
    case "shout":
      return cmdAnnounce(ctx, args);
    default:
      return { success: false, message: `Unknown command: /${cmd}. Type /help for a list.` };
  }
}

// ─── Command Implementations ─────────────────────────────────────────────────

function cmdHelp(): GmResultPayload {
  const help = [
    "GM Commands:",
    "  /tp <mapId>              — teleport self to map",
    "  /tp <player> <mapId>     — teleport player to map",
    "  /summon <player>         — teleport player to your location",
    "  /spawn <mobId> [count]   — spawn mob(s) at your position",
    "  /boss <mobId>            — spawn a boss",
    "  /give <itemId> [count]   — give item to self",
    "  /give mesos <amount>     — give mesos to self",
    "  /give exp <amount>       — give exp to self",
    "  /level <level>           — set your level",
    "  /heal [player]           — heal self (or named player) to full HP/MP",
    "  /killall                 — kill all mobs in the map",
    "  /mute <player> [mins]    — mute a player (default 30 min)",
    "  /unmute <player>         — unmute a player",
    "  /kick <player>           — kick a player",
    "  /ban <player> [reason]   — ban a player",
    "  /unban <player>          — unban a player",
    "  /god                     — toggle invincible",
    "  /noclip                  — toggle no-clip (debug: walk through terrain)",
    "  /announce <text>         — broadcast server announcement",
  ].join("\n");
  return { success: true, message: help };
}

function cmdTeleport(ctx: GmCommandContext, args: string[]): GmResultPayload {
  let targetPlayer: Player | undefined;
  let mapId: string;

  if (args.length >= 2) {
    // /tp <playerName> <mapId>
    const playerName = args[0];
    mapId = args[1];
    targetPlayer = findPlayerByName(ctx.room.state, playerName);
    if (!targetPlayer) {
      return { success: false, message: `Player "${playerName}" not found.` };
    }
  } else if (args.length === 1) {
    // /tp <mapId> — teleport self
    mapId = args[0];
    targetPlayer = ctx.room.state.players.get(ctx.client.sessionId);
    if (!targetPlayer) {
      return { success: false, message: "You are not in a valid player state." };
    }
  } else {
    return { success: false, message: "Usage: /tp <mapId> or /tp <player> <mapId>" };
  }

  const mapDef = getMap(mapId);
  if (!mapDef) {
    return { success: false, message: `Unknown map: "${mapId}".` };
  }

  const spawn = mapDef.playerSpawn;
  targetPlayer.x = spawn.x;
  targetPlayer.y = spawn.y;
  targetPlayer.vy = 0;
  targetPlayer.vx = 0;

  return {
    success: true,
    message: `Teleported ${targetPlayer.name} to ${mapId}.`,
  };
}

function cmdSpawn(ctx: GmCommandContext, args: string[]): GmResultPayload {
  if (args.length === 0) {
    return { success: false, message: "Usage: /spawn <mobId> [count]" };
  }

  const mobId = args[0];
  const count = args.length >= 2 ? Math.max(1, Math.min(50, parseInt(args[1], 10) || 1)) : 1;

  const def = getMobDef(mobId);
  if (!def) {
    return { success: false, message: `Unknown mob: "${mobId}".` };
  }

  const player = ctx.room.state.players.get(ctx.client.sessionId);
  if (!player) {
    return { success: false, message: "You are not in a valid player state." };
  }

  let spawned = 0;
  for (let i = 0; i < count; i++) {
    const mob = new Mob();
    mob.mobId = mobId;
    mob.hp = def.maxHp;
    mob.maxHp = def.maxHp;
    mob.x = player.x + (Math.random() - 0.5) * 100;
    mob.y = player.y;
    mob.vy = 0;
    mob.grounded = true;
    mob.attackCooldown = 0;
    ctx.room.state.mobs.set(`gm_spawn_${Date.now()}_${i}`, mob);
    spawned++;
  }

  return { success: true, message: `Spawned ${spawned} × ${mobId}.` };
}

function cmdBoss(ctx: GmCommandContext, args: string[]): GmResultPayload {
  if (args.length === 0) {
    return { success: false, message: "Usage: /boss <mobId>" };
  }

  const mobId = args[0];
  const def = getMobDef(mobId);
  if (!def) {
    return { success: false, message: `Unknown mob: "${mobId}".` };
  }

  const player = ctx.room.state.players.get(ctx.client.sessionId);
  if (!player) {
    return { success: false, message: "You are not in a valid player state." };
  }

  const mob = new Mob();
  mob.mobId = mobId;
  mob.hp = def.maxHp;
  mob.maxHp = def.maxHp;
  mob.x = player.x;
  mob.y = player.y;
  mob.vy = 0;
  mob.grounded = true;
  mob.attackCooldown = 0;
  ctx.room.state.mobs.set(`gm_boss_${Date.now()}`, mob);

  return { success: true, message: `Spawned boss: ${mobId} (${def.maxHp} HP).` };
}

function cmdGive(ctx: GmCommandContext, args: string[]): GmResultPayload {
  if (args.length === 0) {
    return {
      success: false,
      message: "Usage: /give <itemId> [count] or /give mesos <amount> or /give exp <amount>",
    };
  }

  const player = ctx.room.state.players.get(ctx.client.sessionId);
  if (!player) {
    return { success: false, message: "You are not in a valid player state." };
  }

  const sub = args[0].toLowerCase();

  // /give mesos <amount>
  if (sub === "mesos") {
    const amount = parseInt(args[1] ?? "", 10);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { success: false, message: "Usage: /give mesos <amount>" };
    }
    const capped = Math.min(amount, 100_000_000);
    player.mesos += capped;
    accountStore.setMesos(player.charId, player.mesos);
    return { success: true, message: `Gave ${capped} mesos. Balance: ${player.mesos}.` };
  }

  // /give exp <amount>
  if (sub === "exp") {
    const amount = parseInt(args[1] ?? "", 10);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { success: false, message: "Usage: /give exp <amount>" };
    }
    const capped = Math.min(amount, 10_000_000);
    // Apply exp directly — simplified path (no level-up checks here for GM).
    player.exp += capped;
    accountStore.updateCharacter(player.charId, { exp: player.exp });
    return { success: true, message: `Gave ${capped} EXP. Total: ${player.exp}.` };
  }

  // /give <itemId> [count] — give an item
  const itemId = args[0];
  const count = args.length >= 2 ? Math.max(1, Math.min(100, parseInt(args[1], 10) || 1)) : 1;
  const uid = `gm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const item = new InventoryItem();
  item.uid = uid;
  item.defId = itemId;
  item.baseRank = "NORMAL";
  item.potentialTier = "NONE";
  item.lines = 0;
  item.minted = false;
  item.count = count;
  player.inventory.set(uid, item);
  accountStore.addItem(player.charId, {
    uid,
    defId: itemId,
    baseRank: "NORMAL",
    potentialTier: "NONE",
    lines: 0,
    minted: false,
    count,
  });
  return { success: true, message: `Gave ${count} × ${itemId} (uid: ${uid}).` };
}

function cmdLevel(ctx: GmCommandContext, args: string[]): GmResultPayload {
  if (args.length === 0) {
    return { success: false, message: "Usage: /level <level>" };
  }

  const targetLevel = parseInt(args[0], 10);
  if (!Number.isFinite(targetLevel) || targetLevel < 1 || targetLevel > 250) {
    return { success: false, message: "Level must be between 1 and 250." };
  }

  const player = ctx.room.state.players.get(ctx.client.sessionId);
  if (!player) {
    return { success: false, message: "You are not in a valid player state." };
  }

  player.level = targetLevel;
  player.exp = 0;
  player.ap = (targetLevel - 1) * 5; // standard AP allocation
  // SP only starts at level 10 (1st-job unlock). Levels 1-9 = Beginner, no SP.
  player.sp = targetLevel >= 10 ? (targetLevel - 9) * SP_PER_LEVEL : 0;
  accountStore.updateCharacter(player.charId, {
    level: targetLevel,
    exp: 0,
    ap: player.ap,
    sp: player.sp,
  });

  return {
    success: true,
    message: `Set level to ${targetLevel}. AP: ${player.ap}. SP: ${player.sp}.`,
  };
}

function cmdSummon(ctx: GmCommandContext, args: string[]): GmResultPayload {
  if (args.length === 0) {
    return { success: false, message: "Usage: /summon <player>" };
  }

  const playerName = args[0];
  const target = findPlayerByName(ctx.room.state, playerName);
  if (!target) {
    return { success: false, message: `Player "${playerName}" not found.` };
  }

  const gm = ctx.room.state.players.get(ctx.client.sessionId);
  if (!gm) {
    return { success: false, message: "You are not in a valid player state." };
  }

  target.x = gm.x;
  target.y = gm.y;
  target.vy = 0;
  target.vx = 0;

  return { success: true, message: `Summoned ${target.name} to your location.` };
}

function cmdHeal(ctx: GmCommandContext, args: string[]): GmResultPayload {
  // /heal — heal self
  // /heal <player> — heal named player
  if (args.length > 0) {
    const target = findPlayerByName(ctx.room.state, args[0]);
    if (!target) {
      return { success: false, message: `Player "${args[0]}" not found.` };
    }
    target.hp = target.maxHp;
    target.mp = target.maxMp;
    target.dead = false;
    return { success: true, message: `Healed ${target.name} to full HP/MP.` };
  }

  const player = ctx.room.state.players.get(ctx.client.sessionId);
  if (!player) {
    return { success: false, message: "You are not in a valid player state." };
  }
  player.hp = player.maxHp;
  player.mp = player.maxMp;
  player.dead = false;
  return { success: true, message: `Healed to full HP/MP. (${player.hp}/${player.maxHp} HP)` };
}

function cmdKillAll(ctx: GmCommandContext): GmResultPayload {
  const mobs = ctx.room.state.mobs;
  const count = mobs.size;
  mobs.clear();
  return { success: true, message: `Killed ${count} mobs.` };
}

function cmdMute(ctx: GmCommandContext, args: string[]): GmResultPayload {
  if (args.length === 0) {
    return { success: false, message: "Usage: /mute <player> [durationMinutes]" };
  }

  const playerName = args[0];
  const durationMin = args.length >= 2 ? Math.max(1, parseInt(args[1], 10) || 30) : 30;

  const target = findPlayerByName(ctx.room.state, playerName);
  if (!target) {
    return { success: false, message: `Player "${playerName}" not found.` };
  }

  const targetAccId = target.accountId;
  accountStore.setMuted(targetAccId, Date.now() + durationMin * 60_000);
  return { success: true, message: `Muted ${target.name} for ${durationMin} minutes.` };
}

function cmdUnmute(ctx: GmCommandContext, args: string[]): GmResultPayload {
  if (args.length === 0) {
    return { success: false, message: "Usage: /unmute <player>" };
  }

  const playerName = args[0];
  const target = findPlayerByName(ctx.room.state, playerName);
  if (!target) {
    return { success: false, message: `Player "${playerName}" not found.` };
  }

  accountStore.setMuted(target.accountId, null);
  return { success: true, message: `Unmuted ${target.name}.` };
}

function cmdKick(ctx: GmCommandContext, args: string[]): GmResultPayload {
  if (args.length === 0) {
    return { success: false, message: "Usage: /kick <player>" };
  }

  const playerName = args[0];
  const target = findPlayerByName(ctx.room.state, playerName);
  if (!target) {
    return { success: false, message: `Player "${playerName}" not found.` };
  }

  // Find the actual client by matching sessionId from the player map.
  let kickedClient: Client | undefined;
  for (const c of ctx.room.clients) {
    const p = ctx.room.state.players.get(c.sessionId);
    if (p && p.name.toLowerCase() === playerName.toLowerCase()) {
      kickedClient = c;
      break;
    }
  }

  if (!kickedClient) {
    return { success: false, message: `Player "${playerName}" client not found.` };
  }

  kickedClient.send(MessageType.SERVER_ANNOUNCEMENT, {
    text: "You have been kicked by a GM.",
  } satisfies ServerAnnouncementPayload);
  try {
    kickedClient.leave();
  } catch {
    // Already disconnected.
  }

  return { success: true, message: `Kicked ${target.name}.` };
}

function cmdBan(ctx: GmCommandContext, args: string[]): GmResultPayload {
  if (args.length === 0) {
    return { success: false, message: "Usage: /ban <player> [reason]" };
  }

  const playerName = args[0];
  const reason = args.slice(1).join(" ") || "Banned by GM";

  const target = findPlayerByName(ctx.room.state, playerName);
  if (!target) {
    return { success: false, message: `Player "${playerName}" not found.` };
  }

  accountStore.setBanned(target.accountId, true, reason);

  // Kick the player if online.
  for (const c of ctx.room.clients) {
    const p = ctx.room.state.players.get(c.sessionId);
    if (p && p.name.toLowerCase() === playerName.toLowerCase()) {
      c.send(MessageType.SERVER_ANNOUNCEMENT, {
        text: `You have been banned: ${reason}`,
      } satisfies ServerAnnouncementPayload);
      try {
        c.leave();
      } catch {
        /* already gone */
      }
      break;
    }
  }

  return { success: true, message: `Banned ${target.name}: ${reason}` };
}

function cmdUnban(ctx: GmCommandContext, args: string[]): GmResultPayload {
  if (args.length === 0) {
    return { success: false, message: "Usage: /unban <playerName>" };
  }

  const playerName = args[0];
  // Look up by character name to find the accountId.
  const char = accountStore.getCharacterByName(playerName);
  if (!char) {
    return { success: false, message: `Character "${playerName}" not found in database.` };
  }

  accountStore.setBanned(char.accountId, false);
  return { success: true, message: `Unbanned ${playerName}.` };
}

function cmdGod(ctx: GmCommandContext): GmResultPayload {
  const player = ctx.room.state.players.get(ctx.client.sessionId);
  if (!player) {
    return { success: false, message: "You are not in a valid player state." };
  }

  // Toggle invincibility via module-level Set (avoids monkey-patching the schema).
  const sid = ctx.client.sessionId;
  const wasInvincible = _invinciblePlayers.has(sid);
  if (wasInvincible) {
    _invinciblePlayers.delete(sid);
    return { success: true, message: "Invincibility OFF." };
  }
  _invinciblePlayers.add(sid);
  player.hp = player.maxHp;
  return { success: true, message: "Invincibility ON. You are now a god." };
}

function cmdAnnounce(ctx: GmCommandContext, args: string[]): GmResultPayload {
  if (args.length === 0) {
    return { success: false, message: "Usage: /announce <text>" };
  }

  const text = args.join(" ");
  // Broadcast to ALL online players across all channels.
  const seen = new Set<string>();
  for (const [, info] of (
    channelRegistry as unknown as {
      players: Map<
        string,
        { sessionId: string; send: (type: number | string, data: unknown) => void }
      >;
    }
  ).players) {
    if (!seen.has(info.sessionId)) {
      seen.add(info.sessionId);
      info.send(MessageType.SERVER_ANNOUNCEMENT, { text } satisfies ServerAnnouncementPayload);
    }
  }

  return { success: true, message: `Announcement sent to ${seen.size} players: "${text}"` };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function findPlayerByName(state: TownState, name: string): Player | undefined {
  const lower = name.toLowerCase();
  for (const [, player] of state.players) {
    if (player.name.toLowerCase() === lower) return player;
  }
  return undefined;
}

function cmdNoclip(ctx: GmCommandContext): GmResultPayload {
  const sid = ctx.client.sessionId;
  const wasNoclipping = _noclipPlayers.has(sid);
  if (wasNoclipping) {
    _noclipPlayers.delete(sid);
    return { success: true, message: "No-clip OFF. Collision restored." };
  }
  _noclipPlayers.add(sid);
  return { success: true, message: "No-clip ON. You can now walk through terrain." };
}

// ─── Invincibility / noclip helpers ────────────────────────────────────────

/** Check if a player is currently invincible (GM /god toggle). */
export function isGmInvincible(sessionId: string): boolean {
  return _invinciblePlayers.has(sessionId);
}

/** Noclipping players (GM /noclip toggle) — bypasses terrain collision. */
const _noclipPlayers = new Set<string>();

/** Check if a player is currently noclip (GM /noclip toggle). */
export function isNoclipping(sessionId: string): boolean {
  return _noclipPlayers.has(sessionId);
}
