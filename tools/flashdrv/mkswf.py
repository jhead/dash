#!/usr/bin/env python3
"""Generate a minimal valid uncompressed SWF for CPicSwf differential RE.
Parameterized so variants differ by exactly one property (stage W/H, fps, frame count, bg).

Usage: mkswf.py OUT.swf WIDTH_PX HEIGHT_PX FPS FRAMES BG_HEX
e.g.   mkswf.py /tmp/a.swf 200 100 12 1 0000FF
"""
import struct, sys


def rect(xmin, xmax, ymin, ymax):
    """SWF RECT (twips). Returns bytes (byte-aligned)."""
    vals = [xmin, xmax, ymin, ymax]
    nbits = 1
    for v in vals:
        b = v.bit_length() + 1  # +1 sign bit
        nbits = max(nbits, b)
    bits = format(nbits, "05b")
    for v in vals:
        bits += format(v & ((1 << nbits) - 1), "0%db" % nbits)
    while len(bits) % 8:
        bits += "0"
    return bytes(int(bits[i:i + 8], 2) for i in range(0, len(bits), 8))


def tag(code, body):
    if len(body) < 0x3F:
        return struct.pack("<H", (code << 6) | len(body)) + body
    return struct.pack("<HI", (code << 6) | 0x3F, len(body)) + body


def main(a):
    out, w, h, fps, frames, bg = a[0], int(a[1]), int(a[2]), float(a[3]), int(a[4]), a[5]
    r = rect(0, w * 20, 0, h * 20)
    framerate = struct.pack("<H", int(round(fps * 256)))   # 8.8
    body = r + framerate + struct.pack("<H", frames)
    # SetBackgroundColor (tag 9): RGB
    rgb = bytes.fromhex(bg)
    body += tag(9, rgb[:3])
    for _ in range(frames):
        body += tag(1, b"")     # ShowFrame
    body += tag(0, b"")         # End
    header = b"FWS" + bytes([6])
    filelen = 8 + len(body)
    swf = header + struct.pack("<I", filelen) + body
    open(out, "wb").write(swf)
    print("wrote %s: %dx%d %sfps %dframes bg#%s (%d bytes)" % (out, w, h, fps, frames, bg, len(swf)))


if __name__ == "__main__":
    main(sys.argv[1:])
