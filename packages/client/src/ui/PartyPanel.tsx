import { useState } from "react";
import { Crown, MoreVertical, UserPlus, LogOut, Users } from "lucide-react";

import { Panel } from "@/ui/components/Panel";
import { EmptyState } from "@/ui/components/EmptyState";
import { ConfirmDialog } from "@/ui/components/ConfirmDialog";
import { Button } from "@/ui/components/ui/button";
import { Input } from "@/ui/components/ui/input";
import { Badge } from "@/ui/components/ui/badge";
import { Progress } from "@/ui/components/ui/progress";
import { Separator } from "@/ui/components/ui/separator";
import { ScrollArea } from "@/ui/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/ui/components/ui/avatar";
import { Tabs, TabsList, TabsTrigger } from "@/ui/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/components/ui/alert-dialog";
import { useUIStore, type PartyLootRule, type PartyMemberSnapshot } from "@/ui/store";

/**
 * PartyPanel — React port of the legacy Phaser party window (toggled with O).
 *
 * Follows the overlay reference (InventoryPanel): read the snapshot + action
 * registry from the bridge store, bail when closed, render with the shared kit
 * only, and drive the game exclusively through `actions.*`. The server is
 * authoritative — leadership, membership, and loot rules all round-trip through
 * Colyseus messages wired in `UIScene.registerSocialActions`.
 */

const LOOT_RULES: Array<{ key: PartyLootRule; label: string }> = [
  { key: "ffa", label: "Free-for-all" },
  { key: "roundRobin", label: "Round Robin" },
  { key: "leader", label: "Leader" },
];

const LOOT_RULE_LABEL: Record<PartyLootRule, string> = {
  ffa: "Free-for-all",
  roundRobin: "Round Robin",
  leader: "Leader",
};

function initials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

function MemberRow({
  member,
  isLeaderViewer,
  onKick,
}: {
  member: PartyMemberSnapshot;
  isLeaderViewer: boolean;
  onKick: (charId: string) => void;
}) {
  const hpPct = member.maxHp > 0 ? (member.hp / member.maxHp) * 100 : 0;
  const mpPct = member.maxMp > 0 ? (member.mp / member.maxMp) * 100 : 0;
  const canKick = isLeaderViewer && !member.leader;

  return (
    <div className="flex items-center gap-2.5 rounded-md px-1 py-1.5">
      <Avatar className="size-8">
        <AvatarFallback className={member.leader ? "bg-primary/20 text-primary" : undefined}>
          {initials(member.name)}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {member.leader && <Crown className="size-3 text-amber-400" />}
          <span
            className={
              "truncate text-xs font-semibold " +
              (member.dead ? "text-muted-foreground line-through" : "")
            }
          >
            {member.name}
          </span>
          <span className="text-[10px] text-muted-foreground">Lv.{member.level}</span>
          {member.mapId && (
            <span className="ml-auto truncate text-[10px] text-muted-foreground">
              {member.mapId}
            </span>
          )}
        </div>

        <div className="mt-1 space-y-0.5">
          <Progress
            value={hpPct}
            className="h-1.5 bg-red-950 [&>[data-slot=progress-indicator]]:bg-red-500"
          />
          <Progress
            value={mpPct}
            className="h-1.5 bg-blue-950 [&>[data-slot=progress-indicator]]:bg-blue-500"
          />
        </div>
      </div>

      {canKick && (
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
            <DropdownMenuItem variant="destructive" onClick={() => onKick(member.charId)}>
              Kick from party
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

export function PartyPanel() {
  const open = useUIStore((s) => s.partyOpen);
  const party = useUIStore((s) => s.party);
  const actions = useUIStore((s) => s.partyActions);
  const [inviteName, setInviteName] = useState("");
  const [confirmLeave, setConfirmLeave] = useState(false);

  if (!open) return null;

  const isLeaderViewer = party.members.some((m) => m.leader && m.charId === party.selfCharId);
  const inParty = party.members.length > 0;

  const submitInvite = () => {
    const name = inviteName.trim();
    if (!name) return;
    actions?.invite(name);
    setInviteName("");
  };

  return (
    <>
      <Panel
        title="Party"
        hotkey="O"
        onClose={() => actions?.close()}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[320px]"
        headerExtra={
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {party.members.length} / 6
          </span>
        }
      >
        <div className="flex items-center justify-between">
          <Badge variant="secondary" className="gap-1">
            <Users className="size-3" /> Party EXP +10%
          </Badge>
          {isLeaderViewer ? (
            <Tabs
              value={party.lootRule}
              onValueChange={(v) => actions?.setLootRule(v as PartyLootRule)}
            >
              <TabsList className="h-7">
                {LOOT_RULES.map((r) => (
                  <TabsTrigger key={r.key} value={r.key} className="px-2 text-[10px]">
                    {r.key === "ffa" ? "FFA" : r.key === "roundRobin" ? "RR" : "Leader"}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          ) : (
            <span className="text-[10px] text-muted-foreground">
              Loot: {LOOT_RULE_LABEL[party.lootRule]}
            </span>
          )}
        </div>

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

        <Separator className="my-3" />

        {inParty ? (
          <ScrollArea className="max-h-[260px] pr-2">
            <div className="space-y-1">
              {party.members.map((m) => (
                <MemberRow
                  key={m.charId}
                  member={m}
                  isLeaderViewer={isLeaderViewer}
                  onKick={(id) => actions?.kick(id)}
                />
              ))}
            </div>
          </ScrollArea>
        ) : (
          <EmptyState
            icon={Users}
            title="No party members"
            description="Invite someone to start a party."
          />
        )}

        {inParty && (
          <>
            <Separator className="my-3" />
            <Button
              variant="destructive"
              size="sm"
              className="w-full"
              onClick={() => setConfirmLeave(true)}
            >
              <LogOut className="size-3.5" /> Leave Party
            </Button>
          </>
        )}
      </Panel>

      <ConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title="Leave party?"
        description="You'll stop sharing EXP and loot with your party."
        confirmLabel="Leave"
        destructive
        onConfirm={() => {
          actions?.leave();
          setConfirmLeave(false);
        }}
      />

      <AlertDialog
        open={party.invite !== null}
        onOpenChange={(o) => {
          if (!o) actions?.declineInvite();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Party invite</AlertDialogTitle>
            <AlertDialogDescription>
              {party.invite?.fromName} invites you to join their party.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => actions?.declineInvite()}>Decline</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (party.invite) actions?.acceptInvite(party.invite.fromCharId);
              }}
            >
              Accept
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
