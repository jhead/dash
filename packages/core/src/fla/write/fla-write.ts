/**
 * Binary FLA writer orchestrator.
 *
 * `saveRealFla(doc)` serializes a `FlashDocument` to a genuine Macromedia
 * Flash 8 binary `.fla` (OLE2/CFB container holding MFC CArchive streams):
 *
 *   - `Contents`  — document properties + library catalog (§8)
 *   - `Page N`    — one stream per scene (timeline CArchive, §7–§19)
 *   - `Symbol N`  — one stream per library symbol
 *   - `Media N`   — bitmap payloads (raw image bytes)
 *
 * Deterministic: no Date.now / randomness. Targets Flash 8 (formatVersion 0x49)
 * only.
 *
 * CPicSwf (embedded/imported SWF placements) are NOT authored by this editor, but
 * the importer preserves each such record's raw bytes on `doc.flaSwfBlobs` "for
 * lossless re-export" (see flash8-import.ts collectSwfBlobs). saveRealFla closes
 * that loop (task 1409): scene-timeline blobs (`sceneIndex` set) are re-emitted
 * into their originating `Page N` stream so an import->export round-trip preserves
 * them. Symbol-timeline blobs (`sceneIndex` undefined) cannot be routed — the
 * importer does not yet record which symbol they came from — so they are dropped
 * with a warning (see the §22 note in docs/21-fla-binary-format.md).
 */

import type { FlashDocument, FlaSwfBlob } from "../../model/types.js";
import { writeCfb } from "./cfb-write.js";
import { writeTimelineStream, type WriteIndex } from "./timeline-write.js";
import {
  writeContents,
  type ContentsInput,
  type ContentsSceneEntry,
  type ContentsSymbolEntry,
  type ContentsMediaEntry,
} from "./contents-write.js";

const FLA8_FORMAT_VERSION = 0x49; // Flash 8

const TYPE_BYTE: Record<string, number> = { graphic: 0, button: 1, movieclip: 2 };

