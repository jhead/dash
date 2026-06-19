// Unit tests for the Agent Chat system prompt (Phase 2, task 1277).

import { describe, it, expect } from "vitest";
import { AGENT_SYSTEM_PROMPT, buildAgentSystemPrompt } from "../systemPrompt.js";

describe("AGENT_SYSTEM_PROMPT", () => {
  it("describes Dash as a Flash 8 authoring tool and the model basics", () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/Dash/);
    expect(AGENT_SYSTEM_PROMPT).toMatch(/Flash 8/);
    // document / timeline / library model basics
    expect(AGENT_SYSTEM_PROMPT).toMatch(/timeline/i);
    expect(AGENT_SYSTEM_PROMPT).toMatch(/library/i);
    expect(AGENT_SYSTEM_PROMPT).toMatch(/keyframe/i);
  });

  it("tells the assistant it drives the app via tools and should read state first", () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/tool/i);
    expect(AGENT_SYSTEM_PROMPT).toMatch(/doc_summary/);
    expect(AGENT_SYSTEM_PROMPT).toMatch(/editor_status/);
    expect(AGENT_SYSTEM_PROMPT).toMatch(/read before/i);
  });

  it("mentions the editor-not-ready recovery hint", () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/editor not ready/i);
  });
});

describe("buildAgentSystemPrompt", () => {
  it("returns the base prompt unchanged when no addendum is given", () => {
    expect(buildAgentSystemPrompt()).toBe(AGENT_SYSTEM_PROMPT);
    expect(buildAgentSystemPrompt("   ")).toBe(AGENT_SYSTEM_PROMPT);
  });

  it("appends a session-context addendum when provided", () => {
    const out = buildAgentSystemPrompt("doc is 800x600");
    expect(out.startsWith(AGENT_SYSTEM_PROMPT)).toBe(true);
    expect(out).toMatch(/Session context/);
    expect(out).toMatch(/doc is 800x600/);
  });
});
