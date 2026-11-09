// ui/status.js — the truthful status bar.
//
// "Saved on this device" (not a Save button): Local-First writes immediately.
// "0 outbound" is a live counter from the Egress Ledger, not a hardcoded label.
// The backup badge shows a "last activity" marker or an explicit export notice;
// a timestamp is NOT a data copy, so we never call it "backed up N min ago".
//
// The toast region is a live region: role="status" + aria-live, with
// per-message politeness so assistive tech announces errors promptly.

import { VERSION } from '../sdk/index.js';

export class StatusBar {
  constructor({ mount }) {
    this.el = document.createElement('footer');
    this.el.className = 'af-status';
    this.left = document.createElement('div');
    this.left.className = 'af-status-left';
    this.right = document.createElement('div');
    this.right.className = 'af-status-right';

    this.rows = this.item('ROWS', '—');
    this.dom = this.item('DOM NODES', '—');
    this.query = this.item('QUERY', '—');
    this.mode = this.item('ENGINE', '—');

    this.outbound = document.createElement('span');
    this.outbound.className = 'af-badge af-badge-ok af-shield';
    this.outbound.textContent = '🛡 0 outbound';
    // Zero-trust hover: the count is live from the Egress Ledger, never faked.
    this.outbound.title = 'AetherFlow Outbound Requests: 0 · Network Connections: Blocked by CSP';
    this.saved = document.createElement('span');
    this.saved.className = 'af-badge';
    this.saved.textContent = 'Saved on this device';
    this.backup = document.createElement('span');
    this.backup.className = 'af-badge af-badge-warn';
    this.backup.textContent = 'No backup yet';
    this.version = document.createElement('span');
    this.version.className = 'af-version';
    this.version.textContent = `v${VERSION}`;

    this.right.append(this.outbound, this.saved, this.backup, this.version);
    this.el.append(this.left, this.right);
    mount.appendChild(this.el);

    this.toastEl = document.createElement('div');
    this.toastEl.className = 'af-toast';
    this.toastEl.style.display = 'none';
    // Live region: polite by default; toast() raises it to assertive for errors.
    this.toastEl.setAttribute('role', 'status');
    this.toastEl.setAttribute('aria-live', 'polite');
    mount.appendChild(this.toastEl);
    this._toastTimer = null;
  }

  item(label, initial) {
    const wrap = document.createElement('span');
    wrap.className = 'af-status-item';
    const l = document.createElement('span');
    l.className = 'af-status-label';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'af-status-val';
    v.textContent = initial;
    wrap.append(l, v);
    this.left.appendChild(wrap);
    return v;
  }

  setStats({ rows, domNodes, queryMs, mode }) {
    if (rows != null) this.rows.textContent = rows.toLocaleString('en-US');
    if (domNodes != null) this.dom.textContent = String(domNodes);
    if (queryMs != null) this.query.textContent = `${queryMs} ms`;
    if (mode != null) this.mode.textContent = mode;
  }

  setOutbound(n) {
    this.outbound.textContent = n === 0 ? '🛡 0 outbound' : `🛡 ${n} outbound (blocked)`;
    this.outbound.classList.toggle('af-badge-ok', n === 0);
    this.outbound.classList.toggle('af-badge-danger', n !== 0);
    this.outbound.title = `AetherFlow Outbound Requests: ${n} · Network Connections: Blocked by CSP`;
  }

  setBackup(label, isFresh) {
    this.backup.textContent = label;
    this.backup.classList.toggle('af-badge-warn', !isFresh);
    this.backup.classList.toggle('af-badge-ok', !!isFresh);
  }

  toast(message, kind = 'info', ms = 3200) {
    clearTimeout(this._toastTimer);
    this.toastEl.textContent = message;
    this.toastEl.className = `af-toast af-toast-${kind}`;
    // Errors interrupt; everything else waits its turn.
    this.toastEl.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
    this.toastEl.style.display = 'block';
    this._toastTimer = setTimeout(() => { this.toastEl.style.display = 'none'; }, ms);
  }
}
