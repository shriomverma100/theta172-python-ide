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
  await new Promise(r => setTimeout(r, 150));
  [...document.querySelectorAll('#context-menu.visible .ctx-item')].find((i) => i.textContent.startsWith('New Python file'))?.click();
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

// Phase 7 tour: THETA_SHOTS_SET=git
const FILL_BOX = `const fillBox = async (value) => {
    for (let i = 0; i < 40 && !document.querySelector('.quick-pick .cmd-input'); i++) await new Promise(r => setTimeout(r, 100));
    const box = document.querySelector('.quick-pick .cmd-input');
    if (!box) return;
    box.value = value;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
  };`;
const EDITED_MAIN = 'from src.helpers import add\\n\\n\\ndef report(total):\\n    print("total:", total)\\n\\n\\nreport(add(40, 2))\\n';
const GIT_SCENES = [
  { name: 'g01-picker', wait: 4500 },
  { name: 'g02-play-not-repo', js: `(async () => {
    document.querySelector('[data-pick="playground"]').click();
    await new Promise(r => setTimeout(r, 1200));
    document.getElementById('view-git').click();
    ${waitFor("/Not a Git repository/.test(document.getElementById('git-state').textContent)")}
  })()`, wait: 300 },
  { name: 'g03-play-init', js: `(async () => {
    document.querySelector('#git-state .git-primary').click();
    ${waitFor("document.querySelector('#git-lists .git-file')")}
    document.getElementById('git-message').value = 'First version of the dice game';
  })()`, wait: 300 },
  { name: 'g04-play-edited', js: `(async () => {
    ${FILL_BOX}
    document.getElementById('git-commit').click();
    await fillBox('Ada Lovelace');
    await fillBox('ada@example.com');
    ${waitFor("document.querySelector('#git-lists .git-clean')")}
    [...document.querySelectorAll('#ws-tree .ws-row')].find((r) => r.dataset.path.endsWith('main.py'))?.click();
    await new Promise(r => setTimeout(r, 600));
    window.__thetaTest.setCode('${EDITED_MAIN}');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
    ${waitFor("document.querySelector('#git-lists .git-file')")}
    document.getElementById('git-history-toggle').click();
    await new Promise(r => setTimeout(r, 800));
  })()`, wait: 300 },
  { name: 'g05-play-diff', js: `(async () => {
    [...document.querySelectorAll('#git-lists .git-file__open')].find((b) => b.textContent.startsWith('main.py'))?.click();
    ${waitFor("document.querySelector('#diff-body .cm-mergeView')")}
  })()`, wait: 400 },
  { name: 'g06-play-branches', js: `(async () => {
    document.getElementById('diff-close').click();
    document.getElementById('git-branch').click();
    ${waitFor("document.querySelector('.quick-pick .qp-item')")}
  })()`, wait: 300 },
  { name: 'g07-pro-git', js: `(async () => {
    document.querySelector('.quick-pick .cmd-input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.querySelector('.ide-topbar [data-theme-choice="pro"]').click();
    await new Promise(r => setTimeout(r, 1800));
    document.getElementById('rail-git').click();
    await new Promise(r => setTimeout(r, 800));
  })()`, wait: 300 },
  { name: 'g08-pro-diff', js: `(async () => {
    [...document.querySelectorAll('#git-lists .git-file__open')].find((b) => b.textContent.startsWith('main.py'))?.click();
    ${waitFor("document.querySelector('#diff-body .cm-mergeView')")}
  })()`, wait: 400 },
];

