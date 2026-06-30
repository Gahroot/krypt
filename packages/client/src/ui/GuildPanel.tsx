import { useState } from "react";
import { Shield, Crown, Star, MoreVertical, UserPlus, LogOut, Trash2 } from "lucide-react";

import { Panel } from "@/ui/components/Panel";
import { EmptyState } from "@/ui/components/EmptyState";
import { ConfirmDialog } from "@/ui/components/ConfirmDialog";
import { Button } from "@/ui/components/ui/button";
import { Input } from "@/ui/components/ui/input";
import { Badge } from "@/ui/components/ui/badge";
import { Separator } from "@/ui/components/ui/separator";
import { ScrollArea } from "@/ui/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/components/ui/dropdown-menu";
import { useUIStore, type GuildRank, type GuildMemberSnapshot } from "@/ui/store";

/**
 * GuildPanel — React port of the legacy Phaser guild window (toggled with G).
 *
 * Follows the overlay reference (InventoryPanel): read the snapshot + action
 * registry from the bridge store, bail when closed, render with the shared kit
 * only, and drive the game exclusively through `actions.*`. When the player has
 * no guild it shows the create form; otherwise the roster + rank/management
 * controls (gated by the viewer's own rank). The server is authoritative.
 */

const GUILD_CREATE_COST = 50_000;
const RANK_ORDER: Record<GuildRank, number> = {
  master: 0,
  officer: 1,
  member: 2,
};

function RankIcon({ rank }: { rank: GuildRank }) {
  if (rank === "master") return <Crown className="size-3 text-amber-400" />;
  if (rank === "officer") return <Star className="size-3 text-sky-400" />;
  return null;
}

