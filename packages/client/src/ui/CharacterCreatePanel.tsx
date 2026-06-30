import { useState } from "react";
import { ArrowLeft, Check, Dices } from "lucide-react";
import {
  SKIN_TONES,
  HAIR_STYLES,
  HAIR_COLORS,
  FACE_STYLES,
  STARTER_OUTFITS,
  type CharacterAppearance,
  type Gender,
} from "@maple/shared";

import { Panel } from "@/ui/components/Panel";
import { PaperDoll } from "@/ui/components/PaperDoll";
import { Button } from "@/ui/components/ui/button";
import { Input } from "@/ui/components/ui/input";
import { Label } from "@/ui/components/ui/label";
import { Card, CardContent } from "@/ui/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/ui/select";
import { useUIStore } from "@/ui/store";

/**
 * CharacterCreatePanel — React port of the hand-drawn CharacterCreate scene.
 *
 * Follows the reference panel shape (see InventoryPanel.tsx): read the snapshot
 * + actions from the bridge store, bail when closed, render with the shared kit
 * only, and drive the flow exclusively through `actions.*`. The Phaser scene is
 * a thin controller that owns the authoritative appearance and connection.
 */

const MAX_NAME = 16;

interface FieldOption {
  id: string;
  label: string;
}

/** A labelled shadcn Select bound to one appearance field. */
function AppearanceSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly FieldOption[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} size="sm" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function genderOutfits(gender: Gender): FieldOption[] {
  return STARTER_OUTFITS.filter((o) => o.gender === gender || o.gender === "U").map((o) => ({
    id: o.id,
    label: o.label,
  }));
}

export function CharacterCreatePanel() {
  const open = useUIStore((s) => s.characterCreateOpen);
  const { appearance, error, sending } = useUIStore((s) => s.characterCreate);
  const actions = useUIStore((s) => s.characterCreateActions);
  const [name, setName] = useState("");

  if (!open) return null;

  const set = (field: keyof CharacterAppearance) => (value: string) =>
    actions?.setField(field, value);

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-background/85 backdrop-blur-sm">
      <Panel title="Create Character" className="w-[680px] max-w-[calc(100vw-2rem)] select-text">
        <div className="flex flex-col gap-4 md:flex-row">
          {/* ── Live paper-doll preview ── */}
          <Card className="shrink-0 gap-0 self-start py-4 md:w-[220px]">
            <CardContent className="flex flex-col items-center justify-center gap-2 px-4">
              <PaperDoll appearance={appearance} />
              <span className="text-sm font-bold text-primary">{name.trim() || "???"}</span>
            </CardContent>
          </Card>

          {/* ── Controls ── */}
          <div className="flex flex-1 flex-col gap-3">
            {/* Name */}
            <div className="grid gap-1.5">
              <Label htmlFor="cc-name">Name</Label>
              <Input
                id="cc-name"
                value={name}
                maxLength={MAX_NAME}
                placeholder="Enter name…"
                aria-invalid={!!error}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !sending) {
                    actions?.confirm(name, appearance);
                  }
                }}
              />
              <p
                className={`min-h-4 text-xs ${
                  error ? "text-destructive" : "text-muted-foreground"
                }`}
              >
                {error || `${name.length}/${MAX_NAME}`}
              </p>
            </div>

            {/* Gender — segmented control */}
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Gender</Label>
              <div className="grid grid-cols-2 gap-2">
                {(["M", "F"] as const).map((g) => (
                  <Button
                    key={g}
                    type="button"
                    size="sm"
                    variant={appearance.gender === g ? "default" : "outline"}
                    onClick={() => set("gender")(g)}
                  >
                    {g === "M" ? "Male" : "Female"}
                  </Button>
                ))}
              </div>
            </div>

            {/* Appearance categories */}
            <Tabs defaultValue="hair">
              <TabsList>
                <TabsTrigger value="skin">Skin</TabsTrigger>
                <TabsTrigger value="hair">Hair</TabsTrigger>
                <TabsTrigger value="face">Face</TabsTrigger>
                <TabsTrigger value="outfit">Outfit</TabsTrigger>
              </TabsList>

              <TabsContent value="skin" className="mt-3">
                <AppearanceSelect
                  id="cc-skin"
                  label="Skin Tone"
                  value={appearance.skinId}
                  options={SKIN_TONES}
                  onChange={set("skinId")}
                />
              </TabsContent>

              <TabsContent value="hair" className="mt-3 grid gap-3">
                <AppearanceSelect
                  id="cc-hair"
                  label="Hair Style"
                  value={appearance.hairId}
                  options={HAIR_STYLES}
                  onChange={set("hairId")}
                />
                <AppearanceSelect
                  id="cc-haircolor"
                  label="Hair Color"
                  value={appearance.hairColorId}
                  options={HAIR_COLORS}
                  onChange={set("hairColorId")}
                />
              </TabsContent>

              <TabsContent value="face" className="mt-3">
                <AppearanceSelect
                  id="cc-face"
                  label="Face"
                  value={appearance.faceId}
                  options={FACE_STYLES}
                  onChange={set("faceId")}
                />
              </TabsContent>

              <TabsContent value="outfit" className="mt-3">
                <AppearanceSelect
                  id="cc-outfit"
                  label="Outfit"
                  value={appearance.outfitId}
                  options={genderOutfits(appearance.gender)}
                  onChange={set("outfitId")}
                />
              </TabsContent>
            </Tabs>
          </div>
        </div>

        {/* ── Actions ── */}
        <div className="mt-4 flex items-center justify-center gap-3 border-t border-border pt-4">
          <Button
            type="button"
            variant="secondary"
            onClick={() => actions?.randomize()}
            disabled={sending}
          >
            <Dices /> Randomize
          </Button>
          <Button
            type="button"
            onClick={() => actions?.confirm(name, appearance)}
            disabled={sending}
          >
            <Check /> Confirm
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => actions?.back()}
            disabled={sending}
          >
            <ArrowLeft /> Back
          </Button>
        </div>
      </Panel>
    </div>
  );
}
