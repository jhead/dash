# 21 — Binary FLA Format (Flash 5 – CS4) — Reverse-Engineering Spec

Reference for the proprietary Macromedia/Adobe binary `.fla` format as decoded by
`packages/core/src/fla/` (`ole.ts`, `flash8-binary.ts`, `flash8-import.ts`). This is a
**read-only import** spec; write-back is out of scope.

This document is deliberately explicit about **confidence**. Most of this format is
undocumented; what follows is reconstructed from (a) JPEXS `flacomdoc` (an XFL→binary-FLA
*writer* byte-verified against real Flash output), (b) `eddiemoore/fla-decoder` (Ghidra RE
of `flash.exe`), and (c) a handful of real fixture FLAs. Every record/field is tagged.

---

## 0. Confidence legend

| Tag | Meaning |
|-----|---------|
| **[V]** | **Verified.** Byte-checked against `flacomdoc` (a verified writer), against the SWF published from the same FLA, or against a confirmed fixture. |
| **[O]** | **Observed.** Derived from one or more real fixture FLAs (Magnet.fla, golden, etc.) but not cross-checked against an independent writer. May be specimen-specific. |
| **[I]** | **Inferred.** Best-effort layout with **no confirming fixture**. Bit/byte assignments are guesses consistent with XFL semantics; could be wrong. |
| **[X]** | **Unknown / not decoded.** Bytes are skipped or scanned past. We cannot read the value, only re-sync after it. |

Confidence is annotated **per field**. When a whole record is one tag, it is noted at the
record header.

---

## 1. Notation (IDL)

Pseudo-C struct notation used throughout. Little-endian unless stated.

```
Scalar types
  u8 u16 u32            unsigned LE integers
  s16 s32               signed LE integers (two's complement)
  f32 f64               IEEE-754 LE
  fixed16 = s32 / 65536   16.16 fixed point
  fixed8  = s16 / 256     8.8  fixed point

Composite types (see §4)
  CString               MFC length-prefixed string (ASCII or UTF-16, several encodings)
  BomString             FF FE FF–prefixed UTF-16LE string (subset of CString)
  Matrix                6 fields: a,b,c,d (fixed16) + tx,ty (s32 twips)
  RGBA                  4×u8 in R,G,B,A order

Annotations
  field;        // [V|O|I|X] note
  skip(n)       // n bytes consumed but not interpreted ([X] by definition)
  if (cond)     // schema-gated presence
  field[count]  // array
  @0xNN         // absolute byte offset within the record/stream
```

**Units** (critical — three different coordinate scales coexist):

| Context | Unit | Conversion | Confidence |
|---------|------|-----------|------------|
| Matrix `tx`/`ty` | SWF twips | px = v / 20 | [V] |
| Shape edge coords | **8.8 fixed twips** | px = v / 5120 | [V] (vs SWF bounds) |
| `CPicMorphShape` coords | SWF twips | px = v / 20 | [O] |
| Text box bounds, sizes, margins | SWF twips | px = v / 20 | [V] |
| scale9Grid | SWF twips | px = v / 20 | [O] |

---

## 2. Container: OLE2 / CFB

Standard Microsoft Compound File Binary. Fully specified externally; **[V]** against the
CFB spec. Parser: `ole.ts`.

```
Header @0                         (always 512 bytes for v3)
  u8[8]  magic           @0    = D0 CF 11 E0 A1 B1 1A E1    // [V]
  u16    sectorSizePow   @30   sectorSize  = 1 << pow  (512 or 4096)
  u16    miniSectorPow   @32   miniSector  = 1 << pow  (usually 64)
  u32    fatSectorCount  @44
  u32    firstDirSector  @48
  u32    miniStreamCutoff@56   usually 4096
  u32    firstMiniFat    @60
  u32    miniFatCount    @64
  u32    firstDifat      @68
  u32    difat[109]      @76   first 109 FAT-sector pointers
```

Sector addressing: `fileOffset = 512 + sector * sectorSize` (header occupies the first
512 regardless of sectorSize).

Special FAT values: `ENDOFCHAIN=0xFFFFFFFE`, `FREESECT=0xFFFFFFFF`, `FATSECT=0xFFFFFFFD`,
`DIFSECT=0xFFFFFFFC`. Directory entry types: `1=storage 2=stream 5=root`.

**Mini-FAT [V]:** streams with `size < miniStreamCutoff` (≈4096) do **not** live in the
main FAT. They occupy 64-byte mini-sectors carved out of the **root entry's** stream,
indexed by the mini-FAT. Most `Page N`/`Symbol N` streams are small and live here; reading
them via the main FAT yields garbage. This is the single most common parsing pitfall.

Directory entry (128 bytes each):
```
  u16  nameLen   @64    (bytes incl. NUL terminator; chars = (nameLen-2)/2)
  utf16 name     @0     (nameLen/2 - 1 chars)
  u8   type      @66
  u32  leftSib   @68
  u32  rightSib  @72
  u32  childId   @76
  u32  startSector @116
  u32  sizeLo    @120
```

Streams are collected by walking the red-black sibling/child tree from the root. We do not
rely on tree ordering for semantics — only the **stream name** matters.

---

## 3. Stream inventory

| Stream name | Payload | Parsed by | Confidence |
|-------------|---------|-----------|------------|
| `Contents` | Document props + library catalog (scan-based) | `parseFla8Contents` | mixed (see §6) |
| `Page N` | Scene timeline (CArchive) | `parseFla8Timeline` | §7–§9 |
| `Symbol N` / `S N M` | Symbol timeline (CArchive) | `parseFla8Timeline` | §7–§9 |
| `Media N` | Bitmap / audio / FLV payload | `media.ts` (decode), not CArchive | bitmap/audio [O] |
| `Sound N` | Raw audio (pre-CS4) | `media.ts` | [O] |
| `Font N` | Embedded-font catalog entry (in `Contents`, not a CArchive body) | §6.6 | [O] |
| `Video N` | Catalog entry referencing a `Media N` FLV | §6.5 | [O] |

