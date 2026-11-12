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

// Phase 10b/10c: THETA_SHOTS_SET=p10 (Chain Lens, Viva, replay, hand-in, packages, GPU pool)
const P10_PANDAS = 'import pandas as pd\\n\\ndf = pd.DataFrame({\\n    "name": ["Aarav", "Diya", "Kabir", "Meera", "Rohan", "Asha"],\\n    "cls": ["A", "B", "A", "B", "A", "B"],\\n    "score": [91, 78, None, 88, 52, 67],\\n})\\nsummary = df.dropna().groupby("cls").score.mean().round(1)\\nprint(summary)\\n';
const P10_VIVA = 'marks = {"maths": 90, "science": 80}\\ntotal = 0\\nfor subject in marks:\\n    total += marks[subject]\\nprint("average", total / len(marks))\\n';
const P10_SCENES = [
  { name: 'p01-picker', node: () => classRelay(), wait: 4500 },
  { name: 'p02-pro-chain-lens-file', js: `(async () => {
    document.querySelector('[data-pick="pro"]').click();
    await new Promise(r => setTimeout(r, 900));
    window.__thetaTest.setCode('${P10_PANDAS}');
    window.__thetaTest.cursorTo('summary = df', 14);
    window.__thetaTest.action('chain-lens');
    for (let i = 0; i < 200 && !document.querySelector('#lens-card .lens__steps, #lens-card .lens__error'); i++) await new Promise(r => setTimeout(r, 100));
    await new Promise(r => setTimeout(r, 300));
  })()`, wait: 300 },
  { name: 'p03-pro-viva-practice', js: `(async () => {
    document.querySelector('#lens-card .lens__close')?.click();
    window.__thetaTest.setCode('${P10_VIVA}');
    window.__thetaTest.action('viva-practice');
    await new Promise(r => setTimeout(r, 300));
    const boxes = document.querySelectorAll('.viva-q__answer');
    if (boxes[0]) boxes[0].value = 'Each subject has a mark, so I can look it up by name instead of remembering positions.';
  })()`, wait: 300 },
  { name: 'p04-pro-replay', js: `(async () => {
    document.querySelector('.viva-modal .viva-modal__close')?.click();
    const v = window.__thetaTest.view();
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: '' }, userEvent: 'delete' });
    const typed = 'total = 0\\nfor n in range(5):\\n    total += n\\n';
    for (const ch of typed) { v.dispatch({ changes: { from: v.state.doc.length, insert: ch }, userEvent: 'input.type' }); await new Promise(r => setTimeout(r, 8)); }
    v.dispatch({ changes: { from: v.state.doc.length, insert: 'print("total is", total)\\nprint("average", total / 5)\\n' }, userEvent: 'input.paste' });
    window.__thetaTest.action('replay-file');
    await new Promise(r => setTimeout(r, 300));
    const s = document.querySelector('.replay__slider');
    if (s) { s.value = String(Math.round(Number(s.max) * 0.6)); s.dispatchEvent(new Event('input')); }
  })()`, wait: 300 },
  { name: 'p05-pro-notebook-lens', js: `(async () => {
    document.querySelector('.viva-modal .viva-modal__close')?.click();
    const row = (name) => [...document.querySelectorAll('#ws-tree .ws-row')].find((r) => r.dataset.path.endsWith(name));
    row('notebooks')?.click();
    for (let i = 0; i < 30 && !row('explore.ipynb'); i++) await new Promise(r => setTimeout(r, 100));
    row('explore.ipynb')?.click();
    for (let i = 0; i < 40 && !document.querySelector('.nb'); i++) await new Promise(r => setTimeout(r, 100));
    const nb = window.__thetaTest.notebook();
    const cell = nb.insertAt(3, 'code', false);
    nb.cellViews.get(cell.id).editor.dispatch({ changes: { from: 0, insert: 'scores.sort_values("score").head(3).score.mean()' } });
    nb.runUpTo(cell.id);
    for (let i = 0; i < 300 && (nb.running || nb.queue.length || nb.kernelState !== 'idle'); i++) await new Promise(r => setTimeout(r, 100));
    nb.lensCell(cell.id);
    for (let i = 0; i < 100 && !document.querySelector('.nb-lens .lens__steps'); i++) await new Promise(r => setTimeout(r, 100));
    document.querySelector('.nb-lens')?.scrollIntoView({ block: 'center' });
  })()`, wait: 400 },
  // Teacher: share packages and the GPU; a student's job and hand-in arrive
  { name: 'p06-teacher-share', js: `(async () => {
    document.getElementById('rail-classroom')?.click();
    await new Promise(r => setTimeout(r, 1700));
    document.querySelector('[data-role="teacher"]').click();
    await new Promise(r => setTimeout(r, 300));
    document.getElementById('cr-teacher-name').value = 'Ms. Rao';
    document.getElementById('cr-go-live-btn').click();
    for (let i = 0; i < 60 && !document.querySelector('#cr-join-code:not(.hidden)'); i++) await new Promise(r => setTimeout(r, 100));
    await window.electronAPI.gpuShare(true, {});
    await new Promise(r => setTimeout(r, 400));
  })()`, node: async (win) => {
    await sleepMs(2500);
    const st = await win.webContents.executeJavaScript('window.electronAPI.classroomStatus()');
    const asha = fakeStudent('Asha Verma', '7', { port: st.port });
    for (let i = 0; i < 60 && !asha.connected; i++) await sleepMs(100);
    asha.sendEvent({ type: 'gpu-job', jobId: 'job-asha1', fileName: 'train.py', code: 'import time\nfor epoch in range(3):\n    print("epoch", epoch, "loss", round(1 / (epoch + 1), 3))\n    time.sleep(0.2)\n' });
    asha.sendEvent({
      type: 'submission', fileName: 'marks.py', code: 'marks = {"maths": 90}\nprint(marks["maths"])\n', lang: 'en',
      questions: [{ en: 'Why did you use a dictionary for marks on line 1? What would be harder with a list?', line: 1, lineText: 'marks = {"maths": 90}' }],
      answers: ['So I can find a mark by the subject name.'],
      recording: { v: 1, base: '', start: 0, truncated: false, stats: { t: 22, p: 21, a: 0, r: 0, l: 0, total: 43 },
        events: [{ t: 0, k: 't', at: 0, del: 0, ins: 'marks = {"maths": 90}\n' }, { t: 4000, k: 'p', at: 22, del: 0, ins: 'print(marks["maths"])\n' }] },
    });
    await sleepMs(1200);
  }, wait: 600 },
  { name: 'p07-teacher-gpu-running', js: `(async () => {
    [...document.querySelectorAll('.cr-job .cr-action-btn')].find((b) => b.textContent === 'Accept')?.click();
    await new Promise(r => setTimeout(r, 1500));
  })()`, wait: 200 },
  { name: 'p08-teacher-submission', js: `(async () => {
    [...document.querySelectorAll('.cr-subs .cr-view-btn')].find((b) => b.textContent === 'Open')?.click();
    await new Promise(r => setTimeout(r, 300));
    const s = document.querySelector('.replay__slider');
    if (s) { s.value = '1'; s.dispatchEvent(new Event('input')); }
  })()`, wait: 300 },
  { name: 'p09-teacher-packages', js: `(async () => {
    document.querySelector('.viva-modal .viva-modal__close')?.click();
    [...document.querySelectorAll('.cr-share .cr-view-btn')].find((b) => b.textContent === 'Manage')?.click();
    await new Promise(r => setTimeout(r, 300));
    document.querySelector('#cr-pkg-modal .cr-input').value = 'pandas numpy matplotlib';
  })()`, wait: 300 },
  // Student: run on the teacher's GPU (a test teacher in this process)
  { name: 'p10-student-class-gpu', node: async (win) => {
    await win.webContents.executeJavaScript(`(async () => {
      document.querySelector('#cr-pkg-modal .viva-modal__close')?.click();
      document.getElementById('cr-stop-live-btn')?.click();
      await new Promise(r => setTimeout(r, 600));
    })()`);
    for (const s of cls.students) s.stopDiscovery();
    cls.students = [];
    const { ClassroomServer } = require('./classroom-server.cjs');
    const t = new ClassroomServer({ udp: false, lan: false });
    cls.teacher = t;
    let job = null;
    t.onStudentEvent = (who, msg) => {
      if (msg.type === 'gpu-job') job = { who, msg };
    };
    await t.start('Mr. Das', { relayUrl: cls.relay });
    for (let i = 0; i < 50 && !t.relayState.code; i++) await sleepMs(100);
    await win.webContents.executeJavaScript(`(async () => {
      document.getElementById('cr-global-back')?.click();
      await new Promise(r => setTimeout(r, 400));
      document.querySelector('[data-role="student"]')?.click();
      await new Promise(r => setTimeout(r, 300));
      document.getElementById('cr-student-name').value = 'Aarav Gupta';
      document.getElementById('cr-student-roll').value = '12';
      document.getElementById('cr-join-code-input').value = '${t.relayState.code}';
      document.getElementById('cr-join-btn').click();
      for (let i = 0; i < 80 && document.getElementById('cr-connected-view')?.classList.contains('hidden'); i++) await new Promise(r => setTimeout(r, 100));
      document.getElementById('cr-student-to-editor')?.click();
      await new Promise(r => setTimeout(r, 300));
    })()`);
    await sleepMs(1500);
    const id = t.getStudents()[0]?.id;
    t.sendEvent(id, { type: 'class-caps', packages: null, gpu: { name: 'NVIDIA RTX 3060', gpu: true, limitMin: 20 } }, 'caps');
    await sleepMs(600);
    await win.webContents.executeJavaScript(`[...document.querySelectorAll('.editor-tab')].find((t) => t.textContent.startsWith('main.py'))?.click(); window.__thetaTest.setCode('import time\\nfor epoch in range(3):\\n    print("epoch", epoch)\\n'); window.__thetaTest.action('run-class-gpu');`);
    for (let i = 0; i < 50 && !job; i++) await sleepMs(100);
    if (job) {
      const jid = job.msg.jobId;
      t.sendEvent(id, { type: 'gpu-status', jobId: jid, state: 'running', message: 'Running on NVIDIA RTX 3060' });
      for (let e = 0; e < 3; e++) t.sendEvent(id, { type: 'gpu-output', jobId: jid, stream: 'stdout', text: `epoch ${e} loss ${(1 / (e + 1)).toFixed(3)}\n` });
      t.sendEvent(id, { type: 'gpu-status', jobId: jid, state: 'done', message: 'Finished in 4 s', exitCode: 0 });
    }
    await sleepMs(1200);
  }, js: 'void 0', wait: 300 },
];

