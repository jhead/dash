# Binary FLA Format — File Format Specification

**Target: Macromedia Flash 8** (`.fla`), annotated for the Flash 5 – CS4 family's version gating.
Version 2 (2026-06-17).

This document specifies the proprietary Macromedia/Adobe binary `.fla` document format as
written by **Flash 8**. Field layouts are reconstructed from three cross-checked sources and
verified against real Flash 8 output:

* **JPEXS `flacomdoc`** (`tools/refs/flacomdoc/`) — a byte-verified XFL→binary-FLA *writer*;
  the authoritative field order/encoding (the source of every **[V]**/**[V\*]** tag here).
* **`eddiemoore/fla-decoder`** (`tools/refs/fla-decoder/`) — Ghidra RE of `flash.exe`; confirms
  the MFC CArchive protocol and per-record schema gates from the *reader* side.
* **flashdrv oracle** (`tools/flashdrv/`) — drives a real Flash 8 install (Win7 VM) via JSFL to
  emit single-property-varied FLAs, byte-diffed per-stream on the host. Confirms field
  offsets/encodings against genuine output (the stage block §8, the timeline byte-walk §17).

> **Scope note.** The constants in §3 are the **Flash 8** column only; other versions are
> reachable via the version *gates* throughout (and `tools/flashdrv/findings/dump_schema.py`
> for their constants) but their constant values and post-F8 structures (e.g. the CS4 3-D
> block) are named, not fully laid out. A CS3/CS4-targeting reader must supply those constants.

---

## Table of contents

```
0   Conventions and confidence tags
1   Notation
2   Container: OLE2 / Compound File Binary
3   Per-version schema constants (Flash 8)
4   Primitive encodings
5   MFC CArchive object protocol
6   How to read a FLA  (normative procedure)
7   Resynchronization  (normative + hazards)
8   Contents stream — document catalog
9   Timeline streams
10  CPicPage / CPicLayer
11  CPicFrame
12  Shapes (CPicShape)
13  Morph shapes (CPicMorphShape)
14  Symbol instances (CPicSprite / CPicButton / CPicSymbol)
15  Component metadata
16  Filters
17  Text (CPicText)
18  Media objects (CPicBitmap / CPicVideoStream / CPicSwf)
19  Color transform, accessibility, scale-9
20  Gap status
21  Verification
22  Provenance
```

---

## 0. Conventions and confidence tags

**Confidence tags** (per field; a tag on a record header applies to the whole record):

| Tag | Meaning |
|-----|---------|
| **[V]** | **Verified — bytes and semantics.** Byte-checked against the `flacomdoc` writer *and* the field's meaning is known. |
| **[V\*]** | **Verified bytes, opaque semantics.** The exact bytes are known and constant (safe to assert/echo), but their *meaning* is not. Used for the many fixed constant runs Flash emits. |
| **[O]** | **Observed.** Derived from real specimens but not cross-checked against the writer. |
| **[I]** | **Inferred.** Best-effort, no confirming writer/sample. |
| **[X]** | **Unknown.** Only the byte extent (or how to skip it) is known. |

**Offsets.** Unless written `@abs N`, an `@N` offset is **relative to the start of the enclosing
record/block**. Absolute offsets (`@abs N`) are given only for the *empty default document* as a
worked anchor; they shift with any preceding variable-length data and must not be hard-coded.

**Byte order** is little-endian unless stated. **All `skip(n)` are exact byte counts**, never an
unbounded gap — this spec contains no `...` placeholders inside a layout.

---

## 1. Notation

```
Integers      u8 u16 u32 u64                unsigned LE
              s8 s16 s24 s32                signed LE, two's complement
                 (s24 = 3 bytes LE; sign-extend from bit 23)
IEEE-754      f32 (writeFloat)  f64 (writeDouble)   little-endian
Fixed-point   fixed16  = s32 / 65536        16.16   (matrix a,b,c,d)
              fix8_8   = (u8 frac, s8 int)         see naming note
              fix8_24  = (u8 frac, s24 int)        see naming note

Strings       CString    MFC length-prefixed (ASCII or UTF-16; §4.1)
              BomString  FF FE FF-prefixed UTF-16LE CString (§4.1)
Var-int       encodedUI  u16, or (FF 7F + u32) when value >= 0x7FFF (§4.4)
Composite     Matrix     24 bytes: a,b,c,d (fixed16) + tx,ty (s32 twips) (§4.2)
              RGBA       u8 R,G,B,A
              Point8_8   per axis: u8 frac, s8 int   (shape edges, fix8_8)
              Point8_24  per axis: u8 frac, s24 int  (morph points, fix8_24)
```

> **Fixed-point naming note.** This spec writes fixed-point as **frac.int** order on the wire
> (the fraction byte is stored first), so `fix8_8`/`fix8_24` name the *(frac bits).(int bits)*
> as stored. Numerically `fix8_24` is a 24-integer-bit / 8-fraction-bit value (conventionally
> "24.8"); the name reflects storage order, not magnitude. Always: value = int + frac/256.

```
Annotations   field;        // [tag] note
              skip(n)       // exactly n bytes, uninterpreted ([V*] or [X])
              if (>= F8)    // present when the target ordinal >= Flash 8 (gates: F5<MX<MX2004<F8<CS3<CS4)
              field[count]  // array
              @N / @abs N   // record-relative / absolute(empty-doc) offset
```

> **`FF 7F + u32` is overloaded** and context-dependent: as a *class tag* it is an extended
> backref (§5.1); inside `encodedUI` it is the escaped large-value form (§4.4). They are
> unrelated; never cross-apply.

---

## 2. Container: OLE2 / Compound File Binary

Standard Microsoft CFB ([MS-CFB]). Implemented dependency-free in `tools/flashdrv/fla_cfb.py`,
verified against every sample and all oracle output. **[V]**

```
Header @abs 0                       (512 bytes for v3)
  u8[8]  magic           @0   = D0 CF 11 E0 A1 B1 1A E1
  u16    sectorSizePow   @30   sectorSize = 1 << pow   (512 v3, 4096 v4)
  u16    miniSectorPow   @32   miniSector = 1 << pow   (usually 64)
  u32    fatSectorCount  @44
  u32    firstDirSector  @48
  u32    miniStreamCutoff@56   usually 4096
  u32    firstMiniFat    @60
  u32    miniFatCount    @64
  u32    firstDifat      @68
  u32    difat[109]      @76
```

`fileOffset = 512 + sector * sectorSize`. FAT sentinels: `ENDOFCHAIN=0xFFFFFFFE
FREESECT=0xFFFFFFFF FATSECT=0xFFFFFFFD DIFSECT=0xFFFFFFFC`. Directory entry types `1=storage
2=stream 5=root`. **Mini-FAT:** streams with `size < miniStreamCutoff` live in 64-byte mini
sectors carved from the root entry's stream; most `Page N`/`Symbol N` streams live there.
Directory entry (128 B): `utf16 name@0` (`(nameLen@64-2)/2` chars), `u8 type@66`, `u32
left@68/right@72/child@76`, `u32 start@116`, `u32 sizeLo@120/sizeHi@124`.

Stream inventory (typical): `Contents` (the document catalog, §8); one `Page N <time>` per scene
and one `Symbol N`/`S N <time>` per symbol (timelines, §9); `Media N <time>` for sound/bitmap/
video payloads.

---

## 3. Per-version schema constants (Flash 8)

Every record carries one or more *schema/version bytes*; the reader gates optional fields on the
**format ordinal** and the writer stamps the literal values below. Computed mechanically from
`FlaFormatVersion.java` (`tools/flashdrv/findings/dump_schema.py`). **[V]**

| constant | F8 | constant | F8 | constant | F8 |
|---|---|---|---|---|---|
| contentsVersion | **0x3F** | spriteVersionG | 8 | mediaSoundVersion | 6 |
| contentsVersionB | 1 | buttonVersion | 0x0B | mediaSoundVersionB | 0x0A |
| documentPageVersion | 0x17 | symbolType | **0x13** | mediaSoundVersionC | 6 |
| documentPageVersionB | 6 | shapeType | **3** | mediaVideoVersion | 6 |
| colorDefVersion | 4 | bitmapType | **2** | mediaVideoVersionB | 7 |
| pageVersion | 4 | videoType | **4** | mediaVideoVersionC | 6 |
| pageVersionB | 7 | fontVersion | 2 | mediaVideoVersionD | 2 |
| frameVersion | 4 | fontVersionB | 0x0C | asLinkageVersion | **7** |
| frameVersionB | **0x18** | fontVersionC | 6 | asLinkageVersionB | **2** |
| frameVersionC | 4 | textVersion | 0x0D | libraryFolderVersion | 7 |
| layerVersion | 4 | textVersionB | 0x0C | libraryFolderVersionB | 4 |
| layerVersionB | 0x0B | textVersionC | 4 | libraryFolderVersionC | 6 |
| spriteVersion | 4 | bitmapVersion | 4 | libraryFolderVersionD | 2 |
| spriteVersionB | 4 | videoStreamVersion | 4 | accessibilityVersion | 2 |
| spriteVersionC | 7 | groupVersion | 4 | shapeVersion | 5 |
| spriteVersionD | 6 | mediaBitsVersion | 6 | generatorVersion | 9 |
| spriteVersionE | 6 | mediaBitsVersionB | 3 | generatorBuild | 494 |
| spriteVersionF | 2 | mediaBitsVersionC | 6 | unicode | true |

> The `CPicFrame` "fs" gate referenced in §11 is **`frameVersionB` = 0x18 (24)**, not
> `frameVersion`. `unicode=true` ⇒ every string is a BomString. `symbolType/shapeType/
> bitmapType/videoType` are the `instanceType` discriminators in the instance header (§5.3).

---

## 4. Primitive encodings

### 4.1 Strings — `CString` / `BomString` — [V] (`FlaWriter.writeString`/`writeBomString`)

```
writeString(s):
  len  = unicode ? (UTF-16 code-unit count) : (byte count)   // see note
  if   len <  0xFF:    u8 len
  elif len <  0xFFFF:  u8 0xFF, u16 len
  else:                u8 0xFF, u16 0xFFFF, u32 len
  body: UTF-16LE code units (unicode) | charset bytes (else)
writeBomString(s):
  if unicode: u8 0xFF, u8 0xFE, u8 0xFF      // "FF FE FF"
  writeString(s)
```

> **Length unit:** for `unicode` (all F8) the length prefix counts **UTF-16 code units** (2
> bytes each), not code points — a non-BMP character is 2 units. Byte length of the body =
> `len * 2`. Empty F8 BomString = `FF FE FF 00` (4 bytes).

Readers must also accept the long escalations (`FF` + u16, `FF FF FF` + u32) and, pre-MX2004,
the BOM-less single-byte form.

### 4.2 Matrix — 24 bytes — [V] (`FlaWriter.writeMatrix`)

`s32 a,b,c,d` each `= round(value × 65536)` (16.16); then `s32 tx,ty` each `= round(value × 20)`
(twips). Order on the wire: `a, b, c, d, tx, ty`.

### 4.3 Color — [V]

`RGBA = u8 R,G,B,A`. Solid fills/strokes use RGBA. The stage background is written `R,G,B,0xFF`
(alpha byte always 0xFF).

### 4.4 `encodedUI` and points — [V] (`FlaWriter.writeEncodedUI` / `writePointPart`)

`encodedUI`: `u16 value` if `< 0x7FFF`, else `u8 0xFF, u8 0x7F, u32 value`. `Point8_24` axis =
`u8 frac, s24 int` (sign-extend the s24 from bit 23). `Point8_8` axis (shape edge BYTE form) =
`u8 frac, s8 int`.

---

## 5. MFC CArchive object protocol

Every stream (catalog and timelines) is an MFC `CArchive` serialization of `CPic*`/`CMedia*`/
`CDocumentPage` objects. **[V]** (`AbstractConverter.useClass`, fla-decoder `ArchiveReader`).

### 5.1 Class/object tag word — [V]

At every object-header position the reader reads a `u16` tag (LE):

| tag value | meaning | trailing |
|-----------|---------|----------|
| `0x0000` | NULL / end-of-children | — |
| `0x0001`–`0x7FFE` | **invalid at a tag position** (see invariant) | — |
| `0x7FFF` (`FF 7F`) | extended backref | `u32 = 0x80000000 + idx` |
| `0x8000 \| idx` | backref to class `idx` (`1 ≤ idx < 0x7FFF`) | — |
| `0xFFFF` | new class declaration | `u16 defineNum` (schema #, default 1) + `u16 nameLen` + `nameLen` ASCII (Windows-1250) bytes |

> **Invariant (assertable):** at an object-header position the tag is exactly one of
> `0x0000`, `0x8000|idx` (with a previously-declared `idx`), `0x7FFF`, or `0xFFFF`. A value in
> `0x0001`–`0x7FFE`, or a backref to an unknown `idx`, means the reader is **mis-aligned** (it is
> inside a record body, not at a header) — trigger resync (§7). Verified on the empty doc:
> `@abs 23 = FF FF | 01 00 | 0D 00 | "CDocumentPage"`.

### 5.2 Reference-index allocation — [V] (`useClass`)

One running counter is shared by classes *and* objects:

```
on a NEW class (0xFFFF):  index(name) = 1 + (#classes declared so far) + (#objects so far)
on EVERY tag read (new OR backref):  totalObjectCount += 1
```

**Worked trace** (a stream that declares CPicPage, then 2 frames, then CPicShape):

```
read   tag           classesBefore  objsBefore   action
  1    FFFF CPicPage        0            0        index[CPicPage]=1+0+0=1 ; objs->1
  2    FFFF CPicFrame       1            1        index[CPicFrame]=1+1+1=3 ; objs->2
  3    8000|3 (CPicFrame)   —            2        backref to idx 3 ; objs->3
  4    FFFF CPicShape       2            3        index[CPicShape]=1+2+3=6 ; objs->4
```

So `CPicShape` is index **6**, and its later backref tag is `0x8006` — *not* `0x8009`. The old
"two fixed slots per class" model only matches when no objects are interleaved; track the running
counter as above.

### 5.3 `instanceHeader` — display-object placement header — [V]

Written immediately after a display object's class tag + leading version byte, for every
`CPicBitmap`/`CPicVideoStream`/`CPicText`/`CPicSprite`/`CPicSymbol`/`CPicButton`, and (with bit
0 used) groups/floating shapes:

```
if (isInstance) u8 stateFlags;     // placed instances only (see table)
u8 0x00, u8 0x00;                   // pad
// registration/transform point:
if (absent)  s32 0x80000000, s32 0x80000000;   // INT_MIN sentinel per axis = "unset"
else         s32 tptX, s32 tptY;               // = round(placeMatrix·pt × 20) twips
if (>= F8)   u8 0x00, u8 cacheAsBitmap;        // 0/1
u8 instanceType;                   // = symbolType 0x13 / shapeType 3 / bitmapType 2 / videoType 4
Matrix placeMatrix;                // 24 bytes (identity if strippedMatrix)
```

`stateFlags` (resolves the historical "CPicObjBase.flags [X]" — it is authoring UI state, **not**
visibility):

| bit | mask | meaning |
|-----|------|---------|
| 0 | 0x01 | `isFloating` (raw shape, not grouped) — group/shape header form only |
| 1 | 0x02 | `selected` (at save time) |
| 2 | 0x04 | `locked` |

Bits 3–7 are always 0. (The generic MFC `CPicObj` base used by container records —
CPicPage/Layer/Shape/Frame — is a different scaffold: `u8 schema; u8 flags;` then the child loop
and a trailing registration point. Do not conflate it with this placement header.)

---

## 6. How to read a FLA  (normative procedure)

```
1.  Open the file as CFB (§2). Read the directory; index streams by name.
2.  Parse the `Contents` stream (§8) → document properties, scene list (play order),
    symbol list, media list, fonts, folders.
3.  For each scene, in Contents play order, open its `Page N <time>` stream (§9) and
    walk its CArchive tree: CPicPage → CPicLayer[] → CPicFrame[] → display objects.
4.  For each library symbol, open its `Symbol N` / `S N <time>` stream and walk it the
    same way (a symbol timeline has the identical CPicPage structure).
5.  Resolve media payloads from `Media N <time>` streams as referenced by id.
```

Walking a CArchive tree (steps 3–4): maintain the §5.2 class table. At each object-header
position read a tag (§5.1); on `0xFFFF` register and dispatch by class name; on a backref
dispatch by the resolved name; on `0x0000` pop to the parent. Each record's body is consumed
field-by-field per its section below — record bodies have **no length prefix**, so a reader must
know every field's size (which is the point of this spec). If a record is not understood, see §7.

---

## 7. Resynchronization  (normative + hazards)

A reader that has consumed a record's body correctly is, by construction, positioned at the next
object-header (§6). Resync is needed only when a record is **deliberately skipped** (e.g. the
imported-SWF `CPicSwf` bulk, §18.3) or when a bug leaves the cursor mis-aligned.

**Resync algorithm:**

```
from the current cursor, scan forward for the next valid object-header (§5.1):
  - a 0xFFFF followed by a plausible class declaration
        (defineNum small, 2 <= nameLen <= 40, name = ASCII starting with 'C'), OR
  - a backref tag 0x8000|idx whose idx is already in the class table AND which is
    immediately followed by a plausible record header for that class.
accept the FIRST candidate that also validates one record ahead (read its body; the
following bytes must again form a valid tag). Otherwise keep scanning.
```

> **HAZARD — do not scan for "end markers" (hard-won; CLAUDE.md).** The 10-byte object-tail
> signature `00 00  00 00 00 80  00 00 00 80` (NULL child tag + two INT_MIN registration points)
> also appears at the **start** of sibling records whose registration point is uninitialized, and
> mid-record inside the `instanceHeader` (§5.3) of any object with an absent transform point. A
> naive end-marker scan therefore re-syncs into the *middle* of a record. Always resync to the
> nearest plausible **class tag** (above), never to an end-marker, and always validate one record
> ahead before accepting.

---

## 8. `Contents` stream — document catalog

Structured layout from `FlaConverter.convert`. F8 order below; `@abs` offsets are for the empty
default document (verified) and shift with preceding variable-length data.

### 8.1 Preamble — [V] (verified `@abs 0`)

```
u8  contentsVersion  = 0x3F         // @abs 0
u8  contentsVersionB = 1
skip(3)   [V*]                      // 00 00 00
if (>= F3) skip(1)  [V*]            // 00
if (>= F4) skip(1)  [V*]            // 00
if (>= F5) u32 0    [V*]
if (>= MX) u32 0    [V*]
if (>= MX2004) u32 0 [V*]
if (>= F8) u32 0    [V*]
if (>= CS3) u32 0   [V*]
if (== CS4) u32 0   [V*]
```

F8 preamble = 23 bytes (`3F 01 00 00 00` + 18 zero); the first scene's `CDocumentPage` class tag
begins at `@abs 23`.

### 8.2 Scene records — `CDocumentPage` (play order) — [V]

Scenes appear in **authored play order** (the `Page N` stream *name* is creation order, not play
order). Each scene record:

```
useClass("CDocumentPage")                 // 0xFFFF first time, else backref (§5.1)
u8  documentPageVersion = 0x17
String pageName                            // unicode writeString, e.g. "Page 1" (NO BOM)
BomString sceneName                        // e.g. "Scene 1"
u16 symbolId = 0;  u16 0;  u8 symbolType = 0   // scenes: id 0, type 0
if (>= F4):
  BomString ""
  skip(15) [V*]    // 01 00 00 00 <documentPageVersionB=06> 00 00 00 01 00 00 00 + parentFolder lead-in
  skip(8)  [V*]    // parentFolderId: itemID (8) or 00x8 when top-level
  skip(4)  [V*]    // 01 00 00 00
  ItemID pageItemID            // 8 bytes (two u32, §8.6)
  writeAsLinkage(scene)        // §8.5 (empty for scenes)
if (>= F4):  u32 timeCreated
fixedPageTail                  // §8.7 — [V*] constant block ending in scaleGrid
```

**Correction vs. older revisions:** the tag string is a **unicode `writeString`** ("Page 1"),
not ASCII "P n time"; after `sceneName` the fields are `u16 symbolId` (not a stream number) +
`u16` + `u8 symbolType`.

### 8.3 Symbol library entries — `CDocumentPage` (symbols) — [V]

```
useClass("CDocumentPage")
u8  documentPageVersion = 0x17
String pageName                            // unicode writeString, "Symbol N"
BomString symbolName
u16 symbolId           // 1-based include index (NOT a stream number)
u16 0;  u8 symbolType  // 0 graphic, 1 button, 2 movie clip
if (>= F4):
  BomString ""
  skip(11) [V*]   // 01 00 00 00 <spriteVersionE=06> 00 00 00 01 00 00 00
  skip(8)  [V*]   // parentFolderId (itemID or 00x8)
  skip(4)  [V*]   // 01 00 00 00
  ItemID itemID                 // 8 bytes
  writeAsLinkage(symbol)        // §8.5
if (>= MX2004) u8 0
if (>= F4) u32 timeCreated
fixedPageTail                   // §8.7
```

### 8.4 Stage / document-properties block — [V] (offsets verified by the oracle)

This is the §8 block the oracle decoded exhaustively. **Ellipsis-free**, every byte named; F8
layout, anchored at the `rulerUnitType` byte (`@abs 400` in the empty doc):

```
// --- F2+ ruler block ---
u8  rulerUnitType         @+0    // 0 in,1 dec-in,2 pt,3 cm,4 mm,5 px   (px default = 5)
u8  0x00                  @+1
u8  (gridVisible ? 3 : 0) @+2
u8  0x00                  @+3
skip(3) [V*]              @+4    // 00 00 00
u16 width  * 20           @+7    // STAGE WIDTH  (twips)   @abs 407
skip(6) [V*]              @+9    // 00 00 00 00 00 00
u16 height * 20           @+15   // STAGE HEIGHT (twips)   @abs 415
skip(4) [V*]              @+17   // 00 00 00 00
u16 gridSpacingX * 20     @+21
u8  previewMode           @+23   // 0 outlines,1 fast,2 antialias,3 antialias-text,4 full
u8  rulerVisible          @+24
u8  pageTabsVisible       @+25
u8  (playOptions<<4)|viewOptions  @+26   // see bitfields below
skip(29) [V*]             @+27   // constant: 00 68 01 00 00 68 01 00 00 68 01 00 00 68 01 00 00
                                 //           01 01 00 00 00 00 01 00 00 00 00 00
u8  bgR, bgG, bgB, 0xFF   @+56   // BACKGROUND color (RGB + FF)   @abs 456
u8  gridR, gridG, gridB   @+60   // grid color (3 bytes; alpha follows)
u8  0xFF                  @+63
u8  0x00                  @+64
u8  fpsFrac               @+65   // FRAME RATE = fix8_8: round((fps-floor(fps))*256)
u8  fpsInt                @+66   //                      floor(fps)            @abs 466
u8  0x00, u8 0x00         @+67
skip(6) [V*]              @+69   // 00 03 b4 00 00 00   ("03 B4" anchor at @abs 470-471)
```

`viewOptions` bits: 1 animControlVisible, 2 buttonsActive, 4 pasteBoardView, 8 livePreview
(MX+). `playOptions` (then `<<4`): 1 loop, 2 playPages, 4 frameActions, 8 playSounds.

**Oracle verification** (`jsfl/stage.jsfl` → `corpus/stage`, per-stream diff): width
550/600/800/1000 → `width*20` = 11000/12000/16000/20000; height 400/500/600 → 8000/10000/12000;
fps 12/24/30 → `fpsInt` = 0x0C/0x18/0x1E; bg `#123456` → `12 34 56`. The whole 75-byte block is
byte-for-byte reproduced by flacomdoc and confirmed against the specimen.

> The previous revision mis-placed the "03 B4" anchor at `@abs 467`; it is at `@abs 470–471`
> (the fps run occupies `@abs 464–468`). Corrected here.

After this block come the property maps (`writeMap`), color definitions (`CColorDef`), QT audio
settings (`CQTAudioSettings`), folders (§8.8), fonts (§8.9), guides, accessibility (§19.2,
`mainDocument`), and a version/XMP trailer.

### 8.5 AS2 linkage — `writeAsLinkage` — [V]

Reused by symbols, scenes, sounds, bitmaps, fonts. **Two packed flag bytes** (not "4 flags"):

```
skip(4) [V*]                       // 00 00 00 00
if (>= F5):
  u8 asLinkageVersion = 7
  u8 flagsA = (exportForAS?1) | (importForRS?2)     // ONLY these two bits
  skip(3) [V*]                     // 00 00 00
  BomString linkageIdentifier
  BomString linkageURL
if (>= MX2004):
  BomString className              // AS2 class name
if (>= MX):
  u8 flagsB = (exportForAS?1) | (exportForRS?2) | (exportInFirstFrame?4)   // NO importForRS bit
  u8 asLinkageVersionB = 2;  skip(3) [V*]   // 00 00 00
  BomString ""
  BomString sourceLibraryItemHRef
  skip(20) [V*]   // 00x8  01 00 00 00  00x4  FF FF FF FF
if (>= F8):
  u8 0x00
  BomString linkageBaseClass
```

> Real Flash 8 occasionally drops `flagsB` bit 2 (exportInFirstFrame) nondeterministically;
> treat it as advisory for byte-matching. Headless JSFL cannot set linkage (the linkage editor
> modal hangs session-0 Flash), so this block is verified from flacomdoc + the read side.

### 8.6 `ItemID` — [V]

8 bytes: `u32 timeCreated, u32 order` (the `"%08x-%08x"` library item id).

### 8.7 `fixedPageTail` — [V\*]

The constant block closing every scene/symbol `CDocumentPage`. For F8 it is a fixed sequence of
constants and empty BomStrings (`FF FE FF 00`) — see `FlaConverter.java:947-1047`. The only
field a reader cares about is its tail: the **20-byte scale-9 grid** (§19.3), which for a symbol
with a grid is `01 00 00 00` + `right,left,bottom,top` (each `u32 ×20`), else `00 00 00 00` +
four `00 00 00 80` sentinels. Everything before it is opaque constants ([V\*]); a reader that
understands the rest of the record can resync at the next class tag, or skip the exact F8 byte
count emitted by the writer.

### 8.8 Folder entries — [V]

`u32 folderCount`, then per folder: `u8 libraryFolderVersionB; skip(3); BomString folderName;
skip(7); ItemID-or-00x8 parentFolderId; skip(4); ItemID; u8 isExpanded; skip(3); …` (version-
gated empty BomStrings + constants, like §8.7). Folder display name is the leaf; nesting via
`parentFolderId`.

### 8.9 Font entries — [V] (F5+)

`u32 fontCount`, then per font: `u8 fontVersion; BomString name; u16 id; u32 timeCreated; u8
fontVersionB; skip(2); String fontFamily; … u8 bold; u8 italic; … (the 0x12 "magic"); ItemID;
parentFolderId; writeAsLinkage`. (Constant runs [V\*].)

---

## 9. Timeline streams

A scene/symbol timeline is its own CFB stream rooted at a `CPicPage` (§10) holding `CPicLayer`s,
each holding `CPicFrame`s. **[V]** Layers are stored **bottom-to-top** (background at binary
index 0); importers that expect top-to-bottom must reverse.

---

## 10. `CPicPage` / `CPicLayer`

### 10.1 `CPicPage` — [V] (`TimelineConverter.convert`)

```
u8 0x01                                  // leading marker
useClass("CPicPage")
u8 pageVersion = 0x04;  u8 0x00
CPicLayer[]                              // emitted REVERSE index order (background first)
// tail:
skip(2) [V*]                            // 00 00
s32 0x80000000, s32 0x80000000          // INT_MIN transform-point sentinel
if (>= F8) skip(2) [V*]                 // 00 00
u8 pageVersionB = 0x07
u16 nextLayerId;  u8 0x00
if (== MX2004) { u16 nextFolderId; u8 0x00 }     // MX2004 ONLY (absent in F8)
if (>= F8) { u16 currentFrame; u8 0x00; skip(3) [V*] }
if (>= F5):
  u32 guideCount
  guide[guideCount] { u32 direction; u32 valueTwips }   // 0=horizontal, 1=vertical (RULER GUIDES)
```

### 10.2 `CPicLayer` — [V]

```
useClass("CPicLayer")
u8 layerVersion = 0x04;  u8 0x00
CPicFrame[]                              // §11
// properties block:
skip(2) [V*]                            // 00 00
s32 0x80000000, s32 0x80000000          // transform-point sentinel
if (>= F8) skip(2) [V*]                 // 00 00
u8 layerVersionB = 0x0B
BomString layerName
if (>= F4):
  u8 isSelected
  u8 hiddenLayer       // 1 = layer hidden (eye off)
  u8 lockedLayer       // 1 = locked
  skip(4) [V*]         // FF FF FF FF
  u8 colR, colG, colB, 0xFF            // outline color
  u8 showOutlines      // outline && useOutlineView
  skip(3) [V*]         // 00 00 00
  u8 heightMultiplier  // row-height multiplier
  skip(3) [V*]         // 00 00 00
u8 layerType           // 0 normal, 1 guide, 2 guided, 3 folder, 4 mask
// layer trailer:
if (>= MX):            // (the pre-F5 mask back-link block is skipped on F8)
  if (parentLayerIndex > -1) encodedUI(parentNValue)   // CArchive obj-index of parent folder/mask
  else                       u16 0                      // no parent (top-level)
  u8 open               // folder/parent expanded
  u8 autoNamed          // name auto-generated
  if (== CS4) u8 animationType         // CS4 only
  // nested normal layers: trailing encodedUI(ancestorNValue) chain links
```

`parentNValue`/`ancestorNValue` are the parent layer's running CArchive object index (§5.2),
not its array index.

---

## 11. `CPicFrame` — [V] header / [O] interleaved tail sub-blocks

`fs = frameVersionB = 0x18 (24)` for F8 (so `fs>=19/22/24` branches all fire). The header,
display list, and leading frame fields (through the `frameVersionC`/`frameId` block) are
byte-walked against a real empty Page stream (`findings/timeline-bytewalk.md`). **The exact
byte ORDER of the F3+ sub-blocks after `frameId` is [O]** (each field is verified, but a strict
byte-walk shows a `BomString` earlier than flacomdoc's grouping implies).

```
useClass("CPicFrame")
u8 frameVersion = 0x04;  u8 0x00
displayObject[]                          // §5.3 each (instances/shapes/text/bitmaps; empty frame = 1 empty shape)
u8 frameVersionB = 0x18                  // [V] the "fs" gate
u16 duration                             // [V]
u16 keyMode                              // [V] §11.1
u16 acceleration                         // [V] classic-tween ease -100..100 as u16
if (>= F2):                              // [V] sound assignment
  u16 soundId                            //   1-based media index, 0 = none
  u16 pointCount; envelope[pointCount] { u32 mark44; u16 lvl0; u16 lvl1 }   // default 1 pt = 0,0x8000,0x8000
  u16 soundLoop;  u8 soundSync           //   sync: 0 event,1 start,2 stop,3 stream
  u32 inPoint44;  u32 outPoint44         //   defaults 0, 0x3FFFFFFF
  u16 soundZoomLevel                     //   default 0xFFFF
if (>= F3)  BomString frameLabel         // [V]
if (>= F5)  { u8 frameVersionC=4; skip(3); u8 0x01; skip(3) } [V*]
if (>= MX)  { u8 (frameId>>8); u8 (frameId&0xFF); skip(6) }   // [V] frameId is BIG-endian here
if (>= CS3) skip(4) [V*]
// ---- F3+ tail sub-blocks: fields [V], interleave order [O] ----
if (>= F3):
  u32 motionTweenRotate (0 none,1 cw,2 ccw);  u16 rotateTimes;  skip(2)
  u32 comment                            // label is a comment
  MorphShape | skip(2)                   // §13 (00 00 if none)
  u8 shapeTweenBlend                     // 0 distributive, 1 angular
  u8 0x00;  u32 0;  BomString ""
if (>= F5)  { skip(4); u8 soundEffect (0..7); skip(3) }
if (>= MX)  u32 anchor                   // label is a named anchor
// ---- frame tail (F8), [V] ----
if (>= F8):
  u32 useSingleEaseCurve                 // 1 = one ease curve for all properties
  u32 hasCustomEase
  if (hasCustomEase) customEaseTable     // §11.2
if (== CS4 && motionObjectXML present):  // absent in plain F8
  BomString motionObjectXML;  u32 visibleAnimationKeyframes;  BomString tweenInstanceName
```

### 11.1 `keyMode` (u16) — [V]

Base normal keyframe `= 0x2600` (KEYMODE_STANDARD); F8 clears `0x2000` (so a plain F8 keyframe
reads `0x0600`, confirmed by byte-walk). Tween bits: `0x0001` motion (classic) tween; `0x0002`
shape tween. Sub-property bits: `0x0100` orientToPath, `0x0200` motionTweenScale, `0x0400`
rotate≠none, `0x0800` sync, `0x1000` snap. (F4- additionally clears `0x4000`.) Import rule:
motion via `&0x0001`, shape via `&0x0002`.

### 11.2 `customEaseTable` — [V]

Six fixed property slots, always in order **position, rotation, scale, color, filters, all**:

```
slot[6] {
  u32 numPoints                          // logical anchor points; 0 if this property has none
  // pairs on the wire = numPoints + 2  (the first and last anchor are each written one EXTRA time)
  f64 pair[numPoints + 2] { f64 x; f64 y }   // x = normalized time 0..1, y = normalized value
}
```

> **Point count (resolves the ambiguity):** a reader given `numPoints` must consume exactly
> `numPoints + 2` `(x,y)` double pairs — the first and last anchors are duplicated on the wire.

### 11.3 Frame script (AS2) — [V]

F5+ stores the frame script as a single `BomString` of plain AS2 source (inside the F5 block).
F4-and-earlier use `FlaWriter.writeScript`, a structured action-record format (**[O]**).

---

## 12. Shapes — `CPicShape` — [V]

```
useClass("CPicShape")
if (>= F5 && group container): { u8 groupVersion=4; u8 ((selected?2)|(locked?4)|(floating?1)) }
instanceHeader               // §5.3, instanceType = shapeType = 3
u8 shapeVersion = 5
u32 totalEdgeCount
u16 fillStyleCount;   fillStyle[fillStyleCount]      // §12.1
u16 strokeStyleCount; lineStyle[strokeStyleCount]    // §12.2
edge[]                       // §12.3 (totalEdgeCount segments across all <Edge>)
u8 0x00                      // post-edge marker
if (>= F5) { u32 cubicCount; cubic[cubicCount] }     // §12.4
```

### 12.1 Fill style — [V] — **discriminator-first**

```
// Read the type discriminator FIRST, at a fixed position, then branch:
//   peek u8 at @+4. bit 0x10 set -> GRADIENT ; bit 0x40 set -> BITMAP ; neither -> SOLID.
//   (For SOLID those first 4 bytes are RGBA, and there is no type byte; for gradient/bitmap
//    @+0..3 is a fixed lead-in and @+4 is the type byte.)
SOLID:    u8 R,G,B,A;  u8 0x00, u8 0x00                          // 6 bytes total
GRADIENT: u8 0x00,0x00,0x00,0xFF;  u8 type;  u8 0x00;            // type @+4: 0x10 linear, 0x12 radial
          Matrix gradientMatrix;  u8 stopCount;
          if (>= F8) { u8 focalRatio; skip(3); u8 (flow|linearRgb); skip(3) }
          stop[stopCount] { u8 round(ratio*255); u8 R,G,B,A }
BITMAP:   u8 0xFF,0x00,0x00,0xFF;  u8 type;  u8 0x00;            // type @+4: 0x40/0x41/0x42/0x43
          Matrix bitmapMatrix;  u16 bitmapId
```

`flow`: 0 extend, 4 reflect, 8 repeat; `+1` for linearRGB interpolation. Bitmap `type` low bits:
0x40 tiled, 0x41 clipped, 0x42 tiled-no-smooth, 0x43 clipped-no-smooth. There is **no 0x20
subtype**. The lead-in's last byte must be `0xFF` or Flash drops the fill.

> A reader cannot distinguish SOLID from gradient/bitmap by `@+0` alone (it is R or a lead-in
> byte). Use the rule above: test `@+4 & 0x10` / `& 0x40`; if the bytes don't reach `@+4` as a
> valid gradient/bitmap, it is SOLID (6 bytes). In practice fill arrays are homogeneous per
> shape and the count is known, so mis-branching is detectable by length.

### 12.2 Line style (LINESTYLE / LINESTYLE2) — [V]

```
u8 R,G,B,A                       // line color
u16 widthTwips
u16 styleParam1;  u16 styleParam2   // dash/dot/ragged/stipple/hatch params (bit-packed; low 3 bits = style id)
if (>= F8):
  u8 pixelHinting; u8 scaleMode(0 normal,1 h,2 v,3 none); u8 capStyle(0 none,1 round,2 sq);
  u8 joinStyle(0 miter,1 round,2 bevel); u8 miterFrac; u8 miterInt
  fillStyle trailingFill           // §12.1 (solid -> RGBA+0000; bitmap -> bitmap fill)
```

Pre-F8 stroke = 10 bytes (no caps/joins/miter, no trailing fill). `styleParam2 + 0x8000` =
sharp corners (MX+).

### 12.3 Edge stream — [V]

Each `<Edge>` carries `(strokeStyle, fillStyle0, fillStyle1)` and an edge string. Per edge
record, first a **type byte** (bitfield), then optional style-change, then coordinates:

```
typeByte (u8):
  bit 7    0x80  noSelection
  bit 6    0x40  hasStyles
  bits 5-4       TO   coord size:  01=BYTE(0x10), 10=FLOAT(0x20), 11=SHORT(0x30)
  bits 3-2       CTRL coord size (curve only): 01=BYTE(0x04), 10=FLOAT(0x08), 11=SHORT(0x0C)
  bits 1-0       FROM coord size (only if from != 0,0): 01=BYTE(0x01), 10=FLOAT(0x02), 11=SHORT(0x03)
if hasStyles:    u8 strokeIdx [u8 sel];  u8 fill0Idx [u8 sel];  u8 fill1Idx [u8 sel]   // ORDER: stroke, fill0, fill1
[ from ] [ control ] to          // present per the size fields; each via the coord form below
if (>= CS3 && straight) u8 generalLineFlag       // absent in F8
```

Coordinate forms per axis: **BYTE** = `Point8_8` (u8 frac, s8 int; 8.8 twips, 1px=5120); **SHORT**
= `s16 = round(v*2)` (15.1); **FLOAT** = `u8 frac, s24 int`. Coordinates are **deltas** from the
pen; a leading (0,0) moveTo is omitted.

### 12.4 Cubic post-stream — [V] (F5+)

```
u32 cubicCount
cubic[cubicCount] {
  s32 mx,my, x1,y1, x2,y2, ex,ey         // 32 bytes: move, 2 controls, end (plain twips)
  if (>= CS3) { u8 segCount; seg[segCount]{s32 x,y; u8 onCurve; u8 line}; u8 pnFlags; opt prev/next BCP }  // absent in F8
}
```

---

## 13. Morph shapes — `CPicMorphShape` — [V]

On a frame with a shape tween:

```
useClass("CPicMorphShape")
skip(57) [V*]                            // two identity-ish matrices/flags (opaque constants)
u16 segmentCount
segment[segmentCount] {
  useClass("CMorphSegment")
  u32 strokeIdx1, strokeIdx2, fillIdx1, fillIdx2     // 0xFFFFFFFF = none
  Point8_24 startA;  Point8_24 startB
  u16 curveCount
  curve[curveCount] {
    useClass("CMorphCurve")
    Point8_24 ctrlA, anchorA, ctrlB, anchorB
    u8 isLine;  skip(3) [V*]            // 00 00 00
  }
}
u16 0x0000                               // segment-list terminator
u16 fillCount;   morphFill[fillCount]    // §13.1
u16 strokeCount; morphStroke[strokeCount]// §13.2
```

### 13.1 Morph fill — [V] — discriminator-first

```
// peek u8 at @+0: 0x00 -> solid/null lead; 0xFF -> bitmap lead. Then the type word distinguishes.
null:     u8 0x00,0x00,0x00,0x00;  u16 0x0000
SOLID:    u8 R,G,B,A;              u16 0x0000
GRADIENT: u8 0x00,0x00,0x00,0xFF;  u16 type(0x10/0x12);  Matrix;  u8 stopCount; stop[]{u8 ratio; RGBA}
BITMAP:   u8 0xFF,0x00,0x00,0xFF;  u8 type(0x40..0x43); u8 0x00;  Matrix;  u16 bitmapId
```

Note the gradient `type` is **u16** here (vs u8 in §12.1) and there is no F8 focal/flow block.

### 13.2 Morph stroke — [V]

Each record is 10 bytes: `u8 R,G,B,A; u32 round(weight*20); u16 0x0000`. Empty-stroke fallback:
count 1 (F8) with one zeroed 10-byte record (MX- writes count 2).

---

## 14. Symbol instances — `CPicSprite` / `CPicButton` / `CPicSymbol` — [V]

Class by `symbolType`: graphic→`CPicSymbol`, button→`CPicButton`, movieclip→`CPicSprite`.

```
useClass(<class>)
u8 spriteVersion = 4
instanceHeader            // §5.3, instanceType = symbolType = 0x13 (carries matrix, cacheAsBitmap, selected/locked)
u16 firstFrame            // graphic only (0-based)
u8 loopMode               // MC=0x02; button=0x00; graphic: loop 0 / playOnce 1 / singleFrame 2
u8 0x00
if (>= F4) u8 0x01
if (>= F2) colorEffect    // §19.1
if (>= F3) BomString ""
u16 libraryItemIndex      // 1-based into library symbols
u8 0x00, u8 0x00          // [O] (libraryItemIndex hi-extension?)
if (>= MX2004) skip(3) [V*]
if (>= F8) { filterList (§16); u8 blendMode; u8 0x00, u8 0x00 }   // §14.1
// --- per-class tail ---
graphic:    (none — record ends here)
movieclip:  u8 spriteVersionG=8; skip(7)[V*]; u16 symbolInstanceId; if(>=CS3) skip(4);
            skip(6)[V*]; BomString clipScript; BomString instanceName; skip(9)[V*];
            writeAccessibleData (§19.2); skip(7)[V*]; componentMetadata (§15)
button:     skip(11)[V*]; if(>=MX){u16 symbolInstanceId; if(>=CS3)skip(4); skip(6)};
            BomString clipScript; u8 trackAsMenu; BomString instanceName;
            writeAccessibleData; skip(4)[V*]
```

(CS4 inserts a 3-D matrix/rotation block in the common prefix; not laid out here.)

### 14.1 Blend mode byte → name — [V]

`0` unset, `1` normal, `2` layer, `3` multiply, `4` screen, `5` lighten, `6` darken, `7`
difference, `8` add, `9` subtract, `10` invert, `11` alpha, `12` erase, `13` overlay, `14`
hardlight.

---

## 15. Component metadata — [V]

For MX2004+ movieclip/sprite instances only:

```
u8 0x01;  u32 0                  // u32 resets on resave
BomString componentXML           // "<component metaDataFetched='true' schemaUrl='' schemaOperation=''
                                 //   sceneRootLabel='Scene 1' oldCopiedComponentPath='N'>\n</component>\n"
```

A populated component fills `schemaUrl`/`schemaOperation` and child nodes.

---

## 16. Filters

### 16.1 SWF-wire filters — [V]

The runtime/SWF filter records follow the Adobe SWF spec wire format (Ruffle `swf` crate).

### 16.2 FLA-authoring filter list — [V] (F8+ instance/text tail)

```
if (filters present): u8 0x01;  u32 filterCount;  filter[filterCount]
else:                 u8 0x00
```

Each `filter` = a per-type ID tag + fixed sub-header, then `u32 enabled`, then fields (u32 ints;
f32 floats; angles in radians; `strengthPercent = round(strength*100)` as u16-in-u32):

```
DropShadow   (00, 04 01):   enabled; RGBA; f32 distance,blurX,blurY,angle; u32 inner,knockout,quality; u16 strength,skip(2); u8 hideObject,skip(3)
Blur         (01 03,04 01): enabled; skip(4)[V*]; skip(4 const)[V*]; f32 blurX,blurY; skip(4)[V*]; skip(8)[V*]; u32 quality; skip(8)[V*]   // only blurX/Y/quality meaningful
Glow         (02 03,04 01): enabled; RGBA; skip(4)[V*]; f32 blurX,blurY; skip(4)[V*]; u32 inner,knockout,quality; u16 strength,skip(2); skip(4)
Bevel        (03 03,04 01): enabled; RGBA shadow; f32 distance,blurX,blurY,angle; u32 (type==inner),knockout,quality; u16 strength,skip(2); skip(4); RGBA highlight; u32 (type==full)
GradientGlow (04 01,04 01): enabled; skip(4)[V*]; f32 distance,blurX,blurY,angle; u32 inner,knockout,quality; u16 strength,skip(2); skip(4); u32 gradCount; skip(4); u32 full; entry[gradCount]{u32 round(ratio*255); RGBA}
GradientBevel(07 01 01,04 01): as GradientGlow (gradient-entry alpha is buggy in CS5 — [O])
AdjustColor  (06 01 01):    enabled; f32 brightness,contrast,saturation,hue
```

Bevel `type`: 1 inner, 2 outer, 3 full.

---

## 17. Text — `CPicText` — [V]

```
u8 textVersionC = 4
instanceHeader            // §5.3, instanceType = textVersion = 0x0D
u32 left*20, u32 (left+width)*20, u32 top*20, u32 (top+height)*20    // bounds (twips)
u8 autoExpand
if (>= F3) u8 0x00
if (>= F4) u8 textFlags                 // §17.1
u8 embedFlag                            // §17.2
if (>= F5) { u8 staticFlags; u8 0x00 }  // static: bit0 selectable, bit1 device-font(CS3+); non-static 0
if (>= F4) { u16 maxCharacters; BomString variableName }
if (embeddedCharacters) BomString embeddedCharacters
textRun[]                               // §17.3
// tail:
u16 0x0000
if (>= MX) { BomString instanceName; writeAccessibleData; skip(4); u8 scrollable; skip(3) }
if (>= MX2004) { BomString ""; BomString embedRanges }     // ranges joined by "|"
if (>= F8) { filterList (§16); u16 0x0000 }
```

### 17.1 `textFlags` (u8) — [V]

`0x01` non-static; `0x02` dynamic; `0x04` password; `0x08` word-wrap; `0x10` multiline; `0x20`
includeOutlines; `0x40` border; `0x80` (dynamic && renderAsHTML && !selectable). **selectable**
= bit0 of `staticFlags`; **scrollable** = the byte in the MX tail above.

### 17.2 `embedFlag` (u8) — [V]

bit0 font embedded; bits1–4 embed ranges 1..4 (`1<<rangeId`); 0x20 embeddedCharacters present;
0x40 isEmpty; 0x80 renderAsHTML (F5+).

### 17.3 Text run (per merged run) — [V]

```
u16 charCount (if non-empty)
u8 textVersionB = 0x0C
u16 size*20
String fontFamily        (BomString in CS4)
u8 R,G,B,A
u8 0x12, u8 0x00         // [O] font-class flags (family-dependent)
u8 bold, italic, 0x00, autoKern, charPosition(0 norm,1 super,2 sub), alignment(0 L,1 R,2 C,3 J)
u16 lineSpacing*20, indent*20, leftMargin*20, rightMargin*20
if (>= F5) u16 letterSpacing*20    else u8 0x00
String url
if (>= MX) { u8 vertical, rightToLeft, rotation }
if (>= MX2004) u8 (renderMode==BITMAP)
if (>= MX) String target
if (>= F8) { u8 0x02; u8 renderMode; f32 antiAliasThickness; f32 antiAliasSharpness (or 8 zero if device); String url }
characters               // UTF-16LE (unicode) / charset bytes
```

---

## 18. Media display objects

### 18.1 `CPicBitmap` — [V]

```
u8 bitmapVersion = 4
instanceHeader            // §5.3, instanceType = bitmapType = 2
u16 mediaId               // 1-based into name-sorted media list
if (>= MX2004) u8 0x00    // (filter flag, 0)
```

No width/height/scale fields: display scale lives in the placement matrix; intrinsic pixel size
in the library item; smoothing is a fill-style property, not a placement byte.

### 18.2 `CPicVideoStream` — [V]

```
useClass("CPicVideoStream")
u8 videoStreamVersion = 4
instanceHeader            // §5.3, instanceType = videoType = 4
u32 frameLeft, frameRight, frameTop, frameBottom    // crop rect
u8 0x00
BomString ""
BomString name            // instance name
u32 0x00000001
u16 videoId               // 1-based media index
```

(The embedded-clip `CPicVideo` is a distinct class flacomdoc never emits — **[I]**.)

### 18.3 `CPicSwf` (imported SWF) — header [O] / bulk [X] (bounded)

A **legacy** record: Flash 8 `Import to Stage` of a `.swf` breaks the movie apart into
shapes/symbols and never creates a `CPicSwf` (verified by manual import). Magnet's records were
authored in older Flash and upgraded; the record is **not freshly producible** and is out of the
authoring round-trip. No writer exists (flacomdoc has no SWF-import path); structure below is
**observed** by differential analysis of Magnet's four `CPicSwf` records (the reused "Claw" SWF).
Class facts (Ghidra): `CPicSwf : CPicObj`, class size 308 B, `serialize` VA `0x9490400`.

```
useClass("CPicSwf")
instanceHeader            // §5.3 (selected/locked, matrix) — per-placement; differs per instance
// SWF-intrinsic metadata (constant across reuse) — [O]:
u32 swfWidthTwips         // e.g. 0x10b6 = 4278 ≈ 213 px
u32 swfHeightTwips        // e.g. 0x6ec  = 1772 ≈  88 px
u32 sizeWordA             // e.g. 0x13cc6 (=81094); appears twice
skip(N) [X]               // further bounds/count words (0xbe1, 0x5dc, 0x1e, markers) — exact layout unknown
BomString clipActions     // onClipEvent(...) handlers
skip(M) [X]               // decomposed-content bulk (~900-5400 B): Flash's internal movie repr (NOT raw SWF)
```

**Residual.** Header/metadata/clip-actions are **[O]**; the trailing bulk is **[X]** — a reader
must resync past the record (§7), never byte-walk it. Full decode would require Ghidra at the
cited VA; disproportionate for a legacy, out-of-scope record.

---

## 19. Color transform, accessibility, scale-9

### 19.1 Color effect — [V]

```
if (>= F3):
  u16 alphaMul, alphaOffset, redMul, redOffset, greenMul, greenOffset, blueMul, blueOffset
  u8 type, u8 0x00
  u16 valuePercent
  u8 effectColor R,G,B,A
```

Multipliers are s16 with **256 = 1.0**. `type`: 0 none, 1 brightness, 2 tint, 3 advanced, 4
alpha. (Brightness → RGB-mul `round((1-|b|)*256)`; tint → RGB-mul `round((1-amt)*256)`, RGB-off
`round(color*amt)`; alpha → alphaMul `round(a*256)`; advanced → muls `round(v*256)`, offsets
verbatim.)

### 19.2 Accessibility — `writeAccessibleData` — [V]

If no data: a single `0x00` (main document only), else nothing. Else:

```
u8 accessibilityVersion = 2;  u8 0x00
skip(2); u8 silent; skip(3)              // silent = "make object accessible" inverted
BomString name;  BomString description;  BomString shortcut
if (>= MX2004) { BomString tabIndex; BomString "" }     // tabIndex stored as string
u8 forceSimple; skip(3)                  // "make child objects accessible" inverted
if (mainDocument) u8 (autoLabeling ? 0 : 1)
```

### 19.3 scale-9 grid — [V] (F8+, in the symbol `fixedPageTail`)

```
if (any edge != 0):  u32 1;  u32 right*20;  u32 left*20;  u32 bottom*20;  u32 top*20
else:                u32 0;  (s32 0x80000000) x4
```

---

## 20. Gap status

Every gap from revision 1 is resolved to **[V]** except the legacy `CPicSwf` bulk.

| Area | Now | Where |
|------|-----|-------|
| instance/placement flags (old "CPicObjBase.flags") | [V] | §5.3 |
| Contents catalog (preamble/scenes/symbols/media/fonts/folders) | [V] | §8 |
| stage W/H/bg/fps | [V] (oracle-verified) | §8.4 |
| symbol linkage flag bytes | [V] | §8.5 |
| scale-9 grid | [V] | §19.3 |
| sound / font / media entries | [V] | §8.5/8.9 |
| CPicFrame fields (incl. ease, keyMode) | [V] fields; [O] tail interleave | §11 |
| custom-ease point count | [V] (`numPoints+2` pairs) | §11.2 |
| 0x20 fill subtype | [V] (no such subtype) | §12.1 |
| shape cubic post-stream | [V] | §12.4 |
| morph curve/segment/fills/strokes | [V] | §13 |
| FLA-authoring filters | [V] | §16.2 |
| component metadata | [V] | §15 |
| accessibility / text scrollable+selectable | [V] | §17/§19.2 |
| layer trailer / CPicPage guides table | [V] | §10 |
| `CPicVideoStream` | [V] (embedded `CPicVideo` [I]) | §18.2 |
| `CPicSwf` body | header [O] / bulk [X] (legacy, out of scope) | §18.3 |

---

## 21. Verification

* **Reader** `tools/flashdrv/flaparse.py` parses the §8 catalog + CArchive class inventory of
  Magnet (6 scenes in play order, 61 symbols, 16 classes), golden, and evaporatingdrip
  (`findings/read-proof.txt`).
* **Timeline byte-walk** `findings/timeline-bytewalk.md` reconciles every byte of a real empty
  Page stream against §5/§10/§11/§12.
* **Stage block** §8.4 confirmed by oracle ramps (`corpus/stage`, `fladiff.py`).
* **Write round-trip** `flapatch.py` rewrites §8.4 stage fields by this spec; real Flash 8 reads
  them back exactly (640×480, 30fps, `#123456`) — `findings/write-proof.txt`.

---

## 22. Provenance

* **JPEXS `flacomdoc`** — byte-verified XFL→binary-FLA writer (authoritative field order).
* **`eddiemoore/fla-decoder`** — Ghidra RE of `flash.exe` (CArchive protocol, schema gates).
* **flashdrv oracle** — real Flash 8 differential oracle (Win7 VM).
* **Ruffle `swf` crate** — SWF-wire filter/shape encodings the FLA reuses.
* **[MS-CFB]** — OLE2 container. **Adobe SWF spec** — twips/fixed-point/filters.