Short-form stream names (`P N M`, `S N M`, `So N M`, `Vi N M`) appear in some versions and
are matched alongside the long forms.

---

## 4. Primitive encodings

### 4.1 Strings — `CString` (`readCString`)

MFC `CArchive::ReadString`-style, multiple encodings selected by the first byte(s). **[V]**
(all four branches exercised by fixtures):

```
b = u8
  b == 0x00            → ""  (empty)
  b <  0xFF            → ASCII, length = b
  b == 0xFF:
     ext = u16
     ext == 0xFFFE     → UNICODE "BomString": then
                            len = u8; if len==0xFF { len=u16; if len==0xFFFF len=u32 }
                            UTF-16LE chars[len]
     ext == 0xFFFF     → ASCII long: len=u32, chars[len]
     else              → ASCII, length = ext
```

`BomString` is the `FF FE FF <len> <utf16…>` subset. Unicode strings appear in **MX2004+**
(formatVersion ≥ 0x38). Earlier versions use bare ASCII length-prefix.

`readPlainString(unicode)` — a **variant without the BOM marker** used *inside* `CPicText`
runs: `len=u8 (0xFF/0xFFFF extensions)` then `chars[len]` as ASCII or UTF-16LE per the
`unicode` flag. **[V]** vs flacomdoc `writeString`.

### 4.2 Matrix (`readMatrix`) — 24 bytes — **[V]**

```
struct Matrix {
  fixed16 a, b, c, d;     // 16.16
  s32     tx_twips;       // px = tx_twips / 20
  s32     ty_twips;
}
```

### 4.3 Color (`readColorRGBA`) — 4 bytes — **[V]**

```
struct RGBA { u8 r, g, b, a; }   // wire order R,G,B,A (vs flacomdoc writeSolidFill)
```

---

## 5. MFC CArchive object protocol

`Page N` / `Symbol N` stream bodies are MFC `CArchive` serializations of C++ objects
(`CPicPage`, `CPicLayer`, `CPicFrame`, `CPicShape`, …). Parser: `ArchiveReader`.

### 5.1 Class/object tag word (`readClassTag`) — **[V]**

Each object header is a `u16` tag:

| Tag value | Meaning | Follows |
|-----------|---------|---------|
| `0x0000` | NULL — end of a children list / null object | — |
| `0xFFFF` | NEWCLASS — first declaration of a class | `u16 schema`, `u16 nameLen`, `ASCII name[nameLen]` |
| `0x7FFF` | extended backref | `u32 index` |
| `tag & 0x8000` | backref to class index `tag & 0x7FFF` | — |
| else | **bad tag** → triggers recovery (§13) | — |

### 5.2 Reference-index allocation — **[V]** (mirrors flacomdoc `useClass`)

A **single** monotonically increasing counter assigns indices. On **every** object header
(NEWCLASS or backref), `objectCount++`. At a class's first declaration its index is fixed:

```
index(class) = 1 + (#classes declared before) + (#objects serialized before)
```

That index is reused by every later backref `0x8000 | index`. The older "two fixed slots
per class" model is **wrong** in general — it only coincides when no objects are serialized
between class declarations. Example: in `Magnet.fla` Symbol 13, `CPicShape` = index 16 (not
9), so its backref tag is `0x8010`. Getting this wrong mis-reads backrefs as bad tags.

### 5.3 `CPicObjBase` — base of every display record (`readCPicObjBase`) — **[V]** structure

```
struct CPicObjBase {
  u8  schema;
  u8  flags;                       // see note below
  // children loop:
  loop {
    tag = readClassTag()
    if (tag == NULL) break
    if (tag == backref-to-object) continue
    if (tag == bad) { recover (§13); badTag=true; break }
    child = deserializeClass(tag.name)   // dispatch by class name
  }
  if (!badTag) {
    if (schema > 0) { s32 regX; s32 regY }   // INT_MIN (0x80000000) sentinel = "absent"
    if (schema > 2) skip(1)
    if (schema > 3) skip(1)
  }
}
```

**`flags` byte is NOT a per-object visibility bit. [V]** (task 1190 supersedes 0932.) In
the golden fixtures 17/19 objects have `flags=0x0`, 2 have `flags=0x3`, and **all** render
visible in the reference SWF. Flash 8 has no per-display-object hide control (visibility is
a *layer* property + runtime `_visible`). `visibleFromObjBaseFlags()` returns `true`
unconditionally. The true meaning of these bits is **[X] unknown**.

**Registration point [V]:** `regX/regY` are in FLA twips and equal the placement position;
`INT_MIN` means "unset". Do **not** subtract them from a PlaceObject x/y (task 1191).

---

## 6. `Contents` stream — document catalog

**The `Contents` parser is scan/heuristic-based, not a structured walk.** It locates fields
by byte-pattern search and fixed offsets, because the surrounding `CDocument*` record
layout is only partially understood. This makes the whole stream **[O] at best**, and
several sub-fields **[I]**. `formatVersion = Contents[0]`; `unicode = formatVersion ≥ 0x38`;
`scale9Grid present = formatVersion ≥ 0x3F`.

### 6.1 Stage / frame-rate / background — **[O]** (anchor heuristic)

flacomdoc writes a fixed run; we anchor on the literal `03 B4 00 00 00` and read backwards:
```
  … bgR bgG bgB FF  gridR gridG gridB FF  00  fpsFrac fpsInt  00 00 00  03 B4 00 00 00
  anchor-14 …                                  anchor-5  -4              anchor@
  frameRate = fpsInt + fpsFrac/256   (accepted only if 1..120)
  background = (bytes[anchor-14..-12], a=255)
```
Stage size **[O]**: searched in the 256-byte window before the anchor — `u16 width*20`, 6
zero bytes, `u16 height*20`, 4 zero bytes. Picks the match closest to the anchor.
**Gap:** if these patterns are not found, width/height/fps/bg come back `null` and defaults
(550×400, 12fps, white) are used.

