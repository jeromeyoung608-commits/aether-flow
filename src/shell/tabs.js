// shell/tabs.js — same-browser multi-tab presence warning.
//
// AetherFlow is SINGLE INSTANCE (no OT, no version checks). Two tabs both hold
// a stale snapshot of the same rows, so the last writer silently wins. Until a
// real single-writer lock ships, the honest minimum is: detect the second tab
// and tell the user, loudly, before they trust their edits.
//
// BroadcastChannel is local inter-context IPC, not a network request. It does
// not touch the Egress Ledger and cannot reach another origin.

const CHANNEL = 'aether-flow-presence';

function randomId() {
  try {
    const bytes = new Uint8Array(8);
    globalThis.crypto?.getRandomValues?.(bytes);
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch (_) {
    return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }
}

/**
 * @param {{onPeers?:(count:number)=>void, onAlone?:()=>void}} hooks
 * @returns {{mode:'active'|'unsupported', peers:()=>number, stop:()=>void}}
 */
export function installTabGuard({ onPeers, onAlone } = {}) {
  if (typeof BroadcastChannel === 'undefined') {
    return { mode: 'unsupported', peers: () => 0, stop() {} };
  }

  const id = randomId();
  const channel = new BroadcastChannel(CHANNEL);
  // Node exposes BroadcastChannel too; don't let a test runner hang on it.
  channel.unref?.();
  const peers = new Set();
  let lastCount = 0;

  const notify = () => {
    const count = peers.size;
    if (count === lastCount) return;
    lastCount = count;
    if (count > 0) onPeers?.(count);
    else onAlone?.();
  };

  channel.onmessage = (e) => {
    const msg = e.data || {};
    if (!msg.from || msg.from === id) return;
    if (msg.type === 'hello' || msg.type === 'present') {
      peers.add(msg.from);
      // Answer so a tab that opened later also learns about us.
      channel.postMessage({ type: 'present', from: id });
      notify();
    } else if (msg.type === 'bye') {
      peers.delete(msg.from);
      notify();
    }
  };

  const leave = () => {
    try { channel.postMessage({ type: 'bye', from: id }); } catch (_) { /* closing */ }
  };
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('beforeunload', leave);
  }
  channel.postMessage({ type: 'hello', from: id });

  return {
    mode: 'active',
    peers: () => peers.size,
    stop() {
      leave();
      if (typeof window !== 'undefined' && window.removeEventListener) {
        window.removeEventListener('beforeunload', leave);
      }
      try { channel.close(); } catch (_) { /* already closed */ }
      peers.clear();
    },
  };
}
