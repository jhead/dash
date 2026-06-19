/**
 * @flash/agent-protocol
 *
 * Zod schemas and TypeScript types for the Flash editor MCP agent protocol.
 * Shared between the Vite MCP plugin (Node side) and the editor-side bridge
 * registry (browser side).
 *
 * Every tool from docs/19-agent-interface.md §Tool surface is represented here.
 * The `rev` counter is a number bumped on every pushDoc() call in the editor.
 * Read results include the rev they observed; mutating results include the new rev.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Revision counter
// ---------------------------------------------------------------------------

/** Monotonically increasing counter bumped on every document mutation. */
export const RevSchema = z.number().int().nonnegative();
export type Rev = z.infer<typeof RevSchema>;

// ---------------------------------------------------------------------------
// editor_status
// ---------------------------------------------------------------------------

export const EditorStatusParamsSchema = z.object({}).strict();
export type EditorStatusParams = z.infer<typeof EditorStatusParamsSchema>;

export const EditorStatusResultSchema = z.object({
  alive: z.boolean(),
  version: z.string(),
  docId: z.string(),
  docName: z.string(),
  width: z.number(),
  height: z.number(),
  frameRate: z.number(),
  backgroundColor: z.string(),
  frameCount: z.number(),
  layerCount: z.number(),
  sceneCount: z.number(),
  currentFrame: z.number(),
  activeLayerId: z.string().optional(),
  activeTool: z.string(),
  editContext: z.object({
    mode: z.enum(["document", "symbol"]),
    symbolId: z.string().optional(),
    symbolName: z.string().optional(),
  }),
  rev: RevSchema,
});
export type EditorStatusResult = z.infer<typeof EditorStatusResultSchema>;

// ---------------------------------------------------------------------------
// doc_get
// ---------------------------------------------------------------------------

export const DocGetParamsSchema = z.object({
  /** JSON Pointer (RFC 6901), e.g. "/scenes/0/timeline/layers/1".
   *  Empty string or omit for the full document. */
  path: z.string().optional(),
});
export type DocGetParams = z.infer<typeof DocGetParamsSchema>;

export const DocGetResultSchema = z.object({
  path: z.string(),
  value: z.unknown(),
  rev: RevSchema,
});
export type DocGetResult = z.infer<typeof DocGetResultSchema>;

// ---------------------------------------------------------------------------
// doc_summary
// ---------------------------------------------------------------------------

export const DocGetSummaryParamsSchema = z.object({}).strict();
export type DocGetSummaryParams = z.infer<typeof DocGetSummaryParamsSchema>;

export const KeyframeSummarySchema = z.object({
  index: z.number(),
  objectCount: z.number(),
  hasScript: z.boolean(),
  tween: z.string().nullable(),
  label: z.string().optional(),
});
export type KeyframeSummary = z.infer<typeof KeyframeSummarySchema>;

export const LayerSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  frameCount: z.number(),
  visible: z.boolean(),
  locked: z.boolean(),
  keyframes: z.array(KeyframeSummarySchema),
});
export type LayerSummary = z.infer<typeof LayerSummarySchema>;

export const SceneSummarySchema = z.object({
  index: z.number(),
  name: z.string(),
  layerCount: z.number(),
  frameCount: z.number(),
  layers: z.array(LayerSummarySchema),
});
export type SceneSummary = z.infer<typeof SceneSummarySchema>;

export const LibraryItemSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  folder: z.string().optional(),
});
export type LibraryItemSummary = z.infer<typeof LibraryItemSummarySchema>;

export const DocSummaryResultSchema = z.object({
  docId: z.string(),
  docName: z.string(),
  width: z.number(),
  height: z.number(),
  frameRate: z.number(),
  backgroundColor: z.string(),
  sceneCount: z.number(),
  scenes: z.array(SceneSummarySchema),
  libraryItemCount: z.number(),
  library: z.array(LibraryItemSummarySchema),
  rev: RevSchema,
});
export type DocSummaryResult = z.infer<typeof DocSummaryResultSchema>;

// ---------------------------------------------------------------------------
// doc_load
// ---------------------------------------------------------------------------

export const DocLoadParamsSchema = z.object({
  document: z.unknown(),
});
export type DocLoadParams = z.infer<typeof DocLoadParamsSchema>;

export const DocLoadResultSchema = z.object({
  ok: z.literal(true),
  rev: RevSchema,
});
export type DocLoadResult = z.infer<typeof DocLoadResultSchema>;

// ---------------------------------------------------------------------------
// doc_set_properties
// ---------------------------------------------------------------------------

export const DocSetPropertiesParamsSchema = z.object({
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  frameRate: z.number().positive().optional(),
  backgroundColor: z.string().optional(),
});
export type DocSetPropertiesParams = z.infer<typeof DocSetPropertiesParamsSchema>;

export const OkRevResultSchema = z.object({
  ok: z.literal(true),
  rev: RevSchema,
});
export type OkRevResult = z.infer<typeof OkRevResultSchema>;

// ---------------------------------------------------------------------------
// history_undo / history_redo / history_depth
// ---------------------------------------------------------------------------

export const HistoryUndoParamsSchema = z.object({}).strict();
export const HistoryRedoParamsSchema = z.object({}).strict();
export const HistoryDepthParamsSchema = z.object({}).strict();

export const HistoryDepthResultSchema = z.object({
  undo: z.number().int().nonnegative(),
  redo: z.number().int().nonnegative(),
});
export type HistoryDepthResult = z.infer<typeof HistoryDepthResultSchema>;

// ---------------------------------------------------------------------------
// Stage & selection
// ---------------------------------------------------------------------------

export const StageAddShapeParamsSchema = z.object({
  kind: z.enum(["rect", "oval", "line"]),
  x1: z.number(),
  y1: z.number(),
  x2: z.number(),
  y2: z.number(),
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().optional(),
  layerId: z.string().optional(),
  frameIndex: z.number().int().nonnegative().optional(),
});
export type StageAddShapeParams = z.infer<typeof StageAddShapeParamsSchema>;

export const StageAddTextParamsSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  text: z.string(),
  textType: z.enum(["static", "dynamic", "input"]).optional(),
  fontFamily: z.string().optional(),
  fontSize: z.number().positive().optional(),
  color: z.string().optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  align: z.enum(["left", "center", "right", "justify"]).optional(),
  layerId: z.string().optional(),
  frameIndex: z.number().int().nonnegative().optional(),
});
export type StageAddTextParams = z.infer<typeof StageAddTextParamsSchema>;

