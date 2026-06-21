// Unit tests for per-thread token + cost accounting (task 1337).
//
// Covers the three pure layers of the feature, with NO API key / network:
//   1. agentLoop: deriving a per-turn AgentTurnUsage from the SDK total usage +
//      per-step provider metadata (OpenRouter REPORTED cost, summed across steps).
//   2. openrouterClient: parsing model pricing and COMPUTING cost from it (the
//      fallback when no reported cost is available).
//   3. AgentChatPanel: formatting the compact "12,345 tokens · $0.0123" footer.

import { describe, it, expect } from "vitest";
import type { LanguageModelUsage } from "ai";
import {
  buildTurnUsage,
  sumOpenRouterReportedCost,
  emptyTurnUsage,
} from "../agentLoop.js";
import {
  parseModelPricing,
  computeCostFromPricing,
} from "../openrouterClient.js";
import { formatUsageLine, formatCost } from "../AgentChatPanel.js";
import { emptyThreadUsage, type ThreadUsage } from "../threadStore.js";

/** Minimal LanguageModelUsage with just the fields the helpers read. */
function usage(
  inputTokens: number,
  outputTokens: number,
  totalTokens?: number
): LanguageModelUsage {
  return {
    inputTokens,
    outputTokens,
    totalTokens: totalTokens ?? inputTokens + outputTokens,
    inputTokenDetails: {
      noCacheTokens: undefined,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    },
    outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
  } as LanguageModelUsage;
}

/** A fake step carrying an OpenRouter reported cost in its providerMetadata. */
function stepWithCost(cost: number): { providerMetadata: unknown } {
  return { providerMetadata: { openrouter: { usage: { cost } } } };
}

describe("agentLoop usage capture", () => {
  it("emptyTurnUsage is all-zero, not estimated", () => {
    expect(emptyTurnUsage()).toEqual({
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      costIsEstimated: false,
    });
  });

  it("buildTurnUsage carries token totals from the SDK total usage", () => {
    const u = buildTurnUsage(usage(100, 40, 140), []);
    expect(u.inputTokens).toBe(100);
    expect(u.outputTokens).toBe(40);
    expect(u.totalTokens).toBe(140);
    // No steps carried a reported cost -> cost undefined (caller computes it).
    expect(u.cost).toBeUndefined();
    expect(u.costIsEstimated).toBe(false);
  });

  it("buildTurnUsage falls back to input+output when totalTokens is missing", () => {
    const u = buildTurnUsage(usage(100, 40, undefined as unknown as number), []);
    expect(u.totalTokens).toBe(140);
  });

  it("buildTurnUsage treats undefined/negative token fields as zero", () => {
    const u = buildTurnUsage(
      usage(undefined as unknown as number, -5, undefined as unknown as number),
      []
    );
    expect(u.inputTokens).toBe(0);
    expect(u.outputTokens).toBe(0);
    expect(u.totalTokens).toBe(0);
  });

  it("sumOpenRouterReportedCost sums cost across ALL steps of the tool loop", () => {
    const steps = [stepWithCost(0.001), stepWithCost(0.0025), stepWithCost(0.0004)];
    expect(sumOpenRouterReportedCost(steps)).toBeCloseTo(0.0039, 10);
  });

  it("sumOpenRouterReportedCost returns undefined when NO step reports a cost", () => {
    expect(sumOpenRouterReportedCost([{}, { providerMetadata: {} }])).toBeUndefined();
    expect(
      sumOpenRouterReportedCost([{ providerMetadata: { openrouter: {} } }])
    ).toBeUndefined();
  });

  it("buildTurnUsage uses the REPORTED cost (not estimated) when steps carry it", () => {
    const u = buildTurnUsage(usage(100, 40), [stepWithCost(0.002), stepWithCost(0.001)]);
    expect(u.cost).toBeCloseTo(0.003, 10);
    expect(u.costIsEstimated).toBe(false);
  });
});

