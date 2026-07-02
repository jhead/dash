/**
 * Unit tests for the open-relay abuse guards (task 1355).
 *
 * The hardening is split so it is testable in plain Node (no miniflare):
 *   - relay-level caps + publish rate limit live IN `SignalingRelay`
 *     (`subscribe`/`publish` paths), driven by the `LIMITS` constants;
 *   - the Durable-Object-level guards (Origin allowlist, max message size) are
 *     factored into the PURE helpers `isOriginAllowed` / `parseAllowedOrigins` /
 *     `frameByteLength` / `TokenBucket` that `src/index.ts` calls, so they are
 *     exercised here directly without the Cloudflare runtime.
 *
 * Each guard has a "cap exceeded → rejected/dropped" case AND a
 * "normal flow still works" case, so a stock y-webrtc client stays unaffected.
 */
import { describe, expect, it } from "vitest";
import {
  LIMITS,
  SignalingRelay,
  TokenBucket,
  frameByteLength,
  isOriginAllowed,
  parseAllowedOrigins,
  type SendInstruction,
} from "../src/relay.js";

function recipients(out: SendInstruction[]): string[] {
  return out.map((o) => o.to).sort();
}

describe("guard: per-connection topic cap", () => {
  it("normal flow — subscribing to a handful of rooms is unaffected", () => {
    const r = new SignalingRelay();
    r.handleMessage("a", { type: "subscribe", topics: ["room-1", "room-2"] });
    expect(r.topicSize("room-1")).toBe(1);
    expect(r.topicSize("room-2")).toBe(1);
  });

  it("cap exceeded — drops topics past MAX_TOPICS_PER_CONNECTION", () => {
    const r = new SignalingRelay();
    const many = Array.from(
      { length: LIMITS.MAX_TOPICS_PER_CONNECTION + 25 },
      (_, i) => `t${i}`,
    );
    r.handleMessage("a", { type: "subscribe", topics: many });
    // The connection holds at most the cap; the surplus topics never existed.
    expect(r.topicCount()).toBe(LIMITS.MAX_TOPICS_PER_CONNECTION);
    expect(r.topicSize(`t${LIMITS.MAX_TOPICS_PER_CONNECTION + 10}`)).toBe(0);
  });

  it("a repeat subscribe to an existing topic does not consume cap budget", () => {
    const r = new SignalingRelay();
    const atCap = Array.from(
      { length: LIMITS.MAX_TOPICS_PER_CONNECTION },
      (_, i) => `t${i}`,
    );
    r.handleMessage("a", { type: "subscribe", topics: atCap });
    // re-subscribing to one it already has is fine and changes nothing
    r.handleMessage("a", { type: "subscribe", topics: ["t0"] });
    expect(r.topicSize("t0")).toBe(1);
    expect(r.topicCount()).toBe(LIMITS.MAX_TOPICS_PER_CONNECTION);
  });
});

describe("guard: per-topic subscriber cap", () => {
  it("normal flow — a small room fills normally", () => {
    const r = new SignalingRelay();
    for (let i = 0; i < 5; i++) {
      r.handleMessage(`c${i}`, { type: "subscribe", topics: ["room"] });
    }
    expect(r.topicSize("room")).toBe(5);
  });

  it("cap exceeded — refuses subscribers past MAX_SUBSCRIBERS_PER_TOPIC", () => {
    const r = new SignalingRelay();
    const over = LIMITS.MAX_SUBSCRIBERS_PER_TOPIC + 30;
    for (let i = 0; i < over; i++) {
      r.handleMessage(`c${i}`, { type: "subscribe", topics: ["room"] });
    }
    expect(r.topicSize("room")).toBe(LIMITS.MAX_SUBSCRIBERS_PER_TOPIC);
  });

  it("a refused subscriber receives no fan-out for that topic", () => {
    const r = new SignalingRelay();
    for (let i = 0; i < LIMITS.MAX_SUBSCRIBERS_PER_TOPIC; i++) {
      r.handleMessage(`c${i}`, { type: "subscribe", topics: ["room"] });
    }
    // one more, which is refused
    r.handleMessage("late", { type: "subscribe", topics: ["room"] });
    const out = r.handleMessage("c0", { type: "publish", topic: "room" });
    expect(recipients(out)).not.toContain("late");
    expect(out).toHaveLength(LIMITS.MAX_SUBSCRIBERS_PER_TOPIC);
  });
});

