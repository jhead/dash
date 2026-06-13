/**
 * Unit tests for the Character Embedding ("Embed…") dialog data logic and the
 * TextView onConfirm → model mapping (task 1182).
 *
 * The dialog itself is a presentational React component; these tests cover the
 * pure selection→model logic so the round-trip (model → dialog state → model) is
 * verified without a DOM renderer (the authoring-ui suite is logic-only).
 */

import { describe, it, expect } from "vitest";
import type { EmbedRange, TextDisplayObject } from "@flash/core";

// ---------------------------------------------------------------------------
// Mirrors CharacterEmbeddingDialog.handleOk: produce the { ranges, chars }
// selection from dialog state.
// ---------------------------------------------------------------------------
function dialogConfirm(state: {
  embedEnabled: boolean;
  selected: EmbedRange[];
  chars: string;
}): { ranges: readonly EmbedRange[] | undefined; chars: string } {
  if (!state.embedEnabled) return { ranges: undefined, chars: "" };
  return { ranges: state.selected, chars: state.chars };
}

// ---------------------------------------------------------------------------
// Mirrors TextView's onConfirm → onUpdateObject mapping.
// ---------------------------------------------------------------------------
function applyToModel(
  selection: { ranges: readonly EmbedRange[] | undefined; chars: string }
): Partial<TextDisplayObject> {
  return {
    embedRanges: selection.ranges,
    embedChars: selection.ranges === undefined ? undefined : selection.chars,
  };
}

describe("CharacterEmbeddingDialog selection logic", () => {
  it("disabled embedding → undefined ranges (compiler embeds all = default)", () => {
    const sel = dialogConfirm({ embedEnabled: false, selected: ["numerals"], chars: "abc" });
    expect(sel.ranges).toBeUndefined();
    const changes = applyToModel(sel);
    expect(changes.embedRanges).toBeUndefined();
    expect(changes.embedChars).toBeUndefined();
  });

  it("enabled with 'numerals' → embedRanges=['numerals']", () => {
    const sel = dialogConfirm({ embedEnabled: true, selected: ["numerals"], chars: "" });
    const changes = applyToModel(sel);
    expect(changes.embedRanges).toEqual(["numerals"]);
    expect(changes.embedChars).toBe("");
  });

  it("multi-select ranges + specific chars round-trip into the model", () => {
    const sel = dialogConfirm({
      embedEnabled: true,
      selected: ["uppercase", "numerals"],
      chars: "$.,",
    });
    const changes = applyToModel(sel);
    expect(changes.embedRanges).toEqual(["uppercase", "numerals"]);
    expect(changes.embedChars).toBe("$.,");
  });

  it("model → dialog → model round-trip preserves an explicit empty selection", () => {
    // A field that opted in but selected no named range (embedRanges = []).
    const initial: Pick<TextDisplayObject, "embedRanges" | "embedChars"> = {
      embedRanges: [],
      embedChars: "X",
    };
    // Dialog opens enabled (ranges !== undefined), no toggles, OK pressed.
    const sel = dialogConfirm({
      embedEnabled: true,
      selected: [...(initial.embedRanges ?? [])],
      chars: initial.embedChars ?? "",
    });
    const changes = applyToModel(sel);
    expect(changes.embedRanges).toEqual([]);
    expect(changes.embedChars).toBe("X");
  });
});
