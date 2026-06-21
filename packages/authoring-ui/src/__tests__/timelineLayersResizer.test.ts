// @vitest-environment jsdom
/**
 * Task 1366 — the draggable divider between the Timeline LAYERS column and the
 * FRAMES grid. These render-level tests pin the contract the Shell relies on:
 *
 *   1. the resizer is an accessible separator (role/orientation/value range) and
 *      reflects the supplied `layerColumnWidth`;
 *   2. the LAYERS column actually takes the supplied width (so the frame grid
 *      reflows into the remaining space);
 *   3. the live width is CLAMPED to [LAYER_COL_MIN_WIDTH, LAYER_COL_MAX_WIDTH]
 *      defensively even if an out-of-range value is passed (mirrors the
 *      editorLayout clamp + the Shell's useResize clamp);
 *   4. the divider forwards pointer-down + key-down to the Shell-supplied
 *      handlers (the shared useResize hook + keyboard a11y).
 *
 * The persistence half (set -> stored -> restored) is covered in
 * editorLayout.test.ts; this file covers the UI half.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { createRoot, type Root } from "react-dom/client";
import { createTimeline, type Timeline as TimelineModel } from "@flash/core";
import { Timeline } from "../Timeline";

describe("Timeline layers/frames resizer (task 1366)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  function mount(props: Partial<React.ComponentProps<typeof Timeline>>): void {
    const timeline: TimelineModel = createTimeline();
    act(() => {
      root.render(
        React.createElement(Timeline, {
          timeline,
          currentFrame: 0,
          isPlaying: false,
          onTimelineChange: () => {},
          onFrameChange: () => {},
          onPlayingChange: () => {},
          ...props,
        })
      );
    });
  }

  function resizer(): HTMLElement {
    const el = container.querySelector<HTMLElement>(
      '[data-testid="timeline-layers-resizer"]'
    );
    expect(el).not.toBeNull();
    return el!;
  }

  function layersColumnWidth(): number {
    // The layers column is the first row child; its inline width is the value
    // under test. Read it off the resizer's previous sibling (the column).
    const col = resizer().previousElementSibling as HTMLElement;
    return parseFloat(col.style.width);
  }

  it("renders an accessible vertical separator reflecting the width", () => {
    mount({ layerColumnWidth: 200 });
    const r = resizer();
    expect(r.getAttribute("role")).toBe("separator");
    expect(r.getAttribute("aria-orientation")).toBe("vertical");
    expect(r.getAttribute("aria-valuenow")).toBe("200");
    expect(r.getAttribute("aria-valuemin")).toBe("90");
    expect(r.getAttribute("aria-valuemax")).toBe("400");
  });

  it("applies the supplied layers-column width (frame grid reflows)", () => {
    mount({ layerColumnWidth: 250 });
    expect(layersColumnWidth()).toBe(250);
  });

  it("clamps an over-max width down to the max", () => {
    mount({ layerColumnWidth: 9999 });
    expect(layersColumnWidth()).toBe(400);
    expect(resizer().getAttribute("aria-valuenow")).toBe("400");
  });

  it("clamps an under-min width up to the min", () => {
    mount({ layerColumnWidth: 5 });
    expect(layersColumnWidth()).toBe(90);
    expect(resizer().getAttribute("aria-valuenow")).toBe("90");
  });

  it("falls back to the default 130 when no width is supplied", () => {
    mount({});
    expect(layersColumnWidth()).toBe(130);
  });

  it("forwards pointer-down and key-down to the Shell handlers; col-resize cursor when active", () => {
    const onPointerDown = vi.fn();
    const onKeyDown = vi.fn();
    mount({
      layerColumnWidth: 150,
      onLayerColumnResizePointerDown: onPointerDown,
      onLayerColumnResizeKeyDown: onKeyDown,
    });
    const r = resizer();
    expect(r.style.cursor).toBe("col-resize");
    expect(r.getAttribute("tabindex")).toBe("0");

    act(() => {
      r.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(onPointerDown).toHaveBeenCalledTimes(1);

    act(() => {
      r.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })
      );
    });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it("is an inert, non-focusable hairline when no resize handler is supplied", () => {
    mount({ layerColumnWidth: 150 });
    const r = resizer();
    expect(r.style.cursor).toBe("default");
    expect(r.getAttribute("tabindex")).toBe("-1");
  });
});
