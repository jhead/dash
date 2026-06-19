// ---------------------------------------------------------------------------
// Pure helpers for the Classes panel (task 1302 P4).
//
// These are DOM-free and React-free so they are unit-testable in the Node test
// env (the authoring-ui vitest config runs `environment: "node"`). The
// ClassesPanel component composes them with a live `ClassVfs` + `pushDoc`; the
// tree-building, validation, and default-template logic live here.
//
// All paths are classpath-relative with forward slashes (the `AsClassFile.path`
// / `ClassVfs` convention, e.g. `com/example/Foo.as`).
// ---------------------------------------------------------------------------

import { normalizeClassPath, splitClassPath, isAsFile } from "@flash/core";

// ---------------------------------------------------------------------------
// Tree model
// ---------------------------------------------------------------------------

/** A folder (package segment) node in the class tree. */
export interface ClassTreeFolder {
  readonly kind: "folder";
  /** The folder's own name (last package segment), e.g. `example`. */
  readonly name: string;
  /** Classpath-relative directory path, e.g. `com/example`. */
  readonly path: string;
  /** Child folders then files, each pre-sorted alphabetically. */
  readonly children: ReadonlyArray<ClassTreeNode>;
}

/** A `.as` file leaf in the class tree. */
export interface ClassTreeFile {
  readonly kind: "file";
  /** The file's own name, e.g. `Foo.as`. */
  readonly name: string;
  /** Full classpath-relative path, e.g. `com/example/Foo.as`. */
  readonly path: string;
}

export type ClassTreeNode = ClassTreeFolder | ClassTreeFile;

// ---------------------------------------------------------------------------
// buildClassTree — turn a flat list of classpath-relative paths into a nested
// folder/file tree, sorted folders-first then files, alphabetical within each
// group (case-insensitive). Non-`.as` paths are ignored. Unsafe paths are
// silently skipped (normalizeClassPath would throw).
// ---------------------------------------------------------------------------

interface MutableFolder {
  name: string;
  path: string;
  folders: Map<string, MutableFolder>;
  files: ClassTreeFile[];
}

function newFolder(name: string, path: string): MutableFolder {
  return { name, path, folders: new Map(), files: [] };
}

export function buildClassTree(paths: readonly string[]): ClassTreeFolder {
  const root = newFolder("", "");
  for (const raw of paths) {
    let path: string;
    try {
      path = normalizeClassPath(raw);
    } catch {
      continue; // skip unsafe input rather than throwing for the whole tree
    }
    if (!isAsFile(path)) continue;
    const { dirs, file } = splitClassPath(path);
    let cur = root;
    const acc: string[] = [];
    for (const dir of dirs) {
      acc.push(dir);
      const dirPath = acc.join("/");
      let next = cur.folders.get(dir);
      if (!next) {
        next = newFolder(dir, dirPath);
        cur.folders.set(dir, next);
      }
      cur = next;
    }
    cur.files.push({ kind: "file", name: file, path });
  }
  return freezeFolder(root);
}

const byName = (a: { name: string }, b: { name: string }): number =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
  a.name.localeCompare(b.name);

function freezeFolder(m: MutableFolder): ClassTreeFolder {
  const folders = [...m.folders.values()].sort(byName).map(freezeFolder);
  const files = [...m.files].sort(byName);
  return {
    kind: "folder",
    name: m.name,
    path: m.path,
    // Folders first, then files (Flash / VS Code convention).
    children: [...folders, ...files],
  };
}

/** Flatten a tree to its file leaves, in depth-first display order. */
export function listTreeFiles(folder: ClassTreeFolder): ClassTreeFile[] {
  const out: ClassTreeFile[] = [];
  const walk = (f: ClassTreeFolder): void => {
    for (const child of f.children) {
      if (child.kind === "folder") walk(child);
      else out.push(child);
    }
  };
  walk(folder);
  return out;
}

// ---------------------------------------------------------------------------
// New-class path derivation + validation
// ---------------------------------------------------------------------------

/**
 * Turn a user-typed class entry into a classpath-relative `.as` path. Accepts
 * either a dotted AS2 class name (`com.example.Foo`) or a slashed path
 * (`com/example/Foo`/`com/example/Foo.as`). Always appends `.as` if missing.
 * Throws (via normalizeClassPath) on unsafe input.
 */
export function classNameToPath(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "") throw new Error("Class name is empty");
  // Dotted AS2 names -> slashes, but only when there is no slash and no ".as"
  // already (so "com.example.Foo" works, "Foo.as" / "a/b.as" are left alone).
  let candidate = trimmed;
  if (!candidate.includes("/") && !/\.as$/i.test(candidate)) {
    candidate = candidate.replace(/\./g, "/");
  }
  if (!/\.as$/i.test(candidate)) candidate += ".as";
  return normalizeClassPath(candidate);
}

/** Derive the AS2 class name (last segment, sans `.as`) from a path. */
export function classNameFromPath(path: string): string {
  const { file } = splitClassPath(path);
  return file.replace(/\.as$/i, "");
}

/** Derive the dotted AS2 package+class identifier from a path. */
export function dottedNameFromPath(path: string): string {
  return normalizeClassPath(path)
    .replace(/\.as$/i, "")
    .replace(/\//g, ".");
}

/**
 * Validate a candidate new/renamed class path against the existing set. Returns
 * null when ok, or a human-readable error string. `existing` is the set of
 * normalized paths already present; `selfPath` (for rename) is excluded from the
 * collision check.
 */
export function validateClassPath(
  candidate: string,
  existing: ReadonlySet<string>,
  selfPath?: string
): string | null {
  let path: string;
  try {
    path = normalizeClassPath(candidate);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  if (!isAsFile(path)) return "Class file must end in .as";
  // Each path segment must be a valid AS2 identifier (sans the trailing .as).
  const { dirs, file } = splitClassPath(path);
  const stem = file.replace(/\.as$/i, "");
  const idRe = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
  for (const dir of dirs) {
    if (!idRe.test(dir)) return `Invalid package segment: "${dir}"`;
  }
  if (!idRe.test(stem)) return `Invalid class name: "${stem}"`;
  if (selfPath !== undefined && path === normalizeClassPath(selfPath)) {
    return null; // unchanged path on rename — fine
  }
  if (existing.has(path)) return `A class already exists at ${path}`;
  return null;
}

// ---------------------------------------------------------------------------
// Default class source — the stub Flash 8 inserts for a new external class.
// ---------------------------------------------------------------------------

/** Boilerplate source for a freshly-created class at `path`. */
export function defaultClassSource(path: string): string {
  const dotted = dottedNameFromPath(path);
  return `class ${dotted} {\n\tfunction ${classNameFromPath(path)}() {\n\t}\n}\n`;
}
