# THETA172 classroom relay

The relay connects a teacher and students who are **not on the same network**
(different Wi-Fi, mobile data, home connections). Teacher and students each
open an outgoing secure WebSocket to it, so no ports need opening at school
or at home. On the same Wi-Fi the apps connect directly and the relay is only
a fallback.

It only routes messages for a class (a 6-letter join code). It stores nothing
on disk and keeps a class for 60 seconds while the teacher reconnects, and a
student's seat for 45 seconds.

The easiest way to run a relay is from the app: **Classroom → Start a class →
No relay yet? Set one up** puts it on a free Cloudflare account, or runs it in
Docker. See [docs/relay-setup.md](../docs/relay-setup.md).

The relay's rules live in `electron/relay-core.cjs` (shared with the Cloudflare
relay). `server.js` finds them in `../electron`; the folder the app exports for
Docker has them next to it.

## Run it

```sh
cd relay-server
npm install
npm start            # listens on PORT (default 8787)
```

`GET /health` answers `{ "ok": true, "relay": "theta172", "rooms": N }`.

## Host it

Any host that runs Node 18+ or Docker and gives you **HTTPS** works (Render,
Railway, Fly.io, a small VPS behind Caddy or nginx). Use the `wss://` address
in the app: under **Classroom → Start a class → From anywhere, with our school's
relay**, or set `THETA_RELAY_URL` for every installation.

Docker:

```sh
docker build -t theta172-relay relay-server
docker run -p 8787:8787 theta172-relay
```

Behind a reverse proxy, forward WebSocket upgrades and keep idle connections
open for at least 60 seconds (the relay pings every 25 seconds).

## Limits (in `electron/relay-core.cjs`)

- 200 students per class, 5000 classes, 1 MB per message
- 150 messages per second per connection (bursts are dropped, not disconnected)
- 20 wrong codes and 10 new classes per IP per minute
