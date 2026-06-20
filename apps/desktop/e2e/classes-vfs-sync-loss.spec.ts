/**
 * RUNTIME PROOF for task 1317 — ClassesPanel VFS->doc.asClasses data-loss fix.
 *
 * Per [[qa-adversarial-persistence-testing]] the loss must be PROVEN gone, not
 * reasoned about. The pre-fix bug: class edits were reconciled into
 * `doc.asClasses` only on a 600ms debounce, so anything that compiles/persists
 * off `doc.asClasses` (Publish / Test Movie / Live Preview / autosave) within
 * that window read the STALE pre-edit source.
 *
 * These tests drive the REAL ClassesPanel editor on :1420, type a marker into a
 * class, and IMMEDIATELY (no manual wait, no flush) trigger the lossy action,
 * asserting the EDITED source — not the stale one — is what gets used/persisted:
 *   (a) publish() right after a keystroke -> SWF bytes carry the edited source
 *   (b) getDocument().asClasses right after a keystroke -> edited source
 *   (c) tab-close (Classes tab collapse = panel unmount) keeps the edited source
 *   (d) autosave -> reload -> the restored doc carries the edited source
 *
 * No Ruffle needed: we assert on the published SWF bytes (the class source is a
 * string constant in the emitted DoInitAction) and on the in-memory doc.
 */
import { test, expect, Page } from '@playwright/test';
import { inflateSync } from 'node:zlib';

const STALE = 'STALE_V1_DO_NOT_PERSIST';
const EDITED = 'EDITED_V2_MUST_PERSIST';

interface FlashBridge {
  loadDocument: (doc: unknown) => void;
  getDocument: () => {
    asClasses?: Array<{ path: string; source: string }>;
    [k: string]: unknown;
  };
  publish: () => Promise<string>; // base64 SWF
  saveProjectAs: (name: string) => Promise<void> | void;
  flushAutosave: () => Promise<void> | void;
  getActiveProjectName: () => string | null;
}

declare global {
  interface Window {
    __flashTest?: FlashBridge;
  }
}

async function gotoEditor(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__flashTest, null, { timeout: 20000 });
}

/**
 * Open the Classes tab, select the Marker class, return when its source loads.
 * Seeds by taking the live (valid `createDocument()`) doc and injecting one
 * self-contained AS2 class carrying the STALE marker — building a doc by hand is
 * fragile (e.g. `library` shape), so we mutate the real one.
 */
async function openMarkerInClassesPanel(page: Page): Promise<void> {
  await page.evaluate((markers) => {
    const ft = window.__flashTest!;
    const base = ft.getDocument();
    const doc = {
      ...base,
      asClasses: [
        {
          path: 'com/example/Marker.as',
          source: `class com.example.Marker {\n  public function tag():String { return "${markers.stale}"; }\n}\n`,
        },
      ],
    };
    ft.loadDocument(doc);
  }, { stale: STALE });
  // Click the "Classes" bottom-dock tab.
  await page.getByRole('tab', { name: 'Classes' }).click();
  await expect(page.getByTestId('classes-panel')).toBeVisible();
  // Select the Marker.as file.
  await page.getByTestId('class-file-com/example/Marker.as').click();
  const ta = page.getByTestId('script-editor-textarea');
  await expect(ta).toBeVisible();
  // Wait for the stale source to actually load into the editor.
  await expect(ta).toContainText(STALE, { timeout: 5000 });
}

/**
 * Replace the editor contents with an EDITED source carrying the EDITED marker,
 * via a single input event (the panel folds synchronously on change). Returns
 * immediately — NO debounce wait — so callers prove the lossy action sees it.
 */
async function typeEditedSource(page: Page): Promise<void> {
  const ta = page.getByTestId('script-editor-textarea');
  const edited = `class com.example.Marker {\n  public function tag():String { return "${EDITED}"; }\n}\n`;
  await ta.focus();
  // Select-all + type so React's onChange fires with the full edited body.
  await ta.fill(edited);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = Buffer.from(b64, 'base64');
  return new Uint8Array(bin);
}

