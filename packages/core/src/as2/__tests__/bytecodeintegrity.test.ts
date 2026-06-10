import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function getBytes(src: string): Uint8Array {
  return compileAS2(src);
}

function includesSeq(bytes: Uint8Array, seq: number[]): boolean {
  outer: for (let i = 0; i <= bytes.length - seq.length; i++) {
    for (let j = 0; j < seq.length; j++) {
      if (bytes[i + j] !== seq[j]) continue outer;
    }
    return true;
  }
  return false;
}

describe("AVM1 bytecode integrity", () => {
  it("trace('hi') contains ActionPush (0x96)", () => {
    const bytes = getBytes(`trace("hi");`);
    expect(bytes.includes(0x96)).toBe(true); // ActionPush
  });

  it("trace('hi') contains ActionTrace (0x26)", () => {
    const bytes = getBytes(`trace("hi");`);
    expect(bytes.includes(0x26)).toBe(true); // ActionTrace
  });

  it("var x = 1 contains ActionDefineLocal (0x3c or 0x41)", () => {
    const bytes = getBytes(`var x = 1;`);
    // ActionDefineLocal = 0x3c or ActionDefineLocal2 = 0x41
    const hasDefineLocal = bytes.includes(0x3c) || bytes.includes(0x41);
    expect(hasDefineLocal).toBe(true);
  });

  it("x = 1 contains ActionSetVariable (0x1d)", () => {
    const bytes = getBytes(`x = 1;`);
    expect(bytes.includes(0x1d)).toBe(true); // ActionSetVariable
  });

  it("if statement contains ActionIf (0x9d)", () => {
    const bytes = getBytes(`if (x) { trace("yes"); }`);
    expect(bytes.includes(0x9d)).toBe(true); // ActionIf
  });

  it("while loop contains ActionJump (0x99)", () => {
    const bytes = getBytes(`while (i < 10) { i++; }`);
    expect(bytes.includes(0x99)).toBe(true); // ActionJump
  });

  it("function declaration contains ActionDefineFunction2 (0x8e)", () => {
    const bytes = getBytes(`function foo() { return 1; }`);
    expect(bytes.includes(0x8e)).toBe(true); // ActionDefineFunction2
  });

  it("new Foo() contains ActionNew (0x40)", () => {
    const bytes = getBytes(`var f = new Foo();`);
    expect(bytes.includes(0x40)).toBe(true); // ActionNew
  });

  it("mc.play() contains ActionCallMethod (0x52)", () => {
    const bytes = getBytes(`mc.play();`);
    expect(bytes.includes(0x52)).toBe(true); // ActionCallMethod
  });

  it("mc.x = 1 contains ActionSetMember (0x4f)", () => {
    const bytes = getBytes(`mc.x = 1;`);
    expect(bytes.includes(0x4f)).toBe(true); // ActionSetMember
  });

  it("mc.x access contains ActionGetMember (0x4e)", () => {
    const bytes = getBytes(`var x = mc.x;`);
    expect(bytes.includes(0x4e)).toBe(true); // ActionGetMember
  });

  it("output is non-empty Uint8Array", () => {
    const bytes = getBytes(`trace("test");`);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
  });
});
