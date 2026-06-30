import { Check, Users, Radio } from "lucide-react";

import { Badge } from "@/ui/components/ui/badge";
import { Button } from "@/ui/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/ui/components/ui/card";
import { ScrollArea } from "@/ui/components/ui/scroll-area";
import { cn } from "@/ui/lib/utils";
import { useUIStore } from "@/ui/store";

/**
 * ChannelSelectPanel — the channel picker overlay.
 *
 * React migration of the legacy hand-drawn Phaser `ChannelSelectScene`. Reads
 * the channel snapshot + action registry from the bridge store and renders from
 * the shared kit (Card / Button / Badge / ScrollArea). Picking a channel flows
 * through `channelSelectActions.join`, which the scene wires to the existing
 * registry → `CHANNEL_SWITCH` switch flow MapScene already drives.
 */
export function ChannelSelectPanel() {
  const open = useUIStore((s) => s.channelSelectOpen);
  const snapshot = useUIStore((s) => s.channelSelect);
  const actions = useUIStore((s) => s.channelSelectActions);

  if (!open) return null;

  const { channels, currentChannel, loaded } = snapshot;

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-black/55"
      onClick={() => actions?.close()}
    >
      <Card className="w-[340px] gap-0 py-0 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <CardHeader className="border-b px-5 py-3.5 [.border-b]:pb-3.5">
          <CardTitle className="flex items-center gap-2 text-base">
            <Radio className="size-4 text-primary" />
            Select Channel
          </CardTitle>
        </CardHeader>

        <CardContent className="px-3 py-3">
          {!loaded ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">Loading channels…</p>
          ) : channels.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              No channels available.
            </p>
          ) : (
            <ScrollArea className="max-h-[320px]">
              <div className="flex flex-col gap-1.5 pr-2">
                {channels.map((ch) => {
                  const isActive = ch.channel === currentChannel;
                  return (
                    <Button
                      key={ch.channel}
                      variant={isActive ? "secondary" : "outline"}
                      disabled={isActive}
                      onClick={() => actions?.join(ch.channel)}
                      className={cn(
                        "h-auto w-full justify-between px-3 py-2.5 disabled:opacity-100",
                        isActive && "border-primary/60 bg-primary/10 text-primary",
                      )}
                    >
                      <span className="flex items-center gap-2 text-sm font-medium tabular-nums">
                        {isActive && <Check className="size-3.5" />}
                        Ch {ch.channel + 1}
                      </span>
                      <Badge
                        variant={isActive ? "default" : "secondary"}
                        className="gap-1 tabular-nums"
                      >
                        <Users className="size-3" />
                        {ch.playerCount}
                      </Badge>
                    </Button>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>

        <CardFooter className="justify-end border-t px-5 py-3 [.border-t]:pt-3">
          <Button variant="ghost" size="sm" onClick={() => actions?.close()}>
            Cancel
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