### 6.2 Scene names — **[O]**

Scan for stream-name strings `Page N` / `P N M` (UTF-16 if unicode, else ASCII), validated
by regex `^(Page \d+|P \d+ \d+)$`, then read the **scene display name** as the immediately
following `BomString` (or ASCII CString pre-MX2004). Stored as
`Map<streamName → displayName>`, **key order = Contents byte order = authored play order**
(see §15.1).

### 6.3 Symbol library entries — partly **[V]**, partly **[I]**

Per symbol, located by scanning for `Symbol N` / `S N M` then the next `BomString`:

```
  BomString displayName                        // [O]
  @end+0  u32 streamNumber    (redundant)       // [O]
  @end+4  u8  typeByte        0=graphic 1=button 2=movieclip   // [O]
  @end+5  BomString linkageIdentifier (heuristic copy)         // [O]
          u8 exportInFirstFrame                 // [I] order best-effort
          u8 exportForActionScript              // [I]   (only the all-false
          u8 exportForRuntimeSharing            // [I]    case is confirmed)
          u8 importForRuntimeSharing            // [I]
  @end+41 writeAsLinkage block:                 // [V] offset vs flacomdoc + fixtures
            u32 = 0x00000000   (validates the offset)
            u8  asLinkageVersion   (5=MX2004, 7=F8/CS3)
            u8  flags  (bit0=exportForAS, bit1=importForRS)
            u8[3] = 0
            BomString linkageIdentifier   (authoritative)
            BomString linkageURL
            BomString className           ← AS2 class name
            u8 versionIndicator
            u32 = 2 (observed)
            BomString sourceFlaPath
            BomString fullLibraryPath     ← "FolderA!/Nested!/SymbolName"
```

`className` lives in the `writeAsLinkage` block **[V]** (an earlier hypothesis that it lives
in the `Symbol N` `CPicPage` afterData is superseded). `fullLibraryPath` segments are `/`
-separated; a trailing `!` marks a folder expanded in the UI and is stripped (§15.4).

**scale9Grid [O]** (formatVersion ≥ 0x3F): located by scanning forward from the linkage
flags for the 16-byte anchor
`FF FE FF 00 · FF FE FF 00 · 00 00 00 00 · FF FE FF 00`, then 20 bytes follow:
```
  u32 toggle   (1=enabled, 0=disabled)
  u32 right    (twips)   u32 left   u32 bottom   u32 top
  // disabled: toggle=0, all = 0x80000000
```

### 6.4 Sound entries — **[O]/[I]**

Two discovery paths:
1. **`Sound N` stream names** (pre-CS4): name → `BomString` displayName, then optional
   `u32 streamNumber`, `BomString linkageId`, `u8 exportForActionScript`. Trailing flag
   order **[I]**.
2. **`CMediaSound` CArchive objects** (F8/CS-era, e.g. Magnet.fla): discovered empirically —
   find the `CMediaSound` `FFFF` class decl, register the inline body, then discover the
   backref tag by elimination against `CMediaBits`, then scan all
   `[backref][schema=6][nameLen]["Media N"][BomString name]` bodies. **[O]**, fragile.

### 6.5 Video entries — **[O]**

Scan `Video N` / `Vi N M` → `BomString` displayName. The number matches a `Media N` FLV
payload and the `mediaId` in each `CPicVideo` element.

### 6.6 Font entries — **[O]** (Magnet.fla CS2 only)

`Font N` is encoded as a `BomString` stream reference (not followed by a name BomString
like other items). The family name sits at a **fixed offset** after it:
```
  @end+0  u16 streamNumber
  @end+2  u32 hash/timestamp        // [X]
  @end+6  u16 schema/flags          // [X]
  @end+8  u8  flag                  // [X]
  @end+9  u8  fontNameLen           // chars
  @end+10 utf16 fontName[fontNameLen]
```

---

## 7. Timeline streams — top-level structure

`parseFla8Timeline` (used for both `Page N` and `Symbol N`):

```
  u8 = 0x01                       // root marker (else: throw)   [V]
  tag = NEWCLASS "CPicPage"       // else: throw                 [V]
  CPicPage
```

Tree:
```
CPicPage
└── CPicLayer*            (one per layer, BOTTOM-TO-TOP order — §15.2)
    └── CPicFrame*        (one per keyframe span)
        └── <element>*    (CPicShape | CPicSprite | CPicButton | CPicSymbol |
                           CPicText | CPicBitmap | CPicVideo | CPicSwf)
```

Each node is a `CPicObjBase` (§5.3) whose children list holds the next level down. Elements
also carry an inherited `CPicShape` body (frame-level merge-drawn geometry).

---

## 8. `CPicPage` and `CPicLayer`

### 8.1 `CPicPage` (`readCPicPage`) — **[O]** tail

```
struct CPicPage : CPicObjBase {
  u8 ps;                          // page schema
  if (ps != 4) skip(2)            // [X]
  if (ps >= 5) skip(2)            // [X]
  if (ps >= 7) skip(4)            // [X]
  if (ps >= 3) { u32 cnt; if (0<cnt<10000) skip(cnt*8) }   // [X] label/marker table
  // layers = children of type CPicLayer
}
```

### 8.2 `CPicLayer` (`readCPicLayer`)

