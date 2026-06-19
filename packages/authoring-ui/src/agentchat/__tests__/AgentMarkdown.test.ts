// @vitest-environment jsdom
/**
 * Acceptance tests for task 1290 — assistant chat messages render as Markdown.
 *
 *   1. A markdown string exercising bold, an unordered list, a fenced code
 *      block, a link, and a GFM table renders the EXPECTED DOM elements
 *      (<strong>, <ul>/<li>, <pre>/<code>, <a target=_blank rel=noopener…>,
 *      <table>/<th>/<td>), with strikethrough + task-list (GFM) also wired.
 *   2. SAFETY (no-XSS): raw HTML in the assistant text — `<script>` and `<b>` —
 *      is NOT rendered as live DOM. The default react-markdown pipeline (no
 *      rehype-raw) escapes it, so it appears as TEXT and creates no <script>/<b>
 *      element. This is the property the security audit relied on.
 *   3. Partial/unclosed markdown (an open ``` fence mid-stream) does NOT throw —
 *      streaming half-written messages must never crash the panel.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import React, { act } from "react";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
import { createRoot, type Root } from "react-dom/client";
import { AgentMarkdown } from "../AgentMarkdown";

describe("<AgentMarkdown>", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(md: string) {
    act(() => {
      root.render(React.createElement(AgentMarkdown, { children: md }));
    });
  }

  it("renders bold, list, fenced code, link, and a GFM table", () => {
    const md = [
      "Here is **bold** text.",
      "",
      "- first item",
      "- second item",
      "",
      "```js",
      "const x = 1;",
      "```",
      "",
      "See [the docs](https://example.com/docs).",
      "",
      "| Col A | Col B |",
      "| ----- | ----- |",
      "| a1    | b1    |",
      "| a2    | b2    |",
    ].join("\n");
    render(md);

    // Bold
    const strong = container.querySelector("strong");
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe("bold");

    // Unordered list with two items
    const list = container.querySelector("ul");
    expect(list).not.toBeNull();
    expect(container.querySelectorAll("ul li").length).toBe(2);

    // Fenced code block: a <pre> wrapping a <code> with the source text
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    const blockCode = pre?.querySelector("code");
    expect(blockCode).not.toBeNull();
    expect(pre?.textContent).toContain("const x = 1;");

    // Link: opens in a new tab, no opener/referrer leak
    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("https://example.com/docs");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toContain("noopener");
    expect(link?.getAttribute("rel")).toContain("noreferrer");

    // GFM table
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    expect(container.querySelectorAll("th").length).toBe(2);
    // 2 body rows × 2 cells
    expect(container.querySelectorAll("td").length).toBe(4);
  });

  it("renders GFM strikethrough and task-list items", () => {
    render(
      ["~~gone~~", "", "- [x] done", "- [ ] todo"].join("\n")
    );
    expect(container.querySelector("del")?.textContent).toBe("gone");
    const checkboxes = container.querySelectorAll(
      'input[type="checkbox"]'
    );
    expect(checkboxes.length).toBe(2);
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(true);
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(false);
  });

  it("renders inline code as <code> without a <pre>", () => {
    render("Use the `foo()` helper.");
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code?.textContent).toBe("foo()");
    // Inline code must not be wrapped in a block <pre>.
    expect(code?.closest("pre")).toBeNull();
  });

  it("does NOT render raw HTML in assistant text (no-XSS)", () => {
    // A literal <script> and <b> in the markdown source. With the default
    // react-markdown pipeline (no rehype-raw) these are escaped to TEXT and must
    // NOT become live <script>/<b> elements.
    render(
      'Before <script>window.__xss = 1;</script> and <b>not bold</b> after.'
    );

    // No live HTML elements were created from the raw tags.
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();

    // The literal angle-bracket text survives as escaped text content.
    const text = container.textContent ?? "";
    expect(text).toContain("<script>");
    expect(text).toContain("window.__xss = 1;");
    expect(text).toContain("<b>not bold</b>");

    // And the side effect never ran.
    expect(
      (window as unknown as Record<string, unknown>).__xss
    ).toBeUndefined();
  });

  it("does not crash on partial/unclosed markdown (streaming)", () => {
    // An open code fence with no closing ``` — exactly what an in-flight stream
    // looks like mid-message. Must render (as a code block) without throwing.
    expect(() => {
      render(["Working on it:", "", "```ts", "const partial = "].join("\n"));
    }).not.toThrow();
    // An unbalanced bold marker is just text, not an error.
    expect(() => {
      render("here is **half a bold and a `half code");
    }).not.toThrow();
    expect(container.textContent ?? "").toContain("half a bold");
  });

  // --- Memoization (task 1293 perf) ---------------------------------------

  it("is wrapped in React.memo", () => {
    // React.memo produces an exotic component object tagged with the memo symbol.
    const memoSymbol = Symbol.for("react.memo");
    expect((AgentMarkdown as unknown as { $$typeof?: symbol }).$$typeof).toBe(
      memoSymbol
    );
  });

  it("does NOT re-render the markdown subtree when children are unchanged", () => {
    // Render once, capture the rendered <p> DOM node, then re-render with the
    // SAME children string. React.memo bails out of the re-render, so the inner
    // DOM (and the parsed output) is reused — the node identity is preserved.
    render("hello **world**");
    const firstP = container.querySelector("p");
    expect(firstP).not.toBeNull();

    render("hello **world**");
    const secondP = container.querySelector("p");
    expect(secondP).toBe(firstP); // same node => memo skipped the re-parse
    expect(secondP?.textContent).toBe("hello world");
  });

  it("DOES re-render when the children string changes (memo doesn't break updates)", () => {
    render("first message");
    expect(container.textContent ?? "").toContain("first message");
    render("second message");
    const text = container.textContent ?? "";
    expect(text).toContain("second message");
    expect(text).not.toContain("first message");
  });
});
