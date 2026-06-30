# Audio Credits & Licenses

All audio shipped in CryptoMaple is open-licensed (CC0 or CC-BY). **No Nexon /
MapleStory audio is used.** Audio style/genre is not copyrightable — these are
original open-licensed works chosen to fit a 2D side-scroller MMORPG.

Files live under `packages/client/src/assets/audio/` and are loaded by
`packages/client/src/audio/AudioManager.ts` via howler.js.

Source files were transcoded to MP3 (BGM: 96 kbps stereo; SFX: 128 kbps mono)
for small, universally-supported web delivery. No edits were made beyond format
conversion / trimming.

---

## SFX (`sfx/`)

All SFX are **CC0 (Creative Commons Zero / public domain)** from
[Kenney](https://kenney.nl). Crediting Kenney is appreciated but not required.

| File                   | Cue (`SfxKey`)   | Source pack            | Original file                          | License |
| ---------------------- | ---------------- | ---------------------- | -------------------------------------- | ------- |
| `swing.mp3`            | `swing`          | Kenney RPG Audio       | `knifeSlice.ogg`                       | CC0     |
| `hit.mp3`              | `hit`            | Kenney Impact Sounds   | `impactMetal_light_000.ogg`            | CC0     |
| `crit.mp3`             | `crit`           | Kenney Impact Sounds   | `impactMetal_heavy_001.ogg`            | CC0     |
| `death.mp3`            | `death`          | Kenney Impact Sounds   | `impactSoft_heavy_001.ogg`             | CC0     |
| `skill.mp3`            | `skill`          | Kenney Interface Sounds| `confirmation_001.ogg`                 | CC0     |
| `levelup.mp3`          | `levelup`        | Kenney Music Jingles   | `8-Bit jingles/jingles_NES00.ogg`      | CC0     |
| `pickup.mp3`           | `pickup`         | Kenney RPG Audio       | `handleCoins.ogg`                      | CC0     |
| `loot_drop.mp3`        | `loot_drop`      | Kenney Interface Sounds| `drop_001.ogg`                         | CC0     |
| `legendary_drop.mp3`   | `legendary_drop` | Kenney Music Jingles   | `Pizzicato jingles/jingles_PIZZI07.ogg`| CC0     |
| `quest_complete.mp3`   | `quest_complete` | Kenney Music Jingles   | `Steel jingles/jingles_STEEL07.ogg`    | CC0     |
| `button_click.mp3`     | `button_click`   | Kenney Interface Sounds| `click_001.ogg`                        | CC0     |
| `portal.mp3`           | `portal`         | Kenney Interface Sounds| `maximize_004.ogg`                     | CC0     |
| `advancement.mp3`      | `advancement`    | Kenney Music Jingles   | `Sax jingles/jingles_SAX07.ogg`        | CC0     |
| `mob_hit_player.mp3`   | `mob_hit_player` | Kenney Impact Sounds   | `impactPunch_medium_000.ogg`           | CC0     |

**Kenney pack sources** (all CC0):

- Interface Sounds — https://kenney.nl/assets/interface-sounds
- RPG Audio — https://kenney.nl/assets/rpg-audio
- Impact Sounds — https://kenney.nl/assets/impact-sounds
- Music Jingles — https://kenney.nl/assets/music-jingles

---

## BGM (`bgm/`)

Per-region music themes keyed by `BgmKey`. Maps in `@maple/shared` `world.ts`
reference these via `bgmKey`.

| File          | Theme (`BgmKey`) | Title             | Author       | License    | Source |
| ------------- | ---------------- | ----------------- | ------------ | ---------- | ------ |
| `town.mp3`    | `town`           | Town Theme RPG    | cynicmusic   | CC0        | https://opengameart.org/content/town-theme-rpg |
| `field.mp3`   | `field`          | The Field Of Dreams | pauliuw    | CC0        | https://opengameart.org/content/the-field-of-dreams |
| `forest.mp3`  | `forest`         | Woodland Fantasy  | Matthew Pablo | CC-BY 3.0 | https://opengameart.org/content/woodland-fantasy |
| `dungeon.mp3` | `dungeon`        | Dungeon Ambience  | yd           | CC0        | https://opengameart.org/content/dungeon-ambience |
| `cave.mp3`    | `cave`           | Cave Theme        | HaelDB       | CC0        | https://opengameart.org/content/cave-theme |
| `sky.mp3`     | `sky`            | Calm Loop (Relaxing) | wipics    | CC0        | https://opengameart.org/content/calm-loop |
| `market.mp3`  | `market`         | Happy Loop        | wipics       | CC0        | https://opengameart.org/content/happy-loop |
| `boss.mp3`    | `boss`           | Battle Theme A    | cynicmusic   | CC0        | https://opengameart.org/content/battle-theme-a |

### Attribution-required tracks (CC-BY)

The following track requires attribution under its license; this notice
satisfies it:

- **"Woodland Fantasy"** by **Matthew Pablo** (https://www.matthewpablo.com),
  sourced from OpenGameArt, licensed **CC-BY 3.0**
  (https://creativecommons.org/licenses/by/3.0/). Used for the `forest` theme.

All other BGM tracks are **CC0** (public domain); attribution above is courtesy,
not required.