```
struct CPicLayer : CPicObjBase {
  u8 ls;                          // layer schema
  CString name;                                            // [V]
  if (ls <= 3) {                  // Flash 1–3
    u8 state;  // 0=hidden 1=locked 2=normal 3=current     // [O]
  } else {                        // Flash 4+               // [V] vs flacomdoc
    skip(1)             // isSelected
    u8 hidden
    u8 locked
    skip(4)             // 0xFFFFFFFF sentinel
    RGBA outlineColor
    u8 outlineMode      // showOutlines
    skip(7)             // 00 00 00 heightMultiplier 00 00 00
    u8 layerType        // 0=normal 1=guide 2=guided 3=folder 4=mask
  }
  // --- trailer (NOT structurally parsed) ---
  u16 parentLayerRef   // peeked only: CArchive obj-ref of mask/folder parent (0=none)  [O]
  // reposition to next CPicLayer backref / NEWCLASS / page end-marker  (§13)            [X]
}
```

`layerType` value `5` (masked) is **not** stored in the binary — masked children carry
`layerType=0` plus a non-zero `parentLayerRef` and are resolved at import time (§15.3). The
trailer beyond `parentLayerRef` is **[X]** (scanned past, not decoded).

---

## 9. `CPicFrame`

`readCPicFrameNode`. The single most complex record; heavily schema-gated by `fs` (frame
schema). Inherits a `CPicShape` body (frame-level drawn geometry) before its own fields.

```
struct CPicFrame : CPicObjBase {
  // inherited CPicShape body:
  u8 shapeSchema; Matrix matrix; ShapeData ownShape;     // §10

  u8  fs;                              // frame schema
  u16 duration;        // span length, max(1,·)            [V]
  if (fs > 2) u16 keyMode;  else skip(1)                   // [V] (bits §9.1)
  if (fs > 1) s16 motionEase;          // field_190 signed accel −100..100   [V]
  if (fs > 4) u16 soundId;                                 // [O]
  if (fs > 5) {                        // sound envelope    [O]
    u16 cnt; { u32 pos; u16 leftLevel; u16 rightLevel }[cnt]
  }
  if (fs > 6) { u16 soundLoop; u8 soundSync; u32 inPoint44; u32 outPoint44 }  // [O]
  if (fs > 7) skip(2);                 // soundZoomLevel    [X]
  if (fs > 8) {
    CString label;                                          // [V]
    if (fs >= 19) {                    // MX+               [V] script; rest [O]/[I]
      script = TimelineSubObject();    // §9.2  (AS2 source text)
      if (fs > 10) {
        u32 rotateFla;  // 1=none 2=auto 3=cw 4=ccw         [O]
        u32 motionRotateCount;                              // [O]
        if (fs > 11) u32 labelType;    // 1=comment 2=anchor [O]
        if (fs > 12) {
          u16 morphTag;
          if (morphTag != 0) { rewind 2; decodeMorphData(); return }   // §11
        }
        if (fs > 13) u32 orientSnap;   // bit0=orientToPath bit1=snap  [I]
        if (fs > 14) { u16 oblistTag; if (!=0) { rewind 2; endScan; return } }  // [X]
        if (fs > 15) CString tweenInstanceName;             // [X] field_298
        if (fs > 19) skip(4)                                // [X]
        if (fs > 20) skip(4)                                // [X]
        if (fs >= 22) skip(4)                               // [X]
        if (fs >= 24) EaseCurveData();   // §9.3            // [O]
      }
    } else {                           // fs 9..18 (F5/MX)
      // [X] frame scripts beyond label NOT extracted; end-scan
    }
  } else if (2 < fs <= 8) {            // Flash 4 or older
    // [X] scripts stored as action records, not source; end-scan
  }
}
```

### 9.1 `keyMode` bitfield (u16) — **[V]** for tween bits

| Bit | Meaning | Confidence |
|-----|---------|------------|
| `0x0001` | classic/motion tween keyframe | [V] |
| `0x0002` | shape tween keyframe | [V] |
| `0x0400` | motionTweenScale **disabled** (set = no scale) | [V] vs flacomdoc |
| `0x0800` | motionTweenSync (sync graphic to parent) | [V] vs flacomdoc |
| base `0x0600` | = `0x400 \| 0x200`, common idle bits | [O] |
| `0x4000` | **never set** in real F8 FLAs; do NOT gate tween on it | [V] |

Real F8 motion-tween keyframes store `keyMode = 0x601`. The historical
`(keyMode & 0x4000) && (keyMode & 0x0001)` requirement dropped *every* motion tween.

### 9.2 `TimelineSubObject` (`readTimelineSubObject`) — frame script — **[V]** for script

```
  u32 typeId;        // frameVersionC: 0=F5 1=MX 4=MX2004/F8 5=CS3/CS4
  u32 formatType;    // 1 = authored frame
  if (formatType == 1) {
    if (typeId >= 1) { skip(4); u32 cnt; if(0<cnt<10000) skip(cnt*4) }
    if (typeId >= 5) skip(4)
    CString script;   // AS2 source text; CRLF/CR normalized to LF
  } else if (formatType == 0) { skip(4); u32 pfCount; skip(pfCount*4) }
```

AS2 frame scripts are **plain source text** (Flash 5+); no bytecode decompilation needed.
Flash 4-and-older store compiled action records instead — **[X] not extracted**.

### 9.3 Custom ease-curve data (`fs >= 24`, F8+) — **[O]**

```
  u32 useSingleEaseCurve;
  u32 hasCustomEase;
  if (hasCustomEase != 0) {
    // 6 property arrays in order: position, rotation, scale, color, filters, all
    for (p in 0..5) {
      u32 numPoints;
      for (i in 0..numPoints-1) {
        f64 x; f64 y;
        if (i==0 || i==last) { f64 x2; f64 y2 }   // endpoints written twice
      }
      // a 4-point set → cubic-bezier {x1,y1,x2,y2} from points[1],[2]
    }
    // useSingleEaseCurve ? curve[5] governs all : curve[0] per-property + 1..4
  }
```