export function saveRealFla(doc: FlashDocument): Uint8Array {
  const streams = new Map<string, Uint8Array>();

  // ---- Assign stream numbers -----------------------------------------------
  // Symbols: 1-based, in library order. Media (bitmaps): 1-based.
  const symbolNumById = new Map<string, number>();
  const symbolTypeById = new Map<string, "movieclip" | "button" | "graphic">();
  const mediaNumById = new Map<string, number>();

  const symbols = doc.library.items.filter(
    (it): it is Extract<typeof it, { itemType: "symbol" }> => it.itemType === "symbol",
  );
  symbols.forEach((sym, i) => {
    symbolNumById.set(sym.id, i + 1);
    symbolTypeById.set(sym.id, sym.symbolType);
  });

  const bitmaps = doc.library.items.filter(
    (it): it is Extract<typeof it, { itemType: "bitmap" }> => it.itemType === "bitmap",
  );
  const sounds = doc.library.items.filter(
    (it): it is Extract<typeof it, { itemType: "sound" }> => it.itemType === "sound",
  );
  const videos = doc.library.items.filter(
    (it): it is Extract<typeof it, { itemType: "video" }> => it.itemType === "video",
  );

  // Media numbers are shared across bitmaps/sounds/videos (single namespace).
  let mediaCounter = 0;
  const mediaEntries: ContentsMediaEntry[] = [];
  for (const bmp of bitmaps) {
    mediaCounter += 1;
    mediaNumById.set(bmp.id, mediaCounter);
    const bytes = dataUriToBytes(bmp.dataUri);
    if (bytes && bytes.length > 0) streams.set(`Media ${mediaCounter}`, bytes);
    mediaEntries.push({ num: mediaCounter, displayName: bmp.name, kind: "bitmap" });
  }
  for (const snd of sounds) {
    mediaCounter += 1;
    mediaNumById.set(snd.id, mediaCounter);
    const bytes = dataUriToBytes(snd.dataUri);
    if (bytes && bytes.length > 0) streams.set(`Media ${mediaCounter}`, bytes);
    mediaEntries.push({ num: mediaCounter, displayName: snd.name, kind: "sound" });
  }
  for (const vid of videos) {
    mediaCounter += 1;
    mediaNumById.set(vid.id, mediaCounter);
    const bytes = dataUriToBytes(vid.dataUri);
    if (bytes && bytes.length > 0) streams.set(`Media ${mediaCounter}`, bytes);
    mediaEntries.push({ num: mediaCounter, displayName: vid.name, kind: "video" });
  }

  const idx: WriteIndex = { symbolNumById, mediaNumById, symbolTypeById };

  // ---- Preserved CPicSwf blobs (task 1409) ---------------------------------
  // Group the importer-captured embedded-SWF placement bytes by their scene index
  // so each scene's blobs are re-emitted into its own `Page N` stream. Blobs with
  // an undefined sceneIndex are symbol-timeline placements; the importer does not
  // record which symbol they belong to, so they cannot be re-routed and are dropped.
  const swfBlobsByScene = new Map<number, FlaSwfBlob[]>();
  let droppedSymbolBlobs = 0;
  for (const blob of doc.flaSwfBlobs ?? []) {
    if (blob.sceneIndex === undefined) {
      droppedSymbolBlobs += 1;
      continue;
    }
    const list = swfBlobsByScene.get(blob.sceneIndex);
    if (list) list.push(blob);
    else swfBlobsByScene.set(blob.sceneIndex, [blob]);
  }
  if (droppedSymbolBlobs > 0) {
    console.warn(
      `[FLA save] dropping ${droppedSymbolBlobs} symbol-timeline CPicSwf blob(s): ` +
        `the importer does not record which symbol they came from, so they cannot be ` +
        `re-emitted (see docs/21-fla-binary-format.md §22).`,
    );
  }

  // ---- Symbol timeline streams ---------------------------------------------
  for (const sym of symbols) {
    const num = symbolNumById.get(sym.id)!;
    streams.set(`Symbol ${num}`, writeTimelineStream(sym.timeline, idx));
  }

  // ---- Scene (Page N) streams ----------------------------------------------
  // Page N suffix = creation/storage order; play order = the Contents emit
  // order (we list scenes in authored order, and the page numbers follow the
  // same order here since this is a fresh write).
  const sceneEntries: ContentsSceneEntry[] = [];
  doc.scenes.forEach((scene, i) => {
    const pageStreamName = `Page ${i + 1}`;
    streams.set(
      pageStreamName,
      // Ruler guides are stored per-scene in the binary (each CPicPage tail); the
      // model carries a single doc-level list (the read side unions + de-dupes
      // across scenes — flash8-import.ts). Emit the doc guides into every scene so
      // a save→load round-trip recovers them. Symbol timelines get no guides.
      writeTimelineStream(
        scene.timeline,
        idx,
        swfBlobsByScene.get(i) ?? [],
        doc.properties.guides,
      ),
    );
    sceneEntries.push({ pageStreamName, sceneName: scene.name });
  });

  // ---- Contents catalog ----------------------------------------------------
  const symbolCatalog: ContentsSymbolEntry[] = symbols.map((sym) => ({
    num: symbolNumById.get(sym.id)!,
    displayName: sym.name,
    typeByte: TYPE_BYTE[sym.symbolType] ?? 2,
    linkageIdentifier: sym.linkage.linkageIdentifier,
    className: sym.linkage.className,
    exportForActionScript: sym.linkage.exportForActionScript,
    exportInFirstFrame: sym.linkage.exportInFirstFrame,
    exportForRuntimeSharing: sym.linkage.exportForRuntimeSharing,
    importForRuntimeSharing: sym.linkage.importForRuntimeSharing,
    fullPath: buildFullPath(doc, sym),
    scale9Grid: sym.scale9Grid
      ? {
          left: sym.scale9Grid.x,
          top: sym.scale9Grid.y,
          right: sym.scale9Grid.x + sym.scale9Grid.width,
          bottom: sym.scale9Grid.y + sym.scale9Grid.height,
        }
      : null,
  }));

  const contentsInput: ContentsInput = {
    formatVersion: FLA8_FORMAT_VERSION,
    widthPx: doc.properties.width,
    heightPx: doc.properties.height,
    frameRate: doc.properties.frameRate,
    backgroundHex: doc.properties.backgroundColor,
    gridHex: doc.properties.grid?.gridColor,
    gridSpacingPx: doc.properties.grid?.gridWidth,
    scenes: sceneEntries,
    symbols: symbolCatalog,
    media: mediaEntries,
  };
  streams.set("Contents", writeContents(contentsInput));

  return writeCfb(streams);
}

/**
 * Build the symbol's full library path ("FolderA!/SymbolName"). Folder names get
 * a trailing "!" so the importer's `stripFolderExpanded` recovers the name.
 */
function buildFullPath(
  doc: FlashDocument,
  sym: Extract<FlashDocument["library"]["items"][number], { itemType: "symbol" }>,
): string {
  // The model Symbol may carry an optional `folderId` (set by the importer's
  // folderOverride spread). Reconstruct the folder path when present.
  const folderById = new Map(doc.library.folders.map((f) => [f.id, f]));
  const segments: string[] = [];
  let fid = (sym as unknown as { folderId?: string | null }).folderId ?? null;
  const seen = new Set<string>();
  while (fid && !seen.has(fid)) {
    seen.add(fid);
    const f = folderById.get(fid);
    if (!f) break;
    segments.unshift(`${f.name}!`);
    fid = f.parentFolderId;
  }
  segments.push(sym.name);
  return segments.length > 1 ? segments.join("/") : "";
}

function dataUriToBytes(dataUri: string | undefined): Uint8Array | null {
  if (!dataUri || dataUri.startsWith("asset:")) return null;
  const comma = dataUri.indexOf(",");
  if (comma < 0) return null;
  const meta = dataUri.slice(0, comma);
  const payload = dataUri.slice(comma + 1);
  if (!meta.includes("base64")) return null;
  try {
    const bin = typeof atob === "function" ? atob(payload) : bufferFromBase64(payload);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function bufferFromBase64(b64: string): string {
  // Node fallback for environments without atob.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const B: any = (globalThis as any).Buffer;
  if (B) return B.from(b64, "base64").toString("binary");
  return "";
}
