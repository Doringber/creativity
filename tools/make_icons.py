#!/usr/bin/env python3
"""Generate AR Catch PWA icons with no external dependencies.

Draws a simple, bold app icon (gradient background + a target/pokeball-ish
motif + a coin) into RGBA pixel buffers and writes them as PNG files using
only the Python standard library (zlib + struct).
"""
import os
import math
import zlib
import struct

OUT = os.path.join(os.path.dirname(__file__), "..", "icons")


def write_png(path, width, height, pixels):
    """pixels: bytearray of RGBA, length width*height*4."""
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        c += struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        return c

    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)  # filter type 0
        raw.extend(pixels[y * stride:(y + 1) * stride])

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def lerp(a, b, t):
    return a + (b - a) * t


def make(size, maskable=False):
    px = bytearray(size * size * 4)
    cx = cy = size / 2
    # for maskable icons keep the art within the safe ~80% zone
    pad = size * 0.08 if maskable else size * 0.02
    R = (size / 2) - pad

    for y in range(size):
        for x in range(size):
            i = (y * size + x) * 4
            # diagonal gradient background (deep navy -> magenta -> cyan)
            t = (x + y) / (2 * size)
            r = int(lerp(20, 255, t * 0.9))
            g = int(lerp(16, 61, t))
            b = int(lerp(64, 166, 1 - t) * (1 - t) + lerp(64, 224, t) * t)
            a = 255

            dx = x - cx
            dy = y - cy
            dist = math.hypot(dx, dy)

            # outer rounded disc
            if dist <= R:
                # base disc fill (slightly darker navy so motif pops)
                r, g, b = 18, 22, 54

                # outer ring (cyan -> magenta)
                if R * 0.86 <= dist <= R:
                    ang = (math.atan2(dy, dx) + math.pi) / (2 * math.pi)
                    r = int(lerp(54, 255, ang))
                    g = int(lerp(224, 61, ang))
                    b = int(lerp(255, 166, ang))

                # central target rings
                ringw = size * 0.045
                for rr, col in [
                    (R * 0.62, (255, 61, 166)),
                    (R * 0.42, (54, 224, 255)),
                ]:
                    if abs(dist - rr) <= ringw:
                        r, g, b = col

                # bullseye (gold coin) with a $-ish shine
                if dist <= R * 0.22:
                    r, g, b = 255, 210, 63
                    # little highlight
                    if (dx + R * 0.07) ** 2 + (dy + R * 0.07) ** 2 <= (R * 0.07) ** 2:
                        r, g, b = 255, 245, 200

                a = 255
            else:
                # transparent corners (non-maskable) / keep gradient (maskable)
                if maskable:
                    a = 255
                else:
                    a = 0

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
