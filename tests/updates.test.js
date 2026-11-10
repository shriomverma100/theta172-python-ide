/**
 * Updates: release notes, critical updates, the school policy file, the
 * update states sent to the window, and the cards on the updating screen.
 */
import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { TIPS, KIND_LABEL } from '../src/app/update-tips.js';

const require = createRequire(import.meta.url);
const { notesText, isCritical, readPolicy, registerUpdater } = require('../electron/updater.cjs');

describe('release notes', () => {
  it('turns GitHub HTML into plain lines', () => {
    expect(notesText('<ul><li>Faster start</li><li>Fix &amp; polish</li></ul>')).toBe('• Faster start\n• Fix & polish');
    expect(notesText([{ version: '1.2.0', note: '- One' }, { version: '1.1.0', note: '- Two' }])).toBe('- One\n- Two');
    expect(notesText(null)).toBe('');
  });

  it('knows a critical update', () => {
    expect(isCritical('- Security fix\n[critical]')).toBe(true);
    expect(isCritical('- New icons')).toBe(false);
  });
});

describe('school policy (C:\\ProgramData\\THETA172\\policy.json)', () => {
  const write = (obj) => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'theta-policy-')), 'policy.json');
    fs.writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj));
    return f;
  };
  it('reads auto, manual and off', () => {
    for (const updates of ['auto', 'manual', 'off']) expect(readPolicy(write({ updates })).updates).toBe(updates);
  });
  it('falls back to auto for a missing or broken file', () => {
    expect(readPolicy(path.join(os.tmpdir(), 'nope', 'policy.json')).updates).toBe('auto');
    expect(readPolicy(write('{ not json')).updates).toBe('auto');
    expect(readPolicy(write({ updates: 'sometimes' })).updates).toBe('auto');
  });
});

describe('the updater in the main process', () => {
  function setup({ packaged = false, testUrl = '' } = {}) {
    const handlers = {};
    const sent = [];
    const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; } };
    const app = { isPackaged: packaged, getVersion: () => '1.1.0' };
    const win = { isDestroyed: () => false, webContents: { send: (ch, s) => sent.push([ch, s]) } };
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'theta-upd-'));
    if (testUrl) process.env.THETA_UPDATE_URL = testUrl; else delete process.env.THETA_UPDATE_URL;
    vi.useFakeTimers();
    registerUpdater({ ipcMain, app, getWindow: () => win, userData });
    vi.useRealTimers();
    return { handlers, sent, userData };
  }

  it('does nothing outside the installed app, and says why', async () => {
    const { handlers } = setup();
    const info = await handlers['update-info']();
    expect(info).toMatchObject({ version: '1.1.0', enabled: false, auto: true, policy: 'auto' });
    expect(await handlers['update-check']()).toMatchObject({ ok: false, message: expect.stringMatching(/installed app/) });
  });

  it('remembers "Automatic updates" off', async () => {
    const { handlers, userData } = setup();
    await handlers['update-set-auto'](null, false);
    expect(JSON.parse(fs.readFileSync(path.join(userData, 'updates.json'), 'utf8')).auto).toBe(false);
  });

  it('shows "What\'s new" once, on the first start of the new version', async () => {
    const { handlers, userData } = setup();
    fs.writeFileSync(path.join(userData, 'updates.json'), JSON.stringify({ lastRunVersion: '1.0.0', pendingNotes: { version: '1.1.0', notes: '- New' } }));
    // a fresh start reads the file
    const again = setupFrom(userData);
    const first = await again['update-info']();
    expect(first.updatedFrom).toBe('1.0.0');
    expect(first.whatsNew).toEqual({ version: '1.1.0', notes: '- New' });
    const second = await again['update-info']();
    expect(second.updatedFrom).toBe(null);
    expect(second.whatsNew).toBe(null);
    void handlers;
  });

  function setupFrom(userData) {
    const handlers = {};
    registerUpdater({ ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, app: { isPackaged: false, getVersion: () => '1.1.0' }, getWindow: () => null, userData });
    return handlers;
  }
});

describe('cards on the updating screen', () => {
  it('has enough cards, each in English and Hindi', () => {
    expect(TIPS.length).toBeGreaterThanOrEqual(40);
    for (const t of TIPS) {
      expect(KIND_LABEL[t.kind]).toBeTruthy();
      for (const l of ['en', 'hi']) {
        expect(t[l].t.length).toBeGreaterThan(5);
        expect(t[l].b.length).toBeGreaterThan(20);
      }
    }
    for (const l of ['en', 'hi']) expect(new Set(TIPS.map((t) => t[l].t)).size).toBe(TIPS.length);
  });

  it('only shows code that is valid-looking Python (no HTML)', () => {
    for (const t of TIPS.filter((x) => x.code)) expect(t.code).not.toMatch(/<\/?[a-z]+[^>]*>/i);
  });
});
