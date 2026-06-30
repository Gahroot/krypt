import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/ui/dialog";
import { Button } from "@/ui/components/ui/button";
import { Input } from "@/ui/components/ui/input";
import { useUIStore } from "@/ui/store";

/**
 * ReportDialog — the player-report modal, built on the shared dialog primitive.
 *
 * React port of the hand-drawn Phaser `buildReportDialog` / `renderReportDialog`.
 * Opened from the Phaser player context menu (pushes target name + open flag into
 * the bridge store); submitting flows through `reportActions.submit`, wired to the
 * authoritative PLAYER_REPORT message. Preserves the 200-char reason cap.
 */

const MAX_REASON = 200;

export function ReportDialog() {
  const open = useUIStore((s) => s.reportOpen);
  const targetName = useUIStore((s) => s.reportTargetName);
  const actions = useUIStore((s) => s.reportActions);
  const [reason, setReason] = useState("");

  const close = () => {
    setReason("");
    actions?.close();
  };

  const submit = () => {
    const trimmed = reason.trim();
    if (!trimmed) return;
    actions?.submit(trimmed);
    setReason("");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? close() : undefined)}>
      <DialogContent className="pointer-events-auto sm:max-w-[360px]">
        <DialogHeader>
          <DialogTitle>🚩 Report {targetName}</DialogTitle>
          <DialogDescription>Reason (cheating / harassment / spam / other):</DialogDescription>
        </DialogHeader>

        <Input
          autoFocus
          value={reason}
          maxLength={MAX_REASON}
          placeholder="Describe what happened…"
          onChange={(e) => setReason(e.target.value.slice(0, MAX_REASON))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />

        <DialogFooter>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!reason.trim()} onClick={submit}>
            Submit Report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
