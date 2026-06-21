// @vitest-environment jsdom
/**
 * Address-bar reflection of the collab session (task 1354).
 *
 * Two layers:
 *   1. PURE helper (writeCollabFragment / clearCollabFragment) against a MOCK
 *      window — proves it uses replaceState (never pushState), keeps the secret in
 *      the fragment, preserves origin+path+query, and only clears OUR fragment.
 *   2. INTEGRATION through the real CollabProvider (y-webrtc mocked) — proves that
 *      "Start collaborating" sets `window.location.hash` to the session's share
 *      link and "Leave" clears it, using jsdom's real history/location.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { act } from "react";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Mock y-webrtc so the real provider/WebRTC is never constructed (mirrors shareDialog.test).
vi.mock("y-webrtc", () => {
  class WebrtcProvider {
    awareness: Awareness;
    room = { webrtcConns: new Map() };
    private listeners = new Map<string, Array<(e: unknown) => void>>();
    constructor(
      public roomName: string,
      public doc: Y.Doc,
      public opts: { signaling?: string[]; password?: string } = {},
    ) {
      this.awareness = new Awareness(doc);
    }
    on(event: string, cb: (e: unknown) => void): void {
      const arr = this.listeners.get(event) ?? [];
      arr.push(cb);
      this.listeners.set(event, arr);
    }
    off(event: string, cb: (e: unknown) => void): void {
      const arr = this.listeners.get(event) ?? [];
      this.listeners.set(event, arr.filter((f) => f !== cb));
    }
    destroy(): void {
      this.awareness.destroy();
    }
  }
  return { WebrtcProvider };
});

const {
  writeCollabFragment,
  clearCollabFragment,
} = await import("../collabUrl.js");
const { collabLinkToFragment, parseCollabLink } = await import("../collabLink.js");
type CollabLink = import("../collabLink.js").CollabLink;
type UrlWindowLike = import("../collabUrl.js").UrlWindowLike;

const LINK: CollabLink = { room: "abc123", key: "secret-key-xyz" };

/** A spyable mock window exposing only location.href + history.replaceState. */
function mockWindow(href: string): {
  win: UrlWindowLike;
  replaceState: ReturnType<typeof vi.fn>;
  current: () => string;
} {
  let url = href;
  const replaceState = vi.fn((_data: unknown, _t: string, next?: string | null) => {
    if (typeof next === "string") url = next;
  });
  const win: UrlWindowLike = {
    get location() {
      return { href: url };
    },
    history: { state: { foo: 1 }, replaceState },
  };
  return { win, replaceState, current: () => url };
}

describe("collabUrl helper (pure, mock window)", () => {
  it("writeCollabFragment sets the fragment via replaceState, preserving origin+path+query", () => {
    const { win, replaceState, current } = mockWindow(
      "https://app.example/editor?proj=42",
    );
    const ok = writeCollabFragment(LINK, win);
    expect(ok).toBe(true);
    expect(replaceState).toHaveBeenCalledTimes(1);
    // history.state is preserved (3rd-arg is the URL).
    expect(replaceState.mock.calls[0][0]).toEqual({ foo: 1 });
    // The new URL keeps origin+path+query and appends exactly the share fragment.
    expect(current()).toBe(
      "https://app.example/editor?proj=42" + collabLinkToFragment(LINK),
    );
    // The secret is in the FRAGMENT, never before the '#'.
    const before = current().slice(0, current().indexOf("#"));
    expect(before).not.toContain(LINK.key);
    expect(parseCollabLink(current())).toEqual(LINK);
  });

  it("writeCollabFragment REPLACES any pre-existing fragment (never stacks)", () => {
    const { win, current } = mockWindow("https://app.example/#room=old&k=stale");
    writeCollabFragment(LINK, win);
    expect(current()).toBe("https://app.example/" + collabLinkToFragment(LINK));
    expect(current().indexOf("#")).toBe(current().lastIndexOf("#")); // single '#'
  });

  it("clearCollabFragment removes OUR collab fragment", () => {
    const { win, replaceState, current } = mockWindow(
      "https://app.example/editor#room=abc123&k=secret-key-xyz",
    );
    const ok = clearCollabFragment(win);
    expect(ok).toBe(true);
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(current()).toBe("https://app.example/editor");
    expect(current()).not.toContain("#");
  });

  it("clearCollabFragment LEAVES a non-collab fragment untouched", () => {
    const { win, replaceState, current } = mockWindow(
      "https://app.example/editor#some-router-hash",
    );
    const ok = clearCollabFragment(win);
    expect(ok).toBe(false);
    expect(replaceState).not.toHaveBeenCalled();
    expect(current()).toBe("https://app.example/editor#some-router-hash");
  });

  it("clearCollabFragment is a no-op when there is no fragment at all", () => {
    const { win, replaceState } = mockWindow("https://app.example/editor");
    expect(clearCollabFragment(win)).toBe(false);
    expect(replaceState).not.toHaveBeenCalled();
  });
});

describe("collab address-bar reflection through CollabProvider (jsdom)", () => {
  let container: HTMLDivElement;
  let root: import("react-dom/client").Root;
  let createRoot: typeof import("react-dom/client").createRoot;
  let StoreProvider: typeof import("../../store/StoreProvider.js").StoreProvider;
  let CollabProvider: typeof import("../CollabContext.js").CollabProvider;
  let CollabControls: typeof import("../CollabControls.js").CollabControls;
  let createDocument: typeof import("@flash/core").createDocument;

  beforeEach(async () => {
    ({ createRoot } = await import("react-dom/client"));
    ({ StoreProvider } = await import("../../store/StoreProvider.js"));
    ({ CollabProvider } = await import("../CollabContext.js"));
    ({ CollabControls } = await import("../CollabControls.js"));
    ({ createDocument } = await import("@flash/core"));

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    // Reset jsdom URL to a clean editor URL before each case. Use the jsdom
    // origin (replaceState refuses cross-origin URLs) with a stable path+query.
    window.history.replaceState(null, "", "/editor?proj=42");
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  function q<T extends Element = HTMLElement>(testid: string): T | null {
    return container.querySelector(`[data-testid="${testid}"]`);
  }

  it("Start sets window.location to the share link; Leave clears it", () => {
    act(() => {
      root.render(
        React.createElement(StoreProvider, {
          initialDoc: createDocument(),
          children: React.createElement(CollabProvider, {
            children: React.createElement(CollabControls, null),
          }),
        }),
      );
    });

    // No collab fragment before starting.
    expect(window.location.hash).toBe("");

    // Open the Share dialog and Start collaborating.
    act(() => (q<HTMLButtonElement>("collab-collaborate-btn")!).click());
    act(() => (q<HTMLButtonElement>("collab-start-btn")!).click());

    // The address bar now carries the room link, and it parses back to a link.
    const hash = window.location.hash;
    expect(hash).toContain("#room=");
    expect(hash).toContain("&k=");
    const parsed = parseCollabLink(window.location.href);
    expect(parsed).not.toBeNull();
    expect(parsed!.room.length).toBeGreaterThan(0);
    expect(parsed!.key.length).toBeGreaterThan(0);
    // Origin+path are preserved; the secret is only in the fragment.
    expect(window.location.pathname).toBe("/editor");
    expect(window.location.href.split("#")[0]).not.toContain(parsed!.key);

    // Leaving the session clears the fragment from the address bar.
    act(() => (q<HTMLButtonElement>("collab-leave-btn")!).click());
    expect(window.location.hash).toBe("");
    expect(parseCollabLink(window.location.href)).toBeNull();
  });
});
