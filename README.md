# dash

a Macromedia Flash 8 clone

**Try It** https://jhead.github.io/dash/

Author Flash content in your browser, publish to SWF, and run it with Ruffle.

## Features

- Stage editor with drawing tools (rectangle, ellipse, pencil, text)
- Timeline with layers, keyframes, and tweens
- Library panel for symbols (MovieClip, Button, Graphic)
- ActionScript 2 compiler (AVM1 bytecode)
- Publish to SWF — playable in the built-in Ruffle player
- Agent MCP bridge for programmatic authoring via Claude Code

## Run locally

```bash
# Install dependencies
pnpm install

# Start the web dev server (browser-only, no Tauri required)
pnpm dev:browser
# Open http://localhost:1420
```

To run the full Tauri desktop app (native file dialogs, disk I/O):

```bash
pnpm dev
```

## Build for production

```bash
pnpm build:browser
# Output: apps/desktop/dist/
```

## Tests

```bash
# Unit tests (run sequentially to avoid esbuild race)
pnpm --filter @flash/swf run test -- --run
pnpm --filter @flash/core run test -- --run
pnpm --filter @flash/authoring-ui run test -- --run

# E2E (Playwright — auto-starts Vite dev server on port 1420)
pnpm --filter @flash/desktop e2e
```
