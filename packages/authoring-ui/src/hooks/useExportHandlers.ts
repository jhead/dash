import { useCallback } from "react";
import {
  getTweenedFrame,
  CanvasRenderer,
  type FlashDocument,
  type Timeline as TimelineModel,
  type DocumentProperties,
  type SceneGraph,
  type DisplayObject,
} from "@flash/core";
import { GIFEncoder, quantize, applyPalette } from "gifenc";
import { frameFilename } from "../frameFilename.js";
import type { ExportGifOptions } from "../ExportGifDialog";
import type { UiStoreApi } from "../store/index.js";

/**
 * Derive the gifenc `repeat` value (== the NETSCAPE2.0 application-extension loop
 * count) from the export dialog's loop settings.
 *
 * gifenc's GIFEncoder.writeFrame writes the NETSCAPE2.0 loop sub-block on the first
 * frame iff `repeat >= 0`, encoding `repeat` as the 2-byte little-endian loop count:
 *   - 0 -> loop forever
 *   - N -> play N additional times (finite loop)
 *   - <0 -> omit the extension entirely, so the GIF plays exactly once
 *
 * "Loop forever" therefore maps to 0; a finite count maps to the requested loopCount
 * (clamped to >= 1, matching the dialog), instead of being silently discarded.
 */
export function gifLoopRepeat(options: {
  loopForever: boolean;
  loopCount: number;
}): number {
  return options.loopForever ? 0 : Math.max(1, options.loopCount);
}

export interface ExportHandlersDeps {
  uiStore: UiStoreApi;
  doc: FlashDocument;
  docProperties: DocumentProperties;
  timeline: TimelineModel;
  currentFrame: number;
  testMovie: () => Promise<Uint8Array>;
}

/**
 * Export (image / PNG-sequence / animated GIF) + Test Movie player handlers.
 * renderFrameToDataURL/downloadBlob/computeMaxFrame are hook-local helpers.
 * Extracted out of Shell verbatim; behaviour-preserving.
 */