// Phase 11: THETA_SHOTS_SET=p11 (Tests view, editor marks, tasks)
const P11_SCENES = [
  { name: 'q01-picker', wait: 4500 },
  { name: 'q02-pro-tests-found', js: `(async () => {
    document.querySelector('[data-pick="pro"]').click();
    await new Promise(r => setTimeout(r, 900));
    window.__thetaTest.action('show-tests');
    for (let i = 0; i < 150 && !document.querySelector('#tests-view .tv-row--test'); i++) await new Promise(r => setTimeout(r, 100));
    await new Promise(r => setTimeout(r, 300));
  })()`, wait: 300 },
  { name: 'q03-pro-tests-run', js: `(async () => {
    window.__thetaTest.action('tests-run-all');
    for (let i = 0; i < 200 && !document.querySelector('#tests-view .tv-summary .is-failed'); i++) await new Promise(r => setTimeout(r, 100));
    await new Promise(r => setTimeout(r, 500));
    document.querySelector('#tests-view .tv-fail')?.setAttribute('open', '');
  })()`, wait: 300 },
  { name: 'q04-pro-editor-marks', js: `(async () => {
    [...document.querySelectorAll('#tests-view .tv-row--test')].find((r) => r.textContent.includes('test_add_negative'))?.click();
    for (let i = 0; i < 40 && !document.querySelector('.cm-test-mark'); i++) await new Promise(r => setTimeout(r, 100));
    await new Promise(r => setTimeout(r, 400));
  })()`, wait: 300 },
  { name: 'q05-pro-run-task', js: `(async () => {
    window.__thetaTest.action('run-task');
    await new Promise(r => setTimeout(r, 500));
  })()`, wait: 300 },
  { name: 'q06-pro-task-ruff', js: `(async () => {
    [...document.querySelectorAll('.quick-pick .cmd-item, .quick-pick [role="option"]')].find((o) => o.textContent.includes('Lint the project'))?.click();
    await new Promise(r => setTimeout(r, 4500));
  })()`, wait: 300 },
  { name: 'q07-play-tests', js: `(async () => {
    document.querySelector('.ide-topbar [data-theme-choice="playground"]').click();
    await new Promise(r => setTimeout(r, 1900));
    window.__thetaTest.action('show-tests');
    await new Promise(r => setTimeout(r, 400));
  })()`, wait: 300 },
];

