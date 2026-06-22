/**
 * Shared test helper: guard fixture-dependent FLA-writer tests on the presence of
 * a VALID `fixtures/flash8-empty.fla`.
 *
 * The genuine empty Flash 8 document (`fixtures/flash8-empty.fla`, WIN 8,0,0,478;
 * Contents = 17312 B, Page 1 = 274 B) is a byte-real binary that an agent cannot
 * fabricate. On a fresh clone the file may be MISSING, or committed as a 0-byte
 * placeholder, or otherwise not a real OLE2-CFB document. In any of those cases the
 * byte-match / structural gates that load it have nothing real to compare against and
 * must SKIP-WITH-REASON (mirroring the visual-oracle CI-skip pattern in CLAUDE.md)
 * rather than fail.
 *
 * The guard keys on the OLE2-CFB magic + a non-trivial size, NOT on a hardcoded
 * skip: the moment the author commits the real ~17 KB binary, `hasValidFla8Fixture()`
 * returns true and every guarded test runs at FULL strength again, exactly as before.
 * This is forward-compatible, not a permanent skip.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the genuine empty Flash 8 fixture. */
export const FLA8_EMPTY_FIXTURE = resolve(here, "../../../../../fixtures/flash8-empty.fla");

/** OLE2 Compound File Binary signature: D0 CF 11 E0 A1 B1 1A E1. */
const OLE2_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** Skip reason surfaced on every guarded test when the fixture is unusable. */
export const FLA8_FIXTURE_SKIP_REASON =
  "flash8-empty.fla fixture absent or empty — provide the real binary to enable byte-match tests";

/**
 * Returns true only when `path` exists, is a non-trivial file (>= the OLE2 header),
 * and begins with the OLE2-CFB magic. Returns false for a missing path, a 0-byte
 * placeholder, or any non-OLE2 content. Never throws.
 */
export function hasValidFla8Fixture(path: string = FLA8_EMPTY_FIXTURE): boolean {
  try {
    if (!existsSync(path)) return false;
    const st = statSync(path);
    if (!st.isFile() || st.size < OLE2_MAGIC.length) return false;
    const bytes = readFileSync(path);
    for (let i = 0; i < OLE2_MAGIC.length; i++) {
      if (bytes[i] !== OLE2_MAGIC[i]) return false;
    }
    return true;
  } catch {
    return false;
  }
}
