#!/usr/bin/env python3
"""Stream-aware FLA differ for the flashdrv RE oracle.

Improves on differ.py (whole-file positional XOR) by diffing INSIDE each CFB stream
(Contents, Page N, Symbol N, Font N, ...). The CFB container's FAT/directory/size fields
shift with file length and add noise; diffing per-stream isolates the actual record bytes
and reports offsets RELATIVE TO THE STREAM — exactly the coordinate system docs/21 uses.

Modes:
  fladiff.py STREAM A.fla B.fla [--mask T1.fla T2.fla]
        Diff one named stream between A and B, optionally masking volatile bytes learned
        from a twin pair (same-input saves).
  fladiff.py --all A.fla B.fla [--mask T1.fla T2.fla]
        Diff every stream present in both.
  fladiff.py --auto CORPUS_DIR
        Drive off <name>.meta.json sidecars: build noise masks from twinGroup pairs, then
        for each specimen with a `baseline`, diff every stream and print masked deltas
        beside the meta `actual` field that changed.
  fladiff.py --streams A.fla
        List streams + sizes.

Output per stream: a list of `@off old->new` byte deltas (stream-relative), plus a length
delta if the stream changed size (in which case positional alignment past the first change
is unreliable and is flagged).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fla_cfb import CFB


def load(path):
    return CFB(open(path, "rb").read())


def stream_or_none(cfb, name):
    try:
        return cfb.read(name)
    except KeyError:
        return None


def diff_bytes(a, b, mask=frozenset()):
    n = min(len(a), len(b))
    sig = [i for i in range(n) if a[i] != b[i] and i not in mask]
    return sig, len(b) - len(a)


def fmt(a, b, offs, limit=64):
    parts = ["@%d %02x->%02x" % (o, a[o], b[o]) for o in offs[:limit]]
    if len(offs) > limit:
        parts.append("... (%d more)" % (len(offs) - limit))
    return ", ".join(parts)


def mask_for_stream(t1, t2, name):
    """Volatile offsets in `name` learned from a twin pair."""
    a = stream_or_none(t1, name)
    b = stream_or_none(t2, name)
    if a is None or b is None or len(a) != len(b):
        return frozenset()
    return frozenset(i for i in range(len(a)) if a[i] != b[i])


def diff_stream(A, B, name, mask=frozenset(), show_same=False):
    a = stream_or_none(A, name)
    b = stream_or_none(B, name)
    if a is None and b is None:
        return
    if a is None or b is None:
        print("  %-12s present in only one file (%s)" % (name, "A" if b is None else "B"))
        return
    sig, dlen = diff_bytes(a, b, mask)
    if not sig and dlen == 0:
        if show_same:
            print("  %-12s identical (%d bytes)" % (name, len(a)))
        return
    hdr = "  %-12s len %d->%d" % (name, len(a), len(b))
    if dlen:
        hdr += " (dlen=%+d, positional diff past first change unreliable)" % dlen
    print(hdr)
    if sig:
        print("       %d signal byte(s): %s" % (len(sig), fmt(a, b, sig)))
    else:
        print("       no in-common byte change")


def all_streams(A, B):
    names = []
    seen = set()
    for n in A.names() + B.names():
        if n not in seen:
            seen.add(n)
            names.append(n)
    return names


def cmd_all(a_path, b_path, mask_pair):
    A, B = load(a_path), load(b_path)
    T = (load(mask_pair[0]), load(mask_pair[1])) if mask_pair else None
    for name in all_streams(A, B):
        mask = mask_for_stream(T[0], T[1], name) if T else frozenset()
        diff_stream(A, B, name, mask)


def cmd_one(stream, a_path, b_path, mask_pair):
    A, B = load(a_path), load(b_path)
    mask = frozenset()
    if mask_pair:
        T = (load(mask_pair[0]), load(mask_pair[1]))
        mask = mask_for_stream(T[0], T[1], stream)
        print("mask: %d volatile byte(s) in %s" % (len(mask), stream))
    diff_stream(A, B, stream, mask, show_same=True)


def cmd_auto(corpus_dir):
    metas = {}
    for fn in sorted(os.listdir(corpus_dir)):
        if fn.endswith(".meta.json"):
            with open(os.path.join(corpus_dir, fn)) as f:
                m = json.load(f)
            metas[m["name"]] = m
    if not metas:
        sys.exit("no .meta.json sidecars in %s" % corpus_dir)

    def cfb(name):
        return load(os.path.join(corpus_dir, metas[name]["fla"]))

    twins = {}
    for name, m in metas.items():
        if m.get("twinGroup"):
            twins.setdefault(m["twinGroup"], []).append(name)
    # mask per (twinGroup) -> dict stream -> set
    group_mask = {}
    print("=== noise masks (twin self-diff, per stream) ===")
    for g, names in sorted(twins.items()):
        if len(names) < 2:
            print("  group %s: <2 twins, skipped" % g)
            continue
        t1, t2 = cfb(names[0]), cfb(names[1])
        gm = {}
        for s in all_streams(t1, t2):
            mk = mask_for_stream(t1, t2, s)
            if mk:
                gm[s] = mk
        group_mask[g] = gm
        total = sum(len(v) for v in gm.values())
        print("  group %s (%s,%s): %d volatile byte(s) across %d stream(s)"
              % (g, names[0], names[1], total, len(gm)))
    print()

    print("=== comparisons (mutant vs baseline, per stream, masked) ===")
    for name, m in sorted(metas.items()):
        base = m.get("baseline")
        if not base or base not in metas:
            continue
        A, B = cfb(base), cfb(name)
        # pick mask from baseline's twin group if any, else mutant's
        gm = {}
        for g, names in twins.items():
            if base in names or name in names:
                gm = group_mask.get(g, {})
                break
        # human label of what changed
        chg = []
        ba, ma = metas[base].get("actual", {}), m.get("actual", {})
        for k in set(list(ba.keys()) + list(ma.keys())):
            if ba.get(k) != ma.get(k):
                chg.append("%s %r->%r" % (k, ba.get(k), ma.get(k)))
        print("  %s vs %s  [%s]" % (name, base, ", ".join(chg) or "(no actual change)"))
        for s in all_streams(A, B):
            diff_stream(A, B, s, gm.get(s, frozenset()))
    print()


def main(argv):
    if not argv:
        sys.exit(__doc__)
    mask_pair = None
    if "--mask" in argv:
        i = argv.index("--mask")
        mask_pair = (argv[i + 1], argv[i + 2])
        argv = argv[:i] + argv[i + 3:]
    if argv[0] == "--auto":
        cmd_auto(argv[1])
    elif argv[0] == "--all":
        cmd_all(argv[1], argv[2], mask_pair)
    elif argv[0] == "--streams":
        load(argv[1]).dump_tree()
    else:
        cmd_one(argv[0], argv[1], argv[2], mask_pair)


if __name__ == "__main__":
    main(sys.argv[1:])