// Phase 12: THETA_SHOTS_SET=p12 (plugins: install, consent, status bar, commands, panel)
const exampleDir = (name) => path.join(__dirname, '..', 'examples', 'plugins', name);
const clickButton = (text) => `[...document.querySelectorAll('[role=alertdialog] button')].find((b) => b.textContent === ${JSON.stringify(text)})?.click()`;
const P12_SCENES = [
  { name: 'r01-picker', wait: 4500 },
  { name: 'r02-pro-plugins-installed', node: async (win) => {
    // A TODO for the TODO Finder to find
    const project = process.env.THETA_SMOKE_WORKSPACE;
    if (project) fs.writeFileSync(path.join(project, 'src', 'stats.py'), 'def mean(xs):\n    # TODO: handle an empty list\n    return sum(xs) / len(xs)\n\n# FIXME: rounding\n');
    await win.webContents.executeJavaScript(`(async () => {
      document.querySelector('[data-pick="pro"]').click();
      await new Promise(r => setTimeout(r, 900));
      for (const d of ${JSON.stringify(['word-count', 'todo-finder', 'run-coach'].map(exampleDir))}) await window.electronAPI.pluginsLink(d);
      window.__thetaTest.action('manage-plugins');
      await new Promise(r => setTimeout(r, 500));
    })()`);
  }, js: 'void 0', wait: 300 },
  { name: 'r03-pro-consent', js: `(async () => {
    [...document.querySelectorAll('.pl-card')].find((c) => c.textContent.includes('TODO Finder'))?.querySelector('.viva-modal__btn--primary')?.click();
    await new Promise(r => setTimeout(r, 300));
  })()`, wait: 300 },
  { name: 'r04-pro-plugins-on', js: `(async () => {
    ${clickButton('Turn on')};
    await new Promise(r => setTimeout(r, 600));
    for (const name of ['Word Count', 'Run Coach']) {
      [...document.querySelectorAll('.pl-card')].find((c) => c.textContent.includes(name))?.querySelector('.viva-modal__btn--primary')?.click();
      await new Promise(r => setTimeout(r, 300));
      ${clickButton('Turn on')};
      await new Promise(r => setTimeout(r, 600));
    }
  })()`, wait: 600 },
  { name: 'r05-pro-status-bar', js: `(async () => {
    document.querySelector('#plugins-modal .viva-modal__close')?.click();
    window.__thetaTest.setCode('for i in range(3):\\n    print(i)\\n');
    await new Promise(r => setTimeout(r, 800));
    ${RUN}
    await new Promise(r => setTimeout(r, 600));
  })()`, wait: 300 },
  { name: 'r06-pro-todo-panel', js: `(async () => {
    window.__thetaTest.action('cmd-palette');
    await new Promise(r => setTimeout(r, 200));
    const input = document.getElementById('cmd-input');
    input.value = 'TODO';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    document.querySelector('.cmd-result-item')?.click();
    for (let i = 0; i < 40 && !document.querySelector('.plugin-panel'); i++) await new Promise(r => setTimeout(r, 100));
    await new Promise(r => setTimeout(r, 300));
  })()`, wait: 300 },
  { name: 'r07-pro-plugins-menu', js: `(async () => {
    [...document.querySelectorAll('.menubar__item')].find((b) => b.textContent === 'Plugins')?.click();
    await new Promise(r => setTimeout(r, 300));
  })()`, wait: 300 },
  { name: 'r07b-sandbox-check', node: async (win) => {
    // A plugin that looks for ways out of its sandbox and reports what it found
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'theta-sandbox-plugin-'));
    fs.writeFileSync(path.join(dir, 'theta-plugin.json'), JSON.stringify({ id: 'sandbox-check', name: 'Sandbox Check', version: '1.0.0', main: 'plugin.js', permissions: [] }));
    fs.writeFileSync(path.join(dir, 'plugin.js'), [
      "const seen = {};",
      "for (const k of ['fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts', 'indexedDB', 'Worker', 'navigator', 'document', 'window', 'require', 'process', 'electronAPI']) seen[k] = typeof self[k];",
      "await theta.log('SANDBOX ' + JSON.stringify(seen));",
      "try { await theta.editor.getText(); await theta.log('EDITOR allowed'); } catch (e) { await theta.log('EDITOR refused: ' + e.message); }",
    ].join('\n'));
    const out = await win.webContents.executeJavaScript(`(async () => {
      document.querySelector('.app-menu') && document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await window.electronAPI.pluginsLink(${JSON.stringify(dir)});
      window.__thetaTest.action('manage-plugins');
      await new Promise(r => setTimeout(r, 500));
      [...document.querySelectorAll('.pl-card')].find((c) => c.textContent.includes('Sandbox Check'))?.querySelector('.viva-modal__btn--primary')?.click();
      await new Promise(r => setTimeout(r, 300));
      ${clickButton('Turn on')};
      await new Promise(r => setTimeout(r, 1500));
      const card = [...document.querySelectorAll('.pl-card')].find((c) => c.textContent.includes('Sandbox Check'));
      [...card.querySelectorAll('button')].find((b) => b.textContent.startsWith('Log'))?.click();
      await new Promise(r => setTimeout(r, 300));
      const card2 = [...document.querySelectorAll('.pl-card')].find((c) => c.textContent.includes('Sandbox Check'));
      return card2?.querySelector('.pl-log')?.textContent || 'no log';
    })()`);
    console.log(`THETA_BENCH sandbox ${JSON.stringify(out)}`);
  }, js: 'void 0', wait: 300 },
  { name: 'r08-play-status', js: `(async () => {
    document.querySelector('#plugins-modal .viva-modal__close')?.click();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.querySelector('.plugin-panel .plugin-panel__close')?.click();
    document.querySelector('.ide-topbar [data-theme-choice="playground"]').click();
    await new Promise(r => setTimeout(r, 1900));
  })()`, wait: 300 },
];

