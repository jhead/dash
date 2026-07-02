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
| **Tooling** | Auto-generated from `@flash/agent-protocol` — one tool per command (73 of 75 commands; `doc_load` + `file_load_fla` are denylisted, see below) |
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
  resolves a `LanguageModel` handle (with usage accounting enabled so OpenRouter
  reports cost inline, task 1337); `fetchOpenRouterModels(apiKey)` fetches the
  live model catalog for the selector. `parseModelPricing` /
  `computeCostFromPricing` derive a per-token cost estimate from a model's catalog
  pricing (the cost-from-pricing fallback).
- **`tools.ts`** — `buildAgentTools()` generates the AI SDK v6 tool set by
  iterating the agent-protocol command registry (`ALL_COMMANDS` +
  `COMMAND_SCHEMAS` + `COMMAND_DESCRIPTIONS`). Each tool's `inputSchema` is the
  command's own Zod schema, and its `execute` calls `dispatchAgentCommand(name,
  args)`. Errors are caught and returned as a structured `{ error }` object (so a
  failed tool — including the "editor not ready" guard — never crashes the loop).
  - **Denylist (`AGENT_CHAT_EXCLUDED_COMMANDS`, task 1282).** The chat tool set
    EXCLUDES the two full-document-REPLACE loaders — `doc_load` and
    `file_load_fla` — so the autonomous loop can never wipe/replace the whole
    document. They are simply never registered as tools (no confirmation/allowlist
    layer). The destructive `*_remove` commands (`stage_remove`, `library_remove`,
    `timeline_remove_layer`/`_frame`, `scene_remove`) and `file_save_fla` /
    `publish_swf` are intentionally KEPT auto-running (all mutations go through
    `pushDoc`, so they are undoable). This denylist is the AGENT CHAT path only;
    the programmatic MCP/JSFL registry (`agent/registry.ts`) still serves all
    commands. To amend the chat surface, edit that one constant in `tools.ts`.
  - **Vision / `stage_screenshot` (image tool results).** Most tools return a
    JSON object that the AI SDK serializes as a *text* (`type:'json'`)
    tool-result. `stage_screenshot` is special: its result carries a rendered PNG
    as base64 (`{ pngBase64, width, height }`), and base64 in a text tool-result
    is undecodable by the model (a vision model cannot *see* it, and the blob
    wastes context). So image-producing commands (the `IMAGE_RESULT_COMMANDS`
    set) get a per-tool **`toModelOutput`** override that maps the result to a
    real image content part — AI SDK v6's `{ type:'content', value:[{ type:'text',
    text:'…(WxH)' }, { type:'image-data', data: pngBase64, mediaType:'image/png'
    }] }`. A multimodal model receives an actual image; a short text note carries
    the dimensions so a text-only model still gets something. The base64 never
    enters the plain-text channel. **Vision is model-dependent:** OpenRouter
    routes to the model you pick — a text-only model will ignore/reject the image
    part, so the system prompt tells the model to rely on structured reads when it
    is not multimodal.
- **`systemPrompt.ts`** — `AGENT_SYSTEM_PROMPT` describing the Dash model, the
  tool surface, and a *read-before-write* working style.
- **`agentLoop.ts`** — `runAgentTurn()` runs one turn through the AI SDK v6
  `streamText` multi-step tool loop and folds its `fullStream` into a renderable
  transcript via the pure reducer `reduceAgentEvent`. It also returns the turn's
  token + cost `AgentTurnUsage` (from `result.totalUsage` + per-step OpenRouter
  cost, task 1337 — see *Token usage & cost*). `classifyAgentError()` maps raw
  failures into friendly, actionable buckets (see *Error handling*).
- **`AgentChatPanel.tsx`** — the panel: collapsible Settings, the **thread
  switcher** (`New chat` + a dropdown of past conversations), the transcript
  (user bubbles + assistant turns with streamed text, *thinking*, tool-call
  chips, step markers), and the composer with the **Send / Stop** button. A
  tool-call chip's *result* section pretty-prints the JSON result, except a
  screenshot result (a `{ pngBase64, width, height }` object) renders as a
  `screenshot (W×H)` label plus a small thumbnail `<img>` — the base64 is never
  dumped as text into the chip. The
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
  usage: ThreadUsage;     // running per-thread token + cost totals (task 1337)
  createdAt: number;
  updatedAt: number;
}
interface ThreadState {
  threads: ChatThread[];
  activeThreadId: string | null;
  // actions:
  newThread, selectThread, deleteThread, clearActiveThread,
  appendUserAndAssistant, patchAssistantRun, appendActiveHistory,
  addThreadUsage, addThreadCost
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

## Token usage & cost (per thread, task 1337)

Each thread shows a compact running total of the tokens and cost it has consumed,
rendered as a footer line just above the composer:

```
12,345 tokens · $0.0123          (cost reported by OpenRouter)
12,345 tokens · ~$0.0123 est.    (cost computed from the model's pricing)
12,345 tokens                    (tokens known, cost unavailable)
```

It updates the moment a turn completes, **sums across all turns** in the thread,
**persists** (survives reload / thread-switch), and a **new thread starts at 0**.
A thread with no tokens yet hides the line entirely.

### How tokens are captured

`runAgentTurn` (`agentLoop.ts`) reads the AI SDK v6 `streamText` result's
**`result.totalUsage`** — the SDK's sum of every step's `LanguageModelUsage`
across the multi-step tool loop, so a turn that called N tools still reports one
combined `{ inputTokens, outputTokens, totalTokens }`. It returns this as an
`AgentTurnUsage` on `RunAgentResult` (alongside `state` + `responseMessages`).
Reading usage is wrapped in `try/catch` so an aborted/errored turn degrades to no
usage rather than failing the run.

### How cost is determined (reported vs computed)

Two sources, in priority order — chosen to be the **most accurate without a
fragile extra round-trip**:

1. **REPORTED (preferred, no extra request).** `getModel` enables OpenRouter
   *usage accounting* — `provider.chat(id, { usage: { include: true } })` — so
   OpenRouter returns the request's **actual USD cost inline in the same
   streaming response**. It rides back on each step's
   `providerMetadata.openrouter.usage.cost`; `runAgentTurn` **sums it across the
   tool-loop steps** (`sumOpenRouterReportedCost`). This is exact and adds zero
   network round-trips. Marked **not** estimated.
2. **COMPUTED (fallback, labeled `est.`).** When no step reported a cost (the
   route/model didn't return one), the panel computes
   `inputTokens × pricing.prompt + outputTokens × pricing.completion` from the
   selected model's per-token pricing (`computeCostFromPricing`), pulled from the
   OpenRouter `/models` catalog (`parseModelPricing` reads the `pricing` block).
   The catalog is fetched **lazily and cached** — only the first time a turn
   lacks a reported cost — and the lookup is **deferred / fire-and-forget**
   (`addThreadCost`), so the footer shows tokens immediately and the estimate
   fills in once pricing resolves; a slow/failed fetch never blocks the run or
   hides the token count.

The `GET /api/v1/generation?id=` endpoint was deliberately **not** used: it is a
separate per-request round-trip, whereas usage-accounting returns the same figure
inline. When neither a reported nor a computed cost is available, the line shows
tokens only.

### Accumulation & persistence

- `addThreadUsage(threadId, turnUsage)` folds one turn's tokens + reported cost
  into the thread's `ThreadUsage` via the pure `accumulateUsage` reducer. It
  targets the **origin** thread (the one the turn ran on, even if the user
  switched away mid-flight) and **always persists** (a completed turn's totals
  must survive a refresh — unlike streaming deltas, which are memory-only).
- `addThreadCost(threadId, cost, estimated)` adds *just* the deferred computed
  cost without touching tokens (no double-count), flipping `costHasEstimate` so
  the whole-thread total is labeled `est.`.
- `ThreadUsage` is `{ totalTokens, inputTokens, outputTokens, cost, costKnown,
  costHasEstimate }`; `costKnown` distinguishes a genuine `$0.0000` from "cost
  unknown". `normalizeUsage` coerces a legacy persisted thread (no `usage` field)
  to all-zero, and `clearActiveThread` resets the totals.
- The footer text comes from the pure `formatUsageLine` / `formatCost` helpers in
  `AgentChatPanel.tsx` (tiny non-zero costs render as `<$0.0001`).

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
**same** `@flash/agent-protocol` command registry that the MCP server
(`docs/19-agent-interface.md`) exposes, so the in-app agent and an external MCP
client (or the `flash-agent` CLI) drive Dash through one shared command set —
minus the two `AGENT_CHAT_EXCLUDED_COMMANDS` (`doc_load` / `file_load_fla`),
which the chat denylists (see above) but the MCP path still serves. That leaves
**73 of 75 commands** on the chat path: `editor_status`, `doc_get` /
`doc_summary`, `stage_add_shape` / `stage_add_text` / `stage_place_instance` /
`stage_update` / `stage_remove` / `stage_arrange` / `stage_group`, timeline ops
(`timeline_add_layer`, `timeline_insert_keyframe`, …), library ops, `script_set`,
`publish_swf`, `history_undo` / `history_redo`, and more.

The difference is only the **transport**:

| | In-app Agent Chat | MCP server / `flash-agent` CLI |
|---|---|---|
| Client | LLM in your browser (OpenRouter) | External MCP client / CLI |
| Transport | AI SDK v6 tool call → `dispatchAgentCommand` (in-process) | HTTP/WebSocket bridge → `dispatchAgentCommand` |
| Tools | `buildAgentTools()` (registry minus `AGENT_CHAT_EXCLUDED_COMMANDS`) | MCP tools (full registry — `doc_load` / `file_load_fla` included) |
| Mutation | Live document store (undoable) | Live document store (undoable) |
| Key/host | BYOK, no server | Your MCP host config |

Because both paths converge on `dispatchAgentCommand`, a tool added to the
agent-protocol registry automatically appears in **both** surfaces.

**Both surfaces are now GENERATED, so they cannot drift (task 1393).** The MCP
plugin used to *hand-code* its tool schemas, which silently diverged from the
registry: ~7 commands (the `class_*` AS2-class ops, `selection_pick_at`,
`stage_set_instance_name`) were unreachable over MCP, `filter_add`'s type enum was
narrow (missing `gradientGlow` / `gradientBevel` / `colorMatrix`), and
`stage_update` re-exposed an untyped `updates` bag. The plugin now builds its tool
set with `registerAgentCommandTools()`, iterating the exact same `ALL_COMMANDS` /
`COMMAND_SCHEMAS` / `COMMAND_DESCRIPTIONS` that `buildAgentTools()` uses — so the
two transports advertise byte-identical schemas (the MCP `stage_screenshot`
special-cases the base64 PNG into an image content block, just as the chat's
`toModelOutput` does). The consequence for the protocol: each schema must describe
the params the registry handler actually honors, since a narrow schema now hides
real functionality from **both** surfaces at once (this is why the protocol
schemas carry `stage_add_shape`'s gradient fill, `stage_place_instance`'s
transform params, and `stage_add_text`'s input-text/layout extras).

---

## Verification

- **Unit** (`agentchat/__tests__/`): the `agentLoop` reducer + terminal-status
  rules, `classifyAgentError` buckets, the generated tool set, the system prompt,
  and the **`threadStore`** (`threadStore.test.ts`): round-tripping threads
  through a mocked `localStorage`, new/switch/clear/delete, restore-active-on-
  remount, title derivation, storage bounding/trimming, and the parse/quota
  failure fallbacks. **Token usage + cost (`usage.test.ts`, task 1337)**: per-turn
  usage capture from the SDK total usage + per-step provider metadata
  (`buildTurnUsage` / `sumOpenRouterReportedCost`), cost-from-pricing
  (`parseModelPricing` / `computeCostFromPricing`), and the footer formatters
  (`formatUsageLine` / `formatCost`). `threadStore.test.ts` adds usage
  **accumulation across turns** (`accumulateUsage` / `addThreadUsage`), the
  deferred estimate fill (`addThreadCost`), origin-thread targeting, the
  **persistence round-trip** of `usage`, and legacy-thread normalization.
  `pnpm --filter @flash/authoring-ui run test -- --run agentchat`.
- **E2E oracle** (`apps/desktop/e2e/agent-chat-drives-stage.spec.ts`): opens the
  Agent tab and runs the **real** loop (`runAgentTurn` → `streamText`) against a
  **stubbed** `MockLanguageModelV3` (from `ai/test`) whose stream emits a
  `stage_add_shape` (rect) tool call — **no real key or network**. It asserts the
  shape appears in the live document, proving end-to-end: *model tool-call →
  `buildAgentTools` execute → `dispatchAgentCommand` → document mutation*. It also
  asserts the **per-thread usage footer** (`data-testid="agent-usage"`) appears
  with the turn's token total (task 1337), proving the usage capture wires through
  the production loop.

  The test seam: in test mode the Shell exposes
  `window.__agentChatTestStub.makeStubRunTurn([...])`; the spec installs the
  result on `window.__agentChatTestHook`, which `AgentChatPanel` reads in place of
  the real OpenRouter-backed `runTurn`. The panel still passes the **real** tool
  set, so dispatch hits the live store. The hook is inert in production (never
  set), and `ai/test` is imported lazily and only under the test-env flag.
