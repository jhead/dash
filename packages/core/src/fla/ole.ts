/**
 * Best-effort OLE2/CFB (Compound File Binary) parser for real Macromedia Flash 8 .fla files.
 *
 * Flash 8 stores its project data in an OLE2 container (magic: D0 CF 11 E0 A1 B1 1A E1).
 * The internal binary format is undocumented; this parser extracts what it can and logs
 * warnings for anything it cannot interpret.
 *
 * Write-back to real FLA format is explicitly OUT OF SCOPE.
 */

import type { FlashDocument, Scene } from "../model/types.js";
import { createDocument, createDocumentProperties } from "../model/document.js";
import { createScene } from "../model/scene.js";
import { createLayer } from "../model/timeline.js";

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
  const { sectorSize, difatSectors } = header;
  const entriesPerSector = sectorSize / 4;
  const fat = new Uint32Array(header.fatSectorCount * entriesPerSector);
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

function collectEntries(entries: DirectoryEntry[]): Map<string, DirectoryEntry> {
  const map = new Map<string, DirectoryEntry>();

  function visit(id: number): void {
    if (id === NOSTREAM || id >= entries.length) return;
    const e = entries[id];
    if (!e) return;
    if (e.type === DE_STREAM || e.type === DE_STORAGE) {
      map.set(e.name.toLowerCase(), e);
    }
    visit(e.leftSiblingId);
    visit(e.rightSiblingId);
    if (e.type === DE_STORAGE || e.type === DE_ROOT) {
      visit(e.childId);
    }
  }

  // Start from root's child
  const root = entries[0];
  if (root) {
    visit(root.childId);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Flash 8 binary stream parser (best-effort)
// ---------------------------------------------------------------------------

/**
 * Try to extract basic document properties from the raw Flash 8 binary stream.
 *
 * The Flash 8 internal format is undocumented. This function performs a
 * best-effort scan for recognizable patterns:
 *
 * - Stage dimensions (width, height) stored as 16-bit LE values
 * - Frame rate stored as a 16-bit or 32-bit LE value
 * - Background color as 3 consecutive bytes (RGB)
 * - Layer count and basic layer names
 *
 * Anything that cannot be parsed is skipped with a console.warn.
 */
function parseFlash8Stream(stream: Uint8Array): Partial<FlashDocument> {
  if (stream.length < 16) {
    console.warn('[FLA import] Stream too short to parse Flash 8 properties');
    return {};
  }

  // The Flash 8 binary FLA uses a record-based format. Without full
  // documentation we scan for plausible stage dimensions.
  //
  // Known layout hints (from community reverse engineering of JPEXS FFDec):
  // - Bytes 0-3: version/magic marker (varies)
  // - Stage width/height often appear early as UI16 LE pairs
  // - Frame rate as UI16 (value * 256 / 256) near the stage dimensions
  //
  // Strategy: scan the first 256 bytes for pairs of UI16 values that look
  // like plausible stage dimensions (between 1 and 8192).

  let width = 550;
  let height = 400;
  let frameRate = 12;
  let backgroundColor = "#ffffff";

  // Scan for plausible (width, height) pairs in the first 512 bytes
  const scanLimit = Math.min(stream.length - 4, 512);
  for (let i = 0; i < scanLimit; i += 2) {
    const w = readU16LE(stream, i);
    const h = readU16LE(stream, i + 2);
    if (w >= 1 && w <= 8192 && h >= 1 && h <= 8192 && w !== h) {
      // Check for a plausible frame rate nearby (1-120)
      if (i + 4 < stream.length) {
        const fps = readU16LE(stream, i + 4);
        if (fps >= 1 && fps <= 120) {
          width = w;
          height = h;
          frameRate = fps;
          break;
        }
      } else {
        width = w;
        height = h;
        break;
      }
    }
  }

  // Scan for a background color (3 consecutive bytes that look like RGB)
  // Background is often stored after dimension/fps data
  for (let i = 6; i < Math.min(stream.length - 3, 128); i++) {
    const r = stream[i]!;
    const g = stream[i + 1]!;
    const b = stream[i + 2]!;
    // Skip obvious non-color patterns like 0x00 0x00 0x00 at start (null fields)
    if (i > 8 && (r > 0 || g > 0 || b > 0)) {
      backgroundColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
      break;
    }
  }

  console.warn('[FLA import] Best-effort parsed stage properties from Flash 8 binary stream. Layer structure and display objects are not extracted from this format version.');

  const properties = createDocumentProperties({
    width,
    height,
    frameRate,
    backgroundColor,
  });

  // Build a minimal document with one scene and one empty layer
  const layer = createLayer("Layer 1", "normal");
  const scene = createScene("Scene 1");
  const sceneWithLayer: Scene = {
    ...scene,
    timeline: { layers: [layer] },
  };

  return {
    properties,
    scenes: [sceneWithLayer],
    library: { items: [], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Try to parse a genuine Macromedia Flash 8 .fla file (OLE2/CFB format).
 *
 * Returns null if the bytes do not start with the OLE2 magic signature.
 * Returns a best-effort FlashDocument if the OLE2 container can be read.
 * Throws if the container is structurally corrupt beyond recovery.
 *
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

  const entryMap = collectEntries(dirEntries);

  // Try known Flash 8 stream names (case-insensitive)
  const candidateNames = [
    'macromediaflash8\0',  // Flash 8
    'macromediaflash mx 2004\0',
    'macromediaflash mx\0',
    'macromediaflash5\0',
    'macromediaflash4\0',
    'contents',            // older versions
    'document',
  ];

  let flashStream: Uint8Array | null = null;
  let usedStreamName = '';

  for (const name of candidateNames) {
    const entry = entryMap.get(name) ?? entryMap.get(name.replace('\0', ''));
    if (entry && entry.type === DE_STREAM && entry.size > 0) {
      try {
        flashStream = readStream(bytes, fat, entry.startSector, entry.size, header.sectorSize);
        usedStreamName = name;
        break;
      } catch {
        // try next
      }
    }
  }

  // If no named stream found, try the first non-empty stream in the directory
  if (!flashStream) {
    for (const [name, entry] of entryMap) {
      if (entry.type === DE_STREAM && entry.size > 64) {
        try {
          flashStream = readStream(bytes, fat, entry.startSector, entry.size, header.sectorSize);
          usedStreamName = name;
          console.warn(`[FLA import] No known Flash stream found; falling back to stream "${name}"`);
          break;
        } catch {
          // skip
        }
      }
    }
  }

  if (!flashStream || flashStream.length === 0) {
    console.warn('[FLA import] No readable Flash content stream found in OLE2 container');
    // Return a default document rather than failing completely
    return createDocument();
  }

  console.warn(`[FLA import] Reading Flash content from OLE2 stream "${usedStreamName}" (${flashStream.length} bytes)`);

  // Parse the Flash binary stream (best-effort)
  const partial = parseFlash8Stream(flashStream);

  const base = createDocument();
  return {
    ...base,
    ...partial,
  };
}