// Relay setup + redesign tour: THETA_SHOTS_SET=relay
const OPEN_CLASS_SETUP = `(async () => {
  (document.getElementById('rail-classroom')?.offsetParent ? document.getElementById('rail-classroom') : document.getElementById('btn-class-tile')).click();
  await new Promise(r => setTimeout(r, 1700));
  document.querySelector('[data-role="teacher"]').click();
  await new Promise(r => setTimeout(r, 400));
  document.getElementById('cr-teacher-name').value = 'Ms. Sharma';
  document.querySelector('input[name="cr-join-way"][value="relay"]').click();
  document.getElementById('cr-relay-url').value = 'wss://theta172-relay.dps-noida.workers.dev';
})()`;
const LEAVE_CLASS = `(async () => {
  document.querySelector('.rs-close')?.click();
  document.getElementById('cr-global-back')?.click();
  await new Promise(r => setTimeout(r, 900));
})()`;
const scrollGuide = (sel) => `(async () => { document.querySelector('${sel}')?.scrollIntoView({ block: 'start' }); await new Promise(r => setTimeout(r, 200)); })()`;
const relayTour = (t) => [
  { name: `${t}01-ide`, js: `(async () => {
    window.__thetaTest.setCode('import pandas as pd\\n\\nscores = [91, 78, 64]\\nfor s in scores:\\n    print(s)\\n');
    ${RUN}
  })()`, wait: 600 },
  { name: `${t}02-error-card`, js: `(async () => {
    window.__thetaTest.setCode('marks = {"maths": 91}\\nprint(marks["science"])\\n');
    await new Promise(r => setTimeout(r, 400));
    ${RUN}
    await new Promise(r => setTimeout(r, 900));
  })()`, wait: 300 },
  { name: `${t}03-progress`, js: `(async () => { window.__thetaTest.action('my-progress'); await new Promise(r => setTimeout(r, 400)); })()`, wait: 200 },
  { name: `${t}04-class-setup`, js: `(async () => { document.querySelector('.progress-modal__close')?.click(); await (${OPEN_CLASS_SETUP}); })()`, wait: 300 },
  { name: `${t}05-guide-cloudflare`, js: `(async () => { document.getElementById('cr-relay-setup').click(); await new Promise(r => setTimeout(r, 1500)); })()`, wait: 300 },
  { name: `${t}06-guide-steps`, js: scrollGuide('.rs-steps'), wait: 200 },
  { name: `${t}07-guide-token`, js: scrollGuide('.rs-steps > li:nth-child(2) .rs-figs'), wait: 200 },
  { name: `${t}08-guide-paste`, js: scrollGuide('.rs-steps > li:nth-child(3)'), wait: 200 },
  { name: `${t}09-guide-docker`, js: `(async () => { document.querySelector('.rs-tab[data-tab="docker"]').click(); await new Promise(r => setTimeout(r, 600)); })()`, wait: 300 },
  { name: `${t}10-guide-pc`, js: `(async () => { document.querySelector('.rs-tab[data-tab="pc"]').click(); await new Promise(r => setTimeout(r, 300)); })()`, wait: 200 },
  { name: `${t}11-student-join`, js: `(async () => {
    document.querySelector('.rs-close')?.click();
    document.getElementById('cr-teacher-back')?.click();
    await new Promise(r => setTimeout(r, 300));
    document.querySelector('[data-role="student"]').click();
    await new Promise(r => setTimeout(r, 300));
    document.getElementById('cr-student-name').value = 'Aarav Gupta';
    document.getElementById('cr-student-roll').value = '12';
    document.getElementById('cr-join-code-input').value = 'K7M-4QX @ theta172-relay.dps-noida.workers.dev';
  })()`, wait: 300 },
  { name: `${t}12-settings`, js: `(async () => { await (${LEAVE_CLASS}); (document.getElementById('rail-settings')?.offsetParent ? document.getElementById('rail-settings') : document.getElementById('btn-settings')).click(); await new Promise(r => setTimeout(r, 300)); })()`, wait: 200 },
];
const RELAY_SCENES = [
  { name: 'q00-picker', wait: 4500 },
  { name: 'q00-pro', js: `document.querySelector('[data-pick="pro"]').click()`, wait: 1200, noShot: true },
  ...relayTour('qp'),
  { name: 'q50-switch', js: `(async () => {
    document.getElementById('close-settings')?.click();
    document.getElementById('cr-global-back')?.click();
    await new Promise(r => setTimeout(r, 900));
    document.querySelector('.ide-topbar [data-theme-choice="playground"]').click();
    await new Promise(r => setTimeout(r, 1900));
  })()`, wait: 300, noShot: true },
  ...relayTour('qg'),
];

