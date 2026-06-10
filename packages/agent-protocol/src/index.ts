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

export const StageUpdateParamsSchema = z.object({
  id: z.string(),
  layerId: z.string().optional(),
  frameIndex: z.number().int().nonnegative().optional(),
  updates: z.record(z.string(), z.unknown()),
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
  exportForActionScript: z.boolean().optional().describe("Export this symbol for ActionScript (enables attachMovie / new ClassName)"),
  exportInFirstFrame: z.boolean().optional().describe("Export the symbol in the first frame of the SWF"),
}).refine(
  (data) => data.linkageId !== undefined || data.exportForActionScript !== undefined || data.exportInFirstFrame !== undefined,
  { message: "At least one of linkageId, exportForActionScript, or exportInFirstFrame must be provided" }
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
  swfBase64: z.string(),
  byteLength: z.number(),
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
  "playback_play",
  "playback_stop",
  // code
  "script_get",
  "script_set",
  "script_check",
  "script_list",
  // library
  "library_list",
  "library_create_symbol",
  "library_convert_to_symbol",
  "library_rename",
  "library_remove",
  "library_import_bitmap",
  "library_import_sound",
  "library_set_linkage",
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
] as const;

export type AgentCommand = (typeof ALL_COMMANDS)[number];

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
