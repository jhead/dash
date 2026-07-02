/**
 * OLE2 / Compound File Binary (CFB) container *writer*.
 *
 * Mirrors the reader in `ole.ts` (and `tools/flashdrv/fla_cfb.py`): produces a
 * version-3, 512-byte-sector CFB holding a set of named streams. Small streams
 * (< miniStreamCutoff, default 4096) are placed in 64-byte mini-sectors carved
 * out of the root entry's stream and indexed by the mini-FAT — exactly the path
 * the reader's `readMiniStream` takes. Larger streams live in the main FAT.
 *
 * The output is a self-describing CFB; spec reference [MS-CFB] / §2 of
 * docs/21-fla-binary-format.md. This is [V] against the CFB container spec
 * (verified by round-tripping through the reader in ole.ts).
 */

const OLE2_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const FATSECT = 0xfffffffd;
const DIFSECT = 0xfffffffc;
const NOSTREAM = 0xffffffff;

const DE_STREAM = 2;
const DE_ROOT = 5;

const SECTOR_SIZE = 512;
const MINI_SECTOR_SIZE = 64;
const MINI_STREAM_CUTOFF = 4096;
const DIR_ENTRY_SIZE = 128;

interface StreamEntry {
  name: string;
  data: Uint8Array;
}

function ceilDiv(a: number, b: number): number {
  return Math.floor((a + b - 1) / b);
}

/**
 * Serialize a set of named streams into a binary CFB container.
 *
 * The directory is emitted as a proper MS-CFB red-black tree (see
 * `writeDirectory`): the root storage's `childId` points at the balanced tree of
 * stream entries, whose `leftSibling`/`rightSibling` pointers form a binary
 * search tree ordered by the [MS-CFB] §2.6.4 name comparison (UTF-16 length
 * first, then case-insensitive uppercase codepoint order). This satisfies the
 * lookup invariant that a strict CFB consumer (OLE32/MFC, real Flash 8) relies
 * on when it walks the tree comparatively to `OpenStream("Contents")` — an
 * unsorted chain would misdirect that walk into NOSTREAM. dash's own reader
 * (`collectStreamEntries`) visits every sibling regardless of order, so it round-
 * trips either shape.
 */
