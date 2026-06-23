/**
 * SWF BlendMode UI8 reference values (task 1372).
 *
 * Mirrors `SWF_BLEND_MODE` in packages/swf/src/filters.ts so the multi-flag
 * PlaceObject3 oracle can assert the decoded BlendMode byte equals the expected
 * value WITHOUT importing the compiler's internal (the e2e suite only consumes
 * the published SWF, not the encoder source). If the encoder mapping ever
 * changes, this constant must change with it — kept tiny and self-contained.
 */
export const SWF_BLEND_MODE_REF: Readonly<Record<string, number>> = {
  normal: 1,
  layer: 2,
  multiply: 3,
  screen: 4,
  lighten: 5,
  darken: 6,
  difference: 7,
  add: 8,
  subtract: 9,
  invert: 10,
  alpha: 11,
  erase: 12,
  overlay: 13,
  hardlight: 14,
};
