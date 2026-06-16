export type {
  CommandContext,
  CommandServices,
  EditorCommand,
  EditorCommandAny,
} from "./types.js";
export { createCommandRegistry } from "./registry.js";
export type { CommandRegistry } from "./registry.js";

// Command modules (edit/timeline/shape/text/library/transform/scene/view/file)
// are added here in Phase 4 as handlers migrate off Shell.