export function writeCfb(streams: Map<string, Uint8Array>): Uint8Array {
  const entries: StreamEntry[] = [];
  for (const [name, data] of streams) {
    entries.push({ name, data });
  }

  // Partition streams into mini (small) and regular (large).
  const miniEntries = entries.filter((e) => e.data.length < MINI_STREAM_CUTOFF && e.data.length > 0);
  const bigEntries = entries.filter((e) => e.data.length >= MINI_STREAM_CUTOFF);

  // ---- 1. Build the mini-stream (root entry's stream) ----------------------
  // Each mini stream occupies ceil(size/64) consecutive mini-sectors; the
  // mini-FAT chains them. They are laid out contiguously.
  const miniFat: number[] = [];
  const miniStreamChunks: Uint8Array[] = [];
  const miniStartByEntry = new Map<StreamEntry, number>();
  let miniSectorCursor = 0;
  for (const e of miniEntries) {
    const nSectors = ceilDiv(e.data.length, MINI_SECTOR_SIZE);
    miniStartByEntry.set(e, miniSectorCursor);
    const padded = new Uint8Array(nSectors * MINI_SECTOR_SIZE);
    padded.set(e.data, 0);
    miniStreamChunks.push(padded);
    for (let i = 0; i < nSectors; i++) {
      miniFat.push(miniSectorCursor + i + 1);
    }
    // Last sector terminates the chain.
    miniFat[miniFat.length - 1] = ENDOFCHAIN;
    miniSectorCursor += nSectors;
  }
  const miniStreamData = concat(miniStreamChunks);
  const miniStreamSize = miniStreamData.length;

  // ---- 2. Decide the order of FAT-sector-resident streams ------------------
  // Layout of the file body (after the 512-byte header) is a sequence of
  // 512-byte sectors. We assign sector ranges in this order:
  //   [big stream data...] [mini-stream data] [mini-FAT] [directory] [FAT] [DIFAT]
  //
  // The first 109 FAT-sector pointers live in the header DIFAT array. When the
  // file needs more than 109 FAT sectors (body > ~7.6 MB) the remaining
  // pointers spill into a chain of DIFAT sectors, each holding 127 pointers and
  // a next-DIFAT-sector pointer in its final slot. Without this spill the
  // FAT-sectors past the 109th are unreachable and the streams whose data they
  // index read back as garbage (the "unexpected root marker 0x0" symptom).
  //
  // We build everything in passes so we can compute sector counts before we
  // know the FAT/DIFAT sector counts themselves (a fixed-point: adding FAT or
  // DIFAT sectors can push the FAT over a 128-entry boundary). Iterate until
  // stable.

  const ENTRIES_PER_SECTOR = SECTOR_SIZE / 4; // 128
  const DIFAT_HEADER_SLOTS = 109;
  const DIFAT_PER_SECTOR = ENTRIES_PER_SECTOR - 1; // 127 pointers + 1 next-pointer

  const bigStartByEntry = new Map<StreamEntry, number>();

  // Helper: assemble the final layout given chosen FAT/DIFAT sector counts.
  function layout(fatSectorCount: number, difatSectorCount: number): {
    bytes: Uint8Array;
  } {
    let sector = 0; // sector index (0-based, after header)
    const fatChains: Array<{ start: number; count: number }> = [];

    // Big streams
    for (const e of bigEntries) {
      const n = ceilDiv(e.data.length, SECTOR_SIZE);
      bigStartByEntry.set(e, sector);
      fatChains.push({ start: sector, count: n });
      sector += n;
    }

    // Mini-stream (root entry stream) — chained in the main FAT.
    const miniStreamSectorCount = ceilDiv(Math.max(miniStreamSize, 0), SECTOR_SIZE);
    const miniStreamStart = miniStreamSectorCount > 0 ? sector : ENDOFCHAIN;
    if (miniStreamSectorCount > 0) {
      fatChains.push({ start: sector, count: miniStreamSectorCount });
      sector += miniStreamSectorCount;
    }

    // Mini-FAT
    const miniFatBytes = miniFat.length * 4;
    const miniFatSectorCount = miniFat.length > 0 ? ceilDiv(miniFatBytes, SECTOR_SIZE) : 0;
    const miniFatStart = miniFatSectorCount > 0 ? sector : ENDOFCHAIN;
    if (miniFatSectorCount > 0) {
      fatChains.push({ start: sector, count: miniFatSectorCount });
      sector += miniFatSectorCount;
    }

    // Directory
    const dirEntryCount = entries.length + 1; // +1 for root
    const dirSectorCount = ceilDiv(dirEntryCount * DIR_ENTRY_SIZE, SECTOR_SIZE);
    const dirStart = sector;
    fatChains.push({ start: sector, count: dirSectorCount });
    sector += dirSectorCount;

    // FAT sectors themselves
    const fatStart = sector;
    sector += fatSectorCount;

    // DIFAT sectors (only when FAT pointers overflow the 109 header slots).
    const difatStart = difatSectorCount > 0 ? sector : ENDOFCHAIN;
    sector += difatSectorCount;

    const totalSectors = sector;

    // ---- Build the FAT array -----------------------------------------------
    const fat = new Uint32Array(fatSectorCount * ENTRIES_PER_SECTOR).fill(FREESECT);
    for (const chain of fatChains) {
      for (let i = 0; i < chain.count; i++) {
        fat[chain.start + i] = i === chain.count - 1 ? ENDOFCHAIN : chain.start + i + 1;
      }
    }
    // Mark the FAT's own sectors as FATSECT and DIFAT sectors as DIFSECT.
    for (let i = 0; i < fatSectorCount; i++) fat[fatStart + i] = FATSECT;
    for (let i = 0; i < difatSectorCount; i++) fat[difatStart + i] = DIFSECT;

    // ---- Assemble body sectors ---------------------------------------------
    const body = new Uint8Array(totalSectors * SECTOR_SIZE);

    const writeAt = (sec: number, data: Uint8Array): void => {
      body.set(data, sec * SECTOR_SIZE);
    };

    for (const e of bigEntries) {
      writeAt(bigStartByEntry.get(e)!, e.data);
    }
    if (miniStreamSectorCount > 0) writeAt(miniStreamStart, miniStreamData);

    if (miniFatSectorCount > 0) {
      const mfBuf = new Uint8Array(miniFatSectorCount * SECTOR_SIZE).fill(0xff);
      const dv = new DataView(mfBuf.buffer);
      for (let i = 0; i < miniFat.length; i++) dv.setUint32(i * 4, miniFat[i]!, true);
      writeAt(miniFatStart, mfBuf);
    }

    // Directory entries
    const dirBuf = new Uint8Array(dirSectorCount * SECTOR_SIZE);
    writeDirectory(
      dirBuf,
      entries,
      (e) =>
        e.data.length === 0
          ? ENDOFCHAIN
          : e.data.length < MINI_STREAM_CUTOFF
            ? miniStartByEntry.get(e)!
            : bigStartByEntry.get(e)!,
      miniStreamSectorCount > 0 ? miniStreamStart : ENDOFCHAIN,
      miniStreamSize,
    );
    writeAt(dirStart, dirBuf);

    // FAT sectors
    const fatBuf = new Uint8Array(fatSectorCount * SECTOR_SIZE);
    {
      const dv = new DataView(fatBuf.buffer);
      for (let i = 0; i < fat.length; i++) dv.setUint32(i * 4, fat[i]!, true);
    }
    writeAt(fatStart, fatBuf);

    // DIFAT sectors: FAT-sector pointers past the first 109, 127 per sector,
    // each sector's last slot being the next DIFAT sector (ENDOFCHAIN on last).
    const allFatSectors = range(fatStart, fatSectorCount);
    if (difatSectorCount > 0) {
      const difBuf = new Uint8Array(difatSectorCount * SECTOR_SIZE).fill(0xff);
      const dv = new DataView(difBuf.buffer);
      let ptrIdx = DIFAT_HEADER_SLOTS; // first 109 go in the header
      for (let s = 0; s < difatSectorCount; s++) {
        const secBase = s * SECTOR_SIZE;
        for (let i = 0; i < DIFAT_PER_SECTOR; i++) {
          const val = ptrIdx < allFatSectors.length ? allFatSectors[ptrIdx]! : FREESECT;
          dv.setUint32(secBase + i * 4, val, true);
          ptrIdx += 1;
        }
        const next = s + 1 < difatSectorCount ? difatStart + s + 1 : ENDOFCHAIN;
        dv.setUint32(secBase + DIFAT_PER_SECTOR * 4, next, true);
      }
      writeAt(difatStart, difBuf);
    }

    // ---- Header ------------------------------------------------------------
    const header = buildHeader({
      fatSectorCount,
      firstDirSector: dirStart,
      miniStreamCutoff: MINI_STREAM_CUTOFF,
      firstMiniFatSector: miniFatStart,
      miniFatSectorCount,
      fatSectors: allFatSectors.slice(0, DIFAT_HEADER_SLOTS),
      firstDifatSector: difatStart,
      difatSectorCount,
    });

    const bytes = new Uint8Array(SECTOR_SIZE + body.length);
    bytes.set(header, 0);
    bytes.set(body, SECTOR_SIZE);
    return { bytes };
  }

  // Find a stable (fatSectorCount, difatSectorCount). Both grow as the body
  // grows; adding FAT/DIFAT sectors can in turn push the FAT over a 128-entry
  // boundary, so iterate to a fixed point.
  let fatSectorCount = 1;
  let difatSectorCount = 0;
  let result = layout(fatSectorCount, difatSectorCount);
  for (let iter = 0; iter < 32; iter++) {
    const totalSectors = (result.bytes.length - SECTOR_SIZE) / SECTOR_SIZE;
    const neededFat = Math.max(1, ceilDiv(totalSectors, ENTRIES_PER_SECTOR));
    const neededDifat =
      neededFat > DIFAT_HEADER_SLOTS
        ? ceilDiv(neededFat - DIFAT_HEADER_SLOTS, DIFAT_PER_SECTOR)
        : 0;
    if (neededFat <= fatSectorCount && neededDifat <= difatSectorCount) {
      return result.bytes;
    }
    fatSectorCount = Math.max(fatSectorCount, neededFat);
    difatSectorCount = Math.max(difatSectorCount, neededDifat);
    result = layout(fatSectorCount, difatSectorCount);
  }
  return result.bytes;
}

