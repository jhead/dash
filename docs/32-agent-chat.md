# 32 — Agent Chat (in-app, client-side)

The **Agent Chat** is a chat panel docked in the editor's right pane (the
**Agent** tab) that lets you talk to an LLM which can *drive Dash directly* —
reading the document and authoring content (shapes, text, layers, tweens,
symbols, scripts, publish, …) by calling the same command surface the MCP server
exposes. It is **bring-your-own-key (BYOK)** and runs **entirely in the browser**:
there is no Dash server in the loop.

This page documents the architecture, setup, the no-server design and its
trade-offs, and how the chat maps onto the MCP/agent-protocol tool surface.

---

## At a glance

| | |
|---|---|
| **Where** | Right pane → **Agent** tab (`AgentChatPanel`) |
| **LLM access** | [OpenRouter](https://openrouter.ai) via the **Vercel AI SDK v6** |
| **Key storage** | `localStorage` in your browser only (BYOK) — never sent to a Dash server |
| **Tooling** | Auto-generated from `@flash/agent-protocol` — one tool per command (68 commands) |
| **Execution** | Tool `execute` → `dispatchAgentCommand` → the live document store (undoable) |
| **History** | Persisted to `localStorage`; multiple named threads (`threadStore.ts`) — survives tab-switch + page refresh |
| **Code** | `packages/authoring-ui/src/agentchat/` |

---

## Architecture

The feature is fully client-side. Nothing about it requires (or contacts) a Dash
backend; the only network calls go **directly from your browser to
`openrouter.ai`**.

```
┌──────────────────────────── browser ────────────────────────────┐
│                                                                  │
│  AgentChatPanel.tsx ──────────────► agentLoop.ts                 │
│   (transcript UI, composer,          runAgentTurn()              │
│    settings, Stop)                    └─ AI SDK v6 streamText     │
│                                          (multi-step tool loop)  │
│                                            │         ▲           │
│                       tools.ts ────────────┘         │ stream    │
│                       buildAgentTools()              parts        │
│                        one tool per command          │           │
│                        execute = dispatchAgentCommand │           │
│                                            │                      │
│                       agent/registry.ts ◄──┘                      │
│                       dispatchAgentCommand → live document store  │
│                       (pushDoc / undo / selection / …)           │
│                                            │                      │
│                              the editing surface mutates ✦        │
└──────────────────────────────────────────────────────────────────┘
            │ HTTPS (Bearer = your key)
            ▼
       openrouter.ai  →  the model you picked
```

### Pieces (all under `packages/authoring-ui/src/agentchat/`)

- **`openrouterClient.ts`** — wraps `@openrouter/ai-sdk-provider`.
  `createDashOpenRouter(apiKey)` returns a provider bound to your key (with
  `HTTP-Referer` / `X-Title` attribution headers); `getModel(provider, id)`
  resolves a `LanguageModel` handle; `fetchOpenRouterModels(apiKey)` fetches the
  live model catalog for the selector.
- **`tools.ts`** — `buildAgentTools()` generates the AI SDK v6 tool set by
  iterating the agent-protocol command registry (`ALL_COMMANDS` +
  `COMMAND_SCHEMAS` + `COMMAND_DESCRIPTIONS`). Each tool's `inputSchema` is the
  command's own Zod schema, and its `execute` calls `dispatchAgentCommand(name,
  args)`. Errors are caught and returned as a structured `{ error }` object (so a
  failed tool — including the "editor not ready" guard — never crashes the loop).
- **`systemPrompt.ts`** — `AGENT_SYSTEM_PROMPT` describing the Dash model, the
  tool surface, and a *read-before-write* working style.
- **`agentLoop.ts`** — `runAgentTurn()` runs one turn through the AI SDK v6
  `streamText` multi-step tool loop and folds its `fullStream` into a renderable
  transcript via the pure reducer `reduceAgentEvent`. `classifyAgentError()` maps
  raw failures into friendly, actionable buckets (see *Error handling*).
- **`AgentChatPanel.tsx`** — the panel: collapsible Settings, the **thread
  switcher** (`New chat` + a dropdown of past conversations), the transcript
  (user bubbles + assistant turns with streamed text, *thinking*, tool-call
  chips, step markers), and the composer with the **Send / Stop** button. The
  panel is a thin view over `threadStore` — it holds no conversation state of its
  own, so leaving and returning to the Agent tab (or reloading) shows the same
  conversation.
- **`threadStore.ts`** — the persisted (`localStorage`) conversation store (see
  *History & threads* below).
- **`AgentMarkdown.tsx`** — renders an assistant message body as Markdown (see
  *Markdown rendering* below).
- **`AgentSettings.tsx`** — the API-key input + model selector (or manual
  model-id input when the catalog can't load).

### Markdown rendering

Assistant message bodies render as **Markdown** (`AgentMarkdown.tsx`, via
[`react-markdown`](https://github.com/remarkjs/react-markdown) +
[`remark-gfm`](https://github.com/remarkjs/remark-gfm)). User-typed messages and
tool-call chips stay plain text.

- **What renders:** headings, **bold**/*italic*, ordered/unordered lists, inline
  `code`, fenced code blocks (monospace on a light inset background, with
  horizontal scroll for long lines), blockquotes, links (open in a new tab with
  `rel="noopener noreferrer"`), and GFM tables, ~~strikethrough~~, and task
  lists.
- **Theme:** every element is styled to the Flash 8 LIGHT theme via the
  `flash8Theme` tokens — near-black text, code on a `chrome.insetFieldStrip`
  inset. The transcript stays `user-select:text` so message text is selectable
  (task 1285).
- **Safe by default (no XSS):** the default `react-markdown` pipeline is used
  with **no `rehype-raw`** / raw-HTML passthrough, so any literal HTML in the
  assistant text (e.g. `<script>`/`<b>`) is escaped to plain text and can never
  become live DOM.
- **Streaming-friendly:** `react-markdown` re-parses on every streaming delta,
  and partial/unclosed markdown (e.g. an open code fence mid-stream) parses
  gracefully without throwing.

### Why AI SDK v6 + OpenRouter

- **OpenRouter** is a single BYOK gateway to many providers/models, so the user
  picks any model their key can reach without Dash hard-coding a provider.
- **AI SDK v6** gives a provider-agnostic streaming tool loop (`streamText` with
  `stopWhen: stepCountIs(...)`), tool definitions from Zod schemas, and a
  uniform `fullStream` of typed parts the panel renders.

---

## History & threads

Conversation history is **persisted** and supports **multiple threads**, so it
survives both leaving/returning to the Agent tab (the panel unmounts) and a full
page refresh. State lives in **`threadStore.ts`** — a `localStorage`-backed
[zustand](https://github.com/pmndrs/zustand) store — *not* in `AgentChatPanel`'s
component state (which is where it lived before, and why it used to be lost).

### The store (`threadStore.ts`)

```ts
interface ChatThread {
  id: string;
  title: string;          // derived from the first user message (truncated); "New chat" until then
  transcript: Turn[];     // the rendered messages (user bubbles + assistant runs)
  history: ModelMessage[];// the AI-SDK ModelMessage[] multi-turn context (assistant + tool)
  createdAt: number;
  updatedAt: number;
}
interface ThreadState {
  threads: ChatThread[];
  activeThreadId: string | null;
  // actions:
  newThread, selectThread, deleteThread, clearActiveThread,
  appendUserAndAssistant, patchActiveAssistantRun, appendActiveHistory
}
```

- Each thread carries **both** the rendered `transcript` (what you see) and the
  raw `history` (`ModelMessage[]`, the multi-turn context the loop is given) — so
  switching threads restores the exact UI *and* the model's memory of that
  conversation.
- The **in-flight run writes into the active thread**: `handleSend` snapshots the
  active thread's `history`, appends the user + a live assistant turn via
  `appendUserAndAssistant`, then streams updates onto that assistant turn with
  `patchActiveAssistantRun` and finally records the model's response messages with
  `appendActiveHistory`. Streaming text, *thinking*, and tool chips all persist.
- The **title** is derived from the first user message (whitespace-collapsed and
  truncated to `MAX_TITLE_LEN`); a thread with no user message yet shows **"New
  chat"**.

### UI

- **`New chat`** — starts a fresh empty thread and makes it active.
- **Thread switcher** — a dropdown (most-recent first) of past threads showing
  title + a compact relative timestamp; click one to switch (restoring its
  transcript). Each row has an **✕** to **delete** that thread.
- **Clear** — empties the *current* thread (transcript + history) in place,
  keeping the thread and its id (the title resets to "New chat").
- Switching/clearing/deleting the active thread is blocked while a run is in
  flight (it would orphan the streaming patches); deleting a *non-active* thread
  mid-run is fine.

### Persistence hygiene (quota-safe, mirrors `preferences.ts`)

- Every read/write is wrapped in `try/catch`: malformed JSON, a non-object
  payload, a dangling `activeThreadId`, or a privacy-mode/quota write failure all
  fall back gracefully (an empty store on read; a silent no-op — or a single-most-
  recent-thread retry — on write). The UI never throws on storage errors.
- **Size is capped** so one long conversation can't blow the ~5 MB `localStorage`
  quota: at most `MAX_THREADS` threads are kept (oldest-`updatedAt` dropped
  first), and each thread's `transcript`/`history` is trimmed to the most recent
  `MAX_TURNS_PER_THREAD` / `MAX_HISTORY_PER_THREAD` entries
  (`boundForStorage` / `trimThread`).

---

## The no-server (BYOK) design

There is **no Dash backend** for this feature, by design:

- Your OpenRouter API key is stored in **`localStorage`** (preferences key
  `openrouterApiKey`) and read only by this panel.
- Every model request is made **from your browser straight to `openrouter.ai`**
  with your key as the Bearer token. Dash never sees, proxies, or stores the key
  or your prompts on any server.
- The tool calls the model makes execute **locally** against the in-memory
  document — the same store the rest of the editor uses.

### `localStorage` key caveat

Because the key lives in `localStorage`:

- It is **persisted in plaintext** in the browser profile and survives reloads.
  Anyone with access to that browser profile (or a malicious extension/script
  running on the page) can read it. Use a **scoped OpenRouter key with a spend
  limit**, and clear it (Settings → **Clear**) on a shared machine.
- It is **origin-scoped** — it does not sync across browsers/devices and is lost
  if you clear site data.
- Requests go directly to `openrouter.ai`, which must permit the browser request
  (CORS). A network/CORS failure surfaces as an actionable error (below).

---

## Setup

1. Get an [OpenRouter API key](https://openrouter.ai/keys) (prefer a key with a
   spending cap).
2. Open the editor → right pane → **Agent** tab. Settings auto-opens when no key
   is set.
3. Paste the key into **OpenRouter API key**. It is saved to `localStorage`; the
   model selector then loads the live catalog.
4. Pick a **Model**. If the catalog can't load (no/invalid key, offline), type a
   model id manually (e.g. `anthropic/claude-sonnet-4.5`). If you skip this, a
   sensible **default model** (`DEFAULT_AGENT_MODEL`) is used.
5. Type a request and press **Enter** (Shift+Enter for a newline) or click
   **Send**. Try: *"draw a red rectangle in the middle of the stage"* or *"add a
   layer named UI and put a Play button on it."*

### Composer behavior

- **Enter** sends; **Shift+Enter** inserts a newline.
- **Send** is disabled while a run is in flight and when the composer is empty or
  no key is set.
- The transcript **auto-scrolls** to the newest content as it streams.
- **Tool-call chips** are collapsed by default; click one to expand its args and
  result/error.
- **Clear** empties the *current* thread (history + transcript), keeping the
  thread; use **New chat** / the thread switcher to manage separate
  conversations (see *History & threads*).

### Stop button

While a turn is running, **Send** becomes **Stop**. Stop calls
`AbortController.abort()` on the in-flight `streamText`; the loop folds the abort
into a terminal **Stopped** status (a trailing `finish` never overrides it). Any
tool calls already applied to the document remain (and are undoable via the
normal history); Stop just halts further model/tool work.

---

## Error handling

`classifyAgentError()` turns raw provider/network errors into clear, actionable
messages and decides whether to nudge you back to Settings:

| Situation | What you see |
|---|---|
| No API key | Prompt to add a key in Settings (also a banner above the transcript) |
| No model selected | Prompt to pick a model (a default is otherwise used) |
| Invalid key / 401 / 403 | "OpenRouter rejected the API key … check the key in Settings" |
| Rate limited (429) | "Rate limited … wait a moment or pick a less busy model" |
| Network / CORS / DNS / fetch failed | "Couldn't reach openrouter.ai … check your connection" |
| Bad model id / 400 / 404 | "The model couldn't process this request … try a different model" |
| Anything else | The raw message, surfaced rather than swallowed |

---

## Mapping to the MCP tool surface

The chat does **not** define its own tools. `buildAgentTools()` enumerates the
**exact same** `@flash/agent-protocol` command registry that the MCP server
(`docs/19-agent-interface.md`) exposes, so the in-app agent and an external MCP
client (or the `flash-agent` CLI) drive Dash through one shared command set
(currently **68 commands**): `editor_status`, `doc_get` / `doc_summary`,
`stage_add_shape` / `stage_add_text` / `stage_place_instance` / `stage_update` /
`stage_remove` / `stage_arrange` / `stage_group`, timeline ops
(`timeline_add_layer`, `timeline_insert_keyframe`, …), library ops, `script_set`,
`publish_swf`, `history_undo` / `history_redo`, and more.

The difference is only the **transport**:

| | In-app Agent Chat | MCP server / `flash-agent` CLI |
|---|---|---|
| Client | LLM in your browser (OpenRouter) | External MCP client / CLI |
| Transport | AI SDK v6 tool call → `dispatchAgentCommand` (in-process) | HTTP/WebSocket bridge → `dispatchAgentCommand` |
| Tools | `buildAgentTools()` (generated from the registry) | MCP tools (generated from the same registry) |
| Mutation | Live document store (undoable) | Live document store (undoable) |
| Key/host | BYOK, no server | Your MCP host config |

Because both paths converge on `dispatchAgentCommand`, a tool added to the
agent-protocol registry automatically appears in **both** surfaces.

---

## Verification

- **Unit** (`agentchat/__tests__/`): the `agentLoop` reducer + terminal-status
  rules, `classifyAgentError` buckets, the generated tool set, the system prompt,
  and the **`threadStore`** (`threadStore.test.ts`): round-tripping threads
  through a mocked `localStorage`, new/switch/clear/delete, restore-active-on-
  remount, title derivation, storage bounding/trimming, and the parse/quota
  failure fallbacks. `pnpm --filter @flash/authoring-ui run test -- --run agentchat`.
- **E2E oracle** (`apps/desktop/e2e/agent-chat-drives-stage.spec.ts`): opens the
  Agent tab and runs the **real** loop (`runAgentTurn` → `streamText`) against a
  **stubbed** `MockLanguageModelV3` (from `ai/test`) whose stream emits a
  `stage_add_shape` (rect) tool call — **no real key or network**. It asserts the
  shape appears in the live document, proving end-to-end: *model tool-call →
  `buildAgentTools` execute → `dispatchAgentCommand` → document mutation*.

  The test seam: in test mode the Shell exposes
  `window.__agentChatTestStub.makeStubRunTurn([...])`; the spec installs the
  result on `window.__agentChatTestHook`, which `AgentChatPanel` reads in place of
  the real OpenRouter-backed `runTurn`. The panel still passes the **real** tool
  set, so dispatch hits the live store. The hook is inert in production (never
  set), and `ai/test` is imported lazily and only under the test-env flag.