function MemberRow({
  member,
  viewerRank,
  selfCharId,
  onKick,
  onSetRank,
}: {
  member: GuildMemberSnapshot;
  viewerRank: GuildRank;
  selfCharId: string;
  onKick: (charId: string) => void;
  onSetRank: (charId: string, rank: GuildRank) => void;
}) {
  const isSelf = member.charId === selfCharId;
  const canManage = viewerRank === "master" || viewerRank === "officer";
  const canKick = canManage && !isSelf && member.rank !== "master";
  const canSetRank = viewerRank === "master" && !isSelf;
  const showMenu = canKick || canSetRank;

  return (
    <TableRow>
      <TableCell className="py-1.5">
        <div className="flex items-center gap-1.5">
          <span
            className={
              "size-2 rounded-full " + (member.online ? "bg-green-500" : "bg-muted-foreground/40")
            }
          />
          <span className={"text-xs font-medium " + (member.online ? "" : "text-muted-foreground")}>
            {member.name}
          </span>
        </div>
      </TableCell>
      <TableCell className="py-1.5 text-[10px] text-muted-foreground tabular-nums">
        Lv.{member.level}
      </TableCell>
      <TableCell className="py-1.5">
        <span className="flex items-center gap-1 text-[10px] capitalize text-muted-foreground">
          <RankIcon rank={member.rank} />
          {member.rank}
        </span>
      </TableCell>
      <TableCell className="py-1.5 text-right">
        {showMenu && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label={`Manage ${member.name}`}
              >
                <MoreVertical className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canSetRank && member.rank !== "officer" && (
                <DropdownMenuItem onClick={() => onSetRank(member.charId, "officer")}>
                  Promote to officer
                </DropdownMenuItem>
              )}
              {canSetRank && member.rank === "officer" && (
                <DropdownMenuItem onClick={() => onSetRank(member.charId, "member")}>
                  Demote to member
                </DropdownMenuItem>
              )}
              {canSetRank && canKick && <DropdownMenuSeparator />}
              {canKick && (
                <DropdownMenuItem variant="destructive" onClick={() => onKick(member.charId)}>
                  Kick from guild
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </TableCell>
    </TableRow>
  );
}

function CreateGuildForm({ onCreate }: { onCreate: (name: string) => void }) {
  const [name, setName] = useState("");
  const submit = () => {
    const n = name.trim();
    if (n.length < 2) return;
    onCreate(n);
    setName("");
  };
  return (
    <div className="space-y-3">
      <EmptyState
        icon={Shield}
        title="You're not in a guild"
        description="Found one to rally a roster across maps."
      />
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        placeholder="Guild name…"
        maxLength={20}
        className="h-8 text-xs"
      />
      <Button className="w-full" size="sm" disabled={name.trim().length < 2} onClick={submit}>
        Create Guild ({GUILD_CREATE_COST.toLocaleString()} mesos)
      </Button>
    </div>
  );
}

export function GuildPanel() {
  const open = useUIStore((s) => s.guildOpen);
  const guild = useUIStore((s) => s.guild);
  const actions = useUIStore((s) => s.guildActions);
  const [inviteName, setInviteName] = useState("");
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDisband, setConfirmDisband] = useState(false);

  if (!open) return null;

  const inGuild = guild.guildId !== "";
  const viewer = guild.members.find((m) => m.charId === guild.selfCharId);
  const viewerRank: GuildRank = viewer?.rank ?? "member";
  const canManage = viewerRank === "master" || viewerRank === "officer";
  const isMaster = viewerRank === "master";

  const sorted = [...guild.members].sort((a, b) => {
    const ra = RANK_ORDER[a.rank];
    const rb = RANK_ORDER[b.rank];
    if (ra !== rb) return ra - rb;
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const submitInvite = () => {
    const name = inviteName.trim();
    if (!name) return;
    actions?.invite(name);
    setInviteName("");
  };

  return (
    <>
      <Panel
        title="Guild"
        hotkey="G"
        onClose={() => actions?.close()}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[340px]"
        headerExtra={
          inGuild ? (
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {guild.members.length} members
            </span>
          ) : undefined
        }
      >
        {!inGuild ? (
          <CreateGuildForm onCreate={(n) => actions?.create(n)} />
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span
                className="inline-flex size-6 items-center justify-center rounded-md text-[10px] font-bold text-black"
                style={{ backgroundColor: guild.emblem.color }}
              >
                {guild.emblem.label}
              </span>
              <span className="truncate text-sm font-bold text-amber-300">{guild.guildName}</span>
              <Badge variant="secondary" className="ml-auto capitalize">
                {viewerRank}
              </Badge>
            </div>

            {canManage && (
              <>
                <Separator className="my-3" />
                <div className="flex items-center gap-2">
                  <Input
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitInvite();
                    }}
                    placeholder="Invite by name…"
                    maxLength={24}
                    className="h-8 text-xs"
                  />
                  <Button size="sm" className="h-8" onClick={submitInvite}>
                    <UserPlus className="size-3.5" /> Invite
                  </Button>
                </div>
              </>
            )}

            <Separator className="my-3" />

            <ScrollArea className="max-h-[240px] pr-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-7 text-[10px]">Member</TableHead>
                    <TableHead className="h-7 text-[10px]">Lv</TableHead>
                    <TableHead className="h-7 text-[10px]">Rank</TableHead>
                    <TableHead className="h-7" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((m) => (
                    <MemberRow
                      key={m.charId}
                      member={m}
                      viewerRank={viewerRank}
                      selfCharId={guild.selfCharId}
                      onKick={(id) => actions?.kick(id)}
                      onSetRank={(id, rank) => actions?.setRank(id, rank)}
                    />
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>

            <Separator className="my-3" />

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => setConfirmLeave(true)}
              >
                <LogOut className="size-3.5" /> Leave
              </Button>
              {isMaster && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="flex-1"
                  onClick={() => setConfirmDisband(true)}
                >
                  <Trash2 className="size-3.5" /> Disband
                </Button>
              )}
            </div>
          </>
        )}
      </Panel>

      <ConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title="Leave guild?"
        description={`You'll be removed from ${guild.guildName}.`}
        confirmLabel="Leave"
        destructive
        onConfirm={() => {
          actions?.leave();
          setConfirmLeave(false);
        }}
      />

      <ConfirmDialog
        open={confirmDisband}
        onOpenChange={setConfirmDisband}
        title="Disband guild?"
        description={`This permanently disbands ${guild.guildName} for every member.`}
        confirmLabel="Disband"
        destructive
        onConfirm={() => {
          actions?.disband();
          setConfirmDisband(false);
        }}
      />
    </>
  );
}