function range(start: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(start + i);
  return out;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function buildHeader(opts: {
  fatSectorCount: number;
  firstDirSector: number;
  miniStreamCutoff: number;
  firstMiniFatSector: number;
  miniFatSectorCount: number;
  fatSectors: number[];
  firstDifatSector: number;
  difatSectorCount: number;
}): Uint8Array {
  const h = new Uint8Array(SECTOR_SIZE);
  const dv = new DataView(h.buffer);
  for (let i = 0; i < 8; i++) h[i] = OLE2_MAGIC[i]!;
  // CLSID @8 — 16 zero bytes.
  dv.setUint16(24, 0x003e, true); // minor version
  dv.setUint16(26, 0x0003, true); // major version (3)
  dv.setUint16(28, 0xfffe, true); // byte order LE
  dv.setUint16(30, 9, true); // sector size = 2^9 = 512
  dv.setUint16(32, 6, true); // mini sector size = 2^6 = 64
  // reserved @34 (6 bytes) = 0
  dv.setUint32(40, 0, true); // number of dir sectors (0 for v3)
  dv.setUint32(44, opts.fatSectorCount, true);
  dv.setUint32(48, opts.firstDirSector, true);
  dv.setUint32(52, 0, true); // transaction signature
  dv.setUint32(56, opts.miniStreamCutoff, true);
  dv.setUint32(60, opts.firstMiniFatSector, true);
  dv.setUint32(64, opts.miniFatSectorCount, true);
  dv.setUint32(68, opts.difatSectorCount > 0 ? opts.firstDifatSector : ENDOFCHAIN, true); // firstDifat
  dv.setUint32(72, opts.difatSectorCount, true); // difat sector count
  // DIFAT @76: first 109 FAT-sector pointers.
  for (let i = 0; i < 109; i++) {
    dv.setUint32(76 + i * 4, i < opts.fatSectors.length ? opts.fatSectors[i]! : FREESECT, true);
  }
  return h;
}

/** Directory-entry color byte per [MS-CFB] §2.6.1: 0x00 = red, 0x01 = black. */
const COLOR_RED = 0;
const COLOR_BLACK = 1;

/**
 * MS-CFB directory name comparison ([MS-CFB] §2.6.4). Names are compared FIRST by
 * their length in UTF-16 code units (shorter sorts first), then, for equal-length
 * names, character by character on the UPPERCASE variant of each code unit. This
 * is the ordering OLE32/MFC uses to walk the red-black tree when opening a stream
 * by name, so the emitted tree must be a BST under exactly this comparator.
 */
export function cfbNameCompare(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  for (let i = 0; i < a.length; i++) {
    const ca = a.charCodeAt(i);
    const cb = b.charCodeAt(i);
    if (ca === cb) continue;
    const ua = String.fromCharCode(ca).toUpperCase().charCodeAt(0);
    const ub = String.fromCharCode(cb).toUpperCase().charCodeAt(0);
    if (ua !== ub) return ua - ub;
  }
  return 0;
}

function writeDirectory(
  buf: Uint8Array,
  entries: StreamEntry[],
  startSectorOf: (e: StreamEntry) => number,
  rootStartSector: number,
  rootStreamSize: number,
): void {
  const dv = new DataView(buf.buffer);

  const writeEntry = (
    idx: number,
    name: string,
    type: number,
    color: number,
    childId: number,
    leftSib: number,
    rightSib: number,
    startSector: number,
    size: number,
  ): void => {
    const base = idx * DIR_ENTRY_SIZE;
    // Name: UTF-16LE, NUL-terminated.
    const maxChars = 31;
    const chars = Math.min(name.length, maxChars);
    for (let i = 0; i < chars; i++) {
      dv.setUint16(base + i * 2, name.charCodeAt(i), true);
    }
    dv.setUint16(base + chars * 2, 0, true); // NUL terminator
    dv.setUint16(base + 64, (chars + 1) * 2, true); // nameLen incl NUL, in bytes
    buf[base + 66] = type;
    buf[base + 67] = color; // 0 = red, 1 = black
    dv.setUint32(base + 68, leftSib, true);
    dv.setUint32(base + 72, rightSib, true);
    dv.setUint32(base + 76, childId, true);
    // CLSID @80 (16), state @96 (4), times @100..116 — all zero.
    dv.setUint32(base + 116, startSector, true);
    dv.setUint32(base + 120, size >>> 0, true);
    dv.setUint32(base + 124, 0, true); // size high (v3 = 0)
  };

  // ---- Build the red-black directory tree over the stream entries -----------
  // Physical layout keeps the root at index 0 and each stream at index i+1 (so
  // the stream-data/start-sector mapping is unchanged); only the tree POINTERS
  // are derived from the sorted order. We sort the stream entries by the CFB
  // name comparator, build a height-balanced BST (recursive middle), and color
  // the deepest level red so the result is a valid red-black tree.
  const n = entries.length;
  const left = new Array<number>(n + 1).fill(NOSTREAM);
  const right = new Array<number>(n + 1).fill(NOSTREAM);
  const depth = new Array<number>(n + 1).fill(0);

  // Sorted physical indices (1..n) by name.
  const sorted = entries
    .map((e, i) => ({ e, idx: i + 1 }))
    .sort((a, b) => cfbNameCompare(a.e.name, b.e.name));

  let maxDepth = 0;
  const build = (lo: number, hi: number, d: number): number => {
    if (lo > hi) return NOSTREAM;
    const mid = (lo + hi) >> 1;
    const node = sorted[mid]!.idx;
    depth[node] = d;
    if (d > maxDepth) maxDepth = d;
    left[node] = build(lo, mid - 1, d + 1);
    right[node] = build(mid + 1, hi, d + 1);
    return node;
  };
  const treeRoot = n > 0 ? build(0, n - 1, 0) : NOSTREAM;

  // Root entry (index 0) — its stream is the mini-stream; its child is the tree.
  writeEntry(0, "Root Entry", DE_ROOT, COLOR_BLACK, treeRoot, NOSTREAM, NOSTREAM, rootStartSector, rootStreamSize);

  // Stream entries (indices 1..N) with the BST sibling pointers and RB coloring.
  // A recursive-middle balanced BST keeps every leaf within the bottom two
  // levels, so coloring only the deepest-level nodes red (and never the tree
  // root) yields equal black-height on every root-to-leaf path.
  for (let i = 0; i < n; i++) {
    const e = entries[i]!;
    const idx = i + 1;
    const isTreeRoot = idx === treeRoot;
    const color = !isTreeRoot && depth[idx] === maxDepth && maxDepth > 0 ? COLOR_RED : COLOR_BLACK;
    writeEntry(idx, e.name, DE_STREAM, color, NOSTREAM, left[idx]!, right[idx]!, startSectorOf(e), e.data.length);
  }
}
