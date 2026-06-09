/**
 * JSFL scripting subset — public re-exports.
 */
export type {
  JsflResult,
  JsflContext,
  JsflDocument,
  JsflFl,
  JsflTimeline,
  JsflLayer,
  JsflFrame,
  JsflLibrary,
  JsflLibraryItem,
} from "./runtime.js";

export { runJsfl, buildJsflContext } from "./runtime.js";
