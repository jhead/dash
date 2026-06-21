import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type {
  BitmapItem,
  DisplayObject,
  FontItem,
  Library,
  LibraryItem,
  SceneGraph,
  SoundItem,
  Symbol,
  Timeline,
} from "@flash/core";
import {
  CanvasRenderer,
  getFrameCount,
  getTweenedFrame,
  getUnionBounds,
} from "@flash/core";
import { chrome, halo, content, chromeFont } from "./theme/flash8Theme.js";

/**
 * Flash 8 Library item-preview pane.
 *
 * Sits directly under the Library panel title bar, above the search/list. When a
 * library item is selected it shows a preview of that item, mirroring Flash 8:
 *
 *   - bitmap           → the image itself
 *   - movieclip/graphic→ a render of the symbol's first frame (+ Play/Stop to
 *                         scrub the timeline)
 *   - button           → a render of the button's "up" state (first frame)
 *   - sound            → a simple waveform + a Play/Stop control
 *   - font             → sample text in the named face/style
 *   - video/component  → a labelled placeholder fallback
 *
 * Symbol rendering reuses the stage machinery (CanvasRenderer + getTweenedFrame),
 * the same pattern as Shell.tsx screenshotStage — it does not reinvent the
 * renderer.
 */

/** Fixed preview-box height (Flash 8's preview pane is a short fixed strip). */
const PREVIEW_HEIGHT = 96;
/** Inner padding around the rendered content. */
const PAD = 4;

export interface LibraryPreviewProps {
  library: Library;
  selectedItemId: string | null;
  /** Background fps to drive symbol playback (defaults to 12, Flash's default). */
  fps?: number;
}

// ---------------------------------------------------------------------------
// Symbol → SceneGraph helpers (mirrors Shell.tsx screenshotStage / snapshotFrame)
// ---------------------------------------------------------------------------

/**
 * Construct a CanvasRenderer, swallowing the constructor throw that occurs when
 * the canvas has no 2D context (context-loss / headless). Returns null so the
 * caller can skip drawing instead of surfacing an unhandled error.
 */
function safeRenderer(canvas: HTMLCanvasElement): CanvasRenderer | null {
  try {
    return new CanvasRenderer(canvas);
  } catch {
    return null;
  }
}

/** Build a renderer SceneGraph for one frame of a timeline. */
function sceneGraphForFrame(timeline: Timeline, frameIndex: number): SceneGraph {
  return {
    layers: timeline.layers.map((layer) => {
      const frame = getTweenedFrame(layer, frameIndex, timeline);
      const objects: DisplayObject[] = frame ? [...frame.displayObjects] : [];
      return {
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        locked: layer.locked,
        outlineMode: layer.outlineMode,
        outlineColor: layer.outlineColor,
        objects,
      };
    }),
  };
}

/**
 * Compute the union AABB (in symbol-local coords) of all display objects on a
 * frame so the preview can fit-and-center the content. Reuses the engine's
 * `getUnionBounds` / `getTransformedBounds` (rotation- and instance-aware)
 * rather than re-deriving bounds. Falls back to the document default 550×400
 * box when nothing measurable is present (no objects, or a degenerate box).
 */
