/**
 * OLE2/CFB (Compound File Binary) container parser for real Macromedia
 * Flash .fla files (Flash 5 / MX / MX 2004 / 8 / CS-era binary format).
 *
 * Flash stores its project data in an OLE2 container (magic: D0 CF 11 E0 A1
 * B1 1A E1) holding "Contents", "Page N", "Symbol N" and "Media N" streams.
 * The stream payloads are parsed by flash8-binary.ts / flash8-import.ts.
 *
 * Write-back to real FLA format is explicitly OUT OF SCOPE.
 */

import type { FlashDocument, Scene } from "../model/types.js";
import { createDocument } from "../model/document.js";
import { createScene } from "../model/scene.js";
import { createLayer } from "../model/timeline.js";
import { buildFla8Document } from "./flash8-import.js";

// ---------------------------------------------------------------------------
// OLE2 constants
// ---------------------------------------------------------------------------

const OLE2_MAGIC = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1] as const;
const ENDOFCHAIN = 0xFFFFFFFE;
const FREESECT   = 0xFFFFFFFF;
const DIFSECT    = 0xFFFFFFFC;
const FATSECT    = 0xFFFFFFFD;
const NOSTREAM   = 0xFFFFFFFF;

// Directory entry types
const DE_STORAGE = 1;
const DE_STREAM  = 2;
const DE_ROOT    = 5;

// ---------------------------------------------------------------------------
// OLE2 types
// ---------------------------------------------------------------------------

interface Ole2Header {
  sectorSize: number;        // 512 or 4096
  miniSectorSize: number;    // usually 64
  fatSectorCount: number;
  firstDirSector: number;
  miniStreamCutoff: number;  // usually 4096
  firstMiniFatSector: number;
  miniFatSectorCount: number;
  firstDifatSector: number;  // start of the extended DIFAT chain
  difatSectors: number[];    // first 109 DIFAT entries from header
}

interface DirectoryEntry {
  name: string;
  type: number;              // 0=empty,1=storage,2=stream,5=root
  startSector: number;
  size: number;
  childId: number;
  leftSiblingId: number;
  rightSiblingId: number;
}

// ---------------------------------------------------------------------------
// OLE2 magic detection
// ---------------------------------------------------------------------------

/**
 * Returns true if the bytes begin with the OLE2 magic signature.
 */