`easeType` is derived from `sign(motionEase)`: `<0 → out`, `>0 → in`, `0 → none`
(or `inOut` when a custom curve is present). **[V]** sign convention vs flacomdoc.

---

## 10. Shapes — `CPicShape` and shape geometry

### 10.1 `CPicShape` (`readCPicShape`)

```
struct CPicShape : CPicObjBase {
  u8     shapeSchema;        // > 2 ⇒ F8-era strokes/fills ("caps")
  Matrix matrix;
  ShapeData data;            // §10.4
}
```

### 10.2 Fill style (`readFillStyle`)

```
struct FillStyle {
  RGBA color;
  u8 subtype;
  skip(1);                   // more_flags  [X]
  if (subtype & 0x10) {                 // GRADIENT (0x12 = radial)   [V] structure
    Matrix gradientMatrix;
    u8 numStops;
    if (caps) {              // F8+ extras
      u8 focal; skip(3);     // focalRatio = signed focal / 255
      u8 flow;  skip(3);     // bits[7:6] spread (0 pad,1 reflect,2 repeat); bit[4] linearRGB
    }
    { u8 position; RGBA color }[numStops]   // ALL stops consumed; model keeps first 15
  }
  else if (subtype & 0x40) {            // BITMAP   [V]
    Matrix bitmapMatrix; u32 bitmapId;
    // repeat = !(subtype&1)   smooth = (subtype&2)   (SWF 0x40/41/42/43)
  }
  else if (subtype & 0x20) {            // [X] UNKNOWN internal fill variant
    Matrix m; skip(4+8);                // consumed for alignment; treated as solid color
  }
  else { /* solid: use color */ }
}
```

The `subtype & 0x20` case is **[X]**: no legitimate binary specimen was found (it only ever
appeared during misaligned reads). The 12-byte trailer is consumed blind to stay aligned.

### 10.3 Line style (`readLineStyle`)

```
struct LineStyle {
  RGBA color;
  u16  widthTwips;           // px = /20
  skip(4);                   // styleParam1+2 (dash/dot/ragged)  [X]
  if (caps) {                // F8+ (pre-F8 strokes STOP here — 10 bytes total)  [V]
    u8 pixelHinting;
    u8 scaleMode;            // 0 normal 1 horizontal 2 vertical 3 none
    u8 capStyle;             // CAP_STYLES = [round, none, square]
    u8 joinStyle;            // JOIN_STYLES = [round, bevel, miter]
    u8 miterFrac; u8 miterInt;   // miterLimit = miterInt + miterFrac/256
    FillStyle paint;         // stroke's paint as a full fill (solid → finalColor)
  }
}
```

### 10.4 Shape data + edge stream (`readShapeData`)

```
struct ShapeData {
  u8  schema;
  skip(4);                   // edge count hint  [X]
  u16 fillCount;
  FillStyle fills[fillCount]    // (schema<3: legacy u32 color + u16 flags)
  u16 lineCount;
  LineStyle lines[lineCount]
  if (schema >= 2) EdgeRecord* edges  (until flags byte == 0)   // §10.5
  if (schema > 4 && remaining>=4) { s32 cubicCount; skip(cubicCount*32) }  // [O] cubic post-stream
}
```

### 10.5 Edge records — **[V]** (port of flacomdoc / Ruffle ShapeConverter)

Each edge begins with a `u8 flags`; `flags==0` terminates.

```
  flags:
    bit 0x40 = style-change record present
    bit 0x80 = "no selection info" (bare u8 values vs value+selByte triples)
    bits[1:0]   = type of delta1 (move/from)
    bits[3:2]   = type of delta2 (control)
    bits[5:4]   = type of delta3 (to)
  if (0x40): style change, ORDER = stroke, fill0, fill1   // [V] (NOT fill0,fill1,stroke)
       0x80 set:  u8 line; u8 fill0; u8 fill1
       else:      (u8 + selByte) × 3
  delta_i by type:  0→(0,0)  1→(s16,s16)  2→(s32,s32)  3→(s16<<7, s16<<7)
  from = cur + d1;  control = from + d2;  to = from + d3
  if (d2 type == 0): straight line, control = midpoint
  cur = to
  // coords stored in 8.8 twips; px = /5120
```

`fill0`/`fill1` are 1-based style indices (0 = none) recording the fill on the **left** and
**right** of the edge. Region reconstruction (closing loops, reversing fill0 runs) is an
import-time concern, not a format property — see CLAUDE.md "Shape fills use the SWF
fill0/fill1 model".

---

## 11. `CPicMorphShape` (shape-tween end geometry) — **[O]**, several **[X]** fields

Not a CArchive child of the frame — serialized **inline** in the `CPicFrame` tail after a
non-zero `morphTag` (§9). `decodeMorphData`:

```
  tag = NEWCLASS/backref "CPicMorphShape"
  u8 schema; u8 flags;
  // children loop typically hits a bad internal tag (0x0001) → resync to first segment
  loop CMorphSegment | CMorphCurve until NULL:
    CMorphSegment : CPicObjBase {       // coords in SWF twips
      s32 styleFlags; s32 fill0Style; s32 fill1Style;
      s32 fromX; s32 fromY; s32 toX; s32 toY;
      u16 trailing;     // observed 0x0004, purpose [X]
    }
    CMorphCurve : CPicObjBase {
      s32 ctrlX; s32 ctrlY; s32 anchorX; s32 anchorY;
      s32 unknown1;     // [X]
      s32 unknown2;     // [X] (looks like a style index; ignored)
      // inherits fill/line from preceding segment
    }
  // then morph fill/stroke style tables (best-effort skip):
  u16 fillCount;  morphFillStyle[fillCount]   // §11.1
  u16 strokeCount; skip(strokeCount * 10)
  u8  shapeTweenBlend;   // 0=distributive 1=angular
  // resync to next CPicFrame backref or layer NULL
```