function frameBounds(
  sg: SceneGraph
): { x: number; y: number; w: number; h: number } {
  const objects: DisplayObject[] = [];
  for (const layer of sg.layers) objects.push(...layer.objects);
  const b = getUnionBounds(objects);
  if (!b || b.width <= 0 || b.height <= 0) {
    return { x: 0, y: 0, w: 550, h: 400 };
  }
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

// ---------------------------------------------------------------------------
// Sound waveform decode (Web Audio)
// ---------------------------------------------------------------------------

/** Decode a sound data URI into peak bins for a simple waveform. */
async function decodePeaks(
  dataUri: string,
  bins: number
): Promise<number[] | null> {
  try {
    const AudioCtx =
      (window as unknown as { AudioContext?: typeof AudioContext })
        .AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return null;
    const res = await fetch(dataUri);
    const buf = await res.arrayBuffer();
    const ctx = new AudioCtx();
    try {
      const audio = await ctx.decodeAudioData(buf);
      const ch = audio.getChannelData(0);
      const step = Math.max(1, Math.floor(ch.length / bins));
      const peaks: number[] = [];
      for (let i = 0; i < bins; i++) {
        let peak = 0;
        const start = i * step;
        for (let j = 0; j < step && start + j < ch.length; j++) {
          const v = Math.abs(ch[start + j]);
          if (v > peak) peak = v;
        }
        peaks.push(peak);
      }
      return peaks;
    } finally {
      // Always release the context — browsers cap live AudioContexts (~6), so
      // a leak on the decode-failure path would exhaust them after a few bad
      // sounds. (close() returns a promise; failure to close is non-fatal.)
      void ctx.close().catch(() => undefined);
    }
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Per-type preview renderers
// ---------------------------------------------------------------------------

const previewBoxStyle: React.CSSProperties = {
  position: "relative",
  height: `${PREVIEW_HEIGHT}px`,
  flexShrink: 0,
  background: content.pasteboard,
  borderBottom: `${chrome.borderThin}px solid ${chrome.separator}`,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden",
};

const emptyHintStyle: React.CSSProperties = {
  ...chromeFont(),
  fontSize: "10px",
  color: chrome.textDisabled,
  fontStyle: "italic",
  textAlign: "center",
  padding: "0 8px",
};

/** Bitmap preview: draw the dataUri directly into an <img>, fit-contained. */
function BitmapPreview({ item }: { item: BitmapItem }) {
  if (!item.dataUri) {
    return <div style={emptyHintStyle}>Bitmap not loaded</div>;
  }
  return (
    <img
      src={item.dataUri}
      alt={item.name}
      data-testid="library-preview-image"
      style={{
        maxWidth: `calc(100% - ${PAD * 2}px)`,
        maxHeight: `calc(100% - ${PAD * 2}px)`,
        objectFit: "contain",
        imageRendering: item.allowSmoothing ? "auto" : "pixelated",
      }}
    />
  );
}

/**
 * Symbol preview: render the symbol timeline to a canvas via CanvasRenderer.
 * Supports Play/Stop for movieclip/graphic (button shows only its up state).
 */
function SymbolPreview({
  item,
  library,
  fps,
}: {
  item: Symbol;
  library: Library;
  fps: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [frame, setFrame] = useState(0);

  const frameCount = useMemo(
    () => Math.max(1, getFrameCount(item.timeline)),
    [item.timeline]
  );
  // Buttons show a static up-state (frame 0); they are not "played".
  const canPlay = item.symbolType !== "button" && frameCount > 1;

  // Reset to frame 0 whenever the selected symbol changes.
  useEffect(() => {
    setFrame(0);
    setPlaying(false);
  }, [item.id]);

  // Preload + decode every library bitmap ONCE per library so nested bitmaps
  // render instead of placeholders. loadImage is sync (sets img.src) but decode
  // is async; we await decode then trigger a redraw. Kept separate from the
  // per-frame draw so playback ticks don't re-allocate/re-decode images.
  const [bitmapsReady, setBitmapsReady] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const bitmaps = library.items.filter(
      (i): i is BitmapItem => i.itemType === "bitmap" && !!i.dataUri
    );
    if (bitmaps.length === 0) return;
    const renderer =
      rendererRef.current ??
      (canvasRef.current
        ? (rendererRef.current = safeRenderer(canvasRef.current))
        : null);
    if (renderer) for (const bmp of bitmaps) renderer.loadImage(bmp.id, bmp.dataUri);
    void Promise.all(
      bitmaps.map(
        (bmp) =>
          new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => resolve();
            img.onerror = () => resolve();
            img.src = bmp.dataUri;
          })
      )
    ).then(() => {
      // Bump a counter to redraw once images have decoded.
      if (!cancelled) setBitmapsReady((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [library]);

  // Render the active frame whenever it (or the symbol / decoded bitmaps)
  // changes. No image decoding happens here — just build the scene graph and
  // draw, fitting the content bounds into the preview box.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer =
      rendererRef.current ?? (rendererRef.current = safeRenderer(canvas));
    if (!renderer) return; // No 2D context available (e.g. context-loss).

    const sg = sceneGraphForFrame(item.timeline, frame);
    const bounds = frameBounds(sg);
    const boxW = canvas.width;
    const boxH = canvas.height;
    const fitZoom = Math.min(
      boxW / Math.max(1, bounds.w),
      boxH / Math.max(1, bounds.h),
      1
    );
    // Center the content's bounds in the preview box.
    const vpX = (boxW - bounds.w * fitZoom) / 2 - bounds.x * fitZoom;
    const vpY = (boxH - bounds.h * fitZoom) / 2 - bounds.y * fitZoom;

    const ctx = canvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, boxW, boxH);
    renderer.render(sg, { x: vpX, y: vpY, zoom: fitZoom }, library);
  }, [item.id, item.timeline, frame, library, bitmapsReady]);

  // Playback tick loop for movieclip/graphic.
  useEffect(() => {
    if (!playing || !canPlay) return;
    const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 12;
    const interval = 1000 / safeFps;
    const id = window.setInterval(() => {
      setFrame((f) => (f + 1) % frameCount);
    }, interval);
    return () => window.clearInterval(id);
  }, [playing, canPlay, frameCount, fps]);

  const togglePlay = useCallback(() => {
    setPlaying((p) => !p);
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        width={PREVIEW_HEIGHT * 2}
        height={PREVIEW_HEIGHT - PAD * 2}
        data-testid="library-preview-canvas"
        style={{
          maxWidth: `calc(100% - ${PAD * 2}px)`,
          maxHeight: `calc(100% - ${PAD * 2}px)`,
        }}
      />
      {canPlay && (
        <PlayControls
          playing={playing}
          onToggle={togglePlay}
          onStop={() => {
            setPlaying(false);
            setFrame(0);
          }}
        />
      )}
    </>
  );
}

/** Sound preview: a simple waveform plus Play/Stop driving an <audio> element. */
function SoundPreview({ item }: { item: SoundItem }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [peaks, setPeaks] = useState<number[] | null>(null);

  // Decode peaks asynchronously when the sound changes.
  useEffect(() => {
    let cancelled = false;
    setPeaks(null);
    if (!item.dataUri) return;
    void decodePeaks(item.dataUri, 120).then((p) => {
      if (!cancelled) setPeaks(p);
    });
    return () => {
      cancelled = true;
    };
  }, [item.id, item.dataUri]);

  // Draw the waveform when peaks resolve.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    // Midline.
    ctx.strokeStyle = halo.separator;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    if (!peaks || peaks.length === 0) return;
    ctx.fillStyle = halo.haloBlue;
    const barW = w / peaks.length;
    for (let i = 0; i < peaks.length; i++) {
      const amp = Math.max(1, peaks[i] * (h / 2));
      ctx.fillRect(i * barW, h / 2 - amp, Math.max(1, barW - 0.5), amp * 2);
    }
  }, [peaks]);

  // Stop playback when the item changes.
  useEffect(() => {
    setPlaying(false);
  }, [item.id]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      audio.currentTime = 0;
      setPlaying(false);
    } else {
      void audio.play().catch(() => undefined);
      setPlaying(true);
    }
  }, [playing]);

  return (
    <>
      <canvas
        ref={canvasRef}
        width={220}
        height={PREVIEW_HEIGHT - PAD * 2 - 16}
        data-testid="library-preview-waveform"
        style={{ maxWidth: `calc(100% - ${PAD * 2}px)` }}
      />
      {item.dataUri && (
        <audio
          ref={audioRef}
          src={item.dataUri}
          onEnded={() => setPlaying(false)}
        />
      )}
      <PlayControls
        playing={playing}
        onToggle={toggle}
        onStop={() => {
          const audio = audioRef.current;
          if (audio) {
            audio.pause();
            audio.currentTime = 0;
          }
          setPlaying(false);
        }}
      />
    </>
  );
}

