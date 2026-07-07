import { useEffect, useMemo, useRef, useState } from "react";
import { Send } from "lucide-react";

import { Tabs, TabsList, TabsTrigger } from "@/ui/components/ui/tabs";
import { ScrollArea } from "@/ui/components/ui/scroll-area";
import { Input } from "@/ui/components/ui/input";
import { Button } from "@/ui/components/ui/button";
import { cn } from "@/ui/lib/utils";
import { useUIStore, type ChatChannel } from "@/ui/store";

/**
 * ChatBox — the always-on chat panel ported from Phaser.
 *
 * Reads the message scrollback + channel list from the chat snapshot and drives
 * the game through `chatActions.send`. Uses a REAL DOM `<input>` because the
 * Phaser canvas can't focus-capture cleanly. Suppressing game keybinds while the
 * input is focused is handled centrally by the shared input-routing policy
 * (ui/inputFocus.ts), so this component does NOT wire its own onFocus/onBlur.
 * Only the interactive widgets (tabs, input, send button) opt back into pointer
 * events — the scrollback stays click-through except for its own scrolling.
 */

const CHANNEL_LABELS: Record<ChatChannel, string> = {
  map: "All",
  whisper: "Whisper",
  party: "Party",
  guild: "Guild",
};

const SCOPE_COLOR: Record<string, string> = {
  map: "text-slate-200",
  whisper: "text-fuchsia-400",
  party: "text-green-400",
  guild: "text-blue-400",
  system: "text-amber-400",
};

/** Short prefix tag shown before the sender name so scope is identifiable without color. */
const SCOPE_TAG: Record<string, string> = {
  whisper: "[W]",
  party: "[P]",
  guild: "[G]",
  system: "[S]",
};

export function ChatBox() {
  const messages = useUIStore((s) => s.chat.messages);
  const channels = useUIStore((s) => s.chat.channels);
  const actions = useUIStore((s) => s.chatActions);
  const focusNonce = useUIStore((s) => s.chatFocusNonce);
  const prefill = useUIStore((s) => s.chatPrefill);
  const toggleOn = useUIStore((s) => s.hud.hudToggles.chatBox);

  const [channel, setChannel] = useState<ChatChannel>("map");
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(
    () =>
      messages.filter((m) =>
        m.scope === "system" ? true : channel === "map" ? m.scope === "map" : m.scope === channel,
      ),
    [messages, channel],
  );

  // Auto-scroll to the newest line.
  useEffect(() => {
    const vp = viewportRef.current;
    if (vp) vp.scrollTop = vp.scrollHeight;
  }, [visible.length]);

  // Phaser (Enter / whisper shortcut) requests the input focus, optionally
  // seeding a draft (e.g. "/w Bob ").
  useEffect(() => {
    if (focusNonce === 0) return;
    if (prefill) setDraft(prefill);
    inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  const submit = () => {
    const text = draft.trim();
    if (text) actions?.send(channel, text);
    setDraft("");
  };

  if (!toggleOn) return null;

  return (
    <div className="absolute bottom-[88px] left-3 max-w-[min(320px,calc(100vw-6rem))] w-[320px] select-none rounded-lg border border-border bg-background/92 shadow-2xl">
      <Tabs value={channel} onValueChange={(v) => setChannel(v as ChatChannel)} className="gap-0">
        <TabsList className="pointer-events-auto h-7 rounded-b-none rounded-t-lg">
          {channels.map((c) => (
            <TabsTrigger key={c} value={c} className="text-[10px]">
              {CHANNEL_LABELS[c]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <ScrollArea className="h-[136px] px-2 py-1.5" viewportRef={viewportRef}>
        <div className="flex flex-col gap-0.5">
          {visible.map((m) => (
            <div key={m.id} className="text-[12px] leading-snug">
              <span className={cn("font-semibold", SCOPE_COLOR[m.scope])}>
                {SCOPE_TAG[m.scope] && (
                  <span className="mr-0.5 text-[10px] opacity-70">{SCOPE_TAG[m.scope]}</span>
                )}
                {m.name}
              </span>
              <span className="text-slate-300">: {m.text}</span>
            </div>
          ))}
        </div>
      </ScrollArea>

      <form
        className="flex items-center gap-1 border-t border-border p-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // ESC blurs the input (parity with the legacy Phaser chat), restoring game keybinds.
            if (e.key === "Escape") e.currentTarget.blur();
          }}
          placeholder={`Message (${CHANNEL_LABELS[channel]})`}
          maxLength={120}
          className="pointer-events-auto h-7 text-[12px]"
        />
        <Button
          type="submit"
          size="icon"
          variant="secondary"
          className="pointer-events-auto size-7 shrink-0"
          aria-label="Send message"
        >
          <Send className="size-3.5" />
        </Button>
      </form>
    </div>
  );
}
