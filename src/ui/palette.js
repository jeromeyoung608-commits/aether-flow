// ui/palette.js — Cmd/Ctrl+K command palette (Linear / Vercel grade keyboard UX).
//
// Commands are NOT hardcoded here: they come from the public SDK registry, so
// an extension can add its own action with one line. This is dogfooding — the
// sample site uses the exact API a paying customer would use.

import { fuzzyScore } from '../sdk/index.js';

/** Pure, testable ranking. */
export function matchCommands(query, entries) {
  const q = String(query || '').trim();
  const scored = [];
  for (const e of entries) {
    const impl = e.impl || {};
    const title = impl.title || e.name;
    const haystack = [title, impl.keywords || '', impl.hint || '', e.description || '', e.name].join(' ');
    const s = fuzzyScore(q, haystack);
    const sTitle = fuzzyScore(q, title);
    if (s >= 0 || sTitle >= 0) scored.push({ e, score: Math.max(s, sTitle * 2) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((x) => x.e);
}

export class CommandPalette {
  /**
   * @param {object} opts
   * @param {import('../sdk/index.js').AetherFlow} opts.sdk
   * @param {Function} [opts.onRun] called after a command executes
   */
  constructor({ sdk, onRun } = {}) {
    this.sdk = sdk;
    this.onRun = onRun;
    this.entries = [];
    this.active = 0;
    this.isOpen = false;

    this.backdrop = document.createElement('div');
    this.backdrop.className = 'af-palette-backdrop';
    this.backdrop.addEventListener('mousedown', (e) => {
      if (e.target === this.backdrop) this.close();
    });

    this.panel = document.createElement('div');
    this.panel.className = 'af-palette';
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', 'Command palette');
    this.panel.setAttribute('aria-modal', 'true');

    this.input = document.createElement('input');
    this.input.className = 'af-palette-input';
    this.input.type = 'text';
    this.input.placeholder = 'Type a command…  (import, validate, share, export…)';
    this.input.setAttribute('aria-label', 'Search commands');
    this.input.addEventListener('input', () => { this.active = 0; this.render(); });
    this.input.addEventListener('keydown', (e) => this.onKey(e));

    this.list = document.createElement('div');
    this.list.className = 'af-palette-list';
    this.list.setAttribute('role', 'listbox');

    const foot = document.createElement('div');
    foot.className = 'af-palette-foot';
    foot.innerHTML = '<span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> run</span><span><kbd>esc</kbd> close</span>';

    this.panel.append(this.input, this.list, foot);
    this.backdrop.appendChild(this.panel);
    this.backdrop.style.display = 'none';
    document.body.appendChild(this.backdrop);

    this._globalKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === 'k') {
        e.preventDefault();
        this.toggle();
      } else if (e.key === 'Escape' && this.isOpen) {
        e.preventDefault();
        this.close();
      }
    };
    // Bind the global shortcut exactly once per instance. Idempotent binding is
    // what closes the leak: if a palette is re-created (SPA re-mount) without a
    // prior destroy(), a naive addEventListener would stack duplicate listeners
    // and Cmd/Ctrl+K would toggle twice (open then immediately close).
    this._globalBound = false;
    this.ensureGlobalKey();
  }

  /** Attach the global shortcut listener at most once for this instance. */
  ensureGlobalKey() {
    if (this._globalBound) return;
    document.addEventListener('keydown', this._globalKey);
    this._globalBound = true;
  }

  open() {
    this.entries = this.sdk.commands.list().map((meta) => ({
      name: meta.name, description: meta.description, stability: meta.stability,
      impl: this.sdk.commands.get(meta.name),
    })).filter((x) => x.impl && typeof (x.impl.run || x.impl) === 'function');
    this.active = 0;
    this.input.value = '';
    this.isOpen = true;
    this.backdrop.style.display = 'flex';
    this.render();
    requestAnimationFrame(() => this.input.focus());
  }

  close() {
    this.isOpen = false;
    this.backdrop.style.display = 'none';
    this.input.blur();
  }

  toggle() { this.isOpen ? this.close() : this.open(); }

  onKey(e) {
    const matches = this.matches();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!matches.length) return;
      this.active = (this.active + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
      this.render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (matches[this.active]) this.run(matches[this.active]);
    }
  }

  matches() { return matchCommands(this.input.value, this.entries); }

  render() {
    const matches = this.matches();
    this.list.textContent = '';
    if (!matches.length) {
      const empty = document.createElement('div');
      empty.className = 'af-palette-empty';
      empty.textContent = 'No matching command';
      this.list.appendChild(empty);
      return;
    }
    matches.slice(0, 12).forEach((entry, i) => {
      const impl = entry.impl || {};
      const item = document.createElement('div');
      item.className = 'af-palette-item' + (i === this.active ? ' is-active' : '');
      item.setAttribute('role', 'option');
      const left = document.createElement('span');
      left.className = 'af-palette-item-title';
      left.textContent = impl.title || entry.name;
      const right = document.createElement('span');
      right.className = 'af-palette-item-hint';
      right.textContent = impl.hint || entry.description || '';
      item.append(left, right);
      item.addEventListener('mouseenter', () => { this.active = i; this.render(); });
      item.addEventListener('mousedown', (e) => { e.preventDefault(); this.run(entry); });
      this.list.appendChild(item);
    });
    const activeEl = this.list.children[this.active];
    if (activeEl?.scrollIntoView) activeEl.scrollIntoView({ block: 'nearest' });
  }

  run(entry) {
    const fn = entry.impl?.run || entry.impl;
    this.close();
    try {
      const result = fn();
      if (result && typeof result.then === 'function') {
        result.catch((err) => this.sdk.emit('command:error', { name: entry.name, error: err }));
      }
      this.sdk.emit('command:run', { name: entry.name });
      if (this.onRun) this.onRun(entry);
    } catch (err) {
      this.sdk.emit('command:error', { name: entry.name, error: err });
      throw err;
    }
  }

  destroy() {
    if (this._globalBound) {
      document.removeEventListener('keydown', this._globalKey);
      this._globalBound = false;
    }
    this.backdrop.remove();
  }
}