export const StageAddShapeResultSchema = z.object({
  id: z.string(),
  rev: RevSchema,
});
export type StageAddShapeResult = z.infer<typeof StageAddShapeResultSchema>;

export const StagePlaceInstanceParamsSchema = z.object({
  symbolId: z.string(),
  x: z.number(),
  y: z.number(),
  name: z.string().optional(),
  layerId: z.string().optional(),
  frameIndex: z.number().int().nonnegative().optional(),
});
export type StagePlaceInstanceParams = z.infer<typeof StagePlaceInstanceParamsSchema>;

export const StagePlaceInstanceResultSchema = z.object({
  id: z.string(),
  rev: RevSchema,
});
export type StagePlaceInstanceResult = z.infer<typeof StagePlaceInstanceResultSchema>;

export const StageAddVideoParamsSchema = z.object({
  videoItemId: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  layerId: z.string().optional(),
  frameIndex: z.number().int().nonnegative().optional(),
});
export type StageAddVideoParams = z.infer<typeof StageAddVideoParamsSchema>;

export const StageAddVideoResultSchema = z.object({
  id: z.string(),
  rev: RevSchema,
});
export type StageAddVideoResult = z.infer<typeof StageAddVideoResultSchema>;

export const StageAddBitmapParamsSchema = z.object({
  bitmapItemId: z.string().describe("Library BitmapItem id"),
  x: z.number(),
  y: z.number(),
  width: z.number().positive().optional().describe("Display width (defaults to native)"),
  height: z.number().positive().optional().describe("Display height (defaults to native)"),
  layerId: z.string().optional(),
  frameIndex: z.number().int().nonnegative().optional(),
});
export type StageAddBitmapParams = z.infer<typeof StageAddBitmapParamsSchema>;

export const StageUpdateParamsSchema = z.object({
  id: z.string(),
  layerId: z.string().optional(),
  frameIndex: z.number().int().nonnegative().optional(),
  updates: z.record(z.string(), z.unknown()),
  blendMode: z.string().optional().describe('Blend mode (normal, multiply, screen, overlay, etc.)'),
  loopMode: z.enum(['loop', 'play-once', 'single-frame']).optional(),
  firstFrame: z.number().int().min(0).optional(),
  colorEffect: z.object({ type: z.string() }).passthrough().optional().describe('Color effect (alpha, tint, brightness, advanced)'),
});
export type StageUpdateParams = z.infer<typeof StageUpdateParamsSchema>;

export const StageRemoveParamsSchema = z.object({
  ids: z.array(z.string()),
  layerId: z.string().optional(),
  frameIndex: z.number().int().nonnegative().optional(),
});
export type StageRemoveParams = z.infer<typeof StageRemoveParamsSchema>;

export const StageArrangeParamsSchema = z.object({
  ids: z.array(z.string()),
  op: z.enum(["front", "back", "forward", "backward"]),
  layerId: z.string().optional(),
  frameIndex: z.number().int().nonnegative().optional(),
});
export type StageArrangeParams = z.infer<typeof StageArrangeParamsSchema>;

export const StageGroupParamsSchema = z.object({
  ids: z.array(z.string()),
  layerId: z.string().optional(),
  frameIndex: z.number().int().nonnegative().optional(),
});
export type StageGroupParams = z.infer<typeof StageGroupParamsSchema>;

export const StageUngroupParamsSchema = z.object({
  id: z.string(),
  layerId: z.string().optional(),
  frameIndex: z.number().int().nonnegative().optional(),
});
export type StageUngroupParams = z.infer<typeof StageUngroupParamsSchema>;

export const SelectionGetParamsSchema = z.object({}).strict();
export const SelectionSetParamsSchema = z.object({
  ids: z.array(z.string()).optional(),
  all: z.boolean().optional(),
});
export type SelectionSetParams = z.infer<typeof SelectionSetParamsSchema>;

export const SelectionGetResultSchema = z.object({
  ids: z.array(z.string()),
  objects: z.array(z.unknown()),
});
export type SelectionGetResult = z.infer<typeof SelectionGetResultSchema>;

export const ViewSetParamsSchema = z.object({
  zoom: z.number().positive().optional(),
  panX: z.number().optional(),
  panY: z.number().optional(),
  currentFrame: z.number().int().nonnegative().optional(),
  activeLayerId: z.string().optional(),
});
export type ViewSetParams = z.infer<typeof ViewSetParamsSchema>;

export const ToolSelectParamsSchema = z.object({
  toolId: z.string(),
});
export type ToolSelectParams = z.infer<typeof ToolSelectParamsSchema>;

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export const TimelineAddLayerParamsSchema = z.object({
  name: z.string().optional(),
  type: z.enum(["normal", "guide", "guided", "mask", "masked", "folder"]).optional(),
});
export type TimelineAddLayerParams = z.infer<typeof TimelineAddLayerParamsSchema>;

export const TimelineAddLayerResultSchema = z.object({
  layerId: z.string(),
  rev: RevSchema,
});
export type TimelineAddLayerResult = z.infer<typeof TimelineAddLayerResultSchema>;

export const TimelineRemoveLayerParamsSchema = z.object({
  layerId: z.string(),
});
export type TimelineRemoveLayerParams = z.infer<typeof TimelineRemoveLayerParamsSchema>;

export const TimelineUpdateLayerParamsSchema = z.object({
  layerId: z.string(),
  name: z.string().optional(),
  locked: z.boolean().optional(),
  visible: z.boolean().optional(),
  type: z.enum(["normal", "guide", "guided", "mask", "masked", "folder"]).optional(),
});
export type TimelineUpdateLayerParams = z.infer<typeof TimelineUpdateLayerParamsSchema>;

export const TimelineFrameParamsSchema = z.object({
  layerId: z.string(),
  frameIndex: z.number().int().nonnegative(),
});
export type TimelineFrameParams = z.infer<typeof TimelineFrameParamsSchema>;

export const TimelineSetFrameLabelParamsSchema = z.object({
  layerId: z.string(),
  frameIndex: z.number().int().nonnegative(),
  label: z.string(),
  labelType: z.enum(["name", "comment", "anchor"]).optional(),
});
export type TimelineSetFrameLabelParams = z.infer<typeof TimelineSetFrameLabelParamsSchema>;

export const TimelineSetTweenParamsSchema = z.object({
  layerId: z.string(),
  frameIndex: z.number().int().nonnegative(),
  kind: z.enum(["motion", "shape"]).nullable(),
  props: z.record(z.string(), z.unknown()).optional(),
});
export type TimelineSetTweenParams = z.infer<typeof TimelineSetTweenParamsSchema>;

