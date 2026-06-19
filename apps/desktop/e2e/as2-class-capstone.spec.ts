/**
 * AS2 classes (Phase 5) — CAPSTONE end-to-end oracle.
 *
 * Unlike the P1 oracle (`as2-class-attach.spec.ts`), which builds the document
 * programmatically, this capstone drives the **real authoring UI** for the two
 * P5 deliverables and then verifies runtime behaviour in the real Ruffle player:
 *
 *   1. AUTHOR the `.as` class through the Classes panel (the web/OPFS authoring
 *      surface): open the Classes tab → "＋ New" → name it `com.example.Ball`
 *      → type the class source (a `speak()` method that `trace()`s) into the
 *      reused ScriptEditor. The class is persisted into `doc.asClasses`.
 *   2. LINK the class to a library MovieClip through the Symbol Linkage dialog
 *      (right-click the library symbol → Linkage… → Export for ActionScript →
 *      Identifier "BallLinkage" → AS2 Class via the new autocomplete sourced
 *      from `doc.asClasses` → OK). This sets `SymbolLinkage.className`.
 *   3. PUBLISH via the real publish flow and load the SWF in the bundled Ruffle
 *      player; assert the attached instance's `speak()` trace arrives via the
 *      same trace observer the Output panel uses (task 1259).
 *
 * A base document (the MovieClip symbol + a frame-1 attach script) is seeded via
 * the `__flashTest.loadDocument` bridge; everything class/linkage-related — the
 * P5 scope — is driven through the actual UI.
 */

import { test, expect, Page } from '@playwright/test';

const SPEAK_MESSAGE = 'ball speaks via UI-authored class';

const BALL_CLASS_SOURCE =
  'class com.example.Ball extends MovieClip {\n' +
  '  function Ball() {}\n' +
  `  function speak():Void { trace("${SPEAK_MESSAGE}"); }\n` +
  '}\n';

// ---------------------------------------------------------------------------
// Ruffle trace-observer harness (mirrors as2-class-attach.spec.ts)
// ---------------------------------------------------------------------------

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

async function collectTracesViaObserver(
  page: Page,
  swfBase64: string,
  playerId: string,
  settleMs: number
): Promise<string[]> {
  return page.evaluate(async ({ b64, id, settle }) => {
    type RuffleHandle = { createPlayer(): RufflePlayerEl };
    type RufflePlayerEl = HTMLElement & {
      traceObserver?: ((message: string) => void) | null;
      ruffle(): {
        load(opts: {
          data?: Uint8Array;
          allowScriptAccess?: boolean;
          autoplay?: string;
          unmuteOverlay?: string;
          logLevel?: string;
        }): Promise<void>;
      };
    };
    const ruffleApi = (window as unknown as {
      RufflePlayer: { newest(): RuffleHandle };
    }).RufflePlayer.newest();
    const player = ruffleApi.createPlayer();
    player.id = id;
    player.style.cssText = 'position:fixed;top:0;left:0;width:550px;height:400px;';
    document.body.appendChild(player);

    const traces: string[] = [];
    const observer = (message: string) => { traces.push(message); };
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const loadPromise = player.ruffle().load({
      data: bytes,
      allowScriptAccess: true,
      autoplay: 'on',
      unmuteOverlay: 'hidden',
      logLevel: 'info',
    });
    player.traceObserver = observer;
    await loadPromise;
    player.traceObserver = observer;
    await new Promise<void>((r) => setTimeout(r, settle));
    player.remove();
    return traces;
  }, { b64: swfBase64, id: playerId, settle: settleMs });
}

// ---------------------------------------------------------------------------
// Base document: a MovieClip "Ball" + a frame-1 attach/speak script.
// The class + linkage are authored through the UI in the test body.
// ---------------------------------------------------------------------------

function emptyTimeline(idPrefix: string, isEmpty: boolean, script: string) {
  return {
    layers: [{
      id: `${idPrefix}-layer`, name: 'Layer 1', type: 'normal', visible: true,
      locked: false, outlineMode: false, outlineColor: '#ff0000', height: 20,
      parentFolderId: null, frameCount: 1,
      frames: [{
        index: 0, isKeyframe: true, isEmpty, tweenType: 'none', label: '', labelType: 'name',
        script, sound: null, motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
        motionOrientToPath: false, motionSync: false, motionScale: false,
        shapeEase: 0, shapeBlend: 'distributive', displayObjects: [],
      }],
    }],
  };
}

