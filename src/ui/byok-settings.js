// ui/byok-settings.js — BYOK settings modal (endpoint + API key + model).
//
// The key lives ONLY in the local vault (IndexedDB / in-memory). It is never
// sent anywhere except, as a Bearer token, to the single endpoint the user
// configured. There is no telemetry, no fallback key, no phone-home.

import { el } from '../utils/dom.js';
import {
  loadByokSettings, saveByokSettings, clearByokSettings, normalizeSettings,
} from '../io/byok.js';

/**
 * Open the BYOK settings dialog.
 * @param {object} opts
 * @param {object} opts.vault local vault (IDBVault / MemoryVault)
 * @param {Function} [opts.onSaved] called with the normalized settings (or null after clear)
 * @param {Function} [opts.onClose]
 */
export async function openByokSettings({ vault, onSaved, onClose } = {}) {
  const current = normalizeSettings(await loadByokSettings(vault));

  const endpointInput = el('input', {
    class: 'af-byok-input', type: 'url', placeholder: 'https://api.openai.com/v1/chat/completions',
    value: current.endpoint, 'aria-label': 'API endpoint',
  });
  const keyInput = el('input', {
    class: 'af-byok-input', type: 'password', placeholder: 'sk-… (stored only on this device)',
    value: current.apiKey, autocomplete: 'off', 'aria-label': 'API key',
  });
  const modelInput = el('input', {
    class: 'af-byok-input', type: 'text', placeholder: 'gpt-4o-mini',
    value: current.model, 'aria-label': 'Model',
  });

  const status = el('div', { class: 'af-byok-status', role: 'status' });

  const saveBtn = el('button', {
    class: 'af-btn af-btn-primary', type: 'button',
    onClick: async () => {
      const settings = {
        endpoint: endpointInput.value.trim(),
        apiKey: keyInput.value,
        model: modelInput.value.trim(),
      };
      if (settings.endpoint && !/^https?:\/\//i.test(settings.endpoint)) {
        status.textContent = 'Endpoint must start with http(s)://';
        status.dataset.kind = 'error';
        return;
      }
      await saveByokSettings(vault, settings);
      status.textContent = settings.endpoint && settings.apiKey
        ? 'Saved — your key stays on this device; only your endpoint is reachable.'
        : 'Saved (incomplete — BYOK stays off until endpoint + key are set).';
      status.dataset.kind = 'ok';
      if (onSaved) onSaved(normalizeSettings(settings));
    },
  }, 'Save');

  const clearBtn = el('button', {
    class: 'af-btn', type: 'button',
    onClick: async () => {
      await clearByokSettings(vault);
      endpointInput.value = '';
      keyInput.value = '';
      modelInput.value = '';
      status.textContent = 'Cleared — BYOK is off and the egress allowlist is empty.';
      status.dataset.kind = 'ok';
      if (onSaved) onSaved(null);
    },
  }, 'Clear');

  const cancelBtn = el('button', { class: 'af-btn', type: 'button', onClick: () => close() }, 'Cancel');

  const panel = el('div', {
    class: 'af-modal af-byok-settings', role: 'dialog', 'aria-modal': 'true',
    'aria-label': 'BYOK settings',
  }, [
    el('div', { class: 'af-modal-head' }, [
      el('span', { class: 'af-modal-title' }, 'BYOK — Bring Your Own Key'),
      el('button', { class: 'af-modal-close', type: 'button', onClick: () => close() }, '×'),
    ]),
    el('p', { class: 'af-modal-note' },
      'Your API key is stored only on this device (local vault). AetherFlow sends it, as a Bearer token, solely to the endpoint you configure — and never with your row data, only the table schema + your instruction.'),
    field('Endpoint (full URL)', endpointInput),
    field('API key', keyInput),
    field('Model', modelInput),
    status,
    el('div', { class: 'af-modal-foot' }, [cancelBtn, clearBtn, saveBtn]),
  ]);

  const backdrop = el('div', { class: 'af-modal-backdrop' }, [panel]);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });

  function field(label, input) {
    return el('label', { class: 'af-byok-field' }, [el('span', {}, label), input]);
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter' && e.target !== keyInput) { e.preventDefault(); saveBtn.click(); }
  }
  document.addEventListener('keydown', onKey);

  function close() {
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
    if (onClose) onClose();
  }

  document.body.appendChild(backdrop);
  requestAnimationFrame(() => endpointInput.focus());
}