export const TimelineGotoFrameParamsSchema = z.object({
  frameIndex: z.number().int().nonnegative(),
});
export type TimelineGotoFrameParams = z.infer<typeof TimelineGotoFrameParamsSchema>;

export const TimelineSetSoundParamsSchema = z.object({
  layerId: z.string(),
  frameIndex: z.number().int().nonnegative(),
  libraryItemId: z
    .string()
    .nullable()
    .describe("Library sound item id to attach, or null to clear the frame sound"),
  syncMode: z.enum(["event", "start", "stop", "stream"]).optional(),
  repeatCount: z.number().int().nonnegative().optional(),
});
export type TimelineSetSoundParams = z.infer<typeof TimelineSetSoundParamsSchema>;

// ---------------------------------------------------------------------------
// Code (AS2)
// ---------------------------------------------------------------------------

export const DiagnosticSchema = z.object({
  message: z.string(),
  line: z.number().optional(),
  column: z.number().optional(),
  severity: z.enum(["error", "warning"]).optional(),
});
export type Diagnostic = z.infer<typeof DiagnosticSchema>;

export const ScriptGetParamsSchema = z.object({
  layerId: z.string(),
  frameIndex: z.number().int().nonnegative(),
});
export type ScriptGetParams = z.infer<typeof ScriptGetParamsSchema>;

export const ScriptGetResultSchema = z.object({
  script: z.string(),
  layerId: z.string(),
  frameIndex: z.number(),
  rev: RevSchema,
});
export type ScriptGetResult = z.infer<typeof ScriptGetResultSchema>;

export const ScriptSetParamsSchema = z.object({
  layerId: z.string(),
  frameIndex: z.number().int().nonnegative(),
  script: z.string(),
});
export type ScriptSetParams = z.infer<typeof ScriptSetParamsSchema>;

export const ScriptSetResultSchema = z.object({
  /** Always true — the script is saved regardless of compile errors (Flash 8 parity).
   *  Inspect `diagnostics` to learn whether the saved script has errors or warnings. */
  ok: z.literal(true),
  rev: RevSchema,
  diagnostics: z.array(DiagnosticSchema),
});
export type ScriptSetResult = z.infer<typeof ScriptSetResultSchema>;

export const ScriptCheckParamsSchema = z.object({
  script: z.string(),
});
export type ScriptCheckParams = z.infer<typeof ScriptCheckParamsSchema>;

export const ScriptCheckResultSchema = z.object({
  diagnostics: z.array(DiagnosticSchema),
});
export type ScriptCheckResult = z.infer<typeof ScriptCheckResultSchema>;

export const ScriptListParamsSchema = z.object({}).strict();

export const ScriptListItemSchema = z.object({
  sceneIndex: z.number(),
  layerId: z.string(),
  layerName: z.string(),
  frameIndex: z.number(),
  preview: z.string(),
});
export type ScriptListItem = z.infer<typeof ScriptListItemSchema>;

export const ScriptListResultSchema = z.object({
  scripts: z.array(ScriptListItemSchema),
  rev: RevSchema,
});
export type ScriptListResult = z.infer<typeof ScriptListResultSchema>;

// ---------------------------------------------------------------------------
// AS2 external classes (doc.asClasses VFS)
// ---------------------------------------------------------------------------

/** A classpath-relative `.as` path, e.g. `com/example/Foo.as`. */
const ClassPathSchema = z
  .string()
  .min(1)
  .describe("Classpath-relative path with forward slashes, e.g. com/example/Foo.as");

export const ClassListParamsSchema = z.object({}).strict();

export const ClassListItemSchema = z.object({
  /** Classpath-relative path of the `.as` file. */
  path: z.string(),
  /** Fully-qualified AS2 class name (e.g. com.example.Foo), derived from the
   *  parsed class declaration or, failing that, from the path. */
  className: z.string(),
});
export type ClassListItem = z.infer<typeof ClassListItemSchema>;

export const ClassListResultSchema = z.object({
  classes: z.array(ClassListItemSchema),
  rev: RevSchema,
});
export type ClassListResult = z.infer<typeof ClassListResultSchema>;

export const ClassGetParamsSchema = z.object({
  path: ClassPathSchema,
});
export type ClassGetParams = z.infer<typeof ClassGetParamsSchema>;

export const ClassGetResultSchema = z.object({
  path: z.string(),
  source: z.string(),
  rev: RevSchema,
});
export type ClassGetResult = z.infer<typeof ClassGetResultSchema>;

export const ClassSetParamsSchema = z.object({
  path: ClassPathSchema,
  source: z.string().describe("Full UTF-8 source text of the .as file"),
});
export type ClassSetParams = z.infer<typeof ClassSetParamsSchema>;

export const ClassSetResultSchema = z.object({
  /** Always true — the class is saved regardless of parse errors (Flash 8
   *  parity with script_set). Inspect `diagnostics` for parse errors/warnings. */
  ok: z.literal(true),
  rev: RevSchema,
  diagnostics: z.array(DiagnosticSchema),
});
export type ClassSetResult = z.infer<typeof ClassSetResultSchema>;

export const ClassRemoveParamsSchema = z.object({
  path: ClassPathSchema,
});
export type ClassRemoveParams = z.infer<typeof ClassRemoveParamsSchema>;

export const ClassRemoveResultSchema = z.object({
  ok: z.literal(true),
  rev: RevSchema,
});
export type ClassRemoveResult = z.infer<typeof ClassRemoveResultSchema>;

export const ClassCheckParamsSchema = z.object({
  source: z.string().describe("AS2 class source to parse-check (not written)"),
});
export type ClassCheckParams = z.infer<typeof ClassCheckParamsSchema>;

export const ClassCheckResultSchema = z.object({
  diagnostics: z.array(DiagnosticSchema),
});
export type ClassCheckResult = z.infer<typeof ClassCheckResultSchema>;

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

export const LibraryListParamsSchema = z.object({}).strict();

export const LibraryListResultSchema = z.object({
  items: z.array(LibraryItemSummarySchema),
  rev: RevSchema,
});
export type LibraryListResult = z.infer<typeof LibraryListResultSchema>;

export const LibraryCreateSymbolParamsSchema = z.object({
  name: z.string(),
  symbolType: z.enum(["movieclip", "button", "graphic"]),
});
export type LibraryCreateSymbolParams = z.infer<typeof LibraryCreateSymbolParamsSchema>;

export const LibraryCreateSymbolResultSchema = z.object({
  symbolId: z.string(),
  rev: RevSchema,
});
export type LibraryCreateSymbolResult = z.infer<typeof LibraryCreateSymbolResultSchema>;