// Editor groups tour: THETA_SHOTS_SET=groups
const GROUP_SPLIT = `(async () => {
  [...document.querySelectorAll('#ws-tree .ws-row')].find((r) => r.dataset.path.endsWith('main.py'))?.click();
  await new Promise(r => setTimeout(r, 600));
  document.getElementById('btn-split').click();
  await new Promise(r => setTimeout(r, 400));
  [...document.querySelectorAll('#ws-tree .ws-row')].find((r) => r.dataset.path.endsWith('src'))?.click();
  ${waitFor("[...document.querySelectorAll('#ws-tree .ws-row')].some((r) => r.dataset.path.endsWith('helpers.py'))")}
  [...document.querySelectorAll('#ws-tree .ws-row')].find((r) => r.dataset.path.endsWith('helpers.py'))?.click();
  ${waitFor("(document.querySelector('#monaco-split .cm-content')?.textContent || '').includes('def add')")}
  await new Promise(r => setTimeout(r, 400));
})()`;
const GROUP_SCENES = [
  { name: 'e01-picker', wait: 4500 },
  { name: 'e02-play-groups', js: `document.querySelector('[data-pick="playground"]').click(); ${GROUP_SPLIT}`, wait: 300 },
  { name: 'e03-play-left-focused', js: "document.querySelector('#monaco-container .cm-content').focus()", wait: 400 },
  { name: 'e04-play-drag', js: `(async () => {
    document.getElementById('group-2-close').click();
    await new Promise(r => setTimeout(r, 400));
    document.documentElement.classList.add('dragging-tab');
    document.getElementById('group-drop-right').classList.add('drop-over');
  })()`, wait: 300 },
  { name: 'e05-pro-groups', js: `(async () => {
    document.documentElement.classList.remove('dragging-tab');
    document.getElementById('group-drop-right').classList.remove('drop-over');
    document.querySelector('.ide-topbar [data-theme-choice="pro"]').click();
    await new Promise(r => setTimeout(r, 1800));
    document.getElementById('btn-split').click();
    await new Promise(r => setTimeout(r, 400));
    [...document.querySelectorAll('#editor-tabs .editor-tab')].find((t) => (t.textContent || '').startsWith('helpers.py'))?.click();
    await new Promise(r => setTimeout(r, 600));
  })()`, wait: 300 },
];

// Notebooks tour (Phase 8): THETA_SHOTS_SET=notebook
const NB_OPEN = `(async () => {
  const row = (name) => [...document.querySelectorAll('#ws-tree .ws-row')].find((r) => r.dataset.path.endsWith(name));
  ${waitFor("row('notebooks')")}
  row('notebooks')?.click();
  ${waitFor("row('explore.ipynb')")}
  row('explore.ipynb')?.click();
  ${waitFor("document.querySelector('#monaco-container .nb')")}
  await new Promise(r => setTimeout(r, 500));
})()`;
const NB_SCROLL = (where) => `document.querySelector('.nb-scroll').scrollTop = ${where};`;
const NB_SCENES = [
  { name: 'n01-picker', wait: 4500 },
  { name: 'n02-play-notebook', js: `document.querySelector('[data-pick="playground"]').click(); ${NB_OPEN}`, wait: 300 },
  { name: 'n03-play-ran', js: `(async () => {
    document.querySelector('.nb .nb-btn--primary').click();
    for (let i = 0; i < 300 && !document.querySelector('.nb-input__box'); i++) await new Promise(r => setTimeout(r, 100));
    await new Promise(r => setTimeout(r, 300));
    ${NB_SCROLL(0)}
  })()`, wait: 300 },
  { name: 'n04-play-plot', js: `(async () => {
    document.querySelector('.nb-cell[data-cell="plot"]')?.scrollIntoView({ block: 'center' });
  })()`, wait: 400 },
  { name: 'n05-play-input', js: `(async () => {
    document.querySelector('.nb-input')?.scrollIntoView({ block: 'center' });
    const box = document.querySelector('.nb-input__box');
    if (box) { box.focus(); box.value = 'Kabir'; }
  })()`, wait: 300 },
  { name: 'n06-play-error', js: `(async () => {
    const box = document.querySelector('.nb-input__box');
    box?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    for (let i = 0; i < 100 && !document.querySelector('.nb-out--error'); i++) await new Promise(r => setTimeout(r, 100));
    window.__thetaTest.notebook()?.runCell('oops');
    for (let i = 0; i < 100 && !document.querySelector('.nb-cell[data-cell="oops"] .nb-out--error'); i++) await new Promise(r => setTimeout(r, 100));
    document.querySelector('.nb-scroll').scrollTop = 1e6;
  })()`, wait: 400 },
  { name: 'n07-play-command-mode', js: `(async () => {
    const nb = window.__thetaTest.notebook();
    nb.selectAndShow('avg');
    document.querySelector('.nb-cell[data-cell="avg"]').scrollIntoView({ block: 'start' });
  })()`, wait: 400 },
  { name: 'n07b-play-new-text', js: `(async () => {
    [...document.querySelectorAll('.nb-bar .nb-btn')].find((b) => b.textContent === '+ Text').click();
    await new Promise(r => setTimeout(r, 200));
    const nb = window.__thetaTest.notebook();
    const cell = nb.cell(nb.selected);
    nb.cellViews.get(cell.id).editor.dispatch({ changes: { from: 0, insert: '## Notes\\nThe **lowest** score is below the average.' } });
    nb.cellViews.get(cell.id).root.scrollIntoView({ block: 'center' });
  })()`, wait: 400 },
  { name: 'n07c-play-text-done', js: `(async () => {
    window.__thetaTest.notebook().commandMode(); // like clicking away from the cell
  })()`, wait: 400 },
  { name: 'n08-pro-notebook', js: `(async () => {
    document.querySelector('.ide-topbar [data-theme-choice="pro"]').click();
    await new Promise(r => setTimeout(r, 1900));
    ${NB_SCROLL(0)}
  })()`, wait: 300 },
  { name: 'n09-pro-plot', js: `document.querySelector('.nb-cell[data-cell="plot"]')?.scrollIntoView({ block: 'center' });`, wait: 400 },
  { name: 'n10-pro-edit-markdown', js: `(async () => {
    window.__thetaTest.notebook().editMarkdown('intro');
    ${NB_SCROLL(0)}
  })()`, wait: 400 },
  { name: 'n11-pro-palette', js: `(async () => {
    document.getElementById('btn-palette').click();
    await new Promise(r => setTimeout(r, 200));
    const input = document.querySelector('#cmd-palette input, .cmd-palette input, #palette-input');
    if (input) { input.value = 'notebook'; input.dispatchEvent(new Event('input', { bubbles: true })); }
  })()`, wait: 400 },
];

