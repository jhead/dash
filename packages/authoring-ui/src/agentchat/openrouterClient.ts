// ---------------------------------------------------------------------------
// OpenRouter client for the fully CLIENT-SIDE Agent Chat (Phase 1 foundation).
//
// There is NO Dash server in this feature: the user's OpenRouter API key lives
// only in this browser (localStorage, see preferences.ts) and every request
// goes directly from the browser to https://openrouter.ai. This module wraps
// the Vercel AI SDK v6 OpenRouter provider (@openrouter/ai-sdk-provider v2) and
// exposes:
//
//   - createDashOpenRouter(apiKey)  -> a configured OpenRouterProvider
//   - getModel(provider, id)        -> a LanguageModel handle for the agent loop
//   - fetchOpenRouterModels(apiKey) -> the live model catalog for the selector
//
// Later phases (P2 tool bridge, P3 chat panel + agent loop) build on this
// surface; keep it small and stable.
// ---------------------------------------------------------------------------

import {
  createOpenRouter,
  type OpenRouterProvider,
} from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

/**
 * App-attribution headers OpenRouter shows on the dashboard. `HTTP-Referer`
 * identifies the calling app; `X-Title` is the human-readable app name.
 */
export const DASH_AGENT_TITLE = "Dash Agent";
export const DASH_AGENT_REFERER = "https://dash.local/agent";

/** The OpenRouter REST base; the models catalog lives at `${BASE}/models`. */
export const OPENROUTER_API_BASE = "https://openrouter.ai/api/v1";

/**
 * Create a configured OpenRouter provider bound to the user's key. The
 * `HTTP-Referer` / `X-Title` headers are attached to every model request for
 * app attribution on the openrouter.ai dashboard.
 *
 * @param apiKey - the user's OpenRouter API key (from preferences).
 * @param options - optional overrides (custom `fetch` for tests, header tweaks).
 */
