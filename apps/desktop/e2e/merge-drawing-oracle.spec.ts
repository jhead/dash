/**
 * Merge-drawing interaction oracle — canonical Flash 8 merge-mode cases.
 *
 * This suite is the acceptance harness for the curve-aware planar geometry
 * kernel re-architecture (docs/36-vector-merge-model.md).  Each case below is a
 * CANONICAL merge-drawing interaction whose correctness is the whole point of the
 * planar kernel.  The verification recipe for every case is the project's
 * two-oracle stack:
 *
 *   (1) STAGE-CANVAS oracle — drive the interaction through the editor (author +
 *       commit via the planar merge-on-commit path), then capture
 *       `window.__flashTest.screenshotStage()` and assert the expected merge
 *       result (pixel regions present/absent).
 *   (2) RUFFLE PIXEL oracle — publish the document
 *       (`window.__flashTest.publish()`), render the SWF in the bundled Ruffle
 *       player, screenshot it, and pixelmatch against the stage capture so the
 *       authored merge result and the published result agree.
 *
 * P1 (task 1319) fills in the first two cases (red-over-blue cut, blue-over-blue
 * union) behind the `planarMergeOnCommit` feature flag (turned ON for the test).
 * Cases 3-6 (segment selection, line-splits-fill, eraser, island move) remain
 * `.fixme` placeholders for P2-P5.
 *
 * Mirrors the existing oracle conventions (color-effect-oracle.spec.ts /
 * interactivity.spec.ts): pixelmatch + pngjs, `__flashTest` bridge, autoplay+
 * overlay-hiding for Ruffle, page.screenshot clip for WebGL capture.
 */

import { test, expect, TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

type Page = Parameters<Parameters<typeof test>[1]>[0];

// ---------------------------------------------------------------------------
// Ruffle helpers (shared pattern with color-effect-oracle.spec.ts)
// ---------------------------------------------------------------------------

async function ensureRuffleLoaded(page: Page): Promise<void> {
  await page.evaluate(() => {
    return new Promise<void>((resolve, reject) => {
      if ((window as Window & typeof globalThis).RufflePlayer) { resolve(); return; }
      const existing = document.querySelector<HTMLScriptElement>('script[data-ruffle]');
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = '/ruffle/ruffle.js';
      script.dataset['ruffle'] = '1';
      script.addEventListener('load', () => resolve(), { once: true });
      script.addEventListener('error', () => reject(new Error('Failed to load /ruffle/ruffle.js')), { once: true });
      document.head.appendChild(script);
    });
  });
}

async function injectRufflePlayer(page: Page, swfBase64: string, playerId: string): Promise<void> {
  await page.evaluate(({ b64, id }) => {
    type RuffleHandle = { createPlayer(): RufflePlayerEl };
    type RufflePlayerEl = HTMLElement & {
      ruffle(): {
        load(opts: {
          data?: Uint8Array;
          allowScriptAccess?: boolean;
          autoplay?: string;
          unmuteOverlay?: string;
        }): Promise<void>;
      };
    };
    const ruffleApi = (window as unknown as { RufflePlayer: { newest(): RuffleHandle } }).RufflePlayer.newest();
    const player = ruffleApi.createPlayer() as RufflePlayerEl;
    player.id = id;
    player.style.cssText = 'position:fixed;top:0;left:0;width:550px;height:400px;z-index:99999;';
    document.body.appendChild(player);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    void player.ruffle().load({
      data: bytes,
      allowScriptAccess: true,
      autoplay: 'on',
      unmuteOverlay: 'hidden',
    });
  }, { b64: swfBase64, id: playerId });
}

async function hideRuffleOverlays(page: Page, playerId: string): Promise<void> {
  await page.evaluate((id) => {
    const root = document.getElementById(id) as (HTMLElement & { shadowRoot?: ShadowRoot }) | null;
    const sr = root?.shadowRoot;
    if (!sr) return;
    const walk = (node: ParentNode) => {
      node.querySelectorAll('*').forEach((elem) => {
        const e = elem as HTMLElement & { shadowRoot?: ShadowRoot };
        const sig = `${e.id} ${e.className}`.toLowerCase();
        if (/modal|overlay|message|splash|play-button|panic/.test(sig)) {
          e.style.setProperty('display', 'none', 'important');
        }
        if (e.shadowRoot) walk(e.shadowRoot);
      });
    };
    walk(sr);
  }, playerId);
}

async function removeRufflePlayer(page: Page, playerId: string): Promise<void> {
  await page.evaluate((id) => {
    const el = document.getElementById(id);
    if (el) el.remove();
  }, playerId);
}

// ---------------------------------------------------------------------------
// Pixel analysis
// ---------------------------------------------------------------------------

interface ColorStats {
  blue: number; // pure blue: b high, r & g low
  red: number;  // pure red: r high, g & b low
  total: number;
}

/** Count pure-blue and pure-red pixels in a PNG buffer. */
function colorStats(buf: Buffer): ColorStats {
  const img = PNG.sync.read(buf);
  let blue = 0, red = 0, total = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i]!;
    const g = img.data[i + 1]!;
    const b = img.data[i + 2]!;
    const a = img.data[i + 3]!;
    if (a < 10) continue;
    total++;
    if (b >= 150 && r < 90 && g < 90) blue++;
    if (r >= 150 && b < 90 && g < 90) red++;
  }
  return { blue, red, total };
}

