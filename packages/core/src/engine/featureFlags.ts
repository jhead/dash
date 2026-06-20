/**
 * Runtime feature flags for the engine.
 *
 * These gate in-progress re-architectures so default behavior is unchanged until
 * cutover. The flag store is a simple mutable module-level object; the authoring
 * UI / tests flip flags at runtime (e.g. via the `__flashTest` bridge).
 */

export interface EngineFeatureFlags {
  /**
   * Flash 8 planar merge-on-commit (docs/36-vector-merge-model.md, P1).
   *
   * When ON, committing a merge-mode shape (`type: "shape"`) folds it into the
   * active layer's planar arrangement (same-color union / different-color cut,
   * curve-preserving) instead of being appended as a discrete display object.
   *
   * DEFAULT: OFF — kept off until the P5 cutover so default authoring behavior
   * (and golden-parity / self-determinism for docs that don't use merge) is
   * unchanged.
   */
  planarMergeOnCommit: boolean;
}

const flags: EngineFeatureFlags = {
  planarMergeOnCommit: false,
};

/** Read the current value of an engine feature flag. */
export function getFeatureFlag<K extends keyof EngineFeatureFlags>(key: K): EngineFeatureFlags[K] {
  return flags[key];
}

/** Set an engine feature flag (used by the UI / test bridge). */
export function setFeatureFlag<K extends keyof EngineFeatureFlags>(
  key: K,
  value: EngineFeatureFlags[K]
): void {
  flags[key] = value;
}

/** Snapshot all flags (read-only copy). */
export function getFeatureFlags(): Readonly<EngineFeatureFlags> {
  return { ...flags };
}