export const LibraryConvertToSymbolParamsSchema = z.object({
  ids: z.array(z.string()),
  name: z.string(),
  symbolType: z.enum(["movieclip", "button", "graphic"]),
  layerId: z.string().optional(),
  frameIndex: z.number().int().nonnegative().optional(),
});
export type LibraryConvertToSymbolParams = z.infer<typeof LibraryConvertToSymbolParamsSchema>;

export const LibraryConvertToSymbolResultSchema = z.object({
  symbolId: z.string(),
  instanceId: z.string(),
  rev: RevSchema,
});
export type LibraryConvertToSymbolResult = z.infer<typeof LibraryConvertToSymbolResultSchema>;

export const LibraryImportBitmapParamsSchema = z.object({
  data: z.string().describe("Base64-encoded image data"),
  name: z.string().optional().describe("Library item name (auto-generated if omitted)"),
  mimeType: z.string().optional().describe("MIME type e.g. image/png or image/jpeg"),
});
export type LibraryImportBitmapParams = z.infer<typeof LibraryImportBitmapParamsSchema>;

export const LibraryImportBitmapResultSchema = z.object({
  itemId: z.string(),
  rev: RevSchema,
});
export type LibraryImportBitmapResult = z.infer<typeof LibraryImportBitmapResultSchema>;

export const LibraryImportSoundParamsSchema = z.object({
  data: z.string().describe("Base64-encoded audio data"),
  name: z.string().describe("Library item name"),
  mimeType: z.string().optional().describe("MIME type e.g. audio/mp3 or audio/wav"),
});
export type LibraryImportSoundParams = z.infer<typeof LibraryImportSoundParamsSchema>;

export const LibraryImportSoundResultSchema = z.object({
  itemId: z.string(),
  rev: RevSchema,
});
export type LibraryImportSoundResult = z.infer<typeof LibraryImportSoundResultSchema>;

export const LibraryRenameParamsSchema = z.object({
  itemId: z.string(),
  name: z.string(),
});
export type LibraryRenameParams = z.infer<typeof LibraryRenameParamsSchema>;

export const LibraryRemoveParamsSchema = z.object({
  itemId: z.string(),
});
export type LibraryRemoveParams = z.infer<typeof LibraryRemoveParamsSchema>;

export const LibrarySetLinkageParamsSchema = z.object({
  symbolId: z.string(),
  linkageId: z.string().optional().describe("attachMovie / new ClassName identifier"),
  className: z.string().optional().describe("AS2 class name to associate with this symbol (e.g. com.example.Enemy), linking it to an external AS2 class file"),
  exportForActionScript: z.boolean().optional().describe("Export this symbol for ActionScript (enables attachMovie / new ClassName)"),
  exportInFirstFrame: z.boolean().optional().describe("Export the symbol in the first frame of the SWF"),
}).refine(
  (data) =>
    data.linkageId !== undefined ||
    data.className !== undefined ||
    data.exportForActionScript !== undefined ||
    data.exportInFirstFrame !== undefined,
  { message: "At least one of linkageId, className, exportForActionScript, or exportInFirstFrame must be provided" }
);
export type LibrarySetLinkageParams = z.infer<typeof LibrarySetLinkageParamsSchema>;

export const LibrarySetLinkageResultSchema = z.object({
  ok: z.literal(true),
  rev: RevSchema,
});
export type LibrarySetLinkageResult = z.infer<typeof LibrarySetLinkageResultSchema>;

// ---------------------------------------------------------------------------
// Scene commands
// ---------------------------------------------------------------------------

export const SceneAddParamsSchema = z.object({
  name: z.string().optional(),
});
export type SceneAddParams = z.infer<typeof SceneAddParamsSchema>;

export const SceneAddResultSchema = z.object({
  sceneIndex: z.number().int().nonnegative(),
  sceneName: z.string(),
  rev: RevSchema,
});
export type SceneAddResult = z.infer<typeof SceneAddResultSchema>;

export const SceneRemoveParamsSchema = z.object({
  index: z.number().int().nonnegative(),
});
export type SceneRemoveParams = z.infer<typeof SceneRemoveParamsSchema>;

export const SceneRenameParamsSchema = z.object({
  index: z.number().int().nonnegative(),
  name: z.string(),
});
export type SceneRenameParams = z.infer<typeof SceneRenameParamsSchema>;

export const SceneDuplicateParamsSchema = z.object({}).strict();
export type SceneDuplicateParams = z.infer<typeof SceneDuplicateParamsSchema>;

export const SceneDuplicateResultSchema = z.object({
  sceneIndex: z.number().int().nonnegative(),
  sceneName: z.string(),
  rev: RevSchema,
});
export type SceneDuplicateResult = z.infer<typeof SceneDuplicateResultSchema>;

export const SceneSelectParamsSchema = z.object({
  index: z.number().int().nonnegative(),
});
export type SceneSelectParams = z.infer<typeof SceneSelectParamsSchema>;

// ---------------------------------------------------------------------------
// Output & escape hatches
// ---------------------------------------------------------------------------

export const JsflRunParamsSchema = z.object({
  source: z.string(),
});
export type JsflRunParams = z.infer<typeof JsflRunParamsSchema>;

export const JsflRunResultSchema = z.object({
  traces: z.array(z.string()),
  returnValue: z.unknown().optional(),
  error: z.string().optional(),
  rev: RevSchema,
});
export type JsflRunResult = z.infer<typeof JsflRunResultSchema>;

export const StageScreenshotParamsSchema = z.object({
  frameIndex: z.number().int().nonnegative().optional(),
});
export type StageScreenshotParams = z.infer<typeof StageScreenshotParamsSchema>;

export const PublishSwfParamsSchema = z.object({}).strict();

export const PublishSwfResultSchema = z.object({
  /** Compile succeeded (the SWF bytes were produced). */
  ok: z.boolean(),
  /** Stage width in px (from doc.properties) — a model-useful summary field. */
  width: z.number(),
  /** Stage height in px (from doc.properties). */
  height: z.number(),
  /** Raw compiled SWF byte count. */
  byteLength: z.number(),
  /**
   * The ENTIRE compiled SWF, base64-encoded, for the app/UI side (download /
   * preview). This is NOT delivered to the model: the agent-chat tool's
   * `toModelOutput` returns only the `{ ok, byteLength, width, height }` summary,
   * so this large blob never enters the model's text context (task 1306).
   */
  swfBase64: z.string(),
});
export type PublishSwfResult = z.infer<typeof PublishSwfResultSchema>;

export const FileSaveFlaParamsSchema = z.object({}).strict();