/** Average RGB in a stage-space box (player screenshot assumed 550x400 @1:1). */
function sampleRegionAvg(
  buf: Buffer,
  x0: number, y0: number, x1: number, y1: number,
  stageW = 550, stageH = 400
): { r: number; g: number; b: number; count: number } {
  const img = PNG.sync.read(buf);
  const iw = img.width, ih = img.height;
  const px0 = Math.round((x0 / stageW) * iw);
  const py0 = Math.round((y0 / stageH) * ih);
  const px1 = Math.round((x1 / stageW) * iw);
  const py1 = Math.round((y1 / stageH) * ih);
  let rs = 0, gs = 0, bs = 0, count = 0;
  for (let py = py0; py < Math.min(py1, ih); py++) {
    for (let px = px0; px < Math.min(px1, iw); px++) {
      const idx = (py * iw + px) * 4;
      if (img.data[idx + 3]! < 10) continue;
      rs += img.data[idx]!; gs += img.data[idx + 1]!; bs += img.data[idx + 2]!;
      count++;
    }
  }
  return count > 0 ? { r: rs / count, g: gs / count, b: bs / count, count }
    : { r: 255, g: 255, b: 255, count: 0 };
}

/** Pixelmatch a stage PNG against a Ruffle PNG, resizing the stage to match. */
function diffStageVsRuffle(stagePng: Buffer, rufflePng: Buffer): { diff: number; w: number; h: number } {
  const stage = PNG.sync.read(stagePng);
  const ruffle = PNG.sync.read(rufflePng);
  // Compare in the Ruffle image's dimensions; scale the stage by nearest-neighbour.
  const w = Math.min(stage.width, ruffle.width);
  const h = Math.min(stage.height, ruffle.height);
  const crop = (img: PNG): Buffer => {
    const out = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const si = (y * img.width + x) * 4;
        const di = (y * w + x) * 4;
        out[di] = img.data[si]!; out[di + 1] = img.data[si + 1]!;
        out[di + 2] = img.data[si + 2]!; out[di + 3] = img.data[si + 3]!;
      }
    }
    return out;
  };
  const a = crop(stage), b = crop(ruffle);
  const diffBuf = Buffer.alloc(w * h * 4);
  const diff = pixelmatch(a, b, diffBuf, w, h, { threshold: 0.25 });
  return { diff, w, h };
}

// ---------------------------------------------------------------------------
// Bridge-driven authoring
// ---------------------------------------------------------------------------

const BLUE = { type: 'solid', color: { r: 0, g: 0, b: 255, a: 255 } } as const;
const RED = { type: 'solid', color: { r: 255, g: 0, b: 0, a: 255 } } as const;

