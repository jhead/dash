/**
 * AS2 user-class compilation pass (task 1299, "AS2 classes P1").
 *
 * Compiles each external `.as` class source attached to the document
 * (`doc.asClasses`) into AVM1 bytecode and wraps it in a DoInitAction so the
 * class constructor + prototype chain are installed in `_global` BEFORE the
 * first frame runs. This is what lets a library symbol linked to an AS2 class
 * resolve at runtime: `attachMovie()` / `new ClassName()` find the constructor
 * that the symbol pass's `Object.registerClass(linkageId, ClassName)` binding
 * references.
 *
 * ----------------------------------------------------------------------------
 * REUSE TEMPLATE — the v2 component pass (`compiler/components.ts`)
 * ----------------------------------------------------------------------------
 * `runComponentPass` already solves the same shape of problem for synthesized
 * `mx.controls.*` component classes: it compiles a class body via `compileAS2`,
 * wraps it with `encodeRawDoInitAction` (the DEFINITION), and pushes that body
 * BEFORE the `encodeDoInitAction` registerClass binding so the constructor
 * exists in `_global` when registerClass resolves it.
 *
 * `runClassPass` does the same for USER classes, with two differences:
 *  1. The registerClass binding for a user class comes from `runSymbolPass`
 *     (it emits `Object.registerClass(linkageId, className)` for every library
 *     symbol whose linkage has `exportForActionScript` + a `className`). So this
 *     pass emits ONLY the class-definition bodies; the orchestrator must place
 *     them BEFORE the symbol-pass registerClass bodies (see compile.ts).
 *  2. Multiple user classes can have `extends` relationships among themselves.
 *     A subclass's definition runs `ClassName.prototype = new SuperClass()`
 *     (ActionExtends), which dereferences the superclass constructor — so the
 *     SUPERCLASS definition must execute first. We topologically order the class
 *     DoInitActions by `extends` (superclass before subclass).
 *
 * `import` statements stay a pure resolution hint (no bytecode) — v1 compiles
 * EVERY entry in `doc.asClasses` deterministically (closure-trimming to only
 * referenced classes is a later optimization).
 *
 * Fully-qualified names (`com.example.Foo`) are handled inside the AS2 compiler:
 * `compileClassDecl` emits the `_global.<package>` guard objects and registers
 * the class at its dotted path, and `Object.registerClass`'s
 * `ActionGetVariable "com.example.Foo"` resolves the dotted path. This pass does
 * not need to know whether a name is dotted.
 */

import type { FlashDocument, Program, ClassDecl, InterfaceDecl } from "@flash/core";
import { parse, compileAS2 } from "@flash/core";
import { encodeRawDoInitAction } from "../doInitAction.js";

export interface ClassPassResult {
  /**
   * Class-DEFINITION DoInitAction bodies, ordered so a superclass definition
   * precedes any subclass that extends it. The orchestrator emits these IN
   * ARRAY ORDER and BEFORE the symbol-pass registerClass bodies.
   */
  doInitActionBodies: Uint8Array[];
}

/** A parsed user-class file plus the metadata needed to order it. */
interface ParsedClassFile {
  /** Classpath-relative path (stable sort key for determinism). */
  path: string;
  /** Full source text (compiled as one unit). */
  source: string;
  /**
   * Primary declared class name (dotted form preserved), or null for a file
   * with no top-level ClassDecl (e.g. an interface-only or helper file). Used
   * as the topo-sort node id.
   */
  className: string | null;
  /** Declared superclass name (dotted form preserved), or null. */
  superClass: string | null;
}

/**
 * Extract the primary class name + superclass from a parsed program. A Flash
 * AS2 file conventionally declares ONE public class; we take the first
 * top-level ClassDecl. (Interfaces register too but never participate in the
 * `extends` ordering — interface bodies have no `new SuperClass()`.)
 */
