#!/usr/bin/env python3
"""Print the FlaFormatVersion enum row for a given version, mapped to constructor params.
Usage: dump_schema.py [VERSION]   (default F8)
Source of truth for every schema-gate byte in docs/21-fla-binary-format.md."""
import re, sys, os

JAVA = os.path.join(os.path.dirname(__file__),
    "../../refs/flacomdoc/src/com/jpexs/flash/fla/converter/FlaFormatVersion.java")
ver = sys.argv[1] if len(sys.argv) > 1 else "F8"
src = open(JAVA).read()
params = [p.split()[-1] for p in
          re.search(r'FlaFormatVersion\(\s*(.*?)\)\s*\{', src, re.S).group(1).split(',') if p.strip()]
row = re.search(re.escape(ver) + r'\s*\((.*?)\),\s*\n', src, re.S).group(1)
vals = [v.strip() for v in row.split(',')]
assert len(params) == len(vals), (len(params), len(vals))
for n, v in zip(params, vals):
    iv = int(v, 0) if v not in ('true', 'false') else v
    extra = f"  (={iv})" if isinstance(iv, int) and v.lower().startswith('0x') else ""
    print(f"{n} = {v}{extra}")
