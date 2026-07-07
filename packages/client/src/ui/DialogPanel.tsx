import { ChevronRight, X } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/ui/components/ui/avatar";
import { Button } from "@/ui/components/ui/button";
import { Card } from "@/ui/components/ui/card";
import { useUIStore } from "@/ui/store";

// ── Portrait images (Vite-resolved URLs) ──────────────────────────────────────
import guideIris from "@/assets/npc/guide_iris.png";
import ferrymasterCole from "@/assets/npc/ferrymaster_cole.png";
import storageKeep from "@/assets/npc/storage_keep.png";
import elderWillow from "@/assets/npc/elder_willow.png";
import merchantBram from "@/assets/npc/merchant_bram.png";
import senseiTanren from "@/assets/npc/sensei_tanren.png";
import crystalKeeperLuna from "@/assets/npc/crystal_keeper_luna.png";
import genericPortrait from "@/assets/npc/portrait.png";

const NPC_PORTRAITS: Record<string, string> = {
  "npc.dawn_guide": guideIris,
  "npc.dawn_ferry": ferrymasterCole,
  "npc.dawn_storage": storageKeep,
  "npc.meadow_guide": elderWillow,
  "npc.meadow_shop": merchantBram,
  "npc.meadow_job": senseiTanren,
  "npc.meadow_cashshop": crystalKeeperLuna,
};

function npcPortrait(npcId: string): string {
  return NPC_PORTRAITS[npcId] ?? genericPortrait;
}

/**
 * DialogPanel — the MapleStory-style bottom-anchored NPC dialog box.
 *
 * React migration of the legacy hand-drawn Phaser dialog (UI.ts buildDialogBox /
 * updateDialogBox). Reads the dialog snapshot + action registry from the bridge
 * store and renders entirely from the shared kit (Card / Avatar / Button). Every
 * interaction flows through `dialogActions.*`, which `UIScene` wires to the
 * authoritative `DIALOG_CHOICE` message — the server walks the dialog tree and
 * fires the downstream effect (open shop, travel, advance job, …).
 */
export function DialogPanel() {
  const dialog = useUIStore((s) => s.dialog);
  const actions = useUIStore((s) => s.dialogActions);

  if (!dialog) return null;

  const initial = dialog.npcName.trim().charAt(0).toUpperCase() || "?";
  const hasChoices = dialog.choices !== null && dialog.choices.length > 0;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 flex flex-col items-center gap-2">
      {/* Branch choices stack above the dialog box (classic MapleStory layout). */}
      {hasChoices && (
        <div className="pointer-events-auto flex max-h-[300px] w-[520px] flex-col gap-2 overflow-y-auto">
          {dialog.choices!.map((choice) => (
            <Button
              key={choice.index}
              variant="secondary"
              className="h-auto w-full justify-start whitespace-normal py-2 text-left text-[13px]"
              onClick={() => actions?.choose(choice.index)}
            >
              {choice.label}
            </Button>
          ))}
        </div>
      )}

      <Card className="pointer-events-auto w-[520px] select-none gap-0 rounded-xl border-2 border-border bg-background/95 p-4 shadow-2xl backdrop-blur-sm">
        <div className="flex gap-4">
          {/* NPC portrait. */}
          <Avatar className="size-20 shrink-0 rounded-md border-2 border-sky-700/70">
            <AvatarImage src={npcPortrait(dialog.npcId)} alt={dialog.npcName} />
            <AvatarFallback className="rounded-md bg-sky-950 text-2xl font-bold text-sky-200">
              {initial}
            </AvatarFallback>
          </Avatar>

          <div className="flex min-w-0 flex-1 flex-col">
            <h2 className="text-[15px] font-bold text-amber-200">{dialog.npcName}</h2>
            <p className="mt-1.5 max-h-[200px] whitespace-pre-line text-[13px] leading-relaxed text-foreground overflow-y-auto">
              {dialog.text}
            </p>
          </div>
        </div>

        {/* Next / Close lives bottom-right when there are no branch choices. */}
        {!hasChoices && (
          <div className="mt-3 flex justify-end border-t border-border pt-3">
            {dialog.hasNext ? (
              <Button size="sm" onClick={() => actions?.next()}>
                Next
                <ChevronRight className="size-3.5" />
              </Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => actions?.close()}>
                Close
                <X className="size-3.5" />
              </Button>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
