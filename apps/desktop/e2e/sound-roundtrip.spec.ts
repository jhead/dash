/**
 * Sound publish E2E oracle (task 0772): prove that a SWF with StartSound and
 * envelope data loads cleanly in Ruffle without panic or blank-screen.
 *
 * Per CLAUDE.md: "byte-presence unit tests are not runtime proof." The
 * existing sound.test.ts confirms DefineSound (tag 14) and StartSound (tag 15)
 * are emitted with correct byte layout. This suite adds the runtime gate:
 * a Ruffle player must load the SWF, render a visible first frame, and show
 * no panic overlay. Audio output is not asserted (headless Ruffle has no audio
 * device); we only verify Ruffle does not crash when sound tags are present.
 *
 * Three tests:
 *
 *   1. Basic StartSound: single SoundItem + frame sound → Ruffle loads, non-blank.
 *
 *   2. Envelope data: SoundItem with inPoint, outPoint, and two custom envelope
 *      points → Ruffle loads without panic (validates SoundInfo struct encoding).
 *
 *   3. Event-sound with effect preset (fadeIn): validates effectToEnvelope
 *      expansion compiles into a valid SWF that Ruffle accepts.
 *
 * The test uses a 44-byte silent WAV as the audio data URI. Ruffle is expected
 * to decode it or silently skip it — either way the SWF must not panic.
 *
 * Tiny silent WAV (RIFF, 44-byte header, 0 sample bytes):
 *   UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=
 *
 * Run locally:
 *   pnpm --filter @flash/desktop e2e --grep "sound round"
 *   cd apps/desktop && npx playwright test e2e/sound-roundtrip.spec.ts
 */