describe("guard: per-connection publish rate limit", () => {
  it("normal flow — a burst of handshake publishes goes through", () => {
    const r = new SignalingRelay();
    r.handleMessage("a", { type: "subscribe", topics: ["room"] }, 0);
    r.handleMessage("b", { type: "subscribe", topics: ["room"] }, 0);
    let delivered = 0;
    for (let i = 0; i < LIMITS.PUBLISH_BURST; i++) {
      const out = r.handleMessage("a", { type: "publish", topic: "room" }, 0);
      if (out.length > 0) delivered++;
    }
    expect(delivered).toBe(LIMITS.PUBLISH_BURST);
  });

  it("cap exceeded — publishes past the burst (same instant) are dropped", () => {
    const r = new SignalingRelay();
    r.handleMessage("a", { type: "subscribe", topics: ["room"] }, 0);
    r.handleMessage("b", { type: "subscribe", topics: ["room"] }, 0);
    // Drain the bucket at t=0.
    for (let i = 0; i < LIMITS.PUBLISH_BURST; i++) {
      r.handleMessage("a", { type: "publish", topic: "room" }, 0);
    }
    // The very next publish at the same instant is rate-limited.
    const out = r.handleMessage("a", { type: "publish", topic: "room" }, 0);
    expect(out).toEqual([]);
  });

  it("the bucket refills over time, restoring publish capacity", () => {
    const r = new SignalingRelay();
    r.handleMessage("a", { type: "subscribe", topics: ["room"] }, 0);
    r.handleMessage("b", { type: "subscribe", topics: ["room"] }, 0);
    for (let i = 0; i < LIMITS.PUBLISH_BURST; i++) {
      r.handleMessage("a", { type: "publish", topic: "room" }, 0);
    }
    expect(r.handleMessage("a", { type: "publish", topic: "room" }, 0)).toEqual(
      [],
    );
    // After 1 second, ~PUBLISH_REFILL_PER_SEC tokens are back.
    const out = r.handleMessage("a", { type: "publish", topic: "room" }, 1000);
    expect(out.length).toBeGreaterThan(0);
  });

  it("rate limiting is per-connection — one floods, another is unaffected", () => {
    const r = new SignalingRelay();
    r.handleMessage("flood", { type: "subscribe", topics: ["room"] }, 0);
    r.handleMessage("calm", { type: "subscribe", topics: ["room"] }, 0);
    for (let i = 0; i < LIMITS.PUBLISH_BURST + 5; i++) {
      r.handleMessage("flood", { type: "publish", topic: "room" }, 0);
    }
    // `calm` still has a full bucket.
    const out = r.handleMessage("calm", { type: "publish", topic: "room" }, 0);
    expect(out.length).toBeGreaterThan(0);
  });
});

describe("TokenBucket", () => {
  it("allows up to `capacity` immediate takes, then refuses", () => {
    const b = new TokenBucket(3, 1, 0);
    expect(b.take(0)).toBe(true);
    expect(b.take(0)).toBe(true);
    expect(b.take(0)).toBe(true);
    expect(b.take(0)).toBe(false);
  });

  it("refills at refillPerSec and never exceeds capacity", () => {
    const b = new TokenBucket(2, 2, 0);
    b.take(0);
    b.take(0);
    expect(b.take(0)).toBe(false);
    // 1s later → +2 tokens (capped at capacity 2)
    expect(b.take(1000)).toBe(true);
    expect(b.take(1000)).toBe(true);
    expect(b.take(1000)).toBe(false);
  });
});

describe("TokenBucket — snapshot / restore (hibernation persistence)", () => {
  it("snapshot captures the live token count + last-take time", () => {
    const b = new TokenBucket(3, 1, 0);
    b.take(0);
    const s = b.snapshot();
    expect(s.tokens).toBe(2);
    expect(s.last).toBe(0);
  });

  it("restore rehydrates a drained bucket so it stays drained", () => {
    const drained = new TokenBucket(3, 1, 0);
    drained.take(0);
    drained.take(0);
    drained.take(0);
    expect(drained.take(0)).toBe(false);
    const s = drained.snapshot();

    // A fresh bucket restored from that snapshot is still empty at the same instant.
    const revived = new TokenBucket(3, 1, s.last);
    revived.restore(s);
    expect(revived.take(0)).toBe(false);
    // ...and refills from the persisted `last`, not from a full reset.
    expect(revived.take(3000)).toBe(true);
  });
});

describe("SignalingRelay — publish rate-limit survives hibernation", () => {
  it("bucketState is null before any publish, then reflects consumption", () => {
    const r = new SignalingRelay();
    r.handleMessage("a", { type: "subscribe", topics: ["room"] }, 0);
    expect(r.bucketState("a")).toBeNull();
    r.handleMessage("a", { type: "publish", topic: "room" }, 0);
    const s = r.bucketState("a");
    expect(s).not.toBeNull();
    expect(s?.tokens).toBe(LIMITS.PUBLISH_BURST - 1);
  });

  it("a drained bucket, persisted then restored into a NEW relay, stays drained", () => {
    // Simulate a pre-hibernation relay: drain the bucket at t=0.
    const before = new SignalingRelay();
    before.handleMessage("a", { type: "subscribe", topics: ["room"] }, 0);
    before.handleMessage("b", { type: "subscribe", topics: ["room"] }, 0);
    for (let i = 0; i < LIMITS.PUBLISH_BURST; i++) {
      before.handleMessage("a", { type: "publish", topic: "room" }, 0);
    }
    expect(before.handleMessage("a", { type: "publish", topic: "room" }, 0)).toEqual([]);
    const persisted = before.bucketState("a");
    expect(persisted).not.toBeNull();

    // Simulate a hibernation wake: a brand-new relay rehydrated from attachments.
    const after = new SignalingRelay();
    after.handleMessage("a", { type: "subscribe", topics: ["room"] }, 0);
    after.handleMessage("b", { type: "subscribe", topics: ["room"] }, 0);
    after.restoreBucket("a", persisted!);
    // Without restore this would reset to a full burst; with it, still limited.
    expect(after.handleMessage("a", { type: "publish", topic: "room" }, 0)).toEqual([]);
    // And it refills over time from the persisted timestamp.
    expect(
      after.handleMessage("a", { type: "publish", topic: "room" }, 1000).length,
    ).toBeGreaterThan(0);
  });
});

