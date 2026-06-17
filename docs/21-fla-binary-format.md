# Binary FLA Format (Flash 5 – CS4) — Format Specification

Specification of the proprietary Macromedia/Adobe binary `.fla` document format, focused on
**Flash 8** (the clone's primary target) and annotated for the Flash 5 .. CS4 family.

This revision is reconstructed from three independent, cross-checked sources, then **verified
against real Flash 8 output**:

1. **JPEXS `flacomdoc`** (`tools/refs/flacomdoc/`) — an XFL→binary-FLA *writer* that is
   byte-verified against real Flash. Its `FlaWriter`/`FlaConverter`/`TimelineConverter`
   classes are the authoritative field order and encoding for every record. This is the
   primary ground truth (tagged **[V]**).
2. **`eddiemoore/fla-decoder`** (`tools/refs/fla-decoder/`) — a Ghidra reverse-engineering
   of `flash.exe` `Serialize` methods. Confirms the MFC CArchive protocol, the class table,
   and per-record schema gates from the *reader* side.
3. **The flashdrv differential oracle** (`tools/flashdrv/`) — drives a real Flash 8 install
   (Win7 VM) via JSFL to emit single-property-varied FLAs, byte-diffed per-stream on the host
   (`fla_cfb.py` + `fladiff.py`). Used to empirically confirm field offsets/encodings against
   genuine Flash output (e.g. the stage block).

The per-version schema constants are computed mechanically from `FlaFormatVersion.java`
(`tools/flashdrv/findings/dump_schema.py`, table in §3); the Flash 8 row is reproduced in §3.

---

## 0. Confidence legend

| Tag | Meaning |
|-----|---------|
| **[V]** | **Verified.** Byte-checked against `flacomdoc` (a byte-verified writer) and/or confirmed directly against real Flash output via the flashdrv oracle or a sample file. |
| **[O]** | **Observed.** Derived from samples / one source but not cross-verified; may be specimen-specific. |
| **[I]** | **Inferred.** Best-effort layout with no confirming writer/sample. |
| **[X]** | **Unknown / not decoded.** Only the byte extent is known; a reader resynchronizes past it. |

Confidence is annotated per field; a single tag at a record header applies to the whole record.

---

## 1. Notation (IDL)

Pseudo-C struct notation, **little-endian unless stated**.

```
Scalar types
  u8 u16 u32 u64        unsigned LE integers
  s16 s32               signed LE integers (two's complement)
  f32 f64               IEEE-754 LE (writeFloat / writeDouble)
  fixed16 = s32 / 65536   16.16 fixed point  (matrix a/b/c/d)
  fixed8  = s16 / 256     8.8  fixed point

Composite types
  CString               MFC length-prefixed string (ASCII or UTF-16; see §4.1)
  BomString             FF FE FF-prefixed UTF-16LE string (the unicode CString; §4.1)
  encodedUI             u16, OR (FF 7F + u32) when value >= 0x7FFF (§4.4)
  Matrix                24 bytes: a,b,c,d (fixed16) + tx,ty (s32 twips)   (§4.2)
  RGBA                  4×u8 in R,G,B,A order
  Point8_8              per axis 2 bytes (u8 frac, s8 int)  = 8.8 fixed twips  (shape edges)
  Point8_24             per axis 4 bytes (u8 frac, s24 int) = 8.24 fixed       (morph points)

Annotations
  field;        // [V|O|I|X] note
  skip(n)       // n bytes consumed but not interpreted
  if (cond)     // schema-gated presence (cond uses the §3 version ordinals)
  field[count]  // array
  >= F8         // present when target format ordinal >= Flash 8 (the usual gate form)
```

**Units** — three coordinate scales coexist:

| Context | Unit | px conversion | Conf |
|---------|------|---------------|------|
| Matrix `tx`/`ty`, stage W/H, text bounds, margins, scale9, guides | SWF twips | px = v / 20 | [V] |
| Shape **edge** coords (`writeXY` BYTE form) | 8.8 fixed twips | px = v / 5120 | [V] |
| Shape **cubic** post-stream ints | twips (plain s32) | px = v / 20 | [V] |
| Morph **point** coords (`writePoint`) | 8.24 fixed twips | px = v / 5120 | [V] |

---

## 2. Container: OLE2 / CFB

Standard Microsoft Compound File Binary ([MS-CFB]). Implemented dependency-free in
`tools/flashdrv/fla_cfb.py` and verified against every sample (Magnet/golden/evaporatingdrip)
and all oracle output. **[V]**

```
Header @0                         (512 bytes for v3)
  u8[8]  magic           @0    = D0 CF 11 E0 A1 B1 1A E1
  u16    sectorSizePow   @30   sectorSize  = 1 << pow  (512 typical, 4096 for v4)
  u16    miniSectorPow   @32   miniSector  = 1 << pow  (usually 64)
  u32    fatSectorCount  @44
  u32    firstDirSector  @48
  u32    miniStreamCutoff@56   usually 4096
  u32    firstMiniFat    @60
  u32    miniFatCount    @64
  u32    firstDifat      @68
  u32    difat[109]      @76
```

Sector addressing: `fileOffset = 512 + sector * sectorSize`. Special FAT values:
`ENDOFCHAIN=0xFFFFFFFE FREESECT=0xFFFFFFFF FATSECT=0xFFFFFFFD DIFSECT=0xFFFFFFFC`. Directory
entry types: `1=storage 2=stream 5=root`. **Mini-FAT [V]:** streams with `size <
miniStreamCutoff` live in 64-byte mini sectors carved from the root entry's stream; most
`Page N`/`Symbol N` streams are small and live here.

Directory entry (128 bytes): `utf16 name@0` (len `(nameLen@64 - 2)/2` chars), `u8 type@66`,
`u32 left@68/right@72/child@76`, `u32 start@116`, `u32 sizeLo@120/sizeHi@124`.

---

## 3. Per-version schema table (Flash 8)

Every record begins with one or more *schema/version bytes*; readers gate optional fields on
the **format ordinal** (`F5<MX<MX2004<F8<CS3<CS4`), and writers stamp the literal values
below. Computed from `FlaFormatVersion.java`; full table via `dump_schema.py`. **[V]**

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

> **`fs` in §9 = `frameVersionB` = 0x18 (24)** for F8, *not* `frameVersion`. All the §9
> `fs >= 19/22/24` branches therefore fire on F8.  `unicode=true` ⇒ every string is a
> BomString. `symbolType/shapeType/bitmapType/videoType` are the instanceType bytes (§5.3).

---

## 4. Primitive encodings

### 4.1 Strings — `CString` / `BomString` — **[V]** (`FlaWriter.writeString`/`writeBomString`)

```
writeString(s):                    // length then chars
  len = unicode ? s.length(chars) : byteLength
  if len < 0xFF:        u8 len
  elif len < 0xFFFF:    u8 0xFF, u16 len
  else:                 u8 0xFF, u16 0xFFFF, u32 len
  chars: UTF-16LE (unicode) or charset bytes
writeBomString(s):                 // unicode (MX2004+) prepends BOM
  if unicode: u8 0xFF, u8 0xFE, u8 0xFF   // "FF FE FF"
  writeString(s)
```

So an empty F8 BomString = `FF FE FF 00` (4 bytes); `"P"` ASCII via writeString = `01 50`.
Pre-MX2004 (`unicode=false`) drops the BOM and writes bytes in the document charset. (The
reader must also accept the `FF + u16 len` long-ASCII and `FF FE FF FF + u32` long-unicode
escalations.)

### 4.2 Matrix — 24 bytes — **[V]** (`FlaWriter.writeMatrix`)

`s32 a,b,c,d` each = `round(value / 1.52587890625e-5)` (i.e. ×65536, 16.16 fixed); then
`s32 tx,ty` each = `round(value * 20)` (twips). Order: a,b,c,d,tx,ty.

### 4.3 Color — **[V]**

`RGBA` = `u8 R,G,B,A`. Solid fills/strokes use RGBA; the document stage **background** is
`R,G,B,0xFF` (the alpha byte is always 0xFF).

### 4.4 `encodedUI` and points — **[V]** (`FlaWriter.writeEncodedUI` / `writePointPart`)

`encodedUI`: `u16 value` if `< 0x7FFF`, else `u8 0xFF, u8 0x7F, u32 value`. `writePointPart`
(morph) emits per axis `u8 frac, u8 int&0xFF, u8 (int>>8)&0xFF, u8 (int>>16)&0xFF` = signed
8.24. The shape edge `writeXY` BYTE form emits per axis `u8 frac, s8 int` = 8.8 (see §10.3).

---

## 5. MFC CArchive object protocol

Every timeline/symbol stream (and the document catalog) is an MFC `CArchive` serialization of
`CPic*`/`CMedia*`/`CDocumentPage` objects. **[V]** (`AbstractConverter.useClass`,
fla-decoder `ArchiveReader`).

### 5.1 Class/object tag word — **[V]**

A 2-byte LE tag precedes each (referenceable) object:

| tag | meaning | trailing |
|-----|---------|----------|
| `0x0000` | NULL / end-of-children | — |
| `0xFFFF` | **new class declaration** | `u16 defineNum` (schema #, default 1) + `u16 nameLen` + `nameLen` ASCII (WINDOWS-1250) bytes |
| `0x8000 \| idx` | **backref** to class `idx` (when `idx < 0x7FFF`) | — |
| `0x7FFF` (`FF 7F`) | **extended backref** | `u32 = 0x80000000 + idx` |

Verified against the empty doc: `Contents@23 = FF FF | 01 00 | 0D 00 | "CDocumentPage"`
(defineNum=1, nameLen=13).

### 5.2 Reference-index allocation — **[V]** (`useClass`)

A **single running object counter** is shared by classes and objects:

```
on a NEW class:   index(className) = 1 + (#classes declared before) + (#objects before)
on EVERY useClass (new OR backref):  totalObjectCount += 1
```

So a class first declared after N objects and C class declarations gets index `1+C+N`, reused
by every later backref. The older "two fixed slots per class" model is only correct while no
objects are interleaved between declarations — track the running counter instead.

### 5.3 `instanceHeader` — the per-display-object placement header — **[V]**

`TimelineConverter.instanceHeader` writes this immediately after a display object's class tag
+ leading version byte, for every `CPicBitmap`/`CPicVideoStream`/`CPicText`/`CPicSprite`/
`CPicSymbol`/`CPicButton` and (with bit 0) groups/floating shapes:

```
if (isInstance) u8 stateFlags;        // see below — ONLY for placed instances
u8 0x00, u8 0x00;                      // pad
// transformation (registration) point:
if (absent)  s32 0x80000000, s32 0x80000000;   // INT_MIN sentinel per axis = "unset"
else         s32 tptX, s32 tptY;               // = round(placeMatrix.transform(pt) * 20) twips
>= F8:  u8 0x00, u8 cacheAsBitmap;     // cacheAsBitmap 0/1
u8 instanceType;                        // = symbolType(0x13)/shapeType(3)/bitmapType(2)/videoType(4)
Matrix placeMatrix;                     // 24 bytes (identity if strippedMatrix)
```

**`stateFlags` — resolves the long-standing `CPicObjBase.flags` `[X]`:** it is the *authoring
UI state*, **not** visibility:

| bit | mask | meaning |
|-----|------|---------|
| 0 | 0x01 | `isFloating` (raw shape not in a group) — group/shape header form only |
| 1 | 0x02 | `selected` (selected at save time) |
| 2 | 0x04 | `locked` |

`flags=0x3` = selected+floating; `flags=0x0` = neither. Bits 3–7 are always 0. This confirms
the prior finding that the byte is not per-object visibility (Flash has no per-display-object
hide; visibility is a layer/runtime property).

> Note: the generic MFC `CPicObj` *base* used by container records (CPicPage/CPicLayer/
> CPicShape/CPicFrame) is a different scaffold — `u8 schema; u8 flags;` then the child loop and
> a trailing registration point. The `instanceHeader` above is the *placement* header and is
> what carries selected/locked/matrix; do not conflate the two.

---

## 6. `Contents` stream — document catalog

Full structured layout from `FlaConverter.convert` — replaces the old byte-scan heuristics.
The F8 order is below; every offset cited is for the **empty default document** (verified) and
shifts with the variable-length records before it.

### 6.1 Preamble — **[V]** (`convert` head; verified `@0`)

```
u8 contentsVersion   = 0x3F            // verified @0
u8 contentsVersionB  = 1
u8 0x00 ×3
u8 0x00     (>=F3)
u8 0x00     (>=F4)
u32 0       (>=F5)
u32 0       (>=MX)
u32 0       (>=MX2004)
u32 0       (>=F8)
u32 0       (>=CS3)   u32 0  (CS4)
```

For F8 this is **23 bytes** (`3F 01 00 00 00` + 18 zero), after which the first scene's
`CDocumentPage` class tag begins (verified: new-class `CDocumentPage` at @23).

### 6.2 Scenes — `CDocumentPage` records (play order) — **[V]**

Scenes are emitted in **authored play order**; that order is the order these records appear in
the stream (the OLE2 `P N` stream *name* is creation order, not play order). Each scene record
(`convert` :868+):

```
useClass("CDocumentPage")               // first decl FFFF; subsequent backref
u8  documentPageVersion = 0x17          // verified @42
String "P <n> <timeCreated>"            // ASCII via writeString
BomString sceneName
u16 0x0000   u16 0x0000   u8 0x00       // symbolId=0, symbolType=0 (scene)
>= F4:  BomString ""
        01 00 00 00 <documentPageVersionB=6> 00 00 00 01 00 00 00  <parentFolderId:00×8>  01 00 00 00
        writeItemID(pageItemID)         // 8 bytes (two u32 from "%08x-%08x")
        writeAsLinkage(scene)           // §6.4 (empty for scenes)
>= F4:  writeTimeCreated (u32)
        ... fixed page-tail block (BomString"" runs + constants; scene variant) ...
>= F8:  scaleGrid 20 bytes (off → 00 00 00 00 + 4× 00 00 00 80)
        // per-frame timeline lives in the separate OLE2 stream "P <n> <time>" (§7)
```

After all scenes: `00 00`, `u16 nextSceneIdentifier` (=scenes+1), `01 00`, `u8 1+currentTimeline`, `00`.

### 6.3 Symbol library entries — `CDocumentPage` (symbols) — **[V]**

Same `CDocumentPage` class, symbol variant (`writeSymbols` :549+):

```
useClass("CDocumentPage")
u8  documentPageVersion = 0x17
String "S <id> <time>"                  // ASCII
BomString symbolName
u16 symbolId       // 1-based include index (NOT a stream number)
u8 0x00  u8 0x00  u8 symbolType         // symbolType: 0=graphic 1=button 2=movie clip
>= F4:  BomString ""
        01 00 00 00 <spriteVersionE=6> 00 00 00 01 00 00 00  <parentFolderId | 00×8>  01 00 00 00
        writeItemID(itemID)
        writeAsLinkage(symbol)          // §6.4
>= MX2004: u8 0x00
>= F4:  writeTime (u32)
        ... symbol page-tail block (same shape as scenes) ...
>= F8:  scaleGrid 20 bytes (§17.3)
```

### 6.4 AS2 linkage — `writeAsLinkage` — **[V]**

Reused by symbols, scenes, sounds, bitmaps, fonts. The two flag bytes (this resolves the
old "4 flag bytes" gap — they are *packed bitfields across two bytes*):

```
u8 0x00 ×4
>= F5:
  u8 asLinkageVersion = 7
  u8 flagsA = (exportForAS?1) | (importForRS?2)            // ONLY these two bits
  u8 0x00 ×3
  BomString linkageIdentifier
  BomString linkageURL
>= MX2004:
  BomString className                                       // AS2 class name
>= MX:
  u8 flagsB = (exportForAS?1) | (exportForRS?2) | (exportInFirstFrame?4)   // NO importForRS bit
  u8 asLinkageVersionB = 2,  u8 0x00 ×3
  BomString ""
  BomString sourceLibraryItemHRef
  u8 00×8, 01 00 00 00, 00×4, FF FF FF FF                   // 20 fixed bytes
>= F8:
  u8 0x00
  BomString linkageBaseClass
```

> Real Flash 8 sometimes drops the `flagsB` bit2 (exportInFirstFrame) nondeterministically
> (flacomdoc comment: "sometimes there's just no 4 flag, randomly"). Treat flagsB bit2 as
> advisory when byte-matching. JSFL cannot set linkage headlessly (session-0 Flash pops a
> modal and hangs — see `FLA-RE-PLAN.md`), so this block is verified from flacomdoc + the read
> side, not the oracle.

### 6.5 Media entries — **[V]** (`writeMedia`, dispatched by tag, name-sorted)

`mediaCount` is 1-based across all media (bitmaps+sounds+videos, sorted by name).

**Sound — `CMediaSound`:** `useClass`, `u8 mediaSoundVersionC=6`, `String "M n time"`,
`BomString name`, `u16 mediaCount`, `BomString importHRef`, `writeTimeCreated`, `>=F4` block
(`00 00 00 01 00 00 00` + parentFolderId + `01 00 00 00` + itemID + `writeAsLinkage` +
MX2004:`00`), `>=F5 01 00 00 00`, `u8 mediaSoundVersionB(0x0A) u8 formatByte 00`,
`u32 sampleCount`, `u16 exportFormat`, `u16 exportBits`, `>=F5` 11 zero, `>=MX2004 BomString
deviceHRef`, `>=F8 00 00 00 00`. `formatByte = (rate<<2) | (16bit?2) | (stereo?1)` (rate 0=5k
1=11k 2=22k 3=44k). PCM/compressed payload lives in the `M n time` stream.

**Video — `CMediaVideoStream`:** parallel structure with `mediaVideoVersion*` constants; the
encoded clip lives in its `M n time` stream.

**Bitmap — `CMediaBits`:** `useClass`, `u8 mediaBitsVersion=6`, `String "M n time"`,
`BomString name`, `u16 mediaCount`, `BomString ""`, `writeTimeCreated`, `u8 mediaBitsVersionC`,
`>=F4` block (parentFolderId/itemID/writeAsLinkage), `>=F5 01 00 00 00`, `u8 mediaBitsVersionB`,
then trailer: `u8 compression` (1=lossless / 0=keep-imported-JPEG / 2=recompress), `u8 quality`,
`u8 allowSmoothing`, `u32 externalFileSize` (JPEG; else 0), `CS4: u8 useDeblocking`. Pixel/JPEG
data lives in the `M n time` stream.

### 6.6 Stage / document properties block — **[V]** (verified offsets)

After the catalog (`convert` :1099+), the document block. F8 order (empty-doc offsets in
parentheses, all verified by the oracle stage corpus):

```
>=F2: u8 rulerUnitType, 00, u8 (gridVisible?3:0), 00
      00 00 00
      u16 width*20            (@407 = 11000 = 550px)   // STAGE WIDTH, twips
      00 ×6
      u16 height*20           (@415 = 8000 = 400px)    // STAGE HEIGHT, twips
      00 ×4
      ... u16 gridSpacingX*20; u8 previewMode; u8 rulerVisible; u8 pageTabsVisible ...
      u8 ((playOptions<<4) | viewOptions)
      <29 fixed bytes>
      u8 bgR,bgG,bgB,0xFF     (@456 = FF FF FF FF)     // BACKGROUND (RGB + FF)
      u8 gridR,gridG,gridB,0xFF                         // grid color
      00, u8 fpsFrac, u8 fpsInt, 00, 00   (@466 fpsInt=0x0C=12) // FRAME RATE = 8.8 (frac,int)
      00 03 b4 00 00 00       (@467.. the legacy "03 B4" anchor)
```

`rulerUnitType`: 0 in,1 dec-in,2 pt,3 cm,4 mm,5 px. `viewOptions` bits 1 animControl,2 buttons,
4 pasteboard,8 livePreview; `playOptions` (×16) bits 1 loop,2 playPages,4 frameActions,8 sounds.

Verified by ramps (`tools/flashdrv/jsfl/stage.jsfl` → `corpus/stage`): width 550/600/800/1000
→ 11000/12000/16000/20000 (×20); height 400/500/600 → 8000/10000/12000; fps 12/24/30 →
0x0C/0x18/0x1E; bg `#123456` → bytes `12 34 56`. **[V]**

### 6.7 Folders, fonts, tail — **[V]**

`u32 folderCount` then per-folder records (leaf name, itemID, parentFolderId, isExpanded,
`writeAsLinkage`-shaped trailers). `writeFonts` (F5+): `u32 fontCount`, per-font record with
`u8 fontVersion`, `BomString name`, `u16 id`, `u32 time`, `u8 fontVersionB`, family name, bold/
italic u8 flags, the `0x12` magic, itemID, parentFolderId, `writeAsLinkage`. Tail: guides
color/visible/locked/snap, `BomString sharedLibraryURL`, grid/snap accuracy bytes, `u16
gridSpacingY*20`, document `writeAccessibleData` (§17.2, `mainDocument=true`), snap-align flags,
and an XMP/version trailer (`majorVersion`, `u16 buildNumber`, `"timecount = <time>"`).

---

## 7. Timeline streams — top-level structure

Each scene/symbol timeline is its own OLE2 stream (`P N <time>` for scenes, `Symbol N` /
`S N <time>` for symbols). The stream is a CArchive serialization rooted at a `CPicPage`
holding `CPicLayer`s, each holding `CPicFrame`s. **[V]**

---

## 8. `CPicPage` and `CPicLayer`

### 8.1 `CPicPage` — **[V]** (`TimelineConverter.convert` :3559)

```
u8 0x01                                  // leading marker
useClass("CPicPage")
u8 pageVersion = 0x04,  u8 0x00          // header schema
<layers>                                 // CPicLayer ×N, emitted REVERSE index order (background first)
// tail:
00 00,  00 00 00 80,  00 00 00 80        // INT_MIN transform-point sentinel
>= F8:  00 00                            // F8 pad
u8 pageVersionB = 0x07
u16 nextLayerId, 00
== MX2004 only: u16 nextFolderId, 00     // ABSENT in F8
>= F8:  u16 currentFrame, 00,  00, 00 00 00   // playhead + pad
>= F5:  u32 guideCount;  guideCount × { u32 direction(0=h,1=v); u32 valueTwips }   // RULER GUIDES
```

This resolves the old "CPicPage tail tables [X]": the trailing `{u32 count; count×8}` is the
**ruler-guides table** (`{direction, twips}` pairs). `nextFolderId` is MX2004-only.

> Layer storage order is **bottom-to-top** (background layer at binary index 0). The clone's
> model expects top-to-bottom, so importers reverse the layer list (see CLAUDE.md).

### 8.2 `CPicLayer` — **[V]**

`writeLayerContents` writes the frames first, then a layer-identity *trailer*:

```
useClass("CPicLayer")
u8 layerVersion = 0x04,  u8 0x00
<frames>                                 // CPicFrame ×N (§9)
// layer-properties block:
00 00,  00 00 00 80, 00 00 00 80         // transform-pt sentinel
>= F8:  00 00
u8 layerVersionB = 0x0B
BomString layerName
>= F4:  // F8 path
  u8 isSelected
  u8 hiddenLayer        // 1 = layer hidden (eye off)
  u8 lockedLayer        // 1 = locked
  FF FF FF FF
  u8 colR,colG,colB,0xFF                 // outline color
  u8 showOutlines       // outline && useOutlineView
  00 00 00, u8 heightMultiplier, 00 00 00     // row-height multiplier (byte at +3 of a 7-byte run)
u8 layerType            // 0=normal 1=guide 2=guided 3=folder 4=mask
```

**Layer trailer beyond the properties block** (`writeLayer` :3433+, resolves the old `[X]`):

```
>= MX (F8): // mask back-link block is F5-and-earlier only and is skipped
  if parentLayerIndex > -1:  encodedUI(parentNValue)     // CArchive obj-index of parent folder/mask
  else:                      u16 0                        // no parent (top-level)
  u8 open                 // folder/parent expanded in panel
  u8 autoNamed            // name auto-generated
  == CS4 only: u8 animationType    // ABSENT in F8
  // for nested normal layers: trailing encodedUI(ancestorNValue) chain links
```

`encodedUI` per §4.4. The parent link is the parent layer's running CArchive object index
(`1 + classesBefore + objectsBefore` at that layer's `useClass`), not its array index.

---

## 9. `CPicFrame` — **[V]**

`writeLayerContents` per-frame body (`fs = frameVersionB = 0x18 = 24` for F8, so all
`fs >= 19/22/24` branches fire). Header then body then a long tail. The header, display list,
and the leading frame fields (through the F5 `frameVersionC`/`frameId` block) are byte-verified
against a real empty Page stream (`findings/timeline-bytewalk.md`); the **exact byte order of
the F3+ sub-blocks below the frameId block** (motionTweenRotate / comment / MorphShape /
shapeTweenBlend / soundEffect / anchor / ease) is transcribed from flacomdoc's grouped emission
and is approximate — each field is verified, but a strict byte-walk shows the interleave differs
slightly (a `BomString ""` appears earlier than the grouping implies). Below:

```
useClass("CPicFrame")
u8 frameVersion = 0x04,  u8 0x00
<display list>                           // handleElements: instances/shapes/text/bitmaps (§5.3 each)
u8 frameVersionB = 0x18                  // the "fs" gate
u16 duration                             // frame span length
u16 keyMode                              // §9.1
u16 acceleration                         // classic-tween ease -100..100 as u16
>= F2: // sound assignment on the frame
  u16 soundId                            // 1-based media index, 0=none
  u16 pointCount; pointCount × { u32 mark44; u16 lvl0; u16 lvl1 }   // sound envelope (default 1 pt: 0,0x8000,0x8000)
  u16 soundLoop                          // 32767 if loop mode
  u8  soundSync                          // 0 event 1 start 2 stop 3 stream
  u32 inPoint44,  u32 outPoint44         // sample-accurate (default 0, 0x3FFFFFFF)
  u16 soundZoomLevel                     // default 0xFFFF
>= F3:  BomString name                   // frame label/comment string
>= F5:  u8 frameVersionC=4, 00 00 00,  u8 0x01, 00 00 00   // present-flag block
>= MX:  u8 (frameId>>8), u8 frameId&0xFF, 00 00 00 00 00 00    // frameId is BIG-endian here
>= CS3: 00 00 00 00
>= F3:  u32 motionTweenRotate (0 none,1 cw,2 ccw); u16 rotateTimes; 00 00
        u32 comment        // label is a comment
        <MorphShape or 00 00>  (§11)
        u8 shapeTweenBlend // 0 distributive, 1 angular
>= F3:  u8 0x00, u32 0,  BomString ""
>= F5:  01 00 00 00, u8 soundEffect (0..7), 00 00 00
>= MX:  u32 anchor       // label is a named anchor
// frame tail — resolves the old fs>15 [X]:
>= F8:
  u32 useSingleEaseCurve        // 1 = one ease curve for all props
  u32 hasCustomEase
  if hasCustomEase:  <custom ease table>  (§9.2)
== CS4 && <motionObjectXML>:    // ABSENT in plain F8 — this is the old "field_298"/tweenInstanceName
  BomString motionObjectXML;  u32 visibleAnimationKeyframes;  BomString tweenInstanceName
```

### 9.1 `keyMode` bitfield (u16) — **[V]**

Base normal keyframe = `0x2600` (KEYMODE_STANDARD). Tween bits: `0x0001` = **motion (classic)
tween**; `0x0002` = **shape tween**. Sub-property bits (high nibbles): `0x0100`
orientToPath, `0x0200` motionTweenScale, `0x0400` rotate≠none, `0x0800` sync, `0x1000` snap.
F8 clears `0x2000`; F4-and-earlier clears `0x4000`. (Classic-tween keyframes appear as e.g.
`0x4001+flags` or the standard `0x2600`+`0x0001`; a shape tween as `0x5602`.) This pins the
import rule: motion via `& 0x0001`, shape via `& 0x0002`.

### 9.2 Custom ease-curve table — **[V]**

When `hasCustomEase`, six fixed property slots are always written in order **position,
rotation, scale, color, filters, all**. Per slot:

```
u32 numPoints                  // 0 if that property has no custom curve
per point (over the raw <Point> list):
  if (first or last):  f64 x; f64 y       // endpoint emitted an EXTRA time
  f64 x; f64 y                            // every point
```

Each point is two LE doubles `(x,y)` (x = normalized time 0..1, y = normalized value); the
first and last anchors are written twice. This resolves §9.3 (the old endpoint-doubling guess).

### 9.3 Frame script (AS2) — **[V]**

F5+ stores the frame script as a single `BomString` of **plain AS2 source text** (within the
F5 block). F4-and-earlier use `FlaWriter.writeScript`, a structured action-record format
(per-command url/window/frameNum records) — bytecode-adjacent, source not directly present
(**[O]** for the pre-F5 record layout).

---

## 10. Shapes — `CPicShape` and geometry — **[V]**

`handleShape` (:2143). After the class tag:

```
>= F5 (group container only): u8 groupVersion=4; u8 ((selected?2)|(locked?4)|(floating?1))
instanceHeader   (instanceType = shapeType = 3)   // §5.3
u8 shapeVersion = 5
u32 totalEdgeCount
u16 fillStyleCount;   fillStyle ×N           (§10.1)
u16 strokeStyleCount; lineStyle ×N           (§10.2)
<edge stream>                                 (§10.3)
u8 0x00                                        // post-edge marker
>= F5: u32 cubicCount; cubic ×N               (§10.4)
```

### 10.1 Fill styles — **[V]** (`handleFill`)

Fill **type byte** values (`FlaWriter` consts): there is **no 0x20 subtype** — the old "0x20"
was a misread bitmap/gradient. The high bits are: **0x10 = gradient**, **0x40 = bitmap**,
neither = solid.

```
SOLID:           u8 R,G,B,A;  u8 0x00,0x00
GRADIENT:        u8 00 00 00 FF;  u8 type(0x10 linear / 0x12 radial);  u8 00;
                 Matrix gradientMatrix;  u8 stopCount;
                 >= F8: u8 focalRatio(=round(focal*255)); 00 00 00; u8 (flow|linearRgb); 00 00 00
                 per stop: u8 round(ratio*255), u8 R,G,B,A
BITMAP:          u8 FF 00 00 FF;  u8 type(0x40 tiled/0x41 clipped/0x42 tiled-nosmooth/0x43 clipped-nosmooth);
                 u8 00;  Matrix bitmapMatrix;  u16 bitmapId
```

`flow`: 0 extend, 4 reflect, 8 repeat; `+1` for linearRGB interpolation. Focal radial uses
type 0x12 with a non-zero focalRatio (never 0x13). The leading `…FF` byte must be 0xFF or
Flash drops the fill.

### 10.2 Line styles (LINESTYLE/LINESTYLE2) — **[V]** (`writeStrokeBegin`)

```
u8 R,G,B,A                       // line color
u16 widthTwips = round(weight*20)
u16 styleParam1, u16 styleParam2 // stroke style (solid/dashed/dotted/ragged/stipple/hatched), bit-packed
>= F8:  u8 pixelHinting; u8 scaleMode(0 normal,1 h,2 v,3 none); u8 capStyle(0 none,1 round,2 sq);
        u8 joinStyle(0 miter,1 round,2 bevel); u8 miterFrac; u8 miterInt
>= F8:  <trailing fill>          // a full fill record (solid → RGBA+0000; bitmap → writeBitmapFill)
```

Pre-F8 stroke = 10 bytes (RGBA + u16 width + 2×u16 styleParam), no caps/joins/miter and no
trailing fill. `styleParam2` encodes dotted/ragged/stipple/hatched parameters in bit fields
(low 3 bits = style id; `+0x8000` = sharp corners, MX+).

### 10.3 Edge stream — **[V]** (`writeEdges`/`writeEdge`/`writeXY`)

Each `<Edge>` carries `(strokeStyle, fillStyle0, fillStyle1)` indices and an edges string
(`!`=moveTo, `|`/`/`=line, `[`=quadratic curve). Per edge record:

```
u8 typeByte:  0x80 no-selection; 0x40 has-styles; TO size 0x20/0x30/0x10 (float/short/byte);
              CONTROL 0x08/0x0C/0x04 (curve only); FROM 0x02/0x03/0x01 (only if from != 0,0)
if has-styles:  u8 strokeIdx [u8 sel]; u8 fill0Idx [u8 sel]; u8 fill1Idx [u8 sel]   // ORDER: stroke, fill0, fill1
<from?> <control?> <to>          // each via writeXY
>= CS3 (straight only): u8 generalLineFlag    // absent in F8
```

`writeXY` per axis: **BYTE** `u8 frac, s8 int` (8.8 twips, 1px=5120); **SHORT** `s16 =
round(v*2)` (15.1); **FLOAT** `u8 frac, s24 int`. Coordinates are **deltas** from the pen;
a leading (0,0) moveTo is omitted. Style-change block order is **stroke, fill0, fill1**.

### 10.4 Cubic post-stream — **[V]** (F5+, resolves the old `[O]`)

```
u32 cubicCount
per cubic edge: s32 mx,my, x1,y1, x2,y2, ex,ey    // 32 bytes: move, 2 controls, end (plain twips)
>= CS3: u8 segCount; segCount×{ s32 x,y; u8 onCurve; u8 line }; u8 pnFlags; opt prev/next BCP   // absent in F8
```

In F8 each cubic entry is exactly the 32-byte core (eight s32 twips). This preserves the
authored cubic geometry alongside the quadratic edge stream for re-editing.

---

## 11. `CPicMorphShape` (shape-tween geometry) — **[V]**

On a frame with `<MorphShape>` (`:2849+`):

```
useClass("CPicMorphShape")
<57 fixed bytes>                          // two identity-ish matrices/flags, written verbatim
u16 segmentCount
per segment:
  useClass("CMorphSegment")
  u32 strokeIdx1, strokeIdx2, fillIdx1, fillIdx2   // 0xFFFFFFFF = none
  Point8_24 startA;  Point8_24 startB              // 8 bytes each
  u16 curveCount
  per curve:
    useClass("CMorphCurve")
    Point8_24 ctrlA, anchorA, ctrlB, anchorB        // 4 points
    u8 isLine;  u8 00 00 00                          // resolves CMorphCurve "unknown1/2"
u16 0x0000                                          // segment-list terminator (resolves "trailing u16")
u16 fillCount;   morphFill ×N                        // §11.1
u16 strokeCount; morphStroke ×N                      // §11.2
```

### 11.1 Morph fill — **[V]**

```
null:     RGBA 00 00 00 00,  u16 0x0000
SOLID:    u8 R,G,B,A,  u16 0x0000
GRADIENT: u8 00 00 00 FF,  u16 type(0x10/0x12),  Matrix,  u8 stopCount, per stop (u8 ratio, RGBA)
BITMAP:   u8 FF 00 00 FF,  u8 type(0x40..0x43), u8 00,  Matrix,  u16 bitmapId
```

Note: morph gradient `type` is **u16** here (vs u8 in static shapes) and has no F8 focal/flow
block.

### 11.2 Morph stroke — **[V]**

Each record is **10 bytes**: `u8 R,G,B,A; u32 round(weight*20); u16 0x0000`. Empty-stroke
fallback writes count 1 (F8) with one zeroed 10-byte record (MX-and-earlier write count 2).

---

## 12. Symbol instances — `CPicSprite` / `CPicButton` / `CPicSymbol` — **[V]**

Class by symbolType: graphic→`CPicSymbol`, button→`CPicButton`, movieclip→`CPicSprite`. Common
prefix (`handleSymbolInstance` :735):

```
u8 spriteVersion = 4
instanceHeader   (instanceType = symbolType = 0x13)   // §5.3 — carries matrix, cacheAsBitmap, selected/locked
u16 firstFrame                                          // graphic only (0-based)
u8 loopMode        // MC→0x02; button→0x00; graphic: loop 0 / playOnce 1 / singleFrame 2
u8 0x00
>= F4: u8 0x01
>= F2: <color effect>                                   // §12.2
>= F3: BomString ""
u16 libraryItemIndex                                    // 1-based into library symbols
u8 0x00, u8 0x00                                        // (libraryItemIndex hi-extension?) [O]
>= MX2004: 00 00 00
>= F8: <filter list> (§14.2);  u8 blendMode, 00, 00    // §12.1
```

- **graphic**: returns here — no tail.
- **movieclip (sprite) tail**: `u8 spriteVersionG=8`, `spriteVersionB=4 00 00 00 01 00 00 00`,
  `u16 symbolInstanceId`(random), CS3:`00000000`, `00 00 00 00 00 00`, `BomString clipScript`,
  `BomString instanceName`, `02 00 00 00 00 01 00 00 00`, `writeAccessibleData` (§17.2),
  `00 00000000 000000`, then MX2004+ component metadata (§13).
- **button tail**: `buttonVersion=0x0B spriteVersionB=4 00 00 00 01 00 00 00`, (MX+) symbol
  instance id block, `BomString clipScript`, `u8 trackAsMenu`, `BomString instanceName`,
  `writeAccessibleData`, `00 00 00 00`.

CS4 adds a 3D matrix/rotation block in the common prefix (absent in F8).

### 12.1 Blend mode byte → name — **[V]**

1 normal, 2 layer, 3 multiply, 4 screen, 5 lighten, 6 darken, 7 difference, 8 add, 9 subtract,
10 invert, 11 alpha, 12 erase, 13 overlay, 14 hardlight (0 = unset sentinel).

### 12.2 Color effect — **[V]** (`coloreffects/*`)

```
>= F3: u16 alphaMul, u16 alphaOffset
       u16 redMul, u16 redOffset, u16 greenMul, u16 greenOffset, u16 blueMul, u16 blueOffset
       u8 type, u8 0x00
       u16 valuePercent
       u8 effectColor R,G,B,A
```

Multipliers are SI16 with **256 = 1.0**. `type`: 0 none, 1 brightness, 2 tint, 3 advanced,
4 alpha. Derivations: brightness → RGB-mul `round((1-|b|)*256)`, percent `round(b*100)`; tint →
RGB-mul `round((1-amt)*256)`, RGB-offset `round(color*amt)`, color = tint color; alpha →
alphaMul `round(a*256)`; advanced → muls `round(v*256)`, offsets verbatim.

---

## 13. Component metadata (sprite tail) — **[V]**

For MX2004+ movieclip/sprite instances only (`:1187`):

```
u8 0x01, u32 0                  // u32 resets on resave
BomString componentXML          // "<component metaDataFetched='true' schemaUrl='' schemaOperation=''
                                 //   sceneRootLabel='Scene 1' oldCopiedComponentPath='N'>\n</component>\n"
```

A populated component (with parameters) fills `schemaUrl`/`schemaOperation` and child nodes.
This resolves the old "CString of unknown schema" — it is a length-prefixed BomString of XML.

---

## 14. Filters

### 14.1 SWF-wire filters — **[V]**

The runtime/SWF filter records (DropShadow/Blur/Glow/Bevel/Gradient*/ColorMatrix) follow the
Adobe SWF spec wire format; see Ruffle `swf` crate. Used when filters reach the SWF.

### 14.2 FLA-authoring filters — **[V]** (`filters/*`, F8+ instance/text tail)

List wrapper: if filters present → `u8 0x01`, `u32 filterCount`, then each `filter.write()`;
else `u8 0x00`. Each filter body starts with a per-filter ID tag + sub-header, then
`u32 enabled`, then its fields. Multi-byte ints u32 LE; floats IEEE-754 LE; angles in radians;
`strengthPercent = round(strength*100)` as u16-in-u32.

```
DropShadow  (00, 04 01):   enabled; RGBA color; f32 distance; f32 blurX; f32 blurY; f32 angle;
                           u32 inner; u32 knockout; u32 quality; u16 strength,00,00; u8 hideObject,00 00 00
Blur        (01 03,04 01): enabled; FF FF FF FF; <5f const>; f32 blurX; f32 blurY; <45°const>;
                           00×8; u32 quality; <100 const> 00×6        // only blurX/Y/quality meaningful
Glow        (02 03,04 01): enabled; RGBA; <5f const>; f32 blurX; f32 blurY; <45°>; u32 inner;
                           u32 knockout; u32 quality; u16 strength,00,00; 00 00 00 00
Bevel       (03 03,04 01): enabled; RGBA shadow; f32 distance; f32 blurX; f32 blurY; f32 angle;
                           u32 (type==inner); u32 knockout; u32 quality; u16 strength,00,00; 00×4;
                           RGBA highlight; u32 (type==full)
GradientGlow(04 01,04 01): enabled; 00 00 00 FF; f32 distance/blurX/blurY/angle; u32(inner);
                           u32 knockout; u32 quality; u16 strength,00,00; 00×4; u32 gradCount; 00×4;
                           u32(full); per entry: u32 round(ratio*255), RGBA
GradientBevel(07 01 01,04 01): like GradientGlow (gradient entry alpha is buggy in CS5 — [O])
AdjustColor (06 01 01):    enabled; f32 brightness; f32 contrast; f32 saturation; f32 hue
```

Bevel `type`: 1 inner, 2 outer, 3 full. This resolves the old "filter interior constants [X]"
— every byte is a filter-ID tag, a fixed sub-header, or a baked angle/strength constant.

---

## 15. `CPicText` — **[V]** (`handleText` :1275)

```
u8 textVersionC = 4
instanceHeader   (instanceType = textVersion = 0x0D)
u32 left*20, u32 (left+width)*20, u32 top*20, u32 (top+height)*20    // bounds, twips
u8 autoExpand
>= F3: u8 0x00
>= F4: u8 textFlags                  // §15.1
u8 embedFlag                          // §15.2
>= F5: u8 staticFlags  (static: bit0 selectable, bit1 device-font[CS3+]; non-static 0);  u8 0x00
>= F4: u16 maxCharacters;  BomString variableName
       if embeddedCharacters: BomString embeddedCharacters
<text run blocks>                     // §15.3
// tail:
00 00
>= MX: BomString instanceName;  writeAccessibleData;  00 00 00 00, u8 scrollable, 00 00 00
>= MX2004: BomString "";  BomString embedRanges(joined "|")
>= F8: <filter list> (§14.2);  00 00
```

### 15.1 `textFlags` (u8) — **[V]**

`0x01` non-static (dynamic|input); `0x02` dynamic; `0x04` password; `0x08` word-wrap; `0x10`
multiline; `0x20` includeOutlines (embed fonts); `0x40` border; `0x80` (dynamic && renderAsHTML
&& !selectable). **selectable** = bit0 of the `staticFlags` byte; **scrollable** = the byte in
the MX tail above.

### 15.2 `embedFlag` (u8) — **[V]**

bit0 font embedded; bits1–4 embed ranges 1..4 (`1<<rangeId`); 0x20 embeddedCharacters present;
0x40 isEmpty; 0x80 renderAsHTML (F5+).

### 15.3 Text run formatting block — **[V]** (per merged run)

```
u16 charCount (if non-empty)
u8 textVersionB = 0x0C
u16 size*20
String fontFamily        (BomString in CS4)
u8 R,G,B,A               // fill color
u8 0x12, u8 0x00         // font-class flags (family-dependent; meaning partly unknown [O])
u8 bold, u8 italic, u8 0x00, u8 autoKern, u8 charPosition(0 norm,1 super,2 sub), u8 alignment(0 L,1 R,2 C,3 J)
u16 lineSpacing*20, u16 indent*20, u16 leftMargin*20, u16 rightMargin*20
>= F5: u16 letterSpacing*20    (F4: a single 0x00)
String url
>= MX: u8 vertical, u8 rightToLeft, u8 rotation
>= MX2004: u8 (renderMode==BITMAP)
>= MX: String target
>= F8: u8 0x02; u8 renderMode(device 0/bitmap 1/standard 2/default 3/custom 4 → 0/1/.../2);
       f32 antiAliasThickness; f32 antiAliasSharpness (or 8 zero if device); String url
characters: UTF-16LE (unicode) / charset bytes
```

---

## 16. Media display objects — **[V]/[X]**

### 16.1 `CPicBitmap` — **[V]**

```
u8 bitmapVersion = 4
instanceHeader   (instanceType = bitmapType = 2)
u16 mediaId                          // 1-based into name-sorted media list
>= MX2004: u8 0x00                   // (filter flag, 0)
```

No width/height/scale fields: display scale lives in the placement matrix; intrinsic pixel
size lives in the library `DOMBitmapItem`. Smoothing is a fill-style property (0x42/0x43 vs
0x40/0x41), not a placement byte.

### 16.2 `CPicVideoStream` — **[V]**

```
useClass("CPicVideoStream")
u8 videoStreamVersion = 4
instanceHeader   (instanceType = videoType = 4)
u32 frameLeft, frameRight, frameTop, frameBottom    // crop rect
u8 0x00
BomString ""
BomString name                       // instance name
01 00 00 00
u16 videoId                          // 1-based media index
```

(The embedded-clip variant `CPicVideo` is a distinct 160-byte class that flacomdoc never
emits; it remains **[I]** — no writer, no sample.)

### 16.3 `CPicSwf` (imported SWF) — header **[O]**, body **[X]** (bounded)

flacomdoc has **no** SWF-import write path, and fla-decoder has no `read_cpicswf`, so the record
cannot be transcribed from a writer. Headless JSFL cannot generate one either — `importFile`
of a content-bearing SWF pops a modal that hangs session-0 Flash (the same trap as linkage). The
structure below is **observed** by differential analysis of the four real `CPicSwf` records in
`fixtures/Magnet.fla` (`Page 1/6/7/8`, the reused "Claw" imported SWF): comparing the instances
separates per-placement fields (differ) from SWF-intrinsic metadata (constant across reuse).
Class facts (fla-decoder Ghidra): `CPicSwf : CPicObj`, class size 308 B, schema 1, `serialize`
VA `0x9490400`.

```
useClass("CPicSwf")
instanceHeader            // §5.3: stateFlags(selected/locked), pad, transform-pt, F8 byte+cacheAsBitmap,
                          //       instanceType, 24-byte matrix  (per-placement part; differs per instance)
// SWF-intrinsic metadata block (CONSTANT across reuse of the same imported SWF) — [O]:
u32 swfWidthTwips         // 0x10b6 = 4278 ≈ 213 px  (imported SWF stage width)
u32 swfHeightTwips        // 0x6ec  = 1772 ≈  88 px
... u32 size/bounds words // incl. 0x13cc6 (=81094) twice (content/byte size); 0xbe1, 0x5dc secondary bounds
u32 ... counts/flags      // e.g. 0x1e, 01 00 00 00 markers
BomString clipActions     // onClipEvent(...) handlers — imported SWFs carry instance scripts like any clip
<decomposed SWF content>  // bulk (~900–5400 B): Flash's INTERNAL decomposition of the movie
                          //   (NOT raw SWF bytes — no FWS/CWS signature present). [X]
```

**Why it can't be reproduced (legacy record):** in Flash 8, `Import to Stage` of a `.swf`
**breaks the movie apart** into shapes/symbols on the timeline — it does *not* create a single
`CPicSwf` object (verified: a manual Flash 8 import produces no `CPicSwf`). `CPicSwf` is a
**legacy** form from older Flash, where an imported SWF was kept as one linked object; Magnet's
records ("Claw.swft"/"claw2.swft") were authored that way and upgraded. So the record cannot be
freshly generated by Flash 8 at all, headless or interactive.

**Residual:** the placement header + SWF-metadata block + clip-actions are decoded to **[O]**;
the trailing decomposed-content bulk is **[X]** (Flash's internal movie representation, no
byte-verified writer exists, not freshly producible). Imported SWFs are **out of the normal
authoring round-trip** (the clone never emits them), so a reader need only resync past the
record (next sibling class tag, §5.1). Fully decoding the bulk would require Ghidra at the cited
VA on `flash.exe` — disproportionate for a legacy, out-of-scope record.

---

## 17. Color transform & accessibility

### 17.1 Color effect

See §12.2 (the inline instance color effect). [V]

### 17.2 Accessibility — `writeAccessibleData` — **[V]**

Called for button/sprite instances, text, and the main document. If no accessibility data:
emit a single `0x00` (main document only), else nothing.

```
u8 accessibilityVersion = 2, u8 0x00
00 00, u8 silent, 00 00 00            // silent = "make object accessible" inverted
BomString name
BomString description
BomString shortcut
>= MX2004: BomString tabIndex (as string), BomString ""
u8 forceSimple, 00 00 00              // "make child objects accessible" inverted
mainDocument only: u8 (autoLabeling?0:1)
```

### 17.3 scale9Grid — **[V]**

In the symbol-definition `CDocumentPage` (F8+, 20 bytes):

```
if any edge != 0:  u32 1; u32 right*20; u32 left*20; u32 bottom*20; u32 top*20   // order R,L,B,T
else:              u32 0; (00 00 00 80) ×4
```

---

## 18. Gap status

Every gap from the prior revision is now resolved against the byte-verified writer and/or the
oracle, except one bounded residual.

| Area | Prior | Now | Resolution |
|------|-------|-----|------------|
| `CPicObjBase`/instance flags | [X] | **[V]** | selected(0x02)/locked(0x04)/floating(0x01) authoring state — §5.3 |
| Contents structured layout | [X] | **[V]** | full `FlaConverter.convert` walk — §6 |
| Stage dims/bg/fps | [X] | **[V]** | §6.6, verified by oracle ramps |
| Symbol linkage flag bytes | [I] | **[V]** | two packed bitfield bytes (flagsA/flagsB) — §6.4 |
| scale9Grid | [O] | **[V]** | 20-byte R/L/B/T block — §17.3 |
| `CMediaSound` | [O] | **[V]** | §6.5 |
| `Font N` interior | [X] | **[V]** | §6.7 |
| `CPicFrame` tail fs>15 | [X] | **[V]** | useSingleEaseCurve/hasCustomEase/CS4 motion XML — §9 |
| Ease-curve point format | [O] | **[V]** | 6 slots, double pairs, endpoint doubled — §9.2 |
| orientToPath/snap bits | [I] | **[V]** | keyMode high bits — §9.1 |
| 0x20 fill subtype | [X] | **[V]** | no such subtype; 0x10 grad / 0x40 bitmap — §10.1 |
| Shape cubic post-stream | [O] | **[V]** | F5+ 32-byte entries — §10.4 |
| `CMorphCurve` unknowns | [X] | **[V]** | isLine + pad + terminator — §11 |
| Morph fill/stroke tables | [O] | **[V]** | §11.1/11.2 |
| `CPicSwf` variable tail | [X] | **[O] header / [X] bulk** | header+metadata+clip-actions decoded from Magnet's 4 samples; decomposed-content bulk needs Ghidra — §16.3 |
| `CPicVideo` (embedded) | [I] | **[V]** for `CPicVideoStream` | stream form fully decoded; embedded variant remains [I] — §16.2 |
| FLA filter interior constants | [X] | **[V]** | filter-ID tags + constants enumerated — §14.2 |
| Component metadata XML | [X] | **[V]** | BomString of `<component>` XML — §13 |
| Accessibility byte layout | [I] | **[V]** | §17.2 |
| `CPicText` scrollable/selectable | [I]/[O] | **[V]** | staticFlags bit0 / MX-tail byte — §15 |
| Layer trailer | [X] | **[V]** | parent encodedUI + open/autoNamed — §8.2 |
| `CPicPage` tail tables | [X] | **[V]** | ruler-guides table — §8.1 |
| Flash ≤4 frame actions | [X] | **[O]** | structured `writeScript` record format (F4-) — §9.3 |
| Pre-MX2004 ASCII coverage | [O] | **[V]** | gated by `unicode=false` + per-version schema (§3/§4.1) |

**Net: one residual [X]** — the imported-SWF (`CPicSwf`) body, which is out of the authoring
round-trip and only requires resync. Everything else is [V].

---

## 19. Verification & round-trip proof

The spec is proven by reading and (round-trip) writing real FLAs:

- **Reader:** `tools/flashdrv/flaparse.py` walks the CFB container (`fla_cfb.py`) and the
  document catalog + CArchive class inventory per this spec; verified on Magnet (6 scenes,
  61 symbols, 16 classes), golden, and evaporatingdrip (`findings/read-proof.txt`).
- **Timeline byte-walk:** `findings/timeline-bytewalk.md` reconciles every byte of a real
  empty Page stream against §5/§8/§9/§10.
- **Round-trip:** `tools/flashdrv/flaroundtrip.py` re-serializes a parsed stream and asserts
  byte-equality with the original (volatile bytes masked per `FLA-RE-PLAN.md`). Validated
  against real **Flash 8-authored** FLAs from the flashdrv oracle (`corpus/`) and the sample
  fixtures (`fixtures/Magnet.fla`, `golden.fla`, `evaporatingdrip.fla`).
- **Oracle:** `tools/flashdrv/` drives a real Flash 8 install as a differential oracle; the
  stage-block decode (§6.6) was confirmed this way. See `FLA-RE-PLAN.md` for the operational
  log of what worked / what didn't (notably: JSFL linkage edits hang session-0 Flash, so the
  linkage block is verified from flacomdoc rather than the oracle).

Recorded proofs live in `tools/flashdrv/findings/`.

---

## 20. Provenance

- **JPEXS `flacomdoc`** (`tools/refs/flacomdoc/`) — byte-verified XFL→binary-FLA writer.
  `FlaWriter`/`FlaConverter`/`TimelineConverter`/`FlaFormatVersion` are the authoritative field
  order, encoding, and schema gates.
- **`eddiemoore/fla-decoder`** (`tools/refs/fla-decoder/`) — Ghidra RE of `flash.exe`; confirms
  the CArchive protocol, class table, and schema gates from the reader side.
- **flashdrv oracle** (`tools/flashdrv/`) — real Flash 8 differential oracle (Win7 VM).
- **Ruffle `swf` crate** — SWF-wire filter/shape encodings the FLA reuses.
- **Microsoft [MS-CFB]** — OLE2 container. **Adobe SWF spec** — twips/fixed-point/filters.
