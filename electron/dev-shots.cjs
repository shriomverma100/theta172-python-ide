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

// Phase 3 tour: THETA_SHOTS_SET=python
const OPEN_PICKER = `document.querySelector('#runbar-runtime').offsetParent ? document.getElementById('runbar-runtime').click() : document.querySelector('.ide-statusbar [data-interpreter]').click()`;
const ESC_PICKER = `document.querySelector('.quick-pick .cmd-input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`;
// Waits for this run's fix bar (the status pill may still show the last error)
const runImport = (mod) => `
  window.__thetaTest.setCode('import ${mod}\\n\\nprint(${mod}.__name__)\\n');
  await new Promise(r => setTimeout(r, 400));
  document.getElementById('btn-run').click();
  ${waitFor(`!document.getElementById('fix-bar').classList.contains('hidden') && document.getElementById('fix-bar-text').textContent.includes('${mod}')`)}`;
const fixScene = (mod) => `(async () => { ${runImport(mod)} })()`;
const PY_SCENES = [
  { name: 'p01-picker', wait: 4500 },
  { name: 'p02-play-ide', js: `document.querySelector('[data-pick="playground"]').click()`, wait: 1200 },
  { name: 'p03-play-interpreters', js: OPEN_PICKER, wait: 700 },
  { name: 'p04-play-packages', js: `${ESC_PICKER}; document.getElementById('pip-list-btn').click()`, wait: 1500 },
  { name: 'p05-play-fixbar', js: `document.getElementById('pip-packages-close').click(); ${fixScene('cv2')}`, wait: 400 },
  { name: 'p06-play-unknown', js: fixScene('helpers2'), wait: 400 },
  {
    name: 'p07-play-installed',
    js: `(async () => {
      ${runImport('yaml')}
      await new Promise(r => setTimeout(r, 400));
      document.getElementById('fix-bar-install').click();
      ${waitFor("/Run again/.test(document.getElementById('fix-bar-install').textContent)")}
    })()`,
    wait: 400,
  },
  { name: 'p08-switching', js: `document.querySelector('.ide-topbar [data-theme-choice="pro"]').click()`, wait: 3000 },
  { name: 'p09-pro-interpreters', js: OPEN_PICKER, wait: 700 },
  { name: 'p10-pro-packages', js: `${ESC_PICKER}; document.getElementById('pip-list-btn').click()`, wait: 1500 },
  { name: 'p11-pro-fixbar', js: `document.getElementById('pip-packages-close').click(); ${fixScene('sklearn')}`, wait: 400 },
];