// Spotlight frame rate: THETA_SHOTS_SET=spot (prints THETA_BENCH lines; pinned vs the old way)
const SPOT_FILL = `(async () => {
  const lines = Array.from({ length: 60 }, (_, i) => 'print("line ' + i + ': " + "x" * ' + (i % 40) + ')').join('\\n');
  window.__thetaTest.setCode('# a long file\\n' + lines + '\\n');
  ${RUN}
})()`;
const SPOT_SCENES = [
  { name: 's01-picker', wait: 4500 },
  { name: 's02-play', js: `document.querySelector('[data-pick="playground"]').click(); ${SPOT_FILL}`, wait: 600 },
  { name: 's03-bench-old', bench: 'window.__spotNoPin = true; window.__thetaTest.spotBench(10)', wait: 300, noShot: true },
  { name: 's04-bench-new', bench: 'window.__spotNoPin = false; window.__thetaTest.spotBench(10)', wait: 300, noShot: true },
  { name: 's05-play-output-grown', js: "document.querySelector('.ide-body').dataset.spot = 'output'", wait: 700 },
  { name: 's06-pro', js: `(async () => {
    delete document.querySelector('.ide-body').dataset.spot;
    document.querySelector('.ide-topbar [data-theme-choice="pro"]').click();
    await new Promise(r => setTimeout(r, 1900));
  })()`, wait: 300 },
  { name: 's07-pro-bench-old', bench: 'window.__spotNoPin = true; window.__thetaTest.spotBench(10)', wait: 300, noShot: true },
  { name: 's08-pro-bench-new', bench: 'window.__spotNoPin = false; window.__thetaTest.spotBench(10)', wait: 300, noShot: true },
];

