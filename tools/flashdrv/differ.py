#!/usr/bin/env python3
"""Noise-masked FLA byte differ for the flashdrv RE oracle (see ../../FLA-RE-PLAN.md).

FLAs carry volatile bytes (timestamps / a GUID) that swamp a naive XOR. The fix is the
plan's three-step recipe:

  1. Noise mask  -- save the SAME input twice; bytes that differ between the twins are
                    volatile and get masked out. The mask is doc-shape-dependent, so it is
                    computed per file-length from twin pairs in the corpus, never hardcoded.
  2. Signal      -- (mutant XOR baseline) & ~mask  == the bytes a single property changed.
  3. Decode      -- correlate each surviving byte offset with the one flag that differed
                    between the two specimens' .meta sidecars.

Auto mode (the normal path) drives entirely off the <name>.meta.json sidecars the
generators emit: it finds twin groups for masks and `baseline` links for comparisons, then
prints, per comparison, the masked byte deltas next to the flag(s) that changed -- which is
the decoded field layout. Positional XOR only makes sense between equal-length files; the
generators keep paired specimens the same shape, and mismatches are reported, not faked.

Usage:
  differ.py <corpus_dir>                         # auto: drive off .meta.json sidecars
  differ.py --pair BASE.fla MUT.fla [--mask A.fla B.fla]   # ad-hoc two-file diff
"""

import json
import os
import sys

FLAG_KEYS = ("AS", "ff", "RS", "imp")
FLAG_LABEL = {
    "AS":  "exportForActionScript",
    "ff":  "exportInFirstFrame",
    "RS":  "exportForRuntimeSharing",
    "imp": "importForRuntimeSharing",
}


def read_bytes(path):
    with open(path, "rb") as f:
        return f.read()


def mask_from_twins(a, b):
    """Bytes that differ between two identical-input saves == volatile. Returns a set of
    offsets to ignore. Length mismatch between twins is fatal: they should be identical
    shape, so a differing length means the noise model itself is broken."""
    if len(a) != len(b):
        raise ValueError("twin length mismatch (%d vs %d): twins must be same-shape saves"
                         % (len(a), len(b)))
    return {i for i in range(len(a)) if a[i] != b[i]}


def diff(base, mut, mask):
    """Offsets where base and mut differ, excluding masked (volatile) offsets. Over the
    common prefix; trailing length difference is returned separately."""
    n = min(len(base), len(mut))
    sig = [i for i in range(n) if base[i] != mut[i] and i not in mask]
    return sig, len(mut) - len(base)


def flag_delta(meta_base, meta_mut):
    """Human-readable list of (flag, base_val, mut_val) that changed between two specimens,
    using the ACTUAL (read-back) values -- what Flash committed, not what we asked for."""
    ba, ma = meta_base.get("actual", {}), meta_mut.get("actual", {})
    out = []
    for k in FLAG_KEYS:
        if bool(ba.get(k)) != bool(ma.get(k)):
            out.append((k, bool(ba.get(k)), bool(ma.get(k))))
    return out


def fmt_bytes(base, mut, offs):
    return ", ".join("@%d %02x->%02x" % (o, base[o], mut[o]) for o in offs)