// Phase 4 tour: THETA_SHOTS_SET=lsp
const LSP_CODE = 'import json\\nfrom src.helpers import add\\n\\n\\ndef greet(name: str) -> str:\\n    return "Hi " + name\\n\\n\\ntotal = add(40, 2)\\nprint(greet(total))\\nprint(undefined_name)\\njson.du';
const LSP_SETUP = `(async () => {
  const t = window.__thetaTest;
  ${waitFor('window.__thetaTest.lspReady()')}
  [...document.querySelectorAll('#ws-tree .ws-row')].find((r) => r.dataset.path.endsWith('main.py'))?.click();
  await new Promise(r => setTimeout(r, 600));
  t.setCode('${LSP_CODE}');
  ${waitFor('window.__thetaTest.problems().errors >= 2')}
  await new Promise(r => setTimeout(r, 400));
})()`;
const COMPLETE = `(async () => {
  window.__thetaTest.cursorTo('json.du', 7);
  window.__thetaTest.complete();
  ${waitFor("document.querySelector('.cm-tooltip-autocomplete li')")}
})()`;
const HOVER = `(async () => {
  document.querySelector('.cm-content').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const view = document.querySelector('.cm-content');
  const at = window.__thetaTest.coordsOf('greet(name', 2);
  if (at) {
    const opts = { bubbles: true, clientX: at.x, clientY: at.y };
    view.dispatchEvent(new MouseEvent('mousemove', opts));
    await new Promise(r => setTimeout(r, 60));
    view.dispatchEvent(new MouseEvent('mousemove', opts));
  }
  ${waitFor("document.querySelector('.cm-tooltip-hover')")}
})()`;
const RENAME = `(async () => {
  document.querySelector('.cm-content').dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 5, clientY: 5 }));
  window.__thetaTest.cursorTo('greet(total', 2);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
  ${waitFor("document.querySelector('.quick-pick .cmd-input')")}
  const box = document.querySelector('.quick-pick .cmd-input');
  box.value = 'welcome';
  box.dispatchEvent(new Event('input', { bubbles: true }));
})()`;
const LIBRARY = `(async () => {
  document.querySelector('.quick-pick .cmd-input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  window.__thetaTest.cursorTo('json.du', 1);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12', bubbles: true }));
  ${waitFor("/__init__/.test(window.__thetaTest.activeTab() || '')")}
  await new Promise(r => setTimeout(r, 400));
})()`;
const TO_PRO = `(async () => {
  [...document.querySelectorAll('.editor-tab')].find((t) => (t.title || '').endsWith('main.py'))?.click();
  await new Promise(r => setTimeout(r, 400));
  document.querySelector('.ide-topbar [data-theme-choice="pro"]').click();
})()`;
const LSP_SCENES = [
  { name: 'l01-picker', wait: 4500 },
  { name: 'l02-play-diagnostics', js: `document.querySelector('[data-pick="playground"]').click(); ${LSP_SETUP}`, wait: 400 },
  { name: 'l03-play-completion', js: COMPLETE, wait: 300 },
  { name: 'l04-play-hover', js: HOVER, wait: 300 },
  { name: 'l05-play-problems', js: `document.querySelector('.cm-content').dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 5, clientY: 5 })); document.getElementById('tab-problems').click()`, wait: 500 },
  { name: 'l06-play-rename', js: RENAME, wait: 400 },
  { name: 'l07-play-library', js: LIBRARY, wait: 300 },
  { name: 'l08-switching', js: TO_PRO, wait: 3000 },
  { name: 'l09-pro-completion', js: COMPLETE, wait: 300 },
  { name: 'l10-pro-hover', js: HOVER, wait: 300 },
  { name: 'l11-pro-problems', js: `document.querySelector('.cm-content').dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 5, clientY: 5 })); document.getElementById('tab-problems').click()`, wait: 500 },
];

