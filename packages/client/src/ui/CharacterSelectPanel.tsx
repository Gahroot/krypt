import { useState } from "react";
import { Play, Plus, Trash2, UserRound } from "lucide-react";

import { Panel } from "@/ui/components/Panel";
import { Button } from "@/ui/components/ui/button";
import { Badge } from "@/ui/components/ui/badge";
import { Card, CardContent } from "@/ui/components/ui/card";
import { ScrollArea } from "@/ui/components/ui/scroll-area";
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
import { cn } from "@/ui/lib/utils";
import { useUIStore } from "@/ui/store";
import type { CharacterSelectEntry } from "@/ui/store";

/**
 * CharacterSelectPanel — the post-login roster screen.
 *
 * Reads the roster snapshot + action registry from the bridge store (pushed by
 * {@link CharacterSelectScene}) and renders from the shared kit. Enter / Create
 * / Delete all route through `characterSelectActions.*`; deleting requires a
 * confirmation step (AlertDialog) and the Create button is disabled once the
 * account reaches the server-enforced slot cap.
 */
export function CharacterSelectPanel() {
  const open = useUIStore((s) => s.characterSelectOpen);
  const { characters, max, loaded, error, busy } = useUIStore((s) => s.characterSelect);
  const actions = useUIStore((s) => s.characterSelectActions);

  // The character pending a delete confirmation (null = no dialog open).
  const [pendingDelete, setPendingDelete] = useState<CharacterSelectEntry | null>(null);
  // The currently highlighted row (defaults to the first character).
  const [selected, setSelected] = useState<string | null>(null);

  if (!open) return null;

  const atCap = max > 0 && characters.length >= max;
  // Resolve the highlighted row against the CURRENT roster so a stale selection
  // (e.g. after deleting the highlighted character) can never be entered.
  const activeId =
    characters.find((c) => c.charId === selected)?.charId ?? characters[0]?.charId ?? null;

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-background/85 backdrop-blur-sm">
      <Panel title="Select Character" className="w-[520px] max-w-[calc(100vw-2rem)]">
        <div className="flex flex-col gap-3">
          {/* Slot counter */}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Choose who to play</span>
            {max > 0 && (
              <span className="tabular-nums">
                {characters.length}/{max} slots
              </span>
            )}
          </div>

          {/* Roster */}
          {!loaded ? (
            <p className="px-2 py-10 text-center text-sm text-muted-foreground">
              Loading characters…
            </p>
          ) : characters.length === 0 ? (
            <p className="px-2 py-10 text-center text-sm text-muted-foreground">
              No characters yet. Create one to begin your adventure.
            </p>
          ) : (
            <ScrollArea className="max-h-[340px]">
              <div className="flex flex-col gap-2 pr-2">
                {characters.map((c) => {
                  const isActive = c.charId === activeId;
                  return (
                    <Card
                      key={c.charId}
                      onClick={() => setSelected(c.charId)}
                      onDoubleClick={() => !busy && actions?.enter(c.charId)}
                      className={cn(
                        "cursor-pointer gap-0 border py-0 transition-colors",
                        isActive
                          ? "border-primary/60 bg-primary/10"
                          : "hover:border-primary/30 hover:bg-muted/40",
                      )}
                    >
                      <CardContent className="flex items-center gap-3 px-3 py-2.5">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                          <UserRound className="size-5" />
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-sm font-bold text-foreground">
                            {c.name}
                          </span>
                          <span className="truncate text-xs text-muted-foreground">
                            {c.className} · {c.mapName}
                          </span>
                        </div>
                        <Badge variant="secondary" className="shrink-0 tabular-nums">
                          Lv {c.level}
                        </Badge>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={`Delete ${c.name}`}
                          disabled={busy}
                          onClick={(e) => {
                            e.stopPropagation();
                            setPendingDelete(c);
                          }}
                          className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </ScrollArea>
          )}

          {/* Error line */}
          <p className="min-h-4 text-xs text-destructive">{error}</p>

          {/* Actions */}
          <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => actions?.create()}
              disabled={busy || atCap}
              title={atCap ? "Character slots are full." : undefined}
            >
              <Plus /> Create
            </Button>
            <Button
              type="button"
              onClick={() => activeId && actions?.enter(activeId)}
              disabled={busy || !activeId}
            >
              <Play /> Enter World
            </Button>
          </div>
        </div>
      </Panel>

      {/* Delete confirmation */}
      <AlertDialog open={pendingDelete !== null} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {pendingDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes {pendingDelete?.name} (Lv {pendingDelete?.level}) and all of
              their progress. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (pendingDelete) actions?.remove(pendingDelete.charId);
                setPendingDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
