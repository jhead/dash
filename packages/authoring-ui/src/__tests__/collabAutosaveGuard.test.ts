// ---------------------------------------------------------------------------
// Regression tests for task 1377 — joining a collab share link must NOT let the
// autosave silently overwrite the user's local NAMED project slot (data loss).
//
// Sequence being defended: user opens named project "MyGame" → joins a share
// link → the join REPLACES the in-memory doc with the shared/remote document →
// the debounced autosave (which fires on any history.present change) would then
// write that remote doc into the "MyGame" slot, irreversibly destroying the
// user's own project.
//
// The fix threads the collab-session signal onto the document store
// (`isCollabActive()`, set/cleared by the collab undo handler that every
// start/join attaches) and makes the autosave persist path SUSPEND writes to the
// named slot while a session is active — the current-working recovery slot still
// tracks the session doc (accepted, CLAUDE.md task-1348 item 4).
//
// These wire the REAL AutosaveController + REAL ProjectStore (fake-indexeddb) +
// REAL document store, mirroring exactly what useProjectActions does (the package
// test env is node, so no React/jsdom harness is needed), plus one test that runs
// the REAL attachCollab join path to prove it flips `isCollabActive()`.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import * as Y from "yjs";
import { createDocument, type FlashDocument } from "@flash/core";
import {
  AutosaveController,
  type AutosavePayload,
} from "../projects/autosaveController.js";
import { ProjectStore, CURRENT_WORKING_KEY } from "../projects/projectStore.js";
import { autosaveCurrentWorking } from "../projects/projectSession.js";
import { createDocumentStore, type DocumentStoreApi } from "../store/documentStore.js";
import { attachCollab } from "../store/collabAdapter.js";

// localStorage shim (projectSession helpers touch the recent list on some paths).
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string): void { this.m.set(k, v); }
  removeItem(k: string): void { this.m.delete(k); }
  clear(): void { this.m.clear(); }
}

function freshStore(): ProjectStore {
  return new ProjectStore({
    indexedDB: new IDBFactory(),
    dbName: `collab-guard-${Math.random().toString(36).slice(2)}`,
  });
}

// A stand-in doc that serializes to a recognizable byte string so we can assert
// which version (local named vs remote shared) landed in a slot.
function tagDoc(tag: string): FlashDocument {
  return { __tag: tag } as unknown as FlashDocument;
}
function serializeTag(d: FlashDocument): Uint8Array {
  return new TextEncoder().encode((d as unknown as { __tag: string }).__tag);
}
function decode(b: Uint8Array): string {
  return new TextDecoder().decode(b);
}

/**
 * Build the autosave controller wired EXACTLY the way useProjectActions wires it
 * post-fix: the current-working recovery slot is always written, but the named
 * slot is skipped whenever a collab session is active on the document store.
 */
function wireGuardedController(
  store: ProjectStore,
  documentStore: DocumentStoreApi,
): AutosaveController {
  return new AutosaveController({
    serialize: serializeTag,
    persist: async ({ bytes, targetName, generation }: AutosavePayload) => {
      await autosaveCurrentWorking(store, bytes, generation);
      if (
        targetName &&
        targetName !== CURRENT_WORKING_KEY &&
        !documentStore.getState().isCollabActive()
      ) {
        await store.put(targetName, bytes, { seq: generation });
      }
    },
  });
}

/** A collab undo handler stand-in (start/join attach one of these via attachCollab). */
const noopCollabUndo = { undo() {}, redo() {} };

