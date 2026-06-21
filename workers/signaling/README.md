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

It **does observe** (the inherent signaling-server metadata scope):

- the **room id** — y-webrtc uses the room name as the pub/sub **topic**, sent in
  plaintext over the WebSocket on subscribe/publish. It is a 128-bit random token
  (not a guessable name), but the relay does see it.
- **peer IPs** — inherent to any WebRTC signaling/relay server.

With CF `[observability]` enabled (see `wrangler.toml`), the Cloudflare platform
also records sampled request metadata + uncaught exceptions; the worker's own
code logs nothing (no `console.*`). See docs/37-collab.md for the full privacy
scope.

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

## Abuse hardening (open-relay bounds)

This worker is the **default, self-deployed** signaling endpoint the deployer
pays for, so — unlike a conventional public y-webrtc relay, which is wide open —
it ships with **hard caps** that keep an anonymous open relay from being abused
as a free pub/sub bus or a DoS / Cloudflare-billing amplifier. None of these
change the y-webrtc protocol; they only refuse work a legitimate stock client
never does (a real room is a few peers on one topic exchanging small JSON frames),
and offenders are dropped/closed **gracefully** so a normal client is unaffected.

The numeric limits are constants in **`src/relay.ts` (`LIMITS`)** — the single
place to tune them:

| Guard | Default | Effect when exceeded |
| --- | --- | --- |
| `MAX_CONNECTIONS_GLOBAL` | 2000 | upgrade rejected with HTTP **503** |
| `MAX_CONNECTIONS_PER_IP` | 50 | upgrade rejected with HTTP **429** (uses `cf-connecting-ip`) |
| `MAX_TOPICS_PER_CONNECTION` | 50 | extra `subscribe` topics silently ignored |
| `MAX_SUBSCRIBERS_PER_TOPIC` | 100 | extra subscribers to a full room silently ignored |
| `MAX_MESSAGE_BYTES` | 65536 (64 KiB) | frame dropped, socket closed (WS code **1009**) |
| `PUBLISH_BURST` / `PUBLISH_REFILL_PER_SEC` | 60 / 20 per s | publishes past the per-connection token-bucket rate are dropped |

### Origin allowlist (soft control)

The WebSocket **Upgrade `Origin`** is validated against an allowlist before a
socket is accepted, configurable via the `ALLOWED_ORIGINS` wrangler var (a comma-
or space-separated list of origins):

- **Empty / unset / `"*"`** → **any** origin is allowed (the open y-webrtc
  default; the hard caps above are then the sole abuse bound). This is the
  shipped default so deploying never silently breaks a stock client.
- **A non-empty list** → only those origins may connect; a disallowed browser
  Origin is rejected with **HTTP 403**.

To restrict the relay to your app origin(s), set the var in `wrangler.toml`:

```toml
[vars]
ALLOWED_ORIGINS = "https://dash.jxh.io, http://localhost:1420"
```

Add each new origin to the comma-separated list and re-deploy to apply.

**Origin is a soft, spoofable, browser-only control** — a non-browser client can
omit or forge it, so an `Origin`-less request is allowed even with a non-empty
list (the goal is to deter casual third-party WEB pages from embedding the
relay). The hard rate/size/connection caps + the client-side E2E encryption are
what actually bound abuse and protect confidentiality.

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
