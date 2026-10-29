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

  /* ---------------- small helpers ---------------- */
  function buzz(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* ignore */ } }
  function dayNum(d) { var t = Date.parse(d + 'T00:00:00'); return isFinite(t) ? t / 864e5 : NaN; }
  function fmtDay(d) {
    var t = Date.parse(d + 'T00:00:00');
    if (!isFinite(t)) return d || '—';
    try { return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); } catch (e) { return d; }
  }
  function validPt(p) { return p && isFinite(p.x) && isFinite(p.y) && p.x != null && p.y != null; }
  function dataRange(data) {
    var xs = [], ys = [];
    data.forEach(function (p) { if (validPt(p)) { xs.push(p.x); ys.push(p.y); } });
    if (!xs.length) return { x0: 0, x1: 1, y0: 0, y1: 1 };
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs), maxY = Math.max.apply(null, ys);
    var padX = (maxX - minX) * 0.08 || Math.max(2.5, Math.abs(maxX) * 0.1);
    var x0 = minX - padX; if (minX >= 0) x0 = Math.max(0, x0);
    return { x0: x0, x1: maxX + padX, y0: 0, y1: maxY + Math.max(1, maxY * 0.12) };
  }
  // Sets with identical weight & reps share one bubble.
  function buildGroups(data) {
    var map = {}, list = [];
    data.forEach(function (p, i) {
      if (!validPt(p)) return;
      var k = p.x + '|' + p.y, g = map[k];
      if (!g) { g = map[k] = { gi: list.length, x: p.x, y: p.y, n: 0, first: p.d || '', last: p.d || '', idxs: [], ux: 0, uy: 0, vx: 0, vy: 0, t: 1 }; list.push(g); }
      g.n++; g.idxs.push(i);
      if (p.d) { if (!g.last || p.d > g.last) g.last = p.d; if (!g.first || p.d < g.first) g.first = p.d; }
    });
    var lo = Infinity, hi = -Infinity;
    list.forEach(function (g) { var d = dayNum(g.last); if (isFinite(d)) { lo = Math.min(lo, d); hi = Math.max(hi, d); } });
    list.forEach(function (g) { var d = dayNum(g.last); g.t = (isFinite(d) && hi > lo) ? (d - lo) / (hi - lo) : 1; });
    return list;
  }
  var RC = { a: [77, 94, 120], b: [193, 84, 58], c: [232, 179, 44] };
  function recencyColor(t, alpha) {
    var A, B, u;
    if (t < 0.5) { A = RC.a; B = RC.b; u = t / 0.5; } else { A = RC.b; B = RC.c; u = (t - 0.5) / 0.5; }
    function m(i) { return Math.round(A[i] + (B[i] - A[i]) * u); }
    return 'rgba(' + m(0) + ',' + m(1) + ',' + m(2) + ',' + (alpha == null ? 1 : alpha) + ')';
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

    var n = 0, ranges = null, groups = null, groupOf = [];
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
      cfg.data.datasets.forEach(function (ds) { ds.pointHitRadius = 18; ds.pointRadius = 6; ds.pointHoverRadius = 9; });
      // Explicit axis ranges: never depend on Chart.js auto-scaling at open time.
      var rg = dataRange(cfg.data.datasets[0].data);
      scales.x.min = rg.x0; scales.x.max = rg.x1; scales.y.min = rg.y0; scales.y.max = rg.y1;
      scales.x.type = 'linear'; scales.y.type = 'linear';
      ranges = rg;
      groups = buildGroups(cfg.data.datasets[0].data);
      groups.forEach(function (g) { g.idxs.forEach(function (i) { groupOf[i] = g; }); });
    }

    opt.interaction = (kind === 'scatter')
      ? { mode: 'nearest', intersect: false }
      : { mode: 'nearest', axis: 'x', intersect: false };

    var plugins = opt.plugins = opt.plugins || {};
    plugins.tooltip = {
      enabled: true,
      events: [],            // never shown by hover/touch-move; the tap handler shows it on demand
      padding: 12, cornerRadius: 10, displayColors: false,
      backgroundColor: 'rgba(34,38,44,.96)', borderColor: COLORS.grid, borderWidth: 1,
      titleColor: '#EDEAE3', bodyColor: '#EDEAE3', titleFont: { size: 13, weight: '600' }, bodyFont: { size: 12.5 },
      callbacks: {
        title: function (items) {
          var it = items[0]; if (!it) return '';
          if (L) return L[Math.round(it.parsed.x)] || '';
          if (kind === 'scatter') { var g0 = groupOf[it.dataIndex]; if (g0) return fmtNum(g0.x) + (meta.xUnit || '') + '  ×  ' + fmtNum(g0.y) + ' reps'; }
          return meta.title || '';
        },
        label: function (ctx) {
          var ds = ctx.dataset, p = ctx.parsed;
          if (kind === 'scatter') {
            var g1 = groupOf[ctx.dataIndex];
            return g1 ? g1.n + (g1.n > 1 ? ' sets at this weight & reps' : ' set') : '';
          }
          return (ds.label || 'Value') + ': ' + fmtNum(p.y) + (meta.yUnit || '');
        },
        afterLabel: function (ctx) {
          if (kind === 'scatter') {
            var g2 = groupOf[ctx.dataIndex];
            if (!g2 || !g2.last) return '';
            return g2.n > 1 && g2.first !== g2.last ? 'First ' + fmtDay(g2.first) + '  ·  last ' + fmtDay(g2.last) : 'Done ' + fmtDay(g2.last);
          }
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
    return { cfg: cfg, kind: kind, L: L, n: n, ranges: ranges, groups: groups, groupOf: groupOf };
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
      var S = chart._cmS;
      if (S && S.kind === 'scatter') { if (args.index === 0) drawScatter(chart, S); return false; }
      if (S && S.kind === 'bar') { if (args.index === 0) drawBars(chart, S); return false; }
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
      kn: kn, kr: kr, cd: 2 * 0.17 * w1, cd0: 2 * 0.17 * w1, relT: 0, cv: 0.04 * c / h, dt: 0.4 * h / c,
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
      var over = false;
      if (!st.pinned) {
        if (!st.relT) st.relT = now;
        var age = (now - st.relT) / 1000;
        st.cd = st.cd0 * (1 + Math.max(0, age - 0.45) * 7);   // wobble first, then settle quickly
        over = age > 1.4;
      }
      stepStretch(st, dt);
      S.chart.draw();
      if (!st.pinned && (over || stretchEnergy(st) < 0.35)) {
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
  function killStretch(S) {
    var st = S.chart && S.chart._cmStretch;
    if (st) { cancelAnimationFrame(st.raf); S.chart._cmStretch = null; }
  }
  function setView(S, v, silent) {
    killStretch(S);   // a stretched line is drawn in old screen coordinates, so any zoom/pan ends it at once
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
    var chips = [];
    function chip(label, val) { chips.push('<div class="cm-chip"><span>' + esc(label) + '</span><b>' + esc(val) + '</b></div>'); }
    var avg = function (arr) { return arr.length ? arr.reduce(function (p, q) { return p + q; }, 0) / arr.length : null; };
    if (S.kind === 'scatter') {
      var sel = S.sel && S.sel.size;
      var gs = S.groups.filter(function (g) { return sel ? S.sel.has(g.gi) : (g.x >= v.x0 - 1e-9 && g.x <= v.x1 + 1e-9 && g.y >= v.y0 - 1e-9 && g.y <= v.y1 + 1e-9); });
      var total = S.groups.reduce(function (p, g) { return p + g.n; }, 0);
      var cntSets = gs.reduce(function (p, g) { return p + g.n; }, 0);
      var xs = gs.map(function (g) { return g.x; });
      chip(sel ? 'Lassoed sets' : 'Sets shown', cntSets + ' / ' + total);
      chip('Weight', xs.length ? fmtNum(Math.min.apply(null, xs)) + '–' + fmtNum(Math.max.apply(null, xs)) + ' kg' : '—');
      chip('Max reps', gs.length ? fmtNum(Math.max.apply(null, gs.map(function (g) { return g.y; }))) : '—');
      var wsum = gs.reduce(function (p, g) { return p + g.y * g.n; }, 0);
      chip('Avg reps', cntSets ? fmtNum(wsum / cntSets) : '—');
    } else {
      var inView = ds.data.filter(function (p) { return validPt(p) && p.x >= v.x0 - 1e-9 && p.x <= v.x1 + 1e-9 && p.y >= v.y0 - 1e-9 && p.y <= v.y1 + 1e-9; });
      var ys = inView.map(function (p) { return p.y; });
      var tot = ds.data.filter(validPt).length, av = avg(ys);
      chip('Points shown', inView.length + ' / ' + tot);
      chip('Min', ys.length ? fmtNum(Math.min.apply(null, ys)) : '—');
      chip('Max', ys.length ? fmtNum(Math.max.apply(null, ys)) : '—');
      chip('Avg', av == null ? '—' : fmtNum(av));
      if (S.kind === 'line' && ys.length > 1) { var d = ys[ys.length - 1] - ys[0]; chip('First → last', (d >= 0 ? '+' : '') + fmtNum(d)); }
    }
    box.innerHTML = chips.join('');
    updateTable(S);
  }

  /* ---------------- scatter: bubbles, magnet finger, lasso ---------------- */
  function groupPx(chart, g) {
    var a = chart.chartArea, sx = chart.scales.x, sy = chart.scales.y;
    return { x: a.left + (g.x - sx.min) / (sx.max - sx.min) * a.width, y: a.bottom - (g.y - sy.min) / (sy.max - sy.min) * a.height };
  }
  function bubbleR(g) { return 5 + Math.min(11, 3.4 * Math.sqrt(g.n - 1)); }

  function drawScatter(chart, S) {
    var ctx = chart.ctx, a = chart.chartArea, groups = S.groups || [];
    ctx.save();
    ctx.beginPath(); ctx.rect(a.left - 12, a.top - 12, a.width + 24, a.height + 24); ctx.clip();
    var hasSel = S.sel && S.sel.size > 0;
    var order = groups.slice().sort(function (p, q) { return q.n - p.n; });   // big bubbles underneath
    order.forEach(function (g) {
      var b = groupPx(chart, g), x = b.x + g.ux, y = b.y + g.uy, r = bubbleR(g);
      var on = !hasSel || S.sel.has(g.gi);
      ctx.globalAlpha = on ? 1 : 0.2;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = recencyColor(g.t, 0.88); ctx.fill();
      ctx.lineWidth = (hasSel && on) || S.tip === g.gi ? 2.5 : 1.5;
      ctx.strokeStyle = (hasSel && on) || S.tip === g.gi ? '#EDEAE3' : COLORS.surface; ctx.stroke();
      if (g.n > 1 && r >= 9) {
        ctx.fillStyle = '#14161A'; ctx.font = '600 10px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(g.n), x, y + 0.5);
      }
    });
    ctx.globalAlpha = 1;
    // magnet field
    var m = S.mag;
    if (m && m.on) {
      ctx.beginPath(); ctx.arc(m.x, m.y, MAGNET_R, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(232,179,44,.06)'; ctx.fill();
      ctx.setLineDash([3, 5]); ctx.strokeStyle = 'rgba(232,179,44,.45)'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(m.x, m.y, 7, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(237,234,227,.7)'; ctx.lineWidth = 2; ctx.stroke();
    }
    // lasso loop
    var l = S.lasso;
    if (l && l.pts.length > 1) {
      ctx.beginPath();
      l.pts.forEach(function (q, i) { i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
      if (!l.active) ctx.closePath();
      ctx.fillStyle = 'rgba(232,179,44,.10)'; ctx.fill();
      ctx.setLineDash([6, 5]); ctx.strokeStyle = '#E8B32C'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();
    // legend: colour = recency, size = number of sets
    ctx.save();
    var lx = a.right - 78, ly = a.top + 10;
    var grd = ctx.createLinearGradient(lx, 0, lx + 64, 0);
    grd.addColorStop(0, recencyColor(0, 1)); grd.addColorStop(0.5, recencyColor(0.5, 1)); grd.addColorStop(1, recencyColor(1, 1));
    ctx.fillStyle = 'rgba(14,16,19,.7)'; ctx.fillRect(lx - 8, ly - 6, 80, 40);
    ctx.fillStyle = grd; ctx.fillRect(lx, ly, 64, 6);
    ctx.fillStyle = '#9A9FA6'; ctx.font = '9.5px Inter, sans-serif'; ctx.textBaseline = 'top';
    ctx.textAlign = 'left'; ctx.fillText('older', lx, ly + 9); ctx.textAlign = 'right'; ctx.fillText('newer', lx + 64, ly + 9);
    ctx.textAlign = 'left'; ctx.fillText('bigger = more sets', lx - 4, ly + 21);
    ctx.restore();
  }

  var MAGNET_R = 96;
  function stepScatter(S, dt) {
    var chart = S.chart, m = S.mag, moving = false;
    var K = 240, C = 11;       // springs: ζ ≈ 0.36 → a lively but quick bounce back
    var n = Math.max(1, Math.ceil(dt / 0.004)), h = dt / n;
    var base = S.groups.map(function (g) { return groupPx(chart, g); });
    for (var k = 0; k < n; k++) {
      S.groups.forEach(function (g, i) {
        var tx = 0, ty = 0;
        if (m && m.on) {
          var dx = m.x - base[i].x, dy = m.y - base[i].y, d = Math.hypot(dx, dy);
          if (d < MAGNET_R) { var w = (1 - d / MAGNET_R); w *= w; tx = dx * 0.8 * w; ty = dy * 0.8 * w; }
        }
        g.vx += (K * (tx - g.ux) - C * g.vx) * h; g.vy += (K * (ty - g.uy) - C * g.vy) * h;
        g.ux += g.vx * h; g.uy += g.vy * h;
      });
    }
    S.groups.forEach(function (g) { if (Math.abs(g.ux) + Math.abs(g.uy) > 0.25 || Math.abs(g.vx) + Math.abs(g.vy) > 3) moving = true; });
    return moving || !!(m && m.on);
  }
  function nearestGroupDist(S, p) {
    var best = Infinity;
    S.groups.forEach(function (g) { var b = groupPx(S.chart, g); best = Math.min(best, Math.hypot(b.x - p.x, b.y - p.y)); });
    return best;
  }
  function inPolygon(pt, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
      if (((yi > pt.y) !== (yj > pt.y)) && (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function finishLasso(S) {
    var l = S.lasso; if (!l) return;
    l.active = false;
    var sel = new Set();
    if (l.pts.length >= 3) S.groups.forEach(function (g) { if (inPolygon(groupPx(S.chart, g), l.pts)) sel.add(g.gi); });
    S.sel = sel.size ? sel : null;
    S.lasso = null;
    if (S.sel) buzz(14);
    S.chart.draw(); updateReadout(S); updateTable(S);
  }

  /* ---------------- bars: jelly + bounce-in ---------------- */
  function barGeom(chart, i) {
    var a = chart.chartArea, sx = chart.scales.x, sy = chart.scales.y, p = chart.data.datasets[0].data[i];
    if (!validPt(p)) return null;
    var ppu = a.width / (sx.max - sx.min), w = Math.min(90, ppu * 0.63);
    var zero = a.bottom - (0 - sy.min) / (sy.max - sy.min) * a.height;
    return { x: a.left + (p.x - sx.min) * ppu, w: w, top: a.bottom - (p.y - sy.min) / (sy.max - sy.min) * a.height, base: clamp(zero, a.top, a.bottom) };
  }
  function initBars(S) {
    var n = S.chart.data.datasets[0].data.length;
    S.bars = { n: n, dy: new Float32Array(n), vy: new Float32Array(n), lx: new Float32Array(n), vlx: new Float32Array(n),
      hold: new Uint8Array(n).fill(1), fresh: new Uint8Array(n).fill(1), pin: -1, py: 0, px: 0, t0: performance.now() };
  }
  function stepBars(S, dt) {
    var B = S.bars, chart = S.chart, n = B.n, moving = false, now = performance.now();
    var tdy = new Float32Array(n), tlx = new Float32Array(n);
    if (B.pin >= 0) {
      [[0, 1, 0.4], [1, 0.4, 0.22], [-1, 0.4, 0.22], [2, 0.14, 0.1], [-2, 0.14, 0.1]].forEach(function (c) {
        var j = B.pin + c[0]; if (j < 0 || j >= n) return;
        tdy[j] = B.py * c[1]; tlx[j] = clamp(B.px * c[2], -40, 40);
      });
    }
    var geo = []; for (var i = 0; i < n; i++) geo.push(barGeom(chart, i));
    for (var i2 = 0; i2 < n; i2++) if (B.hold[i2] && now - B.t0 >= 200 + i2 * 75) B.hold[i2] = 0;
    var steps = Math.max(1, Math.ceil(dt / 0.004)), h = dt / steps;
    for (var k = 0; k < steps; k++) {
      for (var j2 = 0; j2 < n; j2++) {
        var g = geo[j2]; if (!g) continue;
        if (B.hold[j2]) { B.dy[j2] = g.base - g.top - 3; B.vy[j2] = 0; continue; }
        var K = B.fresh[j2] ? 190 : 300, C = B.fresh[j2] ? 13 : 10;   // intro is a softer bounce, jelly a livelier one
        B.vy[j2] += (K * (tdy[j2] - B.dy[j2]) - C * B.vy[j2]) * h; B.dy[j2] += B.vy[j2] * h;
        B.vlx[j2] += (300 * (tlx[j2] - B.lx[j2]) - 10 * B.vlx[j2]) * h; B.lx[j2] += B.vlx[j2] * h;
      }
    }
    for (var q = 0; q < n; q++) {
      if (B.hold[q] || Math.abs(B.dy[q]) > 0.3 || Math.abs(B.vy[q]) > 4 || Math.abs(B.lx[q]) > 0.3 || Math.abs(B.vlx[q]) > 4) moving = true;
      else B.fresh[q] = 0;
    }
    return moving || B.pin >= 0;
  }
  function drawBars(chart, S) {
    var B = S.bars, ctx = chart.ctx, a = chart.chartArea, ds = chart.data.datasets[0];
    if (!B) return;
    var act = []; try { act = chart.tooltip && chart.tooltip.getActiveElements ? chart.tooltip.getActiveElements() : []; } catch (e) { /* ignore */ }
    var hot = {}; act.forEach(function (e) { hot[e.index] = 1; });
    ctx.save();
    ctx.beginPath(); ctx.rect(a.left, 0, a.width, chart.height); ctx.clip();
    for (var i = 0; i < B.n; i++) {
      var g = barGeom(chart, i); if (!g) continue;
      var top = Math.min(g.top + B.dy[i], g.base - 3), lx = B.lx[i];
      var h0 = Math.max(3, g.base - g.top), h1 = Math.max(3, g.base - top);
      var ws = clamp(Math.sqrt(h0 / h1), 0.55, 1.6), tw = g.w * ws;
      var xlb = g.x - g.w / 2, xrb = g.x + g.w / 2, xlt = g.x + lx - tw / 2, xrt = g.x + lx + tw / 2;
      var inward = (g.w - tw) * 0.28, my = (g.base + top) / 2, r = Math.min(6, tw / 2, h1 / 2);
      ctx.beginPath();
      ctx.moveTo(xlb, g.base);
      ctx.quadraticCurveTo((xlb + xlt) / 2 + inward, my, xlt, top + r);
      ctx.quadraticCurveTo(xlt, top, xlt + r, top);
      ctx.lineTo(xrt - r, top);
      ctx.quadraticCurveTo(xrt, top, xrt, top + r);
      ctx.quadraticCurveTo((xrb + xrt) / 2 - inward, my, xrb, g.base);
      ctx.closePath();
      var col = ds.backgroundColor; if (Array.isArray(col)) col = col[i] || col[0];
      ctx.fillStyle = (hot[i] || B.pin === i) ? '#8BD197' : (col || '#6FA97B');
      ctx.fill();
    }
    ctx.restore();
  }

  /* ---------------- tooltip on tap only ---------------- */
  function clearTip(S) {
    if (!S.tipOn) return;
    S.tipOn = false; S.tip = null;
    try {
      S.chart.setActiveElements([]);
      if (S.chart.tooltip) S.chart.tooltip.setActiveElements([], { x: 0, y: 0 });
      S.chart.update('none');
    } catch (e) { /* ignore */ }
  }
  function showTip(S, p) {
    var chart = S.chart, best = null, R = 30;
    if (S.kind === 'scatter') {
      S.groups.forEach(function (g) {
        var b = groupPx(chart, g), d = Math.hypot(b.x - p.x, b.y - p.y);
        if (d < Math.max(R, bubbleR(g) + 8) && (!best || d < best.d)) best = { d: d, di: 0, i: g.idxs[0], x: b.x, y: b.y, gi: g.gi };
      });
    } else if (S.kind === 'bar') {
      for (var i = 0; i < S.bars.n; i++) {
        var g = barGeom(chart, i); if (!g) continue;
        if (Math.abs(p.x - g.x) <= g.w / 2 + 6 && p.y >= g.top - 14 && p.y <= g.base + 4) { best = { d: 0, di: 0, i: i, x: g.x, y: g.top }; break; }
      }
    } else {
      chart.data.datasets.forEach(function (ds, di) {
        var m = chart.getDatasetMeta(di); if (m.hidden) return;
        m.data.forEach(function (pt, i) {
          if (!pt || pt.skip || !isFinite(pt.x) || !isFinite(pt.y)) return;
          var d = Math.hypot(pt.x - p.x, pt.y - p.y);
          if (d < R && (!best || d < best.d)) best = { d: d, di: di, i: i, x: pt.x, y: pt.y };
        });
      });
    }
    if (!best) { clearTip(S); return; }
    S.tip = best.gi != null ? best.gi : null; S.tipOn = true;
    try {
      var els = [{ datasetIndex: best.di, index: best.i }];
      chart.setActiveElements(els);
      if (chart.tooltip) chart.tooltip.setActiveElements(els, { x: best.x, y: best.y });
      chart.update('none');
    } catch (e) { /* ignore */ }
  }

  /* ---------------- shared animation loop for scatter + bars ---------------- */
  function runMotion(S) {
    if (S.motionRaf || S.closed) return;
    S.motionLast = performance.now();
    function frame(now) {
      S.motionRaf = 0;
      if (S.closed) return;
      var dt = Math.min(0.033, Math.max(0.001, (now - S.motionLast) / 1000)); S.motionLast = now;
      var moving = S.kind === 'scatter' ? stepScatter(S, dt) : stepBars(S, dt);
      S.chart.draw();
      if (moving) S.motionRaf = requestAnimationFrame(frame);
    }
    S.motionRaf = requestAnimationFrame(frame);
  }

  /* ---------------- details table ---------------- */
  function fmtSigned(v) { return (v >= 0 ? '+' : '') + fmtNum(v); }
  function buildTable(S, prep, meta) {
    var cols = [], rows = [], ds0 = prep.cfg.data.datasets[0], L = prep.L, unit = meta.yUnit || '';
    if (prep.kind === 'scatter') {
      cols = [meta.xName || 'Weight', meta.yName || 'Reps', 'Sets', 'Last done'];
      prep.groups.slice().sort(function (p, q) { return q.x - p.x || q.y - p.y; }).forEach(function (g) {
        rows.push({ gi: g.gi, cells: [fmtNum(g.x) + (meta.xUnit || ''), fmtNum(g.y), String(g.n), fmtDay(g.last)] });
      });
    } else if (prep.kind === 'bar') {
      var mean = 0, cnt = 0; ds0.data.forEach(function (p) { if (validPt(p)) { mean += p.y; cnt++; } }); mean = cnt ? mean / cnt : 0;
      var counts = meta.counts || null;
      cols = [meta.xName || 'Weight', meta.yName || 'Value'].concat(counts ? ['Sets'] : []).concat(['vs avg']);
      ds0.data.forEach(function (p, i) {
        if (!validPt(p)) return;
        rows.push({ i: i, x: p.x, cells: [L[i], fmtNum(p.y) + unit].concat(counts ? [String(counts[i])] : []).concat([fmtSigned(p.y - mean)]) });
      });
    } else if (prep.cfg.data.datasets.length > 1) {
      cols = ['Date'].concat(prep.cfg.data.datasets.map(function (d) { return d.label || 'Value'; }));
      ds0.data.forEach(function (p, i) {
        rows.push({ i: i, x: i, cells: [L[i]].concat(prep.cfg.data.datasets.map(function (d) { var q = d.data[i]; return q && q.y != null ? fmtNum(q.y) + unit : '—'; })) });
      });
    } else {
      cols = ['Date', meta.yName || 'Value', 'Change', '%'];
      var prev = null;
      ds0.data.forEach(function (p, i) {
        if (!validPt(p)) { rows.push({ i: i, x: i, cells: [L[i], '—', '—', '—'] }); return; }
        var d = prev == null ? null : p.y - prev, pc = (prev ? (d / Math.abs(prev)) * 100 : null);
        rows.push({ i: i, x: i, cells: [L[i], fmtNum(p.y) + unit, d == null ? '—' : fmtSigned(d), pc == null ? '—' : (pc >= 0 ? '+' : '') + pc.toFixed(1) + '%'] });
        prev = p.y;
      });
    }
    S.tableRows = rows;
    var html = '<table class="cm-table"><thead><tr>' + cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r, ri) {
        return '<tr data-r="' + ri + '">' + r.cells.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table>';
    return html;
  }
  function updateTable(S) {
    var wrap = S.el && S.el.querySelector('.cm-table-wrap'); if (!wrap || !S.tableRows) return;
    var v = S.view, trs = wrap.querySelectorAll('tbody tr');
    S.tableRows.forEach(function (r, ri) {
      var tr = trs[ri]; if (!tr) return;
      var inView, sel = false;
      if (S.kind === 'scatter') {
        var g = S.groups[r.gi];
        inView = g.x >= v.x0 && g.x <= v.x1 && g.y >= v.y0 && g.y <= v.y1;
        sel = !!(S.sel && S.sel.has(r.gi));
      } else { inView = r.x >= v.x0 - 0.5 && r.x <= v.x1 + 0.5; }
      tr.classList.toggle('dim', !inView); tr.classList.toggle('sel', sel);
    });
  }
  function highlightRow(S, ri) {
    var r = S.tableRows[ri]; if (!r) return;
    if (S.kind === 'scatter') {
      S.sel = (S.sel && S.sel.size === 1 && S.sel.has(r.gi)) ? null : new Set([r.gi]);
      S.chart.draw(); updateReadout(S); updateTable(S);
      return;
    }
    try {
      var ch = S.chart, els = [{ datasetIndex: 0, index: r.i }], m = ch.getDatasetMeta(0).data[r.i];
      ch.setActiveElements(els);
      if (ch.tooltip) ch.tooltip.setActiveElements(els, { x: m.x, y: m.y });
      S.tipOn = true; ch.update('none');
    } catch (e) { /* ignore */ }
  }

  /* ---------------- bottom panel (table) that can be swiped away ---------------- */
  var PANEL_CLOSED = 52;
  function panelOpenH() { return clamp(Math.round(window.innerHeight * 0.40), 190, 380); }
  function bindPanel(S) {
    var panel = S.el.querySelector('.cm-panel'), handle = S.el.querySelector('.cm-handle'), wrap = S.el.querySelector('.cm-table-wrap');
    var txt = S.el.querySelector('.cm-handle-text'), hint = S.el.querySelector('.cm-hint');
    var drag = null;
    function setOpen(open, instant) {
      killStretch(S);
      S.panelOpen = open;
      panel.classList.toggle('drag', !!instant);
      panel.style.height = (open ? panelOpenH() : PANEL_CLOSED) + 'px';
      panel.classList.toggle('closed', !open);
      txt.textContent = open ? 'Swipe down for full-screen graph' : 'Swipe up for details';
      hint.style.display = open ? '' : 'none';
    }
    S.setPanel = setOpen;
    function start(y) { killStretch(S); clearTip(S); drag = { y0: y, h0: panel.getBoundingClientRect().height, y: y, t: performance.now(), vy: 0 }; panel.classList.add('drag'); }
    function move(y) {
      if (!drag) return;
      var now = performance.now(); drag.vy = (y - drag.y) / Math.max(1, now - drag.t); drag.y = y; drag.t = now;
      panel.style.height = clamp(drag.h0 - (y - drag.y0), PANEL_CLOSED, panelOpenH()) + 'px';
    }
    function end() {
      if (!drag) return;
      var h = panel.getBoundingClientRect().height, moved = Math.abs(drag.y - drag.y0) > 6;
      var open = drag.vy < -0.3 ? true : drag.vy > 0.3 ? false : h > (PANEL_CLOSED + panelOpenH()) / 2;
      if (!moved) open = !S.panelOpen;   // plain tap on the handle toggles
      drag = null; setOpen(open, false);
    }
    handle.addEventListener('pointerdown', function (e) { try { handle.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } start(e.clientY); });
    handle.addEventListener('pointermove', function (e) { move(e.clientY); });
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    // Swiping down on the table while it is scrolled to the top also pulls the panel down.
    var ty = null;
    wrap.addEventListener('touchstart', function (e) { ty = e.touches[0].clientY; }, { passive: true });
    wrap.addEventListener('touchmove', function (e) {
      var y = e.touches[0].clientY;
      if (!drag && wrap.scrollTop <= 0 && y - ty > 8) start(ty);
      if (drag) { e.preventDefault(); move(y); }
    }, { passive: false });
    wrap.addEventListener('touchend', end); wrap.addEventListener('touchcancel', end);
    panel.addEventListener('transitionend', function (e) { if (e.propertyName === 'height' && !S.closed) S.chart.resize(); });
    wrap.addEventListener('click', function (e) { var tr = e.target.closest('tr[data-r]'); if (tr) highlightRow(S, +tr.getAttribute('data-r')); });
    setOpen(true, true);
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
      '<div class="cm-panel">' +
        '<div class="cm-handle" role="button" aria-label="Details"><span class="cm-grip"></span><span class="cm-handle-text"></span></div>' +
        '<div class="cm-hint"></div>' +
        '<div class="cm-table-wrap"></div>' +
      '</div>';
    document.body.appendChild(el);
    document.body.style.overflow = 'hidden';

    var cv = el.querySelector('canvas');
    var S = cur = {
      el: el, canvas: cv, chart: null, kind: prep.kind, closed: false, mode: isLine ? 'stretch' : 'pan',
      base: null, view: null, pointers: new Map(), gesture: null, lastTap: null, viewRaf: 0,
      groups: prep.groups, sel: null, mag: null, lasso: null, bars: null, tableRows: null, panelOpen: true
    };
    var panel = el.querySelector('.cm-panel');
    panel.style.height = panelOpenH() + 'px';
    var chart = S.chart = new Chart(cv, prep.cfg);
    chart._cmS = S;

    // Fit view: explicit scatter ranges, otherwise whatever Chart.js computed — with a data-derived fallback.
    var sx = chart.scales.x, sy = chart.scales.y, base;
    if (prep.ranges) base = { x0: prep.ranges.x0, x1: prep.ranges.x1, y0: prep.ranges.y0, y1: prep.ranges.y1 };
    else base = { x0: sx.min, x1: sx.max, y0: sy.min, y1: sy.max };
    var okRange = isFinite(base.x0) && isFinite(base.x1) && isFinite(base.y0) && isFinite(base.y1) && base.x1 > base.x0;
    if (!okRange) base = dataRange(chart.data.datasets[0].data);
    if (!(base.y1 > base.y0)) base.y1 = base.y0 + 1;
    S.base = base;
    S.view = { x0: base.x0, x1: base.x1, y0: base.y0, y1: base.y1 };
    setView(S, S.view);
    setHint(S);

    el.querySelector('.cm-table-wrap').innerHTML = buildTable(S, prep, meta);
    bindPanel(S);
    updateReadout(S);

    el.addEventListener('click', function (e) {
      if (e.target.closest('[data-act="close"]')) close();
    });

    bindGestures(S);
    S.onKey = function (e) { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', S.onKey);
    S.onResize = function () { chart.resize(); if (S.setPanel) S.setPanel(S.panelOpen, true); };
    window.addEventListener('resize', S.onResize);
    requestAnimationFrame(function () { el.classList.add('open'); });
    if (S.kind === 'bar') { initBars(S); runMotion(S); }
    chart.draw();
  }

  function setHint(S) {
    var h = S.el.querySelector('.cm-hint');
    h.innerHTML = S.kind === 'line'
      ? 'Pinch to zoom &middot; drag to move &middot; pull the line to stretch it &middot; double-tap to reset'
      : S.kind === 'scatter'
        ? 'Pinch to zoom &middot; drag empty space to move &middot; drag near dots to pull them &middot; hold then draw a loop to lasso &middot; double-tap resets'
        : 'Pinch to zoom &middot; drag to move &middot; drag a bar to wobble it like jelly &middot; double-tap to reset';
  }

  function bindGestures(S) {
    var stage = S.el.querySelector('.cm-stage');
    var cv = S.canvas;
    cv.style.touchAction = 'none';
    var STRETCH_HIT = 26, MAGNET_START = 80, LONG_MS = 420;

    function pos(e) { var r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
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
    function cancelLong(g) { if (g && g.longTimer) { clearTimeout(g.longTimer); g.longTimer = 0; } }
    function barHit(p) {
      if (!S.bars) return -1;
      var best = -1, bd = Infinity;
      for (var i = 0; i < S.bars.n; i++) {
        var g = barGeom(S.chart, i); if (!g) continue;
        var dx = Math.abs(p.x - g.x);
        if (dx <= g.w / 2 + 10 && p.y >= g.top - 26 && p.y <= g.base + 8 && dx < bd) { bd = dx; best = i; }
      }
      return best;
    }
    // Let go of whichever "pull" is in progress (a second finger or a cancel ends it gracefully).
    function releasePulls() {
      killStretch(S);
      if (S.mag && S.mag.on) { S.mag.on = false; runMotion(S); }
      if (S.bars && S.bars.pin >= 0) { S.bars.pin = -1; runMotion(S); }
      if (S.lasso) { S.lasso = null; S.chart.draw(); }
    }

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
        cancelLong(g); releasePulls(); clearTip(S);
        g.type = 'pinch'; g.moved = true; g.pending = null;
        snapshot(g);
        return;
      }
      g.type = null; g.moved = false; g.startPos = p; g.last = p; g.lastT = 0; g.pending = null;
      snapshot(g);
      if (S.kind === 'line' && !e.shiftKey && e.button !== 1) {
        var hit = nearestLine(S.chart, p.x, p.y);
        if (hit.dist < STRETCH_HIT) g.pending = { type: 'stretch', ds: hit.ds, ax: p.x, ay: p.y };
      } else if (S.kind === 'scatter') {
        if (nearestGroupDist(S, p) < MAGNET_START) g.pending = { type: 'magnet' };
        g.longTimer = setTimeout(function () {
          g.longTimer = 0;
          if (g.moved || S.pointers.size !== 1) return;
          g.type = 'lasso'; g.moved = true; g.pending = null;
          S.sel = null; S.lasso = { pts: [S.pointers.values().next().value], active: true };
          buzz(10); S.chart.draw(); updateReadout(S);
        }, LONG_MS);
      } else if (S.kind === 'bar') {
        var bi = barHit(p);
        if (bi >= 0) g.pending = { type: 'jelly', i: bi, x0: p.x, y0: p.y };
      }
    });

    function onMove(e) {
      var g = S.gesture;
      if (!g || !S.pointers.has(e.pointerId)) return;
      var p = pos(e);
      S.pointers.set(e.pointerId, p);

      if (S.pointers.size >= 2) { applyGesture(g); return; }
      if (g.type === 'lasso') {
        var lp = S.lasso && S.lasso.pts, lastp = lp && lp[lp.length - 1];
        if (lp && Math.hypot(p.x - lastp.x, p.y - lastp.y) > 4) { lp.push(p); S.chart.draw(); }
        return;
      }

      var dx = p.x - g.startPos.x, dy = p.y - g.startPos.y;
      if (!g.moved && Math.hypot(dx, dy) < 6) return;
      if (!g.moved) {
        g.moved = true; cancelLong(g);
        clearTip(S);
        var pd = g.pending;
        if (pd && pd.type === 'stretch') {
          var old = S.chart._cmStretch; if (old) cancelAnimationFrame(old.raf);
          var ns = buildStretch(S.chart, pd.ds, { x: pd.ax, y: pd.ay });
          S.chart._cmStretch = ns;
          if (ns) { runStretch(S, ns); g.type = 'stretch'; cv.style.cursor = 'grabbing'; }
        } else if (pd && pd.type === 'magnet') {
          S.sel = null; S.mag = { on: true, x: p.x, y: p.y }; g.type = 'magnet'; buzz(6); runMotion(S);
        } else if (pd && pd.type === 'jelly') {
          S.bars.pin = pd.i; S.bars.py = 0; S.bars.px = 0; g.type = 'jelly'; buzz(6); runMotion(S);
        }
        if (!g.type) { g.type = 'pan'; snapshot(g); }
      }
      if (g.type === 'stretch') {
        var st = S.chart._cmStretch; if (!st) return;
        var nowT = performance.now();
        if (g.lastT) { var dtm = Math.max(1, nowT - g.lastT) / 1000; st.fvx = (p.x - g.last.x) / dtm; st.fvy = (p.y - g.last.y) / dtm; }
        g.lastT = nowT; g.last = p;
        st.px = dx; st.py = dy;
      } else if (g.type === 'magnet') {
        if (S.mag) { S.mag.x = p.x; S.mag.y = p.y; S.mag.on = true; runMotion(S); }
      } else if (g.type === 'jelly') {
        S.bars.py = p.y - g.pending.y0; S.bars.px = p.x - g.pending.x0; runMotion(S);
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
        cancelLong(g);
        if (g && g.type === 'stretch') releaseSpring(S);
        else if (g && g.type === 'magnet') { if (S.mag) S.mag.on = false; runMotion(S); }
        else if (g && g.type === 'jelly') { S.bars.pin = -1; buzz(8); runMotion(S); }
        else if (g && g.type === 'lasso') finishLasso(S);
        updateReadout(S);
        if (g && !g.moved && e.type === 'pointerup') {
          if (S.sel) { S.sel = null; S.chart.draw(); updateReadout(S); }   // tap clears a lasso selection
          var now = Date.now();
          if (S.lastTap && now - S.lastTap.t < 340 && Math.hypot(p.x - S.lastTap.x, p.y - S.lastTap.y) < 36) {
            S.lastTap = null; clearTip(S);
            animateView(S, S.base);
          } else {
            S.lastTap = { x: p.x, y: p.y, t: now };
            showTip(S, p);
          }
        }
        S.gesture = null;
      } else if (g) {
        g.type = 'pan'; g.moved = true; g.pending = null;
        snapshot(g);
      }
    }

    stage.addEventListener('wheel', function (e) {
      e.preventDefault(); clearTip(S);
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
      if (S.gesture) cancelLong(S.gesture);
    };
  }

  function close() {
    var S = cur;
    if (!S) return;
    S.closed = true;
    cur = null;
    cancelAnimationFrame(S.viewRaf); cancelAnimationFrame(S.applyRaf); cancelAnimationFrame(S.motionRaf);
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
