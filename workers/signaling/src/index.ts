/**
 * Cloudflare Worker + Durable Object: a y-webrtc signaling server.
 *
 * This is a DROP-IN replacement for the upstream y-webrtc one-file Node
 * signaling server (`y-webrtc/bin/server.js`) running serverlessly on
 * Cloudflare. The browser client stays STOCK y-webrtc — it just points its
 * signaling URL at `wss://signal.dash.jxh.io`, which this worker serves.
 *
 * Why a Durable Object: a y-webrtc room's peers find each other by SUBSCRIBING
 * to a shared topic and PUBLISHING handshake messages that the server fans out
 * to the other subscribers. That requires cross-connection state (topic →
 * subscribers) and cross-connection fan-out, which a plain stateless Worker
 * cannot do — each request would hit a different isolate. A single global
 * Durable Object (`idFromName('signaling')`) owns ALL WebSockets and the
 * subscription table, so every peer signals through the same instance.
 *
 * Hibernation: we use the DO **WebSocket Hibernation API**
 * (`state.acceptWebSocket` + the `webSocketMessage`/`webSocketClose`/
 * `webSocketError` handlers). This lets the runtime evict the DO from memory
 * while sockets stay open and only revive it on activity, so an idle room costs
 * nothing. Because the in-memory relay map is lost across hibernation, we
 * RECONSTRUCT each connection's subscriptions on demand from per-socket
 * serialized attachments (the topics it subscribed to), kept in sync via
 * `ws.serializeAttachment`. We also use the runtime's auto-response ping/pong so
 * keepalive never wakes the DO.
 *
 * The pub/sub fan-out semantics live in `relay.ts` (a pure, Cloudflare-free
 * module) so they are unit-testable without any CF runtime or credentials.
 */

import {
  LIMITS,
  SignalingRelay,
  frameByteLength,
  isOriginAllowed,
  parseAllowedOrigins,
  parseSignalingFrame,
  type SignalingMessage,
} from "./relay.js";

/**
 * Bindings declared in wrangler.toml.
 *
 * `ALLOWED_ORIGINS` is an optional plain-text var: a comma/space-separated
 * allowlist of WebSocket `Origin`s permitted to upgrade (e.g. the dash app
 * origin). Empty / unset / `*` = allow any origin (the open y-webrtc default).
 * See README.md and docs/37-collab.md for how to configure it.
 */
export interface Env {
  SIGNALING: DurableObjectNamespace;
  ALLOWED_ORIGINS?: string;
}

/** Per-socket attachment we persist so subscriptions survive hibernation. */
interface SocketState {
  /** Stable connection id (mirrors the relay's connId). */
  id: string;
  /** Topics this socket is subscribed to. */
  topics: string[];
  /** Originating client IP (cf-connecting-ip), for the per-IP connection cap. */
  ip?: string;
}

const PING_TIMEOUT_MS = 30_000;

/** WebSocket close code for a message too big to process (per RFC 6455). */
const CLOSE_MESSAGE_TOO_BIG = 1009;

/**
 * The single global signaling Durable Object: owns every WebSocket and the
 * topic→subscribers table; relays publishes between subscribers.
 */
