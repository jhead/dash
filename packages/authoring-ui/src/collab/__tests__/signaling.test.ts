/**
 * Signaling-server config (task 1344 P1): built-in default + user override
 * parsing. The sole built-in default is our own worker (task 1356 dropped the
 * third-party `y-webrtc-eu.fly.dev` fallback for privacy); the list stays
 * user-editable.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIGNALING_SERVERS,
  parseSignalingServers,
} from "../signaling.js";

describe("signaling server config", () => {
  it("falls back to the built-in default for empty/invalid input", () => {
    expect(parseSignalingServers(null)).toEqual([...DEFAULT_SIGNALING_SERVERS]);
    expect(parseSignalingServers("")).toEqual([...DEFAULT_SIGNALING_SERVERS]);
    expect(parseSignalingServers("not-a-url")).toEqual([
      ...DEFAULT_SIGNALING_SERVERS,
    ]);
  });

  it("has a wss:// built-in default (no doc bytes ever flow through it)", () => {
    expect(DEFAULT_SIGNALING_SERVERS.length).toBeGreaterThan(0);
    for (const url of DEFAULT_SIGNALING_SERVERS) {
      expect(url).toMatch(/^wss:\/\//);
    }
  });

  it("ships ONLY our own worker as the default — no third-party fallback (task 1356)", () => {
    // Privacy: a public relay observes room ids (plaintext pub/sub topic) + peer
    // IPs, and a peer connects to ALL listed servers, so a default fallback would
    // leak room metadata even while our worker is up. Users can still add their
    // own via setSignalingServers (the field stays user-editable).
    expect([...DEFAULT_SIGNALING_SERVERS]).toEqual(["wss://signal.dash.jxh.io"]);
    expect(DEFAULT_SIGNALING_SERVERS).not.toContain("wss://y-webrtc-eu.fly.dev");
  });

  it("parses a user-supplied list (comma- or newline-separated)", () => {
    expect(parseSignalingServers("wss://a.example, ws://b.example")).toEqual([
      "wss://a.example",
      "ws://b.example",
    ]);
    expect(parseSignalingServers("wss://a.example\nwss://b.example")).toEqual([
      "wss://a.example",
      "wss://b.example",
    ]);
  });

  it("drops entries that are not ws(s):// URLs", () => {
    expect(parseSignalingServers("wss://ok.example, http://bad, junk")).toEqual([
      "wss://ok.example",
    ]);
  });
});
