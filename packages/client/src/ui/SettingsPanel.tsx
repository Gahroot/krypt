import { useEffect, useState } from "react";
import {
  Volume2,
  Music,
  Zap,
  RotateCcw,
  Keyboard,
  Plus,
  X,
  Swords,
  FlaskConical,
  LogOut,
} from "lucide-react";
import {
  type ActionId,
  ACTION_LABELS,
  CONSUMABLES,
  allSkillsForClass,
  ClassArchetype,
  type SkillMacro,
  type MacroStep,
} from "@maple/shared";

import { keyBindFromEventCode } from "@/keybindings";
import { VERSION_LABEL } from "@/version";
import { DraggableWindow } from "@/ui/components/DraggableWindow";
import { Button } from "@/ui/components/ui/button";
import { Switch } from "@/ui/components/ui/switch";
import { Slider } from "@/ui/components/ui/slider";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/ui/components/ui/dialog";
import { Separator } from "@/ui/components/ui/separator";
import { useUIStore, type SettingsToggleKey } from "@/ui/store";

/**
 * SettingsPanel — React port of the legacy Phaser `SettingsUI` scene.
 *
 * Follows the overlay reference (InventoryPanel): read the snapshot + action
 * registry from the bridge store, bail when closed, render with the shared kit
 * only, and drive the game exclusively through `actions.*`. Keybindings are
 * rendered/rebound through `../keybindings.ts` (the single source of truth) via
 * the `rebind`/`resetKey`/`resetDefaults` actions — no binding logic here.
 */

// ─── Controls grouping (display only — mirrors the legacy layout) ───────────

interface ControlSection {
  label: string;
  actions: ActionId[];
}

const CONTROL_SECTIONS: ControlSection[] = [
  { label: "Movement", actions: ["moveLeft", "moveRight", "moveUp", "moveDown"] },
  { label: "Combat", actions: ["attack", "jump", "jumpAlt", "interact", "npcInteract"] },
  {
    label: "Quick Slots",
    actions: [
      "quickslot1",
      "quickslot2",
      "quickslot3",
      "quickslot4",
      "quickslot5",
      "quickslot6",
      "quickslot7",
      "quickslot8",
      "quickslot9",
      "quickslot10",
    ],
  },
  {
    label: "UI Panels",
    actions: [
      "openInventory",
      "openSkills",
      "openStats",
      "openQuests",
      "openMap",
      "openChat",
      "openMarket",
      "openCashShop",
      "openGuild",
      "openParty",
      "openFriends",
      "openCube",
      "openUpgrade",
    ],
  },
  {
    label: "Combat QoL",
    actions: ["lootAll", "macro1", "macro2", "macro3", "macro4", "macro5"],
  },
];

const SCALE_OPTIONS = [
  { value: "0.8", label: "80%" },
  { value: "1", label: "100%" },
  { value: "1.2", label: "120%" },
  { value: "1.5", label: "150%" },
];
const FPS_OPTIONS = [
  { value: "30", label: "30" },
  { value: "60", label: "60" },
  { value: "120", label: "120" },
  { value: "0", label: "Unlimited" },
];

const HP_POTIONS = [
  { id: "pot.small_hp", label: "Minor (50 HP)" },
  { id: "pot.large_hp", label: "Greater (150 HP)" },
  { id: "pot.hp_percent", label: "% HP (30%)" },
];
const MP_POTIONS = [
  { id: "pot.small_mp", label: "Minor (30 MP)" },
  { id: "pot.large_mp", label: "Greater (100 MP)" },
];

// ─── Small layout helpers (composition, not bespoke widgets) ────────────────

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3 py-1">
      <div className="flex flex-col">
        <span className="text-sm">{label}</span>
        {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mt-3 mb-1 text-[11px] font-bold tracking-wide text-primary uppercase first:mt-0">
      {children}
    </h3>
  );
}

// ─── Keybinding capture row (button + press-to-rebind dialog) ───────────────

