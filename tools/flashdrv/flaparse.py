#!/usr/bin/env python3
"""Structural FLA reader — validates docs/21-fla-binary-format.md against real files.

Two read proofs:
  1. CArchive class inventory: scan every stream for new-class declarations (§5.1
     `FF FF <u16 defineNum> <u16 nameLen> <name>`) and list the class vocabulary. This
     exercises the CArchive tag layout on real, complex FLAs (Magnet has dozens of classes).
  2. Document catalog: decode the `Contents` stage block (§6.6) — width/height/background/
     frameRate — from the documented structure, plus the scene/symbol `CDocumentPage` names.

Usage:
  flaparse.py classes FILE.fla            # class inventory across all streams
  flaparse.py stage   FILE.fla            # decode stage W/H/bg/fps from Contents
  flaparse.py catalog FILE.fla            # scene + symbol CDocumentPage names/types
  flaparse.py all     FILE.fla
"""
import struct
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fla_cfb import CFB


# ---- CArchive class inventory (§5.1) ----
def class_inventory(data):
    """Find new-class declarations: FF FF <u16 defineNum> <u16 nameLen> <nameLen ASCII>.
    nameLen is bounded (classes are like 'CPicShape'); validate to avoid false hits."""
    classes = []
    i = 0
    n = len(data)
    seen = set()
    while i + 6 <= n:
        if data[i] == 0xFF and data[i + 1] == 0xFF:
            define = struct.unpack_from("<H", data, i + 2)[0]
            namelen = struct.unpack_from("<H", data, i + 4)[0]
            if 2 <= namelen <= 40 and i + 6 + namelen <= n:
                name = data[i + 6:i + 6 + namelen]
                if all(0x41 <= b <= 0x7A for b in name):  # ASCII letters
                    nm = name.decode("ascii")
                    if nm[0] == 'C':  # all FLA classes start with C (CPic*, CMedia*, CDocument*)
                        classes.append((i, define, nm))
                        seen.add(nm)
                        i += 6 + namelen
                        continue
        i += 1
    return classes, seen


# ---- §6.6 stage block ----
def decode_stage(contents):
    """Locate the stage block by the '00 03 b4' anchor that trails the fps bytes (§6.6),
    then read backwards/forwards per the documented layout. Falls back to the verified
    empty-doc offsets. Returns dict or None."""
    d = contents
    # The fps quad is `00 fpsFrac fpsInt 00 00` immediately followed by `00 03 b4 00 00 00`.
    anchor = d.find(b"\x00\x03\xb4\x00\x00\x00")
    if anchor < 12:
        return None
    # grid color (4) bg color (4) sit just before `00 fpsFrac fpsInt 00 00` (5 bytes) before anchor.
    fps_int = d[anchor - 3]
    fps_frac = d[anchor - 4]
    # bg is 4+4 = 8 bytes before the fps quad's leading 00 (anchor-5 is that 00)
    grid_off = anchor - 5 - 4
    bg_off = grid_off - 4
    bg = (d[bg_off], d[bg_off + 1], d[bg_off + 2])
    # width/height are earlier in the block; use the structural search: width u16*20 then 6 zero
    # then height u16*20. Search the window before bg for a plausible (w,6zero,h) triple.
    width = height = None
    # take the (width, 6 zero, height) triple CLOSEST to the bg block (last valid match)
    for off in range(bg_off - 12, max(0, bg_off - 80), -1):
        w = struct.unpack_from("<H", d, off)[0]
        h = struct.unpack_from("<H", d, off + 8)[0]
        if 200 <= w <= 60000 and 200 <= h <= 60000 and d[off + 2:off + 8] == b"\x00" * 6:
            width, height = w, h
            break
    return {
        "width_px": width / 20 if width else None,
        "height_px": height / 20 if height else None,
        "frameRate": fps_int + fps_frac / 256.0,
        "bg": "#%02X%02X%02X" % bg,
        "anchor_off": anchor,
    }


