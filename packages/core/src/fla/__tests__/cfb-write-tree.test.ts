/**
 * CFB writer directory-tree tests ([MS-CFB] §2.6.4 red-black tree ordering).
 *
 * Regression for the "unsorted degenerate directory chain" defect: the writer
 * used to emit the directory as a linear right-sibling chain in Map-insertion
 * order (Media*, Symbol*, Page*, Contents LAST) with every entry black. A strict
 * CFB consumer (OLE32/MFC, real Flash 8) does NOT scan siblings exhaustively — it
 * walks the tree comparatively by the CFB name comparison, so looking up
 * "Contents" at a same-length node like "Symbol 1" ("CONTENTS" < "SYMBOL 1")
 * steers LEFT into NOSTREAM and the stream is "not found". dash's own reader
 * visits all siblings, so round-trips hid the defect.
 *
 * These tests assert (a) the emitted directory satisfies the MS-CFB sibling
 * ordering invariant and a BST-style lookup (left/right by the comparator, no
 * exhaustive scan) finds every stream incl. "Contents" in a doc with symbols +
 * media, (b) the tree is a valid red-black tree, and (c) the existing OLE reader
 * still round-trips.
 */

import { describe, it, expect } from "vitest";
import { writeCfb, cfbNameCompare } from "../write/cfb-write.js";
import { __readAllStreamsForTest } from "../ole.js";

const NOSTREAM = 0xffffffff;
const SECTOR_SIZE = 512;
const DE_STREAM = 2;
const DE_ROOT = 5;

interface DirEntry {
  idx: number;
  name: string;
  type: number;
  color: number; // 0 = red, 1 = black
  left: number;
  right: number;
  child: number;
  start: number;
  size: number;
}

