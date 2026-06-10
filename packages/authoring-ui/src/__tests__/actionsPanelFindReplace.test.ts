import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Unit tests for the find/replace logic in ScriptEditor.
//
// The core find/replace algorithms are pure functions embedded inside the
// React component. We extract the logic here to verify correctness without
// needing a DOM environment.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// getAllMatches — mirror of the useCallback inside ScriptEditor
// ---------------------------------------------------------------------------

function getAllMatches(script: string, findText: string): Array<{ start: number; end: number }> {
  if (!findText) return [];
  const results: Array<{ start: number; end: number }> = [];
  let from = 0;
  while (true) {
    const idx = script.indexOf(findText, from);
    if (idx === -1) break;
    results.push({ start: idx, end: idx + findText.length });
    from = idx + findText.length;
  }
  return results;
}

// ---------------------------------------------------------------------------
// replaceOne — replace match at given index
// ---------------------------------------------------------------------------

function replaceOne(script: string, findText: string, replaceText: string, matchIndex: number): string {
  const matches = getAllMatches(script, findText);
  if (matches.length === 0) return script;
  const idx = ((matchIndex % matches.length) + matches.length) % matches.length;
  const m = matches[idx];
  return script.slice(0, m.start) + replaceText + script.slice(m.end);
}

// ---------------------------------------------------------------------------
// replaceAll — replace all occurrences
// ---------------------------------------------------------------------------

function replaceAll(script: string, findText: string, replaceText: string): string {
  if (!findText) return script;
  return script.split(findText).join(replaceText);
}

// ---------------------------------------------------------------------------
// Tests: getAllMatches
// ---------------------------------------------------------------------------

describe("getAllMatches", () => {
  it("returns empty array when findText is empty", () => {
    expect(getAllMatches("var x = 5;", "")).toEqual([]);
  });

  it("returns empty array when there are no matches", () => {
    expect(getAllMatches("var x = 5;", "function")).toEqual([]);
  });

  it("finds a single match", () => {
    const matches = getAllMatches("var x = 5;", "var");
    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual({ start: 0, end: 3 });
  });

  it("finds multiple non-overlapping matches", () => {
    const script = "var a = 1; var b = 2;";
    const matches = getAllMatches(script, "var");
    expect(matches).toHaveLength(2);
    expect(matches[0]).toEqual({ start: 0, end: 3 });
    expect(matches[1]).toEqual({ start: 11, end: 14 });
  });

  it("finds match at end of string", () => {
    const script = "x = 1;\ntrace";
    const matches = getAllMatches(script, "trace");
    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual({ start: 7, end: 12 });
  });

  it("handles multi-character search term", () => {
    const script = "gotoAndStop(1); gotoAndStop(2);";
    const matches = getAllMatches(script, "gotoAndStop");
    expect(matches).toHaveLength(2);
  });

  it("finds single-char matches", () => {
    const script = "a = a + a;";
    const matches = getAllMatches(script, "a");
    expect(matches).toHaveLength(3);
    expect(matches[0].start).toBe(0);
    expect(matches[1].start).toBe(4);
    expect(matches[2].start).toBe(8);
  });

  it("is case-sensitive", () => {
    expect(getAllMatches("Var var VAR", "var")).toHaveLength(1);
  });

  it("returns correct end positions", () => {
    const matches = getAllMatches("hello world", "world");
    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual({ start: 6, end: 11 });
  });
});

// ---------------------------------------------------------------------------
// Tests: replaceOne
// ---------------------------------------------------------------------------

describe("replaceOne", () => {
  it("replaces the first match when matchIndex is 0", () => {
    const result = replaceOne("var x = 1; var y = 2;", "var", "let", 0);
    expect(result).toBe("let x = 1; var y = 2;");
  });

  it("replaces the second match when matchIndex is 1", () => {
    const result = replaceOne("var x = 1; var y = 2;", "var", "let", 1);
    expect(result).toBe("var x = 1; let y = 2;");
  });

  it("wraps matchIndex with modulo", () => {
    const result = replaceOne("var x = 1; var y = 2;", "var", "let", 2);
    // 2 % 2 = 0 → first match
    expect(result).toBe("let x = 1; var y = 2;");
  });

  it("handles negative matchIndex (wraps correctly)", () => {
    const result = replaceOne("var x = 1; var y = 2;", "var", "let", -1);
    // -1 % 2 in JS = -1; corrected to 1 → second match
    expect(result).toBe("var x = 1; let y = 2;");
  });

  it("replaces with empty string (effectively deletes)", () => {
    const result = replaceOne("var x; var y;", "var ", "", 0);
    expect(result).toBe("x; var y;");
  });

  it("returns script unchanged when no matches", () => {
    const script = "var x = 1;";
    expect(replaceOne(script, "function", "fn", 0)).toBe(script);
  });

  it("can replace with longer string", () => {
    const result = replaceOne("x + y", "+", "plus", 0);
    expect(result).toBe("x plus y");
  });
});

// ---------------------------------------------------------------------------
// Tests: replaceAll
// ---------------------------------------------------------------------------

describe("replaceAll", () => {
  it("replaces all occurrences", () => {
    const result = replaceAll("var x = 1; var y = 2; var z = 3;", "var", "let");
    expect(result).toBe("let x = 1; let y = 2; let z = 3;");
  });

  it("returns script unchanged when findText is empty", () => {
    const script = "var x = 1;";
    expect(replaceAll(script, "", "let")).toBe(script);
  });

  it("returns script unchanged when no matches", () => {
    const script = "var x = 1;";
    expect(replaceAll(script, "function", "fn")).toBe(script);
  });

  it("can delete all occurrences (replace with empty string)", () => {
    const result = replaceAll("var x; var y; var z;", "var ", "");
    expect(result).toBe("x; y; z;");
  });

  it("handles single occurrence", () => {
    const result = replaceAll("stop();", "stop", "play");
    expect(result).toBe("play();");
  });

  it("handles multi-line scripts", () => {
    const script = "var x;\nvar y;\nvar z;";
    const result = replaceAll(script, "var", "let");
    expect(result).toBe("let x;\nlet y;\nlet z;");
  });
});

// ---------------------------------------------------------------------------
// Tests: currentMatchIndex wrapping
// ---------------------------------------------------------------------------

describe("match navigation (index wrapping)", () => {
  it("wraps forward past the last match back to first", () => {
    const matches = getAllMatches("a a a", "a");
    const count = matches.length; // 3
    // After navigating to index 3 (past the last), it wraps to 0
    const idx = ((3 % count) + count) % count;
    expect(idx).toBe(0);
  });

  it("wraps backward past the first match back to last", () => {
    const matches = getAllMatches("a a a", "a");
    const count = matches.length; // 3
    // Going back from index 0 → -1 → wraps to 2 (last)
    const idx = ((-1 % count) + count) % count;
    expect(idx).toBe(2);
  });
});