export function useExportHandlers(deps: ExportHandlersDeps) {
  const { uiStore, doc, docProperties, timeline, currentFrame, testMovie } = deps;
  const setExportGifOpen = uiStore.getState().setExportGifOpen;
  const setSwfBytes = uiStore.getState().setSwfBytes;
  const setPlayerOpen = uiStore.getState().setPlayerOpen;
  const setPlayerError = uiStore.getState().setPlayerError;
  const setOutputMessages = uiStore.getState().setOutputMessages;
  const setBottomTab = uiStore.getState().setBottomTab;

  /**
   * Renders a given frame index to a composited canvas (background + content)
   * and returns the data URL (with prefix).
   * @param frameIndex - 0-based frame index to render
   * @param format - "png" | "jpeg"
   * @param quality - JPEG quality 0–1 (ignored for PNG)
   */
  const renderFrameToDataURL = useCallback(
    (frameIndex: number, format: "png" | "jpeg" = "png", quality = 0.92): string => {
      const w = docProperties.width;
      const h = docProperties.height;
      const sceneGraph: SceneGraph = {
        layers: timeline.layers.map((layer) => {
          const frame = getTweenedFrame(layer, frameIndex);
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
      const offscreen = document.createElement("canvas");
      offscreen.width = w;
      offscreen.height = h;
      const renderer = new CanvasRenderer(offscreen);
      renderer.resize(w, h, 1);
      renderer.render(sceneGraph, { x: 0, y: 0, zoom: 1 }, doc.library);
      const composite = document.createElement("canvas");
      composite.width = w;
      composite.height = h;
      const ctx = composite.getContext("2d")!;
      ctx.fillStyle = docProperties.backgroundColor;
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(offscreen, 0, 0);
      const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
      return composite.toDataURL(mimeType, quality);
    },
    [docProperties, timeline, doc.library]
  );

  /** Trigger a browser download for arbitrary blob data. */
  const downloadBlob = useCallback((filename: string, blob: Blob): void => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  /**
   * File > Export Image...
   * Exports the currently visible frame as a PNG.
   */
  const handleExportImage = useCallback(() => {
    const dataURL = renderFrameToDataURL(currentFrame, "png");
    // Strip the "data:image/png;base64," prefix to get raw bytes
    const base64 = dataURL.replace(/^data:image\/png;base64,/, "");
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "image/png" });
    downloadBlob("frame.png", blob);
  }, [renderFrameToDataURL, currentFrame, downloadBlob]);

  /**
   * File > Export Movie...
   * Opens the ExportGifDialog to let the user choose format (PNG sequence or animated GIF).
   */
  const handleExportMovie = useCallback(() => {
    setExportGifOpen(true);
  }, []);

  /**
   * Compute the total frame count across all layers.
   * Extracted helper used by both export paths.
   */
  const computeMaxFrame = useCallback((): number => {
    return Math.max(
      ...timeline.layers.map((l) => {
        if (l.frames.length === 0) return 1;
        const lastKf = [...l.frames].sort((a, b) => b.index - a.index)[0];
        return lastKf.index + 1;
      }),
      1
    );
  }, [timeline.layers]);

  /**
   * Perform the actual export once the user confirms the ExportGifDialog.
   */
  const handleExportGifConfirm = useCallback(
    (options: ExportGifOptions) => {
      setExportGifOpen(false);
      const maxFrame = computeMaxFrame();

      if (options.format === "png-sequence") {
        // Original PNG sequence path
        for (let fi = 0; fi < maxFrame; fi++) {
          const dataURL = renderFrameToDataURL(fi, "png");
          const base64 = dataURL.replace(/^data:image\/png;base64,/, "");
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "image/png" });
          downloadBlob(frameFilename(fi, "png"), blob);
        }
        return;
      }

      // Animated GIF path
      void (async () => {
        const w = docProperties.width;
        const h = docProperties.height;
        const gif = GIFEncoder();
        // `repeat` maps directly to the NETSCAPE2.0 application-extension loop count
        // (see gifLoopRepeat): 0 = loop forever, N = finite N-times. Honors the dialog's
        // loop count instead of discarding it (the old code passed -1 = no extension =
        // plays once for any finite count).
        const repeat = gifLoopRepeat(options);

        for (let fi = 0; fi < maxFrame; fi++) {
          // Render the frame to a data URL and decode to RGBA bytes
          const dataURL = renderFrameToDataURL(fi, "png");
          const img = new Image();
          img.src = dataURL;
          await new Promise<void>((resolve) => {
            img.onload = () => resolve();
          });
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(img, 0, 0);
          const { data } = ctx.getImageData(0, 0, w, h);

          const palette = quantize(data, options.maxColors);
          const index = applyPalette(data, palette);

          gif.writeFrame(index, w, h, {
            palette,
            delay: options.frameDelay,
            repeat: fi === 0 ? repeat : undefined,
          });
        }

        gif.finish();
        const rawBytes = gif.bytes();
        // Copy to a plain ArrayBuffer to satisfy Blob constructor's type constraint
        const buffer = rawBytes.buffer.slice(
          rawBytes.byteOffset,
          rawBytes.byteOffset + rawBytes.byteLength
        ) as ArrayBuffer;
        downloadBlob("movie.gif", new Blob([buffer], { type: "image/gif" }));
      })();
    },
    [
      computeMaxFrame,
      renderFrameToDataURL,
      downloadBlob,
      docProperties.width,
      docProperties.height,
    ]
  );

  const handleTestMovie = useCallback(() => {
    void (async () => {
      const bytes = await testMovie();
      setSwfBytes(bytes);
      setPlayerOpen(true);
      // Clear output from previous run and switch to the Output tab so the user
      // can see trace() messages as the movie plays.
      setOutputMessages([]);
      setBottomTab("output");
    })();
  }, [testMovie]);

  // Stable callbacks for PlayerWindow — memoized so RufflePlayer does not
  // reload when Shell re-renders (e.g., on tool-shortcut keypresses).
  const handlePlayerClose = useCallback(() => {
    setPlayerOpen(false);
    setPlayerError(null);
  }, []);

  const handlePlayerError = useCallback((msg: string) => {
    setPlayerError(msg);
  }, []);

  // Called for each AS2 trace() line captured from the running SWF.
  // Uses a functional setState update so the callback identity is stable and
  // does not cause PlayerWindow / RufflePlayer to remount.
  const handleTrace = useCallback((line: string) => {
    setOutputMessages((prev) => [...prev, line]);
  }, []);


  return {
    handleExportImage, handleExportMovie, handleExportGifConfirm,
    handleTestMovie, handlePlayerClose, handlePlayerError, handleTrace,
  };
}