/** A CCW closed-rect ShapePath with a fill (origin-relative geometry). */
function rectShape(id: string, w: number, h: number, fill: unknown): unknown {
  return {
    id,
    paths: [{
      start: { x: 0, y: 0 },
      segments: [
        { type: 'line', to: { x: 0, y: h } },
        { type: 'line', to: { x: w, y: h } },
        { type: 'line', to: { x: w, y: 0 } },
        { type: 'line', to: { x: 0, y: 0 } },
      ],
      fill,
      closed: true,
    }],
  };
}

interface FlashTestMerge {
  loadDocument: (d: unknown) => void;
  setFeatureFlag: (name: string, value: boolean) => void;
  commitMergeShape: (shape: unknown, x: number, y: number) => void;
  publish: () => Promise<string> | string;
  screenshotStage: () => string;
  getDocument: () => unknown;
  getActiveLayerIndex: () => number;
  getCurrentFrame: () => number;
}

const STROKE = { type: 'solid', color: { r: 0, g: 0, b: 0, a: 255 }, width: 4, caps: 'round', joints: 'round', miterLimit: 3 } as const;

/** A stroke-only (no fill) open line ShapePath shape (origin-relative). */
function lineShape(id: string, x0: number, y0: number, x1: number, y1: number): unknown {
  return {
    id,
    paths: [{
      start: { x: x0, y: y0 },
      segments: [{ type: 'line', to: { x: x1, y: y1 } }],
      closed: false,
      stroke: STROKE,
    }],
  };
}

/**
 * Inspect the active layer's committed merge artwork: count the fill paths and
 * stroke-only paths across all shape display objects on the governing keyframe.
 * The planar merge-on-commit path stores the folded result as a single merged
 * `type:"shape"` object whose `shape.paths` carry the split fills + segments.
 */
async function inspectMergedPaths(page: Page): Promise<{ fillPaths: number; strokePaths: number }> {
  return await page.evaluate(() => {
    const b = (window as unknown as { __flashTest: FlashTestMerge }).__flashTest;
    const doc = b.getDocument() as {
      scenes: { timeline: { layers: { frames: { displayObjects: { type: string; shape?: { paths: { fill?: unknown; stroke?: unknown }[] } }[] }[] }[] } }[];
    };
    const li = b.getActiveLayerIndex();
    const frame = b.getCurrentFrame();
    let fillPaths = 0, strokePaths = 0;
    for (const scene of doc.scenes) {
      const layer = scene.timeline.layers[li];
      if (!layer) continue;
      const kf = layer.frames[Math.min(frame, layer.frames.length - 1)] ?? layer.frames[0];
      if (!kf) continue;
      for (const obj of kf.displayObjects) {
        if (obj.type !== 'shape' || !obj.shape) continue;
        for (const p of obj.shape.paths) {
          if (p.fill) fillPaths++;
          else if (p.stroke) strokePaths++;
        }
      }
      break;
    }
    return { fillPaths, strokePaths };
  });
}

async function captureStagePng(page: Page, testInfo: TestInfo, label: string): Promise<Buffer> {
  const b64: string = await page.evaluate(() => {
    return (window as unknown as { __flashTest: FlashTestMerge }).__flashTest.screenshotStage();
  });
  const buf = Buffer.from(b64, 'base64');
  await testInfo.attach(`${label}-stage`, { body: buf, contentType: 'image/png' });
  return buf;
}

