/**
 * THETA172 — the classroom relay on Cloudflare Workers.
 *
 * The app uploads this file with relay-core.cjs pasted in front of it (one
 * ES module, "worker.js"). Each class is one Durable Object, named by its
 * join code, so a class lives on one Cloudflare machine near the teacher
 * and classes never share a machine's limits.
 *
 *   GET  /health          → { ok, relay: 'theta172', version }
 *   WS   /host            → a new class (a fresh code picks the object)
 *   WS   /room/K7M4QX     → join or resume that class
 */

/* global createRelay, relayNormalizeCode, relayNewCode, Response, Request, URL, WebSocketPair, setInterval, clearInterval */

const PING_MS = 25000; // Cloudflare cannot send WebSocket pings; the app counts any message as a sign of life

export class ClassRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.relay = null;
    this.sockets = new Set();
    this.pinger = null;
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const code = request.headers.get('X-Theta-Code') || '';
    if (!this.relay) this.relay = createRelay({ fixedCode: code });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    const sock = {
      ip: request.headers.get('CF-Connecting-IP') || 'unknown',
      closed: false,
      role: null,
      send: (text) => server.send(text),
      close: (c, reason) => {
        this.sockets.delete(sock);
        try { server.close(c, reason); } catch (_) { /* already closed */ }
      },
    };
    this.sockets.add(sock);

    const gone = () => {
      if (sock.closed) return;
      this.sockets.delete(sock);
      this.relay.closed(sock);
      try { server.close(1000, 'bye'); } catch (_) { /* already closed */ }
      if (!this.sockets.size) this.stopPing();
    };
    server.addEventListener('message', (event) => {
      if (typeof event.data === 'string') this.relay.message(sock, event.data);
    });
    server.addEventListener('close', gone);
    server.addEventListener('error', gone);

    this.startPing();
    return new Response(null, { status: 101, webSocket: client });
  }

  startPing() {
    if (this.pinger) return;
    this.pinger = setInterval(() => {
      for (const sock of this.sockets) {
        try { sock.send('{"t":"ping"}'); } catch (_) { /* gone */ }
      }
      this.relay?.sweep();
    }, PING_MS);
  }

  stopPing() {
    clearInterval(this.pinger);
    this.pinger = null;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');
    if (path === '/health' || path === '') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response(JSON.stringify({ ok: true, relay: 'theta172', version: 2 }), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
        });
      }
    }
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('THETA172 classroom relay\n');

    let code = '';
    if (path.endsWith('/host')) {
      code = relayNewCode(() => false);
    } else {
      const m = path.match(/\/room\/([A-Za-z0-9-]{3,12})$/);
      code = m ? relayNormalizeCode(m[1]) : '';
    }
    if (!code || code.length !== 6) return new Response('Unknown class address', { status: 404 });

    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    const forward = new Request(request);
    forward.headers.set('X-Theta-Code', code);
    return stub.fetch(forward);
  },
};