/** Font preview: a short sample line in the named face / weight / style. */
function FontPreview({ item }: { item: FontItem }) {
  return (
    <div
      data-testid="library-preview-font"
      style={{
        ...chromeFont(),
        color: chrome.textDefault,
        fontFamily: `"${item.fontName}", ${item.fontName}, sans-serif`,
        fontWeight: item.bold ? "bold" : "normal",
        fontStyle: item.italic ? "italic" : "normal",
        fontSize: "22px",
        lineHeight: 1.1,
        textAlign: "center",
        padding: "0 8px",
        overflow: "hidden",
      }}
      title={item.fontName}
    >
      AaBbYyZz 123
    </div>
  );
}

/** Shared Play/Stop control strip, bottom-left of the preview box. */
function PlayControls({
  playing,
  onToggle,
  onStop,
}: {
  playing: boolean;
  onToggle: () => void;
  onStop: () => void;
}) {
  const btn: React.CSSProperties = {
    ...chromeFont(),
    fontSize: "11px",
    width: "18px",
    height: "16px",
    lineHeight: "14px",
    textAlign: "center",
    background: halo.inputBg,
    color: chrome.textDefault,
    border: `1px solid ${halo.borderColor}`,
    cursor: "pointer",
    padding: 0,
  };
  return (
    <div
      style={{
        position: "absolute",
        left: "4px",
        bottom: "4px",
        display: "flex",
        gap: "2px",
      }}
    >
      <button
        type="button"
        style={btn}
        onClick={onToggle}
        title={playing ? "Pause" : "Play"}
        data-testid="library-preview-play"
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <button
        type="button"
        style={btn}
        onClick={onStop}
        title="Stop"
        data-testid="library-preview-stop"
      >
        ■
      </button>
    </div>
  );
}

/** Labelled fallback for item types without a dedicated visual preview. */
function FallbackPreview({ label }: { label: string }) {
  return <div style={emptyHintStyle}>{label}</div>;
}

// ---------------------------------------------------------------------------
// Top-level preview pane
// ---------------------------------------------------------------------------

export function LibraryPreview({
  library,
  selectedItemId,
  fps = 12,
}: LibraryPreviewProps) {
  const item: LibraryItem | undefined = useMemo(
    () =>
      selectedItemId == null
        ? undefined
        : library.items.find((i) => i.id === selectedItemId),
    [library.items, selectedItemId]
  );

  let body: React.ReactNode;
  if (!item) {
    body = <div style={emptyHintStyle}>No item selected</div>;
  } else if (item.itemType === "bitmap") {
    body = <BitmapPreview item={item} />;
  } else if (item.itemType === "symbol") {
    body = <SymbolPreview item={item} library={library} fps={fps} />;
  } else if (item.itemType === "sound") {
    body = <SoundPreview item={item} />;
  } else if (item.itemType === "font") {
    body = <FontPreview item={item} />;
  } else if (item.itemType === "video") {
    body = <FallbackPreview label={`Video: ${item.name}`} />;
  } else if (item.itemType === "component") {
    body = <FallbackPreview label={`Component: ${item.name}`} />;
  } else {
    body = <FallbackPreview label="No preview" />;
  }

  return (
    <div style={previewBoxStyle} data-testid="library-preview">
      {body}
    </div>
  );
}