// Phase 13 tour: THETA_SHOTS_SET=p13 (welcome frames, update card, updating screen)
const SIM_READY = `window.__thetaTest.updateSim({ state: 'ready', version: '1.2.0', percent: 100, notes: '- Faster start on school PCs\\n- Python cards while updating\\n- Fixes for the classroom relay' }, { version: '1.1.0' })`;
const SIM_DOWNLOAD = `window.__thetaTest.updateSim({ state: 'downloading', version: '1.2.0', percent: 46, transferred: 38 * 1048576, total: 83 * 1048576, bytesPerSecond: 4.2 * 1048576 })`;
const P13_SCENES = [
  { name: 'u00-picker', wait: 4500, noShot: true },
  { name: 'u01-dissolve', js: `void window.__thetaTest.action('welcome')`, wait: 450 },
  { name: 'u02-blocks', wait: 100 },
  { name: 'u02b-fps', noShot: true, bench: `new Promise((res) => { const d = []; let last = performance.now(); const f = (t) => { d.push(t - last); last = t; if (d.length < 150) requestAnimationFrame(f); else { d.sort((a, b) => a - b); res({ frames: d.length, medianMs: +d[75].toFixed(1), p95Ms: +d[142].toFixed(1), maxMs: +d[149].toFixed(1) }); } }; requestAnimationFrame(f); })`, wait: 0 },
  { name: 'u03-dial', wait: 1000 },
  { name: 'u04-theta-172', wait: 1700 },
  { name: 'u05-wordmark', wait: 1700 },
  { name: 'u06-tagline', wait: 900 },
  { name: 'u07-presents', wait: 1900 },
  { name: 'u08-name', wait: 2400 },
  { name: 'u09-name-typed', js: `(() => { const i = document.getElementById('th-name-input'); i.value = 'Aarav'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`, wait: 300 },
  { name: 'u10-namaste', js: `document.querySelector('.th-name .th-btn--go').click()`, wait: 1900 },
  { name: 'u11-after', wait: 3200, noShot: true },
  { name: 'u12-pro-card', js: `(async () => { document.querySelector('[data-pick="pro"]').click(); await new Promise(r => setTimeout(r, 1200)); ${SIM_READY}; })()`, wait: 600 },
  { name: 'u13-pro-downloading', js: `(async () => { document.getElementById('update-card')?.remove(); window.__thetaTest.updateScreen({ manual: true }); ${SIM_DOWNLOAD}; })()`, wait: 2600 },
  { name: 'u14-pro-tip-hindi', js: `(async () => { [...document.querySelectorAll('.upd-lang__btn')].find(b => b.textContent === 'हिंदी')?.click(); document.querySelector('.upd-tip__btn[aria-label="Next card"]')?.click(); })()`, wait: 700 },
  { name: 'u15-pro-installing', js: `(async () => { [...document.querySelectorAll('.upd-lang__btn')].find(b => b.textContent === 'English')?.click(); window.__thetaTest.updateSim({ state: 'installing', version: '1.2.0' }); })()`, wait: 900 },
  { name: 'u16-pro-whats-new', js: `(async () => { window.__thetaTest.updateClose(); window.__thetaTest.updateSim({ state: 'idle' }); window.__thetaTest.action('whats-new'); })()`, wait: 400 },
  { name: 'u17-pro-about', js: `(async () => { document.getElementById('whats-new')?.remove(); window.__thetaTest.action('about'); })()`, wait: 400 },
  { name: 'u18-pro-help-menu', js: `(async () => { document.getElementById('about-theta')?.remove(); [...document.querySelectorAll('.menubar__item')].find(b => b.textContent === 'Help')?.click(); })()`, wait: 400 },
  { name: 't00-pro-tour-start', js: `(async () => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(r => setTimeout(r, 300)); void window.__thetaTest.action('tour'); })()`, wait: 700 },
  { name: 't01-pro-tour', js: `window.__thetaTest.tourShow(1)`, wait: 600 },
  { name: 't02-pro-tour', js: `window.__thetaTest.tourShow(2)`, wait: 600 },
  { name: 't03-pro-tour', js: `window.__thetaTest.tourShow(3)`, wait: 600 },
  { name: 't06-pro-tour', js: `window.__thetaTest.tourShow(6)`, wait: 600 },
  { name: 't08-pro-tour', js: `window.__thetaTest.tourShow(8)`, wait: 600 },
  { name: 't09-pro-tour', js: `window.__thetaTest.tourShow(9)`, wait: 600 },
  { name: 't010-pro-tour', js: `window.__thetaTest.tourShow(10)`, wait: 600 },
  { name: 't011-pro-tour', js: `window.__thetaTest.tourShow(11)`, wait: 600 },
  { name: 't99-close', js: `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`, wait: 400, noShot: true },
  { name: 'u19-play-card', js: `(async () => {
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.querySelector('.ide-topbar [data-theme-choice="playground"]').click();
    await new Promise(r => setTimeout(r, 1900));
    ${SIM_READY};
  })()`, wait: 600 },
  { name: 'tp0-play-tour', js: `(async () => { document.getElementById('update-card')?.remove(); void window.__thetaTest.action('tour'); await new Promise(r => setTimeout(r, 500)); window.__thetaTest.tourShow(2); })()`, wait: 700 },
  { name: 'tp1-play-tour', js: `window.__thetaTest.tourShow(6)`, wait: 600 },
  { name: 'tp2-play-tour', js: `window.__thetaTest.tourShow(8)`, wait: 600 },
  { name: 'tp9-close', js: `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`, wait: 400, noShot: true },
  { name: 'u20-play-settings', js: `(async () => { document.getElementById('update-card')?.remove(); document.getElementById('btn-settings').click(); await new Promise(r => setTimeout(r, 300)); document.getElementById('set-updates')?.scrollIntoView({ block: 'center' }); })()`, wait: 300 },
];