The decoded edges become the **end keyframe's** shape (injected if that frame has no
geometry of its own). `unknown1`/`unknown2` and the segment `trailing` u16 are **[X]**.

### 11.1 `morphFillStyle` skip sizes (`skipMorphFillStyle`) — **[O]**

```
  RGBA; u16 subtype;
  subtype & 0x10 (gradient): skip(24 matrix); u8 count; skip(count*5)
  subtype & 0x40 (bitmap):   skip(24 matrix); skip(2 bitmapId)
  else (solid):              (nothing more)
```

---

## 12. Symbol instances — `CPicSymbol` / `CPicSprite` / `CPicButton`

Shared base (`readCPicSymbolFields`). `symbolSchema`: `8=F5, 0x0A=MX, 0x0E=MX2004,
0x13=F8/CS3, 0x16=CS4` **[O]**.

```
struct SymbolBaseFields : CPicObjBase {
  u8     symbolSchema;
  Matrix matrix;
  u16    firstFrame;     // 0-based start frame (graphic symbols)   [O]
  u8     loopMode;       // 0=loop 1=play-once 2=single-frame       [O]
  skip(1);
  if (symbolSchema >= 7) skip(1);
  if (symbolSchema >= 4) {                     // COLOR TRANSFORM   [V] structure
    if (symbolSchema >= 6) { u16 aMult; s16 aOff }   // 0x100 = 1.0
    u16 rMult; s16 rOff;  u16 gMult; s16 gOff;  u16 bMult; s16 bOff;
    skip(2);   // effect type   (UI hint, redundant)  [X]
    skip(2);   // value percent (UI slider)            [X]
    skip(4);   // effect color  (UI tint)              [X]
  }
  if (symbolSchema >= 6) CString "";           // always-empty
  u16 libraryIndex;      // "Symbol N" stream number    [O]
  skip(2);
  if (symbolSchema >= 0x0e) skip(3);           // [X]
  if (symbolSchema >= 0x13) {                  // F8+ filters + blend
    u8 filterCount;
    if (filterCount > 0) filters = readFilterList(SWF-wire, filterCount)   // §14.1
    u8 blendMode;        // 0–14, §12.1
    skip(2);             // [X]
  }
  if (symbolSchema >= 0x16) skip(102);         // [X] CS4 3D transform block
}
```

### 12.1 Blend mode byte → name — **[V]** mapping

`0,1=normal · 2=layer · 3=multiply · 4=screen · 5=lighten · 6=darken · 7=difference ·
8=add · 9=subtract · 10=invert · 11=alpha · 12=erase · 13=overlay · 14=hardlight`.

### 12.2 `CPicSprite` (movieclip instance) tail — **[O]**

```
  ...SymbolBaseFields
  u8 g;                  // trailer version: 3=F5 6=MX 8=MX2004+
  if (g >= 3) { TimelineSubObject sub;  // carries onClipEvent(...) script source
                CString instanceName }
  if (g >= 6) { skip(9); Accessibility?; skip(8);
                if (g >= 8) { skip(5); CString componentMetadataXML /*[X]*/ } }
  else if (g >= 3) skip(5)
```

### 12.3 `CPicButton` tail — **[O]**

```
  ...SymbolBaseFields
  u8 b;                  // trailer version: 5=F5 8=MX 0x0B=MX2004+
  if (b >= 5) { TimelineSubObject sub;   // on(...) handler source
                u8 trackAsMenu;
                CString instanceName;
                if (b >= 8) Accessibility?;
                skip(4) }
```

### 12.4 `CPicSymbol` / `CPicShapeObj` (graphic instance)

Ends immediately after `SymbolBaseFields` (no name/script tail).

---

## 13. Recovery / re-sync machinery

Because many record tails are **[X]**, the parser relies on resynchronization rather than
exact consumption. This is structural, not incidental — treat re-sync as part of the spec.

| Function | Strategy |
|----------|----------|
| `skipToNextBoundary` | Scan for next plausible NEWCLASS (`FFFF`+schema≤0xff+ASCII name) **or** known-class backref (`0x8000\|idx`, schema≤0x10, flags≤0x40) **or** the 10-byte end-marker. |
| `verifyBoundary` | After an exact parse, confirm the reader sits on `0x0000`/`0xFFFF`/known-backref; else `skipToNextBoundary`. |
| `END_MARKER` | `00 00 00 00 00 80 00 00 00 80` = NULL child tag + two `INT_MIN` point sentinels (object tail signature). |
| `repositionAfterLayerTrailer` | Bounded (96-byte) scan for next `CPicLayer` backref / NEWCLASS / page end-marker. |
| `skipToNextCPicFrame` / `frameTailEndScan` | Bounded scan for next `CPicFrame` backref or end-marker (≤8192 bytes). |

**Danger [V]:** a naive end-marker scan can land inside a **sibling** record whose
registration point happens to be the `INT_MIN` sentinel. Always prefer the class-tag scan;
the `INT_MIN`-only signature is ambiguous.

Bad/unknown class tags (e.g. `0x0204` seen in real F8 FLAs) trigger `skipToNextBoundary` and
a one-time `console.warn`. Truncated streams (`FlaEofError`) are caught and the partial
record returned.

---

## 14. Filters

There are **two distinct on-disk filter encodings** and they must not be confused.

### 14.1 SWF-wire filters (`readFilterList`/`readOneFilter`) — **[V]**

Used by **symbol-instance** and **bitmap** filters (`symbolSchema ≥ 0x13`). Identical to
SWF §23: `u8 type` then type-specific fields; `Fixed16 = s32/65536`, `Fixed8 = s16/256`.