def auto(corpus_dir):
    metas = {}
    for fn in sorted(os.listdir(corpus_dir)):
        if fn.endswith(".meta.json"):
            with open(os.path.join(corpus_dir, fn)) as f:
                m = json.load(f)
            metas[m["name"]] = m

    if not metas:
        sys.exit("no .meta.json sidecars in %s (did the generator run?)" % corpus_dir)

    def flabytes(name):
        return read_bytes(os.path.join(corpus_dir, metas[name]["fla"]))

    # 1. Masks, keyed by file length, from twin groups.
    twins = {}  # group -> [names]
    for name, m in metas.items():
        if m.get("twinGroup"):
            twins.setdefault(m["twinGroup"], []).append(name)

    masks = {}  # length -> set(offsets)
    print("=== noise masks (twin self-diff) ===")
    for group, names in sorted(twins.items()):
        if len(names) < 2:
            print("  group %s: only %d twin(s); skipped" % (group, len(names)))
            continue
        a, b = flabytes(names[0]), flabytes(names[1])
        try:
            mk = mask_from_twins(a, b)
        except ValueError as e:
            print("  group %s: %s" % (group, e))
            continue
        masks.setdefault(len(a), set()).update(mk)
        offs = sorted(mk)
        print("  group %s (%s,%s): len=%d, %d volatile byte(s): %s"
              % (group, names[0], names[1], len(a), len(offs),
                 offs if len(offs) <= 24 else str(offs[:24]) + " ..."))
    print()

    # 2. Comparisons from `baseline` links.
    print("=== comparisons (mutant vs baseline, masked) ===")
    decoded = []
    for name, m in sorted(metas.items()):
        base = m.get("baseline")
        if not base:
            continue
        if base not in metas:
            print("  %s: baseline '%s' not found" % (name, base))
            continue
        bb, mb = flabytes(base), flabytes(name)
        mask = masks.get(len(bb), set()) if len(bb) == len(mb) else set()
        sig, dlen = diff(bb, mb, mask)
        delta = flag_delta(metas[base], m)
        dstr = ", ".join("%s %s->%s" % (FLAG_LABEL[k], "T" if a else "F", "T" if b else "F")
                         for k, a, b in delta) or "(no actual flag change!)"
        print("  %-9s vs %-9s  [%s]" % (name, base, dstr))
        if len(bb) != len(mb):
            print("       LENGTH MISMATCH (%d vs %d, dlen=%+d) -- positional diff skipped"
                  % (len(bb), len(mb), dlen))
            continue
        if not sig:
            print("       no non-volatile byte change")
        else:
            print("       %d signal byte(s): %s" % (len(sig), fmt_bytes(bb, mb, sig)))
        # Decode by matching each changed flag to a signal byte by change DIRECTION: a flag
        # going F->T pairs with a byte going low->high, T->F with high->low. Works for the
        # 1-flag/1-byte case and the RS<->import 2-flag/2-byte case (mutual exclusion forces
        # them to move together, but in opposite directions, so each is still unambiguous).
        if sig and len(delta) == len(sig):
            for k, fb, fm in delta:
                want_up = (not fb) and fm          # flag turned on  -> byte should rise
                cands = [o for o in sig
                         if (mb[o] > bb[o]) == want_up and mb[o] != bb[o]]
                if len(cands) == 1:
                    o = cands[0]
                    decoded.append((FLAG_LABEL[k], o, bb[o], mb[o]))
    print()

    if decoded:
        print("=== DECODED (single flag <-> single byte) ===")
        for label, off, bv, mv in decoded:
            print("  %-24s -> byte @%d  (%02x when off-side, %02x when on-side)"
                  % (label, off, bv, mv))
    else:
        print("=== no clean single-flag/single-byte decodes; inspect signal bytes above ===")


def pair(base_path, mut_path, mask_paths):
    base, mut = read_bytes(base_path), read_bytes(mut_path)
    mask = set()
    if mask_paths:
        mask = mask_from_twins(read_bytes(mask_paths[0]), read_bytes(mask_paths[1]))
        print("mask: %d volatile byte(s) from twins" % len(mask))
    sig, dlen = diff(base, mut, mask)
    if len(base) != len(mut):
        print("LENGTH MISMATCH (%d vs %d, dlen=%+d)" % (len(base), len(mut), dlen))
    print("%d signal byte(s): %s" % (len(sig), fmt_bytes(base, mut, sig) if sig else "(none)"))


def main(argv):
    if not argv:
        sys.exit(__doc__)
    if argv[0] == "--pair":
        if len(argv) < 3:
            sys.exit("--pair needs BASE.fla MUT.fla [--mask A.fla B.fla]")
        base_path, mut_path = argv[1], argv[2]
        mask_paths = None
        if "--mask" in argv:
            i = argv.index("--mask")
            mask_paths = (argv[i + 1], argv[i + 2])
        pair(base_path, mut_path, mask_paths)
    else:
        auto(argv[0])


if __name__ == "__main__":
    main(sys.argv[1:])