export class SignalingServer {
  private readonly state: DurableObjectState;
  /** The parsed Origin allowlist (from `env.ALLOWED_ORIGINS`). */
  private readonly allowedOrigins: string[];
  /**
   * The pub/sub relay. After a hibernation wake this starts empty and is
   * rehydrated lazily from each live socket's serialized attachment.
   */
  private relay = new SignalingRelay();
  private rehydrated = false;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS);
    // Auto-respond to native WebSocket pings without waking the DO. (y-webrtc's
    // own JSON {type:'ping'} keepalive is still handled in webSocketMessage; this
    // covers the protocol-level ping the runtime/clients may also use.)
    try {
      this.state.setWebSocketAutoResponse(
        new WebSocketRequestResponsePair(
          JSON.stringify({ type: "ping" }),
          JSON.stringify({ type: "pong" }),
        ),
      );
    } catch {
      // Older runtimes may not support auto-response; the JSON ping handler in
      // webSocketMessage still answers pings, so this is a best-effort optimization.
    }
  }

  /**
   * Rebuild the in-memory relay from the live sockets after a hibernation wake.
   * Each socket carries its own subscription list in its serialized attachment.
   */
  private rehydrate(): void {
    if (this.rehydrated) return;
    this.rehydrated = true;
    this.relay = new SignalingRelay();
    for (const ws of this.state.getWebSockets()) {
      const att = ws.deserializeAttachment() as SocketState | null;
      if (!att) continue;
      this.relay.addConnection(att.id);
      if (att.topics.length > 0) {
        this.relay.handleMessage(att.id, {
          type: "subscribe",
          topics: att.topics,
        });
      }
    }
  }

  /** Map a live WebSocket to its connection id (from its attachment). */
  private idOf(ws: WebSocket): string | null {
    const att = ws.deserializeAttachment() as SocketState | null;
    return att?.id ?? null;
  }

  /** Find the live WebSocket for a connection id (for relay fan-out). */
  private socketFor(connId: string): WebSocket | null {
    for (const ws of this.state.getWebSockets()) {
      const att = ws.deserializeAttachment() as SocketState | null;
      if (att?.id === connId) return ws;
    }
    return null;
  }

  /** Count live sockets globally and (optionally) for one client IP. */
  private connectionCounts(ip: string | null): {
    global: number;
    perIp: number;
  } {
    let global = 0;
    let perIp = 0;
    for (const ws of this.state.getWebSockets()) {
      global += 1;
      if (ip) {
        const att = ws.deserializeAttachment() as SocketState | null;
        if (att?.ip && att.ip === ip) perIp += 1;
      }
    }
    return { global, perIp };
  }

  /** HTTP entrypoint: upgrade GET requests to a hibernatable WebSocket. */
  async fetch(request: Request): Promise<Response> {
    const upgrade = request.headers.get("Upgrade");
    if (!upgrade || upgrade.toLowerCase() !== "websocket") {
      // A plain GET — answer like the upstream server's health check.
      return new Response("okay", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // ----- Origin allowlist (soft control; see relay.isOriginAllowed) -----
    // Reject upgrades from disallowed web origins BEFORE allocating a socket.
    // Origin is spoofable outside browsers, so this only deters casual
    // browser-based free-riding — the hard caps below are the real abuse bound.
    const origin = request.headers.get("Origin");
    if (!isOriginAllowed(origin, this.allowedOrigins)) {
      return new Response("origin not allowed", { status: 403 });
    }

    // ----- Connection caps (global + per-IP) — the hard DoS/cost bound. -----
    const ip = request.headers.get("cf-connecting-ip");
    const { global, perIp } = this.connectionCounts(ip);
    if (global >= LIMITS.MAX_CONNECTIONS_GLOBAL) {
      return new Response("too many connections", { status: 503 });
    }
    if (ip && perIp >= LIMITS.MAX_CONNECTIONS_PER_IP) {
      return new Response("too many connections from this client", {
        status: 429,
      });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // Accept with the Hibernation API so the DO can sleep with this socket open.
    this.state.acceptWebSocket(server);

    const id = crypto.randomUUID();
    const initial: SocketState = { id, topics: [], ip: ip ?? undefined };
    server.serializeAttachment(initial);

    this.rehydrate();
    this.relay.addConnection(id);
    // Idle-timeout keepalive: the runtime auto-responds to pings, but if a peer
    // goes silent we want the socket reaped. The hibernation timeout is governed
    // by the runtime; PING_TIMEOUT_MS documents the upstream cadence.
    void PING_TIMEOUT_MS;

    return new Response(null, { status: 101, webSocket: client });
  }

  /** Hibernation handler: a client sent a message. */
  async webSocketMessage(
    ws: WebSocket,
    data: string | ArrayBuffer,
  ): Promise<void> {
    this.rehydrate();
    const id = this.idOf(ws);
    if (id === null) return;

    // ----- Max message size — drop & close oversized frames. -----
    // A legit y-webrtc handshake frame is a few KB of JSON SDP/ICE; anything
    // past the cap is an abuse payload, so we close the offender gracefully
    // rather than fan it out.
    if (frameByteLength(data) > LIMITS.MAX_MESSAGE_BYTES) {
      try {
        ws.close(CLOSE_MESSAGE_TOO_BIG, "message too large");
      } catch {
        // already closed
      }
      return;
    }

    const message = parseSignalingFrame(data);
    if (!message) return;

    // Keep the per-socket attachment's topic list in sync so subscriptions
    // survive a future hibernation.
    if (message.type === "subscribe" || message.type === "unsubscribe") {
      this.updateAttachmentTopics(ws, id, message);
    }

    const out = this.relay.handleMessage(id, message);
    for (const { to, message: outMsg } of out) {
      const target = to === id ? ws : this.socketFor(to);
      this.trySend(target, outMsg);
    }
  }

  /** Hibernation handler: a client socket closed. */
  async webSocketClose(ws: WebSocket): Promise<void> {
    this.rehydrate();
    const id = this.idOf(ws);
    if (id !== null) this.relay.removeConnection(id);
    try {
      ws.close();
    } catch {
      // already closed
    }
  }

  /** Hibernation handler: a socket errored — clean up like a close. */
  async webSocketError(ws: WebSocket): Promise<void> {
    this.rehydrate();
    const id = this.idOf(ws);
    if (id !== null) this.relay.removeConnection(id);
  }

  /** Recompute & persist a socket's subscription set into its attachment. */
  private updateAttachmentTopics(
    ws: WebSocket,
    id: string,
    message: SignalingMessage,
  ): void {
    const att = (ws.deserializeAttachment() as SocketState | null) ?? {
      id,
      topics: [],
    };
    const set = new Set(att.topics);
    const topics = Array.isArray(message.topics) ? message.topics : [];
    for (const t of topics) {
      if (typeof t !== "string") continue;
      if (message.type === "subscribe") {
        // Honor the same per-connection topic cap the relay enforces, so the
        // hibernation-persisted topic list can never grow past it either.
        if (!set.has(t) && set.size >= LIMITS.MAX_TOPICS_PER_CONNECTION) continue;
        set.add(t);
      } else {
        set.delete(t);
      }
    }
    ws.serializeAttachment({ id, topics: [...set], ip: att.ip });
  }

  /** Send a JSON message to a socket, swallowing errors on a dead socket. */
  private trySend(ws: WebSocket | null, message: SignalingMessage): void {
    if (!ws) return;
    try {
      ws.send(JSON.stringify(message));
    } catch {
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
  }
}

/** Worker entrypoint: route every request to the single global signaling DO. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const id = env.SIGNALING.idFromName("signaling");
    const stub = env.SIGNALING.get(id);
    return stub.fetch(request);
  },
};