export const FileSaveFlaResultSchema = z.object({
  flaBase64: z.string(),
  byteLength: z.number(),
});
export type FileSaveFlaResult = z.infer<typeof FileSaveFlaResultSchema>;

export const FileLoadFlaParamsSchema = z.object({
  flaBase64: z.string(),
});
export type FileLoadFlaParams = z.infer<typeof FileLoadFlaParamsSchema>;

// ---------------------------------------------------------------------------
// Timeline copy/paste frames
// ---------------------------------------------------------------------------

export const TimelineCopyFramesParamsSchema = z.object({
  startFrame: z.number().int().min(0).optional().describe('First frame index to copy (0-based, defaults to current frame)'),
  endFrame: z.number().int().min(0).optional().describe('Last frame index to copy (inclusive, defaults to startFrame)'),
  layerIndex: z.number().int().min(0).optional().describe('Layer index (defaults to all layers)'),
});
export type TimelineCopyFramesParams = z.infer<typeof TimelineCopyFramesParamsSchema>;
export const TimelineCopyFramesResultSchema = z.object({ success: z.literal(true) });
export type TimelineCopyFramesResult = z.infer<typeof TimelineCopyFramesResultSchema>;

export const TimelinePasteFramesParamsSchema = z.object({
  frameIndex: z.number().int().min(0).optional().describe('Destination frame index (0-based, defaults to current frame)'),
  replaceFrames: z.boolean().optional().describe('Replace existing frames instead of inserting'),
});
export type TimelinePasteFramesParams = z.infer<typeof TimelinePasteFramesParamsSchema>;
export const TimelinePasteFramesResultSchema = z.object({ success: z.literal(true) });
export type TimelinePasteFramesResult = z.infer<typeof TimelinePasteFramesResultSchema>;

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export const FilterAddParamsSchema = z.object({
  type: z.enum(['dropShadow', 'blur', 'glow', 'bevel', 'gradientGlow', 'gradientBevel', 'colorMatrix']).describe('Filter type'),
  enabled: z.boolean().optional().describe('Whether filter is enabled (default true)'),
  ids: z.array(z.string()).optional().describe('Target object ids (defaults to current selection)'),
  layerId: z.string().optional().describe('Layer id (defaults to active layer)'),
  frameIndex: z.number().int().nonnegative().optional().describe('Frame index (defaults to current frame)'),
  // Common filter params (all optional):
  blurX: z.number().optional(),
  blurY: z.number().optional(),
  strength: z.number().optional(),
  angle: z.number().optional(),
  distance: z.number().optional(),
  quality: z.number().optional(),
  color: z.string().optional().describe('#RRGGBB color'),
  alpha: z.number().optional().describe('0-1'),
  inner: z.boolean().optional(),
  knockout: z.boolean().optional(),
  hideObject: z.boolean().optional(),
});
export type FilterAddParams = z.infer<typeof FilterAddParamsSchema>;
export const FilterAddResultSchema = z.object({ success: z.literal(true), rev: z.number() });
export type FilterAddResult = z.infer<typeof FilterAddResultSchema>;

export const FilterRemoveParamsSchema = z.object({
  index: z.number().int().min(0).describe('0-based filter index to remove'),
  ids: z.array(z.string()).optional().describe('Target object ids (defaults to current selection)'),
  layerId: z.string().optional().describe('Layer id (defaults to active layer)'),
  frameIndex: z.number().int().nonnegative().optional().describe('Frame index (defaults to current frame)'),
});
export type FilterRemoveParams = z.infer<typeof FilterRemoveParamsSchema>;
export const FilterRemoveResultSchema = z.object({ success: z.literal(true), rev: z.number() });
export type FilterRemoveResult = z.infer<typeof FilterRemoveResultSchema>;

export const FilterListParamsSchema = z.object({
  id: z.string().optional().describe('Object id to query (defaults to first selected object)'),
  layerId: z.string().optional().describe('Layer id (defaults to active layer)'),
  frameIndex: z.number().int().nonnegative().optional().describe('Frame index (defaults to current frame)'),
});
export type FilterListParams = z.infer<typeof FilterListParamsSchema>;
export const FilterListResultSchema = z.object({ filters: z.array(z.any()), rev: z.number() });
export type FilterListResult = z.infer<typeof FilterListResultSchema>;

// ---------------------------------------------------------------------------
// stage_move_selection
// ---------------------------------------------------------------------------

export const StageMoveSelectionParamsSchema = z.object({
  dx: z.number().describe('Horizontal delta in pixels'),
  dy: z.number().describe('Vertical delta in pixels'),
})
export type StageMoveSelectionParams = z.infer<typeof StageMoveSelectionParamsSchema>

export const StageMoveSelectionResultSchema = z.object({ movedCount: z.number() })
export type StageMoveSelectionResult = z.infer<typeof StageMoveSelectionResultSchema>

// ---------------------------------------------------------------------------
// scene_reorder
// ---------------------------------------------------------------------------

export const SceneReorderParamsSchema = z.object({
  sceneIndex: z.number().int().min(0).describe('0-based index of scene to move'),
  insertBefore: z.number().int().min(0).describe('0-based index to insert before (-1 or large = end)'),
})
export type SceneReorderParams = z.infer<typeof SceneReorderParamsSchema>

export const SceneReorderResultSchema = z.object({ ok: z.boolean() })
export type SceneReorderResult = z.infer<typeof SceneReorderResultSchema>

// ---------------------------------------------------------------------------
// stage_find_instances
// ---------------------------------------------------------------------------

export const StageFindInstancesParamsSchema = z.object({
  symbolName: z.string().describe('Library item name to search for'),
})
export type StageFindInstancesParams = z.infer<typeof StageFindInstancesParamsSchema>

export const StageFindInstancesResultSchema = z.object({
  instances: z.array(z.object({
    id: z.string(),
    x: z.number(),
    y: z.number(),
    layerIndex: z.number(),
    frameIndex: z.number(),
    sceneIndex: z.number(),
  }))
})
export type StageFindInstancesResult = z.infer<typeof StageFindInstancesResultSchema>

// ---------------------------------------------------------------------------
// stage_get_bounds
// ---------------------------------------------------------------------------

export const StageGetBoundsParamsSchema = z.object({
  id: z.string().describe('Display object id'),
})
export type StageGetBoundsParams = z.infer<typeof StageGetBoundsParamsSchema>

export const StageGetBoundsResultSchema = z.object({
  x: z.number(), y: z.number(), width: z.number(), height: z.number(),
})
export type StageGetBoundsResult = z.infer<typeof StageGetBoundsResultSchema>

// ---------------------------------------------------------------------------
// stage_duplicate
// ---------------------------------------------------------------------------

