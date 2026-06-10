import { describe, it, expect } from "vitest";
import { tokenizeLine, highlightLines } from "../ActionsPanel";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return token colors (in order) from a single line. */
function colorsOf(line: string, inBlock = false) {
  const { tokens } = tokenizeLine(line, inBlock);
  return tokens.map((t) => t.color);
}

/** Return the text of each token (in order). */
function textsOf(line: string, inBlock = false) {
  const { tokens } = tokenizeLine(line, inBlock);
  return tokens.map((t) => line.slice(t.start, t.end));
}

const C_KW  = "#569cd6";
const C_STR = "#CE9178";
const C_COM = "#6A9955";
const C_NUM = "#B5CEA8";

// ---------------------------------------------------------------------------
// Keywords
// ---------------------------------------------------------------------------

describe("keywords", () => {
  it("colors a standalone keyword", () => {
    expect(textsOf("var")).toEqual(["var"]);
    expect(colorsOf("var")).toEqual([C_KW]);
  });

  it("colors keyword inside expression", () => {
    const tokens = tokenizeLine("if (true)", false).tokens;
    const kws = tokens.filter((t) => t.color === C_KW).map((t) => "if (true)".slice(t.start, t.end));
    expect(kws).toContain("if");
    expect(kws).toContain("true");
  });

  it("does not color partial keyword inside identifier", () => {
    // "variable" contains "var" but should NOT be colored
    const { tokens } = tokenizeLine("variable", false);
    expect(tokens.filter((t) => t.color === C_KW)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// String literals
// ---------------------------------------------------------------------------

describe("string literals", () => {
  it("colors a double-quoted string", () => {
    expect(textsOf('"hello"')).toEqual(['"hello"']);
    expect(colorsOf('"hello"')).toEqual([C_STR]);
  });

  it("colors a single-quoted string", () => {
    expect(textsOf("'world'")).toEqual(["'world'"]);
    expect(colorsOf("'world'")).toEqual([C_STR]);
  });

  it("handles escaped quote inside string", () => {
    const line = '"say \\"hi\\""';
    const { tokens } = tokenizeLine(line, false);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].color).toBe(C_STR);
    expect(tokens[0].end).toBe(line.length);
  });

  it("does not treat content inside string as keywords", () => {
    const { tokens } = tokenizeLine('"var"', false);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].color).toBe(C_STR);
  });

  it("colors string and surrounding code separately", () => {
    const line = 'trace("hello")';
    const { tokens } = tokenizeLine(line, false);
    const strTok = tokens.find((t) => t.color === C_STR);
    expect(strTok).toBeDefined();
    expect(line.slice(strTok!.start, strTok!.end)).toBe('"hello"');
    const kwTok = tokens.find((t) => t.color === C_KW);
    expect(kwTok).toBeDefined();
    expect(line.slice(kwTok!.start, kwTok!.end)).toBe("trace");
  });
});

// ---------------------------------------------------------------------------
// Line comments
// ---------------------------------------------------------------------------

describe("line comments (//)", () => {
  it("colors // comment to end of line", () => {
    const line = "// this is a comment";
    expect(textsOf(line)).toEqual([line]);
    expect(colorsOf(line)).toEqual([C_COM]);
  });

  it("colors comment portion after code", () => {
    const line = "var x = 5; // count";
    const { tokens } = tokenizeLine(line, false);
    const comTok = tokens.find((t) => t.color === C_COM);
    expect(comTok).toBeDefined();
    expect(line.slice(comTok!.start)).toBe("// count");
  });

  it("does not color keywords inside a line comment", () => {
    const { tokens } = tokenizeLine("// var if while", false);
    expect(tokens.filter((t) => t.color === C_KW)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Block comments
// ---------------------------------------------------------------------------

describe("block comments (/* */)", () => {
  it("colors entire /* ... */ on a single line", () => {
    const line = "/* block comment */";
    expect(textsOf(line)).toEqual([line]);
    expect(colorsOf(line)).toEqual([C_COM]);
  });

  it("colors only the comment portion within a line", () => {
    const line = "var x = /* note */ 5;";
    const { tokens } = tokenizeLine(line, false);
    const com = tokens.find((t) => t.color === C_COM);
    expect(com).toBeDefined();
    expect(line.slice(com!.start, com!.end)).toBe("/* note */");
  });

  it("returns endsInBlockComment=true when /* has no closing */", () => {
    const { endsInBlockComment } = tokenizeLine("/* open block", false);
    expect(endsInBlockComment).toBe(true);
  });

  it("colors entire line when inBlockComment=true and no closing */", () => {
    const { tokens, endsInBlockComment } = tokenizeLine("still inside", true);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].color).toBe(C_COM);
    expect(endsInBlockComment).toBe(true);
  });

  it("closes block comment when */ appears in line", () => {
    const { tokens, endsInBlockComment } = tokenizeLine("  end */ var x;", true);
    // First token: comment portion
    expect(tokens[0].color).toBe(C_COM);
    expect("  end */ var x;".slice(tokens[0].start, tokens[0].end)).toBe("  end */");
    expect(endsInBlockComment).toBe(false);
  });

  it("handles multi-line block comment via highlightLines", () => {
    const lines = ["/* start", "middle", "end */", "var x;"];
    const nodes = highlightLines(lines);
    // Should produce 4 nodes without throwing
    expect(nodes).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// Numeric literals
// ---------------------------------------------------------------------------

describe("numeric literals", () => {
  it("colors an integer", () => {
    expect(textsOf("123")).toEqual(["123"]);
    expect(colorsOf("123")).toEqual([C_NUM]);
  });

  it("colors a float", () => {
    expect(textsOf("3.14")).toEqual(["3.14"]);
    expect(colorsOf("3.14")).toEqual([C_NUM]);
  });

  it("colors hex literal", () => {
    expect(textsOf("0xFF")).toEqual(["0xFF"]);
    expect(colorsOf("0xFF")).toEqual([C_NUM]);
  });

  it("does not color digits inside an identifier", () => {
    // "x2" — the 2 is not at a word boundary after a letter
    const { tokens } = tokenizeLine("x2", false);
    expect(tokens.filter((t) => t.color === C_NUM)).toHaveLength(0);
  });

  it("colors number in an expression", () => {
    const line = "var x = 42;";
    const { tokens } = tokenizeLine(line, false);
    const numTok = tokens.find((t) => t.color === C_NUM);
    expect(numTok).toBeDefined();
    expect(line.slice(numTok!.start, numTok!.end)).toBe("42");
  });
});

// ---------------------------------------------------------------------------
// Mixed / combined cases
// ---------------------------------------------------------------------------

describe("mixed tokens", () => {
  it("var x = 5; // count — number AND comment both colored", () => {
    const line = "var x = 5; // count";
    const { tokens } = tokenizeLine(line, false);
    const numTok = tokens.find((t) => t.color === C_NUM);
    const comTok = tokens.find((t) => t.color === C_COM);
    expect(numTok).toBeDefined();
    expect(line.slice(numTok!.start, numTok!.end)).toBe("5");
    expect(comTok).toBeDefined();
    expect(line.slice(comTok!.start)).toBe("// count");
  });

  it("string after keyword: trace('msg') — keyword + string colored", () => {
    const line = "trace('msg')";
    const { tokens } = tokenizeLine(line, false);
    expect(tokens.find((t) => t.color === C_KW)).toBeDefined();
    expect(tokens.find((t) => t.color === C_STR)).toBeDefined();
  });

  it("number inside string is NOT colored as number", () => {
    const line = '"value: 42"';
    const { tokens } = tokenizeLine(line, false);
    expect(tokens.filter((t) => t.color === C_NUM)).toHaveLength(0);
    expect(tokens.find((t) => t.color === C_STR)).toBeDefined();
  });

  it("keyword inside string is NOT colored as keyword", () => {
    const line = '"var"';
    const { tokens } = tokenizeLine(line, false);
    expect(tokens.filter((t) => t.color === C_KW)).toHaveLength(0);
  });

  it("tokens are non-overlapping and sorted by start", () => {
    const line = 'var x = 5; // count';
    const { tokens } = tokenizeLine(line, false);
    for (let i = 1; i < tokens.length; i++) {
      expect(tokens[i].start).toBeGreaterThanOrEqual(tokens[i - 1].end);
    }
  });

  it("highlightLines threads block comment state correctly", () => {
    const lines = [
      "/* open",
      "  middle line",
      "  close */ var x = 1;",
      "var y = 2;",
    ];
    const nodes = highlightLines(lines);
    expect(nodes).toHaveLength(4);
    // Should not throw; state is internal — just ensure it returns nodes
  });
});