export function createDashOpenRouter(
  apiKey: string,
  options: {
    /** Override the attribution referer (HTTP-Referer header). */
    referer?: string;
    /** Override the attribution title (X-Title header). */
    title?: string;
    /** Custom fetch (e.g. for tests / proxying). */
    fetch?: typeof fetch;
  } = {}
): OpenRouterProvider {
  // Trim here so call sites needn't: a stray leading/trailing space (common
  // when pasting a key) would otherwise produce a confusing 401 from OpenRouter.
  const key = apiKey.trim();
  return createOpenRouter({
    apiKey: key,
    headers: {
      "HTTP-Referer": options.referer ?? DASH_AGENT_REFERER,
      "X-Title": options.title ?? DASH_AGENT_TITLE,
    },
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}

/**
 * Resolve a chat language-model handle by id (e.g.
 * "anthropic/claude-sonnet-4.5") from a configured provider. This is the handle
 * the AI SDK agent loop (P3) passes to `generateText` / `streamText` / `Agent`.
 *
 * Usage accounting is ENABLED (`usage:{include:true}`, task 1337): OpenRouter
 * then returns the request's ACTUAL cost (USD) inline in the same streaming
 * response — surfaced via `providerMetadata.openrouter.usage.cost` — with NO
 * extra round-trip. The agent loop sums it across the tool-loop steps to show a
 * precise per-thread cost; when a model/route doesn't report a cost the panel
 * falls back to computing one from the model's pricing.
 */
export function getModel(
  provider: OpenRouterProvider,
  modelId: string
): LanguageModel {
  return provider.chat(modelId, { usage: { include: true } });
}

// ---------------------------------------------------------------------------
// Model catalog (for the selector dropdown)
// ---------------------------------------------------------------------------

/**
 * A single OpenRouter model entry, trimmed to the fields the selector needs.
 * The raw `/models` response carries far more (pricing, architecture, ...); the
 * extra fields are preserved on `raw` for callers that want them without forcing
 * a schema change here.
 */
export interface OpenRouterModel {
  /** Canonical model id passed to `getModel` (e.g. "openai/gpt-4o"). */
  id: string;
  /** Human-readable name for display in the dropdown. */
  name: string;
  /** Max context window in tokens, when advertised. */
  context_length?: number;
  /** The untrimmed catalog entry, for callers needing pricing/etc. */
  raw: Record<string, unknown>;
}

/**
 * Per-token pricing for a model (USD), parsed from a `/models` entry's
 * `pricing` block (task 1337). OpenRouter reports prices as decimal STRINGS of
 * USD PER TOKEN (e.g. `"0.000003"`), so `prompt`/`completion` are already
 * per-token and multiply directly with token counts.
 */
export interface OpenRouterModelPricing {
  /** USD per prompt (input) token. */
  prompt: number;
  /** USD per completion (output) token. */
  completion: number;
}

/**
 * Extract per-token pricing from a raw `/models` entry (its `.raw` field). The
 * pricing values are decimal strings; non-numeric / missing fields yield
 * `undefined` so the caller can degrade gracefully (show tokens, no cost). Pure
 * for unit testing.
 */
export function parseModelPricing(
  raw: Record<string, unknown> | undefined | null
): OpenRouterModelPricing | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const pricing = (raw as Record<string, unknown>).pricing;
  if (!pricing || typeof pricing !== "object") return undefined;
  const p = pricing as Record<string, unknown>;
  const prompt = toPrice(p.prompt);
  const completion = toPrice(p.completion);
  // Require BOTH sides: a cost computed from a half-populated price table would
  // value the missing side's tokens at $0 and present a confidently-wrong
  // estimate. Better to degrade to "cost unknown" (tokens-only) than mislead.
  if (prompt === undefined || completion === undefined) return undefined;
  return { prompt, completion };
}

/** Coerce a pricing field (string or number) into a finite non-negative number. */
function toPrice(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * Compute the COST (USD) of a turn from per-token pricing and token counts
 * (task 1337): `inputTokens*prompt + outputTokens*completion`. Used as the
 * fallback when OpenRouter did not report a cost. Returns `undefined` when
 * pricing is missing so the UI shows tokens with an unknown cost. Pure.
 */
export function computeCostFromPricing(
  pricing: OpenRouterModelPricing | undefined,
  inputTokens: number,
  outputTokens: number
): number | undefined {
  if (!pricing) return undefined;
  const inTok = Number.isFinite(inputTokens) && inputTokens > 0 ? inputTokens : 0;
  const outTok =
    Number.isFinite(outputTokens) && outputTokens > 0 ? outputTokens : 0;
  return inTok * pricing.prompt + outTok * pricing.completion;
}

/** Thrown when the model catalog cannot be fetched or parsed. */
export class OpenRouterModelsError extends Error {
  constructor(
    message: string,
    /** HTTP status when the failure was an HTTP error, else undefined. */
    readonly status?: number
  ) {
    super(message);
    this.name = "OpenRouterModelsError";
  }
}

/**
 * Parse the raw `/models` JSON payload into the trimmed `OpenRouterModel[]`.
 * Tolerant of unexpected shapes: skips entries without a string `id`, and
 * falls back to the id for a missing name. Exported for unit testing.
 *
 * The returned list is sorted **alphabetically** by display `name`
 * (case-insensitive, locale-aware) with `id` as a stable tiebreak — OpenRouter's
 * `/models` endpoint returns entries in an arbitrary API order, which makes the
 * selector dropdown hard to scan. Sorting here means every consumer (the
 * AgentSettings model picker, anything reusing the catalog) gets a predictable
 * alphabetical order without each call site re-sorting.
 */
export function parseOpenRouterModels(payload: unknown): OpenRouterModel[] {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) {
    throw new OpenRouterModelsError(
      "Unexpected OpenRouter /models response: missing `data` array"
    );
  }
  const models: OpenRouterModel[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const id = obj.id;
    if (typeof id !== "string" || id.length === 0) continue;
    const name = typeof obj.name === "string" && obj.name.length > 0 ? obj.name : id;
    const contextRaw = obj.context_length;
    const context_length =
      typeof contextRaw === "number" && Number.isFinite(contextRaw)
        ? contextRaw
        : undefined;
    models.push({ id, name, context_length, raw: obj });
  }
  models.sort((a, b) => {
    const byName = a.name.localeCompare(b.name, undefined, {
      sensitivity: "base",
    });
    return byName !== 0 ? byName : a.id.localeCompare(b.id);
  });
  return models;
}

/**
 * GET the OpenRouter model catalog for the selector dropdown. Sends the API key
 * as a Bearer token (the public catalog works without one, but sending it keeps
 * the request consistent and surfaces an invalid key clearly).
 *
 * Throws {@link OpenRouterModelsError} on a missing key, network failure, a
 * non-2xx response, or an unparseable body — callers (the selector) catch this
 * and fall back to a manual model-id input.
 *
 * @param apiKey - the user's OpenRouter API key.
 * @param options - optional `fetch`, `signal`, and `baseUrl` overrides.
 */
export async function fetchOpenRouterModels(
  apiKey: string,
  options: {
    fetch?: typeof fetch;
    signal?: AbortSignal;
    baseUrl?: string;
  } = {}
): Promise<OpenRouterModel[]> {
  const key = apiKey.trim();
  if (key.length === 0) {
    throw new OpenRouterModelsError("No OpenRouter API key configured");
  }
  const doFetch = options.fetch ?? fetch;
  const base = options.baseUrl ?? OPENROUTER_API_BASE;
  let res: Response;
  try {
    res = await doFetch(`${base}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        "HTTP-Referer": DASH_AGENT_REFERER,
        "X-Title": DASH_AGENT_TITLE,
      },
      signal: options.signal,
    });
  } catch (cause) {
    throw new OpenRouterModelsError(
      `Failed to reach OpenRouter: ${
        cause instanceof Error ? cause.message : String(cause)
      }`
    );
  }
  if (!res.ok) {
    throw new OpenRouterModelsError(
      `OpenRouter /models returned HTTP ${res.status}`,
      res.status
    );
  }
  let payload: unknown;
  try {
    payload = await res.json();
  } catch (cause) {
    throw new OpenRouterModelsError(
      `OpenRouter /models returned invalid JSON: ${
        cause instanceof Error ? cause.message : String(cause)
      }`
    );
  }
  return parseOpenRouterModels(payload);
}
