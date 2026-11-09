/**
 * Screenshot tour for design review (npm run shots). Only loaded when
 * THETA_SMOKE=1 and THETA_SHOTS=<dir> are set; never in a normal launch.
 * Drives the real UI through each screen and saves PNGs at the device
 * scale factor given by THETA_SCALE (1, 1.25, 1.5 ...).
 */
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const waitFor = (cond) => `for (let i = 0; i < 60 && !(${cond}); i++) await new Promise(r => setTimeout(r, 100));`;
const RUN = `document.getElementById('btn-run').click(); ${waitFor("/Done|Error/.test(document.getElementById('run-status-text').textContent)")}`;

// The live dashboards need a real network session, so the tour fills them
// with sample rows (design preview only).
const SAMPLE_DASHBOARD = `
  document.getElementById('cr-teacher-setup').classList.add('hidden');
  document.getElementById('cr-live-view').classList.remove('hidden');
  document.getElementById('cr-live-teacher-name').textContent = 'Ms. Sharma';
  document.getElementById('cr-student-count-badge').textContent = '3';
  document.getElementById('cr-status').textContent = 'Live on 192.168.1.20';
  const rows = [['Aarav Gupta', '12', true], ['Diya Nair', '07', false], ['Kabir Singh', '21', false]];
  document.getElementById('cr-students-list').innerHTML = rows.map(([n, r, h]) =>
    '<div class="cr-student-item' + (h ? ' help' : '') + '"><div class="cr-student-info"><span class="cr-student-name">' + n +
    '</span><span class="cr-student-roll">Roll ' + r + '</span></div><div class="cr-student-badges">' +
    (h ? '<span class="cr-badge cr-badge--alert">Needs help</span>' : '') +
    '</div><button class="cr-view-btn" type="button">View code</button></div>').join('');
  document.getElementById('cr-teacher-chat-messages').innerHTML =
    '<div class="cr-chat-message"><div class="cr-chat-meta">Aarav Gupta</div><div class="cr-chat-text">My loop prints the same number every time</div></div>' +
    '<div class="cr-chat-message self"><div class="cr-chat-meta">You</div><div class="cr-chat-text">Check where you update i inside the loop</div></div>';
`;

const SCENES = [
  { name: '01-boot', wait: 350 },
  { name: '02-picker', wait: 4500 },
  { name: '03-play-ide', js: `document.querySelector('[data-pick="playground"]').click()`, wait: 900 },
  {
    name: '04-play-run',
    js: `(async () => {
      window.__thetaTest.setCode('nums = [3, 1, 2]\\nprint(sorted(nums))\\nprint("mean", sum(nums) / len(nums))\\n');
      ${RUN}
    })()`,
    wait: 300,
  },
  {
    name: '05-play-error',
    js: `(async () => {
      window.__thetaTest.setCode('def ratio(a, b):\\n    return a / b\\n\\nprint(ratio(4, 0))\\n');
      await new Promise(r => setTimeout(r, 1300));
      ${RUN}
    })()`,
    wait: 300,
  },
  { name: '06-play-settings', js: `document.getElementById('btn-settings').click()`, wait: 300 },
  { name: '07-play-classroom', js: `document.getElementById('close-settings').click(); document.getElementById('btn-class-tile').click()`, wait: 1700 },
  { name: '08-play-teacher', js: `document.querySelector('[data-role="teacher"]').click()`, wait: 400 },
  { name: '09-play-dashboard', js: SAMPLE_DASHBOARD, wait: 400 },
  { name: '10-switching', js: `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); setTimeout(() => document.querySelector('.ide-topbar [data-theme-choice="pro"]').click(), 1400)`, wait: 1900 },
  { name: '11-pro-ide', wait: 1500 },
  {
    name: '12-pro-run',
    js: `(async () => {
      window.__thetaTest.setCode('nums = [3, 1, 2]\\nprint(sorted(nums))\\nprint("mean", sum(nums) / len(nums))\\n');
      ${RUN}
    })()`,
    wait: 300,
  },
  { name: '13-pro-palette', js: `document.getElementById('btn-palette').click()`, wait: 300 },
  { name: '14-pro-settings', js: `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.getElementById('rail-settings').click()`, wait: 300 },
  { name: '15-pro-classroom', js: `document.getElementById('close-settings').click(); document.getElementById('rail-classroom').click()`, wait: 1700 },
];

function attachShots(win, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const scale = process.env.THETA_SCALE || '1';
  win.webContents.on('console-message', (...args) => {
    const d = args[0] && typeof args[0] === 'object' && 'message' in args[0] ? args[0] : { level: args[1], message: args[2] };
    if (d.level === 'error' || d.level === 3) console.error('renderer Error: ' + d.message);
  });
  win.webContents.once('did-finish-load', async () => {
    try {
      for (const scene of SCENES) {
        if (scene.js) {
          try { await win.webContents.executeJavaScript(scene.js); }
          catch (err) { console.error(`shots failed in ${scene.name}: ${err.message}`); }
        }
        await sleep(scene.wait || 0);
        const img = await win.webContents.capturePage();
        const file = path.join(dir, `${scene.name}@${scale}x.png`);
        fs.writeFileSync(file, img.toPNG());
        console.log('THETA_SHOT ' + file);
      }
      const stats = await win.webContents.executeJavaScript('window.__thetaTest?.fxStats?.() ?? null', true);
      console.log('THETA_FX_STATS ' + JSON.stringify(stats));
      await win.webContents.executeJavaScript("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
      await sleep(1500);
      const bench = await win.webContents.executeJavaScript('window.__thetaTest?.fxBench?.() ?? null');
      console.log('THETA_FX_BENCH ' + JSON.stringify(bench));
    } catch (err) {
      console.error('shots failed', err);
    }
    win.destroy();
    process.exit(0);
  });
}

module.exports = { attachShots };
