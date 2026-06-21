/**
 * Local collaborator identity (task 1345 P2 — awareness/presence).
 *
 * Every peer in a collaboration session needs a stable identity — an id (so the
 * UI can dedupe / "follow" a specific peer), a display name, and a color used
 * everywhere that peer appears (cursor, selection outline, avatar chip, library
 * "editing" badge). This is purely local: it is generated once per browser and
 * persisted so a user keeps the same color/name across sessions and reloads.
 *
 * It has NOTHING to do with the document — it is never written to the Y.Doc, only
 * to the awareness channel (which is non-persistent presence data). In the solo
 * app this module is never read (no awareness exists until a session starts).
 */

/** A collaborator's stable identity, broadcast as the `user` awareness field. */
export interface CollabUser {
  /** Stable per-browser id (random; survives reloads). */
  readonly id: string;
  /** Display name (editable; defaults to a friendly random handle). */
  readonly name: string;
  /** Hex color (e.g. "#e6194b") used for this peer's cursor/selection/avatar. */
  readonly color: string;
}

/**
 * A high-contrast, visually-distinct palette (Sasha Trubetskoy's 20-color set,
 * the first dozen). Picked deterministically from the local id so a peer's color
 * is stable and two peers rarely collide.
 */
export const PRESENCE_COLORS: readonly string[] = [
  "#e6194b", // red
  "#3cb44b", // green
  "#4363d8", // blue
  "#f58231", // orange
  "#911eb4", // purple
  "#42d4f4", // cyan
  "#f032e6", // magenta
  "#bfef45", // lime
  "#fabed4", // pink
  "#469990", // teal
  "#9a6324", // brown
  "#800000", // maroon
];

const ADJECTIVES = [
  "Swift", "Bright", "Calm", "Bold", "Keen", "Lively", "Mellow", "Nimble",
  "Quick", "Sunny", "Vivid", "Warm",
];
const ANIMALS = [
  "Otter", "Fox", "Lynx", "Heron", "Marten", "Falcon", "Badger", "Wren",
  "Pika", "Stoat", "Finch", "Newt",
];

const STORAGE_KEY = "flash8.collab.localUser";

/** Pick a palette color deterministically from an id string. */
export function colorForId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return PRESENCE_COLORS[h % PRESENCE_COLORS.length];
}

function randomId(): string {
  // 64 bits of randomness, base36 — enough to make peer collisions negligible.
  const a = Math.floor(Math.random() * 0xffffffff).toString(36);
  const b = Math.floor(Math.random() * 0xffffffff).toString(36);
  return `u-${a}${b}`;
}

function randomName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return `${adj} ${animal}`;
}

/** Build a fresh identity (id-derived stable color, friendly random name). */
export function createLocalUser(): CollabUser {
  const id = randomId();
  return { id, name: randomName(), color: colorForId(id) };
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function safeStorage(): StorageLike | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    // Access can throw in sandboxed iframes / disabled-storage contexts.
  }
  return null;
}

function isUser(v: unknown): v is CollabUser {
  if (!v || typeof v !== "object") return false;
  const u = v as Record<string, unknown>;
  return (
    typeof u.id === "string" &&
    typeof u.name === "string" &&
    typeof u.color === "string"
  );
}

/**
 * Load the persisted local identity, or create + persist a fresh one. The first
 * call in a fresh browser mints the identity; subsequent calls (and reloads)
 * return the same id/color. Pass a `storage` for tests.
 */
export function getLocalUser(storage: StorageLike | null = safeStorage()): CollabUser {
  if (storage) {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (isUser(parsed)) return parsed;
      }
    } catch {
      // Corrupt entry — fall through and mint a fresh one.
    }
  }
  const user = createLocalUser();
  if (storage) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(user));
    } catch {
      // Quota / disabled storage — identity stays in-memory for this session.
    }
  }
  return user;
}

/** Persist an updated identity (e.g. user renamed themselves). */
export function setLocalUser(
  user: CollabUser,
  storage: StorageLike | null = safeStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(user));
  } catch {
    // ignore
  }
}