function u16(b: Uint8Array, o: number): number {
  return b[o]! | (b[o + 1]! << 8);
}
function u32(b: Uint8Array, o: number): number {
  return (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
}

/** Rebuild the FAT and follow the directory chain, returning the parsed entries. */
function parseDirectory(bytes: Uint8Array): DirEntry[] {
  const firstDirSector = u32(bytes, 48);
  const fatSectorCount = u32(bytes, 44);
  const firstDifat = u32(bytes, 68);
  const difatSectorCount = u32(bytes, 72);

  const sectorOff = (s: number): number => SECTOR_SIZE + s * SECTOR_SIZE;

  // Collect FAT-sector indices: first 109 from the header DIFAT, rest from the
  // DIFAT-sector chain (127 pointers + 1 next-pointer each).
  const fatSectors: number[] = [];
  for (let i = 0; i < 109 && fatSectors.length < fatSectorCount; i++) {
    const v = u32(bytes, 76 + i * 4);
    if (v !== 0xffffffff) fatSectors.push(v);
  }
  let dif = firstDifat;
  let guard = 0;
  while (difatSectorCount > 0 && dif !== NOSTREAM && dif !== 0xfffffffe && guard++ < 100000) {
    const base = sectorOff(dif);
    for (let i = 0; i < 127 && fatSectors.length < fatSectorCount; i++) {
      const v = u32(bytes, base + i * 4);
      if (v !== 0xffffffff) fatSectors.push(v);
    }
    dif = u32(bytes, base + 127 * 4);
  }

  // Build the flat FAT array.
  const fat: number[] = [];
  for (const fs of fatSectors) {
    const base = sectorOff(fs);
    for (let i = 0; i < SECTOR_SIZE / 4; i++) fat.push(u32(bytes, base + i * 4));
  }

  // Follow the directory chain.
  const dirData: number[] = [];
  let s = firstDirSector;
  guard = 0;
  while (s !== 0xfffffffe && s !== NOSTREAM && guard++ < 100000) {
    const base = sectorOff(s);
    for (let i = 0; i < SECTOR_SIZE; i++) dirData.push(bytes[base + i]!);
    s = fat[s]!;
  }
  const dir = new Uint8Array(dirData);

  const entries: DirEntry[] = [];
  const count = Math.floor(dir.length / 128);
  for (let i = 0; i < count; i++) {
    const b = i * 128;
    const nameLen = u16(dir, b + 64);
    let name = "";
    for (let j = 0; j < Math.max(0, (nameLen - 2) / 2); j++) name += String.fromCharCode(u16(dir, b + j * 2));
    const type = dir[b + 66]!;
    if (type === 0) continue; // unused slot
    entries.push({
      idx: i,
      name,
      type,
      color: dir[b + 67]!,
      left: u32(dir, b + 68),
      right: u32(dir, b + 72),
      child: u32(dir, b + 76),
      start: u32(dir, b + 116),
      size: u32(dir, b + 120),
    });
  }
  return entries;
}

/** BST lookup exactly as a strict CFB consumer walks it: compare, then go one way. */
function bstLookup(entries: DirEntry[], name: string): DirEntry | null {
  const root = entries[0]!;
  let id = root.child;
  let guard = 0;
  while (id !== NOSTREAM && guard++ < 100000) {
    const e = entries[id];
    if (!e) return null;
    const cmp = cfbNameCompare(name, e.name);
    if (cmp === 0) return e;
    id = cmp < 0 ? e.left : e.right;
  }
  return null;
}

/** Assert red-black validity; returns the (uniform) black-height. */
function assertRedBlack(entries: DirEntry[]): void {
  const root = entries[0]!;
  // Root of the tree (root storage's child) must be black.
  if (root.child !== NOSTREAM) {
    expect(entries[root.child]!.color, "tree root must be black").toBe(1);
  }

  const blackHeight = (id: number, redParent: boolean): number => {
    if (id === NOSTREAM) return 1; // NIL counts as one black node
    const e = entries[id]!;
    const isRed = e.color === 0;
    if (isRed && redParent) throw new Error(`red-red violation at "${e.name}"`);
    // BST ordering: left subtree < e < right subtree by the CFB comparator.
    if (e.left !== NOSTREAM) expect(cfbNameCompare(entries[e.left]!.name, e.name)).toBeLessThan(0);
    if (e.right !== NOSTREAM) expect(cfbNameCompare(entries[e.right]!.name, e.name)).toBeGreaterThan(0);
    const lb = blackHeight(e.left, isRed);
    const rb = blackHeight(e.right, isRed);
    if (lb !== rb) throw new Error(`black-height mismatch at "${e.name}": ${lb} vs ${rb}`);
    return lb + (isRed ? 0 : 1);
  };

  expect(() => blackHeight(root.child, false)).not.toThrow();
}

function makeStream(size: number, seed: number): Uint8Array {
  const a = new Uint8Array(size);
  for (let i = 0; i < size; i++) a[i] = (i * 31 + seed * 7 + 1) & 0xff;
  if (size > 0) a[0] = 0x01;
  return a;
}

describe("cfbNameCompare ([MS-CFB] §2.6.4)", () => {
  it("orders by length first, then case-insensitive uppercase", () => {
    expect(cfbNameCompare("Contents", "Symbol 1")).toBeLessThan(0); // equal len, CONTENTS < SYMBOL 1
    expect(cfbNameCompare("Page 1", "Contents")).toBeLessThan(0); // shorter first
    expect(cfbNameCompare("page 1", "PAGE 1")).toBe(0); // case-insensitive
    expect(cfbNameCompare("Symbol 1", "Contents")).toBeGreaterThan(0);
    expect(cfbNameCompare("Media 10", "Media 2")).toBeGreaterThan(0); // length 8 > 7
  });
});

describe("writeCfb directory red-black tree", () => {
  it("emits a valid BST; strict lookup finds every stream incl. 'Contents' (symbols+media doc)", () => {
    const streams = new Map<string, Uint8Array>();
    // Insertion order mirrors saveRealFla: Media*, Symbol*, Page*, Contents LAST.
    for (let i = 1; i <= 3; i++) streams.set(`Media ${i}`, makeStream(200 + i, i));
    for (let i = 1; i <= 4; i++) streams.set(`Symbol ${i}`, makeStream(300 + i, i + 10));
    for (let i = 1; i <= 2; i++) streams.set(`Page ${i}`, makeStream(150 + i, i + 20));
    streams.set("Contents", makeStream(5000, 99)); // > cutoff → big stream

    const bytes = writeCfb(streams);
    const entries = parseDirectory(bytes);

    // The tree must be a valid red-black tree with a correct BST ordering.
    assertRedBlack(entries);

    // A strict comparator-driven walk (NO exhaustive sibling scan) must find
    // every stream — this is what real Flash / OLE32 does.
    for (const name of streams.keys()) {
      const found = bstLookup(entries, name);
      expect(found, `strict BST lookup failed for "${name}"`).not.toBeNull();
      expect(found!.type).toBe(DE_STREAM);
    }
    // The canary: "Contents" must be reachable even though it was inserted last.
    expect(bstLookup(entries, "Contents")).not.toBeNull();

    // In-order traversal of the tree must equal the CFB name ordering.
    const inorder: string[] = [];
    const walk = (id: number): void => {
      if (id === NOSTREAM) return;
      const e = entries[id]!;
      walk(e.left);
      inorder.push(e.name);
      walk(e.right);
    };
    walk(entries[0]!.child);
    const expected = [...streams.keys()].sort(cfbNameCompare);
    expect(inorder).toEqual(expected);

    // Root entry sanity.
    expect(entries[0]!.type).toBe(DE_ROOT);
  });

  it("produces a valid RB tree across many stream counts", () => {
    for (const n of [0, 1, 2, 3, 4, 5, 6, 7, 8, 15, 16, 17, 31, 32, 50, 100]) {
      const streams = new Map<string, Uint8Array>();
      for (let i = 0; i < n; i++) streams.set(`Stream ${1000 + i}`, makeStream(10 + i, i));
      const entries = parseDirectory(writeCfb(streams));
      assertRedBlack(entries);
      for (const name of streams.keys()) {
        expect(bstLookup(entries, name), `n=${n} lookup "${name}"`).not.toBeNull();
      }
    }
  });

  it("still round-trips byte-identically through the OLE reader", () => {
    const streams = new Map<string, Uint8Array>();
    for (let i = 1; i <= 3; i++) streams.set(`Media ${i}`, makeStream(200 + i, i));
    for (let i = 1; i <= 4; i++) streams.set(`Symbol ${i}`, makeStream(300 + i, i + 10));
    streams.set("Contents", makeStream(5000, 99));
    streams.set("Page 1", makeStream(120, 7));

    const got = __readAllStreamsForTest(writeCfb(streams));
    for (const [name, exp] of streams) {
      const g = got.get(name);
      expect(g, `stream "${name}" missing`).toBeDefined();
      expect(Array.from(g!)).toEqual(Array.from(exp));
    }
  });
});
