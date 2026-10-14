#!/usr/bin/env python3
"""Generate PWA icons from the Star Belt logo.

Run:  python3 scripts/generate-icons.py
Output: public/icons/icon-192.png, icon-512.png, icon-maskable-512.png,
        public/icons/apple-touch-icon.png

The logo itself is wide (300x174). For square icons we place it centered on a
white tile (normal icons) or on a navy tile with generous padding (maskable).
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
LOGO = ROOT / "public" / "assets" / "logo.png"
OUT = ROOT / "public" / "icons"
NAVY = (28, 44, 85, 255)  # #1c2c55, matches logo navy
WHITE = (255, 255, 255, 255)


def tile(logo: Image.Image, size: int, background, padding_fraction: float) -> Image.Image:
    """Place the logo on a square tile, centered, preserving aspect ratio."""
    canvas = Image.new("RGBA", (size, size), background)
    safe = size * (1.0 - 2.0 * padding_fraction)
    lw = logo.width * (safe / max(logo.width, logo.height))
    lh = logo.height * (safe / max(logo.width, logo.height))
    resized = logo.resize((int(lw), int(lh)), Image.LANCZOS).convert("RGBA")
    canvas.alpha_composite(resized, ((size - resized.width) // 2, (size - resized.height) // 2))
    return canvas.convert("RGB")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    logo = Image.open(LOGO).convert("RGBA")
    # Transparent pixels would show black on RGB tiles, so flatten over white first.
    white_bg = Image.new("RGBA", logo.size, WHITE)
    white_bg.alpha_composite(logo)
    flat_logo = white_bg.convert("RGB")

    tile(flat_logo, 192, WHITE, 0.16).save(OUT / "icon-192.png")
    tile(flat_logo, 512, WHITE, 0.16).save(OUT / "icon-512.png")
    # Maskable: purpose "any maskable" — keep the logo inside the 80% safe zone.
    tile(flat_logo, 512, NAVY, 0.20).save(OUT / "icon-maskable-512.png")
    tile(flat_logo, 180, WHITE, 0.16).save(OUT / "apple-touch-icon.png")
    print("Icons written to", OUT)


if __name__ == "__main__":
    main()