function KeybindRow({ action, display }: { action: ActionId; display: string }) {
  const actions = useUIStore((s) => s.settingsActions);
  const [open, setOpen] = useState(false);

  // While the capture dialog is open, swallow every keydown in the capture
  // phase so the press reaches neither Phaser nor the rest of the document.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === "Escape") {
        setOpen(false);
        return;
      }
      const key = keyBindFromEventCode(e.code);
      if (!key) return;
      actions?.rebind(action, key);
      setOpen(false);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [open, action, actions]);

  return (
    <Row label={ACTION_LABELS[action]}>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 min-w-[92px] font-mono text-xs">
            {display || "—"}
          </Button>
        </DialogTrigger>
        <DialogContent showCloseButton={false} className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Keyboard className="size-4" />
              Rebind “{ACTION_LABELS[action]}”
            </DialogTitle>
            <DialogDescription>Press any key to bind it. Press Esc to cancel.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                actions?.resetKey(action);
                setOpen(false);
              }}
            >
              <RotateCcw className="size-3.5" />
              Reset to default
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label={`Reset ${ACTION_LABELS[action]} to default`}
        onClick={() => actions?.resetKey(action)}
      >
        <RotateCcw className="size-3.5" />
      </Button>
    </Row>
  );
}

// ─── Volume slider row ──────────────────────────────────────────────────────

function VolumeRow({
  label,
  icon,
  channel,
  value,
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  channel: "master" | "bgm" | "sfx";
  value: number;
  disabled?: boolean;
}) {
  const actions = useUIStore((s) => s.settingsActions);
  return (
    <Row label={label}>
      <span className="text-muted-foreground">{icon}</span>
      <Slider
        className="w-40"
        min={0}
        max={100}
        step={1}
        disabled={disabled}
        value={[Math.round(value * 100)]}
        onValueChange={([v]) => actions?.setVolume(channel, (v ?? 0) / 100)}
      />
      <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">
        {Math.round(value * 100)}%
      </span>
    </Row>
  );
}

// ─── Auto-pot threshold slider ──────────────────────────────────────────────

function ThresholdRow({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <Row label={label}>
      <Slider
        className="w-40"
        min={0}
        max={100}
        step={1}
        disabled={disabled}
        value={[value]}
        onValueChange={([v]) => onChange(v ?? 0)}
      />
      <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">{value}%</span>
    </Row>
  );
}

// ─── Macro editor ───────────────────────────────────────────────────────────