function primaryClassOf(program: Program): { className: string | null; superClass: string | null } {
  for (const stmt of program.body) {
    if (stmt.type === "ClassDecl") {
      const decl = stmt as ClassDecl;
      return { className: decl.name, superClass: decl.superClass };
    }
  }
  // No class — maybe interface-only. Record the interface name so a later
  // closure-trim could reason about it, but interfaces impose no ordering.
  for (const stmt of program.body) {
    if (stmt.type === "InterfaceDecl") {
      return { className: (stmt as InterfaceDecl).name, superClass: null };
    }
  }
  return { className: null, superClass: null };
}

/**
 * Topologically order parsed class files so that a superclass file appears
 * before any file whose primary class `extends` it. Classes whose superclass is
 * NOT among the user classes (built-ins like MovieClip/Object, or unresolved)
 * impose no constraint. Ties (and the entire result, when there are no edges)
 * fall back to stable path order so the output is deterministic.
 *
 * A dependency cycle (illegal in AS2, but defend against it) degrades
 * gracefully to path order for the cycle members rather than hanging.
 */
function topoOrderByExtends(files: ParsedClassFile[]): ParsedClassFile[] {
  // Map each known user class name → its file (first declaration wins).
  const byClassName = new Map<string, ParsedClassFile>();
  for (const f of files) {
    if (f.className !== null && !byClassName.has(f.className)) {
      byClassName.set(f.className, f);
    }
  }

  // Stable input order: sort by path so the traversal is deterministic.
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const ordered: ParsedClassFile[] = [];
  const visited = new Set<ParsedClassFile>();
  const onStack = new Set<ParsedClassFile>();

  const visit = (f: ParsedClassFile): void => {
    if (visited.has(f)) return;
    if (onStack.has(f)) return; // cycle guard — stop recursing
    onStack.add(f);
    // Emit the superclass file first (if it's a known user class).
    if (f.superClass !== null) {
      const superFile = byClassName.get(f.superClass);
      if (superFile !== undefined && superFile !== f) {
        visit(superFile);
      }
    }
    onStack.delete(f);
    if (!visited.has(f)) {
      visited.add(f);
      ordered.push(f);
    }
  };

  for (const f of sorted) visit(f);
  return ordered;
}

/**
 * Compile every `.as` class attached to the document into class-definition
 * DoInitAction bodies, ordered superclass-before-subclass.
 *
 * Returns an empty result when the document has no `asClasses` (the common
 * case), so documents/fixtures without external classes are unaffected.
 */
export function runClassPass(doc: FlashDocument): ClassPassResult {
  const doInitActionBodies: Uint8Array[] = [];
  const asClasses = doc.asClasses;
  if (asClasses === undefined || asClasses.length === 0) {
    return { doInitActionBodies };
  }

  // 1. Parse each file (to extract the class/superclass for ordering).
  //    A parse/compile error on one file must not silently drop the rest, but
  //    it also must not crash the whole publish — re-throw with context so the
  //    failure is attributable to the offending .as file.
  const parsed: ParsedClassFile[] = [];
  for (const cls of asClasses) {
    let program: Program;
    try {
      program = parse(cls.source);
    } catch (e) {
      throw new Error(`AS2 class "${cls.path}" failed to parse: ${(e as Error).message}`);
    }
    const { className, superClass } = primaryClassOf(program);
    parsed.push({ path: cls.path, source: cls.source, className, superClass });
  }

  // 2. Topologically order by `extends` (superclass definition first).
  const ordered = topoOrderByExtends(parsed);

  // 3. Compile each ordered file to a class-definition DoInitAction body.
  //    spriteId is 0: DoInitAction scripts all execute before frame 1
  //    regardless of the id (it only matters for registerClass, which the
  //    symbol pass emits with the real linked char id). encodeRawDoInitAction
  //    appends the trailing ActionEnd that compileAS2 omits.
  for (const f of ordered) {
    let bytecode: Uint8Array;
    try {
      bytecode = compileAS2(f.source);
    } catch (e) {
      throw new Error(`AS2 class "${f.path}" failed to compile: ${(e as Error).message}`);
    }
    doInitActionBodies.push(encodeRawDoInitAction(0, bytecode));
  }

  return { doInitActionBodies };
}