// Phase 5 tour: THETA_SHOTS_SET=debug
const DBG_CODE = 'def average(scores):\\n    total = 0\\n    for s in scores:\\n        total += s\\n    return total / len(scores)\\n\\n\\nname = input("Your name? ")\\nmarks = [72, 88, 95]\\nresult = average(marks)\\nprint(name, "averaged", result)\\n';
const DBG_SETUP = `(async () => {
  const t = window.__thetaTest;
  document.getElementById('btn-new-tab').click();
  await new Promise(r => setTimeout(r, 300));
  t.setCode('${DBG_CODE}');
  t.toggleBreakpointLine(4);
  t.toggleBreakpointLine(10);
  document.getElementById(document.documentElement.dataset.theme === 'pro' ? 'rail-debug' : 'view-debug').click();
  await new Promise(r => setTimeout(r, 300));
})()`;
const DBG_PAUSE = `(async () => {
  const t = window.__thetaTest;
  ${waitFor("/ready|idle/.test(document.documentElement.dataset.runState || '')")}
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', bubbles: true }));
  ${waitFor("/Your name/.test(window.__thetaTest.terminalText())")}
  t.submitInput('Ada');
  ${waitFor('window.__thetaTest.debugState().pausedLine === 10')}
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', bubbles: true }));
  ${waitFor('window.__thetaTest.debugState().pausedLine === 4')}
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  ${waitFor("document.querySelectorAll('#dbg-variables .dbg-var').length > 2")}
  await new Promise(r => setTimeout(r, 400));
})()`;
const DBG_WATCH = `(async () => {
  const w = document.getElementById('dbg-watch-input');
  w.value = 'total / max(1, len(scores))';
  w.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  const e = document.getElementById('dbg-eval-input');
  e.value = 'sorted(scores, reverse=True)';
  e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  ${waitFor("document.querySelector('#dbg-eval-log .dbg-eval-a')")}
  await new Promise(r => setTimeout(r, 400));
})()`;
const DBG_EXCEPTION = `(async () => {
  const t = window.__thetaTest;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', shiftKey: true, bubbles: true }));
  ${waitFor('!window.__thetaTest.debugState().active')}
  document.getElementById('btn-clear').click(); // the next prompt check must see the new program
  t.toggleBreakpointLine(4); t.toggleBreakpointLine(10);
  t.setCode('${DBG_CODE.replace('marks = [72, 88, 95]', 'marks = []')}');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', bubbles: true }));
  ${waitFor("/Your name/.test(window.__thetaTest.terminalText())")}
  t.submitInput('Ada');
  ${waitFor("/ZeroDivisionError/.test(document.getElementById('dbg-exception').textContent)")}
  await new Promise(r => setTimeout(r, 500));
})()`;
const DBG_TO_PRO = `(async () => {
  const t = window.__thetaTest;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', shiftKey: true, bubbles: true }));
  ${waitFor('!window.__thetaTest.debugState().active')}
  document.getElementById('btn-clear').click(); // the next prompt check must see the new program
  document.querySelector('.ide-topbar [data-theme-choice="pro"]').click();
  await new Promise(r => setTimeout(r, 1500));
  t.setCode('${DBG_CODE}');
  t.toggleBreakpointLine(4);
  document.getElementById('rail-debug').click();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', bubbles: true }));
  ${waitFor("/Your name/.test(window.__thetaTest.terminalText())")}
  t.submitInput('Ada');
  ${waitFor('window.__thetaTest.debugState().pausedLine === 4')}
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  ${waitFor("document.querySelectorAll('#dbg-variables .dbg-var').length > 2")}
  await new Promise(r => setTimeout(r, 500));
})()`;
const DEBUG_SCENES = [
  { name: 'd01-picker', wait: 4500 },
  { name: 'd02-play-breakpoints', js: `document.querySelector('[data-pick="playground"]').click(); ${DBG_SETUP}`, wait: 1200 },
  { name: 'd03-play-paused', js: DBG_PAUSE, wait: 300 },
  { name: 'd04-play-watch-eval', js: DBG_WATCH, wait: 300 },
  { name: 'd05-play-exception', js: DBG_EXCEPTION, wait: 300 },
  { name: 'd06-pro-paused', js: DBG_TO_PRO, wait: 300 },
  { name: 'd07-pro-watch-eval', js: DBG_WATCH, wait: 300 },
];