// Real update download against scripts/update-server.cjs (THETA_SHOTS_SET=p13real, THETA_UPDATE_URL set).
// Stops before installing.
const P13_REAL = [
  { name: 'v00-picker', wait: 4000, noShot: true },
  { name: 'v01-check', js: `(async () => {
    document.querySelector('[data-pick="pro"]').click();
    await new Promise(r => setTimeout(r, 1200));
    window.__thetaTest.action('check-updates');
    for (let i = 0; i < 100 && !document.getElementById('update-screen'); i++) await new Promise(r => setTimeout(r, 100));
    await new Promise(r => setTimeout(r, 1500));
  })()`, wait: 200 },
  { name: 'v02-downloading', wait: 2500 },
  { name: 'v03-ready', bench: `(async () => {
    for (let i = 0; i < 1200 && !/is ready/.test(document.querySelector('.upd-title')?.textContent || ''); i++) await new Promise(r => setTimeout(r, 100));
    return { title: document.querySelector('.upd-title')?.textContent, sub: document.querySelector('.upd-sub')?.textContent, restart: !document.querySelector('.upd-foot .update-btn--primary')?.hidden };
  })()`, wait: 300 },
  { name: 'v04-card-later', js: `(async () => {
    [...document.querySelectorAll('.upd-foot .update-btn')].find(b => b.textContent === 'Keep working')?.click();
    await new Promise(r => setTimeout(r, 400));
    window.__thetaTest.action('check-updates'); // ready: shows the card
    await new Promise(r => setTimeout(r, 500));
  })()`, wait: 300 },
];

