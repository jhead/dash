/**
 * Signaling-server config (task 1344 P1): public default + user override parsing.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIGNALING_SERVERS,
  parseSignalingServers,
} from "../signaling.js";

describe("signaling server config", () => {
  it("falls back to the public default for empty/invalid input", () => {
    expect(parseSignalingServers(null)).toEqual([...DEFAULT_SIGNALING_SERVERS]);
    expect(parseSignalingServers("")).toEqual([...DEFAULT_SIGNALING_SERVERS]);
    expect(parseSignalingServers("not-a-url")).toEqual([
      ...DEFAULT_SIGNALING_SERVERS,
    ]);
  });

  it("has a wss:// public default (no doc bytes ever flow through it)", () => {
    expect(DEFAULT_SIGNALING_SERVERS.length).toBeGreaterThan(0);
    for (const url of DEFAULT_SIGNALING_SERVERS) {
      expect(url).toMatch(/^wss:\/\//);
    }
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