| Type | Filter | Notable fields |
|------|--------|----------------|
| 0 | DropShadow | RGBA, blurX/Y, angle, distance (Fixed16), strength (Fixed8), flags (inner 0x80, knockout 0x40, hideObject = !(0x20), passes 0x1f) |
| 1 | Blur | blurX/Y, passes = (flags & 0xf8)>>3 |
| 2 | Glow | RGBA, blurX/Y, strength, flags |
| 3 | Bevel | highlight RGBA, shadow RGBA, blurX/Y, angle, distance, strength, flags (onTop 0x10) |
| 4 / 7 | GradientGlow / GradientBevel | u8 numColors; colors[]; ratios[]; blur/angle/dist/strength; flags |
| 5 | Convolution | matrixX/Y, f32 divisor/bias, f32 matrix[X*Y], default RGBA, flags (clamp 0x01, preserveAlpha 0x02) |
| 6 | ColorMatrix | f32 matrix[20] (4×5 row-major) |

### 14.2 FLA-authoring filters (`readFlaFilterList`/`readOneFlaFilter`) — **[O]**

Used **only** by `CPicText` filters (`ts ≥ 0x0d`). Wider, fixed-length records with
sub-headers and f32 fields; verified against flacomdoc `filters/*.java` + the golden-v2
fixture. Layout is **per-type fixed-length** (DropShadow 47B, Blur 48B, Glow 48B, Bevel 56B,
GradientGlow 60+8n, GradientBevel 61+8n, AdjustColor 23B). Many interior bytes are constants
skipped blind. The text filter list is preceded by a `u8 hasFilters` marker then `u32 count`
then a trailing `u16`.

Unknown filter types in either encoding cannot be length-skipped safely → recovery (§13).
**Convolution has no model type** and is dropped after parsing; **AdjustColor** decodes
to brightness/contrast/saturation/hue (−100..100, hue −180..180) **[O]**.

---

## 15. `CPicText` (`readCPicText`)

`ts` (text schema): `5=F5, 9=MX, 0x0C=MX2004, 0x0D=F8, 0x0E=CS4`.

```
struct CPicText : CPicObjBase {
  u8 ts;  Matrix matrix;
  s32 left, right, top, bottom;    // box bounds, twips (folded into placement tx/ty)  [V]
  u8 autoExpand;
  if (ts >= 4) skip(1);
  if (ts >= 4) { u8 textFlags; u8 embedFlag }    // §15.1
  if (ts >= 5) { u8 selectable; skip(1) }        // [O]
  if (ts >= 4) { u16 maxChars; CString as2VariableName }
  if (embedFlag & 0x20) CString embeddedChars;   // [X]
  if (ts >= 0x0e) skip(1);

  // runs:
  if (embedFlag & 0x40) { TextRun run /*empty field*/ }
  else loop { u16 charCount; if(==0) break; TextRun run; chars[charCount] }   // §15.2

  if (ts >= 9) {
    CString instanceName;
    Accessibility?;
    skip(4); u8 scrollable; skip(3);      // [I] no confirmed fixture
    if (ts >= 0x0c) { CString; CString }  // reserved + font embed ranges  [X]
    if (ts >= 0x0d) {                     // FLA-authoring filter list (§14.2)
      u8 hasFilters; if(set){ u32 count; FlaFilters; } u16 trailing;
    }
  }
}
```

### 15.1 `textFlags` (u8) — **[O]**

`0x01 editable · 0x02 dynamic · 0x04 password · 0x08 wordWrap · 0x10 multiline ·
0x20 background · 0x40 border`. `textType = !(0x01)?static : (0x02)?dynamic : input`.

### 15.2 `TextRun` formatting block (`readTextRunFields`) — **[O]/[V]**

```
  u8 runVersion;
  u16 size*20;
  String fontName;            // CString(CS4) | plainString(unicode)
  if (cs4) { CString faceName; skip(4) }
  RGBA color;
  skip(2);                    // font category  [X]
  u8 bold; u8 italic; skip(1); u8 autoKern; u8 charPos; u8 align;   // [V] order vs flacomdoc
  u16 leading; u16 indent; u16 leftMargin; u16 rightMargin;         // twips
  if (ts>=5) s16 letterSpacing; else skip(1);
  String linkUrl;
  if (ts>=9) { u8 vertical; u8 rightToLeft; u8 rotation;
               if(ts>=0x0c) skip(1) /*bitmapRender*/;  String linkTarget }
  if (ts>=0x0d) { skip(1) /*0x02*/; u8 renderMode; f32 thickness; f32 sharpness; String url }
```

`renderMode`: `0 device · 1 bitmap · 2 animation · 3 readability · 4 custom` (→ CSM
thickness/sharpness). `align`: `0 left · 1 right · 2 center · 3 justify`.

**`colorEffect` is always `null` for text and that is correct, not a gap. [V]** Flash 8 text
fields cannot carry an instance color transform; color is per-character in the run. The
flacomdoc writer emits no color-effect block for text, confirmed by the
`flash8-nested-textfields.fla` fixture.

---

## 16. `CPicBitmap`, `CPicVideo`, `CPicSwf`

```
struct CPicBitmap : CPicObjBase {        // [O]
  u8 schema; Matrix matrix; u16 mediaId;
  if (schema >= 2) { u8 filterCount; if(>0) SWF-wire filters }
}

struct CPicVideo : CPicObjBase {         // [I] — NO fixture; layout inferred from CPicBitmap
  u8 schema; Matrix matrix; u16 mediaId;
}

struct CPicSwf : CPicObjBase {           // header [O] (Magnet.fla ×4); tail [X]
  u8 symbolSchema; Matrix matrix;
  <variable tail 950–5500 bytes>         // AS2 clip scripts, cxform, name — NOT decoded
}
```

`CPicVideo` filter fields, if any, are **[X]**. `CPicSwf`'s entire tail is **[X]** (scanned
past); only the placement matrix survives.

---

## 17. Color transform & accessibility

### 17.1 ColorEffect (from §12) — **[V]** structure

Per channel: `u16 mult` (8.8, `0x100`=1.0) + `s16 off` (−255..255). Channel order:
`(alpha if schema≥6,) red, green, blue`.

