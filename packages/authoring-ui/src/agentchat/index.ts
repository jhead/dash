// Agent Chat (client-side) — Phase 1 foundation barrel.
// Re-exports the OpenRouter client surface and the reusable settings component
// so later phases (P2 tool bridge, P3 chat panel + agent loop) import from one
// place: `@flash/authoring-ui` → these symbols.

export {
  createDashOpenRouter,
  getModel,
  fetchOpenRouterModels,
  parseOpenRouterModels,
  OpenRouterModelsError,
  DASH_AGENT_TITLE,
  DASH_AGENT_REFERER,
  OPENROUTER_API_BASE,
} from "./openrouterClient.js";
export type { OpenRouterModel } from "./openrouterClient.js";

export { AgentSettings } from "./AgentSettings.js";
export type { AgentSettingsProps } from "./AgentSettings.js";