// Learning helpers: THETA_SHOTS_SET=learn
const LEARN_SCENES = [
  { name: 'l01-picker', wait: 4500 },
  { name: 'l02-play-explain', js: `(async () => {
    document.querySelector('[data-pick="playground"]').click();
    await new Promise(r => setTimeout(r, 600));
    window.__thetaTest.setCode('scores = [90, 80, 70]\\ntotal = 0\\nfor s in scores:\\n    total += s\\nprint("average", total / len(score))\\n');
    ${RUN}
    await new Promise(r => setTimeout(r, 400));
  })()`, wait: 300 },
  { name: 'l03-play-explain-hindi', js: "[...document.querySelectorAll('.explain-card__lang')].find((b) => b.textContent === 'हिंदी')?.click()", wait: 300 },
  { name: 'l04-play-predict', js: `(async () => {
    window.__thetaTest.setCode('for i in range(3):\\n    print(i * 2)\\nprint("done")\\n');
    document.querySelector('.btn-predict--rail').click();
    await new Promise(r => setTimeout(r, 250));
    document.querySelector('.predict-pop__box').value = '0\\n2\\n6\\ndone';
  })()`, wait: 300 },
  { name: 'l05-play-predict-result', js: `(async () => {
    document.querySelector('.predict-pop__btn--go').click();
    ${waitFor("/Done|Error/.test(document.getElementById('run-status-text').textContent)")}
    await new Promise(r => setTimeout(r, 400));
  })()`, wait: 300 },
  { name: 'l06-play-progress', js: "document.getElementById('btn-progress').click()", wait: 500 },
  { name: 'l07-pro-explain', js: `(async () => {
    document.querySelector('.progress-modal__close')?.click();
    document.querySelector('.ide-topbar [data-theme-choice="pro"]').click();
    await new Promise(r => setTimeout(r, 1900));
    window.__thetaTest.setCode('age = input("Age? ")\\nif age > 18:\\n    print("adult")\\n');
    document.getElementById('btn-run').click();
    await new Promise(r => setTimeout(r, 1500));
    window.__thetaTest.sendInput?.('20');
    ${waitFor("/Done|Error/.test(document.getElementById('run-status-text').textContent)")}
    await new Promise(r => setTimeout(r, 400));
  })()`, wait: 300 },
  { name: 'l08-pro-file-menu', js: "document.querySelector('.menubar__item').click()", wait: 300 },
  { name: 'l09-pro-open-recent', js: `(async () => {
    [...document.querySelectorAll('.app-menu__item')].find((b) => b.textContent.includes('Open Recent'))?.dispatchEvent(new MouseEvent('mouseenter'));
    await new Promise(r => setTimeout(r, 300));
  })()`, wait: 200 },
  { name: 'l10-pro-edit-menu', js: "document.querySelectorAll('.menubar__item')[1].dispatchEvent(new MouseEvent('mouseenter'))", wait: 300 },
  { name: 'l11-play-menu', js: `(async () => {
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.querySelector('.ide-topbar [data-theme-choice="playground"]').click();
    await new Promise(r => setTimeout(r, 1900));
    document.querySelector('.menubar__all').click();
    await new Promise(r => setTimeout(r, 200));
    [...document.querySelectorAll('.app-menu__item')].find((b) => b.textContent.includes('File'))?.dispatchEvent(new MouseEvent('mouseenter'));
    await new Promise(r => setTimeout(r, 300));
  })()`, wait: 200 },
];