describe("task 1377 — collab join must not clobber the local named project", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: new MemStorage(),
      writable: true,
      configurable: true,
    });
  });

  it("a local named project survives joining a share link (autosave suspends the named slot)", async () => {
    const store = freshStore();
    const documentStore = createDocumentStore(createDocument());
    const controller = wireGuardedController(store, documentStore);

    // 1) User has a named project "MyGame" saved locally.
    await store.put("MyGame", serializeTag(tagDoc("local-project-A")), { seq: 0 });

    // 2) User JOINS a share link: a collab session attaches (routing undo through
    //    the per-origin handler), and the remote doc REPLACES the in-memory doc.
    documentStore.getState().setCollabUndo(noopCollabUndo);
    expect(documentStore.getState().isCollabActive()).toBe(true);

    // 3) The autosave fires with the remote/shared doc, still targeting the named
    //    slot that was active when the user opened "MyGame".
    controller.schedule(tagDoc("remote-shared-doc"), "MyGame");
    await controller.flush();

    // The named slot MUST still hold the user's own project — NOT the remote doc.
    const named = await store.get("MyGame");
    expect(named).not.toBeNull();
    expect(decode(named!.bytes)).toBe("local-project-A");

    // The current-working recovery slot DOES track the session doc (accepted).
    const working = await store.get(CURRENT_WORKING_KEY);
    expect(decode(working!.bytes)).toBe("remote-shared-doc");
  });

  it("no matter how many remote edits arrive, the named slot is never overwritten during the session", async () => {
    const store = freshStore();
    const documentStore = createDocumentStore(createDocument());
    const controller = wireGuardedController(store, documentStore);
    await store.put("MyGame", serializeTag(tagDoc("local-project-A")), { seq: 0 });

    documentStore.getState().setCollabUndo(noopCollabUndo);
    for (const tag of ["remote-1", "remote-2", "remote-3"]) {
      controller.schedule(tagDoc(tag), "MyGame");
      await controller.flush();
    }

    expect(decode((await store.get("MyGame"))!.bytes)).toBe("local-project-A");
    expect(decode((await store.get(CURRENT_WORKING_KEY))!.bytes)).toBe("remote-3");
  });

  it("on leave, autosave resumes writing the named slot", async () => {
    const store = freshStore();
    const documentStore = createDocumentStore(createDocument());
    const controller = wireGuardedController(store, documentStore);
    await store.put("MyGame", serializeTag(tagDoc("local-project-A")), { seq: 0 });

    // During the session the named slot is protected.
    documentStore.getState().setCollabUndo(noopCollabUndo);
    controller.schedule(tagDoc("remote-shared-doc"), "MyGame");
    await controller.flush();
    expect(decode((await store.get("MyGame"))!.bytes)).toBe("local-project-A");

    // Leave the session: the collab handler is cleared → autosave resumes.
    documentStore.getState().setCollabUndo(null);
    expect(documentStore.getState().isCollabActive()).toBe(false);
    controller.schedule(tagDoc("post-leave-edit"), "MyGame");
    await controller.flush();
    expect(decode((await store.get("MyGame"))!.bytes)).toBe("post-leave-edit");
  });

  it("solo autosave (no session) still writes the named slot — unchanged behavior", async () => {
    const store = freshStore();
    const documentStore = createDocumentStore(createDocument());
    const controller = wireGuardedController(store, documentStore);
    await store.put("MyGame", serializeTag(tagDoc("local-project-A")), { seq: 0 });

    expect(documentStore.getState().isCollabActive()).toBe(false);
    controller.schedule(tagDoc("solo-edit"), "MyGame");
    await controller.flush();
    expect(decode((await store.get("MyGame"))!.bytes)).toBe("solo-edit");
  });

  it("the REAL attachCollab join path flips isCollabActive() on/off", () => {
    const documentStore = createDocumentStore(createDocument());
    expect(documentStore.getState().isCollabActive()).toBe(false);

    // attachCollab is what every startCollab/joinCollab calls; it registers the
    // per-origin undo handler that IS the session-active signal.
    const attached = attachCollab(documentStore, new Y.Doc());
    expect(documentStore.getState().isCollabActive()).toBe(true);

    attached.detach();
    expect(documentStore.getState().isCollabActive()).toBe(false);
  });
});
