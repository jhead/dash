import { describe, it, expect } from "vitest";
import { validateFrameScript } from "../validate.js";

describe("validateFrameScript", () => {
  it("empty string returns valid", () => {
    const result = validateFrameScript("");
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("whitespace-only string returns valid", () => {
    const result = validateFrameScript("   \n\t  ");
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("trace('hi') returns valid", () => {
    const result = validateFrameScript("trace('hi');");
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("var x = 1 + 2 returns valid", () => {
    const result = validateFrameScript("var x = 1 + 2;");
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("function declaration returns valid", () => {
    const result = validateFrameScript("function foo() { return 42; }");
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("unclosed brace returns invalid", () => {
    const result = validateFrameScript("{");
    expect(result.valid).toBe(false);
  });

  it("invalid script has non-empty error message", () => {
    const result = validateFrameScript("{");
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    expect(typeof result.error!.message).toBe("string");
    expect(result.error!.message.length).toBeGreaterThan(0);
  });

  it("if (true) {} returns valid", () => {
    const result = validateFrameScript("if (true) { }");
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("complex valid script returns valid", () => {
    const script = `
      var count = 0;
      function increment() {
        count = count + 1;
        trace("count: " + count);
      }
      if (count < 10) {
        increment();
      }
    `;
    const result = validateFrameScript(script);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("null does not throw and returns valid", () => {
    expect(() => validateFrameScript(null as any)).not.toThrow();
    const result = validateFrameScript(null as any);
    expect(result.valid).toBe(true);
  });

  it("undefined does not throw and returns valid", () => {
    expect(() => validateFrameScript(undefined as any)).not.toThrow();
    const result = validateFrameScript(undefined as any);
    expect(result.valid).toBe(true);
  });
});