// Classroom across networks: THETA_SHOTS_SET=class
// A real relay and real student apps (the classroom client, without a window)
// run in this process and talk to the app over the real protocol.
const cls = { relay: null, students: [], teacher: null };
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
async function classRelay() {
  if (cls.relay) return cls.relay;
  const relay = require('../relay-server/server.js');
  const port = await relay.listen(0);
  cls.relay = `ws://127.0.0.1:${port}`;
  process.env.THETA_RELAY_URL = cls.relay; // the app uses it when Settings has none
  return cls.relay;
}
function fakeStudent(name, roll, endpoint) {
  const { ClassroomDiscovery } = require('./classroom-discovery.cjs');
  const s = new ClassroomDiscovery({ udp: false });
  s.startDiscovery(name, roll, endpoint.code ? { code: endpoint.code, relayUrl: cls.relay } : {});
  if (endpoint.port) {
    s.lanEndpoint = { ip: '127.0.0.1', port: endpoint.port, seenAt: Date.now(), classId: null };
    s._connectLan();
  }
  cls.students.push(s);
  return s;
}
const fail = (type, message, line, lineText) => ({ type: 'run', ok: false, error: { type, message, line, lineText }, concepts: ['for-loops'] });
const TEACHER_DEMO = 'scores = [90, 80, 70]\\ntotal = 0\\nfor s in scores:\\n    total += s\\nprint("average", total / len(scores))\\nbest = max(scores)\\nprint("best", best)\\n';
const CLASS_SCENES = [
  { name: 'c01-picker', node: () => classRelay(), wait: 4500 },
  { name: 'c02-play-teacher-setup', js: `(async () => {
    document.querySelector('[data-pick="playground"]').click();
    await new Promise(r => setTimeout(r, 700));
    window.__thetaTest.setCode('${TEACHER_DEMO}');
    document.getElementById('btn-class-tile').click();
    await new Promise(r => setTimeout(r, 1700));
    document.querySelector('[data-role="teacher"]').click();
    await new Promise(r => setTimeout(r, 300));
    document.getElementById('cr-teacher-name').value = 'Ms. Rao';
    document.querySelector('#cr-teacher-setup .cr-advanced').open = true;
  })()`, wait: 300 },
  { name: 'c03-play-live-empty', js: `(async () => {
    document.getElementById('cr-go-live-btn').click();
    for (let i = 0; i < 60 && !document.querySelector('#cr-join-code:not(.hidden)'); i++) await new Promise(r => setTimeout(r, 100));
  })()`, wait: 400 },
  { name: 'c04-play-class-pulse', node: async (win) => {
    const st = await win.webContents.executeJavaScript('window.electronAPI.classroomStatus()');
    const code = st.relay?.code;
    const lan = { port: st.port };
    const asha = fakeStudent('Asha Verma', '7', lan);
    const ravi = fakeStudent('Ravi Kumar', '12', { code });
    const meera = fakeStudent('Meera Iyer', '18', lan);
    const kabir = fakeStudent('Kabir Singh', '21', { code });
    const diya = fakeStudent('Diya Nair', '9', lan);
    for (let i = 0; i < 80 && !cls.students.every((s) => s.connected); i++) await sleepMs(100);
    asha.sendCodeLive('scores = [90, 80, 70]\ntotal = 0\nfor s in scores:\n    total += s\nprint("average", total / len(scor))\n', 'main.py');
    asha.sendEvent(fail('NameError', "name 'scor' is not defined", 5, 'print("average", total / len(scor))'));
    asha.sendEvent(fail('NameError', "name 'scor' is not defined", 5, 'print("average", total / len(scor))'));
    asha.sendHelpRequest('HELP_REQ', { type: 'NameError', message: "name 'scor' is not defined", line: 5 });
    ravi.sendEvent(fail('NameError', "name 'scor' is not defined", 5, 'print("average", total / len(scores))'));
    ravi.sendEvent({ type: 'run', ok: true, concepts: ['for-loops'] });
    ravi.sendEvent({ type: 'done', done: true }, 'done');
    meera.sendEvent({ type: 'run', ok: true });
    kabir.sendEvent(fail('NameError', "name 'Total' is not defined", 4, '    total += s'));
    kabir.sendEvent(fail('NameError', "name 'Total' is not defined", 4, '    total += s'));
    diya.sendEvent(fail('TypeError', 'can only concatenate str (not "int") to str', 7, 'print("best", best)'));
    await sleepMs(1500);
  }, js: 'void 0', wait: 600 },
  { name: 'c05-play-heat-on-teacher-code', js: `(async () => {
    document.getElementById('cr-teacher-to-editor')?.click();
    await new Promise(r => setTimeout(r, 4500)); // the pulse refreshes the heat every few seconds
  })()`, wait: 300 },
  { name: 'c06-pro-dashboard', js: `(async () => {
    document.querySelector('.ide-topbar [data-theme-choice="pro"]').click();
    await new Promise(r => setTimeout(r, 1900));
    document.getElementById('rail-classroom')?.click();
    await new Promise(r => setTimeout(r, 1600));
  })()`, wait: 300 },
  { name: 'c07-pro-student-reconnecting', node: async () => {
    // Asha's internet drops for a moment: her card shows it, nothing is lost
    const asha = cls.students[0];
    try { asha.lan?.ws.terminate(); } catch (_) { /* gone */ }
    asha.lanEndpoint.seenAt = 0;
    await sleepMs(900);
  }, js: 'void 0', wait: 200 },
  { name: 'c08-pro-routed', js: `(async () => {
    [...document.querySelectorAll('.cr-hand .cr-action-btn')].find((b) => /Ask/.test(b.textContent))?.click();
    await new Promise(r => setTimeout(r, 600));
  })()`, wait: 300 },
  // The app as a student: a test teacher elsewhere, joined with the code
  { name: 'c09-student-join-code', node: async (win) => {
    await win.webContents.executeJavaScript(`(async () => {
      document.getElementById('cr-stop-live-btn')?.click();
      await new Promise(r => setTimeout(r, 600));
    })()`);
    for (const s of cls.students) s.stopDiscovery();
    cls.students = [];
    const { ClassroomServer } = require('./classroom-server.cjs');
    const t = new ClassroomServer({ udp: false, lan: false });
    cls.teacher = t;
    await t.start('Mr. Das', { relayUrl: cls.relay });
    for (let i = 0; i < 50 && !t.relayState.code; i++) await sleepMs(100);
    cls.code = t.relayState.code;
    await win.webContents.executeJavaScript(`(async () => {
      document.getElementById('cr-global-back')?.click();
      await new Promise(r => setTimeout(r, 400));
      document.querySelector('[data-role="student"]')?.click();
      await new Promise(r => setTimeout(r, 300));
      document.getElementById('cr-student-name').value = 'Aarav Gupta';
      document.getElementById('cr-student-roll').value = '12';
      document.getElementById('cr-join-code-input').value = '${cls.code.slice(0, 3)}-${cls.code.slice(3)}';
    })()`);
  }, js: 'void 0', wait: 300 },
  { name: 'c10-student-connected', js: `(async () => {
    document.getElementById('cr-join-btn').click();
    for (let i = 0; i < 80 && document.getElementById('cr-connected-view')?.classList.contains('hidden'); i++) await new Promise(r => setTimeout(r, 100));
  })()`, node: async () => {
    await sleepMs(2500);
    cls.teacher.broadcastCode(TEACHER_DEMO.split('\\n').join('\n'), 0, 'lesson.py');
  }, wait: 800 },
  { name: 'c11-student-explained-by-teacher', node: async () => {
    cls.teacher.sendEvent('*', { type: 'explain', error: { type: 'NameError', message: "name 'scor' is not defined", line: 5, lineText: 'print("average", total / len(scor))' } });
    await sleepMs(600);
  }, js: "document.getElementById('cr-student-to-editor')?.click()", wait: 600 },
  { name: 'c12-student-helper-card', node: async () => {
    const id = cls.teacher.getStudents()[0]?.id;
    cls.teacher.sendEvent(id, { type: 'help-route', role: 'helper', to: 'student-x', name: 'Meera', error: { type: 'KeyError', line: 3 }, code: 'marks = {"maths": 90}\nprint(marks["Maths"])\n' });
    await sleepMs(500);
  }, js: 'void 0', wait: 300 },
  { name: 'c13-student-reconnecting', node: async () => {
    // The student's connection drops: the app reconnects by itself
    for (const ws of require('../relay-server/server.js').wss.clients) if (ws.role === 'student') ws.terminate();
    await sleepMs(250);
  }, js: 'void 0', wait: 100 },
  { name: 'c14-student-back', node: async () => { await sleepMs(3500); }, js: 'void 0', wait: 200 },
];

function attachShots(win, dir) {
  const scenes = { python: PY_SCENES, lsp: LSP_SCENES, debug: DEBUG_SCENES, study: STUDY_SCENES, git: GIT_SCENES, groups: GROUP_SCENES, notebook: NB_SCENES, spot: SPOT_SCENES, learn: LEARN_SCENES, class: CLASS_SCENES }[process.env.THETA_SHOTS_SET] || SCENES;
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
        if (scene.node) {
          try { await scene.node(win); }
          catch (err) { console.error(`shots failed in ${scene.name} (node): ${err.stack || err.message}`); }
        }
        if (scene.bench) {
          try { console.log(`THETA_BENCH ${scene.name} ${JSON.stringify(await win.webContents.executeJavaScript(scene.bench, true))}`); }
          catch (err) { console.error(`shots failed in ${scene.name}: ${err.message}`); }
        }
        await sleep(scene.wait || 0);
        if (scene.noShot) continue;
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
