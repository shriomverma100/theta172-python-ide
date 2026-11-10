/**
 * THETA172 — Classroom Relay Server (Docker / any Node.js host)
 *
 * Lets a teacher and students connect with a short join code from ANY
 * network (different Wi-Fi, mobile hotspot, home). Both sides open an
 * outbound WebSocket to this server, so no port forwarding is needed.
 *
 * The rules live in relay-core.cjs, shared with the Cloudflare relay and
 * the app's built-in school relay. In this repository they sit in
 * ../electron; the folder the app exports for Docker has them next to this
 * file.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const local = path.join(__dirname, 'relay-node.cjs');
const { createRelayServer } = require(fs.existsSync(local) ? local : path.join(__dirname, '..', 'electron', 'relay-node.cjs'));

const PORT = Number(process.env.PORT) || 8787;
const relay = createRelayServer({ trustProxy: process.env.TRUST_PROXY !== '0' });

/** Start listening (tests pass 0 for any free port). Resolves with the port. */
const listen = (port = PORT) => relay.listen(port);

if (require.main === module) {
  listen().then((p) => console.log(`[relay] THETA172 classroom relay listening on :${p}`));
  const stop = () => relay.close().then(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

module.exports = { server: relay.server, wss: relay.wss, rooms: relay.relay.rooms, listen, close: relay.close };
