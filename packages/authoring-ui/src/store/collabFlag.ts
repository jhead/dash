/**
 * Collaboration opt-in flag (task 1343 P0).
 *
 * Default OFF. Collaboration only activates when a caller explicitly calls
 * `attachCollab(...)`. This constant documents the default and is the single
 * place a future phase (P1+) flips the editor's default behavior. The solo app
 * is byte-for-byte identical with this OFF.
 */
export const COLLAB_ENABLED_DEFAULT = false;
