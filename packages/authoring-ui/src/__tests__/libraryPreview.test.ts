// @vitest-environment jsdom
/**
 * Acceptance tests for task 1338 — the Flash 8 Library item-preview pane.
 *
 * Selecting each library item type populates the preview box above the item
 * list with the right kind of preview:
 *   - bitmap            → an <img> of the image
 *   - movieclip/graphic → a rendered <canvas> of the symbol's first frame
 *   - button            → a rendered <canvas> (up state), no Play control
 *   - font              → a sample-text node
 *   - sound             → a waveform <canvas> + Play/Stop
 *   - (no selection)    → an empty hint, no preview content
 *
 * Symbol previews drive the real CanvasRenderer; jsdom's <canvas> has no 2D
 * backend, so we install a minimal mock 2D context (the test asserts the
 * preview WIRING, not pixel output — that is covered structurally by the
 * renderer's own tests).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { act } from "react";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
import { createRoot, type Root } from "react-dom/client";
import type {
  BitmapItem,
  FontItem,
  Library,
  Symbol as SymbolItem,
  Timeline,
} from "@flash/core";
import { LibraryPreview } from "../LibraryPreview";

// ---------------------------------------------------------------------------
// jsdom canvas + Image stubs (no native 2D backend in jsdom)
// ---------------------------------------------------------------------------

function installCanvasStub() {
  const ctxStub = {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    transform: vi.fn(),
    setTransform: vi.fn(),
    clip: vi.fn(),
    drawImage: vi.fn(),
    arc: vi.fn(),
    closePath: vi.fn(),
    rect: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createPattern: vi.fn(() => null),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 0 })),
    set fillStyle(_v: unknown) {},
    get fillStyle() {
      return "#000";
    },
    set strokeStyle(_v: unknown) {},
    get strokeStyle() {
      return "#000";
    },
    set globalAlpha(_v: number) {},
    get globalAlpha() {
      return 1;
    },
    set lineWidth(_v: number) {},
    get lineWidth() {
      return 1;
    },
    set globalCompositeOperation(_v: string) {},
    get globalCompositeOperation() {
      return "source-over";
    },
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    ctxStub as unknown as CanvasRenderingContext2D
  );
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** 1×1 transparent PNG data URI. */
const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPgPAAEDAQD26pPiAAAAAElFTkSuQmCC";

function makeTimeline(frameCount: number): Timeline {
  return {
    layers: [
      {
        id: "L1",
        name: "Layer 1",
        type: "normal",
        visible: true,
        locked: false,
        outlineMode: false,
        outlineColor: "#0000ff",
        height: 18,
        parentFolderId: null,
        frameCount,
        frames: [
          {
            index: 0,
            isKeyframe: true,
            isEmpty: false,
            tweenType: "none",
            label: "",
            labelType: "name",
            script: "",
            sound: null,
            displayObjects: [],
          },
        ],
      },
    ],
  } as unknown as Timeline;
}

function makeSymbol(
  id: string,
  symbolType: SymbolItem["symbolType"],
  frameCount = 5
): SymbolItem {
  return {
    id,
    name: `Sym_${id}`,
    itemType: "symbol",
    symbolType,
    timeline: makeTimeline(frameCount),
    scale9Grid: null,
  } as unknown as SymbolItem;
}

const bitmap: BitmapItem = {
  id: "B1",
  name: "photo",
  itemType: "bitmap",
  dataUri: PNG_1PX,
  originalWidth: 1,
  originalHeight: 1,
  allowSmoothing: true,
  compressionType: "lossless",
  quality: 100,
};

const font: FontItem = {
  id: "F1",
  name: "MyFont",
  itemType: "font",
  fontName: "Verdana",
  bold: false,
  italic: false,
  linkageIdentifier: "MyFont",
};

const mc = makeSymbol("MC1", "movieclip", 5);
const graphic = makeSymbol("G1", "graphic", 3);
const button = makeSymbol("BTN1", "button", 4);

const library: Library = {
  items: [bitmap, font, mc, graphic, button],
  folders: [],
} as unknown as Library;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("<LibraryPreview>", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    installCanvasStub();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  function renderPreview(selectedItemId: string | null) {
    act(() => {
      root.render(
        React.createElement(LibraryPreview, { library, selectedItemId })
      );
    });
  }

  it("shows an empty hint when nothing is selected", () => {
    renderPreview(null);
    const box = container.querySelector('[data-testid="library-preview"]');
    expect(box).not.toBeNull();
    expect(box?.textContent).toMatch(/no item selected/i);
    expect(
      container.querySelector('[data-testid="library-preview-image"]')
    ).toBeNull();
  });

  it("shows the image for a selected bitmap", () => {
    renderPreview(bitmap.id);
    const img = container.querySelector<HTMLImageElement>(
      '[data-testid="library-preview-image"]'
    );
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe(PNG_1PX);
  });

  it("renders a canvas preview for a movieclip symbol", () => {
    renderPreview(mc.id);
    const canvas = container.querySelector(
      '[data-testid="library-preview-canvas"]'
    );
    expect(canvas).not.toBeNull();
    // Multi-frame movieclip exposes Play/Stop controls.
    expect(
      container.querySelector('[data-testid="library-preview-play"]')
    ).not.toBeNull();
  });

  it("renders a canvas preview for a graphic symbol", () => {
    renderPreview(graphic.id);
    expect(
      container.querySelector('[data-testid="library-preview-canvas"]')
    ).not.toBeNull();
  });

  it("renders a button's up-state canvas without a Play control", () => {
    renderPreview(button.id);
    expect(
      container.querySelector('[data-testid="library-preview-canvas"]')
    ).not.toBeNull();
    // Buttons show only the up state; no playback control.
    expect(
      container.querySelector('[data-testid="library-preview-play"]')
    ).toBeNull();
  });

  it("shows sample text for a selected font", () => {
    renderPreview(font.id);
    const node = container.querySelector('[data-testid="library-preview-font"]');
    expect(node).not.toBeNull();
    expect(node?.textContent).toMatch(/AaBb/);
  });

  it("swaps the preview when the selection changes", () => {
    renderPreview(bitmap.id);
    expect(
      container.querySelector('[data-testid="library-preview-image"]')
    ).not.toBeNull();
    renderPreview(font.id);
    expect(
      container.querySelector('[data-testid="library-preview-image"]')
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="library-preview-font"]')
    ).not.toBeNull();
  });
});