// Phase 6 tour: THETA_SHOTS_SET=study
const STUDY_CODE = 'scores = {"Aarav": 91, "Diya": 78, "Kabir": 85}\\n\\nfor name, score in scores.items():\\n    grade = "A" if score >= 85 else "B"\\n    print(f"{name:<6} {score:>3}  {grade}")\\n\\naverage = sum(scores.values()) / len(scores)\\nprint("Class average:", round(average, 1))\\n';
const STUDY_RUN = `(async () => {
  ${waitFor("/ready|idle/.test(document.documentElement.dataset.runState || '')")}
  window.__thetaTest.setCode('${STUDY_CODE}');
  await new Promise(r => setTimeout(r, 300));
  ${RUN}
})()`;
const hover = (sel) => `(async () => {
  document.querySelector('${sel}').dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }));
  await new Promise(r => setTimeout(r, 900));
})()`;
const unhover = `(async () => {
  document.getElementById('editor-pane').dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }));
  await new Promise(r => setTimeout(r, 900));
})()`;
const study = (mode, side = 'right') => `(async () => {
  await window.__thetaTest.study('${mode}', '${side}');
  await new Promise(r => setTimeout(r, 1600));
})()`;
const STUDY_SCENES = [
  { name: 's01-picker', wait: 4500 },
  { name: 's02-play-normal', js: `document.querySelector('[data-pick="playground"]').click(); ${STUDY_RUN}`, wait: 500 },
  { name: 's03-play-spot-output', js: hover('.ide-pane--terminal'), wait: 100 },
  { name: 's04-play-spot-files', js: `(async () => { ${unhover.slice(14, -5)}; document.getElementById('sidebar').dispatchEvent(new PointerEvent('pointerenter', { bubbles: false })); await new Promise(r => setTimeout(r, 900)); })()`, wait: 100 },
  { name: 's05-play-suggestion', js: `(async () => { ${unhover.slice(14, -5)}; window.__thetaTest.studySuggest('right'); await new Promise(r => setTimeout(r, 600)); })()`, wait: 100 },
  { name: 's06-play-sheet', js: "document.getElementById('study-suggestion-more').click()", wait: 600 },
  { name: 's07-play-duo', js: study('duo'), wait: 100 },
  { name: 's08-play-duo-spot', js: hover('.ide-pane--terminal'), wait: 100 },
  { name: 's09-play-half', js: `(async () => { ${unhover.slice(14, -5)}; })().then(() => window.__thetaTest.study('half', 'right')).then(() => new Promise(r => setTimeout(r, 1600)))`, wait: 100 },
  { name: 's10-play-third', js: study('third'), wait: 100 },
  { name: 's11-play-quarter', js: study('quarter'), wait: 100 },
  { name: 's12-play-mini', js: study('mini'), wait: 100 },
  { name: 's13-play-mini-drawer', js: "document.getElementById('study-drawer').click()", wait: 500 },
  { name: 's14-pro-third', js: `(async () => {
    document.getElementById('study-drawer').click();
    document.querySelector('.ide-topbar [data-theme-choice="pro"]').click();
    await new Promise(r => setTimeout(r, 1800));
    await window.__thetaTest.study('third', 'left');
    await new Promise(r => setTimeout(r, 1600));
  })()`, wait: 100 },
  { name: 's15-pro-duo', js: `(async () => {
    await window.__thetaTest.study(null);
    await new Promise(r => setTimeout(r, 1500));
    await window.__thetaTest.study('duo');
    await new Promise(r => setTimeout(r, 1500));
  })()`, wait: 100 },
  { name: 's16-pro-sheet', js: "document.getElementById('study-bar-name').click()", wait: 600 },
];

function attachShots(win, dir) {
  const scenes = { python: PY_SCENES, lsp: LSP_SCENES, debug: DEBUG_SCENES, study: STUDY_SCENES }[process.env.THETA_SHOTS_SET] || SCENES;
  fs.mkdirSync(dir, { recursive: true });
  const scale = process.env.THETA_SCALE || '1';
  win.webContents.on('console-message', (...args) => {
    const d = args[0] && typeof args[0] === 'object' && 'message' in args[0] ? args[0] : { level: args[1], message: args[2] };
    if (d.level === 'error' || d.level === 3) console.error('renderer Error: ' + d.message);
  });
  win.webContents.once('did-finish-load', async () => {
    try {
      for (const scene of scenes) {
        if (scene.js) {
          try { await win.webContents.executeJavaScript(scene.js); }
          catch (err) {
            console.error(`shots failed in ${scene.name}: ${err.message}`);
            // Show the scene's lines so a syntax error can be located
            scene.js.split('\n').forEach((l, i) => console.error(`  ${String(i + 1).padStart(3)} | ${l.slice(0, 160)}`));
          }
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
