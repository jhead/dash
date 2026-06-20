/**
 * Merge-drawing interaction oracle — canonical Flash 8 merge-mode cases.
 *
 * This suite is the acceptance harness for the curve-aware planar geometry
 * kernel re-architecture (docs/36-vector-merge-model.md, task 1318 P0).  Each
 * case below is a CANONICAL merge-drawing interaction whose correctness is the
 * whole point of the planar kernel.  The verification recipe for every case is
 * the project's two-oracle stack:
 *
 *   (1) STAGE-CANVAS oracle — drive the interaction through the editor (draw,
 *       click-select, move, erase via the agent bridge / pointer), then capture
 *       `window.__flashTest.screenshotStage()` and assert the expected merge
 *       result (pixel regions present/absent, fragment counts).
 *   (2) RUFFLE PIXEL oracle — publish the document
 *       (`window.__flashTest.publish()`), render the SWF in the bundled Ruffle
 *       player, screenshot it, and pixelmatch against the stage capture so the
 *       authored merge result and the published result agree.
 *
 * These are intentionally `test.fixme` PLACEHOLDERS: the kernel (P0) lands the
 * geometry foundation; phases P1–P5 wire merge mode into the tools/renderer and
 * then FILL IN each body (remove `.fixme`).  Closing those phases requires these
 * specs to actually run and pass per AGENTS.md (visual-oracle acceptance).
 *
 * Mirrors the existing oracle conventions (visual-oracle.spec.ts /
 * interactivity.spec.ts): pixelmatch + pngjs, `__flashTest` bridge, autoplay+
 * overlay-hiding for Ruffle, page.screenshot clip for WebGL capture.
 */

import { test } from '@playwright/test';

test.describe('Merge-drawing oracle (planar kernel) — canonical cases', () => {
  // -------------------------------------------------------------------------
  // 1. red-over-blue cut
  // -------------------------------------------------------------------------
  // Draw a blue fill, then draw a RED fill overlapping it (merge mode, same
  // layer, different colors).  Expected Flash 8 behavior: the red shape CUTS the
  // blue where they overlap — the overlap region becomes red, the blue loses
  // that area (different-color = cut / replace, last-drawn wins).
  // Oracle: stage capture shows a red region over a reduced blue region; the
  // published SWF (Ruffle) matches.  Kernel: planar faces partition red vs blue,
  // total covered area conserved (planar.test.ts "different-color cut").
  test.fixme('red-over-blue cut: overlap becomes red, blue is carved away', async () => {
    // P1–P5: implement merge mode, then assert stage+Ruffle pixels.
  });

  // -------------------------------------------------------------------------
  // 2. blue-over-blue union
  // -------------------------------------------------------------------------
  // Draw a blue fill, then a second BLUE fill overlapping it.  Expected: the two
  // merge into ONE shape with no internal seam (same-color = union); selecting/
  // dragging picks up the unified silhouette.  Oracle: stage capture shows a
  // single blue blob; Ruffle matches; the union area equals A+B−overlap
  // (planar.test.ts "same-color union").
  test.fixme('blue-over-blue union: two overlapping blues merge into one shape', async () => {
    // P1–P5: implement same-color union, then assert single merged region.
  });

  // -------------------------------------------------------------------------
  // 3. line across fill, then move half
  // -------------------------------------------------------------------------
  // Draw a filled rectangle, then draw a LINE across it.  The line SPLITS the
  // fill into two independently-selectable halves.  Click-select one half and
  // move it away.  Expected: only that half moves; the other half + the line
  // segment remain.  Oracle: stage capture shows the displaced half; Ruffle
  // matches.  Kernel: the line edge subdivides the fill face into two faces
  // (planar.test.ts "a line across a fill splits it into faces").
  test.fixme('line across fill then move half: only the selected half moves', async () => {
    // P1–P5: line-splits-fill + segment selection, then assert the moved half.
  });

  // -------------------------------------------------------------------------
  // 4. two crossing lines = 4 segments
  // -------------------------------------------------------------------------
  // Draw two lines that cross.  Expected: they become FOUR independently-
  // selectable segments meeting at the crossing vertex (segment selection).
  // Oracle: click each of the four arms in turn and confirm only that arm
  // highlights/moves.  Kernel: the arrangement splits both lines at the crossing
  // into 4 undirected edges (planar.test.ts "two crossing lines = 4 segments").
  test.fixme('two crossing lines become four selectable segments', async () => {
    // P1–P5: arrangement-backed segment selection, then assert 4 arms.
  });

  // -------------------------------------------------------------------------
  // 5. erase across shape splits it
  // -------------------------------------------------------------------------
  // Draw a filled shape, then erase a band straight across it.  Expected: the
  // shape SPLITS into two separate fills (true subtraction, not whole-shape
  // delete).  Oracle: stage capture shows two disjoint fills with a gap; Ruffle
  // matches; both fragments are independently selectable.  (Today's eraser
  // approximates this by flattening to polylines — the kernel makes the cut
  // curve-preserving.)
  test.fixme('erase across a shape splits it into two fills', async () => {
    // P1–P5: route eraser through the planar kernel (curve-preserving cut).
  });

  // -------------------------------------------------------------------------
  // 6. partial fill click + move leaves a hole
  // -------------------------------------------------------------------------
  // Draw a large fill; draw a smaller DIFFERENT-color fill inside it (an
  // island).  Click the island and move it out.  Expected: moving the island
  // leaves a HOLE in the outer fill where the island used to cut it (true
  // subtraction — the island had carved the outer fill).  Oracle: stage capture
  // shows the outer fill with a hole + the displaced island; Ruffle matches.
  // Kernel: the island is a hole-face of the outer fill (planar.test.ts
  // "a different-color inner rect carves a colored island").
  test.fixme('partial-fill island click + move leaves a hole in the outer fill', async () => {
    // P1–P5: island carve + move, then assert the hole remains.
  });
});
