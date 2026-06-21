// @vitest-environment jsdom
/**
 * Consent-gated auto-join (task 1357).
 *
 * Two layers:
 *   1. PURE detection (detectIncomingCollabLink) against a MOCK window — proves a
 *      navigated `#room=…&k=…` link is recognized as an invitation, but is ignored
 *      when there's a live session (our own fragment), when collab is disabled, or
 *      when the fragment is absent / not a collab link.
 *   2. INTEGRATION through the real CollabProvider + CollabControls (y-webrtc
 *      mocked) — proves that landing on a `#room` link does NOT join until consent:
 *      the prompt appears, Confirm joins (provider constructed, address bar stays
 *      the room link), Decline does NOT construct a provider and leaves the local
 *      document intact (and clears the fragment).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { act } from "react";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Count how many times the provider is constructed so we can prove that Decline
// (and the no-consent default) NEVER builds one.
let webrtcConstructions = 0;

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
      webrtcConstructions += 1;
      this.awareness = new Awareness(doc);
    }
    on(event: string, cb: (e: unknown) => void): void {
      const arr = this.listeners.get(event) ?? [];
      arr.push(cb);
      this.listeners.set(event, arr);
      // joinCollab awaits a "synced" event (or an 8 s timeout) before resolving;
      // fire it on the next microtask so a join in tests resolves promptly.
      if (event === "synced") {
        queueMicrotask(() => cb({ synced: true }));
      }
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

const { detectIncomingCollabLink } = await import("../collabAutoJoin.js");
const { collabLinkToFragment } = await import("../collabLink.js");
type AutoJoinWindowLike = import("../collabAutoJoin.js").AutoJoinWindowLike;
type CollabLink = import("../collabLink.js").CollabLink;

const LINK: CollabLink = { room: "abc123", key: "secret-key-xyz" };

function mockWin(href: string): AutoJoinWindowLike {
  return { location: { href } };
}

describe("detectIncomingCollabLink (pure)", () => {
  it("returns the parsed link for a navigated #room=…&k=… URL (no session, collab on)", () => {
    const win = mockWin("https://app.example/editor" + collabLinkToFragment(LINK));
    expect(
      detectIncomingCollabLink({ win, sessionLive: false, collabEnabled: true }),
    ).toEqual(LINK);
  });

  it("returns null when a session is already live (the fragment is ours)", () => {
    const win = mockWin("https://app.example/editor" + collabLinkToFragment(LINK));
    expect(
      detectIncomingCollabLink({ win, sessionLive: true, collabEnabled: true }),
    ).toBeNull();
  });

  it("returns null when collab is disabled by the flag", () => {
    const win = mockWin("https://app.example/editor" + collabLinkToFragment(LINK));
    expect(
      detectIncomingCollabLink({ win, sessionLive: false, collabEnabled: false }),
    ).toBeNull();
  });

  it("returns null for a non-collab fragment / no fragment", () => {
    expect(
      detectIncomingCollabLink({
        win: mockWin("https://app.example/editor#some-router-hash"),
        sessionLive: false,
        collabEnabled: true,
      }),
    ).toBeNull();
    expect(
      detectIncomingCollabLink({
        win: mockWin("https://app.example/editor?proj=42"),
        sessionLive: false,
        collabEnabled: true,
      }),
    ).toBeNull();
  });
});

describe("consent-gated join through CollabProvider + CollabControls (jsdom)", () => {
  let container: HTMLDivElement;
  let root: import("react-dom/client").Root;
  let createRoot: typeof import("react-dom/client").createRoot;
  let StoreProvider: typeof import("../../store/StoreProvider.js").StoreProvider;
  let CollabProvider: typeof import("../CollabContext.js").CollabProvider;
  let CollabControls: typeof import("../CollabControls.js").CollabControls;
  let useStores: typeof import("../../store/StoreProvider.js").useStores;
  let createDocument: typeof import("@flash/core").createDocument;

  beforeEach(async () => {
    webrtcConstructions = 0;
    ({ createRoot } = await import("react-dom/client"));
    ({ StoreProvider, useStores } = await import("../../store/StoreProvider.js"));
    ({ CollabProvider } = await import("../CollabContext.js"));
    ({ CollabControls } = await import("../CollabControls.js"));
    ({ createDocument } = await import("@flash/core"));

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    // Reset the URL for the next case.
    window.history.replaceState(null, "", "/editor?proj=42");
    vi.restoreAllMocks();
  });

  function q<T extends Element = HTMLElement>(testid: string): T | null {
    return container.querySelector(`[data-testid="${testid}"]`);
  }

  // A probe that captures the live document reference so we can prove Decline
  // leaves it untouched (no remote doc merged over it).
  let capturedDoc: unknown = null;
  function DocProbe(): null {
    const { documentStore } = useStores();
    capturedDoc = documentStore.getState().history.present;
    return null;
  }

  function mountAt(href: string): void {
    // Land on the incoming link BEFORE mounting (mount-time detection reads it).
    window.history.replaceState(null, "", href);
    capturedDoc = null;
    act(() => {
      root.render(
        React.createElement(StoreProvider, {
          initialDoc: createDocument(),
          children: React.createElement(CollabProvider, {
            children: [
              React.createElement(DocProbe, { key: "probe" }),
              React.createElement(CollabControls, { key: "controls" }),
            ],
          }),
        }),
      );
    });
  }

  it("an incoming #room link shows the consent prompt and does NOT auto-join", () => {
    mountAt("/editor?proj=42" + collabLinkToFragment(LINK));

    // Consent prompt is up; no provider was constructed; still solo.
    expect(q("collab-join-prompt")).not.toBeNull();
    expect(webrtcConstructions).toBe(0);
    expect(q("collab-status-pill")).toBeNull();
    expect(q("collab-collaborate-btn")).not.toBeNull();
  });

  it("Confirm joins: constructs the provider and keeps the room link in the address bar", async () => {
    mountAt("/editor?proj=42" + collabLinkToFragment(LINK));
    const docBefore = capturedDoc;

    // join() is async (joinCollab adopts on sync); flush the microtask queue so
    // the setSession state update lands before we assert.
    await act(async () => {
      (q<HTMLButtonElement>("collab-join-prompt-confirm")!).click();
      // Let joinCollab's awaits (waitForSync → the mock's microtask "synced",
      // asset sync) settle, then the setSession state update.
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    });

    // Exactly one provider constructed; the session is now live (status pill).
    expect(webrtcConstructions).toBe(1);
    expect(q("collab-join-prompt")).toBeNull();
    expect(q("collab-status-pill")).not.toBeNull();
    // The address bar still carries a collab room link (join re-writes it).
    expect(window.location.hash).toContain("#room=");
    expect(window.location.hash).toContain("&k=");
    // The probe re-rendered with whatever the join produced; capturedDoc is set.
    expect(capturedDoc).not.toBeNull();
    void docBefore;
  });

  it("Decline does NOT construct a provider, clears the fragment, and leaves the local doc intact", () => {
    mountAt("/editor?proj=42" + collabLinkToFragment(LINK));
    const docBefore = capturedDoc;
    expect(docBefore).not.toBeNull();

    act(() => (q<HTMLButtonElement>("collab-join-prompt-decline")!).click());

    // No provider, prompt gone, still solo.
    expect(webrtcConstructions).toBe(0);
    expect(q("collab-join-prompt")).toBeNull();
    expect(q("collab-collaborate-btn")).not.toBeNull();
    // Fragment cleared so a reload won't re-prompt.
    expect(window.location.hash).toBe("");
    // Local document is the SAME reference — nothing merged over it.
    expect(capturedDoc).toBe(docBefore);
  });
});
