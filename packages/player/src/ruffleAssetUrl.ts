/**
 * Compute the base URL where the self-hosted Ruffle bundle (ruffle.js + its
 * sibling WASM/chunk files) is served.
 *
 * The web app is deployed to GitHub Pages under a sub-path (e.g. `/dash/`), so a
 * ROOT-ABSOLUTE URL like `/ruffle/ruffle.js` resolves to
 * `https://<host>/ruffle/ruffle.js` and 404s — it ignores the deployment base.
 * Vite injects the configured base as `import.meta.env.BASE_URL` (`/dash/` in a
 * production GitHub Pages build, `/` in local dev and in the Tauri/desktop
 * build), so the correct, base-relative location is `${BASE_URL}ruffle`.
 *
 * `@flash/player` is base-agnostic on its own, but its source is bundled
 * directly by the app's Vite build (it is path-aliased in `vite.config.ts`), so
 * `import.meta.env.BASE_URL` is substituted at build time and resolves to the
 * deployment base. This helper is pure (takes the base value as an argument) so
 * it can be unit-tested without a bundler.
 *
 * @param baseUrl The Vite base (e.g. `import.meta.env.BASE_URL`). Defaults to
 *   `/` so a non-Vite host (tests, SSR) still produces a valid root-relative
 *   URL.
 * @returns A base-relative path to the Ruffle asset directory, WITHOUT a
 *   trailing slash (the caller appends `/ruffle.js`). e.g. `/dash/ruffle`,
 *   `/ruffle`.
 */
export function resolveRuffleBaseUrl(baseUrl?: string): string {
  // Vite guarantees BASE_URL ends with a slash, but be defensive: a missing,
  // empty, or non-slash-terminated value must still yield a single clean join.
  const base = baseUrl && baseUrl.length > 0 ? baseUrl : "/";
  const withSlash = base.endsWith("/") ? base : `${base}/`;
  // `${'/dash/'}ruffle` -> '/dash/ruffle'; `${'/'}ruffle` -> '/ruffle'.
  return `${withSlash}ruffle`;
}

/**
 * Read the Vite-injected base URL at runtime, falling back to `/` when the
 * `import.meta.env` value is unavailable (e.g. a non-Vite test host). Kept
 * separate from {@link resolveRuffleBaseUrl} so the pure join logic stays
 * testable without a bundler.
 */
export function viteBaseUrl(): string {
  // `import.meta.env` is replaced statically by Vite at build time; guard so the
  // module also imports cleanly under a plain bundler/test without the define.
  const env = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
  return env?.BASE_URL ?? "/";
}