function MacroEditor() {
  const macros = useUIStore((s) => s.settings.macros);
  const archetype = useUIStore((s) => s.settings.archetype);
  const actions = useUIStore((s) => s.settingsActions);

  let skillOptions: { id: string; name: string }[] = [];
  try {
    skillOptions = allSkillsForClass(archetype as ClassArchetype).map((s) => ({
      id: s.id,
      name: s.name,
    }));
  } catch {
    /* unknown archetype — no skills */
  }
  const skillIds = new Set(skillOptions.map((s) => s.id));
  const consumableOptions = Object.values(CONSUMABLES).filter(
    (c) => c.effect.kind === "heal" || c.effect.kind === "buff",
  );

  const commit = (next: SkillMacro[]) => actions?.setMacros(next);

  const stepLabel = (step: MacroStep): string => {
    if (step.type === "skill") {
      return skillOptions.find((s) => s.id === step.id)?.name ?? step.id;
    }
    return CONSUMABLES[step.id]?.name ?? step.id;
  };

  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 5 }, (_, i) => {
        const macro = macros[i];
        if (!macro) {
          return (
            <div
              key={i}
              className="flex items-center justify-between rounded-md border border-border border-dashed px-3 py-2"
            >
              <span className="text-xs text-muted-foreground">Macro {i + 1}</span>
              <Button
                variant="outline"
                size="sm"
                className="h-7"
                disabled={skillOptions.length === 0 && consumableOptions.length === 0}
                onClick={() =>
                  // Append densely so the macro array never has holes (it is
                  // serialized to the server verbatim).
                  commit([
                    ...macros,
                    {
                      id: `macro_${Date.now()}_${macros.length}`,
                      name: `Macro ${macros.length + 1}`,
                      steps: [],
                    },
                  ])
                }
              >
                <Plus className="size-3.5" /> New
              </Button>
            </div>
          );
        }

        const setMacro = (m: SkillMacro) => {
          const next = [...macros];
          next[i] = m;
          commit(next);
        };

        return (
          <div
            key={macro.id}
            className="flex flex-col gap-2 rounded-md border border-border px-3 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{macro.name}</span>
              <span className="text-[10px] text-muted-foreground">
                {macro.steps.length} step{macro.steps.length === 1 ? "" : "s"}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={`Delete ${macro.name}`}
                onClick={() => {
                  const next = macros.filter((_, idx) => idx !== i);
                  commit(next);
                }}
              >
                <X className="size-3.5" />
              </Button>
            </div>

            {macro.steps.length > 0 && (
              <div className="flex flex-col gap-1">
                {macro.steps.map((step, s) => (
                  <div
                    key={`${step.type}:${step.id}:${s}`}
                    className="flex items-center justify-between gap-2 rounded bg-muted/40 px-2 py-1"
                  >
                    <span className="flex items-center gap-1.5 text-xs">
                      {step.type === "skill" ? (
                        <Swords className="size-3" />
                      ) : (
                        <FlaskConical className="size-3" />
                      )}
                      {s + 1}. {stepLabel(step)}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      aria-label="Remove step"
                      onClick={() =>
                        setMacro({
                          ...macro,
                          steps: macro.steps.filter((_, idx) => idx !== s),
                        })
                      }
                    >
                      <X className="size-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {macro.steps.length < 10 && (
              <Select
                value=""
                onValueChange={(v) => {
                  // Value is `${type}:${id}`; the id is the source of truth for
                  // the step type (skillIds), so we only need the suffix.
                  const id = v.slice(v.indexOf(":") + 1);
                  setMacro({
                    ...macro,
                    steps: [
                      ...macro.steps,
                      { type: skillIds.has(id) ? "skill" : "consumable", id },
                    ],
                  });
                }}
              >
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue placeholder="+ Add step…" />
                </SelectTrigger>
                <SelectContent>
                  {skillOptions.map((s) => (
                    <SelectItem key={`skill:${s.id}`} value={`skill:${s.id}`}>
                      <Swords className="size-3" /> {s.name}
                    </SelectItem>
                  ))}
                  {consumableOptions.map((c) => (
                    <SelectItem key={`consumable:${c.id}`} value={`consumable:${c.id}`}>
                      <FlaskConical className="size-3" /> {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Panel ───────────────────────────────────────────────────────────────────

export function SettingsPanel() {
  const open = useUIStore((s) => s.settingsOpen);
  const settings = useUIStore((s) => s.settings);
  const actions = useUIStore((s) => s.settingsActions);

  if (!open) return null;

  const { video, audio, gameplay, keyDisplays, autoPot } = settings;

  const toggle = (key: SettingsToggleKey, value: boolean) => actions?.toggle(key, value);

  return (
    <DraggableWindow
      title="⚙ Settings"
      hotkey="Esc"
      onClose={() => actions?.close()}
      defaultPosition={{ x: 410, y: 160 }}
    >
      <Tabs defaultValue="controls">
        <TabsList>
          <TabsTrigger value="controls">Controls</TabsTrigger>
          <TabsTrigger value="video">Video</TabsTrigger>
          <TabsTrigger value="audio">Audio</TabsTrigger>
          <TabsTrigger value="gameplay">Gameplay</TabsTrigger>
          <TabsTrigger value="combat">Combat QoL</TabsTrigger>
        </TabsList>

        <div className="mt-3 max-h-[58vh] overflow-y-auto pr-1">
          {/* ── Controls ── */}
          <TabsContent value="controls">
            {CONTROL_SECTIONS.map((section) => (
              <div key={section.label}>
                <SectionLabel>{section.label}</SectionLabel>
                {section.actions.map((action) => (
                  <KeybindRow key={action} action={action} display={keyDisplays[action] ?? ""} />
                ))}
              </div>
            ))}
            <Separator className="my-3" />
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => actions?.resetDefaults()}
            >
              <RotateCcw className="size-3.5" /> Reset All to Defaults
            </Button>
          </TabsContent>

          {/* ── Video ── */}
          <TabsContent value="video">
            <Row label="Fullscreen">
              <Switch
                checked={video.fullscreen}
                onCheckedChange={(v) => toggle("video.fullscreen", v)}
              />
            </Row>
            <Row label="UI Scale">
              <Select
                value={String(video.uiScale)}
                onValueChange={(v) => actions?.setVideoOption("uiScale", Number(v))}
              >
                <SelectTrigger size="sm" className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCALE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
            <Row label="FPS Cap">
              <Select
                value={String(video.fpsCap)}
                onValueChange={(v) => actions?.setVideoOption("fpsCap", Number(v))}
              >
                <SelectTrigger size="sm" className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FPS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
            <Row label="Damage Numbers">
              <Switch
                checked={video.showDamageNumbers}
                onCheckedChange={(v) => toggle("video.showDamageNumbers", v)}
              />
            </Row>
            <Row label="Screen Shake" hint="Camera kick on hits, crits & boss slams">
              <Switch
                checked={video.screenShake}
                onCheckedChange={(v) => toggle("video.screenShake", v)}
              />
            </Row>
          </TabsContent>

          {/* ── Audio ── */}
          <TabsContent value="audio">
            <Row label="Mute All">
              <Switch checked={audio.muted} onCheckedChange={(v) => toggle("audio.muted", v)} />
            </Row>
            <VolumeRow
              label="Master Volume"
              icon={<Volume2 className="size-4" />}
              channel="master"
              value={audio.masterVolume}
              disabled={audio.muted}
            />
            <VolumeRow
              label="BGM Volume"
              icon={<Music className="size-4" />}
              channel="bgm"
              value={audio.bgmVolume}
              disabled={audio.muted}
            />
            <VolumeRow
              label="SFX Volume"
              icon={<Zap className="size-4" />}
              channel="sfx"
              value={audio.sfxVolume}
              disabled={audio.muted}
            />
          </TabsContent>

          {/* ── Gameplay ── */}
          <TabsContent value="gameplay">
            <Row label="Show NPC Prompts">
              <Switch
                checked={gameplay.showNpcPrompts}
                onCheckedChange={(v) => toggle("gameplay.showNpcPrompts", v)}
              />
            </Row>
            <Row label="Show Minimap Names">
              <Switch
                checked={gameplay.showMinimapNames}
                onCheckedChange={(v) => toggle("gameplay.showMinimapNames", v)}
              />
            </Row>

            <Separator className="my-3" />
            <SectionLabel>Account</SectionLabel>
            <Button
              variant="destructive"
              size="sm"
              className="w-full"
              onClick={() => actions?.logout()}
            >
              <LogOut className="size-3.5" /> Log Out
            </Button>
          </TabsContent>

          {/* ── Combat QoL ── */}
          <TabsContent value="combat">
            <SectionLabel>Auto-Pot</SectionLabel>
            <Row label="HP Auto-Pot">
              <Switch
                checked={autoPot.hpEnabled}
                onCheckedChange={(v) => actions?.setAutoPot({ ...autoPot, hpEnabled: v })}
              />
            </Row>
            <ThresholdRow
              label="HP Threshold"
              value={autoPot.hpThreshold}
              disabled={!autoPot.hpEnabled}
              onChange={(v) => actions?.setAutoPot({ ...autoPot, hpThreshold: v })}
            />
            <Row label="HP Potion">
              <Select
                value={autoPot.hpPotionId}
                onValueChange={(v) => actions?.setAutoPot({ ...autoPot, hpPotionId: v })}
              >
                <SelectTrigger size="sm" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HP_POTIONS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>

            <Separator className="my-2" />

            <Row label="MP Auto-Pot">
              <Switch
                checked={autoPot.mpEnabled}
                onCheckedChange={(v) => actions?.setAutoPot({ ...autoPot, mpEnabled: v })}
              />
            </Row>
            <ThresholdRow
              label="MP Threshold"
              value={autoPot.mpThreshold}
              disabled={!autoPot.mpEnabled}
              onChange={(v) => actions?.setAutoPot({ ...autoPot, mpThreshold: v })}
            />
            <Row label="MP Potion">
              <Select
                value={autoPot.mpPotionId}
                onValueChange={(v) => actions?.setAutoPot({ ...autoPot, mpPotionId: v })}
              >
                <SelectTrigger size="sm" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MP_POTIONS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>

            <SectionLabel>Skill Macros</SectionLabel>
            <MacroEditor />
          </TabsContent>
        </div>
      </Tabs>

      {/* Build/protocol version — visible in-game so testers can quote it in bug reports. */}
      <div className="mt-2 border-t border-border pt-2 text-center text-[10px] text-muted-foreground select-text">
        {VERSION_LABEL}
      </div>
    </DraggableWindow>
  );
}