### 17.2 Accessibility (`readAccessibilityMaybe`) — **[I]** (partial)

Absent when the leading version byte is `0`. Otherwise:
`u8 version; skip(3); u8 silent; skip(3); CString name; CString description;
CString shortcut; (MX2004+: CString tabIndex; CString reserved;) u8 forceSimple; skip(3)`.
Byte layout is best-effort; `enabled = !silent`.

---

## 18. Import → model mapping (`flash8-import.ts`)

Decisions applied when converting the parsed IR to the editor document model. These are
**ours**, not format facts, but they encode hard-won format truths:

1. **Scene play order = `Contents` byte order, not `Page N` number. [V]** `contents.sceneNames`
   Map key-order is authored order; pages are re-ordered to match, with name-less pages
   appended in numeric order. The `Page N` suffix is *storage/creation* order.
2. **Layer order is reversed. [V]** Binary layers are bottom-to-top (`index 0` = background);
   the model expects top-to-bottom (`li=0` = frontmost). `convertTimeline` reverses, then
   re-groups mask runs so each group is `[mask, …masked]`.
3. **Masked layers resolved from `parentLayerRef`. [O]** After a `type=4` mask, consecutive
   `type=0` layers sharing the mask's non-zero `parentLayerRef` are promoted to `masked`.
4. **Library folders derived from `fullLibraryPath`. [O]** `/`-split; trailing `!` stripped;
   last segment = symbol name.
5. **Button promotion. [O]** A graphic symbol whose instances carry `on()` handlers is
   promoted to `symbolType=button` (real F8 FLAs write such symbols with a graphic type byte).
6. **loopMode is graphic-only at compile time. [V]** Binary FLAs store a loop byte on *every*
   instance; movieclips/buttons ignore it (else nested clips freeze on frame 0 — task 1124).
7. **`isEmpty = displayObjects.length === 0`.** Frames marked empty are dropped by the compiler.

---

## 19. Consolidated "what we DON'T know" — gaps & guesses

| Area | Status | Notes |
|------|--------|-------|
| `CPicObjBase.flags` meaning | **[X]** | Confirmed *not* visibility; true meaning unknown. |
| `Contents` structured layout | **[X]** | Whole stream parsed by byte-pattern scan + fixed offsets, not a real `CDocument*` walk. |
| Stage dims / bg / fps when patterns absent | **[X]** | Falls back to 550×400 / white / 12fps. |
| Symbol linkage 4 flag bytes order | **[I]** | Only the all-false case is verified. |
| `scale9Grid` anchor scan | **[O]** | Heuristic 16-byte anchor; could mis-hit. |
| `CMediaSound` discovery | **[O]** | Backref tag found by elimination; fragile. |
| `Font N` interior fields (+2,+6,+8) | **[X]** | hash/schema/flag bytes skipped. |
| `CPicFrame` tail offsets ≥ fs>15 | **[X]** | `field_298`, several `skip(4)` blocks uninterpreted. |
| Ease-curve point format | **[O]** | Endpoint-doubling inferred; no independent check. |
| `orientToPath`/`snap` bit assignment | **[I]** | bit0/bit1 guess; no fixture. |
| `0x20` fill subtype | **[X]** | No legitimate specimen; treated as solid + blind skip. |
| Shape cubic post-stream | **[O]** | `schema>4` 32-byte entries skipped. |
| `CMorphCurve` unknown1/2, segment trailing u16 | **[X]** | Consumed blind. |
| Morph fill/stroke tables | **[O]** | Sizes best-effort; restored-on-error. |
| `CPicSwf` variable tail | **[X]** | 950–5500 B scanned past; only matrix kept. |
| `CPicVideo` whole record | **[I]** | No fixture; layout assumed ≈ `CPicBitmap`. |
| FLA-authoring filter interior constants | **[X]** | Many bytes skipped as constants. |
| Convolution filter | **[X]** | Parsed then dropped (no model type). |
| Component metadata XML (sprite tail) | **[X]** | Read as CString, discarded. |
| Accessibility byte layout | **[I]** | Partial; reserved spans guessed. |
| `CPicText.scrollable` / `selectable` | **[I]/[O]** | No confirmed fixture. |
| Layer trailer beyond `parentLayerRef` | **[X]** | Scanned past. |
| `CPicPage` tail tables | **[X]** | Counted & skipped. |
| Flash ≤4 frame action records | **[X]** | Bytecode, not source; not extracted. |
| Pre-MX2004 (ASCII) coverage | **[O]** | Most fixtures are MX2004+/F8; older paths lightly tested. |
| Write-back | **[X]** | Out of scope entirely. |

---

## 20. Provenance / references

- **JPEXS `flacomdoc`** (github.com/jindrapetrik/flacomdoc) — XFL→binary-FLA writer,
  byte-verified vs real Flash. Best source for field order/semantics. `FlaFormatVersion.java`
  holds the full per-version schema table.
- **`eddiemoore/fla-decoder`** — Ghidra RE of `flash.exe` Serialize methods. Best source for
  the MFC CArchive protocol and schema gates.
- **Ruffle `swf` crate** — SWF filter/shape encodings (the FLA reuses SWF-wire filters and
  the fill0/fill1 edge model).
- **Fixtures** (`packages/core/fixtures/`): `Magnet.fla` (CS2), `golden.fla`,
  `flash8-nested-textfields.fla`, `mx2004-frame-scripts.fla`, `morph-shape-tween-mx.fla`.
- Source: `packages/core/src/fla/{ole.ts,flash8-binary.ts,flash8-import.ts,media.ts}`.
- Cross-references: `docs/15-file-formats-fla-swf.md` (FLA/SWF overview), CLAUDE.md
  "Binary FLA import" learnings (the authoritative running notes — this doc consolidates them).
