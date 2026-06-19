/**
 * Unit tests for the OpenRouter client (task 1276 P1):
 *   - parseOpenRouterModels: trims the /models payload, tolerant of junk.
 *   - fetchOpenRouterModels: GETs /models with auth, parses, and errors
 *     gracefully on missing key / HTTP error / network failure / bad JSON.
 *
 * fetch is mocked (no network); a real key is never needed.
 */

import { describe, it, expect, vi } from "vitest";
import {
  parseOpenRouterModels,
  fetchOpenRouterModels,
  OpenRouterModelsError,
  OPENROUTER_API_BASE,
  DASH_AGENT_TITLE,
} from "../agentchat/openrouterClient.js";

const SAMPLE = {
  data: [
    {
      id: "anthropic/claude-sonnet-4.5",
      name: "Anthropic: Claude Sonnet 4.5",
      context_length: 200000,
      pricing: { prompt: "0.000003" },
    },
    { id: "openai/gpt-4o", name: "OpenAI: GPT-4o", context_length: 128000 },
    // missing name -> falls back to id
    { id: "meta/llama-3" },
    // junk entries that must be skipped
    { name: "no id here" },
    null,
    "not an object",
    { id: 42 },
  ],
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** A vi.fn typed with the fetch signature so `.mock.calls` are typed tuples. */
function makeFetchMock(impl: typeof fetch) {
  return vi.fn<typeof fetch>(impl);
}

describe("parseOpenRouterModels", () => {
  it("trims entries to {id,name,context_length,raw} and keeps raw", () => {
    const models = parseOpenRouterModels(SAMPLE);
    expect(models).toHaveLength(3);
    expect(models[0]).toMatchObject({
      id: "anthropic/claude-sonnet-4.5",
      name: "Anthropic: Claude Sonnet 4.5",
      context_length: 200000,
    });
    // raw preserves the untrimmed fields (e.g. pricing).
    expect((models[0].raw as { pricing?: unknown }).pricing).toBeDefined();
  });

  it("falls back to id when name is missing", () => {
    const models = parseOpenRouterModels(SAMPLE);
    const llama = models.find((m) => m.id === "meta/llama-3");
    expect(llama?.name).toBe("meta/llama-3");
    expect(llama?.context_length).toBeUndefined();
  });

  it("skips malformed entries (no id / null / non-object / numeric id)", () => {
    // The SAMPLE has 3 valid entries; the rest (no id, null, string, numeric
    // id) are dropped. IDs are listed in the parser's ALPHABETICAL-by-name
    // order (see the dedicated sort test below), not the raw payload order.
    const models = parseOpenRouterModels(SAMPLE);
    expect(models.map((m) => m.id).sort()).toEqual([
      "anthropic/claude-sonnet-4.5",
      "meta/llama-3",
      "openai/gpt-4o",
    ]);
  });

  it("returns the models sorted alphabetically by display name (task 1296)", () => {
    // SAMPLE arrives in raw API order (claude, gpt-4o, llama-3) but the picker
    // needs a predictable alphabetical list. Case-insensitive by name, with the
    // missing-name entry sorted by its id-fallback label:
    //   "Anthropic: Claude Sonnet 4.5" < "meta/llama-3" < "OpenAI: GPT-4o"
    const models = parseOpenRouterModels(SAMPLE);
    expect(models.map((m) => m.name)).toEqual([
      "Anthropic: Claude Sonnet 4.5",
      "meta/llama-3",
      "OpenAI: GPT-4o",
    ]);
    // The list is genuinely non-descending case-insensitive.
    const lower = models.map((m) => m.name.toLowerCase());
    expect(lower).toEqual([...lower].sort());
  });

  it("sorts case-insensitively and breaks name ties stably by id", () => {
    const models = parseOpenRouterModels({
      data: [
        { id: "z/zephyr", name: "zephyr" }, // lowercase must not sort last
        { id: "a/alpha", name: "Alpha" },
        { id: "openai/dup", name: "Dup" },
        { id: "azure/dup", name: "Dup" }, // same name -> earlier id wins
      ],
    });
    expect(models.map((m) => m.id)).toEqual([
      "a/alpha",
      "azure/dup",
      "openai/dup",
      "z/zephyr",
    ]);
  });

  it("throws OpenRouterModelsError when `data` is not an array", () => {
    expect(() => parseOpenRouterModels({})).toThrow(OpenRouterModelsError);
    expect(() => parseOpenRouterModels(null)).toThrow(OpenRouterModelsError);
  });
});

/** Read the headers object from a recorded fetch call's init arg. */
function headersOfCall(
  mock: ReturnType<typeof makeFetchMock>,
  callIndex = 0
): Record<string, string> {
  const init = mock.mock.calls[callIndex]?.[1];
  return (init?.headers ?? {}) as Record<string, string>;
}

describe("fetchOpenRouterModels", () => {
  it("GETs /models with Authorization + attribution headers and parses", async () => {
    const fetchMock = makeFetchMock(async () => jsonResponse(SAMPLE));
    const models = await fetchOpenRouterModels("sk-or-key", { fetch: fetchMock });
    expect(models).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${OPENROUTER_API_BASE}/models`);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("GET");
    const headers = headersOfCall(fetchMock);
    expect(headers.Authorization).toBe("Bearer sk-or-key");
    expect(headers["X-Title"]).toBe(DASH_AGENT_TITLE);
  });

  it("trims the key before sending it", async () => {
    const fetchMock = makeFetchMock(async () => jsonResponse(SAMPLE));
    await fetchOpenRouterModels("  sk-or-padded  ", { fetch: fetchMock });
    expect(headersOfCall(fetchMock).Authorization).toBe("Bearer sk-or-padded");
  });

  it("rejects with OpenRouterModelsError when no key is given", async () => {
    const fetchMock = makeFetchMock(async () => jsonResponse(SAMPLE));
    await expect(fetchOpenRouterModels("   ", { fetch: fetchMock })).rejects.toThrow(
      OpenRouterModelsError
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects with the HTTP status on a non-2xx response", async () => {
    const fetchMock = makeFetchMock(async () => jsonResponse({}, false, 401));
    await expect(
      fetchOpenRouterModels("sk-or-bad", { fetch: fetchMock })
    ).rejects.toMatchObject({ status: 401 });
  });

  it("rejects gracefully on a network failure", async () => {
    const fetchMock = makeFetchMock(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(
      fetchOpenRouterModels("sk-or-net", { fetch: fetchMock })
    ).rejects.toThrow(OpenRouterModelsError);
  });

  it("rejects gracefully when the body is not JSON", async () => {
    const fetchMock = makeFetchMock(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError("Unexpected token");
          },
        }) as unknown as Response
    );
    await expect(
      fetchOpenRouterModels("sk-or-json", { fetch: fetchMock })
    ).rejects.toThrow(OpenRouterModelsError);
  });

  it("honors a custom baseUrl override", async () => {
    const fetchMock = makeFetchMock(async () => jsonResponse(SAMPLE));
    await fetchOpenRouterModels("sk-or-key", {
      fetch: fetchMock,
      baseUrl: "https://proxy.example/v1",
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://proxy.example/v1/models");
  });
});
