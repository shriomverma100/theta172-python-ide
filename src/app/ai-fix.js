/**
 * "Fix Code" using the Groq API with the user's OWN key.
 *
 * No key ships with the app. The user enters one in a dialog and it is
 * kept in this device's local storage. Phase 7 replaces this with the
 * THETA172 AI service so keys never live on the client at all.
 */
import { getValue, setValue } from '../editor.js';
import { showToast } from '../toast.js';
import { $ } from '../core/dom.js';
import { storageGet, storageSet, storageRemove } from '../core/storage.js';
import { markActiveTabUnsaved } from './tabs.js';
import { scheduleAutoSave } from './autosave.js';

const GROQ_STORAGE_KEY = 'theta-groq-api-key';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.1-8b-instant';

const SYSTEM_PROMPT = `You are a Python code fixer. You receive Python code and return the corrected version.

RULES:
1. Fix ALL bugs: syntax errors, indentation, logic errors, typos in keywords/builtins, missing colons, wrong operators, unclosed brackets/strings, incorrect function calls.
2. PRESERVE the user's exact coding style, approach, structure, and variable names. Do NOT refactor or restructure.
3. Do NOT add any comments the user did not write. Do NOT remove any comments the user wrote.
4. Do NOT add extra functionality, imports, or code the user did not write.
5. Do NOT change the user's algorithm or approach — only fix what is broken.
6. Keep the same blank lines, spacing style, and formatting the user used.
7. Return ONLY the corrected Python code. No markdown, no explanations, no code fences, no backticks. Raw code only.`;

let isFixing = false;

/** Strip Markdown code fences a model sometimes adds anyway. */
export function stripCodeFences(text) {
  return text.replace(/^```(?:python)?\n?/i, '').replace(/\n?```$/i, '').trim();
}

/**
 * Ask for a Groq key in an in-app dialog (window.prompt does not exist
 * in Electron). Resolves to the key, or null if cancelled.
 */
export function askForApiKey() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal api-key-modal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'api-key-title');
    overlay.innerHTML = `
      <div class="modal-backdrop"></div>
      <form class="modal-content api-key-form">
        <div class="modal-header">
          <span class="modal-title" id="api-key-title">Groq API key</span>
        </div>
        <div class="api-key-body">
          <p class="api-key-text">AI Fix uses your own Groq key. Create a free key at console.groq.com/keys. It is stored only on this device.</p>
          <label class="api-key-label" for="api-key-input">API key</label>
          <input id="api-key-input" class="api-key-input" type="password" autocomplete="off" spellcheck="false" placeholder="gsk_..." required>
          <p class="api-key-error" id="api-key-error" role="alert"></p>
          <div class="api-key-actions">
            <button type="button" class="api-key-btn api-key-btn--ghost" data-action="cancel">Cancel</button>
            <button type="submit" class="api-key-btn">Save key</button>
          </div>
        </div>
      </form>`;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('#api-key-input');
    const error = overlay.querySelector('#api-key-error');
    const close = (value) => {
      overlay.remove();
      resolve(value);
    };

    overlay.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const key = input.value.trim();
      if (!key.startsWith('gsk_') || key.length < 20) {
        error.textContent = 'That does not look like a Groq key (it starts with gsk_).';
        input.focus();
        return;
      }
      storageSet(GROQ_STORAGE_KEY, key);
      close(key);
    });
    overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => close(null));
    overlay.querySelector('.modal-backdrop').addEventListener('click', () => close(null));
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(null);
      }
    });
    setTimeout(() => input.focus(), 30);
  });
}

async function getApiKey() {
  return storageGet(GROQ_STORAGE_KEY) || askForApiKey();
}

export async function fixCode() {
  if (isFixing) return;

  const code = getValue();
  if (!code.trim()) {
    showToast('Nothing to fix — write some code first', 'info', 2000);
    return;
  }

  const apiKey = await getApiKey();
  if (!apiKey) {
    showToast('AI Fix needs a Groq API key', 'info', 3000);
    return;
  }

  const $btn = $('btn-fix-indent');
  isFixing = true;
  $btn?.classList.add('loading');
  $btn?.setAttribute('disabled', '');
  showToast('Fixing code...', 'info', 1500);

  try {
    const response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: code },
        ],
        temperature: 0,
        max_tokens: 4096,
      }),
    });

    if (response.status === 401) {
      storageRemove(GROQ_STORAGE_KEY); // bad or revoked key: ask again next time
      throw new Error('the API key was rejected. Run Fix Code again to enter a new key');
    }
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || `API error: ${response.status}`);
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content;
    if (!raw || !raw.trim()) throw new Error('Empty response from AI');

    const fixed = stripCodeFences(raw);
    if (fixed !== code.trim()) {
      setValue(fixed + '\n', 'a'); // counted as AI-written in the authorship record
      markActiveTabUnsaved();
      scheduleAutoSave();
      showToast('Code fixed successfully', 'success', 2000);
    } else {
      showToast('Code looks good — no fixes needed', 'info', 2000);
    }
  } catch (err) {
    console.error('Fix code error:', err);
    showToast(`Fix failed: ${err.message}`, 'error', 3500);
  } finally {
    isFixing = false;
    $btn?.classList.remove('loading');
    $btn?.removeAttribute('disabled');
  }
}
