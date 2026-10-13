#!/usr/bin/env python3
"""Render a perspective poster from an equirectangular panorama.

poster.py PANO OUT [--yaw RAD] [--pitch RAD] [--fov DEG] [--size WxH] [--quality N]

yaw/pitch follow the site's camera convention (three.js, YXZ order; positive yaw turns left).
"""
import argparse
import math

import numpy as np
from PIL import Image


def main():
    p = argparse.ArgumentParser()
    p.add_argument("pano")
    p.add_argument("out")
    p.add_argument("--yaw", type=float, default=0.0)
    p.add_argument("--pitch", type=float, default=0.0)
    p.add_argument("--fov", type=float, default=60.0, help="vertical FOV in degrees")
    p.add_argument("--size", default="1920x1080")
    p.add_argument("--quality", type=int, default=82)
    a = p.parse_args()

    W, H = (int(n) for n in a.size.lower().split("x"))
    pano = np.asarray(Image.open(a.pano).convert("RGB"))
    ph, pw = pano.shape[:2]

    vf = math.radians(a.fov)
    half_v = math.tan(vf / 2)
    half_h = half_v * W / H
    xs = ((np.arange(W) + 0.5) / W * 2 - 1) * half_h
    ys = (1 - (np.arange(H) + 0.5) / H * 2) * half_v
    X, Y = np.meshgrid(xs, ys)
    Z = -np.ones_like(X)

    # Camera rotation R = Ry(yaw) * Rx(pitch), applied to the view-space ray.
    cp, sp = math.cos(a.pitch), math.sin(a.pitch)
    cy, sy = math.cos(a.yaw), math.sin(a.yaw)
    Y1 = cp * Y - sp * Z
    Z1 = sp * Y + cp * Z
    X2 = cy * X + sy * Z1
    Z2 = -sy * X + cy * Z1
    n = np.sqrt(X2 * X2 + Y1 * Y1 + Z2 * Z2)
    dx, dy, dz = X2 / n, Y1 / n, Z2 / n

    # Pano centre column looks down -Z; azimuth grows to the right (+X).
    lon = np.arctan2(dx, -dz)
    lat = np.arcsin(np.clip(dy, -1, 1))
    u = (lon / (2 * math.pi) + 0.5) * pw
    v = (0.5 - lat / math.pi) * ph

    # Bilinear sample with horizontal wrap.
    u0 = np.floor(u).astype(int)
    v0 = np.clip(np.floor(v).astype(int), 0, ph - 2)
    fu = (u - u0)[..., None]
    fv = (v - v0)[..., None]
    u0 %= pw
    u1 = (u0 + 1) % pw
    v1 = v0 + 1
    img = (
        pano[v0, u0] * (1 - fu) * (1 - fv)
        + pano[v0, u1] * fu * (1 - fv)
        + pano[v1, u0] * (1 - fu) * fv
        + pano[v1, u1] * fu * fv
    )
    Image.fromarray(img.astype(np.uint8)).save(a.out, quality=a.quality, optimize=True)
    print(f"wrote {a.out} {W}x{H} yaw={a.yaw} pitch={a.pitch} fov={a.fov}")


if __name__ == "__main__":
    main()
