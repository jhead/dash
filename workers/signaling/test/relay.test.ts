/**
 * Unit tests for the y-webrtc signaling pub/sub relay (`src/relay.ts`).
 *
 * These run in plain Node (vitest) — NO Cloudflare credentials, NO miniflare
 * runtime — because the relay is a pure data structure. They pin the exact
 * upstream y-webrtc semantics: subscribe, publish-fans-out-to-subscribers,
 * unsubscribe, ping→pong, and close-cleanup.
 */
import { describe, expect, it } from "vitest";
import {
  SignalingRelay,
  parseSignalingFrame,
  type SendInstruction,
} from "../src/relay.js";

/** Collect the set of recipient ids from a list of send instructions. */
function recipients(out: SendInstruction[]): string[] {
  return out.map((o) => o.to).sort();
}

describe("SignalingRelay — subscribe", () => {
  it("records a subscription and tracks topic size", () => {
    const r = new SignalingRelay();
    r.addConnection("a");
    r.handleMessage("a", { type: "subscribe", topics: ["room-1"] });
    expect(r.topicSize("room-1")).toBe(1);
    expect(r.topicCount()).toBe(1);
  });

  it("subscribes a connection to multiple topics at once", () => {
    const r = new SignalingRelay();
    r.handleMessage("a", { type: "subscribe", topics: ["t1", "t2", "t3"] });
    expect(r.topicSize("t1")).toBe(1);
    expect(r.topicSize("t2")).toBe(1);
    expect(r.topicSize("t3")).toBe(1);
  });

  it("ignores non-string topic entries and non-array topics", () => {
    const r = new SignalingRelay();
    r.handleMessage("a", {
      type: "subscribe",
      topics: ["ok", 42, null, { x: 1 }],
    });
    expect(r.topicSize("ok")).toBe(1);
    expect(r.topicCount()).toBe(1);
    r.handleMessage("a", { type: "subscribe", topics: "not-an-array" });
    expect(r.topicCount()).toBe(1);
  });

  it("does not double-count a repeat subscribe (Set semantics)", () => {
    const r = new SignalingRelay();
    r.handleMessage("a", { type: "subscribe", topics: ["room"] });
    r.handleMessage("a", { type: "subscribe", topics: ["room"] });
    expect(r.topicSize("room")).toBe(1);
  });
});

describe("SignalingRelay — publish fan-out", () => {
  it("forwards a publish to ALL subscribers of the topic (incl. publisher)", () => {
    const r = new SignalingRelay();
    r.handleMessage("a", { type: "subscribe", topics: ["room"] });
    r.handleMessage("b", { type: "subscribe", topics: ["room"] });
    r.handleMessage("c", { type: "subscribe", topics: ["room"] });

    const out = r.handleMessage("a", {
      type: "publish",
      topic: "room",
      data: "sdp-offer",
    });
    // Upstream y-webrtc fans out to every subscriber of the topic, including the
    // publisher; it does NOT self-exclude.
    expect(recipients(out)).toEqual(["a", "b", "c"]);
  });

  it("only delivers to subscribers of the SAME topic, not other topics", () => {
    const r = new SignalingRelay();
    r.handleMessage("a", { type: "subscribe", topics: ["room-1"] });
    r.handleMessage("b", { type: "subscribe", topics: ["room-1"] });
    r.handleMessage("c", { type: "subscribe", topics: ["room-2"] });

    const out = r.handleMessage("a", { type: "publish", topic: "room-1" });
    expect(recipients(out)).toEqual(["a", "b"]);
    expect(recipients(out)).not.toContain("c");
  });

  it("preserves the publish payload and stamps the live `clients` count", () => {
    const r = new SignalingRelay();
    r.handleMessage("a", { type: "subscribe", topics: ["room"] });
    r.handleMessage("b", { type: "subscribe", topics: ["room"] });

    const out = r.handleMessage("a", {
      type: "publish",
      topic: "room",
      from: "peer-a",
      signal: { sdp: "v=0..." },
    });
    expect(out).toHaveLength(2);
    for (const { message } of out) {
      expect(message.type).toBe("publish");
      expect(message.topic).toBe("room");
      expect(message.from).toBe("peer-a");
      expect(message.signal).toEqual({ sdp: "v=0..." });
      // upstream stamps message.clients = receivers.size before fan-out
      expect(message.clients).toBe(2);
    }
  });

  it("returns no instructions when publishing to a topic with no subscribers", () => {
    const r = new SignalingRelay();
    const out = r.handleMessage("a", { type: "publish", topic: "empty" });
    expect(out).toEqual([]);
  });

  it("ignores a publish with a non-string / missing topic", () => {
    const r = new SignalingRelay();
    r.handleMessage("a", { type: "subscribe", topics: ["room"] });
    expect(r.handleMessage("a", { type: "publish" })).toEqual([]);
    expect(r.handleMessage("a", { type: "publish", topic: 99 })).toEqual([]);
  });
});

