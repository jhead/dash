/**
 * Unit tests for doc.importFile() — task 1134.
 *
 * Tests cover:
 *  - data: URL (bitmap PNG) — synchronous, item in finalDocument immediately
 *  - data: URL (sound MP3) — synchronous
 *  - http: URL — async path; pendingImports Promise resolves with updated doc
 *  - file: URL — warns and is a no-op
 *  - unknown scheme — warns and is a no-op
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDocument } from "@flash/core";
import { runJsfl, buildJsflContext } from "../runtime.js";
import type { JsflContext } from "../runtime.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides?: Parameters<typeof createDocument>[0]): JsflContext {
  return buildJsflContext(createDocument(overrides), 0, 0);
}

// Minimal 1×1 pixel transparent PNG as base64
// (8-byte sig + IHDR + IDAT + IEND)
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQ" +
  "AABjkB6QAAAABJRU5ErkJggg==";
const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_BASE64}`;

// Minimal 3-byte MP3 sync header stub encoded as base64
// FF FB 90 = MPEG-1 Layer 3 sync word — enough for MIME detection
const TINY_MP3_BASE64 = btoa("\xff\xfb\x90");
const TINY_MP3_DATA_URL = `data:audio/mpeg;base64,${TINY_MP3_BASE64}`;

// ---------------------------------------------------------------------------
// Synchronous data: URL imports
// ---------------------------------------------------------------------------

describe("doc.importFile() — data: URL (synchronous)", () => {
  it("adds a BitmapItem to the library for a PNG data: URL", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var doc = fl.getDocumentDOM();
       doc.importFile("${TINY_PNG_DATA_URL}", true);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    // Item must appear in finalDocument immediately (synchronous)
    const items = result.finalDocument!.library.items;
    const bitmapItem = items.find((i) => i.itemType === "bitmap");
    expect(bitmapItem).toBeDefined();
    expect(bitmapItem!.itemType).toBe("bitmap");
    // data URI must be stored on the item
    expect((bitmapItem as { dataUri: string }).dataUri).toBe(TINY_PNG_DATA_URL);
    // No pending async imports
    expect(result.pendingImports).toBeUndefined();
  });

  it("adds a SoundItem to the library for an MP3 data: URL", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var doc = fl.getDocumentDOM();
       doc.importFile("${TINY_MP3_DATA_URL}", true);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    const items = result.finalDocument!.library.items;
    const soundItem = items.find((i) => i.itemType === "sound");
    expect(soundItem).toBeDefined();
    expect(soundItem!.itemType).toBe("sound");
    expect((soundItem as { dataUri: string }).dataUri).toBe(TINY_MP3_DATA_URL);
    expect(result.pendingImports).toBeUndefined();
  });

  it("importFile via fl.getDocumentDOM() also adds item", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `fl.getDocumentDOM().importFile("${TINY_PNG_DATA_URL}", true);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    const items = result.finalDocument!.library.items;
    expect(items.find((i) => i.itemType === "bitmap")).toBeDefined();
  });

  it("calling importFile twice adds two items", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var doc = fl.getDocumentDOM();
       doc.importFile("${TINY_PNG_DATA_URL}", true);
       doc.importFile("${TINY_MP3_DATA_URL}", true);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    const items = result.finalDocument!.library.items;
    expect(items.filter((i) => i.itemType === "bitmap").length).toBe(1);
    expect(items.filter((i) => i.itemType === "sound").length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Async http: URL imports
// ---------------------------------------------------------------------------

describe("doc.importFile() — http: URL (async)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Set up a fetch mock that returns a 1×1 PNG
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => "image/png" },
      arrayBuffer: async () => {
        // Decode the tiny PNG back to bytes
        const binStr = atob(TINY_PNG_BASE64);
        const bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
        return bytes.buffer;
      },
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a pendingImports array for http: URLs", async () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `fl.getDocumentDOM().importFile("https://example.com/image.png", true);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    // The item is NOT yet in finalDocument (fetch is async)
    const itemsBeforeAwait = result.finalDocument!.library.items;
    expect(itemsBeforeAwait.find((i) => i.itemType === "bitmap")).toBeUndefined();
    // pendingImports must be non-empty
    expect(result.pendingImports).toBeDefined();
    expect(result.pendingImports!.length).toBe(1);
    // After awaiting, the resolved document should contain the bitmap
    const updatedDoc = await result.pendingImports![0];
    const bitmapItem = updatedDoc.library.items.find((i) => i.itemType === "bitmap");
    expect(bitmapItem).toBeDefined();
    expect(fetchMock).toHaveBeenCalledWith("https://example.com/image.png");
  });

  it("fetch failure resolves with original doc (no item added)", async () => {
    fetchMock.mockRejectedValue(new Error("network error"));
    const ctx = makeCtx();
    const result = runJsfl(
      `fl.getDocumentDOM().importFile("https://broken.example.com/img.png", true);`,
      ctx
    );
    expect(result.pendingImports).toBeDefined();
    // Should resolve (not reject) — no exception propagated to JSFL
    const doc = await result.pendingImports![0];
    // No item was added
    expect(doc.library.items.find((i) => i.itemType === "bitmap")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Unsupported / graceful-degradation paths
// ---------------------------------------------------------------------------

describe("doc.importFile() — unsupported URLs", () => {
  it("warns and is a no-op for file: URLs", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = makeCtx();
    const result = runJsfl(
      `fl.getDocumentDOM().importFile("file:///C:/assets/image.png", true);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.finalDocument!.library.items).toHaveLength(0);
    expect(result.pendingImports).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("local filesystem"));
    warnSpy.mockRestore();
  });

  it("warns and is a no-op for Windows-style local paths", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = makeCtx();
    const result = runJsfl(
      `fl.getDocumentDOM().importFile("C:\\\\assets\\\\sound.mp3", true);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.finalDocument!.library.items).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("warns and is a no-op for unknown schemes", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = makeCtx();
    const result = runJsfl(
      `fl.getDocumentDOM().importFile("ftp://example.com/image.png", true);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.finalDocument!.library.items).toHaveLength(0);
    expect(result.pendingImports).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("unsupported URL scheme"));
    warnSpy.mockRestore();
  });
});
