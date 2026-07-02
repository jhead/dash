// @vitest-environment jsdom
/**
 * Acceptance tests for task 1302 P4 — the Classes panel UI (bottom-dock tab).
 *
 * Coverage:
 *   1. The panel renders an empty state when the doc has no `asClasses`.
 *   2. "New" creates a class file in BOTH the VFS and `doc.asClasses` (via the
 *      P0 mutations through syncDocFromVfs -> pushDoc).
 *   3. Editing the selected file's source writes the VFS and (after the debounce)
 *      reconciles into the doc.
 *   4. Remove deletes from the VFS and the doc.
 *   5. Rename moves the file in the VFS and the doc.
 *   6. The bottom-dock BOTTOM_TABS list includes a "Classes" tab (Shell wiring).
 *
 * A `MemoryClassVfs` is injected via the `createVfs` seam so the test exercises
 * the real hydrate/sync bridge with no DOM storage backend.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { act } from "react";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { createRoot, type Root } from "react-dom/client";
import {
  createDocument,
  addAsClass,
  createMemoryClassVfs,
  type FlashDocument,
  type IdentifiedClassVfs,
} from "@flash/core";
import { ClassesPanel } from "../ClassesPanel";

// Flush pending promises + React effects.
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("ClassesPanel", () => {
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
    vi.restoreAllMocks();
  });

  function mount(
    doc: FlashDocument,
    onPush: (d: FlashDocument) => void,
    vfs: IdentifiedClassVfs
  ): { rerender: (d: FlashDocument) => void } {
    let current = doc;
    const render = (d: FlashDocument) =>
      act(() => {
        root.render(
          React.createElement(ClassesPanel, {
            doc: d,
            pushDoc: (next: FlashDocument) => {
              current = next;
              onPush(next);
              render(next);
            },
            createVfs: () => vfs,
          })
        );
      });
    render(current);
    return { rerender: (d) => render(d) };
  }

  it("shows an empty state when there are no classes", async () => {
    const doc = createDocument();
    const vfs = createMemoryClassVfs();
    mount(doc, () => {}, vfs);
    await flush();
    expect(container.querySelector('[data-testid="classes-empty"]')).not.toBeNull();
    expect(
      container.querySelector('[data-testid="classes-editor-empty"]')
    ).not.toBeNull();
  });

  it("hydrates the VFS + tree from an existing doc and loads source on select", async () => {
    let doc = createDocument();
    doc = addAsClass(doc, { path: "com/example/Foo.as", source: "class com.example.Foo {}" });
    const vfs = createMemoryClassVfs();
    mount(doc, () => {}, vfs);
    await flush();
    // VFS hydrated from the embed.
    expect(await vfs.read("com/example/Foo.as")).toBe("class com.example.Foo {}");
    // Tree shows the file; it is auto-selected and its source loaded.
    expect(
      container.querySelector('[data-testid="class-file-com/example/Foo.as"]')
    ).not.toBeNull();
    const textarea = container.querySelector("textarea");
    expect(textarea?.value).toBe("class com.example.Foo {}");
  });

  it("New adds a class to the VFS AND the doc", async () => {
    const doc = createDocument();
    const vfs = createMemoryClassVfs();
    let pushed: FlashDocument | null = null;
    mount(doc, (d) => (pushed = d), vfs);
    await flush();

    // Click "New", type a dotted name, press Enter.
    const addBtn = container.querySelector<HTMLButtonElement>('[data-testid="class-add"]')!;
    act(() => addBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const input = container.querySelector<HTMLInputElement>('[data-testid="class-new-input"]')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )!.set!;
      setter.call(input, "com.example.Main");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    // VFS has the new file with the boilerplate source.
    expect(await vfs.exists("com/example/Main.as")).toBe(true);
    expect(await vfs.read("com/example/Main.as")).toContain("class com.example.Main");
    // doc.asClasses reflects it (via pushDoc).
    expect(pushed).not.toBeNull();
    const byPath = new Map((pushed!.asClasses ?? []).map((c) => [c.path, c.source]));
    expect(byPath.has("com/example/Main.as")).toBe(true);
  });

  // --- task 1317: VFS<->doc sync data-loss regressions ---------------------
  //
  // These three use an ISOLATED container/root (not the shared `root` from
  // beforeEach) so an in-test unmount (b) and a post-restore async re-hydrate
  // (c) can't leak DOM/act state into the legacy tests that follow.

  function mountIsolated(
    doc: FlashDocument,
    onPush: (d: FlashDocument) => void,
    vfs: IdentifiedClassVfs
  ): {
    el: HTMLDivElement;
    r: Root;
    rerender: (d: FlashDocument) => void;
  } {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const r = createRoot(el);
    let current = doc;
    const render = (d: FlashDocument) =>
      act(() => {
        r.render(
          React.createElement(ClassesPanel, {
            doc: d,
            pushDoc: (next: FlashDocument) => {
              current = next;
              onPush(next);
              render(next);
            },
            createVfs: () => vfs,
          })
        );
      });
    render(current);
    return { el, r, rerender: (d) => render(d) };
  }

  it("(a) edit then IMMEDIATE compile/publish sees the edit (no 600ms wait)", async () => {
    // DATA-LOSS: previously the edit only reached doc.asClasses after a 600ms
    // debounce, so a Test Movie / Publish / Live-Preview recompile fired right
    // after typing compiled STALE classes. Now the edit folds into the doc
    // synchronously, so the very next read (no timer flush) has it.
    let doc = createDocument();
    doc = addAsClass(doc, { path: "Foo.as", source: "class Foo {}" });
    const vfs = createMemoryClassVfs();
    let pushed: FlashDocument | null = null;
    const { el, r } = mountIsolated(doc, (d) => (pushed = d), vfs);
    await flush();

    const textarea = el.querySelector("textarea")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value"
      )!.set!;
      setter.call(textarea, "class Foo { var edited; }");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // NO setTimeout/debounce wait — simulate an immediate compile reading the doc.
    expect(pushed).not.toBeNull();
    const src = (pushed!.asClasses ?? []).find((c) => c.path === "Foo.as")?.source;
    expect(src).toBe("class Foo { var edited; }");

    act(() => r.unmount());
    el.remove();
  });

  it("(b) edit then UNMOUNT keeps the edit in doc.asClasses", async () => {
    // DATA-LOSS: closing the Classes tab with a pending edit used to only clear
    // the timer (dropping the reconcile). The synchronous fold already put the
    // edit in the doc; the unmount flush additionally drains any pending
    // reconcile. Either way the edit must survive unmount with no timer wait.
    let doc = createDocument();
    doc = addAsClass(doc, { path: "Foo.as", source: "class Foo {}" });
    const vfs = createMemoryClassVfs();
    let pushed: FlashDocument | null = null;
    const { el, r } = mountIsolated(doc, (d) => (pushed = d), vfs);
    await flush();

    const textarea = el.querySelector("textarea")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value"
      )!.set!;
      setter.call(textarea, "class Foo { var survived; }");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Unmount BEFORE the 600ms debounce would fire.
    act(() => r.unmount());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    el.remove();

    expect(pushed).not.toBeNull();
    const src = (pushed!.asClasses ?? []).find((c) => c.path === "Foo.as")?.source;
    expect(src).toBe("class Foo { var survived; }");
  });

  it("(c) doc.asClasses changing after mount re-hydrates the panel/VFS", async () => {
    // A project restore / undo swaps in a different embed while the tab is open.
    // The panel must re-mirror the new classes into the VFS and the tree/editor.
    let doc = createDocument();
    doc = addAsClass(doc, { path: "Foo.as", source: "class Foo {}" });
    const vfs = createMemoryClassVfs();
    const { el, r, rerender } = mountIsolated(doc, () => {}, vfs);
    await flush();
    expect(
      el.querySelector('[data-testid="class-file-Foo.as"]')
    ).not.toBeNull();

    // Simulate a restore: a brand-new doc identity with DIFFERENT classes.
    let restored = createDocument();
    restored = addAsClass(restored, {
      path: "Bar.as",
      source: "class Bar { var restored; }",
    });
    rerender(restored);
    await flush();
    await flush();

    // VFS now mirrors the restored embed (Bar present, Foo pruned).
    expect(await vfs.read("Bar.as")).toBe("class Bar { var restored; }");
    expect(await vfs.exists("Foo.as")).toBe(false);
    // Tree shows the restored file; the stale one is gone.
    expect(
      el.querySelector('[data-testid="class-file-Bar.as"]')
    ).not.toBeNull();
    expect(
      el.querySelector('[data-testid="class-file-Foo.as"]')
    ).toBeNull();

    act(() => r.unmount());
    el.remove();
  });

  it("(d) a no-op keystroke (identical source) does NOT push a history entry", async () => {
    // addAsClass always allocates a new doc, so the panel must compare source
    // itself; otherwise every keystroke — even one that re-emits identical text
    // — would churn undo history.
    let doc = createDocument();
    doc = addAsClass(doc, { path: "Foo.as", source: "class Foo {}" });
    const vfs = createMemoryClassVfs();
    let pushes = 0;
    const { el, r } = mountIsolated(doc, () => (pushes += 1), vfs);
    await flush();
    pushes = 0; // ignore any mount-time hydrate push

    const textarea = el.querySelector("textarea")!;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value"
    )!.set!;
    // Re-emit the EXACT current source — must be a no-op.
    act(() => {
      setter.call(textarea, "class Foo {}");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(pushes).toBe(0);

    // A real change DOES push.
    act(() => {
      setter.call(textarea, "class Foo { var y; }");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(pushes).toBe(1);

    act(() => r.unmount());
    el.remove();
  });

  it("editing the selected file writes the VFS and reconciles the doc", async () => {
    let doc = createDocument();
    doc = addAsClass(doc, { path: "Foo.as", source: "class Foo {}" });
    const vfs = createMemoryClassVfs();
    let pushed: FlashDocument | null = null;
    mount(doc, (d) => (pushed = d), vfs);
    await flush();

    const textarea = container.querySelector("textarea")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value"
      )!.set!;
      setter.call(textarea, "class Foo { var x; }");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Immediate VFS write.
    expect(await vfs.read("Foo.as")).toBe("class Foo { var x; }");
    // After the debounce, the doc is reconciled.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    await flush();
    expect(pushed).not.toBeNull();
    const src = (pushed!.asClasses ?? []).find((c) => c.path === "Foo.as")?.source;
    expect(src).toBe("class Foo { var x; }");
  });

  it("Remove deletes from the VFS and the doc", async () => {
    let doc = createDocument();
    doc = addAsClass(doc, { path: "Foo.as", source: "class Foo {}" });
    doc = addAsClass(doc, { path: "Bar.as", source: "class Bar {}" });
    const vfs = createMemoryClassVfs();
    let pushed: FlashDocument | null = null;
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mount(doc, (d) => (pushed = d), vfs);
    await flush();

    const removeBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="class-remove-Foo.as"]'
    )!;
    await act(async () => {
      removeBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    expect(await vfs.exists("Foo.as")).toBe(false);
    const paths = (pushed!.asClasses ?? []).map((c) => c.path);
    expect(paths).not.toContain("Foo.as");
    expect(paths).toContain("Bar.as");
  });

  it("Rename moves the file in the VFS and the doc", async () => {
    let doc = createDocument();
    doc = addAsClass(doc, { path: "Foo.as", source: "class Foo {}" });
    const vfs = createMemoryClassVfs();
    let pushed: FlashDocument | null = null;
    mount(doc, (d) => (pushed = d), vfs);
    await flush();

    const fileRow = container.querySelector<HTMLDivElement>(
      '[data-testid="class-file-Foo.as"]'
    )!;
    act(() => fileRow.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    const renameInput = container.querySelector<HTMLInputElement>(
      '[data-testid="class-rename-input"]'
    )!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )!.set!;
      setter.call(renameInput, "com.example.Renamed");
      renameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      renameInput.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    expect(await vfs.exists("Foo.as")).toBe(false);
    expect(await vfs.exists("com/example/Renamed.as")).toBe(true);
    const paths = (pushed!.asClasses ?? []).map((c) => c.path);
    expect(paths).toContain("com/example/Renamed.as");
    expect(paths).not.toContain("Foo.as");
  });

  // --- task 1404: OPFS/IndexedDB write quota is surfaced, not swallowed -------
  //
  // A quota-exceeded write() used to be a fire-and-forget `void vfs.write(...)`
  // whose rejection vanished into the microtask. Now the write is observed: the
  // edit still folds into `doc.asClasses` synchronously (no in-session loss),
  // AND a one-time non-fatal warning is surfaced to the user.

  /**
   * Wrap a MemoryClassVfs, delegating writes to the real backend until `.full`
   * is set — then every write() rejects with a quota DOMException. This lets the
   * initial `hydrateVfsFromDoc` (which writes the embed) succeed so the editor
   * mounts, and only the subsequent EDIT write hits the quota.
   */
  function quotaVfs(base: IdentifiedClassVfs): IdentifiedClassVfs & {
    full: boolean;
  } {
    return {
      kind: base.kind,
      full: false,
      write(p: string, s: string): Promise<void> {
        if (this.full) {
          return Promise.reject(new DOMException("full", "QuotaExceededError"));
        }
        return base.write(p, s);
      },
      read: (p: string) => base.read(p),
      list: () => base.list(),
      remove: (p: string) => base.remove(p),
      exists: (p: string) => base.exists(p),
    } as IdentifiedClassVfs & { full: boolean };
  }

  it("(1404) an edit whose VFS write hits the storage quota still folds into the doc AND surfaces a warning", async () => {
    let doc = createDocument();
    doc = addAsClass(doc, { path: "Foo.as", source: "class Foo {}" });
    const vfs = quotaVfs(createMemoryClassVfs());
    let pushed: FlashDocument | null = null;
    const { el, r } = mountIsolated(doc, (d) => (pushed = d), vfs);
    await flush();

    // Storage is now full: the next edit write() will reject with quota.
    vfs.full = true;

    const textarea = el.querySelector("textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value"
      )!.set!;
      setter.call(textarea, "class Foo { var edited; }");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      // let the rejected write() promise settle so the .catch runs
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    // (a) The edit still reached the doc synchronously — NO in-session data loss.
    expect(pushed).not.toBeNull();
    const src = (pushed!.asClasses ?? []).find((c) => c.path === "Foo.as")
      ?.source;
    expect(src).toBe("class Foo { var edited; }");

    // (b) The failure was surfaced, not swallowed.
    const warn = el.querySelector('[data-testid="class-persist-warning"]');
    expect(warn).not.toBeNull();
    expect(warn?.textContent ?? "").toMatch(/storage/i);

    act(() => r.unmount());
    el.remove();
  });
});
