/**
 * Task 1418 — the §8.4 stage-block `03 B4 00 00 00` marker scan must be
 * structurally anchored, not blind first-match.
 *
 * The five-byte marker is not guaranteed unique in the Contents stream: the
 * variable-length catalog / property-map / color-table runs that precede the
 * stage block can coincidentally contain the same bytes. The importer now scans
 * EVERY occurrence and accepts the first whose adjacent frame-rate field parses
 * as a plausible stage block (1–120 fps), instead of taking the first byte-match
 * and bailing when its fps is bogus (which silently dropped every field).
 *
 * Two guards:
 *   1. Regression — the real Magnet/evaporatingdrip fixtures (where the marker
 *      occurs exactly once) still decode their stage properties unchanged.
 *   2. Hardening — a synthesised Contents with a DECOY marker (bogus fps) ahead
 *      of the genuine stage block must skip the decoy and read the real values.
 *      This case fails against the old first-match-and-bail reader.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { __readAllStreamsForTest } from "../ole.js";
import { parseFla8Contents } from "../flash8-binary.js";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../fixtures");

function contentsOf(fla: string): Uint8Array {
  const streams = __readAllStreamsForTest(new Uint8Array(readFileSync(resolve(fixtures, fla))));
  const c = streams.get("Contents");
  if (!c) throw new Error(`no Contents stream in ${fla}`);
  return c;
}

/**
 * Build a faithful §8.4 stage block (docs/21). The `03 B4 00 00 00` marker sits
 * at block offset @+70; every field the anchor scan reads is placed relative to
 * it. Returns the 75-byte block.
 */
function buildStageBlock(opts: {
  rulerUnitType: number;
  gridVisible: boolean;
  gridSpacingPx: number;
  bg: [number, number, number];
  grid: [number, number, number];
  fps: number;
}): Uint8Array {
  const b = new Uint8Array(75);
  b[0] = opts.rulerUnitType; // @+0 ruler-units
  b[2] = opts.gridVisible ? 3 : 0; // @+2 grid-visible
  const gs20 = opts.gridSpacingPx * 20; // @+21 grid spacing (twips)
  b[21] = gs20 & 0xff;
  b[22] = (gs20 >> 8) & 0xff;
  b[56] = opts.bg[0]; // @+56 background color
  b[57] = opts.bg[1];
  b[58] = opts.bg[2];
  b[59] = 0xff;
  b[60] = opts.grid[0]; // @+60 grid color
  b[61] = opts.grid[1];
  b[62] = opts.grid[2];
  b[63] = 0xff;
  b[65] = Math.round((opts.fps - Math.floor(opts.fps)) * 256); // @+65 fps frac
  b[66] = Math.floor(opts.fps); // @+66 fps int
  // @+69 the "00 03 b4 00 00 00" run -> marker starts at @+70.
  b[69] = 0x00;
  b[70] = 0x03;
  b[71] = 0xb4;
  b[72] = 0x00;
  b[73] = 0x00;
  b[74] = 0x00;
  return b;
}

describe("parseFla8Contents — stage-block anchor (task 1418)", () => {
  it("decodes real Magnet.fla stage properties (marker is unique — regression guard)", () => {
    const info = parseFla8Contents(contentsOf("Magnet.fla"));
    expect(info.width).toBe(550);
    expect(info.height).toBe(400);
    expect(info.frameRate).toBe(24);
    expect(info.backgroundColor).toEqual({ r: 255, g: 255, b: 255, a: 255 });
    expect(info.rulerUnitType).toBe(5); // pixels
    expect(info.gridSpacingPx).toBe(20);
    expect(info.gridColor).toEqual({ r: 192, g: 192, b: 192, a: 255 });
  });

  it("decodes real evaporatingdrip.fla stage properties (regression guard)", () => {
    const info = parseFla8Contents(contentsOf("evaporatingdrip.fla"));
    expect(info.width).toBe(300);
    expect(info.height).toBe(300);
    expect(info.frameRate).toBe(30);
    expect(info.rulerUnitType).toBe(5);
    expect(info.gridSpacingPx).toBe(10);
  });

  it("skips a decoy marker with a bogus fps and reads the genuine stage block", () => {
    const block = buildStageBlock({
      rulerUnitType: 3, // cm
      gridVisible: true,
      gridSpacingPx: 40,
      bg: [10, 20, 30],
      grid: [40, 50, 60],
      fps: 25,
    });

    // A decoy "03 B4 00 00 00" ahead of the real block, whose cand-5/cand-4 fps
    // bytes decode out of range (200 fps) so the structural gate rejects it. The
    // old first-match reader would lock onto this and drop every field.
    const prefix = new Uint8Array(64);
    const decoyAt = 20;
    prefix[decoyAt - 5] = 0x00; // fps frac
    prefix[decoyAt - 4] = 200; // fps int -> 200 fps, rejected
    prefix[decoyAt] = 0x03;
    prefix[decoyAt + 1] = 0xb4;
    prefix[decoyAt + 2] = 0x00;
    prefix[decoyAt + 3] = 0x00;
    prefix[decoyAt + 4] = 0x00;

    const buf = new Uint8Array(prefix.length + block.length);
    buf.set(prefix, 0);
    buf.set(block, prefix.length);

    const info = parseFla8Contents(buf);
    expect(info.frameRate).toBe(25);
    expect(info.rulerUnitType).toBe(3);
    expect(info.gridVisible).toBe(true);
    expect(info.gridSpacingPx).toBe(40);
    expect(info.backgroundColor).toEqual({ r: 10, g: 20, b: 30, a: 255 });
    expect(info.gridColor).toEqual({ r: 40, g: 50, b: 60, a: 255 });
  });
});