describe("openrouterClient cost-from-pricing", () => {
  it("parseModelPricing reads per-token prompt/completion price strings", () => {
    const pricing = parseModelPricing({
      pricing: { prompt: "0.000003", completion: "0.000015" },
    });
    expect(pricing).toEqual({ prompt: 0.000003, completion: 0.000015 });
  });

  it("parseModelPricing reads numeric (not just string) prices", () => {
    expect(
      parseModelPricing({ pricing: { prompt: 0.000002, completion: 0.000004 } })
    ).toEqual({ prompt: 0.000002, completion: 0.000004 });
  });

  it("parseModelPricing returns undefined unless BOTH prices are present", () => {
    // Half-populated pricing would value the missing side at $0 — degrade to
    // cost-unknown instead of a misleading estimate.
    expect(parseModelPricing({ pricing: { prompt: 0.000002 } })).toBeUndefined();
    expect(
      parseModelPricing({ pricing: { completion: 0.000006 } })
    ).toBeUndefined();
  });

  it("parseModelPricing returns undefined for missing/garbage pricing", () => {
    expect(parseModelPricing(undefined)).toBeUndefined();
    expect(parseModelPricing({})).toBeUndefined();
    expect(parseModelPricing({ pricing: {} })).toBeUndefined();
    expect(
      parseModelPricing({ pricing: { prompt: "n/a", completion: "0.001" } })
    ).toBeUndefined();
  });

  it("computeCostFromPricing = input*prompt + output*completion", () => {
    const pricing = { prompt: 0.000003, completion: 0.000015 };
    // 1000 prompt tokens * 3e-6 + 500 completion * 1.5e-5 = 0.003 + 0.0075
    expect(computeCostFromPricing(pricing, 1000, 500)).toBeCloseTo(0.0105, 10);
  });

  it("computeCostFromPricing returns undefined when pricing is missing", () => {
    expect(computeCostFromPricing(undefined, 1000, 500)).toBeUndefined();
  });

  it("computeCostFromPricing treats junk token counts as zero", () => {
    const pricing = { prompt: 0.000003, completion: 0.000015 };
    expect(
      computeCostFromPricing(pricing, NaN as number, -10)
    ).toBe(0);
  });
});

describe("formatUsageLine / formatCost (the Agent pane footer)", () => {
  it("returns null for an empty thread (no tokens)", () => {
    expect(formatUsageLine(emptyThreadUsage())).toBeNull();
  });

  it("shows tokens only when cost is unknown", () => {
    const u: ThreadUsage = {
      ...emptyThreadUsage(),
      totalTokens: 12345,
    };
    expect(formatUsageLine(u)).toBe("12,345 tokens");
  });

  it("shows the compact 'tokens · $cost' line for a known reported cost", () => {
    const u: ThreadUsage = {
      totalTokens: 12345,
      inputTokens: 10000,
      outputTokens: 2345,
      cost: 0.0123,
      costKnown: true,
      costHasEstimate: false,
    };
    expect(formatUsageLine(u)).toBe("12,345 tokens · $0.0123");
  });

  it("labels an estimated cost with ~ and ' est.'", () => {
    const u: ThreadUsage = {
      totalTokens: 1000,
      inputTokens: 800,
      outputTokens: 200,
      cost: 0.0042,
      costKnown: true,
      costHasEstimate: true,
    };
    expect(formatUsageLine(u)).toBe("1,000 tokens · ~$0.0042 est.");
  });

  it("formatCost shows <$0.0001 for a tiny non-zero cost", () => {
    expect(formatCost(0.00002, false)).toBe("<$0.0001");
    expect(formatCost(0.00002, true)).toBe("~<$0.0001 est.");
  });

  it("formatCost shows $0.0000 for an exact-zero known cost", () => {
    expect(formatCost(0, false)).toBe("$0.0000");
  });
});
