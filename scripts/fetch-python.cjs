/**
 * Download the Python runtime that ships inside the app:
 *   - CPython (portable build from astral-sh/python-build-standalone)
 *   - uv (astral-sh/uv), the fast package and environment manager
 *   - ruff (astral-sh/ruff), the formatter behind "Format Document"
 *   - debugpy (microsoft/debugpy), the debugger; one pure-Python wheel that
 *     works with any interpreter the user picks
 * Each file is checked against its pinned SHA-256 before it is unpacked.
 *
 * Usage: node scripts/fetch-python.cjs [--platform win32|darwin|linux] [--arch x64|arm64]
 * Output: vendor/<os>-<arch>/python/…  and  vendor/<os>-<arch>/uv/…
 * (os uses electron-builder's names: win, mac, linux; see package.json extraResources)
 *
 * To upgrade: change the versions and hashes below (hashes are listed on the
 * GitHub release pages / API "digest" field).
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const PYTHON = { version: '3.12.16', build: '20261026' };
const UV = { version: '0.13.7' };
const RUFF = { version: '0.17.2' };
const DEBUGPY = {
  version: '1.8.22',
  file: 'debugpy-1.8.22-py2.py3-none-any.whl',
  url: 'https://files.pythonhosted.org/packages/56/3d/c7dc9f35bc9e22cdb53679f844bee40fd5cff871862f60595869a433400d/debugpy-1.8.22-py2.py3-none-any.whl',
  sha256: 'a9e9d3550e15ca479c59333e90845029190531f0cacfedab3b815a57bd913947',
};

const TARGETS = {
  'win32-x64': {
    os: 'win',
    python: { file: `cpython-${PYTHON.version}+${PYTHON.build}-x86_64-pc-windows-msvc-install_only_stripped.tar.gz`, sha256: '1f2ab53880fc67ea323398c6388e05af28addc99a8e389209f08a51fdff4b149' },
    uv: { file: 'uv-x86_64-pc-windows-msvc.zip', sha256: '0cdc5b38fe5a8168ed6a25814f5ba43c21d313dd3187314fccb37b7cec46e021' },
    ruff: { file: 'ruff-x86_64-pc-windows-msvc.zip', sha256: '6f4de58abd7c8de2e8702a89fc0f221e6ca858ad23e25c658c707d83a48c79a0' },
  },
  'darwin-arm64': {
    os: 'mac',
    python: { file: `cpython-${PYTHON.version}+${PYTHON.build}-aarch64-apple-darwin-install_only_stripped.tar.gz`, sha256: '353d5f1b4fd2715e7053f12f068435d5bbad16b91e057006b5d01e0925709a7e' },
    uv: { file: 'uv-aarch64-apple-darwin.tar.gz', sha256: '81b811b57e4624df7ed3aac148e0359100d9962f3d9dce00aec533dc2e086731' },
    ruff: { file: 'ruff-aarch64-apple-darwin.tar.gz', sha256: '94fbca85f19e8b6bb068adb7cbc9a74e3e6c01004cc67c6b00246a094ad4ccd9' },
  },
  'darwin-x64': {
    os: 'mac',
    python: { file: `cpython-${PYTHON.version}+${PYTHON.build}-x86_64-apple-darwin-install_only_stripped.tar.gz`, sha256: '37c38fda76fec1fbf310adcbafb7f0d96af13b5511bf8ea954c3aa8eec185734' },
    uv: { file: 'uv-x86_64-apple-darwin.tar.gz', sha256: '20c47e4c1f630b8abaff8c291fa9b9aa300fef92c4fbff95adf198b55287cda7' },
    ruff: { file: 'ruff-x86_64-apple-darwin.tar.gz', sha256: 'db57a84e385435a2c4a7c8946e588f79b9de0851d8618a1b5d4431edfff0bf01' },
  },
  'linux-x64': {
    os: 'linux',
    python: { file: `cpython-${PYTHON.version}+${PYTHON.build}-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz`, sha256: 'ce4f6d0a6cfdb3bed6e44c2f9affd85943c76a42e25ad3a259002f31d6fb8a20' },
    uv: { file: 'uv-x86_64-unknown-linux-gnu.tar.gz', sha256: 'c5221ff41b7892bfc223543883600125f6a47fe845093e0f5bdff4f359196d83' },
    ruff: { file: 'ruff-x86_64-unknown-linux-gnu.tar.gz', sha256: '7b2e6a6e132ecf7b5fe726163b186d5d209befe93bb25f83767b2d97fbdf14e5' },
  },
};

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const platform = arg('platform', process.platform);
const arch = arg('arch', process.arch);
const target = TARGETS[`${platform}-${arch}`];
if (!target) {
  console.error(`No bundled Python for ${platform}-${arch}.`);
  process.exit(1);
}

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'vendor', `${target.os}-${arch}`);
const stamp = path.join(outDir, 'versions.json');
const wanted = { python: `${PYTHON.version}+${PYTHON.build}`, uv: UV.version, ruff: RUFF.version, debugpy: DEBUGPY.version };

function download(url, dest, redirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'theta172-build' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(download(res.headers.location, dest, redirects - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} for ${url}`)); }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    }).on('error', reject);
  });
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** tar (bsdtar on Windows 10+) unpacks both .tar.gz and .zip */
function extract(archive, dest) {
  fs.mkdirSync(dest, { recursive: true });
  // On Windows use the system tar (bsdtar); Git's GNU tar reads "D:" as a remote host
  const winTar = process.env.SystemRoot && path.join(process.env.SystemRoot, 'System32', 'tar.exe');
  const tar = process.platform === 'win32' && winTar && fs.existsSync(winTar) ? winTar : 'tar';
  execFileSync(tar, ['-xf', archive, '-C', dest], { stdio: 'inherit' });
}