# ---- §6.2/6.3 catalog: CDocumentPage names ----
def read_string(d, i, unicode=True):
    """writeString: u8 len (char count, <0xFF) then chars. UTF-16LE when unicode (F8),
    else single-byte. Returns (str, next_i)."""
    ln = d[i]; i += 1
    if ln == 0:
        return "", i
    if ln == 0xFF:
        ln = struct.unpack_from("<H", d, i)[0]; i += 2
        if ln == 0xFFFF:
            ln = struct.unpack_from("<I", d, i)[0]; i += 4
    if unicode:
        return d[i:i + ln * 2].decode("utf-16-le", "replace"), i + ln * 2
    return d[i:i + ln].decode("latin1"), i + ln


def read_bomstring(d, i):
    """BomString: FF FE FF then writeString(unicode). Returns (str, next_i)."""
    if d[i:i + 3] == b"\xff\xfe\xff":
        i += 3
        ln = d[i]; i += 1
        if ln == 0:
            return "", i
        if ln == 0xFF:
            ln = struct.unpack_from("<H", d, i)[0]; i += 2
            if ln == 0xFFFF:
                ln = struct.unpack_from("<I", d, i)[0]; i += 4
        return d[i:i + ln * 2].decode("utf-16-le", "replace"), i + ln * 2
    # non-unicode fallback
    return read_string(d, i, unicode=False)


def catalog(contents):
    """Walk CDocumentPage records: anchor on documentPageVersion 0x17 followed by a unicode
    writeString tag ('Page N'/'Symbol N') then a BomString name. The trailing BomString
    (FF FE FF) is a strong validator that rejects false 0x17 hits."""
    d = contents
    out = []
    i = 0
    n = len(d)
    while i + 4 < n:
        j = d.find(b"\x17", i)
        if j < 0 or j + 2 >= n:
            break
        i = j + 1
        ln = d[j + 1]                       # writeString char-count
        if not (2 <= ln <= 40):
            continue
        try:
            tag, k = read_string(d, j + 1, unicode=True)
        except Exception:
            continue
        # tag must look like "Page N" or "Symbol N" and be immediately followed by a BomString
        if not (tag[:4] in ("Page", "Symb")) or d[k:k + 3] != b"\xff\xfe\xff":
            continue
        name, k = read_bomstring(d, k)
        if k + 5 > n:
            continue
        sym_id = struct.unpack_from("<H", d, k)[0]
        sym_type = d[k + 4]
        kind = "scene" if tag.startswith("Page") else "symbol"
        type_name = ({0: "graphic", 1: "button", 2: "movieclip"}.get(sym_type, "?%d" % sym_type)
                     if kind == "symbol" else "-")
        out.append({"kind": kind, "tag": tag, "name": name, "id": sym_id, "symbolType": type_name})
        i = k + 5
    return out


def main(argv):
    if len(argv) < 2:
        sys.exit(__doc__)
    cmd, path = argv[0], argv[1]
    cfb = CFB(open(path, "rb").read())
    if cmd in ("classes", "all"):
        allcls = set()
        per = {}
        for name, body in cfb.streams().items():
            _, s = class_inventory(body)
            per[name] = s
            allcls |= s
        print("=== CArchive classes (%d distinct) ===" % len(allcls))
        print("  " + ", ".join(sorted(allcls)))
        if cmd == "all":
            for name in sorted(per):
                if per[name]:
                    print("  %-14s %s" % (name, ", ".join(sorted(per[name]))))
    if cmd in ("stage", "all"):
        st = decode_stage(cfb.read("Contents"))
        print("=== stage (§6.6) ===")
        print("  " + str(st))
    if cmd in ("catalog", "all"):
        cat = catalog(cfb.read("Contents"))
        print("=== catalog (%d CDocumentPage records) ===" % len(cat))
        for e in cat:
            print("  %-7s id=%-3d type=%-9s name=%r" % (e["kind"], e["id"], e["symbolType"], e["name"]))


if __name__ == "__main__":
    main(sys.argv[1:])