// Fixes tour: THETA_SHOTS_SET=fix (top bar at many widths, study mode in Pro, files per theme, welcome steps)
const size = (w, h = 820) => async (win) => { win.unmaximize?.(); win.setSize(w, h); win.center(); await sleep(500); };
const FIX_SCENES = [
  { name: 'f00-picker', wait: 4500, noShot: true },
  { name: 'f00b-ready', noShot: true, js: `(async () => { document.querySelector('[data-pick="pro"]').click(); for (let i = 0; i < 400 && !document.getElementById('loading-overlay')?.classList.contains('hidden'); i++) await new Promise(r => setTimeout(r, 100)); await new Promise(r => setTimeout(r, 800)); })()`, wait: 0 },
  { name: 'f01-pro-1440', node: size(1440), wait: 400 },
  { name: 'f02-pro-1280', node: size(1280), wait: 400 },
  { name: 'f03-pro-1100', node: size(1100), wait: 400 },
  { name: 'f04-pro-1000', node: size(1000), wait: 400 },
  { name: 'f05-pro-900', node: size(900), wait: 400 },
  { name: 'f06-pro-760', node: size(760), wait: 400 },
  { name: 'f07-pro-study-half', node: size(1280), js: `(async () => { await window.__thetaTest.study('half', 'right'); await new Promise(r => setTimeout(r, 1800)); })()`, wait: 400 },
  { name: 'f08-play-study-half', js: `(async () => { document.querySelector('.ide-topbar [data-theme-choice="playground"]')?.click(); await new Promise(r => setTimeout(r, 1900)); })()`, wait: 400 },
  { name: 'f09-play-study-quarter', js: `(async () => { await window.__thetaTest.study('quarter', 'right'); await new Promise(r => setTimeout(r, 1600)); })()`, wait: 400 },
  { name: 'f10-play-1280', js: `(async () => { await window.__thetaTest.study(null); await new Promise(r => setTimeout(r, 1200)); })()`, node: size(1280), wait: 600 },
  { name: 'f11-play-900', node: size(900), wait: 400 },
  { name: 'f12-play-760', node: size(760), wait: 400 },
  { name: 'f13-pro-files-hidden', node: size(1280), js: `(async () => { document.querySelector('.ide-topbar [data-theme-choice="pro"]').click(); await new Promise(r => setTimeout(r, 1900)); window.__thetaTest.action('toggle-sidebar'); await new Promise(r => setTimeout(r, 400)); })()`, wait: 300 },
  { name: 'f14-play-files-still-there', js: `(async () => { document.querySelector('.ide-topbar [data-theme-choice="playground"]').click(); await new Promise(r => setTimeout(r, 1900)); })()`, wait: 300 },
  { name: 'f15-play-output-run', js: `(async () => { window.__thetaTest.setCode('print("hello")\\n'); ${RUN} })()`, wait: 600 },
  { name: 'f16-welcome-intro', js: `void window.__thetaTest.action('welcome')`, wait: 3600 },
  { name: 'f17-welcome-presents', wait: 4200 },
  { name: 'f18-welcome-name', js: `document.querySelector('.th-skip')?.click()`, wait: 900 },
  { name: 'f19-welcome-look', js: `(async () => { document.getElementById('th-name-input').value = 'Aarav'; document.querySelector('.th-name .th-btn--go').click(); await new Promise(r => setTimeout(r, 900)); })()`, wait: 300 },
  { name: 'f20-welcome-look-pro', js: `document.querySelector('.th-look-card[data-look="pro"]').click()`, wait: 300 },
  { name: 'f21-welcome-hello', js: `document.querySelector('.th-look .th-btn--go').click()`, wait: 1800 },
  { name: 'f22-after', wait: 4000 },
];

// Study strips in both themes: THETA_SHOTS_SET=studybar
const studyStrip = (theme, mode) => ({ name: `sb-${theme}-${mode}`, js: `(async () => { await window.__thetaTest.study('${mode}', 'right'); await new Promise(r => setTimeout(r, 1500)); })()`, wait: 300 });
const STUDYBAR_SCENES = [
  { name: 'sb00', wait: 4500, noShot: true },
  { name: 'sb01', noShot: true, js: `(async () => { document.querySelector('[data-pick="pro"]').click(); for (let i = 0; i < 400 && !document.getElementById('loading-overlay')?.classList.contains('hidden'); i++) await new Promise(r => setTimeout(r, 100)); await new Promise(r => setTimeout(r, 800)); })()`, wait: 0 },
  ...['duo', 'half', 'third', 'quarter', 'mini'].map((m) => studyStrip('pro', m)),
  { name: 'sb02', noShot: true, js: `(async () => { await window.__thetaTest.study(null); await new Promise(r => setTimeout(r, 1200)); document.querySelector('.ide-topbar [data-theme-choice="playground"]').click(); await new Promise(r => setTimeout(r, 1900)); })()`, wait: 0 },
  ...['duo', 'half', 'third', 'quarter', 'mini'].map((m) => studyStrip('play', m)),
];

