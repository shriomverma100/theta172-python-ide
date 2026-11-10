/**
 * THETA172 — the classroom relay on Node.js.
 *
 * The same rules as the Cloudflare relay (relay-core.cjs) behind an HTTP +
 * WebSocket server. Used by the Docker relay (relay-server/server.js) and by
 * "this computer is the school relay" inside the app.
 *
 * Any WebSocket path is accepted (/host, /room/CODE, /): the paths only
 * matter on Cloudflare, where they pick the class's Durable Object.
 */

'use strict';

const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const { createRelay, RELAY_LIMITS } = require('./relay-core.cjs');

const HEARTBEAT_MS = 25_000; // keeps proxies and home routers from dropping quiet sockets

function clientIp(req, trustProxy) {
  // Behind a reverse proxy (Render, Fly, nginx) the real address is in X-Forwarded-For
  const fwd = req.headers['x-forwarded-for'];
  if (trustProxy && typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

/**
 * @param {{ trustProxy?: boolean }} [opts]
 * @returns {{ server: http.Server, wss: WebSocketServer, relay: object, listen: (port?: number, host?: string) => Promise<number>, close: () => Promise<void>, stats: () => object }}
 */
function createRelayServer(opts = {}) {
  const trustProxy = opts.trustProxy !== false;
  const relay = createRelay();
  const startedAt = Date.now();

  const server = http.createServer((req, res) => {
    const path = (req.url || '/').split('?')[0];
    if (path === '/health' || path.endsWith('/health')) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, relay: 'theta172', version: 2, rooms: relay.rooms.size }));
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('THETA172 classroom relay\n');
  });

  const wss = new WebSocketServer({ server, maxPayload: RELAY_LIMITS.MAX_PAYLOAD });

  wss.on('connection', (ws, req) => {
    ws.ip = clientIp(req, trustProxy);
    ws.role = null;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (raw, isBinary) => {
      if (isBinary || ws.readyState !== WebSocket.OPEN) return;
      relay.message(ws, raw.toString());
    });
    ws.on('close', () => relay.closed(ws));
    ws.on('error', () => {});
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch (_) { /* gone */ }
    }
    relay.sweep();
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  const listen = (port = 8787, host) => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });

  const close = () => new Promise((resolve) => {
    clearInterval(heartbeat);
    for (const room of [...relay.rooms.values()]) relay.endRoom(room);
    for (const ws of wss.clients) { try { ws.terminate(); } catch (_) { /* gone */ } }
    wss.close();
    server.close(() => resolve());
    setTimeout(resolve, 1500).unref?.();
  });

  const stats = () => {
    let students = 0;
    for (const room of relay.rooms.values()) for (const seat of room.students.values()) if (seat.ws) students++;
    return { classes: relay.rooms.size, students, upSince: startedAt };
  };

  return { server, wss, relay, listen, close, stats };
}

module.exports = { createRelayServer };
