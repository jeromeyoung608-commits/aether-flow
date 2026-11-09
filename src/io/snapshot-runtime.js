// snapshot-runtime.js — the tiny read-only viewer embedded into Share HTML.
//
// This function is intentionally SELF-CONTAINED: no imports, no module scope,
// no network primitives, no persistence, no write path. Its own source is
// stringified into the generated .html file, so the Brief works offline
// from file:// forever.
//
// It is a real virtual scroller: constant DOM node count regardless of row count.

/* istanbul ignore next -- exercised in a browser, not in Node */
export function snapshotRuntime() {
  var node = document.getElementById('aether-data');
  var model = JSON.parse(node.textContent);
  var columns = model.columns || [];
  var rows = model.rows || [];
  var ROW_H = 32;
  var OVERSCAN = 6;

  var viewport = document.getElementById('viewport');
  var spacer = document.getElementById('spacer');
  var head = document.getElementById('head');
  var countEl = document.getElementById('count');
  var search = document.getElementById('search');

  // Coalesce scroll work to one frame. Falls back to a timer on hosts that do
  // not expose requestAnimationFrame (e.g. minimal DOM shims).
  var raf = (typeof window !== 'undefined' && window.requestAnimationFrame)
    ? function (cb) { return window.requestAnimationFrame(cb); }
    : function (cb) { return setTimeout(cb, 16); };

  var total = columns.reduce(function (s, c) { return s + (c.width || 120); }, 0);
  head.style.width = total + 'px';
  spacer.style.width = total + 'px';
  for (var c = 0; c < columns.length; c++) {
    var cell = document.createElement('div');
    cell.className = 'hcell';
    cell.style.width = (columns[c].width || 120) + 'px';
    cell.style.textAlign = columns[c].align || 'left';
    cell.textContent = columns[c].header || columns[c].field;
    head.appendChild(cell);
  }

  var view = [];
  var pool = [];

  // KEEP IN SYNC with formatSnapshotValue() in src/io/snapshot-html.js.
  // The two implementations MUST be identical: the runtime is inlined via
  // .toString() and cannot reference that helper, so Node tests call it directly.
  function fmt(v, type) {
    if (v == null || v === '') return '';
    var s = String(v);
    if ((type === 'number' || type === 'currency') &&
        /^-?(0|[1-9]\d{0,14})(\.\d{1,6})?$/.test(s)) {
      return Number(s).toLocaleString('en-US');
    }
    return s;
  }

  // headwrap has overflow:hidden, so translating #head is the most stable way
  // to keep column headers aligned while #viewport scrolls horizontally.
  function syncHead() {
    head.style.transform = 'translateX(' + (-viewport.scrollLeft) + 'px)';
  }

  function paint(k, index) {
    var row = rows[view[index]];
    var el = pool[k];
    if (!row) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.style.transform = 'translateY(' + (index * ROW_H) + 'px)';
    if (el.children.length !== columns.length) {
      el.textContent = '';
      for (var j = 0; j < columns.length; j++) {
        var d = document.createElement('div');
        d.className = 'cell';
        d.style.width = (columns[j].width || 120) + 'px';
        d.style.textAlign = columns[j].align || 'left';
        el.appendChild(d);
      }
    }
    // Only fields declared in columns are rendered; extra row keys are ignored.
    for (var i = 0; i < columns.length; i++) {
      el.children[i].textContent = fmt(row[columns[i].field], columns[i].type);
    }
  }

  function render() {
    spacer.style.height = (view.length * ROW_H) + 'px';
    var st = viewport.scrollTop;
    var first = Math.floor(st / ROW_H);
    var visible = Math.ceil(viewport.clientHeight / ROW_H);
    var start = Math.max(0, first - OVERSCAN);
    var end = Math.min(view.length, first + visible + OVERSCAN);
    var needed = end - start;
    while (pool.length < needed) {
      var el = document.createElement('div');
      el.className = 'row';
      spacer.appendChild(el);
      pool.push(el);
    }
    for (var k = 0; k < pool.length; k++) {
      if (k >= needed) { pool[k].style.display = 'none'; continue; }
      paint(k, start + k);
    }
  }

  var scrollPending = false;
  function onScroll() {
    if (scrollPending) return;
    scrollPending = true;
    raf(function () {
      scrollPending = false;
      syncHead();
      render();
    });
  }

  function applySearch(term) {
    var q = String(term || '').trim().toLowerCase();
    view = [];
    if (!q) {
      for (var i = 0; i < rows.length; i++) view.push(i);
    } else {
      for (var r = 0; r < rows.length; r++) {
        for (var c2 = 0; c2 < columns.length; c2++) {
          var val = rows[r][columns[c2].field];
          if (String(val == null ? '' : val).toLowerCase().indexOf(q) !== -1) {
            view.push(r); break;
          }
        }
      }
    }
    viewport.scrollTop = 0;
    countEl.textContent = view.length.toLocaleString('en-US') + ' / ' + rows.length.toLocaleString('en-US') + ' rows';
    render();
  }

  // Debounce the full-table scan (~120ms). Clearing the filter is immediate,
  // and a lightweight "Filtering..." note keeps the UI responsive while typing.
  var searchTimer = null;
  search.addEventListener('input', function () {
    var value = search.value;
    if (searchTimer !== null) { clearTimeout(searchTimer); searchTimer = null; }
    if (!value) {
      applySearch('');
      return;
    }
    countEl.textContent = 'Filtering...';
    searchTimer = setTimeout(function () {
      searchTimer = null;
      applySearch(value);
    }, 120);
  });

  viewport.addEventListener('scroll', onScroll);
  window.addEventListener('resize', function () { syncHead(); render(); });

  // Brief Canvas chart: compact bar chart of the sampled numeric column. Runs
  // after the DOM is laid out (this script sits at the end of <body>), so the
  // canvas already has a measured width to draw into. No network, no deps.
  function drawChart() {
    var cv = document.getElementById('chart');
    if (!cv || !model.chart || !model.chart.values || !model.chart.values.length) return;
    var values = model.chart.values;
    var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
    var w = cv.clientWidth || (cv.parentNode ? cv.parentNode.clientWidth : 600) || 600;
    var h = 180;
    cv.width = Math.max(1, Math.floor(w * dpr));
    cv.height = Math.max(1, Math.floor(h * dpr));
    var ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    var max = 0;
    for (var i = 0; i < values.length; i++) if (values[i] > max) max = values[i];
    if (max <= 0) max = 1;
    var pad = 10;
    var n = values.length;
    var bw = (w - pad * 2) / n;
    var baseline = h - 16;
    ctx.fillStyle = '#7c8cff';
    for (var b = 0; b < n; b++) {
      var bh = Math.max(1, (values[b] / max) * (baseline - pad));
      var x = pad + b * bw;
      ctx.fillRect(x, baseline - bh, Math.max(1, bw - 2), bh);
    }
    ctx.strokeStyle = '#232b36';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, baseline + 0.5);
    ctx.lineTo(w - pad, baseline + 0.5);
    ctx.stroke();
    ctx.restore();
  }
  drawChart();

  applySearch('');
  syncHead();
}