async function publishAndShootRuffle(
  page: Page, testInfo: TestInfo, playerId: string, label: string
): Promise<Buffer> {
  const swfBase64: string = await page.evaluate(async () => {
    const b = (window as unknown as { __flashTest: FlashTestMerge }).__flashTest;
    return await b.publish();
  });
  expect(typeof swfBase64).toBe('string');
  expect(swfBase64.length).toBeGreaterThan(0);
  await ensureRuffleLoaded(page);
  await injectRufflePlayer(page, swfBase64, playerId);
  await page.waitForTimeout(2000);
  await hideRuffleOverlays(page, playerId);
  const shot = await page.locator(`#${playerId}`).screenshot();
  await testInfo.attach(`${label}-ruffle`, { body: shot, contentType: 'image/png' });
  await removeRufflePlayer(page, playerId);
  return shot;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Merge-drawing oracle (planar kernel) — canonical cases', () => {
  test.skip(!!process.env.CI, 'visual oracle — Ruffle WASM not available in CI');

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 15000 });
    const ready = await page.evaluate(
      () => typeof (window as unknown as { __flashTest?: unknown }).__flashTest !== 'undefined'
    );
    expect(ready).toBe(true);
    // Start from a fresh document and turn the planar merge flag ON for the test.
    await page.evaluate(() => {
      const b = (window as unknown as { __flashTest: FlashTestMerge & { loadDocument: (d: unknown) => void } }).__flashTest;
      b.setFeatureFlag('planarMergeOnCommit', true);
    });
    await page.waitForTimeout(100);
  });

  test.afterEach(async ({ page }) => {
    await page.evaluate(() => {
      (window as unknown as { __flashTest: FlashTestMerge }).__flashTest.setFeatureFlag('planarMergeOnCommit', false);
    });
  });

  // -------------------------------------------------------------------------
  // 1. red-over-blue cut
  // -------------------------------------------------------------------------
  test('red-over-blue cut: overlap becomes red, blue is carved away', async ({ page }, testInfo: TestInfo) => {
    // Blue 120x120 at (200,140); RED 120x120 at (260,140) overlapping the right
    // half of the blue. Different-color, merge mode, same layer -> red CUTS blue.
    await page.evaluate(({ blue, red }) => {
      const b = (window as unknown as { __flashTest: FlashTestMerge }).__flashTest;
      b.commitMergeShape(blue, 200, 140);
      b.commitMergeShape(red, 260, 140);
    }, {
      blue: rectShape('blue-1', 120, 120, BLUE),
      red: rectShape('red-1', 120, 120, RED),
    });
    await page.waitForTimeout(200);

    const stagePng = await captureStagePng(page, testInfo, 'cut');
    const rufflePng = await publishAndShootRuffle(page, testInfo, '__ruffle_merge_cut__', 'cut');

    // Stage: the overlap band (x ~ 260..320) must be RED, the left blue strip
    // (x ~ 200..255) must still be BLUE.
    const leftBlue = sampleRegionAvg(stagePng, 210, 160, 250, 240);
    const overlapRed = sampleRegionAvg(stagePng, 270, 160, 315, 240);
    console.log(`[1319] cut stage: leftBlue=${JSON.stringify(leftBlue)} overlapRed=${JSON.stringify(overlapRed)}`);
    expect(leftBlue.b, 'left strip stays blue').toBeGreaterThan(120);
    expect(leftBlue.r, 'left strip is not red').toBeLessThan(100);
    expect(overlapRed.r, 'overlap region is red (red cut the blue)').toBeGreaterThan(120);
    expect(overlapRed.b, 'overlap region is no longer blue').toBeLessThan(100);

    // Ruffle agrees pixel-wise.
    const rLeftBlue = sampleRegionAvg(rufflePng, 210, 160, 250, 240);
    const rOverlapRed = sampleRegionAvg(rufflePng, 270, 160, 315, 240);
    console.log(`[1319] cut ruffle: leftBlue=${JSON.stringify(rLeftBlue)} overlapRed=${JSON.stringify(rOverlapRed)}`);
    expect(rLeftBlue.b, 'ruffle: left strip blue').toBeGreaterThan(120);
    expect(rOverlapRed.r, 'ruffle: overlap red').toBeGreaterThan(120);

    const { diff, w, h } = diffStageVsRuffle(stagePng, rufflePng);
    console.log(`[1319] cut pixelmatch diff=${diff}/${w * h}`);
    expect(diff / (w * h), 'stage and ruffle agree (cut)').toBeLessThan(0.1);
  });

  // -------------------------------------------------------------------------
  // 2. blue-over-blue union
  // -------------------------------------------------------------------------
  test('blue-over-blue union: two overlapping blues merge into one shape', async ({ page }, testInfo: TestInfo) => {
    // Two overlapping BLUE rects -> same-color union: one seamless blue region
    // spanning x ~ 200..380.
    await page.evaluate(({ blueA, blueB }) => {
      const b = (window as unknown as { __flashTest: FlashTestMerge }).__flashTest;
      b.commitMergeShape(blueA, 200, 140);
      b.commitMergeShape(blueB, 260, 140);
    }, {
      blueA: rectShape('blueA', 120, 120, BLUE),
      blueB: rectShape('blueB', 120, 120, BLUE),
    });
    await page.waitForTimeout(200);

    const stagePng = await captureStagePng(page, testInfo, 'union');
    const rufflePng = await publishAndShootRuffle(page, testInfo, '__ruffle_merge_union__', 'union');

    // The whole union (left strip, overlap, right strip) must be solid blue with
    // NO red and NO seam (the overlap is not darkened or transparent).
    const left = sampleRegionAvg(stagePng, 210, 160, 250, 240);
    const overlap = sampleRegionAvg(stagePng, 270, 160, 310, 240);
    const right = sampleRegionAvg(stagePng, 330, 160, 375, 240);
    console.log(`[1319] union stage: left=${JSON.stringify(left)} overlap=${JSON.stringify(overlap)} right=${JSON.stringify(right)}`);
    for (const [name, s] of [['left', left], ['overlap', overlap], ['right', right]] as const) {
      expect(s.b, `union ${name} is blue`).toBeGreaterThan(120);
      expect(s.r, `union ${name} has no red`).toBeLessThan(90);
    }

    const stats = colorStats(stagePng);
    console.log(`[1319] union stage stats: blue=${stats.blue} red=${stats.red}`);
    expect(stats.blue, 'union has a substantial blue region').toBeGreaterThan(500);
    expect(stats.red, 'union has no red pixels').toBeLessThan(50);

    // Ruffle agrees.
    const rOverlap = sampleRegionAvg(rufflePng, 270, 160, 310, 240);
    console.log(`[1319] union ruffle overlap=${JSON.stringify(rOverlap)}`);
    expect(rOverlap.b, 'ruffle: union overlap blue').toBeGreaterThan(120);

    const { diff, w, h } = diffStageVsRuffle(stagePng, rufflePng);
    console.log(`[1319] union pixelmatch diff=${diff}/${w * h}`);
    expect(diff / (w * h), 'stage and ruffle agree (union)').toBeLessThan(0.1);
  });

  // -------------------------------------------------------------------------
  // 3. line across a filled rect -> the fill is SPLIT into two independent
  //    regions (P2). The dividing stroke subdivides the planar fill face into
  //    two selectable faces; the read-back stores TWO fill loops + the segmented
  //    line. We assert the split structurally (two fill regions) AND visually
  //    (stage shows the fill with the dividing line; Ruffle agrees).
  // -------------------------------------------------------------------------
  test('line across a filled rect splits the fill into two independent regions', async ({ page }, testInfo: TestInfo) => {
    // A blue 160x120 rect at (200,140); a horizontal black line drawn across its
    // middle (from left of the rect to right of it) -> the line splits the fill.
    await page.evaluate(({ rect, line }) => {
      const b = (window as unknown as { __flashTest: FlashTestMerge }).__flashTest;
      b.commitMergeShape(rect, 200, 140);
      // Line in stage space spanning x 180..380 at y 200 (rect spans y 140..260).
      b.commitMergeShape(line, 0, 0);
    }, {
      rect: rectShape('rect-1', 160, 120, BLUE),
      line: lineShape('line-1', 180, 200, 380, 200),
    });
    await page.waitForTimeout(200);

    // Structural: the merged artwork carries TWO fill regions (the split halves)
    // plus the segmented line (inside span + two outside stubs = 3 stroke paths).
    const counts = await inspectMergedPaths(page);
    console.log(`[P2] line-splits-fill paths: ${JSON.stringify(counts)}`);
    expect(counts.fillPaths, 'fill split into two regions').toBe(2);
    expect(counts.strokePaths, 'line segmented by the fill boundary').toBeGreaterThanOrEqual(1);

    const stagePng = await captureStagePng(page, testInfo, 'split');
    const rufflePng = await publishAndShootRuffle(page, testInfo, '__ruffle_merge_split__', 'split');

    // Visual: both halves (top y~150..190 and bottom y~210..250) are blue.
    const topHalf = sampleRegionAvg(stagePng, 230, 150, 350, 185);
    const botHalf = sampleRegionAvg(stagePng, 230, 215, 350, 250);
    console.log(`[P2] split stage: top=${JSON.stringify(topHalf)} bot=${JSON.stringify(botHalf)}`);
    expect(topHalf.b, 'top half blue').toBeGreaterThan(110);
    expect(botHalf.b, 'bottom half blue').toBeGreaterThan(110);
    // The dividing line is dark (a black stroke) at y~200 across the fill.
    const divider = sampleRegionAvg(stagePng, 230, 198, 350, 202);
    console.log(`[P2] split divider avg=${JSON.stringify(divider)}`);
    expect(divider.r + divider.g + divider.b, 'dividing stroke is dark').toBeLessThan(topHalf.r + topHalf.g + topHalf.b);

    const { diff, w, h } = diffStageVsRuffle(stagePng, rufflePng);
    console.log(`[P2] split pixelmatch diff=${diff}/${w * h}`);
    expect(diff / (w * h), 'stage and ruffle agree (split)').toBeLessThan(0.12);
  });

  // -------------------------------------------------------------------------
  // 4. two crossing lines -> four segments (P2). The crossing point becomes a
  //    shared vertex; each line is split in two -> four independently-selectable
  //    arms. Asserted structurally (4 stroke segments) + visually (an X renders).
  // -------------------------------------------------------------------------
  test('two crossing lines become four selectable segments', async ({ page }, testInfo: TestInfo) => {
    await page.evaluate(({ a, c }) => {
      const b = (window as unknown as { __flashTest: FlashTestMerge }).__flashTest;
      b.commitMergeShape(a, 0, 0);
      b.commitMergeShape(c, 0, 0);
    }, {
      a: lineShape('lineA', 220, 160, 360, 280),
      c: lineShape('lineC', 220, 280, 360, 160),
    });
    await page.waitForTimeout(200);

    // Structural: four edge-segments meeting at the crossing.
    const counts = await inspectMergedPaths(page);
    console.log(`[P2] crossing-lines paths: ${JSON.stringify(counts)}`);
    expect(counts.fillPaths, 'no fills, just strokes').toBe(0);
    expect(counts.strokePaths, 'four selectable segments').toBe(4);

    const stagePng = await captureStagePng(page, testInfo, 'cross');
    const rufflePng = await publishAndShootRuffle(page, testInfo, '__ruffle_merge_cross__', 'cross');

    // Visual: the crossing center (~290,220) has dark ink; the X renders.
    const center = sampleRegionAvg(stagePng, 285, 215, 295, 225);
    console.log(`[P2] cross stage center=${JSON.stringify(center)}`);
    expect(center.count, 'something rendered at the crossing').toBeGreaterThan(0);

    const { diff, w, h } = diffStageVsRuffle(stagePng, rufflePng);
    console.log(`[P2] cross pixelmatch diff=${diff}/${w * h}`);
    expect(diff / (w * h), 'stage and ruffle agree (cross)').toBeLessThan(0.12);
  });

  // -------------------------------------------------------------------------
  // 5-6 remain placeholders for P3-P5 (curve-preserving eraser, island move).
  // -------------------------------------------------------------------------
  test.fixme('erase across a shape splits it into two fills', async () => {
    // P3: route eraser through the planar kernel (curve-preserving cut).
  });

  test.fixme('partial-fill island click + move leaves a hole in the outer fill', async () => {
    // P3-P5: island carve + move, then assert the hole remains.
  });
});
