// ui/chart.js — a genuinely tiny, zero-dependency Canvas chart.
//
// Not a BI module. Select a few rows / a numeric column, press the button, get
// bars or a line. ~100 lines of Canvas 2D, no library, no build step.

/** Pure: pull numeric values out of a row set. */
export function extractSeries(rows, field, limit = 200) {
  const out = [];
  for (const r of rows) {
    const n = Number(String(r?.[field] ?? '').replace(/[$€£¥,\s]/g, ''));
    if (Number.isFinite(n) && String(r?.[field] ?? '').trim() !== '') out.push(n);
    if (out.length >= limit) break;
  }
  return out;
}

/** Pure-ish: draw into a canvas. Handles HiDPI. */
export function drawMiniChart(canvas, values, { type = 'bar', color = '#7c8cff', label = '' } = {}) {
  if (!canvas || !canvas.getContext) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const dpr = (globalThis.devicePixelRatio || 1);
  const w = canvas.clientWidth || 360;
  const h = canvas.clientHeight || 180;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const pad = { l: 44, r: 12, t: 12, b: 24 };
  const iw = Math.max(1, w - pad.l - pad.r);
  const ih = Math.max(1, h - pad.t - pad.b);
  const max = values.length ? Math.max(...values) : 1;
  const min = Math.min(0, ...(values.length ? values : [0]));
  const span = (max - min) || 1;

  // grid + y labels
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (ih * i) / 4;
    ctx.strokeStyle = 'rgba(139,148,158,.16)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    ctx.fillStyle = '#8b949e';
    ctx.fillText(Math.round(max - (span * i) / 4).toLocaleString('en-US'), pad.l - 7, y);
  }
  if (!values.length) {
    ctx.fillStyle = '#8b949e';
    ctx.textAlign = 'center';
    ctx.fillText('No numeric values in selection', w / 2, h / 2);
    return { count: 0, min: 0, max: 0 };
  }

  if (type === 'line') {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = pad.l + (values.length === 1 ? iw / 2 : (iw * i) / (values.length - 1));
      const y = pad.t + ih - ((v - min) / span) * ih;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ih);
    grad.addColorStop(0, 'rgba(124,140,255,.28)');
    grad.addColorStop(1, 'rgba(124,140,255,0)');
    ctx.lineTo(pad.l + iw, pad.t + ih); ctx.lineTo(pad.l, pad.t + ih); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
  } else {
    const bw = Math.max(1, iw / values.length - 2);
    values.forEach((v, i) => {
      const x = pad.l + (iw * i) / values.length + 1;
      const bh = Math.max(1, ((v - min) / span) * ih);
      const y = pad.t + ih - bh;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.55 + 0.45 * (v / (max || 1));
      ctx.fillRect(x, y, bw, bh);
    });
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = '#8b949e';
  ctx.textAlign = 'left';
  ctx.fillText(`${values.length} values · ${label}`, pad.l, h - 8);
  return { count: values.length, min, max };
}

export class ChartPanel {
  constructor({ sdk } = {}) {
    this.sdk = sdk;
    this.el = document.createElement('div');
    this.el.className = 'af-chart';
    this.el.style.display = 'none';
    const head = document.createElement('div');
    head.className = 'af-chart-head';
    const title = document.createElement('span');
    title.textContent = 'Chart';
    this.titleEl = title;
    const seg = document.createElement('div');
    seg.className = 'af-chart-seg';
    this.type = 'bar';
    for (const t of ['bar', 'line']) {
      const b = document.createElement('button');
      b.textContent = t === 'bar' ? 'Bars' : 'Line';
      b.className = t === 'bar' ? 'is-on' : '';
      b.addEventListener('click', () => {
        this.type = t;
        [...seg.children].forEach((c) => c.classList.toggle('is-on', c === b));
        this.draw();
      });
      seg.appendChild(b);
    }
    const close = document.createElement('button');
    close.className = 'af-chart-close';
    close.textContent = '×';
    close.addEventListener('click', () => this.hide());
    head.append(title, seg, close);
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'af-chart-canvas';
    this.summary = document.createElement('div');
    this.summary.className = 'af-chart-summary';
    this.el.append(head, this.canvas, this.summary);
    document.body.appendChild(this.el);
    this.values = [];
  }

  show({ rows, field, title }) {
    this.values = extractSeries(rows, field);
    this.titleEl.textContent = `Chart · ${title || field}`;
    this.el.style.display = 'block';
    requestAnimationFrame(() => this.draw());
    this.sdk?.emit('chart:open', { field, count: this.values.length });
  }
  hide() { this.el.style.display = 'none'; }
  toggle(opts) { this.el.style.display === 'none' ? this.show(opts) : this.hide(); }
  draw() {
    const r = drawMiniChart(this.canvas, this.values, { type: this.type, label: this.titleEl.textContent });
    if (r) this.summary.textContent = r.count
      ? `min ${r.min.toLocaleString('en-US')} · max ${r.max.toLocaleString('en-US')} · avg ${(this.values.reduce((a, b) => a + b, 0) / r.count).toFixed(1)}`
      : 'Select rows containing numeric values to draw a chart.';
  }
}