export function isOle2(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== OLE2_MAGIC[i]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Low-level readers
// ---------------------------------------------------------------------------

function readU16LE(buf: Uint8Array, offset: number): number {
  return buf[offset]! | (buf[offset + 1]! << 8);
}

function readU32LE(buf: Uint8Array, offset: number): number {
  return (
    (buf[offset]!) |
    (buf[offset + 1]! << 8) |
    (buf[offset + 2]! << 16) |
    ((buf[offset + 3]! >>> 0) * 0x1000000)   // avoid sign extension on bit 31
  );
}

// ---------------------------------------------------------------------------
// Header parsing
// ---------------------------------------------------------------------------

function parseHeader(bytes: Uint8Array): Ole2Header {
  // Sector size: 2^(value at offset 30)
  const sectorSizePow = readU16LE(bytes, 30);
  const sectorSize = 1 << sectorSizePow;

  const miniSectorSizePow = readU16LE(bytes, 32);
  const miniSectorSize = 1 << miniSectorSizePow;

  const fatSectorCount   = readU32LE(bytes, 44);
  const firstDirSector   = readU32LE(bytes, 48);
  const miniStreamCutoff = readU32LE(bytes, 56);
  const firstMiniFatSector = readU32LE(bytes, 60);
  const miniFatSectorCount = readU32LE(bytes, 64);
  const firstDifatSector   = readU32LE(bytes, 68);

  // First 109 DIFAT entries at offset 76
  const difatSectors: number[] = [];
  for (let i = 0; i < 109; i++) {
    const v = readU32LE(bytes, 76 + i * 4);
    if (v === FREESECT || v === ENDOFCHAIN) break;
    difatSectors.push(v);
  }

  return {
    sectorSize,
    miniSectorSize,
    fatSectorCount,
    firstDirSector,
    miniStreamCutoff,
    firstMiniFatSector,
    miniFatSectorCount,
    firstDifatSector,
    difatSectors,
  };
}

// ---------------------------------------------------------------------------
// FAT chain reading
// ---------------------------------------------------------------------------

function getSectorData(bytes: Uint8Array, sector: number, sectorSize: number): Uint8Array {
  const offset = 512 + sector * sectorSize;  // header is always 512 bytes for version 3
  return bytes.subarray(offset, offset + sectorSize);
}

function buildFat(bytes: Uint8Array, header: Ole2Header): Uint32Array {
  const { sectorSize } = header;
  const entriesPerSector = sectorSize / 4;

  // Collect all DIFAT entries: 109 from the header plus any extended DIFAT
  // sectors (needed for files larger than ~6.8 MB).
  const difatSectors = [...header.difatSectors];
  let difatSector = header.firstDifatSector;
  const seenDifat = new Set<number>();
  while (
    difatSector !== ENDOFCHAIN &&
    difatSector !== FREESECT &&
    !seenDifat.has(difatSector)
  ) {
    seenDifat.add(difatSector);
    const data = getSectorData(bytes, difatSector, sectorSize);
    for (let i = 0; i < entriesPerSector - 1; i++) {
      const v = readU32LE(data, i * 4);
      if (v !== FREESECT && v !== ENDOFCHAIN) difatSectors.push(v);
    }
    difatSector = readU32LE(data, (entriesPerSector - 1) * 4);
  }

  const fat = new Uint32Array(difatSectors.length * entriesPerSector);
  let idx = 0;
  for (const fatSector of difatSectors) {
    const data = getSectorData(bytes, fatSector, sectorSize);
    for (let i = 0; i < entriesPerSector && idx < fat.length; i++, idx++) {
      fat[idx] = readU32LE(data, i * 4);
    }
  }
  return fat;
}

function followChain(fat: Uint32Array, start: number): number[] {
  const chain: number[] = [];
  let cur = start;
  const visited = new Set<number>();
  while (cur !== ENDOFCHAIN && cur !== FREESECT && cur !== FATSECT && cur !== DIFSECT) {
    if (visited.has(cur)) break; // cycle guard
    visited.add(cur);
    chain.push(cur);
    cur = fat[cur] ?? ENDOFCHAIN;
  }
  return chain;
}

function readStream(bytes: Uint8Array, fat: Uint32Array, startSector: number, size: number, sectorSize: number): Uint8Array {
  const chain = followChain(fat, startSector);
  const result = new Uint8Array(size);
  let written = 0;
  for (const sector of chain) {
    if (written >= size) break;
    const data = getSectorData(bytes, sector, sectorSize);
    const toCopy = Math.min(sectorSize, size - written);
    result.set(data.subarray(0, toCopy), written);
    written += toCopy;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Directory parsing
// ---------------------------------------------------------------------------

function parseDirectoryEntries(dirData: Uint8Array): DirectoryEntry[] {
  const entries: DirectoryEntry[] = [];
  const count = dirData.length / 128;
  for (let i = 0; i < count; i++) {
    const base = i * 128;
    const nameLen = readU16LE(dirData, base + 64);
    let name = "";
    if (nameLen > 2) {
      for (let j = 0; j < (nameLen - 2) / 2; j++) {
        const ch = readU16LE(dirData, base + j * 2);
        name += String.fromCharCode(ch);
      }
    }
    const type          = dirData[base + 66]!;
    const leftSiblingId = readU32LE(dirData, base + 68);
    const rightSiblingId = readU32LE(dirData, base + 72);
    const childId       = readU32LE(dirData, base + 76);
    const startSector   = readU32LE(dirData, base + 116);
    const sizeLo        = readU32LE(dirData, base + 120);

    entries.push({ name, type, startSector, size: sizeLo, childId, leftSiblingId, rightSiblingId });
  }
  return entries;
}

/** Collect all stream entries reachable from the root, preserving names. */
function collectStreamEntries(entries: DirectoryEntry[]): DirectoryEntry[] {
  const out: DirectoryEntry[] = [];
  const visited = new Set<number>();

  function visit(id: number): void {
    if (id === NOSTREAM || id >= entries.length || visited.has(id)) return;
    visited.add(id);
    const e = entries[id];
    if (!e) return;
    if (e.type === DE_STREAM) {
      out.push(e);
    }
    visit(e.leftSiblingId);
    visit(e.rightSiblingId);
    if (e.type === DE_STORAGE || e.type === DE_ROOT) {
      visit(e.childId);
    }
  }

  const root = entries[0];
  if (root) {
    visit(root.childId);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mini-FAT (streams smaller than the mini-stream cutoff, usually 4096 bytes,
// live in 64-byte mini sectors carved out of the root entry's stream)
// ---------------------------------------------------------------------------

function buildMiniFat(bytes: Uint8Array, fat: Uint32Array, header: Ole2Header): Uint32Array {
  if (
    header.firstMiniFatSector === ENDOFCHAIN ||
    header.firstMiniFatSector === FREESECT ||
    header.miniFatSectorCount === 0
  ) {
    return new Uint32Array(0);
  }
  const chain = followChain(fat, header.firstMiniFatSector);
  const entriesPerSector = header.sectorSize / 4;
  const miniFat = new Uint32Array(chain.length * entriesPerSector);
  let idx = 0;
  for (const sector of chain) {
    const data = getSectorData(bytes, sector, header.sectorSize);
    for (let i = 0; i < entriesPerSector; i++, idx++) {
      miniFat[idx] = readU32LE(data, i * 4);
    }
  }
  return miniFat;
}

function readMiniStream(
  miniStream: Uint8Array,
  miniFat: Uint32Array,
  startSector: number,
  size: number,
  miniSectorSize: number,
): Uint8Array {
  const result = new Uint8Array(size);
  let written = 0;
  let cur = startSector;
  const visited = new Set<number>();
  while (cur !== ENDOFCHAIN && cur !== FREESECT && written < size) {
    if (visited.has(cur)) break;
    visited.add(cur);
    const offset = cur * miniSectorSize;
    const toCopy = Math.min(miniSectorSize, size - written);
    result.set(miniStream.subarray(offset, offset + toCopy), written);
    written += toCopy;
    cur = miniFat[cur] ?? ENDOFCHAIN;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fallback skeleton returned when the container is readable but the Flash
 * document payload cannot be parsed: default stage properties, one scene,
 * one empty layer.
 */
function skeletonDocument(): FlashDocument {
  const layer = createLayer("Layer 1", "normal");
  const scene = createScene("Scene 1");
  const sceneWithLayer: Scene = {
    ...scene,
    timeline: { layers: [layer] },
  };
  return createDocument({
    scenes: [sceneWithLayer],
    library: { items: [], folders: [] },
  });
}

/**
 * Try to parse a genuine Macromedia Flash binary .fla file (OLE2/CFB format,
 * Flash 5 through CS4-era; Flash 8 is the primary target).
 *
 * Returns null if the bytes do not start with the OLE2 magic signature.
 * Returns a FlashDocument with real layers / frames / shapes / symbol
 * instances / frame scripts extracted from the "Page N" and "Symbol N"
 * streams. Falls back to a skeleton document (with a console.warn) when the
 * container is readable but the payload is not.
 *
 * Throws if the container is structurally corrupt beyond recovery.
 * Write-back to real FLA is explicitly out of scope; the returned document
 * should be treated as a read-only import.
 */
export function tryLoadRealFla(bytes: Uint8Array): FlashDocument | null {
  if (!isOle2(bytes)) return null;

  // Parse OLE2 header
  let header: Ole2Header;
  try {
    header = parseHeader(bytes);
  } catch (err) {
    console.warn('[FLA import] Could not parse OLE2 header:', err);
    throw new Error(`FLA open error: OLE2 header corrupt — ${String(err)}`);
  }

  // Build FAT
  let fat: Uint32Array;
  try {
    fat = buildFat(bytes, header);
  } catch (err) {
    console.warn('[FLA import] Could not build FAT:', err);
    throw new Error(`FLA open error: OLE2 FAT corrupt — ${String(err)}`);
  }

  // Read directory
  let dirEntries: DirectoryEntry[];
  try {
    const dirChain = followChain(fat, header.firstDirSector);
    const dirSize = dirChain.length * header.sectorSize;
    const dirData = readStream(bytes, fat, header.firstDirSector, dirSize, header.sectorSize);
    dirEntries = parseDirectoryEntries(dirData);
  } catch (err) {
    console.warn('[FLA import] Could not read OLE2 directory:', err);
    throw new Error(`FLA open error: OLE2 directory corrupt — ${String(err)}`);
  }

  const streamEntries = collectStreamEntries(dirEntries);

  // Mini-FAT setup (small streams live in mini sectors inside the root stream)
  let miniFat: Uint32Array = new Uint32Array(0);
  let miniStream: Uint8Array = new Uint8Array(0);
  try {
    miniFat = buildMiniFat(bytes, fat, header);
    const root = dirEntries[0];
    if (root && miniFat.length > 0) {
      miniStream = readStream(bytes, fat, root.startSector, root.size, header.sectorSize);
    }
  } catch (err) {
    console.warn('[FLA import] Could not read mini-FAT (small streams may be unreadable):', err);
  }

  const readEntry = (entry: DirectoryEntry): Uint8Array => {
    if (entry.size < header.miniStreamCutoff && miniStream.length > 0) {
      return readMiniStream(miniStream, miniFat, entry.startSector, entry.size, header.miniSectorSize);
    }
    return readStream(bytes, fat, entry.startSector, entry.size, header.sectorSize);
  };

  // Read every stream into memory (FLA streams are small; Media streams for
  // big projects are read but unused for now).
  const streams = new Map<string, Uint8Array>();
  for (const entry of streamEntries) {
    if (entry.size === 0) continue;
    const cleanName = entry.name.replace(/\0+$/, '');
    try {
      streams.set(cleanName, readEntry(entry));
    } catch (err) {
      console.warn(`[FLA import] Could not read stream "${cleanName}":`, err);
    }
  }

  // Build the document from the Contents / Page / Symbol streams.
  try {
    const doc = buildFla8Document(streams);
    if (doc) return doc;
  } catch (err) {
    console.warn('[FLA import] Flash document payload could not be parsed:', err);
  }

  console.warn(
    '[FLA import] Falling back to a skeleton document (no timeline streams could be parsed)',
  );
  return skeletonDocument();
}
