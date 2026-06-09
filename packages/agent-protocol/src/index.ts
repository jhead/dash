/**
 * @flash/agent-protocol
 *
 * Zod schemas and TypeScript types for the Flash editor MCP agent protocol.
 * Shared between the Vite MCP plugin (Node side) and the editor-side bridge
 * registry (browser side).
 *
 * Commands are the MVP subset from doc 19: editor_status, doc_get, doc_summary.
 * Each command has a params schema and a result schema.
 *
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
// Bridge message envelope
// ---------------------------------------------------------------------------

/** The private WS bridge between the Vite plugin and the editor page.
 *  Not a public protocol — only used internally by this package.
 */

export const BridgeRequestSchema = z.object({
  /** Unique request ID for correlating replies. */
  id: z.string(),
  command: z.enum(["editor_status", "doc_get", "doc_summary"]),
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
// Command registry types
// ---------------------------------------------------------------------------

export type AgentCommand = "editor_status" | "doc_get" | "doc_summary";

export interface AgentCommandHandler<P = unknown, R = unknown> {
  (params: P): Promise<R> | R;
}
