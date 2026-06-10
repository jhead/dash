/**
 * Tests for AS2 compiler: NetConnection and NetStream object construction,
 * method calls, property accesses, and callback assignments.
 *
 * Verifies that NetConnection/NetStream constructor calls, instance method
 * calls, property accesses, and callback assignments compile without error and
 * emit the correct AVM1 opcodes:
 *   - ActionNew        (0x40): constructor calls (new NetConnection(), new NetStream(...))
 *   - ActionCallMethod (0x52): method calls (nc.connect(), ns.play(), etc.)
 *   - ActionGetMember  (0x4e): property reads (ns.bufferLength, ns.time, etc.)
 *   - ActionSetMember  (0x4f): property writes (nc.onStatus = ..., ns.onStatus = ...)
 */

import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compilesOk(source: string): boolean {
  try {
    compileAS2(source);
    return true;
  } catch {
    return false;
  }
}

function containsByte(bytes: Uint8Array, byte: number): boolean {
  return bytes.includes(byte);
}

function containsString(bytes: Uint8Array, s: string): boolean {
  const enc = new TextEncoder().encode(s);
  outer: for (let i = 0; i <= bytes.length - enc.length; i++) {
    for (let j = 0; j < enc.length; j++) {
      if (bytes[i + j] !== enc[j]) continue outer;
    }
    if (bytes[i + enc.length] === 0) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// AVM1 opcodes under test
// ---------------------------------------------------------------------------

const ACTION_NEW         = 0x40; // ActionNew        — constructor call
const ACTION_CALL_METHOD = 0x52; // ActionCallMethod — method dispatch
const ACTION_GET_MEMBER  = 0x4e; // ActionGetMember  — property read
const ACTION_SET_MEMBER  = 0x4f; // ActionSetMember  — property write

// ---------------------------------------------------------------------------
// NetConnection constructor
// ---------------------------------------------------------------------------

describe("NetConnection constructor", () => {
  it("new NetConnection() compiles without error", () => {
    expect(compilesOk("new NetConnection();")).toBe(true);
  });

  it("new NetConnection() emits ActionNew (0x40)", () => {
    const bytes = compileAS2("new NetConnection();");
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "NetConnection")).toBe(true);
  });

  it("var nc = new NetConnection() compiles without error", () => {
    expect(compilesOk("var nc = new NetConnection();")).toBe(true);
  });

  it("var nc = new NetConnection() emits ActionNew (0x40)", () => {
    const bytes = compileAS2("var nc = new NetConnection();");
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "NetConnection")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// NetConnection.connect()
// ---------------------------------------------------------------------------

describe("NetConnection connect()", () => {
  it('nc.connect("rtmp://server/app") compiles without error', () => {
    expect(
      compilesOk('var nc = new NetConnection(); nc.connect("rtmp://server/app");')
    ).toBe(true);
  });

  it('nc.connect("rtmp://server/app") emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2(
      'var nc = new NetConnection(); nc.connect("rtmp://server/app");'
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "connect")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// NetConnection.close()
// ---------------------------------------------------------------------------

describe("NetConnection close()", () => {
  it("nc.close() compiles without error", () => {
    expect(
      compilesOk("var nc = new NetConnection(); nc.close();")
    ).toBe(true);
  });

  it("nc.close() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var nc = new NetConnection(); nc.close();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "close")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// NetConnection.onStatus callback assignment
// ---------------------------------------------------------------------------

describe("NetConnection onStatus callback", () => {
  it("nc.onStatus = function(info) {} compiles without error", () => {
    expect(
      compilesOk("var nc = new NetConnection(); nc.onStatus = function(info) {};")
    ).toBe(true);
  });

  it("nc.onStatus = function(info) {} emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2(
      "var nc = new NetConnection(); nc.onStatus = function(info) {};"
    );
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "onStatus")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// NetStream constructor
// ---------------------------------------------------------------------------

describe("NetStream constructor", () => {
  it("new NetStream(nc) compiles without error", () => {
    expect(
      compilesOk("var nc = new NetConnection(); new NetStream(nc);")
    ).toBe(true);
  });

  it("new NetStream(nc) emits ActionNew (0x40)", () => {
    const bytes = compileAS2("var nc = new NetConnection(); new NetStream(nc);");
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "NetStream")).toBe(true);
  });

  it("var ns = new NetStream(nc) compiles without error", () => {
    expect(
      compilesOk("var nc = new NetConnection(); var ns = new NetStream(nc);")
    ).toBe(true);
  });

  it("var ns = new NetStream(nc) emits ActionNew (0x40)", () => {
    const bytes = compileAS2(
      "var nc = new NetConnection(); var ns = new NetStream(nc);"
    );
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "NetStream")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// NetStream.play()
// ---------------------------------------------------------------------------

describe("NetStream play()", () => {
  it('ns.play("video.flv") compiles without error', () => {
    expect(
      compilesOk(
        'var nc = new NetConnection(); var ns = new NetStream(nc); ns.play("video.flv");'
      )
    ).toBe(true);
  });

  it('ns.play("video.flv") emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2(
      'var nc = new NetConnection(); var ns = new NetStream(nc); ns.play("video.flv");'
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "play")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// NetStream.pause()
// ---------------------------------------------------------------------------

describe("NetStream pause()", () => {
  it("ns.pause() compiles without error", () => {
    expect(
      compilesOk(
        "var nc = new NetConnection(); var ns = new NetStream(nc); ns.pause();"
      )
    ).toBe(true);
  });

  it("ns.pause() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      "var nc = new NetConnection(); var ns = new NetStream(nc); ns.pause();"
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "pause")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// NetStream.resume()
// ---------------------------------------------------------------------------

describe("NetStream resume()", () => {
  it("ns.resume() compiles without error", () => {
    expect(
      compilesOk(
        "var nc = new NetConnection(); var ns = new NetStream(nc); ns.resume();"
      )
    ).toBe(true);
  });

  it("ns.resume() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      "var nc = new NetConnection(); var ns = new NetStream(nc); ns.resume();"
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "resume")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// NetStream.seek()
// ---------------------------------------------------------------------------

describe("NetStream seek()", () => {
  it("ns.seek(10) compiles without error", () => {
    expect(
      compilesOk(
        "var nc = new NetConnection(); var ns = new NetStream(nc); ns.seek(10);"
      )
    ).toBe(true);
  });

  it("ns.seek(10) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      "var nc = new NetConnection(); var ns = new NetStream(nc); ns.seek(10);"
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "seek")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// NetStream.close()
// ---------------------------------------------------------------------------

describe("NetStream close()", () => {
  it("ns.close() compiles without error", () => {
    expect(
      compilesOk(
        "var nc = new NetConnection(); var ns = new NetStream(nc); ns.close();"
      )
    ).toBe(true);
  });

  it("ns.close() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      "var nc = new NetConnection(); var ns = new NetStream(nc); ns.close();"
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "close")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// NetStream.onStatus callback assignment
// ---------------------------------------------------------------------------

describe("NetStream onStatus callback", () => {
  it("ns.onStatus = function(info) {} compiles without error", () => {
    expect(
      compilesOk(
        "var nc = new NetConnection(); var ns = new NetStream(nc); ns.onStatus = function(info) {};"
      )
    ).toBe(true);
  });

  it("ns.onStatus = function(info) {} emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2(
      "var nc = new NetConnection(); var ns = new NetStream(nc); ns.onStatus = function(info) {};"
    );
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "onStatus")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// NetStream property reads
// ---------------------------------------------------------------------------

describe("NetStream property reads", () => {
  it("ns.bufferLength compiles without error", () => {
    expect(
      compilesOk(
        "var nc = new NetConnection(); var ns = new NetStream(nc); ns.bufferLength;"
      )
    ).toBe(true);
  });

  it("ns.bufferLength emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2(
      "var nc = new NetConnection(); var ns = new NetStream(nc); ns.bufferLength;"
    );
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "bufferLength")).toBe(true);
  });

  it("ns.time compiles without error", () => {
    expect(
      compilesOk(
        "var nc = new NetConnection(); var ns = new NetStream(nc); ns.time;"
      )
    ).toBe(true);
  });

  it("ns.time emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2(
      "var nc = new NetConnection(); var ns = new NetStream(nc); ns.time;"
    );
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "time")).toBe(true);
  });
});