describe("guard: max message size (frameByteLength)", () => {
  it("normal flow — a typical handshake frame is well under the cap", () => {
    const frame = JSON.stringify({
      type: "publish",
      topic: "room",
      data: { sdp: "v=0...".repeat(50) },
    });
    expect(frameByteLength(frame)).toBeLessThan(LIMITS.MAX_MESSAGE_BYTES);
  });

  it("cap exceeded — an oversized frame is over MAX_MESSAGE_BYTES", () => {
    const huge = "x".repeat(LIMITS.MAX_MESSAGE_BYTES + 1);
    expect(frameByteLength(huge)).toBeGreaterThan(LIMITS.MAX_MESSAGE_BYTES);
  });

  it("measures strings as UTF-8 bytes, not characters", () => {
    // a 2-char string of 4-byte code points = 8 bytes
    expect(frameByteLength("😀😀")).toBe(8);
  });

  it("measures binary frames by byte length", () => {
    const u8 = new Uint8Array(100);
    expect(frameByteLength(u8)).toBe(100);
    expect(frameByteLength(u8.buffer)).toBe(100);
  });
});

describe("guard: Origin allowlist (parseAllowedOrigins)", () => {
  it("splits on commas and whitespace, lower-cases, strips trailing slash", () => {
    expect(
      parseAllowedOrigins("https://A.com/, https://B.com  https://C.com//"),
    ).toEqual(["https://a.com", "https://b.com", "https://c.com"]);
  });

  it("returns [] for empty / undefined / null", () => {
    expect(parseAllowedOrigins("")).toEqual([]);
    expect(parseAllowedOrigins(undefined)).toEqual([]);
    expect(parseAllowedOrigins(null)).toEqual([]);
  });
});

describe("guard: Origin allowlist (isOriginAllowed)", () => {
  const allow = ["https://dash.jxh.io", "http://localhost:1420"];

  it("normal flow — an allowed Origin is accepted", () => {
    expect(isOriginAllowed("https://dash.jxh.io", allow)).toBe(true);
    // case + trailing-slash insensitive
    expect(isOriginAllowed("https://DASH.jxh.io/", allow)).toBe(true);
    expect(isOriginAllowed("http://localhost:1420", allow)).toBe(true);
  });

  it("disallowed — a third-party web Origin is rejected", () => {
    expect(isOriginAllowed("https://evil.example.com", allow)).toBe(false);
  });

  it("empty allowlist = fully open (the y-webrtc default)", () => {
    expect(isOriginAllowed("https://anything.com", [])).toBe(true);
    expect(isOriginAllowed(null, [])).toBe(true);
  });

  it("'*' in the allowlist = fully open", () => {
    expect(isOriginAllowed("https://anything.com", ["*"])).toBe(true);
  });

  it("a missing Origin (non-browser client) is allowed by default", () => {
    expect(isOriginAllowed(null, allow)).toBe(true);
    expect(isOriginAllowed("", allow)).toBe(true);
  });

  it("a missing Origin can be refused with allowMissingOrigin=false", () => {
    expect(isOriginAllowed(null, allow, false)).toBe(false);
    expect(isOriginAllowed("", allow, false)).toBe(false);
    // an explicitly allowed Origin is still fine
    expect(isOriginAllowed("https://dash.jxh.io", allow, false)).toBe(true);
  });
});

describe("guards do not change stock y-webrtc semantics", () => {
  it("a normal 2-peer room still announces + signals both directions", () => {
    const r = new SignalingRelay();
    r.handleMessage("p1", { type: "subscribe", topics: ["room"] }, 0);
    r.handleMessage("p2", { type: "subscribe", topics: ["room"] }, 0);
    const announce = r.handleMessage(
      "p1",
      { type: "publish", topic: "room", data: { type: "announce" } },
      0,
    );
    expect(recipients(announce)).toEqual(["p1", "p2"]);
    expect(announce[0].message.clients).toBe(2);
    const ping = r.handleMessage("p1", { type: "ping" }, 0);
    expect(ping).toEqual([{ to: "p1", message: { type: "pong" } }]);
  });
});
