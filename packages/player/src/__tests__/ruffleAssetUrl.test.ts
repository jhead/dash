import { describe, it, expect } from "vitest";
import { resolveRuffleBaseUrl } from "../ruffleAssetUrl.js";

describe("resolveRuffleBaseUrl", () => {
  it("resolves the GitHub Pages sub-path base to /dash/ruffle (the reported 404 fix)", () => {
    // Production Vite base on GitHub Pages. A root-absolute "/ruffle" would
    // 404 at https://jhead.github.io/ruffle/ruffle.js; the base-relative form
    // must land at https://jhead.github.io/dash/ruffle/ruffle.js.
    expect(resolveRuffleBaseUrl("/dash/")).toBe("/dash/ruffle");
  });

  it("resolves the dev / Tauri base (/) to /ruffle", () => {
    expect(resolveRuffleBaseUrl("/")).toBe("/ruffle");
  });

  it("builds the same ruffle.js URL the loader fetches", () => {
    expect(`${resolveRuffleBaseUrl("/dash/")}/ruffle.js`).toBe(
      "/dash/ruffle/ruffle.js"
    );
    expect(`${resolveRuffleBaseUrl("/")}/ruffle.js`).toBe("/ruffle/ruffle.js");
  });

  it("never double-slashes when the base already ends with a slash", () => {
    expect(resolveRuffleBaseUrl("/dash/")).not.toContain("//");
  });

  it("tolerates a base missing its trailing slash", () => {
    expect(resolveRuffleBaseUrl("/dash")).toBe("/dash/ruffle");
  });

  it("falls back to a root-relative /ruffle when the base is empty/undefined", () => {
    expect(resolveRuffleBaseUrl()).toBe("/ruffle");
    expect(resolveRuffleBaseUrl("")).toBe("/ruffle");
  });

  it("supports a nested deployment base", () => {
    expect(resolveRuffleBaseUrl("/team/dash/")).toBe("/team/dash/ruffle");
  });
});