/** Inflate a CWS (zlib) SWF body so we can grep the AVM1 string constants. */
function decompressSwfBody(bytes: Uint8Array): Uint8Array {
  const sig = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
  if (sig === 'FWS') return bytes;
  if (sig === 'CWS') {
    const body = inflateSync(Buffer.from(bytes.slice(8)));
    return new Uint8Array(body);
  }
  // ZWS/LZMA — not expected with default publish settings.
  return bytes;
}

function bytesContainAscii(bytes: Uint8Array, needle: string): boolean {
  const hay = Buffer.from(bytes).toString('latin1');
  return hay.includes(needle);
}

test.describe('task 1317 — ClassesPanel VFS->doc sync data-loss (runtime proof)', () => {
  test('(a) publish() IMMEDIATELY after an edit emits the EDITED class source, not the stale one', async ({ page }) => {
    await gotoEditor(page);
    await openMarkerInClassesPanel(page);

    await typeEditedSource(page);
    // NO wait — publish right away (the lossy window pre-fix).
    const b64 = await page.evaluate(() => window.__flashTest!.publish());
    const swf = decompressSwfBody(b64ToBytes(b64));

    expect(bytesContainAscii(swf, EDITED)).toBe(true);
    expect(bytesContainAscii(swf, STALE)).toBe(false);
  });

  test('(b) getDocument().asClasses reflects the edit synchronously (no debounce)', async ({ page }) => {
    await gotoEditor(page);
    await openMarkerInClassesPanel(page);

    await typeEditedSource(page);
    const asClasses = await page.evaluate(() => window.__flashTest!.getDocument().asClasses ?? []);
    const marker = asClasses.filter((c) => c.path.endsWith('Marker.as'));
    // Exactly one entry (no duplicate), carrying the edited source.
    expect(marker.length).toBe(1);
    expect(marker[0]!.source).toContain(EDITED);
    expect(marker[0]!.source).not.toContain(STALE);
  });

  test('(c) closing the Classes tab right after an edit keeps the edit (panel unmount flush)', async ({ page }) => {
    await gotoEditor(page);
    await openMarkerInClassesPanel(page);

    await typeEditedSource(page);
    // Collapse the Classes tab immediately (clicking the active tab unmounts the panel).
    await page.getByRole('tab', { name: 'Classes' }).click();
    await expect(page.getByTestId('classes-panel')).toHaveCount(0);

    const asClasses = await page.evaluate(() => window.__flashTest!.getDocument().asClasses ?? []);
    const marker = asClasses.filter((c) => c.path.endsWith('Marker.as'));
    expect(marker.length).toBe(1);
    expect(marker[0]!.source).toContain(EDITED);
    expect(marker[0]!.source).not.toContain(STALE);
  });

  test('(d) autosave -> reload restores the EDITED class source, not the stale one', async ({ page }) => {
    await gotoEditor(page);
    await openMarkerInClassesPanel(page);

    await typeEditedSource(page);
    // Persist to a named project, then force-flush autosave (covers the 1310 path)
    // — immediately, within the old debounce window.
    await page.evaluate(async () => {
      await window.__flashTest!.saveProjectAs('marker-proj');
      await window.__flashTest!.flushAutosave();
    });

    // Reload the page and let the project restore on mount.
    await page.reload();
    await page.waitForFunction(() => !!window.__flashTest, null, { timeout: 20000 });
    // Give restore-on-load a beat to resolve the async IndexedDB read.
    await page.waitForFunction(
      () => (window.__flashTest!.getDocument().asClasses ?? []).some((c) => c.path.endsWith('Marker.as')),
      null,
      { timeout: 10000 }
    );

    const asClasses = await page.evaluate(() => window.__flashTest!.getDocument().asClasses ?? []);
    const marker = asClasses.filter((c) => c.path.endsWith('Marker.as'));
    expect(marker.length).toBe(1);
    expect(marker[0]!.source).toContain(EDITED);
    expect(marker[0]!.source).not.toContain(STALE);
  });
});