export const StageDuplicateParamsSchema = z.object({
  ids: z.array(z.string()).describe('Display object ids to duplicate'),
  offsetX: z.number().optional().default(10).describe('X offset for duplicates'),
  offsetY: z.number().optional().default(10).describe('Y offset for duplicates'),
})
export type StageDuplicateParams = z.infer<typeof StageDuplicateParamsSchema>

export const StageDuplicateResultSchema = z.object({
  duplicatedIds: z.array(z.string()),
})
export type StageDuplicateResult = z.infer<typeof StageDuplicateResultSchema>

// ---------------------------------------------------------------------------
// library_use_count
// ---------------------------------------------------------------------------

export const LibraryUseCountParamsSchema = z.object({
  name: z.string().describe('Library item name'),
})
export type LibraryUseCountParams = z.infer<typeof LibraryUseCountParamsSchema>

export const LibraryUseCountResultSchema = z.object({ count: z.number() })
export type LibraryUseCountResult = z.infer<typeof LibraryUseCountResultSchema>

// ---------------------------------------------------------------------------
// Bridge message envelope
// ---------------------------------------------------------------------------

/** The private WS bridge between the Vite plugin and the editor page.
 *  Not a public protocol — only used internally by this package.
 */

export const ALL_COMMANDS = [
  // session & document
  "editor_status",
  "doc_get",
  "doc_summary",
  "doc_load",
  "doc_set_properties",
  "history_undo",
  "history_redo",
  "history_depth",
  // stage & selection
  "stage_add_shape",
  "stage_add_text",
  "stage_place_instance",
  "stage_add_video",
  "stage_add_bitmap",
  "stage_update",
  "stage_remove",
  "stage_arrange",
  "stage_group",
  "stage_ungroup",
  "selection_get",
  "selection_set",
  "view_set",
  "tool_select",
  // timeline
  "timeline_add_layer",
  "timeline_remove_layer",
  "timeline_update_layer",
  "timeline_insert_frame",
  "timeline_insert_keyframe",
  "timeline_insert_blank_keyframe",
  "timeline_remove_frame",
  "timeline_set_frame_label",
  "timeline_set_tween",
  "timeline_set_sound",
  "timeline_goto_frame",
  "timeline_copy_frames",
  "timeline_paste_frames",
  "playback_play",
  "playback_stop",
  // code
  "script_get",
  "script_set",
  "script_check",
  "script_list",
  // AS2 external classes
  "class_list",
  "class_get",
  "class_set",
  "class_remove",
  "class_check",
  // library
  "library_list",
  "library_create_symbol",
  "library_convert_to_symbol",
  "library_rename",
  "library_remove",
  "library_import_bitmap",
  "library_import_sound",
  "library_set_linkage",
  // filters
  "filter_add",
  "filter_remove",
  "filter_list",
  // output & escape hatches
  "jsfl_run",
  "stage_screenshot",
  "publish_swf",
  "file_save_fla",
  "file_load_fla",
  // scene management
  "scene_add",
  "scene_remove",
  "scene_rename",
  "scene_select",
  "scene_duplicate",
  "scene_reorder",
  // stage utilities
  "stage_move_selection",
  "stage_find_instances",
  "stage_get_bounds",
  "stage_duplicate",
  // library utilities
  "library_use_count",
] as const;

export type AgentCommand = (typeof ALL_COMMANDS)[number];

// ---------------------------------------------------------------------------
// Command registry (single source of truth: name → params schema + description)
//
// This is the programmatic registry that transport layers enumerate. The MCP
// plugin hand-codes its own tool surface, but any generic consumer (e.g. the
// in-browser Agent Chat tool bridge) builds its tool set by iterating
// COMMAND_SCHEMAS: one entry per ALL_COMMANDS, mapping the command name to the
// Zod schema for its params. Paramless commands map to an empty strict object.
// ---------------------------------------------------------------------------

/**
 * Map of every agent command name to the Zod schema describing its params.
 *
 * Exactly covers ALL_COMMANDS (verified by a unit test). Several commands share
 * a schema: the four `timeline_insert_*` / `timeline_remove_frame` ops all take
 * `{ layerId, frameIndex }` (TimelineFrameParamsSchema), and `playback_play` /
 * `playback_stop` take no params (empty strict object).
 */
export const COMMAND_SCHEMAS = {
  // session & document
  editor_status: EditorStatusParamsSchema,
  doc_get: DocGetParamsSchema,
  doc_summary: DocGetSummaryParamsSchema,
  doc_load: DocLoadParamsSchema,
  doc_set_properties: DocSetPropertiesParamsSchema,
  history_undo: HistoryUndoParamsSchema,
  history_redo: HistoryRedoParamsSchema,
  history_depth: HistoryDepthParamsSchema,
  // stage & selection
  stage_add_shape: StageAddShapeParamsSchema,
  stage_add_text: StageAddTextParamsSchema,
  stage_place_instance: StagePlaceInstanceParamsSchema,
  stage_add_video: StageAddVideoParamsSchema,
  stage_add_bitmap: StageAddBitmapParamsSchema,
  stage_update: StageUpdateParamsSchema,
  stage_remove: StageRemoveParamsSchema,
  stage_arrange: StageArrangeParamsSchema,
  stage_group: StageGroupParamsSchema,
  stage_ungroup: StageUngroupParamsSchema,
  selection_get: SelectionGetParamsSchema,
  selection_set: SelectionSetParamsSchema,
  view_set: ViewSetParamsSchema,
  tool_select: ToolSelectParamsSchema,
  // timeline
  timeline_add_layer: TimelineAddLayerParamsSchema,
  timeline_remove_layer: TimelineRemoveLayerParamsSchema,
  timeline_update_layer: TimelineUpdateLayerParamsSchema,
  timeline_insert_frame: TimelineFrameParamsSchema,
  timeline_insert_keyframe: TimelineFrameParamsSchema,
  timeline_insert_blank_keyframe: TimelineFrameParamsSchema,
  timeline_remove_frame: TimelineFrameParamsSchema,
  timeline_set_frame_label: TimelineSetFrameLabelParamsSchema,
  timeline_set_tween: TimelineSetTweenParamsSchema,
  timeline_set_sound: TimelineSetSoundParamsSchema,
  timeline_goto_frame: TimelineGotoFrameParamsSchema,
  timeline_copy_frames: TimelineCopyFramesParamsSchema,
  timeline_paste_frames: TimelinePasteFramesParamsSchema,
  playback_play: z.object({}).strict(),
  playback_stop: z.object({}).strict(),
  // code
  script_get: ScriptGetParamsSchema,
  script_set: ScriptSetParamsSchema,
  script_check: ScriptCheckParamsSchema,
  script_list: ScriptListParamsSchema,
  // AS2 external classes
  class_list: ClassListParamsSchema,
  class_get: ClassGetParamsSchema,
  class_set: ClassSetParamsSchema,
  class_remove: ClassRemoveParamsSchema,
  class_check: ClassCheckParamsSchema,
  // library
  library_list: LibraryListParamsSchema,
  library_create_symbol: LibraryCreateSymbolParamsSchema,
  library_convert_to_symbol: LibraryConvertToSymbolParamsSchema,
  library_rename: LibraryRenameParamsSchema,
  library_remove: LibraryRemoveParamsSchema,
  library_import_bitmap: LibraryImportBitmapParamsSchema,
  library_import_sound: LibraryImportSoundParamsSchema,
  library_set_linkage: LibrarySetLinkageParamsSchema,
  // filters
  filter_add: FilterAddParamsSchema,
  filter_remove: FilterRemoveParamsSchema,
  filter_list: FilterListParamsSchema,
  // output & escape hatches
  jsfl_run: JsflRunParamsSchema,
  stage_screenshot: StageScreenshotParamsSchema,
  publish_swf: PublishSwfParamsSchema,
  file_save_fla: FileSaveFlaParamsSchema,
  file_load_fla: FileLoadFlaParamsSchema,
  // scene management
  scene_add: SceneAddParamsSchema,
  scene_remove: SceneRemoveParamsSchema,
  scene_rename: SceneRenameParamsSchema,
  scene_select: SceneSelectParamsSchema,
  scene_duplicate: SceneDuplicateParamsSchema,
  scene_reorder: SceneReorderParamsSchema,
  // stage utilities
  stage_move_selection: StageMoveSelectionParamsSchema,
  stage_find_instances: StageFindInstancesParamsSchema,
  stage_get_bounds: StageGetBoundsParamsSchema,
  stage_duplicate: StageDuplicateParamsSchema,
  // library utilities
  library_use_count: LibraryUseCountParamsSchema,
} satisfies Record<AgentCommand, z.ZodType>;

