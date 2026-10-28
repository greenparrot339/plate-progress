/* ============================================================
   Plate & Progress — Maximizable interactive charts
   ------------------------------------------------------------
   Double-tap (or double-click) on any chart in the
   PROGRESS tab to open it full screen. In the full-screen view:
     - pinch / mouse-wheel / +  −  buttons  → zoom (both axes)
     - drag (or two-finger drag)             → pan
     - tap / hover a point                   → detailed tooltip
     - line charts: drag the line itself     → it stretches like a rubber band
                    and springs back, wobbling, when released
                    (toggle "Stretch / Pan" to choose what a one-finger drag does)
     - double-tap                            → reset zoom
     - ✕ / Esc / Android back                → close

   This module knows nothing about the app's data. index.html hands it each
   chart's plain-JSON Chart.js config via ChartMax.attach(canvas, json, meta),
   and the full-screen chart is rebuilt from that config, so it always
   matches the small chart. Requires Chart.js 4.x (global `Chart`).
   ============================================================ */

window.ChartMax = (function () {
  'use strict';

  var registry = new WeakMap();   // canvas -> { json, meta }
  var cur = null;                  // the open full-screen session, or null

  var COLORS = { text: '#9A9FA6', faint: '#5D636B', grid: '#2E333A', accent: '#E8B32C', rust: '#C1543A', surface: '#1B1E23' };

  var ICON = {
    expand: '<svg viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg>',
    minus: '<svg viewBox="0 0 24 24"><path d="M5 12h14" stroke-linecap="round"/></svg>',
    reset: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function fmtNum(v) {
    if (v == null || !isFinite(v)) return '—';
    var a = Math.abs(v);
    var d = a >= 100 ? 0 : a >= 10 ? 1 : 2;
    return String(+v.toFixed(d));
  }

  /* ---------------- attach: called for every small chart ---------------- */
  function attach(canvas, json, meta) {
    if (!canvas) return;
    registry.set(canvas, { json: json, meta: meta || {} });
    var wrap = canvas.closest('.chart-wrap');
    if (!wrap || wrap._cmBound) return;
    wrap._cmBound = true;

    // Custom double-tap works the same for touch, pen and mouse.
    var last = null, down = null;
    wrap.addEventListener('pointerdown', function (e) {
      down = { x: e.clientX, y: e.clientY, t: Date.now() };
    });
    wrap.addEventListener('pointerup', function (e) {
      if (!down) return;
      var moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      var now = Date.now();
      down = null;
      if (moved > 12) { last = null; return; }
      if (last && now - last.t < 340 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 36) {
        last = null;
        open(canvas);
      } else {
        last = { x: e.clientX, y: e.clientY, t: now };
      }
    });
    wrap.addEventListener('pointercancel', function () { down = null; });
  }

  /* ---------------- config preparation for the full-screen chart ---------------- */
  function prepare(json, meta) {
    var cfg = JSON.parse(json);
    var kind = cfg.type; // 'line' | 'bar' | 'scatter'
    var labels = (cfg.data && cfg.data.labels) || null;
    var L = labels ? labels.slice() : null;
    var opt = cfg.options = cfg.options || {};
    opt.responsive = true;
    opt.maintainAspectRatio = false;
    opt.animation = false;
    opt.layout = { padding: { top: 14, right: 16, bottom: 6, left: 4 } };
    var scales = opt.scales = opt.scales || {};
    scales.x = scales.x || {};
    scales.y = scales.y || {};
    scales.x.ticks = scales.x.ticks || {};
    scales.y.ticks = scales.y.ticks || {};
    scales.x.ticks.font = { size: 11.5 };
    scales.y.ticks.font = { size: 11.5 };
    scales.y.afterFit = function (sc) { sc.width = kind === 'scatter' ? 58 : 46; };

    var n = 0;
    if (L) {
      // Category chart → linear x axis so it can be zoomed/panned smoothly.
      n = L.length;
      cfg.data.datasets.forEach(function (ds) {
        ds.data = ds.data.map(function (v, i) { return { x: i, y: v }; });
        if (kind === 'line') { ds.pointHitRadius = 22; ds.pointHoverRadius = 7; }
        if (kind === 'bar') { delete ds.maxBarThickness; ds.maxBarThickness = 90; ds.barPercentage = 0.7; ds.categoryPercentage = 0.9; }
      });
      delete cfg.data.labels;
      scales.x.type = 'linear';
      scales.x.min = -0.5;
      scales.x.max = Math.max(n - 0.5, 0.5);
      scales.x.offset = false;
      scales.x.ticks.callback = function (v) { var i = Math.round(v); return Math.abs(v - i) < 1e-6 && L[i] != null ? L[i] : ''; };
      scales.x.afterBuildTicks = function (scale) {
        var lo = Math.ceil(scale.min - 1e-9), hi = Math.floor(scale.max + 1e-9);
        var count = hi - lo + 1;
        var maxTicks = Math.max(2, Math.floor((scale.width || 300) / 74));
        var step = Math.max(1, Math.ceil(count / maxTicks));
        var t = [];
        for (var v = lo; v <= hi; v += step) t.push({ value: v });
        scale.ticks = t;
      };
    } else if (kind === 'scatter') {
      cfg.data.datasets.forEach(function (ds) { ds.pointHitRadius = 16; ds.pointRadius = 6; ds.pointHoverRadius = 9; });
    }

    opt.interaction = (kind === 'scatter')
      ? { mode: 'nearest', intersect: false }
      : { mode: 'nearest', axis: 'x', intersect: false };

    var plugins = opt.plugins = opt.plugins || {};
    plugins.tooltip = {
      enabled: true,
      padding: 12, cornerRadius: 10, displayColors: false,
      backgroundColor: 'rgba(34,38,44,.96)', borderColor: COLORS.grid, borderWidth: 1,
      titleColor: '#EDEAE3', bodyColor: '#EDEAE3', titleFont: { size: 13, weight: '600' }, bodyFont: { size: 12.5 },
      callbacks: {
        title: function (items) {
          var it = items[0]; if (!it) return '';
          if (L) return L[Math.round(it.parsed.x)] || '';
          return meta.title || '';
        },
        label: function (ctx) {
          var ds = ctx.dataset, p = ctx.parsed;
          if (kind === 'scatter') {
            return (meta.xName || 'x') + ': ' + fmtNum(p.x) + (meta.xUnit || '') + '   ·   ' + (meta.yName || 'y') + ': ' + fmtNum(p.y) + (meta.yUnit || '');
          }
          return (ds.label || 'Value') + ': ' + fmtNum(p.y) + (meta.yUnit || '');
        },
        afterLabel: function (ctx) {
          if (kind !== 'line') return '';
          var data = ctx.dataset.data, i = ctx.dataIndex, out = [];
          var prev = null;
          for (var k = i - 1; k >= 0; k--) { if (data[k] && data[k].y != null) { prev = data[k].y; break; } }
          var y = data[i] && data[i].y;
          if (prev != null && y != null) {
            var d = y - prev, pct = prev ? (d / Math.abs(prev)) * 100 : null;
            out.push('Change vs previous: ' + (d >= 0 ? '+' : '') + fmtNum(d) + (pct == null ? '' : ' (' + (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%)'));
          }
          return out;
        }
      }
    };
    plugins.legend = plugins.legend && plugins.legend.display ? plugins.legend : { display: false };
    cfg.plugins = [stretchPlugin];
    return { cfg: cfg, kind: kind, L: L, n: n };
  }

  /* ---------------- rubber-band stretch (line charts) ---------------- */
  function sampleSpline(pts, tension) {
    // pts: [{x,y}] (already without skipped points). Returns a dense polyline using
    // cubic Bezier segments with Catmull-Rom style control points.
    var out = [];
    var k = (tension || 0) * 0.8;
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || pts[i + 1];
      var c1 = { x: p1.x + (p2.x - p0.x) * k, y: p1.y + (p2.y - p0.y) * k };
      var c2 = { x: p2.x - (p3.x - p1.x) * k, y: p2.y - (p3.y - p1.y) * k };
      var steps = 14;
      for (var s = 0; s < steps; s++) {
        var t = s / steps, u = 1 - t;
        out.push({
          x: u * u * u * p1.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p2.x,
          y: u * u * u * p1.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p2.y
        });
      }
    }
    if (pts.length) out.push({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y });
    return out;
  }
  function colorAt(c, i, fallback) { return Array.isArray(c) ? (c[i] || fallback) : (c || fallback); }

  var stretchPlugin = {
    id: 'cmStretch',
    beforeDatasetDraw: function (chart, args) {
      var st = chart._cmStretch;
      if (!st || !st.on || args.index !== st.ds) return;
      drawStretched(chart, args.index, st);
      return false; // we drew this dataset ourselves
    }
  };

  /* The line is modelled as a real elastic string: ~6px-spaced nodes, each joined to its
     neighbours by springs (a discrete wave equation) and weakly tied to its resting spot.
     The node you grab is pinned to your finger with NO limit, the rest of the line is
     dragged after it (a tent shape that follows the finger wherever it goes), and on
     release the pin is dropped and the whole string springs back, wobbling. */
  function buildStretch(chart, di, press) {
    var ds = chart.data.datasets[di], meta = chart.getDatasetMeta(di);
    var pts = [];
    meta.data.forEach(function (p) { if (p && !p.skip && isFinite(p.x) && isFinite(p.y)) pts.push({ x: p.x, y: p.y }); });
    if (pts.length < 2) return null;
    var STEPS = 14;
    var dense = sampleSpline(pts, ds.tension);
    var arc = [0];
    for (var i = 1; i < dense.length; i++) arc.push(arc[i - 1] + Math.hypot(dense[i].x - dense[i - 1].x, dense[i].y - dense[i - 1].y));
    var L = arc[arc.length - 1];
    if (!(L > 1)) return null;
    var n = Math.max(24, Math.round(L / 6)) + 1, h = L / (n - 1);
    var rx = new Float32Array(n), ry = new Float32Array(n), j = 0;
    for (var k = 0; k < n; k++) {
      var t = k * h;
      while (j < arc.length - 2 && arc[j + 1] < t) j++;
      var seg = arc[j + 1] - arc[j], f = seg > 0 ? Math.min(1, Math.max(0, (t - arc[j]) / seg)) : 0;
      rx[k] = dense[j].x + (dense[j + 1].x - dense[j].x) * f;
      ry[k] = dense[j].y + (dense[j + 1].y - dense[j].y) * f;
    }
    var dataNode = pts.map(function (_, q) {
      var di2 = Math.min(dense.length - 1, q * STEPS);
      return clamp(Math.round(arc[di2] / h), 0, n - 1);
    });
    // grabbed node = the one nearest the press point
    var g = 1, best = Infinity;
    for (var m = 1; m < n - 1; m++) { var d = Math.hypot(rx[m] - press.x, ry[m] - press.y); if (d < best) { best = d; g = m; } }
    var W = Math.max(120, chart.chartArea.width);
    var c = W * 2.6;                       // wave speed, px/s
    var lam = Math.min(L * 0.25, Math.max(46, W * 0.17)); // how far a pull reaches along the line, px (local!)
    var kn = (c / h) * (c / h), kr = (c / lam) * (c / lam);
    var w1 = Math.sqrt(kr + Math.pow(Math.PI * c / L, 2));
    return {
      on: true, ds: di, n: n, h: h, g: g, rx: rx, ry: ry, dataNode: dataNode, pts: pts.length,
      ux: new Float32Array(n), uy: new Float32Array(n), vx: new Float32Array(n), vy: new Float32Array(n),
      ax: new Float32Array(n), ay: new Float32Array(n),
      kn: kn, kr: kr, cd: 2 * 0.11 * w1, cv: 0.04 * c / h, dt: 0.4 * h / c,
      pinned: true, px: 0, py: 0, fvx: 0, fvy: 0, raf: 0, last: 0, chart: chart
    };
  }

  function stepStretch(st, frameDt) {
    var n = st.n, ux = st.ux, uy = st.uy, vx = st.vx, vy = st.vy, ax = st.ax, ay = st.ay;
    var steps = Math.min(60, Math.max(1, Math.ceil(frameDt / st.dt))), dt = frameDt / steps;
    for (var s = 0; s < steps; s++) {
      if (st.pinned) { ux[st.g] = st.px; uy[st.g] = st.py; vx[st.g] = 0; vy[st.g] = 0; }
      for (var i = 1; i < n - 1; i++) {
        ax[i] = st.kn * (ux[i - 1] + ux[i + 1] - 2 * ux[i]) - st.kr * ux[i] - st.cd * vx[i] + st.cv * (vx[i - 1] + vx[i + 1] - 2 * vx[i]);
        ay[i] = st.kn * (uy[i - 1] + uy[i + 1] - 2 * uy[i]) - st.kr * uy[i] - st.cd * vy[i] + st.cv * (vy[i - 1] + vy[i + 1] - 2 * vy[i]);
      }
      for (var k = 1; k < n - 1; k++) {
        if (st.pinned && k === st.g) continue;
        vx[k] += ax[k] * dt; vy[k] += ay[k] * dt;
        ux[k] += vx[k] * dt; uy[k] += vy[k] * dt;
      }
    }
  }

  function stretchEnergy(st) {
    var e = 0;
    for (var i = 0; i < st.n; i++) e += Math.abs(st.ux[i]) + Math.abs(st.uy[i]) + 0.04 * (Math.abs(st.vx[i]) + Math.abs(st.vy[i]));
    return e / st.n;
  }

  function runStretch(S, st) {
    cancelAnimationFrame(st.raf);
    st.last = performance.now();
    function frame(now) {
      if (S.closed || S.chart._cmStretch !== st) return;
      var dt = Math.min(0.033, Math.max(0.001, (now - st.last) / 1000)); st.last = now;
      stepStretch(st, dt);
      S.chart.draw();
      if (!st.pinned && stretchEnergy(st) < 0.12) {
        st.on = false; S.chart._cmStretch = null; S.chart.draw(); return;
      }
      st.raf = requestAnimationFrame(frame);
    }
    st.raf = requestAnimationFrame(frame);
  }

  function drawStretched(chart, di, st) {
    var ctx = chart.ctx, area = chart.chartArea, ds = chart.data.datasets[di];
    var line = [];
    for (var i = 0; i < st.n; i++) line.push({ x: st.rx[i] + st.ux[i], y: st.ry[i] + st.uy[i] });
    var color = ds.borderColor || COLORS.accent;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, chart.width, chart.height);   // may be pulled anywhere on the canvas
    ctx.clip();

    if (ds.fill && line.length > 1) {
      ctx.beginPath();
      line.forEach(function (p, i) { i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
      ctx.lineTo(line[line.length - 1].x, area.bottom); ctx.lineTo(line[0].x, area.bottom); ctx.closePath();
      ctx.fillStyle = ds.backgroundColor || 'rgba(232,179,44,0.1)';
      ctx.fill();
    }
    ctx.beginPath();
    line.forEach(function (p, i) { i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
    ctx.strokeStyle = color; ctx.lineWidth = (ds.borderWidth || 2) + 0.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.stroke();

    var r = ds.pointRadius == null ? 4 : ds.pointRadius;
    if (r > 0) {
      st.dataNode.forEach(function (ni, k) {
        var q = line[ni];
        ctx.beginPath(); ctx.arc(q.x, q.y, r + 0.5, 0, Math.PI * 2);
        ctx.fillStyle = colorAt(ds.pointBackgroundColor, k, color); ctx.fill();
        ctx.lineWidth = ds.pointBorderWidth == null ? 2 : ds.pointBorderWidth;
        ctx.strokeStyle = colorAt(ds.pointBorderColor, k, COLORS.surface); ctx.stroke();
      });
    }
    if (st.pinned) {
      var gp = line[st.g];
      ctx.beginPath(); ctx.arc(gp.x, gp.y, 9, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(237,234,227,.55)'; ctx.lineWidth = 2; ctx.stroke();
    }
    ctx.restore();
  }

  function nearestLine(chart, x, y) {
    // distance from (x,y) to every dataset's polyline; returns { ds, dist }
    var best = { ds: -1, dist: Infinity };
    chart.data.datasets.forEach(function (ds, di) {
      var m = chart.getDatasetMeta(di);
      if (m.hidden) return;
      var pts = m.data.filter(function (p) { return p && !p.skip && isFinite(p.x) && isFinite(p.y); });
      if (pts.length === 1) {
        var d1 = Math.hypot(x - pts[0].x, y - pts[0].y);
        if (d1 < best.dist) best = { ds: di, dist: d1 };
      }
      for (var i = 0; i < pts.length - 1; i++) {
        var a = pts[i], b = pts[i + 1];
        var vx = b.x - a.x, vy = b.y - a.y, len2 = vx * vx + vy * vy;
        var t = len2 ? clamp(((x - a.x) * vx + (y - a.y) * vy) / len2, 0, 1) : 0;
        var d = Math.hypot(x - (a.x + t * vx), y - (a.y + t * vy));
        if (d < best.dist) best = { ds: di, dist: d };
      }
    });
    return best;
  }

  function releaseSpring(S) {
    var st = S.chart._cmStretch;
    if (!st) return;
    st.pinned = false;
    // hand the finger's last velocity to the released node so a flick keeps its momentum
    st.vx[st.g] = clamp(st.fvx, -2500, 2500); st.vy[st.g] = clamp(st.fvy, -2500, 2500);
    runStretch(S, st);
  }

  /* ---------------- view (zoom / pan) ---------------- */
  function viewLimits(S) {
    var b = S.base;
    var minSx = Math.min(b.x1 - b.x0, S.kind === 'scatter' ? (b.x1 - b.x0) * 0.03 : Math.max((b.x1 - b.x0) * 0.04, 1.5));
    var minSy = (b.y1 - b.y0) * 0.03;
    return { minSx: minSx, minSy: minSy, maxSx: b.x1 - b.x0, maxSy: b.y1 - b.y0 };
  }
  // silent=true  -> store the view and apply it once on the next animation frame (used by
  //                 touch gestures, which can fire several times per frame)
  // silent=false -> apply immediately (used by animations, which already run per frame)
  function setView(S, v, silent) {
    var b = S.base, L = viewLimits(S);
    var sx = clamp(v.x1 - v.x0, L.minSx, L.maxSx), sy = clamp(v.y1 - v.y0, L.minSy, L.maxSy);
    var x0 = clamp(v.x0, b.x0, b.x1 - sx), y0 = clamp(v.y0, b.y0, b.y1 - sy);
    S.view = { x0: x0, x1: x0 + sx, y0: y0, y1: y0 + sy };
    if (silent) {
      if (!S.viewDirty) {
        S.viewDirty = true;
        S.applyRaf = requestAnimationFrame(function () { S.viewDirty = false; if (!S.closed) applyView(S); });
      }
    } else {
      applyView(S);
    }
  }
  function applyView(S) {
    var o = S.chart.options.scales;
    o.x.min = S.view.x0; o.x.max = S.view.x1; o.y.min = S.view.y0; o.y.max = S.view.y1;
    S.chart.update('none');
    var now = performance.now();
    if (!S.lastReadout || now - S.lastReadout > 110) { S.lastReadout = now; updateReadout(S); }
    updateZoomLabel(S);
  }
  function animateView(S, target) {
    cancelAnimationFrame(S.viewRaf);
    var from = S.view, t0 = performance.now(), dur = 240;
    function frame(now) {
      if (S.closed) return;
      var t = clamp((now - t0) / dur, 0, 1), e = 1 - Math.pow(1 - t, 3);
      setView(S, {
        x0: from.x0 + (target.x0 - from.x0) * e, x1: from.x1 + (target.x1 - from.x1) * e,
        y0: from.y0 + (target.y0 - from.y0) * e, y1: from.y1 + (target.y1 - from.y1) * e
      });
      if (t < 1) S.viewRaf = requestAnimationFrame(frame);
    }
    S.viewRaf = requestAnimationFrame(frame);
  }
  /* ---------------- readout (visible-window stats) ---------------- */
  function updateZoomLabel(S) {
    var el = S.el.querySelector('.cm-zoom');
    if (!el) return;
    var z = (S.base.x1 - S.base.x0) / (S.view.x1 - S.view.x0);
    el.textContent = z < 1.05 ? 'Fit' : z.toFixed(1) + '×';
  }
  function updateReadout(S) {
    var box = S.el.querySelector('.cm-readout');
    if (!box) return;
    var v = S.view, ds = S.chart.data.datasets[0];
    if (!ds) { box.innerHTML = ''; return; }
    var inView = ds.data.filter(function (p) { return p && p.y != null && p.x >= v.x0 - 1e-9 && p.x <= v.x1 + 1e-9 && p.y >= v.y0 - 1e-9 && p.y <= v.y1 + 1e-9; });
    var ys = inView.map(function (p) { return p.y; });
    var total = ds.data.filter(function (p) { return p && p.y != null; }).length;
    var chips = [];
    function chip(label, val) { chips.push('<div class="cm-chip"><span>' + esc(label) + '</span><b>' + esc(val) + '</b></div>'); }
    if (S.kind === 'scatter') {
      var xs = inView.map(function (p) { return p.x; });
      chip('Sets shown', inView.length + ' / ' + total);
      chip('Weight', xs.length ? fmtNum(Math.min.apply(null, xs)) + '–' + fmtNum(Math.max.apply(null, xs)) + ' kg' : '—');
      chip('Max reps', ys.length ? fmtNum(Math.max.apply(null, ys)) : '—');
      chip('Avg reps', ys.length ? fmtNum(ys.reduce(function (a, b) { return a + b; }, 0) / ys.length) : '—');
    } else {
      chip('Points shown', inView.length + ' / ' + total);
      chip('Min', ys.length ? fmtNum(Math.min.apply(null, ys)) : '—');
      chip('Max', ys.length ? fmtNum(Math.max.apply(null, ys)) : '—');
      chip('Avg', ys.length ? fmtNum(ys.reduce(function (a, b) { return a + b; }, 0) / ys.length) : '—');
      if (S.kind === 'line' && ys.length > 1) {
        var d = ys[ys.length - 1] - ys[0];
        chip('First → last', (d >= 0 ? '+' : '') + fmtNum(d));
      }
    }
    box.innerHTML = chips.join('');
  }

  /* ---------------- open / close ---------------- */
  function open(canvas) {
    if (cur) return;
    var reg = registry.get(canvas);
    if (!reg || typeof Chart === 'undefined') return;
    var meta = reg.meta || {};
    var prep = prepare(reg.json, meta);
    var card = canvas.closest('.card');
    var titleEl = card && card.querySelector('.card-title');
    var title = meta.title || (titleEl ? titleEl.textContent : 'Chart');
    var isLine = prep.kind === 'line';

    var el = document.createElement('div');
    el.id = 'chart-max-overlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML =
      '<div class="cm-header">' +
        '<span class="cm-title">' + esc(title) + '</span>' +
        '<div class="cm-tools">' +
          '<button type="button" class="cm-btn cm-close" data-act="close" aria-label="Close">' + ICON.close + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="cm-readout"></div>' +
      '<div class="cm-stage"><canvas></canvas></div>' +
      '<div class="cm-hint"></div>';
    document.body.appendChild(el);
    document.body.style.overflow = 'hidden';

    var cv = el.querySelector('canvas');
    var chart = new Chart(cv, prep.cfg);

    var S = cur = {
      el: el, canvas: cv, chart: chart, kind: prep.kind, closed: false, mode: isLine ? 'stretch' : 'pan',
      base: null, view: null, pointers: new Map(), gesture: null, lastTap: null, viewRaf: 0
    };

    // Lock the auto-computed ranges as the "fit" view.
    var sx = chart.scales.x, sy = chart.scales.y;
    S.base = { x0: sx.min, x1: sx.max, y0: sy.min, y1: sy.max };
    if (S.base.y1 <= S.base.y0) S.base.y1 = S.base.y0 + 1;
    S.view = { x0: S.base.x0, x1: S.base.x1, y0: S.base.y0, y1: S.base.y1 };
    setView(S, S.view);
    setHint(S);

    el.addEventListener('click', function (e) {
      if (e.target.closest('[data-act="close"]')) close();
    });

    bindGestures(S);
    S.onKey = function (e) { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', S.onKey);
    S.onResize = function () { chart.resize(); };
    window.addEventListener('resize', S.onResize);
    requestAnimationFrame(function () { el.classList.add('open'); });
  }

  function setHint(S) {
    var h = S.el.querySelector('.cm-hint');
    h.innerHTML = S.kind === 'line'
      ? 'Pinch to zoom &middot; drag to move &middot; pull the line to stretch it &middot; double-tap to reset'
      : 'Pinch to zoom &middot; drag to move &middot; tap a point for details &middot; double-tap to reset';
  }

  function bindGestures(S) {
    var stage = S.el.querySelector('.cm-stage');
    var cv = S.canvas;
    cv.style.touchAction = 'none';
    var STRETCH_HIT = 26;   // px from the line that counts as "grabbing the line"

    function pos(e) { var r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    // pixel -> data value for a given view (own maths, independent of Chart.js internals)
    function toData(v, a, p) {
      return { x: v.x0 + (p.x - a.left) / a.width * (v.x1 - v.x0), y: v.y1 - (p.y - a.top) / a.height * (v.y1 - v.y0) };
    }
    function metrics() {
      var a = S.chart.chartArea, pts = Array.from(S.pointers.values()), m, d = 0;
      if (pts.length >= 2) {
        m = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      } else { m = pts[0] || { x: 0, y: 0 }; }
      return { a: a, mid: m, dist: d };
    }
    // Remember where the view started and which data point sits under the fingers; every
    // move then recomputes the view from that snapshot, so it never drifts or lags.
    function snapshot(g) {
      var m = metrics();
      g.v0 = { x0: S.view.x0, x1: S.view.x1, y0: S.view.y0, y1: S.view.y1 };
      g.dist0 = Math.max(24, m.dist);
      g.anchor = toData(g.v0, m.a, m.mid);
    }
    function applyGesture(g) {
      var m = metrics(), a = m.a, L = viewLimits(S);
      var f = S.pointers.size >= 2 ? clamp(g.dist0 / Math.max(24, m.dist), 0.02, 50) : 1;
      var sx = clamp((g.v0.x1 - g.v0.x0) * f, L.minSx, L.maxSx), sy = clamp((g.v0.y1 - g.v0.y0) * f, L.minSy, L.maxSy);
      var x0 = g.anchor.x - (m.mid.x - a.left) / a.width * sx;
      var y1 = g.anchor.y + (m.mid.y - a.top) / a.height * sy;
      setView(S, { x0: x0, x1: x0 + sx, y0: y1 - sy, y1: y1 }, true);
    }

    // While a gesture is running, keep Chart.js from fighting us with tooltips.
    stage.addEventListener('pointermove', function (e) { if (S.gesture && S.gesture.moved) e.stopPropagation(); }, true);

    stage.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
      var p = pos(e);
      S.pointers.set(e.pointerId, p);
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      var g = S.gesture || (S.gesture = { moved: false, type: null, startPos: p, last: p });
      if (S.pointers.size >= 2) {
        // a second finger: let go of any stretch (it springs back) and switch to pinch
        if (S.chart._cmStretch && S.chart._cmStretch.pinned) releaseSpring(S);
        g.type = 'pinch'; g.moved = true; g.pendingStretch = null;
        snapshot(g);
        return;
      }
      g.type = null; g.moved = false; g.startPos = p; g.last = p; g.lastT = 0;
      snapshot(g);
      var wantsStretch = S.kind === 'line' && !e.shiftKey && e.button !== 1;
      if (wantsStretch) {
        var hit = nearestLine(S.chart, p.x, p.y);
        if (hit.dist < STRETCH_HIT) g.pendingStretch = { ds: hit.ds, ax: p.x, ay: p.y };
      }
    });

    function onMove(e) {
      var g = S.gesture;
      if (!g || !S.pointers.has(e.pointerId)) return;
      var p = pos(e);
      S.pointers.set(e.pointerId, p);

      if (S.pointers.size >= 2) { applyGesture(g); return; }

      var dx = p.x - g.startPos.x, dy = p.y - g.startPos.y;
      if (!g.moved && Math.hypot(dx, dy) < 5) return;
      if (!g.moved) {
        g.moved = true;
        S.chart.setActiveElements([]);
        if (S.chart.tooltip) S.chart.tooltip.setActiveElements([], { x: 0, y: 0 });
        var ns = null;
        if (g.pendingStretch) {
          var ps = g.pendingStretch;
          var old = S.chart._cmStretch; if (old) cancelAnimationFrame(old.raf);
          ns = buildStretch(S.chart, ps.ds, { x: ps.ax, y: ps.ay });
          S.chart._cmStretch = ns;
          if (ns) runStretch(S, ns);
        }
        if (ns) { g.type = 'stretch'; cv.style.cursor = 'grabbing'; }
        else { g.type = 'pan'; snapshot(g); }
      }
      if (g.type === 'stretch') {
        var st = S.chart._cmStretch; if (!st) return;
        var nowT = performance.now();
        if (g.lastT) { var dtm = Math.max(1, nowT - g.lastT) / 1000; st.fvx = (p.x - g.last.x) / dtm; st.fvy = (p.y - g.last.y) / dtm; }
        g.lastT = nowT; g.last = p;
        st.px = dx; st.py = dy;
      } else if (g.type === 'pan') {
        applyGesture(g);
      }
    }

    function onUp(e) {
      var g = S.gesture;
      if (!S.pointers.has(e.pointerId)) return;
      var p = pos(e);
      S.pointers.delete(e.pointerId);
      if (S.pointers.size === 0) {
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        cv.style.cursor = '';
        if (g && g.type === 'stretch') releaseSpring(S);
        updateReadout(S);
        // double-tap -> reset zoom
        if (g && !g.moved && e.type === 'pointerup') {
          var now = Date.now();
          if (S.lastTap && now - S.lastTap.t < 340 && Math.hypot(p.x - S.lastTap.x, p.y - S.lastTap.y) < 36) {
            S.lastTap = null;
            animateView(S, S.base);
          } else {
            S.lastTap = { x: p.x, y: p.y, t: now };
          }
        }
        S.gesture = null;
      } else if (g) {
        // one finger lifted: carry on as a pan from the finger that remains, without a jump
        g.type = 'pan'; g.moved = true; g.pendingStretch = null;
        snapshot(g);
      }
    }

    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      var p = pos(e), a = S.chart.chartArea, v = S.view;
      var f = Math.exp(e.deltaY * (e.ctrlKey ? 0.012 : 0.0018));
      var an = toData(v, a, p), L = viewLimits(S);
      var sx = clamp((v.x1 - v.x0) * f, L.minSx, L.maxSx), sy = clamp((v.y1 - v.y0) * f, L.minSy, L.maxSy);
      var x0 = an.x - (p.x - a.left) / a.width * sx, y1 = an.y + (p.y - a.top) / a.height * sy;
      setView(S, { x0: x0, x1: x0 + sx, y0: y1 - sy, y1: y1 }, true);
    }, { passive: false });

    S.cleanupGestures = function () {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }

  function close() {
    var S = cur;
    if (!S) return;
    S.closed = true;
    cur = null;
    cancelAnimationFrame(S.viewRaf); cancelAnimationFrame(S.applyRaf);
    var st = S.chart._cmStretch; if (st) cancelAnimationFrame(st.raf);
    if (S.cleanupGestures) S.cleanupGestures();
    document.removeEventListener('keydown', S.onKey);
    window.removeEventListener('resize', S.onResize);
    try { S.chart.destroy(); } catch (e) { /* ignore */ }
    S.el.remove();
    document.body.style.overflow = '';
  }

  return { attach: attach, open: open, close: close, isOpen: function () { return !!cur; } };
})();
