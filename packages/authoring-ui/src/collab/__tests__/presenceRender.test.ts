// @vitest-environment jsdom
/**
 * Remote presence RENDER (task 1345 P2): a simulated remote awareness state
 * renders a live cursor (positioned in stage space), a per-user selection
 * outline, and a presence avatar chip. Mirrors the other authoring-ui render
 * tests (react-dom/client + act, no testing-library).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import React, { act } from "react";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from "react-dom/client";
import type { DisplayObject } from "@flash/core";
import { RemoteCursorsOverlay } from "../RemoteCursorsOverlay.js";
import { PresenceAvatars } from "../PresenceAvatars.js";
import type { PeerPresence } from "../awarenessState.js";
import type { CollabUser } from "../localUser.js";

const REMOTE: PeerPresence = {
  clientId: 99,
  user: { id: "r", name: "Bold Fox", color: "#3cb44b" },
  cursor: { x: 120, y: 80 },
  scene: 0,
  frame: 0,
  editContext: { mode: "document" },
  selection: { shapeIds: ["shape-1"], instanceId: null },
  tool: "selection",
};

// A shape the remote peer has selected, so the outline can resolve its bounds.
const SHAPE: DisplayObject = {
  id: "shape-1",
  type: "shape",
  x: 10,
  y: 20,
  width: 50,
  height: 40,
} as unknown as DisplayObject;

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

describe("<RemoteCursorsOverlay>", () => {
  it("renders a co-located peer's cursor at its stage coordinates", () => {
    act(() => {
      root.render(
        React.createElement(RemoteCursorsOverlay, {
          peers: [REMOTE],
          zoom: 1,
          localScene: 0,
          localFrame: 0,
          localEditContext: { mode: "document" },
          activeObjects: [SHAPE],
        }),
      );
    });
    const cursor = container.querySelector<HTMLElement>('[data-testid="collab-remote-cursor"]');
    expect(cursor).not.toBeNull();
    expect(cursor!.style.left).toBe("120px");
    expect(cursor!.style.top).toBe("80px");
    // The name label is shown.
    expect(container.textContent).toContain("Bold Fox");
  });

  it("renders the peer's selection outline in their color", () => {
    act(() => {
      root.render(
        React.createElement(RemoteCursorsOverlay, {
          peers: [REMOTE],
          zoom: 1,
          localScene: 0,
          localFrame: 0,
          localEditContext: { mode: "document" },
          activeObjects: [SHAPE],
        }),
      );
    });
    const sel = container.querySelector<HTMLElement>('[data-testid="collab-remote-selection"]');
    expect(sel).not.toBeNull();
    expect(sel!.style.left).toBe("10px");
    expect(sel!.style.top).toBe("20px");
    expect(sel!.style.width).toBe("50px");
    expect(sel!.style.height).toBe("40px");
    // Color appears in the border (jsdom normalizes hex → rgb).
    expect(sel!.style.border).toContain("rgb(60, 180, 75)");
  });

  it("does NOT render a peer on a different scene (not co-located)", () => {
    act(() => {
      root.render(
        React.createElement(RemoteCursorsOverlay, {
          peers: [{ ...REMOTE, scene: 4 }],
          zoom: 1,
          localScene: 0,
          localFrame: 0,
          localEditContext: { mode: "document" },
          activeObjects: [SHAPE],
        }),
      );
    });
    expect(container.querySelector('[data-testid="collab-remote-cursor"]')).toBeNull();
    expect(container.querySelector('[data-testid="collab-remote-overlay"]')).toBeNull();
  });

  it("renders nothing when there are no peers (solo)", () => {
    act(() => {
      root.render(
        React.createElement(RemoteCursorsOverlay, {
          peers: [],
          zoom: 1,
          localScene: 0,
          localFrame: 0,
          localEditContext: { mode: "document" },
          activeObjects: [],
        }),
      );
    });
    expect(container.innerHTML).toBe("");
  });
});

describe("<PresenceAvatars>", () => {
  const LOCAL: CollabUser = { id: "me", name: "Swift Otter", color: "#e6194b" };

  it("renders self + a peer chip, and calls onFollow on click", () => {
    let followed: PeerPresence | null = null;
    act(() => {
      root.render(
        React.createElement(PresenceAvatars, {
          localUser: LOCAL,
          peers: [REMOTE],
          onFollow: (p: PeerPresence) => {
            followed = p;
          },
        }),
      );
    });
    expect(container.querySelector('[data-testid="collab-presence-self"]')).not.toBeNull();
    const peerChip = container.querySelector<HTMLButtonElement>('[data-testid="collab-presence-peer"]');
    expect(peerChip).not.toBeNull();
    act(() => {
      peerChip!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(followed).not.toBeNull();
    expect(followed!.clientId).toBe(99);
  });

  it("renders nothing with no peers (solo)", () => {
    act(() => {
      root.render(
        React.createElement(PresenceAvatars, { localUser: LOCAL, peers: [] }),
      );
    });
    expect(container.innerHTML).toBe("");
  });
});