function makeBaseDoc() {
  const frameScript =
    '_root.attachMovie("BallLinkage", "myBall", 1);\n' +
    '_root.myBall.speak();';
  return {
    id: 'as2-capstone-doc',
    properties: {
      width: 550, height: 400, frameRate: 12, backgroundColor: '#ffffff', rulerUnits: 'px',
      grid: { showGrid: false, snapToGrid: false, gridColor: '#999999', gridWidth: 18, gridHeight: 18 },
      guides: [], snapToObjects: false, snapToPixels: false, snapToGuides: false,
    },
    scenes: [{ id: 'scene-1', name: 'Scene 1', timeline: emptyTimeline('scene', false, frameScript) }],
    library: {
      items: [{
        id: 'sym-ball', name: 'Ball', itemType: 'symbol', symbolType: 'movieclip',
        timeline: emptyTimeline('sym-ball', true, ''),
        linkage: {
          // No linkage yet — set through the dialog UI below.
          exportForActionScript: false, exportForRuntimeSharing: false,
          linkageIdentifier: '', className: '', importForRuntimeSharing: false,
          sharedUrl: '', exportInFirstFrame: true,
        },
        scale9Grid: null,
      }],
      folders: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('AS2 class capstone — author via UI, link, publish, run (task 1303)', () => {
  test.skip(!!process.env.CI, 'runtime oracle — Ruffle WASM not available in CI');

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 15000 });
    const ready = await page.evaluate(
      () => typeof (window as unknown as { __flashTest?: unknown }).__flashTest !== 'undefined'
    );
    expect(ready).toBe(true);
  });

  test('UI-authored class linked via the dialog runs at runtime (trace appears)', async ({ page }) => {
    // --- Seed the base document (MovieClip + attach script) ------------------
    await page.evaluate((d) => {
      (window as unknown as { __flashTest: { loadDocument: (x: unknown) => void } })
        .__flashTest.loadDocument(d);
    }, makeBaseDoc());
    await page.waitForTimeout(300);

    // --- 1) AUTHOR the .as class through the Classes panel -------------------
    await page.getByRole('tab', { name: 'Classes' }).click();
    await expect(page.getByTestId('classes-panel')).toBeVisible();

    await page.getByTestId('class-add').click();
    const newInput = page.getByTestId('class-new-input');
    await newInput.fill('com.example.Ball');
    await newInput.press('Enter');

    // The new class opens in the reused ScriptEditor; type the class source.
    const editor = page.getByTestId('script-editor-textarea');
    await expect(editor).toBeVisible();
    await editor.click();
    await editor.fill(BALL_CLASS_SOURCE);
    // The ScriptEditor flushes to doc.asClasses on a 600ms debounce; wait it out.
    await page.waitForTimeout(900);

    // Confirm the class source landed in the document model (the web/OPFS VFS
    // syncs the .as file into doc.asClasses on a debounce).
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const cls = (window as unknown as {
            __flashTest: { getDocument?: () => { asClasses?: Array<{ source: string }> } };
          }).__flashTest.getDocument?.()?.asClasses;
          return cls?.find((c) => c.source.includes('speak'))?.source ?? '';
        })
      , { timeout: 5000 })
      .toContain('speak');

    // --- 2) LINK via the Symbol Linkage dialog ------------------------------
    // Open the Library (right tab is already library by default in Shell). The
    // symbol row exposes a testid; right-click → Linkage…
    const row = page.getByTestId('library-item-Ball');
    await expect(row).toBeVisible();
    await row.click({ button: 'right' });
    await page.getByTestId('library-menu-linkage').click();

    const dialog = page.getByTestId('symbol-linkage-dialog');
    await expect(dialog).toBeVisible();
    await page.getByTestId('symbol-linkage-export').check();
    await page.getByTestId('symbol-linkage-identifier').fill('BallLinkage');
    // The AS2 Class field is fed by the autocomplete datalist sourced from
    // doc.asClasses; typing the value directly is equivalent to picking it.
    await page.getByTestId('symbol-linkage-classname').fill('com.example.Ball');
    await page.getByTestId('symbol-linkage-ok').click();
    await expect(dialog).toBeHidden();
    await page.waitForTimeout(150);

    // --- 3) PUBLISH + verify in Ruffle --------------------------------------
    const swfBase64: string = await page.evaluate(async () =>
      (window as unknown as { __flashTest: { publish: () => Promise<string> } })
        .__flashTest.publish()
    );
    expect(typeof swfBase64).toBe('string');
    expect(swfBase64.length).toBeGreaterThan(0);

    await ensureRuffleLoaded(page);
    const traces = await collectTracesViaObserver(page, swfBase64, 'as2-capstone-player', 3000);

    expect(
      traces,
      `expected trace ${JSON.stringify(SPEAK_MESSAGE)}, got ${JSON.stringify(traces)}`
    ).toContain(SPEAK_MESSAGE);
  });
});
