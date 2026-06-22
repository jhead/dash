# Binary FLA Format — File Format Specification

This document specifies the binary `.fla` document format produced by Macromedia Flash 8. Field
layouts are given for the Flash 8 on-disk form; per-field version gates mark the fields that
appear in other releases of the Flash 5 through CS4 family, so a reader targeting an adjacent
release can follow the same structures with the gated fields included or omitted.

A FLA document is a Microsoft Compound File Binary container holding several named streams. One
stream, `Contents`, is the document catalog: stage settings, the scene list, the symbol library,
and references to imported media. Each scene and each library symbol has its own stream holding a
serialized timeline. All streams use the same underlying object encoding, the MFC `CArchive`
protocol described in section 5.

---

## Table of contents

- [1. Conventions and notation](#1-conventions-and-notation)
- [2. Container: Compound File Binary](#2-container-compound-file-binary)
- [3. Version constants](#3-version-constants)
- [4. Primitive encodings](#4-primitive-encodings)
- [5. Object protocol](#5-object-protocol)
- [6. Reading a document](#6-reading-a-document)
- [7. Resynchronization](#7-resynchronization)
- [8. Contents stream](#8-contents-stream)
- [9. Timeline streams](#9-timeline-streams)
- [10. Page and layer records](#10-page-and-layer-records)
- [11. Frame records](#11-frame-records)
- [12. Shape records](#12-shape-records)
- [13. Morph shape records](#13-morph-shape-records)
- [14. Symbol instance records](#14-symbol-instance-records)
- [15. Component metadata](#15-component-metadata)
- [16. Filters](#16-filters)
- [17. Text records](#17-text-records)
- [18. Media records](#18-media-records)
- [19. Color, accessibility, and scale-9](#19-color-accessibility-and-scale-9)
- [20. Field confidence](#20-field-confidence)
- [21. Known gaps](#21-known-gaps)

---

## 1. Conventions and notation

Multi-byte integers are little-endian unless a field is explicitly marked otherwise. Layouts are
written in a pseudo-C notation:

```
Integers      u8 u16 u32 u64                unsigned
              s8 s16 s24 s32                signed, two's complement
                 s24 is three bytes; sign-extend from bit 23
Floating      f32  f64                      IEEE-754
Fixed-point   fixed16  = s32 / 65536        16.16, used for matrix scale terms
              fix8_8   = u8 frac, s8 int    one fraction byte then one signed integer byte
              fix8_24  = u8 frac, s24 int   one fraction byte then a signed 24-bit integer
Strings       String      length-prefixed text, section 4.1
              BomString   String preceded by a byte-order mark, section 4.1
Variable int  encodedUI   u16, or an escaped 32-bit form, section 4.4
Composite     Matrix      24 bytes, section 4.2
              RGBA        u8 red, green, blue, alpha
              Point8_8    one fix8_8 per axis, used by shape edges
              Point8_24   one fix8_24 per axis, used by morph geometry
```

Fixed-point values store the fraction byte first, so the type names `fix8_8` and `fix8_24` are
written fraction-bits-then-integer-bits to mirror that storage order. The numeric value is always
`integer + fraction / 256`.

Field annotations use `skip(n)` for exactly `n` uninterpreted bytes, `if (>= F8)` for a field
present only when the target release is Flash 8 or later, and `field[count]` for an array. The
release order for version gates is F5, MX, MX2004, F8, CS3, CS4.

An offset written `@N` is relative to the start of the enclosing record or block. An offset
written `@abs N` is an absolute position within a stream and is given only as an illustrative
anchor for a default, empty document; absolute positions shift with any preceding variable-length
data and are not part of the normative layout.

Section 20 records, in a single table, the confidence level for each structure in this document.
Individual layouts carry no inline confidence marks; consult section 20 for the status of any
record.

---

## 2. Container: Compound File Binary

A FLA file is a standard Microsoft Compound File Binary, the same container used by legacy
Microsoft Office documents. The 512-byte header describes the sector geometry and the locations
of the sector-allocation tables and the directory.

```
Header @abs 0
  u8[8]  magic            @0   = D0 CF 11 E0 A1 B1 1A E1
  u16    sectorSizePow    @30  sectorSize = 1 << pow, 512 for v3 or 4096 for v4
  u16    miniSectorPow    @32  miniSector = 1 << pow, usually 64
  u32    fatSectorCount   @44
  u32    firstDirSector   @48
  u32    miniStreamCutoff @56  usually 4096
  u32    firstMiniFat     @60
  u32    miniFatCount     @64
  u32    firstDifat       @68
  u32    difat[109]       @76
```

A sector's file offset is `512 + sector * sectorSize`. The allocation table uses the sentinels
`ENDOFCHAIN = 0xFFFFFFFE`, `FREESECT = 0xFFFFFFFF`, `FATSECT = 0xFFFFFFFD`, and
`DIFSECT = 0xFFFFFFFC`. Directory entry types are 1 for storage, 2 for stream, and 5 for the root
entry.

Streams smaller than `miniStreamCutoff` do not occupy ordinary sectors. They live in 64-byte mini
sectors carved out of the root entry's own stream and are indexed by the mini-FAT. Most timeline
streams are small and are stored this way; reading them through the main FAT yields unrelated
bytes.

Each directory entry is 128 bytes: a UTF-16 name at offset 0 of `(nameLen@64 - 2) / 2`
characters, a type byte at 66, left, right, and child sibling pointers at 68, 72, and 76, the
starting sector at 116, and the 64-bit size split across 120 and 124.

The streams a reader expects are `Contents`, the document catalog described in section 8; one
`Page N <time>` stream per scene and one `Symbol N` or `S N <time>` stream per library symbol,
each holding a timeline as described in section 9; and `Media N <time>` streams holding the
encoded payloads of imported sounds, bitmaps, and video.

---

## 3. Version constants

Every record begins with one or more version bytes. A reader uses them to confirm alignment and
to gate optional fields; a writer stamps the literal values below. The Flash 8 values are:

| constant | value | constant | value | constant | value |
|---|---|---|---|---|---|
| contentsVersion | 0x3F | spriteVersionG | 8 | mediaSoundVersion | 6 |
| contentsVersionB | 1 | buttonVersion | 0x0B | mediaSoundVersionB | 0x0A |
| documentPageVersion | 0x17 | symbolType | 0x13 | mediaSoundVersionC | 6 |
| documentPageVersionB | 6 | shapeType | 3 | mediaVideoVersion | 6 |
| colorDefVersion | 4 | bitmapType | 2 | mediaVideoVersionB | 7 |
| pageVersion | 4 | videoType | 4 | mediaVideoVersionC | 6 |
| pageVersionB | 7 | fontVersion | 2 | mediaVideoVersionD | 2 |
| frameVersion | 4 | fontVersionB | 0x0C | asLinkageVersion | 7 |
| frameVersionB | 0x18 | fontVersionC | 6 | asLinkageVersionB | 2 |
| frameVersionC | 4 | textVersion | 0x0D | libraryFolderVersion | 7 |
| layerVersion | 4 | textVersionB | 0x0C | libraryFolderVersionB | 4 |
| layerVersionB | 0x0B | textVersionC | 4 | libraryFolderVersionC | 6 |
| spriteVersion | 4 | bitmapVersion | 4 | libraryFolderVersionD | 2 |
| spriteVersionB | 4 | videoStreamVersion | 4 | accessibilityVersion | 2 |
| spriteVersionC | 7 | groupVersion | 4 | shapeVersion | 5 |
| spriteVersionD | 6 | mediaBitsVersion | 6 | generatorVersion | 9 |
| spriteVersionE | 6 | mediaBitsVersionB | 3 | generatorBuild | 494 |
| spriteVersionF | 2 | mediaBitsVersionC | 6 | unicode | true |

The frame schema gate referenced throughout section 11 is `frameVersionB`, value 0x18, not
`frameVersion`. Because `unicode` is true for Flash 8, every text string is a BomString. The
values `symbolType`, `shapeType`, `bitmapType`, and `videoType` serve as the type discriminator
inside the instance header of section 5.3.

---

## 4. Primitive encodings

### 4.1 Strings

A `String` is a length prefix followed by character data. The prefix escalates with length: a
single byte for lengths below 0xFF, otherwise 0xFF and a 16-bit length, otherwise 0xFF, 0xFFFF,
and a 32-bit length. When the document is in unicode mode, which is always the case for Flash 8,
the prefix counts UTF-16 code units, the body is UTF-16LE, and the body byte count is twice the
prefix. A character outside the Basic Multilingual Plane occupies two code units. In the older
non-unicode mode the prefix counts bytes and the body is in the document's code page.

A `BomString` is a `String` preceded by the three bytes `FF FE FF` in unicode mode. An empty
Flash 8 BomString is therefore `FF FE FF 00`.

### 4.2 Matrix

A matrix occupies 24 bytes in the order `a, b, c, d, tx, ty`. The scale and skew terms `a`, `b`,
`c`, and `d` are each `s32` holding the value times 65536, a 16.16 fixed-point number. The
translation terms `tx` and `ty` are each `s32` holding the value in twips, twenty units per pixel.

### 4.3 Color

A color is four bytes in red, green, blue, alpha order. Solid fills and strokes carry a full RGBA
color. The stage background color is written with the three color bytes followed by a constant
alpha byte of 0xFF.

### 4.4 Variable integers and points

An `encodedUI` is a `u16` when the value is below 0x7FFF, and otherwise the two bytes `FF 7F`
followed by a `u32`. A `Point8_24` stores each axis as a fraction byte and a signed 24-bit
integer, which the reader sign-extends from bit 23. A `Point8_8`, used by shape edges, stores
each axis as a fraction byte and a signed integer byte.

The byte pair `FF 7F` followed by a `u32` also denotes an extended class backreference in the
object protocol of section 5.1. The two uses are unrelated and are distinguished entirely by
context; a value position never carries a class tag and vice versa.

---

## 5. Object protocol

Each stream is a serialized object graph in the MFC `CArchive` format. Objects are introduced by
a tag word, are dispatched to a per-class reader, and may contain child objects terminated by a
null tag. A class is named once, on first use, and is thereafter referenced by a numeric index.

### 5.1 Tag words

At every position where an object may begin, the reader reads a `u16` tag.

| tag | meaning | trailing data |
|---|---|---|
| 0x0000 | null, or end of a child list | none |
| 0x0001 through 0x7FFE | invalid at a tag position | none |
| 0x7FFF | extended backreference | `u32` equal to 0x80000000 plus the class index |
| 0x8000 with index in the low bits | backreference to a declared class | none |
| 0xFFFF | new class declaration | `u16` schema number, `u16` name length, then that many ASCII bytes |

At a tag position the value is always 0x0000, 0x8000 with a previously declared index, 0x7FFF, or
0xFFFF. A value in the range 0x0001 through 0x7FFE, or a backreference to an index that has not
been declared, means the reader is not at a tag position but inside a record body, and is the
condition that triggers the resynchronization procedure of section 7. A reader may assert this
invariant at every object boundary.

The schema number after 0xFFFF is the per-class version and is normally 1. The class name is
encoded in the Windows-1250 code page.

### 5.2 Class index allocation

A single running counter, incremented on every tag read, assigns class indices. When a class is
first declared, its index is one plus the number of classes declared earlier plus the number of
objects read earlier. Every later tag, whether a new declaration or a backreference, still
advances the counter. The following trace shows a stream that declares a page, two frames, and a
shape:

```
read   tag                 classes before   objects before   resulting index
  1    new CPicPage              0                0           1 + 0 + 0 = 1
  2    new CPicFrame             1                1           1 + 1 + 1 = 3
  3    backref to CPicFrame      -                2           (reuses 3)
  4    new CPicShape             2                3           1 + 2 + 3 = 6
```

The shape's index is 6, so a later backreference to it is the tag 0x8006. A model that allocates
two fixed slots per class is correct only when no objects fall between declarations; the running
counter is authoritative.

### 5.3 Instance header

Every placed display object — a symbol instance, a bitmap, a video, a text field, and, with the
floating bit, a group or raw shape — begins with a common placement header immediately after its
class tag and leading version byte.

```
if (placed instance) u8 stateFlags
u8 0x00, u8 0x00
if (transform point absent)  s32 0x80000000, s32 0x80000000
else                         s32 tptX, s32 tptY
if (>= F8) u8 0x00, u8 cacheAsBitmap
u8 instanceType
Matrix placeMatrix
```

The transform point is the object's registration point in twips. When the object has no explicit
registration point Flash writes the sentinel `0x80000000`, the smallest signed 32-bit integer, in
each axis. The `instanceType` byte is the relevant type constant from section 3: 0x13 for a
symbol, 3 for a shape, 2 for a bitmap, 4 for a video.

The `stateFlags` byte records authoring state, not visibility. Bit 0, value 0x01, marks a
floating raw shape and appears only in the group and shape form of the header. Bit 1, value 0x02,
marks the object as selected at save time. Bit 2, value 0x04, marks it locked. The remaining bits
are zero.

Container records such as pages, layers, frames, and shapes use a different and simpler base than
this placement header: a schema byte, a flags byte, the child list, and a trailing registration
point. The placement header above applies to placed display objects only.

---

## 6. Reading a document

A complete read proceeds as follows. Open the file as a Compound File Binary and index its
streams by name. Parse the `Contents` stream, section 8, to obtain the stage properties, the
ordered scene list, the symbol library, and the media list. For each scene, in the order the
catalog lists it, open its `Page N <time>` stream and walk its object graph: a page record holds
layers, each layer holds frames, and each frame holds display objects. Walk each library symbol's
stream the same way, since a symbol timeline has the identical structure. Resolve media payloads
from the `Media N <time>` streams as the records reference them by index.

Walking an object graph means maintaining the class table of section 5.2 and, at each object
boundary, reading a tag. A new-class tag registers the class and dispatches to its reader; a
backreference dispatches to the already-known class; a null tag ends the current child list and
returns to the parent. A record body has no length prefix, so the reader advances through it
field by field using the layout for that record. A record that cannot be interpreted is handled
by the resynchronization procedure of section 7.

---

## 7. Resynchronization

When a reader consumes a record body correctly it ends, by construction, at the next object
boundary, so resynchronization is needed only when a record is deliberately skipped or when a
defect leaves the cursor misaligned.

To resynchronize, scan forward for the next valid object boundary as defined in section 5.1.
A candidate is a 0xFFFF tag followed by a plausible class declaration, meaning a small schema
number, a name length between 2 and 40, and a name of ASCII letters beginning with the letter C;
or a backreference tag whose index is already in the class table and which is followed by a
plausible record header for that class. Accept the first candidate that also validates one record
further on, where reading that record's body again leaves the cursor at a valid tag. Otherwise
continue scanning.

A reader must not resynchronize by scanning for an end-of-record marker. The ten-byte sequence of
a null child tag followed by two sentinel registration points, `00 00 00 00 00 80 00 00 00 80`,
also appears at the start of any record whose registration point is uninitialized, and within the
instance header of any object whose transform point is absent. Scanning for that sequence
therefore lands inside a record rather than at its boundary. Resynchronize only to a class tag,
and always validate one record ahead before accepting it.

---

## 8. Contents stream

The `Contents` stream is the document catalog. It opens with a fixed preamble, lists the scenes
and then the library symbols as `CDocumentPage` records, carries the stage and document
properties, and closes with the color table, folders, fonts, guides, and a version trailer. The
per-frame timeline for each scene and symbol lives in a separate stream; the catalog records hold
only the library metadata.

### 8.1 Preamble

```
u8  contentsVersion  = 0x3F
u8  contentsVersionB = 1
skip(3)                                  // 00 00 00
if (>= F3) skip(1)
if (>= F4) skip(1)
if (>= F5) u32 0
if (>= MX) u32 0
if (>= MX2004) u32 0
if (>= F8) u32 0
if (>= CS3) u32 0
if (== CS4) u32 0
```

For Flash 8 the preamble is 23 bytes and the first scene's `CDocumentPage` tag follows it.

### 8.2 Scene records

Scenes are stored as `CDocumentPage` records in authored play order. That play order is the order
the records appear here; the numeric suffix of a scene's `Page N` stream reflects creation order
and is not the play order.

```
new class CDocumentPage
u8  documentPageVersion = 0x17
String pageName                          // unicode, for example "Page 1"
BomString sceneName                      // for example "Scene 1"
u16 symbolId = 0
u16 0
u8  symbolType = 0
if (>= F4):
  BomString ""
  skip(15)                              // 01 00 00 00, documentPageVersionB, then a fixed lead-in
  skip(8)                               // parent folder item id, or zero when at the library root
  skip(4)                              // 01 00 00 00
  ItemID pageItemID                      // section 8.6
  AsLinkage                             // section 8.5, empty for a scene
if (>= F4) u32 timeCreated
FixedPageTail                            // section 8.7
```

The `pageName` is a unicode `String`, distinct from the displayed `sceneName` BomString that
follows it. After `sceneName` the record carries a 16-bit `symbolId`, which is zero for a scene,
a reserved 16-bit field, and an 8-bit `symbolType`, also zero for a scene.

### 8.3 Symbol library entries

A library symbol is also a `CDocumentPage`, differing from a scene in its identifiers and type.

```
new class CDocumentPage
u8  documentPageVersion = 0x17
String pageName                          // unicode, for example "Symbol 1"
BomString symbolName
u16 symbolId                             // one-based library index
u16 0
u8  symbolType                           // 0 graphic, 1 button, 2 movie clip
if (>= F4):
  BomString ""
  skip(11)                              // 01 00 00 00, spriteVersionE, then a fixed lead-in
  skip(8)                               // parent folder item id, or zero
  skip(4)                              // 01 00 00 00
  ItemID itemID
  AsLinkage
if (>= MX2004) u8 0
if (>= F4) u32 timeCreated
FixedPageTail
```

The `symbolId` is the one-based position of the symbol in the library, not the numeric suffix of
its timeline stream.

### 8.4 Stage and document properties

After the catalog the stream carries the stage geometry and the document's editing preferences as
one contiguous block. The block opens with a ruler-units descriptor and runs through the frame
rate. Offsets below are relative to the start of the block; in a default empty document the block
begins at `@abs 400`.

```
u8  rulerUnitType        @+0    // 0 inches, 1 decimal inches, 2 points, 3 cm, 4 mm, 5 pixels
u8  0x00                 @+1
u8  gridVisible ? 3 : 0  @+2
u8  0x00                 @+3
skip(3)                  @+4    // 00 00 00
u16 width * 20           @+7    // stage width in twips
skip(6)                  @+9    // 00 00 00 00 00 00
u16 height * 20          @+15   // stage height in twips
skip(4)                  @+17   // 00 00 00 00
u16 gridSpacingX * 20    @+21
u8  previewMode          @+23   // 0 outlines, 1 fast, 2 anti-alias, 3 anti-alias text, 4 full
u8  rulerVisible         @+24
u8  pageTabsVisible      @+25
u8  playOptions << 4 | viewOptions  @+26
skip(29)                 @+27   // 00 68 01 00 00 68 01 00 00 68 01 00 00 68 01 00 00
                                //  01 01 00 00 00 00 01 00 00 00 00 00
u8  bgR, bgG, bgB, 0xFF  @+56   // background color, alpha constant 0xFF
u8  gridR, gridG, gridB  @+60   // grid color, three bytes
u8  0xFF                 @+63
u8  0x00                 @+64
u8  fpsFrac              @+65   // frame rate fraction, round((fps - floor(fps)) * 256)
u8  fpsInt               @+66   // frame rate integer, floor(fps)
u8  0x00, u8 0x00        @+67
skip(6)                  @+69   // 00 03 b4 00 00 00
```

The stage width and height are 16-bit twip values, twenty units per pixel; a 550-pixel stage
stores 11000. The frame rate is an 8.8 fixed-point value with the fraction byte preceding the
integer byte, so a rate of 24 frames per second stores a fraction of 0 and an integer of 0x18.
The background color is three color bytes followed by a constant 0xFF, immediately followed by the
three grid color bytes. The `viewOptions` bits are 1 for the animation control, 2 for active
buttons, 4 for the pasteboard, and 8 for live preview from MX onward; the `playOptions` bits,
which occupy the high nibble, are 1 for loop, 2 for play all pages, 4 for frame actions, and 8 for
sounds.

After this block the stream continues with the property maps, the color table as `CColorDef`
records, the QuickTime audio settings, the folder list of section 8.8, the font list of
section 8.9, the ruler guides, the document accessibility data of section 19.2, and a version and
metadata trailer.

### 8.5 Linkage

`AsLinkage` carries a library item's ActionScript export and runtime-sharing settings and is
reused by symbols, scenes, sounds, bitmaps, and fonts. Its two flag bytes pack several booleans
each; they are not four separate flag bytes.

```
skip(4)                              // 00 00 00 00
if (>= F5):
  u8 asLinkageVersion = 7
  u8 flagsA                          // bit 0 export for ActionScript, bit 1 import for runtime sharing
  skip(3)                            // 00 00 00
  BomString linkageIdentifier
  BomString linkageURL
if (>= MX2004):
  BomString className
if (>= MX):
  u8 flagsB                          // bit 0 export for ActionScript, bit 1 export for runtime sharing, bit 2 export in first frame
  u8 asLinkageVersionB = 2
  skip(3)                            // 00 00 00
  BomString ""
  BomString sourceLibraryItemHRef
  skip(20)                           // 00 x8, 01 00 00 00, 00 x4, FF FF FF FF
if (>= F8):
  u8 0x00
  BomString linkageBaseClass
```

The export-in-first-frame bit in `flagsB` is occasionally omitted by Flash even when the property
is set, so a reader should treat that single bit as advisory when comparing files byte for byte.

### 8.6 Item identifier

`ItemID` is eight bytes: a `u32` creation time and a `u32` ordinal, together forming the library
item's identifier.

### 8.7 Fixed page tail

Every scene and symbol `CDocumentPage` closes with a `FixedPageTail`, a long run of constant bytes
and empty BomStrings whose individual fields carry no document-specific information. The reader
needs only its final 20 bytes, the scale-9 grid of section 19.3. The bytes preceding the grid are
constant for a given release; a reader either consumes the fixed count for its target release or
resynchronizes to the next class tag.

### 8.8 Folder entries

The folder list is a `u32` count followed by one record per folder. Each record carries a version
byte, the folder's leaf name as a BomString, its item identifier, a parent folder identifier or
zero, an expansion flag, and version-gated trailers of constants and empty strings in the same
style as the page tail. Folder nesting is expressed through the parent identifier rather than
through the name.

### 8.9 Font entries

The font list, present from Flash 5 onward, is a `u32` count followed by one record per embedded
font. Each record carries a version byte, the font name as a BomString, a 16-bit identifier, a
creation time, a second version byte, the family name as a `String`, a bold flag, an italic flag,
a constant marker byte of 0x12, an item identifier, a parent folder identifier, and an
`AsLinkage`.

### 8.10 Media catalog (CMediaSound / CMediaBits)

Imported media — sounds, bitmaps, and video — store their payload in a separate `Media N <time>`
stream (section 1), but the library entry that links a `Media N` payload to a display name (and,
for a frame sound, to the `soundId` index of section 11) lives in the `Contents` stream as a
`CMedia*` CArchive object. These records appear **after** the scene/symbol `CDocumentPage` chain
and **before** the stage block of section 8.4 — the same position the genuine fixtures use
(`evaporatingdrip.fla` places its `CMediaBits "Media 4"` there; `Magnet.fla` its `CMediaSound`).

Two classes carry the same body shape, distinguished only by the class name: `CMediaBits` for an
imported bitmap and `CMediaSound` for an imported sound. As with every CArchive object the first
use of a class is a `new class` declaration and later uses are backrefs, so each class advances the
running combined-table index of section 5.2 (one slot for the class declaration, one because every
object header bumps the object counter). The post-stage default block of section 8.4 self-declares
its own `CColorDef` and `CQTAudioSettings` and holds no backref to any earlier class, so inserting
media records ahead of it never invalidates it.

```
[class tag]                              // new class CMediaBits / CMediaSound (schema 1), else backref
u8  recordSchema = 6                     // mediaSoundVersionC / the CMedia* record schema
u8  streamNameLen                        // code units of "Media N" (7..14)
String "Media N"                         // UTF-16LE, no BOM marker — the Media stream number
BomString displayName                    // library display name
... source-path and per-media tail ...   // section 18-style payload metadata; not modeled
```

A reader keys the record by the `Media N` number parsed from the stream name and reads only through
the display name: a frame sound's `soundId` (section 11) indexes this list to recover its library
item, and a bitmap placement's `mediaId` (section 18.1) does the same. The trailing fields after the
display name carry the author's original-asset path and per-media metadata (sample rate, timestamps);
a writer that has no such source path emits a deterministic empty run there, which round-trips
correctly because the reader never consumes it.

---

## 9. Timeline streams

A scene's timeline and a library symbol's timeline are each stored in their own stream, rooted at
a page record that holds layer records, each of which holds frame records. The structure is
identical for scenes and symbols. Layers are stored from the bottom of the stacking order upward,
so the background layer is first in the stream; a reader that presents layers top-down reverses
the order.

---

## 10. Page and layer records

### 10.1 Page record

A `CPicPage` is the root of a timeline. It holds the layer records and closes with a tail giving
the next-layer identifier, the current playhead frame, and the ruler guides.

```
u8 0x01                                  // leading marker
new class CPicPage
u8 pageVersion = 0x04, u8 0x00
CPicLayer[]                              // stored background first
skip(2)                                 // 00 00
s32 0x80000000, s32 0x80000000          // sentinel registration point
if (>= F8) skip(2)                      // 00 00
u8 pageVersionB = 0x07
u16 nextLayerId, u8 0x00
if (== MX2004) u16 nextFolderId, u8 0x00
if (>= F8) u16 currentFrame, u8 0x00, skip(3)
if (>= F5):
  u32 guideCount
  guide[guideCount] { u32 direction; u32 valueTwips }   // direction 0 horizontal, 1 vertical
```

### 10.2 Layer record

A `CPicLayer` holds the layer's frames and then a properties block giving its name, appearance,
and place in the layer hierarchy.

```
new class CPicLayer
u8 layerVersion = 0x04, u8 0x00
CPicFrame[]
skip(2)                                 // 00 00
s32 0x80000000, s32 0x80000000          // sentinel registration point
if (>= F8) skip(2)                      // 00 00
u8 layerVersionB = 0x0B
BomString layerName
if (>= F4):
  u8 isSelected
  u8 hiddenLayer                        // 1 when the layer is hidden
  u8 lockedLayer
  skip(4)                               // FF FF FF FF
  u8 colR, colG, colB, 0xFF             // outline color
  u8 showOutlines
  skip(3)                               // 00 00 00
  u8 heightMultiplier                   // row-height multiplier
  skip(3)                               // 00 00 00
u8 layerType                            // 0 normal, 1 guide, 2 guided, 3 folder, 4 mask
if (>= MX):
  if (parentLayerIndex > -1) encodedUI parentReference
  else                       u16 0
  u8 open                               // folder or parent expanded in the panel
  u8 autoNamed
  if (== CS4) u8 animationType
  encodedUI ancestorReference[]         // chain links for nested normal layers
```

A layer's parent reference, and the ancestor chain links for nested normal layers, are the running
object indices of section 5.2 for the parent and ancestor layers, not their positions in the layer
array. The pre-Flash-5 mask back-link block does not appear in Flash 8.

---

## 11. Frame records

A `CPicFrame` holds the frame's display list followed by the frame's own properties: its span,
its tween mode, any attached sound, its label, and its tween easing. The display list is the set
of placed display objects on the frame; an empty keyframe carries a single empty shape.

The header, the display list, and the leading frame fields through the frame-identifier block are
laid out exactly as below. The order of the several tween, comment, morph, and sound sub-blocks
that follow the frame identifier is given as observed from real files; the individual fields are
established but their precise interleaving has not been pinned, so a reader should treat that
region's order with care.

```
new class CPicFrame
u8 frameVersion = 0x04, u8 0x00
displayObject[]                          // section 5.3 each
u8 frameVersionB = 0x18                  // the frame schema gate
u16 duration                             // span length in frames
u16 keyMode                              // section 11.1
u16 acceleration                         // classic-tween easing, -100 to 100, as a u16
if (>= F2):
  u16 soundId                            // one-based media index, 0 for none
  u16 pointCount
  envelope[pointCount] { u32 mark; u16 left; u16 right }   // default one point: 0, 0x8000, 0x8000
  u16 soundLoop
  u8  soundSync                          // 0 event, 1 start, 2 stop, 3 stream
  u32 inPoint
  u32 outPoint                           // default 0x3FFFFFFF
  u16 soundZoom                          // default 0xFFFF
if (>= F3) BomString frameLabel
if (>= F5) u8 frameVersionC = 4, skip(3), u8 0x01, skip(3)
if (>= MX) u8 frameId high byte, u8 frameId low byte, skip(6)   // frameId is big-endian here
if (>= CS3) skip(4)
if (>= F3):
  u32 motionTweenRotate                  // 0 none, 1 clockwise, 2 counter-clockwise
  u16 rotateTimes
  skip(2)
  u32 comment                            // the label is a comment
  MorphShape or skip(2)                  // section 13, the two bytes 00 00 when no morph
  u8 shapeTweenBlend                     // 0 distributive, 1 angular
  u8 0x00, u32 0, BomString ""
if (>= F5) skip(4), u8 soundEffect, skip(3)   // soundEffect 0 through 7
if (>= MX) u32 anchor                     // the label is a named anchor
if (>= F8):
  u32 useSingleEaseCurve
  u32 hasCustomEase
  if (hasCustomEase) CustomEaseTable      // section 11.2
if (== CS4 and motion object present):
  BomString motionObjectXML
  u32 visibleAnimationKeyframes
  BomString tweenInstanceName
```

A Flash 8 frame stamps `frameVersionB = 0x18`, so the `>= F8` ease-curve header
(`u32 useSingleEaseCurve; u32 hasCustomEase`) is **mandatory** — a writer that emits the
schema byte 0x18 must also emit these two u32s (and, for a frame whose easing is carried by
the s16 `acceleration` field rather than a bezier, `hasCustomEase = 0` so no custom-ease
table follows). Omitting them while still stamping 0x18 makes a reader over-read the frame
body by exactly the 8 bytes of this header (plus any preceding higher-schema skip fields the
reader consumes for fs=0x18), which shifts the parse of the following `CPicLayer` name and
trailer — corrupting the whole stream. A genuine empty Flash 8 keyframe stores
`useSingleEaseCurve = 1, hasCustomEase = 0` here; the clone's empty-keyframe template carries
those bytes, so the full-serialization path (a non-empty or sound-bearing keyframe) must
match it. (Task 1369: the writer used to stop after `tweenInstanceName` and drop this header,
so any frame on the full path — e.g. a frame-sound keyframe — failed to round-trip; the
breakage looked layer-name-length-dependent only because the 20-byte shift landed on
different bytes per name length.)

### 11.1 Key mode

The `keyMode` field encodes the keyframe's nature and its tween options. A plain keyframe is the
constant 0x2600; Flash 8 clears bit 0x2000 from it, so a plain Flash 8 keyframe reads 0x0600. Bit
0x0001 marks a motion, or classic, tween; bit 0x0002 marks a shape tween. The tween option bits
are 0x0100 for orient to path, 0x0200 for scaling, 0x0400 for rotation other than none, 0x0800
for synchronized graphics, and 0x1000 for snapping. To detect a tween a reader tests bit 0x0001
for motion and bit 0x0002 for shape.

### 11.2 Custom ease table

When `hasCustomEase` is set the frame carries six ease curves in a fixed order: position,
rotation, scale, color, filters, and all. Each curve is a count of anchor points followed by the
points as `(x, y)` pairs of doubles, where `x` is normalized time from 0 to 1 and `y` is the
normalized value.

```
slot[6] {
  u32 numPoints
  f64 pair[numPoints + 2] { f64 x; f64 y }
}
```

The number of `(x, y)` pairs on the wire is `numPoints + 2`, because the first and last anchor
points are each written one additional time.

### 11.3 Frame scripts

From Flash 5 onward a frame's ActionScript is stored as a single BomString of source text within
the Flash-5 block. Flash 4 and earlier store actions as a structured record of individual command
entries rather than as source text.

---

## 12. Shape records

A `CPicShape` holds a vector shape: a table of fill styles, a table of line styles, a stream of
edges that reference those styles, and an optional record of the original cubic geometry.

```
new class CPicShape
if (>= F5 and group container) u8 groupVersion = 4, u8 groupFlags
InstanceHeader                           // section 5.3, instanceType = 3
u8 shapeVersion = 5
u32 totalEdgeCount
u16 fillStyleCount
FillStyle[fillStyleCount]                // section 12.1
u16 strokeStyleCount
LineStyle[strokeStyleCount]              // section 12.2
Edge[]                                    // section 12.3
u8 0x00
if (>= F5) u32 cubicCount, Cubic[cubicCount]   // section 12.4
```

When present, `groupFlags` packs bit 0x01 for floating, 0x02 for selected, and 0x04 for locked.

### 12.1 Fill style

A fill style is a solid color, a gradient, or a bitmap fill. The three forms share no common
prefix, so a reader first reads the type discriminator at a fixed position and then follows the
matching branch. The discriminator is the byte at `@+4`: bit 0x10 set means a gradient, bit 0x40
set means a bitmap, and neither set means a solid color. For a solid color those first four bytes
are the RGBA color itself and there is no separate type byte; for a gradient or a bitmap the first
four bytes are a fixed lead-in and the type byte is at `@+4`.

```
solid:
  u8 R, G, B, A
  u8 0x00, u8 0x00
gradient:
  u8 0x00, 0x00, 0x00, 0xFF
  u8 type                                // 0x10 linear, 0x12 radial
  u8 0x00
  Matrix gradientMatrix
  u8 stopCount
  if (>= F8) u8 focalRatio, skip(3), u8 spread, skip(3)
  stop[stopCount] { u8 ratio; u8 R, G, B, A }   // ratio is round(position * 255)
bitmap:
  u8 0xFF, 0x00, 0x00, 0xFF
  u8 type                                // 0x40 tiled, 0x41 clipped, 0x42 tiled rough, 0x43 clipped rough
  u8 0x00
  Matrix bitmapMatrix
  u16 bitmapId
```

The `spread` byte combines a flow mode of 0 for extend, 4 for reflect, or 8 for repeat with a
plus-one for linear-RGB interpolation. A focal radial gradient uses type 0x12 with a non-zero
`focalRatio`. The last byte of a gradient or bitmap lead-in must be 0xFF or Flash discards the
fill. Because a shape's fill table is homogeneous and its length is known, a misread branch is
detectable from the resulting length.

### 12.2 Line style

A line style gives the stroke color, width, dash pattern, and, from Flash 8, the cap, join, and
miter settings together with a trailing fill.

```
u8 R, G, B, A
u16 widthTwips
u16 styleParam1
u16 styleParam2                          // dash, dot, ragged, stipple, or hatch parameters; low three bits select the style
if (>= F8):
  u8 pixelHinting
  u8 scaleMode                           // 0 normal, 1 horizontal, 2 vertical, 3 none
  u8 capStyle                            // 0 none, 1 round, 2 square
  u8 joinStyle                           // 0 miter, 1 round, 2 bevel
  u8 miterFrac
  u8 miterInt
  FillStyle trailingFill                 // section 12.1
```

A pre-Flash-8 stroke is ten bytes, with no cap, join, or miter fields and no trailing fill.
Adding 0x8000 to `styleParam2` selects sharp corners from MX onward.

### 12.3 Edge stream

Each edge record begins with a type byte, an optional style change, and then the edge's
coordinates. The type byte is a bitfield:

```
bit 7        no selection
bit 6        has styles
bits 5 to 4  destination coordinate size: 01 byte, 10 float, 11 short
bits 3 to 2  control coordinate size, curves only: 01 byte, 10 float, 11 short
bits 1 to 0  origin coordinate size, present only when the origin is not 0,0: 01 byte, 10 float, 11 short
```

```
u8 typeByte
if (has styles):
  u8 strokeIndex, optional u8 selection
  u8 fill0Index,  optional u8 selection
  u8 fill1Index,  optional u8 selection
optional origin
optional control
destination
if (>= CS3 and straight edge) u8 generalLineFlag
```

The style change, when present, is always in the order stroke, then fill on side zero, then fill
on side one. A coordinate in byte form is a `Point8_8` per axis, an 8.8 fixed-point twip with
5120 units per pixel. A coordinate in short form is a `s16` holding the value times two. A
coordinate in float form is a fraction byte and a signed 24-bit integer per axis. All coordinates
are deltas from the current pen position, and a leading move of zero is omitted.

### 12.4 Cubic record

The cubic record preserves the shape's original cubic Bézier geometry alongside the quadratic edge
stream, so the shape can be re-edited without loss.

```
u32 cubicCount
cubic[cubicCount] {
  s32 mx, my, x1, y1, x2, y2, ex, ey     // move, two control points, end, in twips
  if (>= CS3) u8 segCount, seg[segCount]{ s32 x, y; u8 onCurve; u8 line }, u8 bcpFlags, optional control points
}
```

In Flash 8 each cubic entry is exactly the 32-byte core; the per-segment extension appears only
from CS3 onward.

---

## 13. Morph shape records

A `CPicMorphShape` holds the geometry of a shape tween as a set of morph segments, each a list of
morph curves, followed by the interpolated fill and stroke tables.

```
new class CPicMorphShape
skip(57)                                 // two identity matrices and flags, constant
u16 segmentCount
segment[segmentCount] {
  new class CMorphSegment
  u32 strokeIndex1, strokeIndex2, fillIndex1, fillIndex2   // 0xFFFFFFFF for none
  Point8_24 startA
  Point8_24 startB
  u16 curveCount
  curve[curveCount] {
    new class CMorphCurve
    Point8_24 controlA, anchorA, controlB, anchorB
    u8 isLine
    skip(3)                              // 00 00 00
  }
}
u16 0x0000                               // segment list terminator
u16 fillCount
MorphFill[fillCount]                     // section 13.1
u16 strokeCount
MorphStroke[strokeCount]                 // section 13.2
```

### 13.1 Morph fill

A morph fill has the same four forms as a shape fill. The discriminator is the first byte: 0x00
introduces a null or solid fill and 0xFF introduces a bitmap fill, with the type word
distinguishing the remaining cases.

```
null:     u8 0x00, 0x00, 0x00, 0x00, u16 0x0000
solid:    u8 R, G, B, A, u16 0x0000
gradient: u8 0x00, 0x00, 0x00, 0xFF, u16 type, Matrix, u8 stopCount, stop[]{ u8 ratio; RGBA }
bitmap:   u8 0xFF, 0x00, 0x00, 0xFF, u8 type, u8 0x00, Matrix, u16 bitmapId
```

The gradient type here is a 16-bit value, unlike the 8-bit type in a shape fill, and there is no
focal or flow block.

### 13.2 Morph stroke

Each morph stroke is ten bytes: an RGBA color, a `u32` width in twips, and a `u16` zero. When
both ends of the tween lack strokes, Flash 8 writes a count of one with a single zeroed record.

---

## 14. Symbol instance records

A symbol instance places a library symbol on a timeline. Its class is `CPicSymbol` for a graphic,
`CPicButton` for a button, or `CPicSprite` for a movie clip. The three share a common prefix and
differ in their tails.

```
new class according to symbol type
u8 spriteVersion = 4
InstanceHeader                           // section 5.3, instanceType = 0x13
u16 firstFrame                           // graphic only, zero-based
u8 loopMode                              // movie clip 0x02; button 0x00; graphic 0 loop, 1 play once, 2 single frame
u8 0x00
if (>= F4) u8 0x01
if (>= F2) ColorEffect                   // section 19.1
if (>= F3) BomString ""
u16 libraryItemIndex                     // one-based into the library
u16 0
if (>= MX2004) skip(3)
if (>= F8) FilterList, u8 blendMode, u8 0x00, u8 0x00   // section 14.1
```

A graphic instance ends after the common prefix. A movie clip continues with a version byte, a
fixed lead-in, a 16-bit instance identifier, a clip-action script as a BomString, the instance
name as a BomString, accessibility data, and the component metadata of section 15. A button
continues with a fixed lead-in, an instance identifier, a clip-action script, a track-as-menu
flag, the instance name, and accessibility data. CS4 inserts a three-dimensional transform block
into the common prefix.

### 14.1 Blend mode

The blend mode is a single byte: 1 normal, 2 layer, 3 multiply, 4 screen, 5 lighten, 6 darken, 7
difference, 8 add, 9 subtract, 10 invert, 11 alpha, 12 erase, 13 overlay, 14 hard light. A value
of 0 means no blend mode is set.

---

## 15. Component metadata

A movie clip instance from MX2004 onward carries component metadata as a marker, a reserved
32-bit field that resets when the file is resaved, and an XML fragment as a BomString.

```
u8 0x01
u32 0
BomString componentXML
```

For an instance that is not a component the XML is an empty template of the form
`<component metaDataFetched='true' schemaUrl='' schemaOperation='' sceneRootLabel='Scene 1'
oldCopiedComponentPath='0'></component>`. A real component fills the schema attributes and adds
child nodes.

---

## 16. Filters

### 16.1 Runtime filters

Filter data that reaches the published movie uses the filter record format of the SWF
specification and is not redefined here.

### 16.2 Authoring filter list

An instance or text field from Flash 8 onward carries an authoring filter list: a presence byte,
and when filters are present a `u32` count and that many filter records.

```
if (filters present) u8 0x01, u32 filterCount, Filter[filterCount]
else                 u8 0x00
```

Each filter begins with a type tag and a fixed sub-header, then a `u32` enabled flag, then its
parameters. Integers are 32-bit, scalar magnitudes are 32-bit floats, angles are in radians, and
a strength percentage is `round(strength * 100)` stored as a 16-bit value within a 32-bit field.

```
drop shadow:    enabled, RGBA, f32 distance, blurX, blurY, angle, u32 inner, knockout, quality, u16 strength, skip(2), u8 hideObject, skip(3)
blur:           enabled, then blurX, blurY, and quality among fixed fields
glow:           enabled, RGBA, f32 blurX, blurY, u32 inner, knockout, quality, u16 strength
bevel:          enabled, RGBA shadow, f32 distance, blurX, blurY, angle, u32 inner, knockout, quality, u16 strength, RGBA highlight, u32 full
gradient glow:  as bevel, with a gradient stop table in place of the two colors
gradient bevel: as gradient glow
adjust color:   enabled, f32 brightness, contrast, saturation, hue
```

A bevel's type is 1 for inner, 2 for outer, and 3 for full.

---

## 17. Text records

A `CPicText` holds a static, dynamic, or input text field: its bounding box, its field-level
flags, font embedding information, and one formatting run per span of uniform style.

```
u8 textVersionC = 4
InstanceHeader                           // section 5.3, instanceType = 0x0D
u32 left * 20, u32 (left + width) * 20, u32 top * 20, u32 (top + height) * 20   // bounds in twips
u8 autoExpand
if (>= F3) u8 0x00
if (>= F4) u8 textFlags                  // section 17.1
u8 embedFlag                             // section 17.2
if (>= F5) u8 staticFlags, u8 0x00       // static text: bit 0 selectable, bit 1 device font from CS3
if (>= F4) u16 maxCharacters, BomString variableName
if (embedded characters present) BomString embeddedCharacters
TextRun[]                                // section 17.3
u16 0x0000
if (>= MX) BomString instanceName, AccessibleData, skip(4), u8 scrollable, skip(3)
if (>= MX2004) BomString "", BomString embedRanges   // ranges joined by the vertical bar
if (>= F8) FilterList, u16 0x0000
```

### 17.1 Text flags

The `textFlags` byte holds bit 0x01 for non-static text, 0x02 for dynamic, 0x04 for password,
0x08 for word wrap, 0x10 for multiline, 0x20 for embedded outlines, and 0x40 for a border. Bit
0x80 marks dynamic HTML text that is not selectable. The selectable property of static text is bit
0 of `staticFlags`; the scrollable property is the `scrollable` byte in the tail.

### 17.2 Embed flag

The `embedFlag` byte holds bit 0 for an embedded font, bits 1 through 4 for embed ranges 1 through
4, bit 0x20 for the presence of explicit embedded characters, bit 0x40 for an empty field, and
bit 0x80 for HTML rendering from Flash 5.

### 17.3 Text run

Each run gives the style and characters for one span of uniform formatting.

```
u16 charCount                            // present when the run has characters
u8 textVersionB = 0x0C
u16 size * 20
String fontFamily                        // BomString in CS4
u8 R, G, B, A
u8 0x12, u8 0x00                         // font class marker
u8 bold, italic, 0x00, autoKern, charPosition, alignment   // position 0 normal, 1 super, 2 sub; alignment 0 left, 1 right, 2 center, 3 justify
u16 lineSpacing * 20, indent * 20, leftMargin * 20, rightMargin * 20
if (>= F5) u16 letterSpacing * 20  else u8 0x00
String url
if (>= MX) u8 vertical, rightToLeft, rotation
if (>= MX2004) u8 renderAsBitmap
if (>= MX) String target
if (>= F8) u8 0x02, u8 renderMode, f32 antiAliasThickness, f32 antiAliasSharpness, String url
characters                               // UTF-16LE in unicode mode
```

When the field uses a device font the two anti-alias floats are written as eight zero bytes.

---

## 18. Media records

### 18.1 Bitmap instance

A `CPicBitmap` places a library bitmap. It carries no size or scale of its own; the display scale
comes from the placement matrix and the intrinsic pixel size from the library item.

```
u8 bitmapVersion = 4
InstanceHeader                           // section 5.3, instanceType = 2
u16 mediaId                              // one-based into the name-sorted media list
if (>= MX2004) u8 0x00
```

Smoothing is a property of a bitmap fill, not of the placement, so it does not appear here.

### 18.2 Video instance

A `CPicVideoStream` places a video object and gives its crop rectangle and the media index of the
referenced clip.

```
new class CPicVideoStream
u8 videoStreamVersion = 4
InstanceHeader                           // section 5.3, instanceType = 4
u32 frameLeft, frameRight, frameTop, frameBottom
u8 0x00
BomString ""
BomString name
u32 0x00000001
u16 videoId
```

The embedded-clip variant `CPicVideo` is a separate class and is not laid out here.

### 18.3 Imported SWF

A `CPicSwf` places an imported SWF movie as a single object. It is a legacy form: current Flash
imports a SWF by breaking it into shapes and symbols rather than producing a `CPicSwf`, so the
record cannot be created by a current authoring session and survives only in files upgraded from
older releases.

```
new class CPicSwf
InstanceHeader                           // section 5.3, placement and matrix
u32 swfWidthTwips
u32 swfHeightTwips
u32 sizeWord                             // a content size, repeated
skip(n)                                  // further bounds and count words, exact layout undetermined
BomString clipActions
opaqueBody                               // an internal decomposition of the movie, not the raw SWF bytes
```

The placement header, the intrinsic-size words, and the clip-action script are established by
inspection. The trailing body, roughly 900 to 5400 bytes, is Flash's internal representation of
the imported movie and is not decoded; a reader skips the record using the resynchronization
procedure of section 7 rather than parsing the body.

---

## 19. Color, accessibility, and scale-9

### 19.1 Color effect

A `ColorEffect` applies a color transform to a symbol instance.

```
if (>= F3):
  u16 alphaMul, alphaOffset
  u16 redMul, redOffset, greenMul, greenOffset, blueMul, blueOffset
  u8 type, u8 0x00
  u16 valuePercent
  u8 R, G, B, A
```

The multiplier fields are signed 16-bit values in which 256 represents a factor of 1.0. The type
is 0 for none, 1 for brightness, 2 for tint, 3 for advanced, and 4 for alpha. For brightness the
red, green, and blue multipliers are `round((1 - magnitude) * 256)`; for tint they are
`round((1 - amount) * 256)` with offsets `round(channel * amount)` and the effect color set to the
tint color; for alpha the alpha multiplier is `round(value * 256)`; for advanced the multipliers
are `round(value * 256)` and the offsets are stored directly.

### 19.2 Accessibility

`AccessibleData` records a display object's accessibility settings. When an object has no
accessibility data the main document writes a single zero byte and other objects write nothing.

```
u8 accessibilityVersion = 2, u8 0x00
skip(2), u8 silent, skip(3)
BomString name
BomString description
BomString shortcut
if (>= MX2004) BomString tabIndex, BomString ""
u8 forceSimple, skip(3)
if (main document) u8 autoLabelInverted
```

The `silent` byte is the inverse of the "make object accessible" setting, and `forceSimple` is the
inverse of "make child objects accessible". The `tabIndex` is stored as text.

### 19.3 Scale-9 grid

A symbol's scale-9 grid is the final 20 bytes of its `FixedPageTail`. A grid that is set is a
toggle of 1 followed by the right, left, bottom, and top guides, each a `u32` in twips. A grid
that is not set is a toggle of 0 followed by four sentinel values of 0x80000000.

```
if (grid set):  u32 1, u32 right * 20, u32 left * 20, u32 bottom * 20, u32 top * 20
else:           u32 0, s32 0x80000000 x4
```

---

## 20. Field confidence

Confidence levels for the structures in this document:

- **Verified** — the byte layout and the meaning of each field are established.
- **Verified bytes** — the bytes are established and constant, but some fields are reserved or of
  unknown meaning; they are safe to read and reproduce.
- **Observed** — derived from real documents and consistent, but not independently confirmed.
- **Inferred** — a best-effort layout with no confirming sample.
- **Undecoded** — only the extent or the means of skipping the data is known.

| Structure | Section | Confidence |
|---|---|---|
| Compound File Binary container | 2 | Verified |
| Version constants | 3 | Verified |
| Primitive encodings | 4 | Verified |
| Object protocol and class allocation | 5 | Verified |
| Instance header | 5.3 | Verified |
| Contents preamble, scenes, symbols | 8.1–8.3 | Verified |
| Stage and document properties | 8.4 | Verified |
| Linkage | 8.5 | Verified |
| Item identifier, folders, fonts | 8.6, 8.8, 8.9 | Verified |
| Fixed page tail constant run | 8.7 | Verified bytes |
| Page and layer records | 10 | Verified |
| Frame record header and leading fields | 11 | Verified |
| Frame tween, comment, morph, sound sub-block ordering | 11 | Observed |
| Key mode, custom ease table | 11.1, 11.2 | Verified |
| Shape records, fills, strokes, edges, cubics | 12 | Verified |
| Morph shape records | 13 | Verified |
| Symbol instance records, blend mode | 14 | Verified |
| Component metadata | 15 | Verified |
| Authoring filter list | 16.2 | Verified |
| Text records | 17 | Verified |
| Bitmap and video instances | 18.1, 18.2 | Verified |
| Embedded video variant | 18.2 | Inferred |
| Imported SWF header and metadata | 18.3 | Observed |
| Imported SWF body | 18.3 | Undecoded |
| Color effect, accessibility, scale-9 grid | 19 | Verified |

---

## 21. Known gaps

Three areas are not fully specified. The interleaving of the tween, comment, morph, and sound
sub-blocks within a frame record, section 11, is established field by field but its exact byte
order has not been pinned. The embedded-clip video class `CPicVideo`, section 18.2, is distinct
from the placed `CPicVideoStream` and is not laid out. The internal body of an imported SWF,
section 18.3, is an opaque decomposition of the movie that a reader skips rather than parses; only
its placement header and intrinsic-size metadata are decoded.
