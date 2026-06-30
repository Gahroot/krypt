# Art credits & licenses

All in-game art in CryptoMaple is **open-licensed** and reused from pre-made asset packs.
**Zero Nexon / MapleStory assets are used.** Game art *style* and *genre* are not copyrightable;
we simply never ship anyone else's specific copyrighted assets.

The raw packs are not committed. The committed files under this folder are cropped/resized/
composited derivatives produced by [`../../scripts/build-assets.py`](../../scripts/build-assets.py).
Re-run that script (pointing `PPR` / `BG` at the extracted packs) to regenerate them.

## Sources

### Kenney — Platformer Pack Redux
- **License:** Creative Commons Zero (CC0 1.0 Universal — public domain dedication)
- **Author:** Kenney Vleugels — https://www.kenney.nl
- **Pack:** https://kenney.nl/assets/platformer-pack-redux
- **Mirror used:** https://opengameart.org/content/platformer-pack-redux-360-assets
- **Used for:**
  - `characters/*.png` — player characters (Kenney "alien" sprites, colourways green/blue/pink/beige/yellow); idle/walk/jump/climb/attack frames.
  - `mobs/slime_*.png` — green slime (`slimeGreen` + `slimeGreen_move`).
  - `mobs/hopper_*.png` — bee, used as the "Thornback Hopper" (`bee` + `bee_move`).
  - `tiles/grass_top.png`, `tiles/grass_center.png`, `tiles/dirt.png` — terrain tileset.
  - `tiles/ladder.png`, `tiles/ladder_top.png` — wooden ladder (`ladderMid` / `ladderTop`).
  - `tiles/rope.png` — rope/vine ladder (`chain`, hue-shifted green).
  - `items/gem.png`, `items/gem_legendary.png` — loot gems (`gemBlue` / `gemGreen`).
  - `npc/*.png` — townsfolk NPCs (alien `stand` poses; two are hue-shifted for variety) and the dialog portrait.

### Kenney — Background Elements Redux
- **License:** Creative Commons Zero (CC0 1.0 Universal — public domain dedication)
- **Author:** Kenney Vleugels — https://www.kenney.nl
- **Pack:** https://kenney.nl/assets/background-elements-redux
- **Mirror used:** https://opengameart.org/content/background-elements-redux
- **Used for:**
  - `bg/sky.png` — parallax far layer (gradient sky composited with Kenney `cloud*` sprites).
  - `bg/hills.png` — parallax mid layer (darkened `treeSmall_green*` treeline silhouette).
  - `bg/trees.png` — parallax near layer (`tree`, `treePine`, `treeLong`, `bush1`).

## Procedural (not from a pack)
- The soft elliptical **drop shadow** under sprites is generated at runtime in
  `src/art/textures.ts` (`generatePlaceholderTextures`). It is a plain FX primitive, not artwork.

## Attribution note
CC0 does **not require** attribution, but Kenney requests a credit where practical — hence this file.
"Credit: Kenney (www.kenney.nl)."
