import { defineConfig } from "vitest/config";

/**
 * Plain Node test runner for the PURE relay logic (`src/relay.ts`). No miniflare
 * / no Cloudflare runtime / no CF credentials are needed: the pub/sub relay is a
 * transport-agnostic data structure, so it tests in vanilla Node. The DO/Worker
 * wrapper in `src/index.ts` is the only Cloudflare-coupled file and is exercised
 * by the relay tests through the same `SignalingRelay` it delegates to.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
