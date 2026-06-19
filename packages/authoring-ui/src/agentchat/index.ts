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

// Phase 2 tool bridge: the generated AI SDK v6 tool set (one tool per
// agent-protocol command, executing via dispatchAgentCommand) + the system
// prompt. P3's agent loop imports these from `@flash/authoring-ui`.
export { buildAgentTools } from "./tools.js";
export type {
  AgentToolSet,
  AgentToolError,
  BuildAgentToolsOptions,
  Dispatch,
} from "./tools.js";
export { AGENT_SYSTEM_PROMPT, buildAgentSystemPrompt } from "./systemPrompt.js";

// Phase 3: the chat panel UI + the agent run loop (streamText fullStream ->
// renderable transcript). The Shell docks AgentChatPanel in the right pane.
export { AgentChatPanel, DEFAULT_AGENT_MODEL } from "./AgentChatPanel.js";
export type {
  AgentChatPanelProps,
  AgentChatTestHook,
} from "./AgentChatPanel.js";
export {
  runAgentTurn,
  drivePartStream,
  reduceAgentEvent,
  initialAgentRunState,
  agentErrorMessage,
  classifyAgentError,
} from "./agentLoop.js";
export type { AgentErrorKind, FriendlyAgentError } from "./agentLoop.js";
export type {
  AgentRunState,
  AgentRunStatus,
  AgentEntry,
  AgentTextEntry,
  AgentReasoningEntry,
  AgentToolEntry,
  AgentToolStatus,
  AgentStepEntry,
  AgentPartStream,
  RunAgentOptions,
  RunAgentResult,
  DrivePartStreamOptions,
} from "./agentLoop.js";
