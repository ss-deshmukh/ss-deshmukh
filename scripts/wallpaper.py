#!/usr/bin/env python3
"""Turn the block-letter banner at the top of README.md into an SVG wallpaper.

wallpaper.py README.md OUT.svg [--colour #5dff8e]

Each character becomes geometry on a 10x20 grid, so the result is crisp at any size
and does not depend on the viewer having a font with box-drawing glyphs.
"""
import argparse

W, H = 10, 20          # one character cell
A, B, T = 2, 3, 2      # half-gaps of the double lines (x, y) and their stroke width
XL, XR, YT, YB = W / 2 - A, W / 2 + A, H / 2 - B, H / 2 + B

LINES = {
    "═": [[(0, YT), (W, YT)], [(0, YB), (W, YB)]],
    "║": [[(XL, 0), (XL, H)], [(XR, 0), (XR, H)]],
    "╔": [[(XL, H), (XL, YT), (W, YT)], [(XR, H), (XR, YB), (W, YB)]],
    "╗": [[(XR, H), (XR, YT), (0, YT)], [(XL, H), (XL, YB), (0, YB)]],
    "╚": [[(XL, 0), (XL, YB), (W, YB)], [(XR, 0), (XR, YT), (W, YT)]],
    "╝": [[(XR, 0), (XR, YB), (0, YB)], [(XL, 0), (XL, YT), (0, YT)]],
}


def banner(readme):
    rows, inside = [], False
    for line in open(readme, encoding="utf-8"):
        if line.startswith("```"):
            if inside:
                break
            inside = True
        elif inside:
            rows.append(line.rstrip("\n"))
    return rows


def main():
    p = argparse.ArgumentParser()
    p.add_argument("readme")
    p.add_argument("out")
    p.add_argument("--colour", default="#5dff8e")
    a = p.parse_args()

    rows = banner(a.readme)
    cols = max(len(r) for r in rows)
    blocks = []
    for y, row in enumerate(rows):
        x = 0
        while x < len(row):
            ch = row[x]
            if ch == "█":
                run = x
                while run < len(row) and row[run] == "█":
                    run += 1
                # A hair of overlap hides the seams between neighbouring cells.
                blocks.append(f"M{x * W} {y * H}h{(run - x) * W + 0.2}v{H + 0.2}h-{(run - x) * W + 0.2}z")
                x = run
                continue
            if ch not in LINES and ch != " ":
                raise SystemExit(f"unexpected character {ch!r} in banner")
            x += 1

    stroke_d = ""
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            for line in LINES.get(ch, []):
                pts = [f"{x * W + px:g} {y * H + py:g}" for px, py in line]
                stroke_d += "M" + "L".join(pts)

    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {cols * W} {len(rows) * H}">'
        f'<path fill="{a.colour}" d="{"".join(blocks)}"/>'
        f'<path fill="none" stroke="{a.colour}" stroke-width="{T}" stroke-linecap="square" d="{stroke_d}"/>'
        "</svg>\n"
    )
    open(a.out, "w", encoding="utf-8").write(svg)
    print(f"wrote {a.out}: {cols}x{len(rows)} cells, viewBox {cols * W}x{len(rows) * H}")


if __name__ == "__main__":
    main()