/**
 * One-line, model-facing description of each command. Used as the AI SDK tool
 * `description` so an LLM can pick the right tool. Concise but specific about
 * what the command reads/mutates and what it returns. Covers ALL_COMMANDS.
 */
export const COMMAND_DESCRIPTIONS = {
  // session & document
  editor_status:
    "Read editor status: alive flag, document name/size/fps/bg-color, scene/layer/frame counts, active tool, edit context, and the document revision (rev). Cheap; call to orient.",
  doc_get:
    "Read the document or a subtree at a JSON Pointer path (e.g. /scenes/0/timeline/layers/1). Omit path for the full document — prefer doc_summary first; the full doc can be very large.",
  doc_summary:
    "Read a token-light outline of the document: scenes -> layers (id, name, type, frameCount) -> keyframes (index, objectCount, hasScript, tween) plus the library list. The recommended first call before authoring.",
  doc_load: "Replace the current document with the provided document JSON (pushes to history).",
  doc_set_properties:
    "Update document properties: width, height, frameRate, backgroundColor (#RRGGBB). Returns ok and rev.",
  history_undo: "Undo the last document mutation. Returns ok and rev.",
  history_redo: "Redo the last undone mutation. Returns ok and rev.",
  history_depth: "Read the number of available undo and redo steps.",
  // stage & selection
  stage_add_shape:
    "Add a primitive shape (rect, oval, or line) to the active layer/frame with fill/stroke colors (#RRGGBB[AA]). Returns the new object id and rev.",
  stage_add_text:
    "Add a text object to the stage (static/dynamic/input) with text, position, font, size, and color. Returns the new object id and rev.",
  stage_place_instance:
    "Place a library symbol instance on the stage at a position, with optional name/transform and graphic loop mode. Returns the new object id and rev.",
  stage_add_video:
    "Place a library VideoItem on the stage as a video display object (defaults to native size). Returns the new object id and rev.",
  stage_add_bitmap:
    "Place a library BitmapItem on the stage as a bitmap display object (defaults to native size). Returns the new object id and rev.",
  stage_update:
    "Update properties of a display object (x, y, scaleX, scaleY, rotation, alpha, text, blendMode, colorEffect, cacheAsBitmap, etc.). Returns ok and rev.",
  stage_remove: "Remove display objects by id. Returns ok and rev.",
  stage_arrange: "Change z-order of display objects: front/back/forward/backward. Returns ok and rev.",
  stage_group: "Group display objects into a single group object. Returns ok and rev.",
  stage_ungroup: "Ungroup a group, returning its children to the frame. Returns ok and rev.",
  selection_get: "Read the currently selected object ids and their data.",
  selection_set: "Set the stage selection by id list, or pass all:true to select everything. Returns ok.",
  view_set: "Update the viewport: zoom, pan, current frame, or active layer. Returns ok.",
  tool_select:
    "Select the active drawing/editing tool by id (e.g. selection, pen, rectangle, oval, text). Returns ok.",
  // timeline
  timeline_add_layer: "Add a new layer to the active timeline. Returns the new layerId and rev.",
  timeline_remove_layer: "Remove a layer by id. Returns ok and rev.",
  timeline_update_layer: "Rename, lock, hide, or change the type of a layer. Returns ok and rev.",
  timeline_insert_frame:
    "Insert a regular (in-between) frame at frameIndex on a layer, extending the governing keyframe. Returns ok and rev.",
  timeline_insert_keyframe:
    "Insert a keyframe at frameIndex, copying content from the governing keyframe. Returns ok and rev.",
  timeline_insert_blank_keyframe: "Insert an empty keyframe at frameIndex on a layer. Returns ok and rev.",
  timeline_remove_frame: "Remove the frame at frameIndex on a layer. Returns ok and rev.",
  timeline_set_frame_label:
    "Set the label (and optional labelType: name/comment/anchor) on a keyframe. Returns ok and rev.",
  timeline_set_tween:
    "Set or clear a motion/shape tween on a keyframe span (pass kind:null to clear). Returns ok and rev.",
  timeline_set_sound:
    "Attach a library sound to a frame (with syncMode and repeatCount), or pass libraryItemId:null to clear it. Returns ok and rev.",
  timeline_goto_frame: "Move the playhead to frameIndex (0-based). Returns ok and rev.",
  timeline_copy_frames: "Copy a span of frames on a layer to an internal clipboard. Returns ok.",
  timeline_paste_frames: "Paste previously copied frames at a target layer/frame. Returns ok and rev.",
  playback_play: "Start timeline playback in the editor. Returns ok.",
  playback_stop: "Stop timeline playback in the editor. Returns ok.",
  // code
  script_get: "Read the AS2 frame/object script at a given location. Returns the source text.",
  script_set: "Set the AS2 frame/object script at a given location. Returns ok and rev.",
  script_check: "Compile-check an AS2 script, returning diagnostics (errors/warnings) without applying it.",
  script_list: "List all scripts in the document with their locations.",
  // AS2 external classes
  class_list:
    "List the document's external AS2 class files: each entry has the classpath-relative path (e.g. com/example/Foo.as) and the fully-qualified class name.",
  class_get:
    "Read the source of an external AS2 class file by its classpath-relative path. Errors if no class exists at that path.",
  class_set:
    "Create or replace an external AS2 class file at a classpath-relative path. Parse-checks the source (the class is saved regardless, Flash 8 parity) and returns ok, rev, and diagnostics.",
  class_remove: "Remove an external AS2 class file by its classpath-relative path. Returns ok and rev.",
  class_check:
    "Parse-check AS2 class source, returning diagnostics (errors/warnings) without writing it.",
  // library
  library_list: "Read the library contents (symbols, bitmaps, sounds, etc.) with ids, names, and types.",
  library_create_symbol:
    "Create a new empty library symbol (movieclip/graphic/button). Returns the new symbol id and rev.",
  library_convert_to_symbol:
    "Convert selected stage objects into a new library symbol and replace them with an instance. Returns the new symbol id and rev.",
  library_rename: "Rename a library item by id. Returns ok and rev.",
  library_remove: "Remove a library item by id. Returns ok and rev.",
  library_import_bitmap:
    "Import a base64-encoded image into the library as a BitmapItem. Returns the new item id and rev.",
  library_import_sound:
    "Import base64-encoded audio into the library as a SoundItem. Returns the new item id and rev.",
  library_set_linkage:
    "Set AS2 linkage on a symbol (linkageId, className, and export flags) for attachMovie / new ClassName. Set className to bind the symbol to an external AS2 class file. Returns ok and rev.",
  // filters
  filter_add:
    "Add a filter (dropShadow, blur, glow, bevel, gradientGlow, gradientBevel, colorMatrix) to the selected/given objects. Returns ok and rev.",
  filter_remove: "Remove a filter from the selected/given objects by index. Returns ok and rev.",
  filter_list: "Read the filters applied to a given object.",
  // output & escape hatches
  jsfl_run:
    "Run a JSFL script for operations not covered by a structured tool. Prefer structured tools where available. Returns the script result/logs.",
  stage_screenshot:
    "Render the current stage (optionally at a given frame) to a base64 PNG so you can visually inspect the result.",
  publish_swf:
    "Compile the whole document to a SWF for runtime testing in Ruffle. The tool returns only a compact summary ({ ok, byteLength, width, height }); the SWF bytes themselves are kept on the app side (download/preview) and are NOT returned to you. Use this to confirm the movie compiles and to inspect its size, not to read the SWF contents.",
  file_save_fla: "Save the current document to a .fla file. Returns ok.",
  file_load_fla: "Load a .fla file as the current document. Returns ok and rev.",
  // scene management
  scene_add: "Add a new scene. Returns the new scene index and rev.",
  scene_remove: "Remove a scene by 0-based index (cannot remove the only scene). Returns ok and rev.",
  scene_rename: "Rename a scene by 0-based index. Returns ok and rev.",
  scene_select: "Switch the active scene by 0-based index. Returns ok and rev.",
  scene_duplicate: "Duplicate the active scene. Returns the new scene index and rev.",
  scene_reorder: "Move a scene from one index to another. Returns ok and rev.",
  // stage utilities
  stage_move_selection: "Nudge/move the selected objects by a delta, or to an absolute position. Returns ok and rev.",
  stage_find_instances: "Find stage instances of a given library symbol id. Returns matching object ids.",
  stage_get_bounds: "Read the bounding box of given objects (or the selection / whole stage).",
  stage_duplicate: "Duplicate the selected/given display objects in place. Returns the new object ids and rev.",
  // library utilities
  library_use_count: "Count how many times a library symbol is used across the document.",
} satisfies Record<AgentCommand, string>;