async function fetchOne(kind, url, spec, dest) {
  const tmp = path.join(outDir, `.${spec.file}`);
  console.log(`Downloading ${kind}: ${spec.file}`);
  await download(url, tmp);
  const got = sha256(tmp);
  if (got !== spec.sha256) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`Checksum mismatch for ${spec.file}\n  expected ${spec.sha256}\n  got      ${got}`);
  }
  fs.rmSync(dest, { recursive: true, force: true });
  extract(tmp, dest);
  fs.rmSync(tmp, { force: true });
}

(async () => {
  let have = {};
  try {
    have = JSON.parse(fs.readFileSync(stamp, 'utf8'));
    if (have.python === wanted.python && have.uv === wanted.uv && have.ruff === wanted.ruff && have.debugpy === wanted.debugpy) {
      console.log(`Bundled Python ${have.python}, uv ${have.uv} and ruff ${have.ruff} already present in ${path.relative(root, outDir)}`);
      return;
    }
  } catch (_) { /* not fetched yet */ }

  fs.mkdirSync(outDir, { recursive: true });
  const pbs = `https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON.build}/${encodeURIComponent(target.python.file)}`;
  const uv = `https://github.com/astral-sh/uv/releases/download/${UV.version}/${target.uv.file}`;

  // The Python archive unpacks to a "python" folder
  const fetchPython = async () => {
    await fetchOne('Python', pbs, target.python, path.join(outDir, '.python-tmp'));
    fs.rmSync(path.join(outDir, 'python'), { recursive: true, force: true });
    fs.renameSync(path.join(outDir, '.python-tmp', 'python'), path.join(outDir, 'python'));
    fs.rmSync(path.join(outDir, '.python-tmp'), { recursive: true, force: true });
  };

  // uv and ruff unpack either flat (Windows zip) or into a <tool>-<target> folder
  const flatten = (tool) => {
    const dir = path.join(outDir, tool);
    const nested = fs.readdirSync(dir).find((n) => n.startsWith(`${tool}-`));
    if (!nested) return;
    for (const f of fs.readdirSync(path.join(dir, nested))) fs.renameSync(path.join(dir, nested, f), path.join(dir, f));
    fs.rmSync(path.join(dir, nested), { recursive: true, force: true });
  };
  if (have.python !== wanted.python || have.uv !== wanted.uv || !fs.existsSync(path.join(outDir, 'python'))) {
    await fetchPython();
    await fetchOne('uv', uv, target.uv, path.join(outDir, 'uv'));
    flatten('uv');
  }
  if (have.ruff !== wanted.ruff || !fs.existsSync(path.join(outDir, 'ruff'))) {
    const ruff = `https://github.com/astral-sh/ruff/releases/download/${RUFF.version}/${target.ruff.file}`;
    await fetchOne('ruff', ruff, target.ruff, path.join(outDir, 'ruff'));
    flatten('ruff');
  }
  // A wheel is a zip: unpacked, the folder holds the debugpy package itself
  await fetchOne('debugpy', DEBUGPY.url, DEBUGPY, path.join(outDir, 'debugpy'));
  for (const extra of fs.readdirSync(path.join(outDir, 'debugpy'))) {
    if (extra.endsWith('.dist-info')) fs.rmSync(path.join(outDir, 'debugpy', extra), { recursive: true, force: true });
  }
  // Precompile debugpy so the first debug session doesn't spend seconds compiling
  // (only possible when building for this machine's platform)
  if (platform === process.platform && arch === process.arch) {
    const py = platform === 'win32' ? path.join(outDir, 'python', 'python.exe') : path.join(outDir, 'python', 'bin', 'python3');
    execFileSync(py, ['-m', 'compileall', '-q', '-j', '0', path.join(outDir, 'debugpy')], { stdio: 'inherit' });
  }

  fs.writeFileSync(stamp, JSON.stringify(wanted, null, 2));
  console.log(`Ready: ${path.relative(root, outDir)} (Python ${wanted.python}, uv ${wanted.uv}, ruff ${wanted.ruff}, debugpy ${wanted.debugpy})`);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
