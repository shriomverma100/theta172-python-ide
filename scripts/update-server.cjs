/**
 * A pretend release server, to try updates on this PC without publishing.
 *
 *   1. Build a newer installer:   npx electron-builder --win nsis --x64 --publish never -c.extraMetadata.version=9.9.9
 *   2. Serve it:                  npm run update-server            (serves release/ on port 8123)
 *   3. Start the app against it:  THETA_UPDATE_URL=http://127.0.0.1:8123/ npm run electron:preview
 *
 * The app finds latest.yml, downloads the installer (checking its sha512),
 * shows the "New update available" card and the updating screen.
 * Options: --dir <folder> --port <n> --notes "text" (notes appear in the card; add [critical] to try that).
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const dir = path.resolve(arg('dir', path.join(__dirname, '..', 'release')));
const port = Number(arg('port', 8123));
const notes = arg('notes', '- Faster start\n- New Python cards on the updating screen\n- Fixes for the classroom relay');
const throttle = Number(arg('kbps', 0)); // slow the download to watch the progress (KB/s, 0 = full speed)

const server = http.createServer((req, res) => {
  const name = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '');
  console.log(new Date().toISOString().slice(11, 19), req.method, `/${name}`);
  if (name === 'latest.yml') {
    const file = path.join(dir, 'latest.yml');
    if (!fs.existsSync(file)) { res.writeHead(404); res.end('no latest.yml'); return; }
    // Add release notes the way GitHub would
    let yml = fs.readFileSync(file, 'utf8').replace(/\nreleaseNotes:[\s\S]*$/, '\n');
    yml += `releaseNotes: |\n${notes.split('\n').map((l) => `  ${l}`).join('\n')}\n`;
    res.writeHead(200, { 'Content-Type': 'text/yaml' });
    res.end(yml);
    return;
  }
  const file = path.join(dir, name);
  if (!name || name.includes('..') || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  const size = fs.statSync(file).size;
  // Range requests: differential downloads ask for parts of the file
  const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
  const start = range ? Number(range[1]) : 0;
  const end = range && range[2] ? Number(range[2]) : size - 1;
  res.writeHead(range ? 206 : 200, {
    'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Content-Type': 'application/octet-stream',
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
  });
  const stream = fs.createReadStream(file, { start, end });
  if (!throttle) { stream.pipe(res); return; }
  stream.on('data', (chunk) => { stream.pause(); res.write(chunk); setTimeout(() => stream.resume(), (chunk.length / 1024 / throttle) * 1000); });
  stream.on('end', () => res.end());
});

server.listen(port, '127.0.0.1', () => console.log(`Update server: http://127.0.0.1:${port}/ serving ${dir}`));