import { test, expect, TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';

// ---------------------------------------------------------------------------
// A 44-byte silent PCM WAV (RIFF header only, 0 audio samples).
// Raw audio (compressionType "raw") is the simplest format — no codec parsing.
// We use "raw" so that even if the decoder rejects the format bits, Ruffle will
// not crash (it just skips playback). The WAV header bytes are embedded as
// base64 so no file-system dependency is needed.
//
// Header structure:
//   RIFF chunk:  52 49 46 46  24 00 00 00  57 41 56 45
//   fmt  chunk:  66 6d 74 20  10 00 00 00  01 00 01 00  44 AC 00 00  88 58 01 00  02 00  10 00
//   data chunk:  64 61 74 61  00 00 00 00
// ---------------------------------------------------------------------------
const SILENT_WAV_BASE64 = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
const SILENT_WAV_DATA_URI = `data:audio/wav;base64,${SILENT_WAV_BASE64}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Page = Parameters<Parameters<typeof test>[1]>[0];

/** Ensure ruffle.js is loaded in the page (idempotent). */
async function ensureRuffleLoaded(page: Page): Promise<void> {
  await page.evaluate(() => {
    return new Promise<void>((resolve, reject) => {
      if ((window as Window & typeof globalThis).RufflePlayer) { resolve(); return; }
      const existing = document.querySelector<HTMLScriptElement>('script[data-ruffle]');
      if (existing) {
        if ((window as Window & typeof globalThis).RufflePlayer) { resolve(); return; }
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

/** Inject a Ruffle player element, load the SWF bytes, and wait for first render. */
async function injectRufflePlayer(page: Page, swfBase64: string, playerId: string): Promise<void> {
  await page.evaluate(({ b64, id }) => {
    type RuffleHandle = { createPlayer(): RufflePlayerEl };
    type RufflePlayerEl = HTMLElement & {
      ruffle(): { load(opts: {
        data?: Uint8Array;
        allowScriptAccess?: boolean;
        autoplay?: string;
        unmuteOverlay?: string;
      }): Promise<void> };
    };
    const ruffleApi = (window as unknown as { RufflePlayer: { newest(): RuffleHandle } }).RufflePlayer.newest();
    const player = ruffleApi.createPlayer() as RufflePlayerEl;
    player.id = id;
    // Must be on-screen (top:0; left:0) for Chromium to composite correctly.
    player.style.cssText = 'position:fixed;top:0;left:0;width:550px;height:400px;z-index:99999;';
    document.body.appendChild(player);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    // autoplay:'on' forces play() without a user-gesture audio context.
    // unmuteOverlay:'hidden' suppresses the audio unmute overlay dimming backdrop.
    void player.ruffle().load({
      data: bytes,
      allowScriptAccess: true,
      autoplay: 'on',
      unmuteOverlay: 'hidden',
    });
  }, { b64: swfBase64, id: playerId });
}

/** Recursively hide Ruffle's overlay chrome (hardware-accel warning, panic overlay etc.). */
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

/** Check if a "panic" overlay is visible inside the Ruffle player's shadow DOM. */
async function hasRufflePanic(page: Page, playerId: string): Promise<boolean> {
  return page.evaluate((id) => {
    const root = document.getElementById(id) as (HTMLElement & { shadowRoot?: ShadowRoot }) | null;
    const sr = root?.shadowRoot;
    if (!sr) return false;
    let found = false;
    const walk = (node: ParentNode) => {
      node.querySelectorAll('*').forEach((elem) => {
        const e = elem as HTMLElement & { shadowRoot?: ShadowRoot };
        const sig = `${e.id} ${e.className}`.toLowerCase();
        if (/panic/.test(sig)) {
          const style = getComputedStyle(e);
          if (style.display !== 'none' && style.visibility !== 'hidden') {
            found = true;
          }
        }
        if (e.shadowRoot) walk(e.shadowRoot);
      });
    };
    walk(sr);
    return found;
  }, playerId);
}

/** Remove the Ruffle player from the DOM. */
async function removeRufflePlayer(page: Page, playerId: string): Promise<void> {
  await page.evaluate((id) => {
    const el = document.getElementById(id);
    if (el) el.remove();
  }, playerId);
}

/**
 * Count pixels that differ significantly from pure white (255, 255, 255).
 * Returns the number of "non-white" pixels (where any channel is below 240).
 */
function countNonWhitePixels(buf: Buffer): number {
  const img = PNG.sync.read(buf);
  let nonWhite = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i]!;
    const g = img.data[i + 1]!;
    const b = img.data[i + 2]!;
    const a = img.data[i + 3]!;
    if (a < 10) continue; // skip transparent
    // "White" means all channels >= 240; anything else is non-white
    if (r < 240 || g < 240 || b < 240) nonWhite++;
  }
  return nonWhite;
}

/** Count red pixels (high R, low G+B). */
function countRedPixels(buf: Buffer): number {
  const img = PNG.sync.read(buf);
  let red = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i]!;
    const g = img.data[i + 1]!;
    const b = img.data[i + 2]!;
    const a = img.data[i + 3]!;
    if (a < 10) continue;
    if (r > 180 && g < 80 && b < 80) red++;
  }
  return red;
}

// ---------------------------------------------------------------------------
// Document fixture builders
// ---------------------------------------------------------------------------

/**
 * A solid 100×100 filled rectangle at stage centre (225,150)–(325,250).
 * Used to provide a visible colour on the stage for non-blank assertions.
 */
function makeCenteredRect(id: string, r: number, g: number, b: number) {
  return {
    id, type: 'shape',
    shape: {
      id: `shape-${id}`,
      paths: [{
        start: { x: 225, y: 150 },
        segments: [
          { type: 'line', to: { x: 325, y: 150 } },
          { type: 'line', to: { x: 325, y: 250 } },
          { type: 'line', to: { x: 225, y: 250 } },
        ],
        closed: true,
        fill: { type: 'solid', color: { r, g, b, a: 255 } },
      }],
    },
    x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
  };
}

/**
 * Build a minimal 1-frame FlashDocument with:
 *   - A SoundItem in the library (using the silent WAV data URI)
 *   - A StartSound frame event on frame 0 (links to that SoundItem)
 *   - A red rectangle on frame 0 (so the stage is non-blank)
 *
 * The opts.soundLinkage field controls what SoundLinkage is applied to frame 0,
 * allowing tests to exercise event/start sync modes and envelope options.
 */
function makeSoundDoc(opts: {
  docId: string;
  soundId: string;
  soundLinkage: {
    syncMode: 'event' | 'start' | 'stop';
    repeatCount: number;
    effect?: string;
    customEnvelope?: Array<{ pos44: number; leftLevel: number; rightLevel: number }>;
    inPoint?: number;
    outPoint?: number;
  };
}): unknown {
  const { docId, soundId, soundLinkage } = opts;

  return {
    id: docId,
    properties: {
      width: 550, height: 400, frameRate: 12,
      backgroundColor: '#ffffff', rulerUnits: 'px',
      grid: { showGrid: false, snapToGrid: false, gridColor: '#999999', gridWidth: 18, gridHeight: 18 },
      guides: [], snapToObjects: false, snapToPixels: false, snapToGuides: false,
    },
    scenes: [{
      id: 'scene-1', name: 'Scene 1',
      timeline: {
        layers: [{
          id: `${docId}-layer`, name: 'Layer 1', type: 'normal',
          visible: true, locked: false, outlineMode: false,
          outlineColor: '#ff0000', height: 20, parentFolderId: null,
          frameCount: 1,
          frames: [{
            index: 0, isKeyframe: true, isEmpty: false, tweenType: 'none',
            label: '', labelType: 'name', script: 'stop();',
            // Frame sound: triggers StartSound (tag 15) in the compiled SWF
            sound: {
              libraryItemId: soundId,
              syncMode: soundLinkage.syncMode,
              repeatCount: soundLinkage.repeatCount,
              ...(soundLinkage.effect !== undefined ? { effect: soundLinkage.effect } : {}),
              ...(soundLinkage.customEnvelope !== undefined ? { customEnvelope: soundLinkage.customEnvelope } : {}),
              ...(soundLinkage.inPoint !== undefined ? { inPoint: soundLinkage.inPoint } : {}),
              ...(soundLinkage.outPoint !== undefined ? { outPoint: soundLinkage.outPoint } : {}),
            },
            motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
            motionOrientToPath: false, motionSync: false, motionScale: false,
            shapeEase: 0, shapeBlend: 'distributive',
            // Red rectangle so the stage is visibly non-blank
            displayObjects: [makeCenteredRect(`${docId}-red`, 255, 0, 0)],
          }],
        }],
      },
    }],
    library: {
      items: [{
        id: soundId,
        name: 'test-sound.wav',
        itemType: 'sound',
        // Using raw PCM so the flags byte is (3<<4)|(3<<2)|(1<<1)|0 = 0x3E (44kHz, 16-bit, mono)
        // but the actual audio bytes are a 44-byte WAV header with 0 samples.
        // Ruffle may reject decoding the WAV payload, but must not panic.
        dataUri: SILENT_WAV_DATA_URI,
        compressionType: 'raw',
        sampleRate: 44100,
        sampleSize: 16,
        isStereo: false,
        durationSeconds: 0,
      }],
      folders: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Oracle runner
// ---------------------------------------------------------------------------

/**
 * Shared Ruffle loading oracle for sound tests.
 *
 * Loads the SWF in a Ruffle player, waits for first render, then asserts:
 *   1. No panic overlay is visible.
 *   2. The screenshot is non-blank (has non-white pixels — the red rect).
 */
async function runSoundLoadOracle(opts: {
  page: Page;
  testInfo: TestInfo;
  swfBase64: string;
  playerId: string;
  label: string;
}): Promise<void> {
  const { page, testInfo, swfBase64, playerId, label } = opts;

  await ensureRuffleLoaded(page);
  await injectRufflePlayer(page, swfBase64, playerId);

  // Wait for Ruffle to render the first frame
  await page.waitForTimeout(2000);

  // Check panic BEFORE hiding overlays (panic overlay must be visible if present)
  const panic = await hasRufflePanic(page, playerId);
  console.log(`[0772] ${label}: panic=${panic}`);

  await hideRuffleOverlays(page, playerId);

  const shot = await page.locator(`#${playerId}`).screenshot();
  await testInfo.attach(`${label}-screenshot`, { body: shot, contentType: 'image/png' });

  const nonWhite = countNonWhitePixels(shot);
  const red = countRedPixels(shot);
  console.log(`[0772] ${label}: nonWhitePixels=${nonWhite} redPixels=${red}`);

  await removeRufflePlayer(page, playerId);

  // Assert 1: no Ruffle panic
  expect(panic, `${label}: Ruffle must not show a panic overlay`).toBe(false);

  // Assert 2: stage is non-blank (red rect visible)
  // 100×100 rect = 10000 pixels; require at least 500 to account for player
  // scaling and anti-aliasing at the Ruffle/Playwright 550×400 viewport.
  expect(nonWhite, `${label}: stage must be non-blank (has red rect)`).toBeGreaterThan(500);

  // Assert 3: red pixels confirm the rect is actually rendered (not just a gray bg)
  expect(red, `${label}: red rectangle must be visible`).toBeGreaterThan(200);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Sound publish E2E oracle: StartSound loads cleanly in Ruffle (task 0772)', () => {
  test.skip(!!process.env.CI, 'visual oracle — Ruffle WASM not available in CI');

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 15000 });
    const bridgeReady = await page.evaluate(
      () => typeof (window as unknown as { __flashTest?: unknown }).__flashTest !== 'undefined'
    );
    expect(bridgeReady).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 1: Basic StartSound — event sync mode, no envelope
  //
  // Proves: DefineSound (tag 14) + StartSound (tag 15) with a minimal SoundInfo
  // (flags=0x00, no envelope/loop/inpoint) round-trips without Ruffle panicking.
  // -------------------------------------------------------------------------
  test('StartSound (event sync) compiles and loads without panic — stage is non-blank', async ({ page }, testInfo: TestInfo) => {
    const doc = makeSoundDoc({
      docId: 'sound-basic-doc',
      soundId: 'sound-item-basic',
      soundLinkage: {
        syncMode: 'event',
        repeatCount: 1,
        effect: 'none',
      },
    });

    await page.evaluate((d) => {
      (window as unknown as { __flashTest: { loadDocument: (x: unknown) => void } }).__flashTest.loadDocument(d);
    }, doc);
    await page.waitForTimeout(300);

    const swfBase64: string = await page.evaluate(() => {
      return (window as unknown as { __flashTest: { publish: () => string } }).__flashTest.publish();
    });

    expect(typeof swfBase64).toBe('string');
    expect(swfBase64.length).toBeGreaterThan(0);

    await runSoundLoadOracle({
      page, testInfo,
      swfBase64,
      playerId: '__ruffle_sound_basic__',
      label: 'basic-startsound',
    });
  });

  // -------------------------------------------------------------------------
  // Test 2: Envelope encoding — custom inPoint, outPoint, and two envelope points
  //
  // Proves: SoundInfo struct with hasInPoint + hasOutPoint + hasEnvelope flags
  // encodes correctly. This exercises the full SoundInfo byte layout (flags,
  // InPoint UI32, OutPoint UI32, EnvelopeCount UI8, two envelope points).
  // If any field is misaligned Ruffle will reject the tag silently or panic.
  // -------------------------------------------------------------------------
  test('StartSound with custom envelope (inPoint/outPoint/envPoints) compiles and loads without panic', async ({ page }, testInfo: TestInfo) => {
    const doc = makeSoundDoc({
      docId: 'sound-envelope-doc',
      soundId: 'sound-item-envelope',
      soundLinkage: {
        syncMode: 'event',
        repeatCount: 1,
        inPoint: 0,
        outPoint: 44100,
        customEnvelope: [
          { pos44: 0,     leftLevel: 0,     rightLevel: 0 },
          { pos44: 44100, leftLevel: 32768, rightLevel: 32768 },
        ],
      },
    });

    await page.evaluate((d) => {
      (window as unknown as { __flashTest: { loadDocument: (x: unknown) => void } }).__flashTest.loadDocument(d);
    }, doc);
    await page.waitForTimeout(300);

    const swfBase64: string = await page.evaluate(() => {
      return (window as unknown as { __flashTest: { publish: () => string } }).__flashTest.publish();
    });

    expect(typeof swfBase64).toBe('string');
    expect(swfBase64.length).toBeGreaterThan(0);

    await runSoundLoadOracle({
      page, testInfo,
      swfBase64,
      playerId: '__ruffle_sound_envelope__',
      label: 'envelope-startsound',
    });
  });

  // -------------------------------------------------------------------------
  // Test 3: Effect preset (fadeIn) — validates effectToEnvelope expansion
  //
  // Proves: a frame sound with effect:'fadeIn' expands into two SoundEnvelope
  // points (silence→full over 44100 samples) and the resulting SoundInfo struct
  // is accepted by Ruffle without crashing.
  // -------------------------------------------------------------------------
  test('StartSound with fadeIn effect preset compiles and loads without panic', async ({ page }, testInfo: TestInfo) => {
    const doc = makeSoundDoc({
      docId: 'sound-fadein-doc',
      soundId: 'sound-item-fadein',
      soundLinkage: {
        syncMode: 'event',
        repeatCount: 1,
        effect: 'fadeIn',
      },
    });

    await page.evaluate((d) => {
      (window as unknown as { __flashTest: { loadDocument: (x: unknown) => void } }).__flashTest.loadDocument(d);
    }, doc);
    await page.waitForTimeout(300);

    const swfBase64: string = await page.evaluate(() => {
      return (window as unknown as { __flashTest: { publish: () => string } }).__flashTest.publish();
    });

    expect(typeof swfBase64).toBe('string');
    expect(swfBase64.length).toBeGreaterThan(0);

    await runSoundLoadOracle({
      page, testInfo,
      swfBase64,
      playerId: '__ruffle_sound_fadein__',
      label: 'fadein-startsound',
    });
  });
});
