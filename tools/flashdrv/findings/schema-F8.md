# Flash 8 (`FlaFormatVersion.F8`) schema-gate constants — AUTHORITATIVE

Computed by positional zip of the constructor parameter list against the `F8(...)` enum
row in `tools/refs/flacomdoc/src/com/jpexs/flash/fla/converter/FlaFormatVersion.java`
(see `tools/flashdrv/findings/dump_schema.py`). These are the per-record schema/version
bytes Flash 8 stamps and a reader gates on. **Both mining agents made positional errors in
this table; this script-computed version is the ground truth.**

| constant | F8 value | constant | F8 value |
|---|---|---|---|
| contentsVersion | 0x3F (63) | bitmapVersion | 4 |
| contentsVersionB | 1 | videoStreamVersion | 4 |
| documentPageVersion | 0x17 (23) | groupVersion | 4 |
| documentPageVersionB | 6 | mediaBitsVersion | 6 |
| colorDefVersion | 4 | mediaBitsVersionB | 3 |
| pageVersion | 4 | mediaBitsVersionC | 6 |
| pageVersionB | 7 | mediaSoundVersion | 6 |
| frameVersion | 4 | mediaSoundVersionB | 0x0A (10) |
| frameVersionB | 0x18 (24) | mediaSoundVersionC | 6 |
| frameVersionC | 4 | mediaVideoVersion | 6 |
| layerVersion | 4 | mediaVideoVersionB | 7 |
| layerVersionB | 0x0B (11) | mediaVideoVersionC | 6 |
| spriteVersion | 4 | mediaVideoVersionD | 2 |
| spriteVersionB | 4 | asLinkageVersion | 7 |
| spriteVersionC | 7 | asLinkageVersionB | 2 |
| spriteVersionD | 6 | libraryFolderVersion | 7 |
| spriteVersionE | 6 | libraryFolderVersionB | 4 |
| spriteVersionF | 2 | libraryFolderVersionC | 6 |
| spriteVersionG | 8 | libraryFolderVersionD | 2 |
| buttonVersion | 0x0B (11) | accessibilityVersion | 2 |
| symbolType | 0x13 (19) | shapeVersion | 5 |
| shapeType | 3 | generatorVersion | 9 |
| bitmapType | 2 | generatorBuild | 494 |
| videoType | 4 | unicode | true |
| fontVersion | 2 | | |
| fontVersionB | 0x0C (12) | | |
| fontVersionC | 6 | | |
| textVersion | 0x0D (13) | | |
| textVersionB | 0x0C (12) | | |
| textVersionC | 4 | | |

Key bytes used as literals on the wire:
- `contentsVersion = 0x3F` → first byte of the `Contents` stream (verified @0 in real empty doc).
- `symbolType=0x13, shapeType=3, bitmapType=2, videoType=4` → the `instanceType` byte in the instance header.
- `frameVersionB = 0x18 (24)` → the `fs` gate in docs/21 §9 (NOT frameVersion=4).
- `asLinkageVersion=7` then later `asLinkageVersionB=2` → the two version bytes inside the AS2 linkage block.
- `unicode=true` → every string is a `FF FE FF`-prefixed UTF-16LE BomString.
