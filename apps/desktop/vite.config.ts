import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { agentMcpPlugin } from "@flash/vite-plugin-agent-mcp";

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), agentMcpPlugin()],

  // GitHub Pages serves the app under a subdirectory matching the repo name.
  // In production builds we set the base to "/dash/" so asset paths resolve
  // correctly. During local dev the default "/" is used.
  base: process.env.NODE_ENV === "production" ? "/dash/" : "/",

  // Allow Vite to serve .wasm files from the public directory as static assets.
  assetsInclude: ["**/*.wasm"],

  // Point Vite directly at each workspace package's TypeScript source so that
  // edits are reflected immediately without a manual `pnpm build` step.
  resolve: {
    alias: {
      "@flash/agent-protocol": path.resolve(
        __dirname,
        "../../packages/agent-protocol/src/index.ts"
      ),
      "@flash/core": path.resolve(
        __dirname,
        "../../packages/core/src/index.ts"
      ),
      "@flash/authoring-ui": path.resolve(
        __dirname,
        "../../packages/authoring-ui/src/index.ts"
      ),
      "@flash/swf": path.resolve(
        __dirname,
        "../../packages/swf/src/index.ts"
      ),
      "@flash/player": path.resolve(
        __dirname,
        "../../packages/player/src/index.ts"
      ),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
