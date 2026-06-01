#!/usr/bin/env python3
"""Generate Pango GO PWA icons with no external dependencies.

Draws a Pango-blue rounded icon with a white location pin and a gold center
into RGBA buffers and writes them as PNGs using only the standard library.
"""
import os
import math
import zlib
import struct

OUT = os.path.join(os.path.dirname(__file__), "..", "icons")

# Pango brand palette
BLUE_TOP = (61, 123, 255)
BLUE_BOT = (24, 70, 200)
GOLD = (255, 200, 45)
WHITE = (255, 255, 255)


def write_png(path, width, height, pixels):
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        c += struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        return c

    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)
        raw.extend(pixels[y * stride:(y + 1) * stride])

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def in_pin(x, y, cx, headY, r, tipY):
    """Location-pin test: head circle + tapering triangle down to the tip."""
    # head circle
    if (x - cx) ** 2 + (y - headY) ** 2 <= r * r:
        return True
    # triangle from circle width down to tip
    if headY <= y <= tipY:
        t = (y - headY) / (tipY - headY)
        halfw = r * (1 - t)
        if abs(x - cx) <= halfw:
            return True
    return False


def make(size, maskable=False):
    px = bytearray(size * size * 4)
    pad = size * 0.10 if maskable else size * 0.015
    R = size / 2 - pad
    cx = size / 2
    cy = size / 2
    corner = size * 0.22  # rounded-square radius for non-maskable

    # pin geometry
    pin_cx = cx
    pin_headY = size * 0.40
    pin_r = size * 0.17
    pin_tipY = size * 0.74
    gold_r = size * 0.085

    for y in range(size):
        for x in range(size):
            i = (y * size + x) * 4
            inside = True
            a = 255

            if not maskable:
                # rounded-square mask
                dx = max(abs(x - cx) - (size / 2 - corner - pad), 0)
                dy = max(abs(y - cy) - (size / 2 - corner - pad), 0)
                if (x < pad or x > size - pad or y < pad or y > size - pad):
                    inside = False
                elif dx * dx + dy * dy > corner * corner:
                    inside = False

            if not inside:
                px[i + 3] = 0
                continue

            # background gradient
            r, g, b = lerp(BLUE_TOP, BLUE_BOT, y / size)

            # soft radial glow behind the pin
            gd = math.hypot(x - pin_cx, y - pin_headY)
            if gd < size * 0.30:
                t = 1 - gd / (size * 0.30)
                r = min(255, int(r + 40 * t))
                g = min(255, int(g + 40 * t))
                b = min(255, int(b + 30 * t))

            # white pin
            if in_pin(x, y, pin_cx, pin_headY, pin_r, pin_tipY):
                r, g, b = WHITE
                # gold center dot
                if (x - pin_cx) ** 2 + (y - pin_headY) ** 2 <= gold_r * gold_r:
                    r, g, b = GOLD

            px[i] = r
            px[i + 1] = g
            px[i + 2] = b
            px[i + 3] = a
    return px


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for name, size, mask in [
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("icon-maskable-512.png", 512, True),
    ]:
        write_png(os.path.join(OUT, name), size, size, make(size, mask))
        print("wrote", name)
