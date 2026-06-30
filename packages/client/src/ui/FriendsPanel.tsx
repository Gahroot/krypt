import { useState } from "react";
import { UserPlus, MessageSquare, UserMinus, Users } from "lucide-react";

import { Panel } from "@/ui/components/Panel";
import { EmptyState } from "@/ui/components/EmptyState";
import { Button } from "@/ui/components/ui/button";
import { Input } from "@/ui/components/ui/input";
import { Separator } from "@/ui/components/ui/separator";
import { ScrollArea } from "@/ui/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/ui/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/components/ui/dropdown-menu";
import { useUIStore, type FriendSnapshot } from "@/ui/store";

/**
 * FriendsPanel — React port of the legacy Phaser buddy list (toggled with F).
 *
 * Follows the overlay reference (InventoryPanel): read the snapshot + action
 * registry from the bridge store, bail when closed, render with the shared kit
 * only, and drive the game exclusively through `actions.*`. The per-friend
 * context menu (whisper / remove) is a Radix dropdown — no bespoke menu.
 */

function initials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

function FriendRow({
  friend,
  onWhisper,
  onRemove,
}: {
  friend: FriendSnapshot;
  onWhisper: (name: string) => void;
  onRemove: (name: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2.5 rounded-md px-1 py-1.5 text-left hover:bg-accent"
        >
          <Avatar className="size-8">
            <AvatarFallback
              className={friend.online ? "bg-green-500/20 text-green-400" : undefined}
            >
              {initials(friend.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span
                className={
                  "size-2 rounded-full " +
                  (friend.online ? "bg-green-500" : "bg-muted-foreground/40")
                }
              />
              <span
                className={
                  "truncate text-xs font-medium " + (friend.online ? "" : "text-muted-foreground")
                }
              >
                {friend.name}
              </span>
              <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
                Lv.{friend.level}
              </span>
            </div>
            <span className="text-[10px] text-muted-foreground">
              {friend.online ? (friend.mapId ?? "Online") : "Offline"}
            </span>
          </div>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={!friend.online} onClick={() => onWhisper(friend.name)}>
          <MessageSquare className="size-3.5" /> Whisper
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => onRemove(friend.name)}>
          <UserMinus className="size-3.5" /> Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function FriendsPanel() {
  const open = useUIStore((s) => s.friendsOpen);
  const friends = useUIStore((s) => s.friends.friends);
  const actions = useUIStore((s) => s.friendsActions);
  const [addName, setAddName] = useState("");

  if (!open) return null;

  const onlineCount = friends.filter((f) => f.online).length;
  const sorted = [...friends].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const submitAdd = () => {
    const name = addName.trim();
    if (!name) return;
    actions?.add(name);
    setAddName("");
  };

  return (
    <Panel
      title="Friends"
      hotkey="F"
      onClose={() => actions?.close()}
      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px]"
      headerExtra={
        <span className="text-[10px] tabular-nums text-green-400">{onlineCount} online</span>
      }
    >
      <div className="flex items-center gap-2">
        <Input
          value={addName}
          onChange={(e) => setAddName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitAdd();
          }}
          placeholder="Add by name…"
          maxLength={24}
          className="h-8 text-xs"
        />
        <Button size="sm" className="h-8" onClick={submitAdd}>
          <UserPlus className="size-3.5" /> Add
        </Button>
      </div>

      <Separator className="my-3" />

      {friends.length > 0 ? (
        <ScrollArea className="max-h-[280px] pr-2">
          <div className="space-y-1">
            {sorted.map((f) => (
              <FriendRow
                key={f.charId}
                friend={f}
                onWhisper={(name) => actions?.whisper(name)}
                onRemove={(name) => actions?.remove(name)}
              />
            ))}
          </div>
        </ScrollArea>
      ) : (
        <EmptyState
          icon={Users}
          title="No friends yet"
          description="Add someone by name to build your buddy list."
        />
      )}
    </Panel>
  );
}