export const BridgeRequestSchema = z.object({
  /** Unique request ID for correlating replies. */
  id: z.string(),
  command: z.enum(ALL_COMMANDS),
  params: z.record(z.string(), z.unknown()).optional(),
});
export type BridgeRequest = z.infer<typeof BridgeRequestSchema>;

export const BridgeResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    id: z.string(),
    result: z.unknown(),
  }),
  z.object({
    ok: z.literal(false),
    id: z.string(),
    error: z.string(),
  }),
]);
export type BridgeResponse = z.infer<typeof BridgeResponseSchema>;

// ---------------------------------------------------------------------------
// Bridge push notifications (editor → plugin)
//
// These are one-way event messages that the editor page sends to the Vite
// plugin over the /__agent WebSocket. Unlike BridgeRequest/BridgeResponse,
// these have no id and expect no reply. The plugin forwards them to connected
// MCP clients as MCP resource update notifications.
// ---------------------------------------------------------------------------

/** Doc changed: emitted after every pushDoc() / bumpRev(). */
export const BridgeDocChangedSchema = z.object({
  type: z.literal("doc-changed"),
  rev: RevSchema,
});
export type BridgeDocChanged = z.infer<typeof BridgeDocChangedSchema>;

/** Selection changed: emitted when the stage selection changes. */
export const BridgeSelectionChangedSchema = z.object({
  type: z.literal("selection-changed"),
  ids: z.array(z.string()),
  rev: RevSchema,
});
export type BridgeSelectionChanged = z.infer<typeof BridgeSelectionChangedSchema>;

/** Playhead moved: emitted when the current frame changes. */
export const BridgePlayheadMovedSchema = z.object({
  type: z.literal("playhead-moved"),
  frameIndex: z.number().int().nonnegative(),
  rev: RevSchema,
});
export type BridgePlayheadMoved = z.infer<typeof BridgePlayheadMovedSchema>;

export const BridgeNotificationSchema = z.discriminatedUnion("type", [
  BridgeDocChangedSchema,
  BridgeSelectionChangedSchema,
  BridgePlayheadMovedSchema,
]);
export type BridgeNotification = z.infer<typeof BridgeNotificationSchema>;

// ---------------------------------------------------------------------------
// Command registry types
// ---------------------------------------------------------------------------

export interface AgentCommandHandler<P = unknown, R = unknown> {
  (params: P): Promise<R> | R;
}