// Onboarding tour: THETA_SHOTS_SET=onb
const ONB_SCENES = [
  { name: 'o01-boot-sketch', wait: 700 },
  { name: 'o02-boot-inked', wait: 900 },
  { name: 'o03-boot-word', wait: 1100 },
  { name: 'o04', noShot: true, js: `(async () => { document.querySelector('[data-pick="pro"]')?.click(); for (let i = 0; i < 400 && !document.getElementById('loading-overlay')?.classList.contains('hidden'); i++) await new Promise(r => setTimeout(r, 100)); await new Promise(r => setTimeout(r, 600)); void window.__thetaTest.action('welcome'); await new Promise(r => setTimeout(r, 400)); document.querySelector('.th-skip')?.click(); await new Promise(r => setTimeout(r, 900)); })()`, wait: 0 },
  { name: 'o05-name', js: `document.getElementById('th-name-input').value = 'Aarav'`, wait: 300 },
  { name: 'o06-role', js: `document.querySelector('.th-name .th-btn--go').click()`, wait: 900 },
  { name: 'o07-role-build', js: `document.querySelector('.th-role-card[data-role="build"]').click()`, wait: 300 },
  { name: 'o08-look-recommended', js: `document.querySelector('.th-role .th-btn--go').click()`, wait: 900 },
  { name: 'o09-hello', js: `document.querySelector('.th-look .th-btn--go').click()`, wait: 2000 },
  { name: 'o10-first-program', js: `(async () => { await new Promise(r => setTimeout(r, 3600)); window.__thetaTest.firstProgram('Aarav', 'build'); await new Promise(r => setTimeout(r, 700)); })()`, wait: 200 },
  { name: 'o11-first-run-done', js: `(async () => { ${RUN} await new Promise(r => setTimeout(r, 900)); })()`, wait: 300 },
  { name: 'o12-update-downloading', js: `(async () => { document.querySelector('.tour--coach .tour__btn--quiet')?.click(); await new Promise(r => setTimeout(r, 300)); window.__thetaTest.updateScreen({ manual: true }); window.__thetaTest.updateSim({ state: 'downloading', version: '1.2.0', percent: 46, transferred: 38 * 1048576, total: 83 * 1048576, bytesPerSecond: 4.2 * 1048576 }, { version: '1.1.1' }); await new Promise(r => setTimeout(r, 2600)); })()`, wait: 200 },
  { name: 'o13-update-installing', js: `window.__thetaTest.updateSim({ state: 'installing', version: '1.2.0' })`, wait: 1500 },
  { name: 'o14', noShot: true, js: `window.__thetaTest.updateClose()`, wait: 400 },
  ...['half', 'third', 'quarter', 'mini'].map((m) => studyStrip('pro', m)),
  { name: 'o20-boot-replay', js: `(async () => { const o = document.getElementById('loading-overlay'); const c = o.querySelector('.loading-content'); if (0 === 0) { o.classList.remove('hidden', 'fade-out'); c.classList.remove('is-drawing'); void c.offsetWidth; c.classList.add('is-drawing'); } })()`, wait: 550 },
  { name: 'o21-boot-replay', js: `(async () => { const o = document.getElementById('loading-overlay'); const c = o.querySelector('.loading-content'); if (1 === 0) { o.classList.remove('hidden', 'fade-out'); c.classList.remove('is-drawing'); void c.offsetWidth; c.classList.add('is-drawing'); } })()`, wait: 600 },
  { name: 'o22-boot-replay', js: `(async () => { const o = document.getElementById('loading-overlay'); const c = o.querySelector('.loading-content'); if (2 === 0) { o.classList.remove('hidden', 'fade-out'); c.classList.remove('is-drawing'); void c.offsetWidth; c.classList.add('is-drawing'); } })()`, wait: 1300 },
];

function attachShots(win, dir) {
  const scenes = { onb: ONB_SCENES, studybar: STUDYBAR_SCENES, fix: FIX_SCENES, p13: P13_SCENES, p13real: P13_REAL, relay: RELAY_SCENES, python: PY_SCENES, lsp: LSP_SCENES, debug: DEBUG_SCENES, study: STUDY_SCENES, git: GIT_SCENES, groups: GROUP_SCENES, notebook: NB_SCENES, spot: SPOT_SCENES, learn: LEARN_SCENES, class: CLASS_SCENES, p10: P10_SCENES, p11: P11_SCENES, p12: P12_SCENES }[process.env.THETA_SHOTS_SET] || SCENES;
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
