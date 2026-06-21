# dash signaling worker (`signal.dash.jxh.io`)

A serverless **y-webrtc signaling server** for dash's optional P2P collaboration
(docs/37). It is a Cloudflare **Worker + Durable Object** that speaks y-webrtc's
exact pub/sub signaling protocol, so the browser client stays **stock y-webrtc**
— only the signaling URL points here instead of a third-party public server.

## What it does (and does not)

The signaling server's only job is to broker the initial WebRTC handshake: it
relays the small JSON messages peers use to discover each other (announce / SDP
offer-answer / ICE candidates). Once the direct WebRTC connection is up, **all
document bytes flow peer-to-peer and never touch this server**.

It **never sees**:

- document contents (they go P2P over WebRTC), or
- the room password (every y-webrtc message is end-to-end encrypted with an
  AES-GCM key derived client-side from the password in the share-link fragment,
  which browsers never transmit).

## Protocol

A faithful re-implementation of upstream `y-webrtc/bin/server.js` — a pub/sub
relay over WebSocket. JSON messages:

| Client → server | Server behaviour |
| --- | --- |
| `{type:'subscribe', topics:[...]}` | add this connection to each topic |
| `{type:'unsubscribe', topics:[...]}` | remove from each topic |
| `{type:'publish', topic, ...payload}` | forward the whole message to **every** subscriber of `topic` (incl. the publisher), stamping `clients = <subscriber count>` |
| `{type:'ping'}` | reply `{type:'pong'}` |

A plain (non-upgrade) GET returns `okay` — a simple health check.

## Architecture

- **`src/relay.ts`** — the pure pub/sub relay (`topic → Set<connId>`), free of
  any Cloudflare types. This is the unit-tested core (no CF creds / no miniflare
  needed).
- **`src/index.ts`** — the Worker + `SignalingServer` Durable Object. The Worker
  routes **every** request to a single global DO (`idFromName('signaling')`) so
  all peers share one instance for cross-connection fan-out. The DO uses the
  **WebSocket Hibernation API** (`acceptWebSocket` + `webSocketMessage` /
  `webSocketClose` / `webSocketError`) so idle rooms cost nothing; each socket's
  subscription list is persisted via `serializeAttachment` and rehydrated on
  wake. Ping/pong keepalive uses the runtime auto-response and the JSON `ping`
  handler. Subscriptions are cleaned up on close/error.

## Develop & test locally (no Cloudflare account needed)

```bash
pnpm --filter @dash/signaling-worker run typecheck   # tsc
pnpm --filter @dash/signaling-worker run test         # relay unit tests (vitest)
pnpm --filter @dash/signaling-worker run deploy:dry-run  # wrangler build, no creds
pnpm --filter @dash/signaling-worker run dev          # wrangler dev (local runtime)
```

## Deploy

Deployment is automated by **`.github/workflows/deploy-signaling.yml`** — it runs
on a push to `main` that touches `workers/signaling/**`, and on manual
`workflow_dispatch`. To run it manually: GitHub → Actions → **Deploy signaling
worker** → **Run workflow**.

You can also deploy by hand:

```bash
cd workers/signaling
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... pnpm exec wrangler deploy
```

### One-time setup the repo owner must provide

1. **`jxh.io` must be an active zone in your Cloudflare account.** The
   `custom_domain` route in `wrangler.toml` provisions `signal.dash.jxh.io` (DNS
   record + edge TLS cert) under that zone. If `jxh.io` is not on Cloudflare, the
   deploy succeeds but the custom domain cannot be created — either add the zone,
   or remove the `[[routes]]` block and use the default `*.workers.dev` URL.

2. **GitHub repo secrets** (Settings → Secrets and variables → Actions):

   | Secret | Value |
   | --- | --- |
   | `CLOUDFLARE_ACCOUNT_ID` | the account id that owns the `jxh.io` zone (Cloudflare dashboard → any domain → right sidebar → *Account ID*) |
   | `CLOUDFLARE_API_TOKEN` | an API token (create at *My Profile → API Tokens → Create Token → Custom token*) with the permissions below |

   **`CLOUDFLARE_API_TOKEN` permissions** (Custom token):

   - **Account** → *Workers Scripts* → **Edit** (deploy the worker + DO)
   - **Account** → *Account Settings* → **Read**
   - **Zone** → *Workers Routes* → **Edit** (bind the custom domain) — scope to
     the `jxh.io` zone
   - **Zone** → *Zone* → **Read** — scope to `jxh.io`
   - **Zone** → *DNS* → **Edit** — scope to `jxh.io` (the custom domain creates a
     DNS record)

   The standard **"Edit Cloudflare Workers"** token template covers the Workers +
   account scopes; add the Zone *Read* / *Workers Routes* / *DNS Edit* on
   `jxh.io` for the custom-domain binding.

3. **First deploy.** Push this directory to `main` (the workflow's `paths` filter
   includes `workers/signaling/**`), or trigger **Run workflow** manually. After
   it succeeds, `wss://signal.dash.jxh.io` is live and is already the default
   signaling URL in the app (`packages/authoring-ui/src/collab/signaling.ts`),
   with a public Yjs server kept as a secondary fallback.

## Notes

- The DO keeps **no durable storage** of its own; subscriptions live in memory +
  per-socket hibernation attachments, so the SQLite migration (`new_sqlite_classes`)
  only registers the class — it stores nothing.
- The signaling URL is user-editable in the app (Share dialog → Signaling-server
  field), so a session can point at any other y-webrtc-compatible server.
