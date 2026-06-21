/**
 * Link parse/generate round-trip + opt-in safety (task 1344 P1).
 *
 * The link is the capability: `#room=<id>&k=<key>`. These tests prove
 *   - generate → fragment → parse round-trips exactly,
 *   - the secret is in the FRAGMENT (after `#`),
 *   - a normal (non-collab) URL parses to null (so opening one never auto-joins),
 *   - generated tokens are random + URL-safe.
 */
import { describe, expect, it } from "vitest";
import {
  buildShareUrl,
  collabLinkToFragment,
  generateCollabLink,
  parseCollabLink,
} from "../collabLink.js";

describe("collab link generate/parse round-trip", () => {
  it("round-trips a generated link through the fragment", () => {
    const link = generateCollabLink();
    const fragment = collabLinkToFragment(link);
    const parsed = parseCollabLink(fragment);
    expect(parsed).toEqual(link);
  });

  it("round-trips through a full share URL", () => {
    const link = generateCollabLink();
    const url = buildShareUrl("https://editor.example/app/", link);
    const parsed = parseCollabLink(url);
    expect(parsed).toEqual(link);
  });

  it("puts both secrets in the URL FRAGMENT, never the path/query", () => {
    const link = { room: "ROOM123", key: "SECRETKEY" };
    const url = buildShareUrl("https://editor.example/app/?foo=bar", link);
    const [base, fragment] = url.split("#");
    // The base (path + query) carries neither the room nor the key.
    expect(base).not.toContain("ROOM123");
    expect(base).not.toContain("SECRETKEY");
    // The fragment carries both.
    expect(fragment).toContain("room=ROOM123");
    expect(fragment).toContain("k=SECRETKEY");
  });

  it("accepts a bare fragment, with or without the leading #", () => {
    expect(parseCollabLink("#room=a&k=b")).toEqual({ room: "a", key: "b" });
    expect(parseCollabLink("room=a&k=b")).toEqual({ room: "a", key: "b" });
  });

  it("returns null for a normal URL with no collab fragment (no auto-join)", () => {
    expect(parseCollabLink("https://editor.example/app/")).toBeNull();
    expect(parseCollabLink("https://editor.example/app/#section")).toBeNull();
    expect(parseCollabLink("#room=onlyroom")).toBeNull(); // missing k
    expect(parseCollabLink("#k=onlykey")).toBeNull(); // missing room
    expect(parseCollabLink("")).toBeNull();
  });

  it("strips an existing fragment from the base before appending", () => {
    const link = { room: "r", key: "k" };
    const url = buildShareUrl("https://app/#stale=1", link);
    expect(url).toBe("https://app/#room=r&k=k");
  });

  it("generates unique, URL-safe, high-entropy tokens", () => {
    const a = generateCollabLink();
    const b = generateCollabLink();
    expect(a.room).not.toEqual(b.room);
    expect(a.key).not.toEqual(b.key);
    // base64url: only A-Z a-z 0-9 - _
    expect(a.room).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.key).toMatch(/^[A-Za-z0-9_-]+$/);
    // 16 / 32 random bytes → comfortably long tokens.
    expect(a.room.length).toBeGreaterThanOrEqual(20);
    expect(a.key.length).toBeGreaterThanOrEqual(40);
  });

  it("round-trips a link with characters needing URI encoding", () => {
    const link = { room: "a b&c", key: "x=y z" };
    const parsed = parseCollabLink(collabLinkToFragment(link));
    expect(parsed).toEqual(link);
  });
});
