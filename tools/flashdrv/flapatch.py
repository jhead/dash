#!/usr/bin/env python3
"""Write proof: edit a real Flash-authored FLA *by the spec* and emit a valid FLA.

Locates the stage width/height fields in the `Contents` stream (§6.6) and rewrites them to
new pixel values, producing a byte-valid OLE2 FLA (same stream sizes, so in-place patch).
The companion harness (roundtrip_stage.sh) feeds the result back to real Flash 8 (JSFL
openDocument) to confirm Flash reads our written dimensions — i.e. we can WRITE FLA files.

Usage: flapatch.py IN.fla OUT.fla WIDTH_PX HEIGHT_PX
"""
import struct
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fla_cfb import CFB
from flaparse import decode_stage


def find_wh_offsets(contents):
    """Return (width_off, height_off) within the Contents stream per §6.6."""
    d = contents
    anchor = d.find(b"\x00\x03\xb4\x00\x00\x00")
    bg_off = anchor - 5 - 4 - 4
    for off in range(bg_off - 12, max(0, bg_off - 80), -1):
        w = struct.unpack_from("<H", d, off)[0]
        h = struct.unpack_from("<H", d, off + 8)[0]
        if 200 <= w <= 60000 and 200 <= h <= 60000 and d[off + 2:off + 8] == b"\x00" * 6:
            return off, off + 8
    raise RuntimeError("stage width/height not located")


def main(argv):
    inp, outp, w_px, h_px = argv[0], argv[1], int(argv[2]), int(argv[3])
    cfb = CFB(open(inp, "rb").read())
    contents = cfb.read("Contents")
    w_off, h_off = find_wh_offsets(contents)
    print("located width@%d height@%d (stream-relative)" % (w_off, h_off))
    data = cfb.patch("Contents", w_off, struct.pack("<H", w_px * 20))
    # re-open the patched bytes to patch height at the correct file offset
    cfb2 = CFB(bytes(data))
    data = cfb2.patch("Contents", h_off, struct.pack("<H", h_px * 20))
    open(outp, "wb").write(data)
    # self-check via the reader
    st = decode_stage(CFB(open(outp, "rb").read()).read("Contents"))
    print("wrote %s; reader reads back: %sx%s" % (outp, st["width_px"], st["height_px"]))
    assert st["width_px"] == w_px and st["height_px"] == h_px, "self-readback mismatch"
    print("OK self-roundtrip")


if __name__ == "__main__":
    main(sys.argv[1:])
