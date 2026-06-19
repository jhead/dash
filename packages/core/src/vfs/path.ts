// ---------------------------------------------------------------------------
// Pure classpath-path helpers shared by every ClassVfs backend.
//
// No DOM / no Node `path` module — these run identically everywhere. A
// "classpath-relative" path is a forward-slash POSIX-style path with no leading
// slash, no `.`/`..` segments, no backslashes, and no empty segments, e.g.
// `com/example/Foo.as`. Backends rely on `normalizeClassPath` to reject unsafe
// input BEFORE it ever reaches a real filesystem (defends OPFS/Tauri against
// `..` traversal out of the classes root).
// ---------------------------------------------------------------------------

/** Thrown when a path cannot be normalized into a safe classpath-relative path. */
export class InvalidClassPathError extends Error {
  constructor(
    public readonly input: string,
    reason: string
  ) {
    super(`Invalid class path "${input}": ${reason}`);
    this.name = "InvalidClassPathError";
  }
}

/**
 * Normalize and validate a classpath-relative path. Converts backslashes to
 * forward slashes, collapses repeated slashes, and trims a single leading
 * `./`/`/`. THROWS {@link InvalidClassPathError} on anything unsafe: absolute
 * paths after trimming, `..` traversal, empty result, or a NUL byte.
 *
 * The result always uses forward slashes and never starts or ends with one.
 */
export function normalizeClassPath(input: string): string {
  if (typeof input !== "string") {
    throw new InvalidClassPathError(String(input), "not a string");
  }
  if (input.includes("\0")) {
    throw new InvalidClassPathError(input, "contains NUL byte");
  }
  // Unify separators and collapse runs of slashes.
  let p = input.replace(/\\/g, "/").replace(/\/+/g, "/");
  // Drop a single leading "./" or "/".
  p = p.replace(/^\.?\//, "");
  // Drop a trailing slash (paths are files, never directories here).
  p = p.replace(/\/$/, "");
  if (p === "" || p === ".") {
    throw new InvalidClassPathError(input, "resolves to empty path");
  }
  const segments = p.split("/");
  for (const seg of segments) {
    if (seg === "" || seg === ".") {
      throw new InvalidClassPathError(input, "contains empty or '.' segment");
    }
    if (seg === "..") {
      throw new InvalidClassPathError(input, "contains '..' traversal");
    }
  }
  return segments.join("/");
}

/**
 * Split a normalized classpath-relative path into its directory segments and
 * leaf file name. `com/example/Foo.as` -> `{ dirs: ["com","example"], file:
 * "Foo.as" }`; a top-level file -> `{ dirs: [], file: "Foo.as" }`. Input is
 * normalized first, so unsafe input throws.
 */
export function splitClassPath(path: string): {
  readonly dirs: readonly string[];
  readonly file: string;
} {
  const normalized = normalizeClassPath(path);
  const segments = normalized.split("/");
  const file = segments[segments.length - 1]!;
  const dirs = segments.slice(0, -1);
  return { dirs, file };
}

/**
 * Join classpath segments into a single normalized classpath-relative path.
 * Empty/blank segments are skipped; the result is validated like any other path.
 */
export function joinClassPath(...segments: readonly string[]): string {
  return normalizeClassPath(segments.filter((s) => s && s !== "/").join("/"));
}

/** True if `path` looks like an AS2 class file (`.as`, case-insensitive). */
export function isAsFile(path: string): boolean {
  return /\.as$/i.test(path);
}