describe("SignalingRelay — unsubscribe", () => {
  it("removes a connection from a topic and drops empty topics", () => {
    const r = new SignalingRelay();
    r.handleMessage("a", { type: "subscribe", topics: ["room"] });
    r.handleMessage("b", { type: "subscribe", topics: ["room"] });
    expect(r.topicSize("room")).toBe(2);

    r.handleMessage("a", { type: "unsubscribe", topics: ["room"] });
    expect(r.topicSize("room")).toBe(1);
    expect(r.topicCount()).toBe(1);

    r.handleMessage("b", { type: "unsubscribe", topics: ["room"] });
    expect(r.topicSize("room")).toBe(0);
    // topic with no subscribers is garbage-collected
    expect(r.topicCount()).toBe(0);
  });

  it("an unsubscribed connection no longer receives publishes", () => {
    const r = new SignalingRelay();
    r.handleMessage("a", { type: "subscribe", topics: ["room"] });
    r.handleMessage("b", { type: "subscribe", topics: ["room"] });
    r.handleMessage("b", { type: "unsubscribe", topics: ["room"] });

    const out = r.handleMessage("a", { type: "publish", topic: "room" });
    expect(recipients(out)).toEqual(["a"]);
  });

  it("tolerates unsubscribe from a topic that was never subscribed", () => {
    const r = new SignalingRelay();
    expect(() =>
      r.handleMessage("a", { type: "unsubscribe", topics: ["ghost"] }),
    ).not.toThrow();
    expect(r.topicCount()).toBe(0);
  });
});

describe("SignalingRelay — ping/pong", () => {
  it("replies to a ping with a pong addressed to the sender only", () => {
    const r = new SignalingRelay();
    const out = r.handleMessage("a", { type: "ping" });
    expect(out).toEqual([{ to: "a", message: { type: "pong" } }]);
  });
});

describe("SignalingRelay — connection cleanup on close", () => {
  it("removes the connection from every topic it subscribed to", () => {
    const r = new SignalingRelay();
    r.handleMessage("a", { type: "subscribe", topics: ["r1", "r2"] });
    r.handleMessage("b", { type: "subscribe", topics: ["r1"] });
    expect(r.topicSize("r1")).toBe(2);
    expect(r.topicSize("r2")).toBe(1);

    r.removeConnection("a");
    expect(r.hasConnection("a")).toBe(false);
    expect(r.topicSize("r1")).toBe(1); // b remains
    expect(r.topicSize("r2")).toBe(0); // a was the only one
    expect(r.topicCount()).toBe(1); // r2 garbage-collected
  });

  it("a closed connection receives no further publishes", () => {
    const r = new SignalingRelay();
    r.handleMessage("a", { type: "subscribe", topics: ["room"] });
    r.handleMessage("b", { type: "subscribe", topics: ["room"] });
    r.removeConnection("b");

    const out = r.handleMessage("a", { type: "publish", topic: "room" });
    expect(recipients(out)).toEqual(["a"]);
  });

  it("removeConnection is idempotent / safe for an unknown id", () => {
    const r = new SignalingRelay();
    expect(() => r.removeConnection("nope")).not.toThrow();
  });
});

describe("SignalingRelay — robustness", () => {
  it("ignores messages with no/invalid type", () => {
    const r = new SignalingRelay();
    expect(r.handleMessage("a", {})).toEqual([]);
    expect(r.handleMessage("a", { type: 5 } as never)).toEqual([]);
    expect(r.handleMessage("a", { type: "bogus" })).toEqual([]);
  });

  it("implicitly registers an unknown connection on first message", () => {
    const r = new SignalingRelay();
    r.handleMessage("late", { type: "subscribe", topics: ["room"] });
    expect(r.hasConnection("late")).toBe(true);
    expect(r.topicSize("room")).toBe(1);
  });

  it("models a real 2-peer handshake (announce + signal both directions)", () => {
    const r = new SignalingRelay();
    // Both peers join the room topic.
    r.handleMessage("p1", { type: "subscribe", topics: ["room"] });
    r.handleMessage("p2", { type: "subscribe", topics: ["room"] });

    // p1 announces; both p1 and p2 receive it.
    const announce = r.handleMessage("p1", {
      type: "publish",
      topic: "room",
      data: { type: "announce", from: "p1" },
    });
    expect(recipients(announce)).toEqual(["p1", "p2"]);

    // p2 sends a signal back; both receive it.
    const signal = r.handleMessage("p2", {
      type: "publish",
      topic: "room",
      data: { type: "signal", from: "p2", to: "p1", signal: { sdp: "..." } },
    });
    expect(recipients(signal)).toEqual(["p1", "p2"]);
  });
});

describe("parseSignalingFrame", () => {
  it("parses a JSON string frame", () => {
    expect(parseSignalingFrame('{"type":"ping"}')).toEqual({ type: "ping" });
  });

  it("parses a Uint8Array (binary) frame", () => {
    const bytes = new TextEncoder().encode('{"type":"pong"}');
    expect(parseSignalingFrame(bytes)).toEqual({ type: "pong" });
  });

  it("parses an ArrayBuffer frame", () => {
    const bytes = new TextEncoder().encode('{"type":"x"}');
    const buf = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    expect(parseSignalingFrame(buf)).toEqual({ type: "x" });
  });

  it("returns null for non-JSON / non-object payloads", () => {
    expect(parseSignalingFrame("not json")).toBeNull();
    expect(parseSignalingFrame("123")).toBeNull();
    expect(parseSignalingFrame('"a string"')).toBeNull();
    expect(parseSignalingFrame("null")).toBeNull();
  });
});
