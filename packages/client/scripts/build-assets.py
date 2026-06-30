#!/usr/bin/env python3
"""
Build CryptoMaple's game art from open-licensed (CC0) Kenney asset packs.

This is a one-off preprocessing step: it crops, resizes and composites the raw
Kenney source PNGs into the small, game-ready frames committed under
`packages/client/src/assets/`. The runtime never touches the raw packs — it
loads only the generated files (see src/scenes/Preload.ts).

Sources (both CC0 / public domain — see src/assets/CREDITS.md):
  * Kenney "Platformer Pack Redux"      -> player, mobs, tiles, ladder, gems
  * Kenney "Background Elements Redux"   -> parallax clouds / trees / bushes

Usage:
  PPR=/path/to/PlatformerPackRedux/PNG  BG=/path/to/BackgroundElementsRedux/PNG/Default \
      python3 build-assets.py

Re-run only when you want to regenerate art; the output is checked into git.
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFilter

PPR = os.environ.get("PPR", "/tmp/ppr/PNG")
BG = os.environ.get("BG", "/tmp/bgx/PNG/Default")
OUT = os.environ.get(
    "OUT",
    os.path.join(os.path.dirname(__file__), "..", "src", "assets"),
)
OUT = os.path.abspath(OUT)


def ensure_dir(p):
    os.makedirs(p, exist_ok=True)


def load(path):
    return Image.open(path).convert("RGBA")


def alpha_bbox(img):
    """Bounding box of non-transparent pixels."""
    return img.split()[3].getbbox()


def union_bbox(imgs):
    boxes = [alpha_bbox(i) for i in imgs if alpha_bbox(i)]
    if not boxes:
        return None
    l = min(b[0] for b in boxes)
    t = min(b[1] for b in boxes)
    r = max(b[2] for b in boxes)
    b = max(b[3] for b in boxes)
    return (l, t, r, b)


def alpha_bleed(img, iterations=6):
    """Bleed opaque RGB outward into transparent pixels so downscaling doesn't pull the
    (often white) RGB of fully-transparent source pixels into edges as a halo. Alpha is kept."""
    img = img.convert("RGBA")
    r, g, b, a = img.split()
    rgb = Image.merge("RGB", (r, g, b))
    mask = a.point(lambda v: 255 if v > 0 else 0)
    for _ in range(iterations):
        spread = rgb.filter(ImageFilter.GaussianBlur(2))
        # Keep original colour where already covered; fill the rest from the blurred spread.
        rgb = Image.composite(rgb, spread, mask)
        mask = mask.filter(ImageFilter.MaxFilter(3))
    nr, ng, nb = rgb.split()
    return Image.merge("RGBA", (nr, ng, nb, a))


def resize_to_h(img, target_h):
    img = alpha_bleed(img)
    w, h = img.size
    if h == 0:
        return img
    scale = target_h / h
    nw = max(1, round(w * scale))
    return img.resize((nw, target_h), Image.LANCZOS)


def hue_rotate(img, deg):
    """Rotate hue of the RGB channels, preserving alpha."""
    r, g, b, a = img.split()
    rgb = Image.merge("RGB", (r, g, b)).convert("HSV")
    h, s, v = rgb.split()
    h = h.point(lambda p: (p + int(deg / 360 * 255)) % 256)
    rgb = Image.merge("HSV", (h, s, v)).convert("RGB")
    nr, ng, nb = rgb.split()
    return Image.merge("RGBA", (nr, ng, nb, a))


def save(img, *parts):
    path = os.path.join(OUT, *parts)
    ensure_dir(os.path.dirname(path))
    img.save(path)
    print("  ->", os.path.relpath(path, OUT), img.size)


# ──────────────────────────────────────────────────────────────────────────
# Player characters (5 Kenney alien colors -> idle/walk/jump/climb/attack)
# ──────────────────────────────────────────────────────────────────────────
PLAYER_H = 52
COLORS = ["Green", "Blue", "Pink", "Beige", "Yellow"]
# Source poses we need, unioned for a consistent crop box so frames don't jitter.
POSES = ["stand", "walk1", "walk2", "jump", "climb1", "climb2", "hit"]


def build_players():
    print("players:")
    for color in COLORS:
        src_dir = os.path.join(PPR, "Players", "128x256", color)
        raw = {p: load(os.path.join(src_dir, f"alien{color}_{p}.png")) for p in POSES}
        box = union_bbox(list(raw.values()))
        cropped = {p: img.crop(box) for p, img in raw.items()}
        frames = {p: resize_to_h(img, PLAYER_H) for p, img in cropped.items()}
        # Map source poses -> canonical animation frame names.
        out = {
            "idle_0": "stand", "idle_1": "stand",
            "walk_0": "walk1", "walk_1": "walk2", "walk_2": "walk1", "walk_3": "walk2",
            "jump": "jump", "fall": "jump",
            "climb_0": "climb1", "climb_1": "climb2",
            "attack_0": "stand", "attack_1": "hit",
        }
        low = color.lower()
        for frame_name, pose in out.items():
            save(frames[pose], "characters", f"{low}_{frame_name}.png")


# ──────────────────────────────────────────────────────────────────────────
# Mobs (slime + bee "hopper")
# ──────────────────────────────────────────────────────────────────────────
def build_mob(name, src_idle, src_move, target_h, frame_count=4):
    a = load(os.path.join(PPR, "Enemies", src_idle))
    b = load(os.path.join(PPR, "Enemies", src_move))
    box = union_bbox([a, b])
    a, b = a.crop(box), b.crop(box)
    a, b = resize_to_h(a, target_h), resize_to_h(b, target_h)
    seq = [a, b, a, b][:frame_count]
    for i, frame in enumerate(seq):
        save(frame, "mobs", f"{name}_{i}.png")


def build_mobs():
    print("mobs:")
    build_mob("slime", "slimeGreen.png", "slimeGreen_move.png", 30)
    build_mob("hopper", "bee.png", "bee_move.png", 34)


# ──────────────────────────────────────────────────────────────────────────
# Loot gems
# ──────────────────────────────────────────────────────────────────────────
def build_items():
    print("items:")
    for src, name, h in [("gemBlue.png", "gem", 20), ("gemGreen.png", "gem_legendary", 22)]:
        img = load(os.path.join(PPR, "Items", src))
        box = alpha_bbox(img)
        img = img.crop(box)
        save(resize_to_h(img, h), "items", f"{name}.png")


# ──────────────────────────────────────────────────────────────────────────
# Terrain tiles + ladder
# ──────────────────────────────────────────────────────────────────────────
def build_tiles():
    print("tiles:")
    mapping = [
        (os.path.join("Ground", "Grass", "grassMid.png"), "grass_top", 32, 32),
        (os.path.join("Ground", "Grass", "grassCenter.png"), "grass_center", 32, 32),
        (os.path.join("Ground", "Dirt", "dirtCenter.png"), "dirt", 32, 32),
        (os.path.join("Tiles", "ladderMid.png"), "ladder", 26, 26),
        (os.path.join("Tiles", "ladderTop.png"), "ladder_top", 26, 26),
    ]
    for src, name, w, h in mapping:
        img = load(os.path.join(PPR, src)).resize((w, h), Image.LANCZOS)
        save(img, "tiles", f"{name}.png")
    # Rope ladder: use the chain tile, tinted green to read as a vine.
    chain = load(os.path.join(PPR, "Tiles", "chain.png"))
    chain = hue_rotate(chain, 80).resize((20, 26), Image.LANCZOS)
    save(chain, "tiles", "rope.png")


# ──────────────────────────────────────────────────────────────────────────
# NPC townsfolk (alien colors + 2 hue-shifted variants for variety)
# ──────────────────────────────────────────────────────────────────────────
def build_npcs():
    print("npcs:")
    NPC_H = 50
    # name -> (source color, hue rotation degrees)
    npcs = {
        "guide_iris": ("Blue", 0),
        "ferrymaster_cole": ("Beige", 0),
        "storage_keep": ("Pink", 0),
        "elder_willow": ("Green", 0),
        "merchant_bram": ("Yellow", 0),
        "sensei_tanren": ("Beige", 160),   # teal-ish
        "crystal_keeper_luna": ("Pink", 70),  # violet
    }
    cache = {}
    for name, (color, hue) in npcs.items():
        if color not in cache:
            img = load(os.path.join(PPR, "Players", "128x256", color, f"alien{color}_stand.png"))
            cache[color] = img.crop(alpha_bbox(img))
        base = cache[color]
        if hue:
            base = hue_rotate(base, hue)
        save(resize_to_h(base, NPC_H), "npc", f"{name}.png")

    # Dialog portrait: framed head-and-shoulders on a panel.
    panel = Image.new("RGBA", (64, 64), (42, 58, 90, 255))
    draw = ImageDraw.Draw(panel)
    draw.rectangle([0, 0, 63, 63], outline=(74, 106, 138, 255), width=2)
    src = load(os.path.join(PPR, "Players", "128x256", "Beige", "alienBeige_front.png"))
    src = src.crop(alpha_bbox(src))
    src = resize_to_h(src, 96)  # zoom in so head+shoulders fill the frame
    sx = (64 - src.size[0]) // 2
    panel.paste(src, (sx, 8), src)
    panel = panel.crop((0, 0, 64, 64))
    save(panel, "npc", "portrait.png")


# ──────────────────────────────────────────────────────────────────────────
# Parallax layers (composited from CC0 background elements)
# ──────────────────────────────────────────────────────────────────────────
def vertical_gradient(w, h, top, bottom):
    img = Image.new("RGBA", (w, h))
    px = img.load()
    for y in range(h):
        t = y / (h - 1)
        r = round(top[0] + (bottom[0] - top[0]) * t)
        g = round(top[1] + (bottom[1] - top[1]) * t)
        b = round(top[2] + (bottom[2] - top[2]) * t)
        for x in range(w):
            px[x, y] = (r, g, b, 255)
    return img


def darken(img, factor):
    r, g, b, a = img.split()
    r = r.point(lambda p: int(p * factor))
    g = g.point(lambda p: int(p * factor))
    b = b.point(lambda p: int(p * factor))
    return Image.merge("RGBA", (r, g, b, a))


def build_parallax():
    print("parallax:")
    # Sky — gradient + real Kenney clouds.
    sky = vertical_gradient(1024, 768, (74, 144, 217), (184, 223, 245))
    clouds = [load(os.path.join(BG, f"cloud{i}.png")) for i in (1, 3, 5, 7, 2)]
    spots = [(120, 90, 0.9), (430, 150, 0.75), (720, 70, 0.85), (560, 240, 0.6), (860, 200, 0.7)]
    for (cx, cy, scale), c in zip(spots, clouds):
        cw = round(c.size[0] * scale)
        ch = round(c.size[1] * scale)
        c2 = c.resize((cw, ch), Image.LANCZOS)
        sky.alpha_composite(c2, (cx, cy))
    save(sky, "bg", "sky.png")

    # Hills — distant, darkened treeline silhouette (transparent above).
    hills = Image.new("RGBA", (1024, 320), (0, 0, 0, 0))
    trees = [load(os.path.join(BG, f"treeSmall_green{i}.png")) for i in (1, 2, 3)]
    x = -40
    i = 0
    while x < 1024:
        t = trees[i % len(trees)]
        th = 150 + (i * 23) % 50
        t2 = resize_to_h(t, th)
        t2 = darken(t2, 0.72)
        hills.alpha_composite(t2, (x, 320 - th + 18))
        x += int(t2.size[0] * 0.62)
        i += 1
    save(hills, "bg", "hills.png")

    # Trees — nearer, full-colour tree line.
    near = Image.new("RGBA", (1024, 300), (0, 0, 0, 0))
    bigs = [load(os.path.join(BG, n)) for n in ("tree.png", "treePine.png", "treeLong.png", "bush1.png")]
    positions = [(40, "tree.png"), (250, "treePine.png"), (470, "bush1.png"),
                 (640, "treeLong.png"), (860, "tree.png")]
    by_name = {n: load(os.path.join(BG, n)) for _, n in positions}
    for x, n in positions:
        t = by_name[n]
        th = 250 if n != "bush1.png" else 120
        t2 = resize_to_h(t, th)
        near.alpha_composite(t2, (x, 300 - t2.size[1]))
    save(near, "bg", "trees.png")


def main():
    if not os.path.isdir(PPR):
        sys.exit(f"Platformer Pack Redux not found at {PPR} (set PPR=...)")
    if not os.path.isdir(BG):
        sys.exit(f"Background Elements not found at {BG} (set BG=...)")
    print("OUT =", OUT)
    build_players()
    build_mobs()
    build_items()
    build_tiles()
    build_npcs()
    build_parallax()
    print("done.")


if __name__ == "__main__":
    main()
