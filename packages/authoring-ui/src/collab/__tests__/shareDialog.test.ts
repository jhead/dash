// @vitest-environment jsdom
/**
 * Share dialog + collab controls UX (collab P4).
 *
 * Proves the dialog's link round-trip end-to-end through the real CollabProvider
 * (with a MOCKED y-webrtc provider so no WebRTC/network is touched):
 *
 *   - Solo: the dialog shows the HONEST note and the Start/Join controls.
 *   - "Start collaborating" mints a session and the dialog surfaces a share link
 *     that PARSES BACK to the session's room + key (the P1 link round-trip, now
 *     driven through the dialog) — secrets in the fragment.
 *   - The connection-status control reflects the live session and "Leave" tears
 *     it down (back to solo).
 *
 * Mirrors the other authoring-ui render tests (react-dom/client + act).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { act } from "react";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Mock y-webrtc so the real provider/WebRTC is never constructed.
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

const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { StoreProvider } = await import("../../store/StoreProvider.js");
const { CollabProvider } = await import("../CollabContext.js");
const { ShareDialog } = await import("../ShareDialog.js");
const { CollabControls } = await import("../CollabControls.js");
const { parseCollabLink } = await import("../collabLink.js");
const { createDocument } = await import("@flash/core");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  // jsdom has no clipboard by default; stub it so Copy doesn't throw.
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

function mount(node: React.ReactNode): void {
  act(() => {
    root.render(
      React.createElement(StoreProvider, {
        initialDoc: createDocument(),
        children: React.createElement(CollabProvider, { children: node }),
      }),
    );
  });
}

function q<T extends Element = HTMLElement>(testid: string): T | null {
  return container.querySelector(`[data-testid="${testid}"]`);
}

describe("<ShareDialog> (P4)", () => {
  it("shows the honest note and Start/Join controls when solo", () => {
    mount(React.createElement(ShareDialog, { onClose: () => {} }));
    expect(q("collab-share-dialog")).not.toBeNull();
    expect(q("collab-honest-note")).not.toBeNull();
    // Honest note mentions the three load-bearing facts.
    const note = q("collab-honest-note")!.textContent ?? "";
    expect(note).toMatch(/full edit access/i);
    expect(note).toMatch(/peer-to-peer over WebRTC/i);
    expect(note).toMatch(/end-to-end encrypted/i);
    expect(q("collab-start-btn")).not.toBeNull();
    expect(q("collab-join-input")).not.toBeNull();
  });

  it("Start collaborating surfaces a share link that parses back to the session room+key", () => {
    mount(React.createElement(ShareDialog, { onClose: () => {} }));

    act(() => {
      (q<HTMLButtonElement>("collab-start-btn")!).click();
    });

    // The dialog now shows the live session view with a copyable link.
    const linkInput = q<HTMLInputElement>("collab-share-link");
    expect(linkInput).not.toBeNull();
    const url = linkInput!.value;

    // P1 link round-trip — now driven through the dialog: the URL parses back to
    // a valid room + key, and the secret is in the FRAGMENT (never the path).
    const parsed = parseCollabLink(url);
    expect(parsed).not.toBeNull();
    expect(parsed!.room.length).toBeGreaterThan(0);
    expect(parsed!.key.length).toBeGreaterThan(0);
    expect(url).toContain("#room=");
    expect(url).toContain("&k=");
    const beforeHash = url.slice(0, url.indexOf("#"));
    expect(beforeHash).not.toContain(parsed!.key);

    // Copy button is present (clipboard stubbed).
    expect(q("collab-copy-link")).not.toBeNull();
  });
});

describe("<CollabControls> (P4)", () => {
  it("solo shows a Collaborate button; opening it reveals the share dialog", () => {
    mount(React.createElement(CollabControls, null));
    expect(q("collab-collaborate-btn")).not.toBeNull();
    expect(q("collab-share-dialog")).toBeNull();
    act(() => {
      (q<HTMLButtonElement>("collab-collaborate-btn")!).click();
    });
    expect(q("collab-share-dialog")).not.toBeNull();
  });

  it("a live session shows a status pill + Leave; Leave returns to solo", () => {
    mount(React.createElement(CollabControls, null));
    // Open dialog and start a session.
    act(() => (q<HTMLButtonElement>("collab-collaborate-btn")!).click());
    act(() => (q<HTMLButtonElement>("collab-start-btn")!).click());

    // Status pill + Leave appear; the Collaborate button is gone.
    expect(q("collab-status-pill")).not.toBeNull();
    expect(q("collab-leave-btn")).not.toBeNull();

    act(() => (q<HTMLButtonElement>("collab-leave-btn")!).click());

    // Back to solo.
    expect(q("collab-leave-btn")).toBeNull();
    expect(q("collab-collaborate-btn")).not.toBeNull();
  });
});
