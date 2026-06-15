/**
 * Symbol-library helpers: dependency ordering and the small linkage/grid tag
 * encoders used when emitting symbol character definitions.
 *
 * (The full symbol-definition emission pass is threaded through CompileContext
 * by the orchestrator; this module currently owns the standalone, state-free
 * pieces.)
 */
import type { Symbol } from "@flash/core";
import { BitWriter } from "../bits.js";
import { writeRect, px } from "../helpers.js";

/**
 * Sort symbols so that each symbol appears after all symbols it references
 * (dependencies come first). This ensures DefineSprite tags are emitted in
 * dependency order so referenced sprites are always defined before use.
 */
export function topoSortSymbols(symbols: Symbol[]): Symbol[] {
  const idToSymbol = new Map<string, Symbol>(symbols.map((s) => [s.id, s]));
  const visited = new Set<string>();
  const result: Symbol[] = [];

  function visit(sym: Symbol): void {
    if (visited.has(sym.id)) return;
    visited.add(sym.id);

    // Walk all frames in all layers looking for SymbolInstance references
    for (const layer of sym.timeline.layers) {
      for (const frame of layer.frames) {
        for (const obj of frame.displayObjects) {
          if (obj.type === "instance") {
            const dep = idToSymbol.get(obj.symbolId);
            if (dep) visit(dep);
          }
        }
      }
    }

    result.push(sym);
  }

  for (const sym of symbols) {
    visit(sym);
  }

  return result;
}

/**
 * Encode an ExportAssets (tag 56) tag body.
 *
 * Format (SWF spec):
 *   UI16  Count
 *   For each symbol:
 *     UI16    CharacterId
 *     STRING  Name (null-terminated UTF-8)
 */
export function encodeExportAssets(symbols: Array<{ charId: number; name: string }>): Uint8Array {
  // Calculate total byte length: 2 (count) + per-symbol: 2 (UI16 charId) + name bytes + 1 (NUL)
  let totalLen = 2;
  for (const s of symbols) {
    totalLen += 2 + s.name.length + 1;
  }
  const buf = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);
  view.setUint16(0, symbols.length, true /* LE */);
  let offset = 2;
  for (const s of symbols) {
    view.setUint16(offset, s.charId, true /* LE */);
    offset += 2;
    for (let i = 0; i < s.name.length; i++) {
      buf[offset++] = s.name.charCodeAt(i);
    }
    buf[offset++] = 0; // NUL terminator
  }
  return buf;
}

/**
 * Encode an ImportAssets2 (tag 71) tag body.
 *
 * Format (SWF spec):
 *   STRING  URL (null-terminated)
 *   UI8     Reserved = 1
 *   UI8     Reserved = 0
 *   UI16    Count
 *   For each symbol:
 *     UI16    CharacterId
 *     STRING  Name (null-terminated UTF-8)
 */
export function encodeImportAssets2(url: string, symbols: Array<{ charId: number; name: string }>): Uint8Array {
  // Calculate total byte length:
  // url bytes + 1 (NUL) + 2 (reserved) + 2 (count) + per-symbol: 2 (UI16 charId) + name bytes + 1 (NUL)
  let totalLen = url.length + 1 + 2 + 2;
  for (const s of symbols) {
    totalLen += 2 + s.name.length + 1;
  }
  const buf = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);
  let offset = 0;
  // Write URL null-terminated
  for (let i = 0; i < url.length; i++) {
    buf[offset++] = url.charCodeAt(i);
  }
  buf[offset++] = 0; // NUL terminator
  // Reserved bytes
  buf[offset++] = 1;
  buf[offset++] = 0;
  // Count
  view.setUint16(offset, symbols.length, true /* LE */);
  offset += 2;
  // Each symbol: charId + name
  for (const s of symbols) {
    view.setUint16(offset, s.charId, true /* LE */);
    offset += 2;
    for (let i = 0; i < s.name.length; i++) {
      buf[offset++] = s.name.charCodeAt(i);
    }
    buf[offset++] = 0; // NUL terminator
  }
  return buf;
}

/**
 * Encode a DefineScalingGrid (tag 78) body.
 *
 * Format (SWF spec §12.34):
 *   UI16   SpriteID (the DefineSprite character ID)
 *   RECT   Splitter (the 9-slice grid rectangle in twips)
 *
 * The RECT defines the inner rectangle of the 9-slice grid:
 *   xMin = left boundary, xMax = right boundary
 *   yMin = top boundary,  yMax = bottom boundary
 */
export function encodeDefineScalingGrid(
  spriteId: number,
  grid: { x: number; y: number; width: number; height: number }
): Uint8Array {
  const bw = new BitWriter();
  bw.writeUI16LE(spriteId);
  writeRect(
    bw,
    px(grid.x),
    px(grid.x + grid.width),
    px(grid.y),
    px(grid.y + grid.height)
  );
  return bw.getBytes();
}
