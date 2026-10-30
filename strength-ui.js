/* ============================================================
   Plate & Progress — Strength Intelligence UI
   ------------------------------------------------------------
   Renders (1) the doorway card on the STATS tab and (2) the full-screen
   dashboard. All maths lives in strength-intelligence.js; this file only
   draws and wires up inputs. Charts are plain inline SVG (works offline,
   no library). Styles are injected here so index.html needs no CSS edits.

   Host contract (index.html provides it):
     StrengthUI.mountCard(el, {getData, identityKey, idbGet, idbSet})
       getData() -> {exercises, sets}   (the app's live DB object)
   ============================================================ */
window.StrengthUI = (function () {
  'use strict';
  var SI = window.StrengthIntelligence;
  var ctx = null, store = { version: 1, unit: 'kg', tab: 'ask', forecasts: [] }, storeLoaded = false;
  var S = { key: null, tab: 'ask', mode: 'w2r', weightKg: null, repsIn: 8, range: '30', curveX: null, trendSel: null };
  var cache = {}, catalogCache = null, e1Cache = {};
  var reduceMotion = false;
  try { reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  /* ---------- utils ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(id) { return document.getElementById(id); }
  function unit() { return store.unit === 'lb' ? 'lb' : 'kg'; }
  function toDisp(kg) { return unit() === 'lb' ? SI.kgToLb(kg) : kg; }
  function toKg(v) { return unit() === 'lb' ? SI.lbToKg(v) : v; }
  function step() { return unit() === 'lb' ? 5 : 2.5; }
  function num(v, d) { if (v == null || !isFinite(v)) return '—'; var s = (+v).toFixed(d == null ? 1 : d); return s.indexOf('.') >= 0 ? s.replace(/0+$/, '').replace(/\.$/, '') : s; }
  function fw(kg, d) { return num(toDisp(kg), d == null ? 1 : d); }
  function fwu(kg, d) { return fw(kg, d) + ' ' + unit(); }
  function loadable(kg) { return SI.roundToIncrement(toDisp(kg), step()); }   // display-unit number snapped to plates
  function fdate(d) { try { return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch (e) { return d; } }
  function ago(n) { return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n + ' days ago'; }
  function pct(v) { return (v > 0 ? '+' : '') + num(v, 1) + '%'; }
  function arrow(dir) { return dir === 'up' ? '▲' : dir === 'down' ? '▼' : '●'; }
  function dirClass(dir) { return dir === 'up' ? 'si-up' : dir === 'down' ? 'si-down' : 'si-flat'; }

  /* ---------- store (IndexedDB 'data' store, key 'strengthIntelligence') ---------- */
  function loadStore() {
    if (storeLoaded || !ctx || !ctx.idbGet) { storeLoaded = true; return Promise.resolve(); }
    return Promise.resolve().then(function () { return ctx.idbGet('strengthIntelligence'); }).then(function (v) {
      if (v && v.version === 1) {
        store.unit = v.unit === 'lb' ? 'lb' : 'kg';
        store.tab = ['ask', 'curve', 'trend', 'insights'].indexOf(v.tab) >= 0 ? v.tab : 'ask';
        store.forecasts = Array.isArray(v.forecasts) ? v.forecasts.slice(-300) : [];
      }
      storeLoaded = true;
    }).catch(function () { storeLoaded = true; });
  }
  function saveStore() {
    if (!ctx || !ctx.idbSet) return;
    try { Promise.resolve(ctx.idbSet('strengthIntelligence', { version: 1, unit: store.unit, tab: store.tab, forecasts: store.forecasts.slice(-300) })).catch(function () {}); } catch (e) {}
  }

  /* ---------- data / analysis ---------- */
  function dataSig(key) {
    var d = ctx.getData(), h = 0, n = 0, s = d.sets || [];
    for (var i = 0; i < s.length; i++) { var x = s[i]; n++; var t = x.id + '|' + x.exerciseId + '|' + x.date + '|' + x.weight + '|' + x.reps + '|' + (x.setType || ''); for (var j = 0; j < t.length; j++) h = (h * 31 + t.charCodeAt(j)) | 0; }
    var e = d.exercises || []; for (var k = 0; k < e.length; k++) { var q = e[k].id + e[k].name; for (var m = 0; m < q.length; m++) h = (h * 31 + q.charCodeAt(m)) | 0; }
    return n + ':' + h;
  }
  var lastSig = null;
  function checkCaches() { var sg = dataSig(); if (sg !== lastSig) { lastSig = sg; cache = {}; catalogCache = null; e1Cache = {}; } }
  function opts() { return { identityKey: ctx.identityKey }; }
  function catalog() { checkCaches(); if (!catalogCache) catalogCache = SI.buildCatalog(ctx.getData(), opts()); return catalogCache; }
  function analysis(key) {
    checkCaches();
    if (!cache[key]) cache[key] = SI.analyze(ctx.getData(), key, opts());
    return cache[key];
  }
  function quickE1(key) {
    checkCaches();
    if (!(key in e1Cache)) {
      var h = SI.getExerciseHistory(ctx.getData(), key, opts()), m = SI.fitModel(h);   // same E as the dashboard headline (backtest only changes the spread)
      e1Cache[key] = m ? m.E : null;
    }
    return e1Cache[key];
  }
  // log the forecast (once per last-session) and resolve earlier ones against what really happened
  function trackForecasts(a) {
    if (!a || !a.forecast) return;
    var changed = false, list = store.forecasts;
    var rec = SI.createForecastRecord(a.history, a.forecast);
    if (rec && !list.some(function (r) { return r.id === rec.id; })) { list.push(rec); changed = true; }
    var out = SI.evaluateForecastLog(list, a.history);
    for (var i = 0; i < list.length; i++) if (out[i] !== list[i]) { changed = true; }
    store.forecasts = out;
    if (changed) saveStore();
  }

  /* ---------- styles ---------- */
  function injectStyles() {
    if ($('si-styles')) return;
    var st = document.createElement('style'); st.id = 'si-styles';
    st.textContent = [
      '.si-card{cursor:pointer;position:relative;overflow:hidden;background:linear-gradient(160deg,#1d2026 0%,var(--surface) 60%);}',
      '.si-card:active{transform:scale(.995);}',
      '.si-card-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;}',
      '.si-eyebrow{font-family:var(--font-display);font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);font-weight:500;}',
      '.si-chev{color:var(--text-faint);font-size:20px;line-height:1;}',
      '.si-card-body{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;}',
      '.si-lift{font-size:13px;color:var(--text-dim);margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:60vw;}',
      '.si-big{font-family:var(--font-mono);font-size:30px;font-weight:600;color:var(--text);line-height:1.05;font-variant-numeric:tabular-nums;}',
      '.si-big small{font-size:13px;color:var(--text-dim);font-weight:400;margin-left:3px;}',
      '.si-delta{font-size:12px;font-family:var(--font-mono);margin-top:4px;}',
      '.si-up{color:var(--good);} .si-down{color:var(--rust);} .si-flat{color:var(--text-dim);}',
      '.si-spark{width:116px;height:42px;flex:none;}',
      '.si-nudge{margin-top:12px;padding-top:11px;border-top:1px solid var(--border);font-size:12.5px;color:var(--text-dim);}',
      '.si-nudge b{color:var(--text);font-weight:600;font-family:var(--font-mono);}',
      '.si-empty{font-size:13px;color:var(--text-dim);line-height:1.5;}',
      /* overlay */
      '.si-overlay{position:fixed;inset:0;z-index:420;background:var(--bg);display:flex;flex-direction:column;transform:translateX(100%);transition:transform .26s cubic-bezier(.2,.8,.2,1);}',
      '.si-overlay.open{transform:none;}',
      '@media (prefers-reduced-motion:reduce){.si-overlay{transition:none;}.si-anim{animation:none!important;}}',
      'body.si-open{overflow:hidden;}',
      '.si-top{display:flex;align-items:center;gap:8px;padding:calc(10px + env(safe-area-inset-top)) 12px 10px;border-bottom:1px solid var(--border);background:var(--bg);}',
      '.si-back{background:none;border:none;color:var(--text);padding:6px 8px 6px 2px;display:flex;}',
      '.si-back svg{width:22px;height:22px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;}',
      '.si-title{flex:1;min-width:0;}',
      '.si-title h2{font-size:17px;margin:0;}',
      '.si-title .si-eyebrow{font-size:10.5px;}',
      '.si-unit{display:flex;background:var(--surface2);border-radius:8px;padding:2px;gap:2px;}',
      '.si-unit button{background:none;border:none;color:var(--text-faint);font-family:var(--font-mono);font-size:12px;padding:6px 10px;border-radius:6px;font-weight:600;}',
      '.si-unit button.active{background:var(--surface);color:var(--accent);}',
      '.si-scroll{flex:1;overflow-y:auto;overflow-x:hidden;padding:14px 14px calc(30px + env(safe-area-inset-bottom));-webkit-overflow-scrolling:touch;overscroll-behavior:contain;}',
      '.si-picker{display:flex;gap:10px;align-items:center;margin-bottom:12px;}',
      '.si-picker select{flex:1;font-family:var(--font-display);font-size:16px;text-transform:uppercase;letter-spacing:.03em;font-weight:500;}',
      '.si-badge{flex:none;font-size:11px;font-weight:600;padding:6px 10px;border-radius:99px;border:1px solid var(--border);color:var(--text-dim);white-space:nowrap;display:inline-flex;gap:6px;align-items:center;background:var(--surface);}',
      '.si-badge i{width:7px;height:7px;border-radius:50%;background:var(--text-faint);display:inline-block;}',
      '.si-badge.well-calibrated{color:var(--good);border-color:#34503a;} .si-badge.well-calibrated i{background:var(--good);}',
      '.si-badge.moderate{color:var(--accent);border-color:var(--accent-dim);} .si-badge.moderate i{background:var(--accent);}',
      '.si-badge.preliminary{color:#c9a85a;} .si-badge.preliminary i{background:#8a7440;}',
      '.si-badge.insufficient{color:var(--text-faint);}',
      '.si-hero{display:grid;grid-template-columns:1.25fr 1fr 1fr;gap:8px;margin-bottom:6px;}',
      '.si-tile{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:10px 11px;min-width:0;}',
      '.si-tile.main{border-color:var(--accent-dim);background:linear-gradient(160deg,#241f12 0%,var(--surface) 70%);}',
      '.si-tile .k{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-faint);margin-bottom:4px;white-space:nowrap;}',
      '.si-tile .v{font-family:var(--font-mono);font-size:21px;font-weight:600;line-height:1.1;font-variant-numeric:tabular-nums;}',
      '.si-tile.main .v{color:var(--accent);font-size:25px;}',
      '.si-tile .v small{font-size:11px;color:var(--text-dim);font-weight:400;margin-left:2px;}',
      '.si-tile .s{font-size:10.5px;color:var(--text-dim);margin-top:4px;}',
      '.si-status{font-size:11.5px;color:var(--text-dim);margin:2px 2px 12px;}',
      '.si-status b{color:var(--text);font-weight:500;}',
      '.si-notice{background:#262012;border:1px solid var(--accent-dim);color:#d9c78f;border-radius:8px;padding:9px 11px;font-size:12px;line-height:1.45;margin-bottom:12px;}',
      '.si-notice.warn{background:var(--rust-dim);border-color:#5a3326;color:#e0a493;}',
      '.si-tabs{margin-bottom:12px;}',
      '.si-pane{animation:si-in .22s ease;}',
      '@keyframes si-in{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:none;}}',
      '.si-mode{display:flex;gap:6px;margin-bottom:12px;}',
      '.si-mode button{flex:1;background:var(--surface2);border:1px solid var(--border);color:var(--text-dim);border-radius:99px;padding:8px 6px;font-size:12.5px;font-weight:500;}',
      '.si-mode button.active{background:var(--accent-dim);border-color:var(--accent);color:var(--accent);}',
      '.si-stepper{display:flex;align-items:stretch;gap:8px;}',
      '.si-stepper button.sb{flex:none;width:46px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:22px;line-height:1;}',
      '.si-stepper button.sb:active{background:var(--accent-dim);}',
      '.si-input{position:relative;flex:1;}',
      '.si-input input{text-align:center;font-family:var(--font-mono);font-size:24px;font-weight:600;padding:10px 40px 10px 12px;}',
      '.si-input span{position:absolute;right:12px;top:50%;transform:translateY(-50%);font-size:12px;color:var(--text-faint);font-family:var(--font-mono);pointer-events:none;}',
      '.si-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px;}',
      '.si-chip{background:var(--surface2);border:1px solid var(--border);color:var(--text-dim);border-radius:99px;padding:5px 10px;font-size:12px;font-family:var(--font-mono);}',
      '.si-chip:active{border-color:var(--accent);color:var(--accent);}',
      '.si-result{margin-top:14px;text-align:center;padding:16px 10px 14px;border-radius:var(--radius);background:var(--surface);border:1px solid var(--border);}',
      '.si-result .lbl{font-size:11px;text-transform:uppercase;letter-spacing:.09em;color:var(--text-faint);}',
      '.si-result .num{font-family:var(--font-mono);font-size:50px;font-weight:600;color:var(--accent);line-height:1.1;margin:4px 0 2px;font-variant-numeric:tabular-nums;}',
      '.si-result .num small{font-size:18px;color:var(--text-dim);font-weight:400;margin-left:5px;}',
      '.si-result .sub{font-size:12.5px;color:var(--text-dim);}',
      '.si-range{margin:14px 6px 4px;}',
      '.si-bar{position:relative;height:8px;border-radius:99px;background:var(--surface2);}',
      '.si-bar .seg{position:absolute;top:0;bottom:0;border-radius:99px;background:linear-gradient(90deg,#6b5518,var(--accent));opacity:.85;transition:left .2s,width .2s;}',
      '.si-bar .tick{position:absolute;top:-4px;width:3px;height:16px;border-radius:2px;background:var(--text);transition:left .2s;transform:translateX(-1px);}',
      '.si-bar-l{display:flex;justify-content:space-between;font-size:11px;color:var(--text-dim);margin-top:8px;font-family:var(--font-mono);}',
      '.si-bar-l b{color:var(--text);font-weight:600;}',
      '.si-kv{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px;}',
      '.si-kv .box{background:var(--surface2);border-radius:8px;padding:9px 10px;}',
      '.si-kv .k{font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:var(--text-faint);}',
      '.si-kv .v{font-size:13.5px;margin-top:3px;font-family:var(--font-mono);}',
      '.si-warn{font-size:12px;color:#d9a35c;margin-top:10px;line-height:1.45;text-align:left;}',
      '.si-warn.bad{color:#e0a493;}',
      'details.si-why{margin-top:12px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:2px 13px;}',
      'details.si-why summary{cursor:pointer;padding:11px 0;font-size:12.5px;color:var(--text-dim);list-style:none;display:flex;justify-content:space-between;}',
      'details.si-why summary::-webkit-details-marker{display:none;}',
      'details.si-why summary:after{content:"+";color:var(--accent);font-size:16px;line-height:1;}',
      'details.si-why[open] summary:after{content:"–";}',
      '.si-why p{font-size:12.5px;color:var(--text-dim);line-height:1.55;margin:0 0 10px;}',
      '.si-why ul{list-style:none;margin:0 0 10px;padding:0;} .si-why li{font-size:12.5px;color:var(--text-dim);padding:4px 0 4px 18px;position:relative;line-height:1.4;}',
      '.si-why li:before{content:"•";position:absolute;left:4px;color:var(--text-faint);} .si-why li.ok:before{content:"✓";color:var(--good);left:2px;} .si-why li.no:before{content:"!";color:#d9a35c;left:4px;}',
      '.si-table{width:100%;border-collapse:collapse;font-size:12px;font-family:var(--font-mono);margin-bottom:10px;} .si-table td,.si-table th{padding:5px 4px;text-align:right;border-bottom:1px solid var(--border);} .si-table th{color:var(--text-faint);font-weight:500;font-size:10px;text-transform:uppercase;letter-spacing:.05em;} .si-table td:first-child,.si-table th:first-child{text-align:left;}',
      '.si-svg{width:100%;height:auto;display:block;touch-action:pan-y;user-select:none;-webkit-user-select:none;}',
      '.si-svg text{font-family:var(--font-mono);font-size:9.5px;fill:var(--text-faint);}',
      '.si-draw{stroke-dasharray:var(--len);stroke-dashoffset:var(--len);animation:si-draw .9s ease forwards;}',
      '@keyframes si-draw{to{stroke-dashoffset:0;}}',
      '.si-legend{display:flex;gap:14px;flex-wrap:wrap;font-size:11px;color:var(--text-dim);margin:2px 2px 8px;}',
      '.si-legend span{display:inline-flex;align-items:center;gap:6px;}',
      '.si-legend .dot{width:9px;height:9px;border-radius:50%;background:var(--accent);} .si-legend .ring{width:9px;height:9px;border-radius:50%;border:2px solid var(--accent);} .si-legend .dash{width:16px;border-top:2px dashed var(--text-dim);} .si-legend .x{color:var(--text-faint);font-size:11px;}',
      '.si-readout{background:var(--surface2);border-radius:8px;padding:10px 12px;font-size:13px;margin-top:8px;min-height:40px;font-family:var(--font-mono);}',
      '.si-readout b{color:var(--accent);}',
      '.si-cap{font-size:11.5px;color:var(--text-faint);margin-top:8px;line-height:1.45;}',
      '.si-stat{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px;}',
      '.si-ins{border-left:3px solid var(--border);background:var(--surface);border-radius:0 var(--radius) var(--radius) 0;padding:11px 13px;margin-bottom:9px;}',
      '.si-ins.positive{border-left-color:var(--good);} .si-ins.caution{border-left-color:var(--rust);} .si-ins.neutral{border-left-color:var(--text-faint);}',
      '.si-ins h4{margin:0 0 4px;font-size:13.5px;font-weight:600;font-family:var(--font-body);} .si-ins p{margin:0;font-size:12.5px;color:var(--text-dim);line-height:1.5;}',
      '.si-h{font-family:var(--font-display);font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim);margin:18px 2px 8px;font-weight:500;}',
      '.si-ok{color:var(--good);} .si-bad{color:var(--rust);}',
      '.si-empty-page{text-align:center;padding:40px 20px;color:var(--text-dim);font-size:13.5px;line-height:1.6;}',
      '@media (max-width:360px){.si-hero{grid-template-columns:1fr 1fr;}.si-hero .si-tile.main{grid-column:1/-1;}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ---------- tiny SVG chart helpers ---------- */
  function niceTicks(min, max, n) {
    var span = max - min; if (!(span > 0)) { span = Math.abs(max) || 1; min = max - span; }
    var raw = span / n, mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), f = raw / mag;
    var stp = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag, out = [];
    for (var v = Math.ceil(min / stp) * stp; v <= max + 1e-9; v += stp) out.push(Math.round(v / stp) * stp);
    return out;
  }
  function pathOf(pts) { return pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(''); }
  function polyLen(pts) { var l = 0; for (var i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return Math.ceil(l) + 4; }
  function sparkSvg(vals) {
    if (vals.length < 2) return '';
    var w = 116, h = 42, min = Math.min.apply(null, vals), max = Math.max.apply(null, vals), sp = (max - min) || 1;
    var pts = vals.map(function (v, i) { return [2 + i * (w - 4) / (vals.length - 1), h - 4 - (v - min) / sp * (h - 10)]; });
    var last = pts[pts.length - 1];
    return '<svg class="si-spark" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true"><path d="' + pathOf(pts) + '" fill="none" stroke="#E8B32C" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/><circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="3" fill="#E8B32C"/></svg>';
  }

  /* ---------- Stats-tab doorway card ---------- */
  function mountCard(el, host) {
    ctx = host; injectStyles();
    if (!el) return;
    loadStore().then(function () { renderCard(el); });
  }
  function renderCard(el) {
    if (!el.isConnected) return;
    var cat = catalog();
    if (!cat.length) {
      el.innerHTML = '<div class="card si-card" style="cursor:default"><div class="si-card-head"><div class="si-eyebrow">Strength Intelligence</div></div><div class="si-empty">Log a few working sets with weight and reps and this will estimate your 1RM, predict reps at any weight, and forecast your next session.</div></div>';
      return;
    }
    var top = cat[0], a = analysis(top.key); trackForecasts(a);
    if (!a.model) {
      el.innerHTML = '<div class="card si-card" style="cursor:default"><div class="si-card-head"><div class="si-eyebrow">Strength Intelligence</div></div><div class="si-empty">' + esc(top.name) + ' has no sets in a usable range yet (1–20 reps with a weight).</div></div>';
      return;
    }
    var t = a.trends['30'], m = a.model;
    var spark = a.history.sessions.filter(function (s) { return s.e1rm != null && !s.anomalous; }).slice(-12).map(function (s) { return s.e1rm; });
    var delta = t.direction === 'insufficient' ? '<span class="si-flat">' + (a.provisional ? 'Provisional estimate' : 'Not enough recent sessions') + '</span>' : '<span class="' + dirClass(t.direction) + '">' + arrow(t.direction) + ' ' + pct(t.changePct) + ' · 30d</span>';
    var nudge = '';
    if (a.forecast && a.forecast.atWeight.ok) {
      var f = a.forecast, p = f.atWeight;
      nudge = '<div class="si-nudge">At <b>' + fwu(f.basis.weight) + '</b> next time: <b>~' + p.reps + ' reps</b>' + (p.low !== p.high ? ' (' + p.low + '–' + p.high + ')' : '') + '</div>';
    }
    el.innerHTML = '<div class="card si-card" id="si-card-open" role="button" tabindex="0" aria-label="Open Strength Intelligence">' +
      '<div class="si-card-head"><div class="si-eyebrow">Strength Intelligence</div><div class="si-chev">›</div></div>' +
      '<div class="si-card-body"><div style="min-width:0"><div class="si-lift">' + esc(a.name) + ' · est. 1RM</div>' +
      '<div class="si-big">' + fw(m.E) + '<small>' + unit() + '</small></div><div class="si-delta">' + delta + '</div></div>' + sparkSvg(spark) + '</div>' + nudge + '</div>';
    var c = $('si-card-open');
    var go = function () { open(top.key); };
    c.onclick = go; c.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
  }

  /* ---------- dashboard overlay ---------- */
  function isOpen() { var o = $('si-overlay'); return !!(o && o.classList.contains('open')); }
  function open(key) {
    if (!ctx) return;
    injectStyles();
    loadStore().then(function () {
      var cat = catalog(); if (!cat.length) return;
      S.key = (key && cat.some(function (c) { return c.key === key; })) ? key : cat[0].key;
      S.tab = store.tab; S.mode = 'w2r'; S.curveX = null; S.trendSel = null; S.weightKg = null; S.rangeAuto = false; S.range = '30';
      var o = $('si-overlay');
      if (!o) { o = document.createElement('div'); o.id = 'si-overlay'; o.className = 'si-overlay'; o.setAttribute('role', 'dialog'); o.setAttribute('aria-label', 'Strength Intelligence'); document.body.appendChild(o); }
      document.body.classList.add('si-open');
      drawShell(o);
      requestAnimationFrame(function () { requestAnimationFrame(function () { o.classList.add('open'); }); });
    });
  }
  function close() {
    var o = $('si-overlay'); if (!o) return;
    o.classList.remove('open'); document.body.classList.remove('si-open');
    setTimeout(function () { if (o.parentNode && !o.classList.contains('open')) o.parentNode.removeChild(o); }, 300);
    var cardEl = $('si-card-mount'); if (cardEl) renderCard(cardEl);   // refresh the preview (unit etc.)
  }

  function drawShell(o) {
    var cat = catalog();
    var opts = cat.map(function (c) {
      var e = quickE1(c.key);
      return '<option value="' + esc(c.key) + '"' + (c.key === S.key ? ' selected' : '') + '>' + esc(c.name) + (e ? ' · ' + fw(e) + ' ' + unit() : '') + '</option>';
    }).join('');
    o.innerHTML =
      '<div class="si-top"><button class="si-back" id="si-back" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>' +
      '<div class="si-title"><div class="si-eyebrow">Stats</div><h2>Strength Intelligence</h2></div>' +
      '<div class="si-unit" role="group" aria-label="Units"><button data-u="kg" class="' + (unit() === 'kg' ? 'active' : '') + '">KG</button><button data-u="lb" class="' + (unit() === 'lb' ? 'active' : '') + '">LB</button></div></div>' +
      '<div class="si-scroll" id="si-scroll"><div class="si-picker"><select id="si-ex" aria-label="Exercise">' + opts + '</select><div id="si-badge"></div></div>' +
      '<div id="si-hero"></div>' +
      '<div class="segmented si-tabs" id="si-tabs"><button data-t="ask">Ask</button><button data-t="curve">Curve</button><button data-t="trend">Trend</button><button data-t="insights">Insights</button></div>' +
      '<div id="si-pane"></div></div>';
    $('si-back').onclick = close;
    $('si-ex').onchange = function () { S.key = this.value; S.curveX = null; S.trendSel = null; S.weightKg = null; S.rangeAuto = false; S.range = '30'; renderBody(true); };
    Array.prototype.forEach.call(o.querySelectorAll('.si-unit button'), function (b) {
      b.onclick = function () { changeUnit(b.getAttribute('data-u')); };
    });
    Array.prototype.forEach.call(o.querySelectorAll('#si-tabs button'), function (b) {
      b.onclick = function () { S.tab = b.getAttribute('data-t'); store.tab = S.tab; saveStore(); renderBody(false); };
    });
    renderBody(true);
  }
  function changeUnit(u) {
    if (u === store.unit) return;
    store.unit = u; saveStore();
    var o = $('si-overlay'); Array.prototype.forEach.call(o.querySelectorAll('.si-unit button'), function (b) { b.classList.toggle('active', b.getAttribute('data-u') === u); });
    // keep option labels in sync
    var sel = $('si-ex'); Array.prototype.forEach.call(sel.options, function (op) { var c = catalog().filter(function (x) { return x.key === op.value; })[0]; var e = quickE1(op.value); op.textContent = c.name + (e ? ' · ' + fw(e) + ' ' + unit() : ''); });
    renderBody(false);
  }

  function countUp(el, to, d) {
    if (!el) return;
    if (reduceMotion || !isFinite(to)) { el.textContent = num(to, d); return; }
    var from = to * 0.85, t0 = null;
    function f(ts) { if (!t0) t0 = ts; var k = Math.min(1, (ts - t0) / 420), e = 1 - Math.pow(1 - k, 3); el.textContent = num(from + (to - from) * e, d); if (k < 1 && el.isConnected) requestAnimationFrame(f); }
    requestAnimationFrame(f);
  }

  function renderBody(animateHero) {
    var a = analysis(S.key); trackForecasts(a);
    var o = $('si-overlay'); if (!o) return;
    Array.prototype.forEach.call(o.querySelectorAll('#si-tabs button'), function (b) { b.classList.toggle('active', b.getAttribute('data-t') === S.tab); });
    var m = a.model, c = a.confidence;
    $('si-badge').innerHTML = '<span class="si-badge ' + c.level + '" title="Prediction confidence"><i></i>' + esc(c.label) + '</span>';
    if (!m) {
      $('si-hero').innerHTML = '';
      $('si-pane').innerHTML = '<div class="si-empty-page">No usable history for this exercise.<br>Predictions need working sets with a weight and 1–20 reps. Warm-ups, bodyweight-only sets and records with missing values are ignored.</div>';
      return;
    }
    var t30 = a.trends['30'], rec = a.records;
    var d30 = t30.direction === 'insufficient' ? '<span class="si-flat">—</span>' : '<span class="' + dirClass(t30.direction) + '">' + arrow(t30.direction) + ' ' + pct(t30.changePct) + '</span>';
    $('si-hero').innerHTML =
      '<div class="si-hero"><div class="si-tile main"><div class="k">Est. 1RM</div><div class="v"><span id="si-e1">' + fw(m.E) + '</span><small>' + unit() + '</small></div><div class="s">' + fw(m.eLow, 0) + '–' + fw(m.eHigh, 0) + ' ' + unit() + ' likely</div></div>' +
      '<div class="si-tile"><div class="k">Best set</div><div class="v">' + (rec.weight ? fw(rec.weight.weight) + '<small>×' + rec.weight.reps + '</small>' : '—') + '</div><div class="s">actual heaviest set</div></div>' +
      '<div class="si-tile"><div class="k">30 days</div><div class="v" style="font-size:18px">' + d30 + '</div><div class="s">' + (t30.nSessions || 0) + ' session' + (t30.nSessions === 1 ? '' : 's') + '</div></div></div>' +
      '<div class="si-status">' + (a.provisional ? '<b>1RM provisional</b> · ' + m.nSessions + ' session' + (m.nSessions === 1 ? '' : 's') + ', ' + m.nSets + ' sets so far' : '<b>1RM supported</b> by ' + m.nSessions + ' sessions and ' + m.nSets + ' sets') + ' · estimates, not records · badge = prediction confidence</div>' +
      (m.formulaOnly ? '<div class="si-notice">Not personalised yet — with this little history the numbers are a formula-based estimate (Epley, Brzycki &amp; Lombardi blended). They sharpen as you log more sessions.</div>' : '');
    if (animateHero) countUp($('si-e1'), toDisp(m.E), 1);
    var pane = $('si-pane');
    pane.className = 'si-pane'; void pane.offsetWidth;
    if (S.tab === 'ask') paneAsk(a, pane);
    else if (S.tab === 'curve') paneCurve(a, pane);
    else if (S.tab === 'trend') paneTrend(a, pane);
    else paneInsights(a, pane);
  }

  /* ---------- ASK pane (what-if calculators) ---------- */
  function recentWeights(a) {
    var seen = {}, out = [];
    a.history.sessions.slice().reverse().forEach(function (s) { if (s.anomalous) return; var k = Math.round(s.topWeight * 4) / 4; if (!seen[k] && out.length < 4) { seen[k] = 1; out.push(s.topWeight); } });
    return out;
  }
  function paneAsk(a, pane) {
    var m = a.model;
    if (S.weightKg == null) S.weightKg = a.forecast ? a.forecast.basis.weight : m.E * 0.8;
    var w2r = S.mode === 'w2r';
    var chips = w2r ? recentWeights(a).map(function (w) { return '<button class="si-chip" data-w="' + w + '">' + fw(w) + '</button>'; }).join('') : [3, 5, 8, 10, 12].map(function (r) { return '<button class="si-chip" data-r="' + r + '">' + r + ' reps</button>'; }).join('');
    var val = w2r ? num(loadable(S.weightKg), 1) : String(S.repsIn);
    pane.innerHTML =
      '<div class="si-mode"><button data-m="w2r" class="' + (w2r ? 'active' : '') + '">Weight → Reps</button><button data-m="r2w" class="' + (!w2r ? 'active' : '') + '">Reps → Weight</button></div>' +
      '<label class="field-label" for="si-in">' + (w2r ? 'If I lift (' + unit() + ')' : 'I want to do (reps)') + '</label>' +
      '<div class="si-stepper"><button class="sb" id="si-dec" aria-label="Decrease">−</button><div class="si-input"><input id="si-in" type="number" inputmode="decimal" min="0" step="' + (w2r ? step() : 1) + '" value="' + val + '"><span>' + (w2r ? unit() : 'reps') + '</span></div><button class="sb" id="si-inc" aria-label="Increase">+</button></div>' +
      '<div class="si-chips">' + (w2r && chips ? '<span style="font-size:11px;color:var(--text-faint);align-self:center">Recent:</span>' : '') + chips + '</div>' +
      '<div id="si-res"></div><div id="si-why"></div>';
    var inp = $('si-in');
    function read() { var v = parseFloat(inp.value); return isFinite(v) ? v : NaN; }
    function apply() { var v = read(); if (w2r) S.weightKg = isFinite(v) && v > 0 ? toKg(v) : S.weightKg; else if (isFinite(v) && v >= 1) S.repsIn = Math.min(50, Math.round(v)); updateAsk(a); }
    inp.oninput = function () { var v = read(); if (isFinite(v) && v > 0) { if (w2r) S.weightKg = toKg(v); else S.repsIn = Math.min(50, Math.max(1, Math.round(v))); } updateAsk(a); };
    function bump(dir) {
      if (w2r) { var cur = loadable(S.weightKg); var nv = Math.max(step(), SI.roundToIncrement(cur + dir * step(), step())); S.weightKg = toKg(nv); inp.value = num(nv, 1); }
      else { S.repsIn = Math.max(1, Math.min(50, S.repsIn + dir)); inp.value = S.repsIn; }
      updateAsk(a);
    }
    $('si-dec').onclick = function () { bump(-1); }; $('si-inc').onclick = function () { bump(1); };
    Array.prototype.forEach.call(pane.querySelectorAll('.si-chip'), function (b) {
      b.onclick = function () { if (b.hasAttribute('data-w')) { S.weightKg = parseFloat(b.getAttribute('data-w')); inp.value = num(loadable(S.weightKg), 1); } else { S.repsIn = parseInt(b.getAttribute('data-r'), 10); inp.value = S.repsIn; } updateAsk(a); };
    });
    Array.prototype.forEach.call(pane.querySelectorAll('.si-mode button'), function (b) { b.onclick = function () { S.mode = b.getAttribute('data-m'); paneAsk(a, pane); }; });
    updateAsk(a);
  }
  function rangeBar(min, max, lo, mid, hi) {
    var sp = (max - min) || 1, L = clampPct((lo - min) / sp), R = clampPct((hi - min) / sp), M = clampPct((mid - min) / sp);
    return '<div class="si-bar"><div class="seg" style="left:' + L + '%;width:' + Math.max(1.5, R - L) + '%"></div><div class="tick" style="left:' + M + '%"></div></div>';
  }
  function clampPct(x) { return Math.max(0, Math.min(1, x)) * 100; }
  function closestLine(c, what) {
    if (!c) return '—';
    return fwu(c.weight) + ' × ' + c.reps + ' <span style="color:var(--text-faint)">· ' + ago(c.daysAgo) + '</span>';
  }
  function updateAsk(a) {
    var res = $('si-res'), why = $('si-why'); if (!res) return;
    var m = a.model, html = '';
    if (S.mode === 'w2r') {
      var p = SI.askWeight(a, S.weightKg);
      if (!p.ok) { res.innerHTML = '<div class="si-result"><div class="sub">Enter a weight above 0.</div></div>'; why.innerHTML = ''; return; }
      var scaleMax = Math.max(p.high + 2, 12);
      html = '<div class="si-result"><div class="lbl">Predicted repetitions</div><div class="num">' + (p.status === 'above-max' ? '0' : '~' + p.reps) + '<small>reps</small></div>' +
        '<div class="sub">' + num(p.percentOf1RM, 0) + '% of your estimated 1RM</div>' +
        (p.status !== 'above-max' ? '<div class="si-range">' + rangeBar(0, scaleMax, p.low, p.reps, p.high) + '<div class="si-bar-l"><span>Conservative <b>' + p.low + '</b></span><span>Optimistic <b>' + p.high + '</b></span></div></div>' : '') + '</div>' +
        '<div class="si-kv"><div class="box"><div class="k">Est. 1RM</div><div class="v">' + fwu(p.e1rm) + '</div></div><div class="box"><div class="k">Closest in your history</div><div class="v" style="font-size:12.5px">' + closestLine(p.closest) + '</div></div></div>' +
        p.warnings.map(function (w) { return '<div class="si-warn' + (p.status !== 'normal' ? '' : '') + '">⚠ ' + esc(w) + '</div>'; }).join('');
    } else {
      var q = SI.askReps(a, S.repsIn);
      if (!q.ok) { res.innerHTML = '<div class="si-result"><div class="sub">Enter 1 or more reps.</div></div>'; why.innerHTML = ''; return; }
      var snap = loadable(q.weight), lo = SI.roundToIncrement(toDisp(q.conservative), step()), hi = SI.roundToIncrement(toDisp(q.optimistic), step());
      var bmin = toDisp(m.E) * 0.4, bmax = toDisp(m.E);
      html = '<div class="si-result"><div class="lbl">Estimated working weight</div><div class="num">' + num(snap, 1) + '<small>' + unit() + '</small></div>' +
        '<div class="sub">' + num(q.percentOf1RM, 0) + '% of your estimated 1RM · rounded to ' + num(step(), 1) + ' ' + unit() + ' steps</div>' +
        '<div class="si-range">' + rangeBar(bmin, bmax, toDisp(q.conservative), toDisp(q.weight), toDisp(q.optimistic)) + '<div class="si-bar-l"><span>Conservative <b>' + num(lo, 1) + '</b></span><span>Optimistic <b>' + num(hi, 1) + '</b></span></div></div></div>' +
        '<div class="si-kv"><div class="box"><div class="k">Model value</div><div class="v">' + fwu(q.weight, 2) + '</div></div><div class="box"><div class="k">Nearest rep count you did</div><div class="v" style="font-size:12.5px">' + closestLine(q.closest) + '</div></div></div>' +
        q.warnings.map(function (w) { return '<div class="si-warn">⚠ ' + esc(w) + '</div>'; }).join('');
    }
    res.innerHTML = html;
    var basis = (S.mode === 'w2r' ? SI.askWeight(a, S.weightKg) : SI.askReps(a, S.repsIn)).basis;
    why.innerHTML = '<details class="si-why"><summary>Why this prediction?</summary>' +
      '<p>' + esc(basis) + '</p>' +
      '<p><b style="color:var(--text)">Confidence: ' + esc(a.confidence.label) + '.</b></p><ul>' + a.confidence.reasons.map(function (r) { return '<li class="' + (r.ok === true ? 'ok' : r.ok === false ? 'no' : '') + '">' + esc(r.text) + '</li>'; }).join('') + '</ul>' +
      formulaTable(m) +
      '<p>This is a statistical estimate from your own logged sets — not a guarantee and not a recorded personal best. It never uses other exercises, and it is least reliable outside the weights and rep ranges you have actually logged.</p></details>';
  }
  function formulaTable(m) {
    var f = m.estimate.formulas, rs = m.estimate.representativeSet;
    return '<p style="margin-bottom:4px">1RM by formula, from a representative set (' + fwu(rs.weight) + ' × ' + rs.reps + '):</p><table class="si-table"><tr><th>Formula</th><th>Epley</th><th>Brzycki</th><th>Lombardi</th><th>Blend</th></tr><tr><td>1RM</td><td>' + fw(f.epley) + '</td><td>' + (isFinite(f.brzycki) ? fw(f.brzycki) : '—') + '</td><td>' + fw(f.lombardi) + '</td><td>' + fw(f.blended) + '</td></tr></table>';
  }

  /* ---------- CURVE pane ---------- */
  function paneCurve(a, pane) {
    var m = a.model, cv = a.curve, W = 360, H = 240, L = 34, R = 12, T = 12, B = 30;
    var yMax = 24;
    var pts = cv.points.filter(function (p) { return p.reps <= yMax + 2; });
    if (pts.length < 3) { pane.innerHTML = '<div class="si-empty-page">Not enough data to draw a curve yet.</div>'; return; }
    var xMin = pts[0].weight, xMax = m.E;
    cv.recorded.forEach(function (r) { if (r.weight < xMin && r.reps <= yMax) xMin = Math.max(r.weight, xMin * 0.9); });
    var x = function (w) { return L + (w - xMin) / (xMax - xMin) * (W - L - R); };
    var y = function (r) { return T + (1 - Math.min(r, yMax) / yMax) * (H - T - B); };
    var zoneLo = x(Math.max(xMin, m.loadRange.min * 0.8)), zoneHi = x(Math.min(xMax, m.loadRange.max * 1.10));
    var xt = niceTicks(toDisp(xMin), toDisp(xMax), 5), yt = [0, 4, 8, 12, 16, 20, 24];
    var line = pts.map(function (p) { return [x(p.weight), y(p.reps)]; });
    var hiP = pts.map(function (p) { return [x(p.weight), y(p.high)]; }), loP = pts.map(function (p) { return [x(p.weight), y(p.low)]; });
    var band = 'M' + hiP.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('L') + 'L' + loP.slice().reverse().map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('L') + 'Z';
    var grid = yt.map(function (v) { return '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="#2E333A" stroke-width=".6"/><text x="' + (L - 5) + '" y="' + (y(v) + 3) + '" text-anchor="end">' + v + '</text>'; }).join('') +
      xt.map(function (v) { var px = x(toKg(v)); return '<text x="' + px.toFixed(1) + '" y="' + (H - 12) + '" text-anchor="middle">' + num(v, 0) + '</text>'; }).join('');
    var shade = '<rect x="' + L + '" y="' + T + '" width="' + Math.max(0, zoneLo - L) + '" height="' + (H - T - B) + '" fill="#fff" opacity=".035"/><rect x="' + zoneHi + '" y="' + T + '" width="' + Math.max(0, W - R - zoneHi) + '" height="' + (H - T - B) + '" fill="#fff" opacity=".035"/>';
    var dots = cv.recorded.filter(function (r) { return r.weight >= xMin * 0.98 && r.weight <= xMax; }).map(function (r) {
      var clip = r.reps > yMax; return '<circle cx="' + x(r.weight).toFixed(1) + '" cy="' + y(r.reps).toFixed(1) + '" r="3.6" fill="' + (clip ? 'none' : '#E8B32C') + '" stroke="#E8B32C" stroke-width="1.5"/>';
    }).join('');
    var len = polyLen(line);
    var svg = '<svg class="si-svg" id="si-curve" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Theoretical weight versus repetitions curve">' + shade + grid +
      '<path d="' + band + '" fill="#E8B32C" opacity=".10"/>' +
      '<path d="' + pathOf(line) + '" fill="none" stroke="#c9ccd1" stroke-width="2" stroke-dasharray="5 4" stroke-linecap="round" class="si-draw si-anim" style="--len:' + len + '"/>' +
      '<line x1="' + x(m.E) + '" x2="' + x(m.E) + '" y1="' + T + '" y2="' + (H - B) + '" stroke="#E8B32C" stroke-width="1" stroke-dasharray="2 3" opacity=".6"/><text x="' + (x(m.E) - 4) + '" y="' + (T + 9) + '" text-anchor="end" style="fill:#E8B32C">est. 1RM</text>' +
      dots + '<g id="si-cross" style="display:none"><line id="si-cl" y1="' + T + '" y2="' + (H - B) + '" stroke="#EDEAE3" stroke-width="1" opacity=".5"/><circle id="si-cc" r="5" fill="#121417" stroke="#EDEAE3" stroke-width="2"/></g>' +
      '<text x="' + (W / 2) + '" y="' + (H - 1) + '" text-anchor="middle">weight (' + unit() + ')</text><text x="9" y="' + (T + 6) + '" transform="rotate(-90 9 ' + (T + 40) + ')" text-anchor="end">reps</text></svg>';
    pane.innerHTML = '<div class="card" style="padding:12px 10px 12px"><div class="si-legend"><span><i class="dot"></i>Recorded best per weight</span><span><i class="dash"></i>Theoretical curve</span><span style="opacity:.8"><i class="ring" style="opacity:.25"></i>Shaded = outside your logged range</span></div>' + svg +
      '<div class="si-readout" id="si-read"></div><div class="si-cap">Theoretical strength curve from your own history — a model, not a record of what you lifted. The faint band is the likely range. Drag across the chart to inspect any weight.</div></div>';
    var svgEl = $('si-curve');
    var cross = $('si-cross'), cl = $('si-cl'), cc = $('si-cc'), read = $('si-read');
    function at(w) {
      w = Math.max(xMin, Math.min(xMax * 0.999, w));
      var p = SI.predictRepetitions(m, w); S.curveX = w;
      var px = x(w); cross.style.display = ''; cl.setAttribute('x1', px); cl.setAttribute('x2', px); cc.setAttribute('cx', px); cc.setAttribute('cy', y(p.repsExact));
      read.innerHTML = 'At <b>' + fwu(w) + '</b> → <b>~' + p.reps + ' reps</b> <span style="color:var(--text-dim)">(' + p.low + '–' + p.high + ')</span>' + (p.status !== 'normal' && p.status !== 'above-max' ? '<div style="font-size:11px;color:#d9a35c;margin-top:4px">outside your logged range — extrapolated</div>' : '');
    }
    function fromEvent(e) { var r = svgEl.getBoundingClientRect(), vx = (e.clientX - r.left) / r.width * W; return xMin + (vx - L) / (W - L - R) * (xMax - xMin); }
    var drag = false;
    svgEl.addEventListener('pointerdown', function (e) { drag = true; try { svgEl.setPointerCapture(e.pointerId); } catch (_) {} at(fromEvent(e)); });
    svgEl.addEventListener('pointermove', function (e) { if (drag || e.pointerType === 'mouse') at(fromEvent(e)); });
    svgEl.addEventListener('pointerup', function () { drag = false; });
    svgEl.addEventListener('pointercancel', function () { drag = false; });
    at(S.curveX != null ? S.curveX : (S.weightKg != null && S.weightKg > xMin && S.weightKg < xMax ? S.weightKg : (xMin + xMax) / 2));
  }

  /* ---------- TREND pane ---------- */
  function paneTrend(a, pane) {
    if (!S.rangeAuto) { S.rangeAuto = true; var order = ['30', '90', 'all']; if ((a.trends[S.range] || {}).nSessions < 2) { for (var q = 0; q < order.length; q++) if (a.trends[order[q]].nSessions >= 2) { S.range = order[q]; break; } } }
    var ranges = [['7', '7D'], ['30', '30D'], ['90', '90D'], ['all', 'All']];
    var tr = a.trends[S.range] || a.trends['30'];
    var head = '<div class="segmented" id="si-ranges" style="margin-bottom:12px">' + ranges.map(function (r) { return '<button data-r="' + r[0] + '" class="' + (S.range === r[0] ? 'active' : '') + '">' + r[1] + '</button>'; }).join('') + '</div>';
    var body;
    if (tr.nSessions < 2) {
      body = '<div class="card"><div class="si-empty">' + (tr.nSessions === 1 ? 'Only one session in this range — a trend needs at least two.' : 'No sessions in this range.') + (S.range === '7' || S.range === '30' ? ' Try a longer range.' : '') + '</div></div>';
    } else {
      body = '<div class="card" style="padding:12px 10px">' + trendSvg(a, tr) + '<div class="si-readout" id="si-tread"></div>' +
        '<div class="si-cap">Hollow points are <b>estimated</b> 1RM (a model). Solid points are the <b>actual</b> top weight you lifted that day. × marks sessions ignored as probable typos.</div></div>' +
        '<div class="si-stat"><div class="si-tile"><div class="k">Change</div><div class="v ' + dirClass(tr.direction) + '" style="font-size:18px">' + pct(tr.changePct) + '</div><div class="s">est. 1RM</div></div>' +
        '<div class="si-tile"><div class="k">Per week</div><div class="v" style="font-size:18px">' + (tr.slopePerWeek > 0 ? '+' : '') + fw(tr.slopePerWeek, 2) + '<small>' + unit() + '</small></div><div class="s">trend</div></div>' +
        '<div class="si-tile"><div class="k">Sessions</div><div class="v" style="font-size:18px">' + tr.nSessions + '</div><div class="s">' + (tr.lowConfidence ? 'only two points' : 'in range') + '</div></div></div>';
    }
    var rec = a.records;
    var recs = '<div class="si-h">Records vs estimates</div><div class="si-kv" style="margin-top:0"><div class="box"><div class="k">Heaviest lifted (actual)</div><div class="v">' + (rec.weight ? fwu(rec.weight.weight) + ' × ' + rec.weight.reps : '—') + '</div></div>' +
      '<div class="box"><div class="k">Most reps in a set (actual)</div><div class="v">' + (rec.maxReps ? rec.maxReps.reps + ' @ ' + fwu(rec.maxReps.weight) : '—') + '</div></div>' +
      '<div class="box" style="grid-column:1/-1"><div class="k">Highest estimated 1RM (a calculation, not a lift)</div><div class="v">' + (rec.bestE1RM ? '≈ ' + fwu(rec.bestE1RM.value) + ' <span style="color:var(--text-faint)">from ' + fwu(rec.bestE1RM.weight) + ' × ' + rec.bestE1RM.reps + ' · ' + fdate(rec.bestE1RM.date) + '</span>' : '—') + '</div></div></div>';
    pane.innerHTML = head + body + recs;
    Array.prototype.forEach.call(pane.querySelectorAll('#si-ranges button'), function (b) { b.onclick = function () { S.range = b.getAttribute('data-r'); S.trendSel = null; paneTrend(a, pane); }; });
    if (tr.nSessions >= 2) wireTrend(a, tr);
  }
  var trendCtx = null;
  function trendSvg(a, tr) {
    var W = 360, H = 230, L = 38, R = 14, T = 14, B = 28, pts = tr.points;
    var all = a.history.sessions.filter(function (s) { return s.day >= (pts[0].day) && s.day <= pts[pts.length - 1].day; });
    var ignored = all.filter(function (s) { return s.anomalous && s.e1rm != null; });
    var vals = pts.map(function (p) { return p.e1rm; }).concat(pts.map(function (p) { return p.weight; }));
    var fc = a.forecast, fcDay = null, fcVal = null;
    if (S.range !== '7' && fc && fc.e1rmNext) { fcVal = fc.e1rmNext; fcDay = pts[pts.length - 1].day + Math.max(1, Math.round(fc.expectedGapDays)); vals.push(fcVal); }
    var vMin = Math.min.apply(null, vals), vMax = Math.max.apply(null, vals), pad = (vMax - vMin) * 0.15 || vMax * 0.05;
    vMin -= pad; vMax += pad;
    var d0 = pts[0].day, d1 = fcDay != null ? fcDay : pts[pts.length - 1].day; if (d1 === d0) d1 = d0 + 1;
    var x = function (d) { return L + (d - d0) / (d1 - d0) * (W - L - R); };
    var y = function (v) { return T + (1 - (v - vMin) / (vMax - vMin)) * (H - T - B); };
    var yt = niceTicks(toDisp(vMin), toDisp(vMax), 4);
    var grid = yt.map(function (v) { var py = y(toKg(v)); return '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + py.toFixed(1) + '" y2="' + py.toFixed(1) + '" stroke="#2E333A" stroke-width=".6"/><text x="' + (L - 5) + '" y="' + (py + 3).toFixed(1) + '" text-anchor="end">' + num(v, 0) + '</text>'; }).join('');
    var nx = Math.min(4, pts.length), xl = '';
    for (var i = 0; i < nx; i++) { var idx = nx === 1 ? 0 : Math.round(i * (pts.length - 1) / (nx - 1)); xl += '<text x="' + x(pts[idx].day).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="' + (i === 0 ? 'start' : i === nx - 1 ? 'end' : 'middle') + '">' + fdate(pts[idx].date) + '</text>'; }
    var est = pts.map(function (p) { return [x(p.day), y(p.e1rm)]; });
    var len = polyLen(est);
    var fcPath = '';
    if (fcDay != null) { var lp = est[est.length - 1]; fcPath = '<line x1="' + lp[0].toFixed(1) + '" y1="' + lp[1].toFixed(1) + '" x2="' + x(fcDay).toFixed(1) + '" y2="' + y(fcVal).toFixed(1) + '" stroke="#E8B32C" stroke-width="1.6" stroke-dasharray="2 4" opacity=".8"/><circle cx="' + x(fcDay).toFixed(1) + '" cy="' + y(fcVal).toFixed(1) + '" r="4" fill="none" stroke="#E8B32C" stroke-width="1.4" stroke-dasharray="2 2"/><text x="' + x(fcDay).toFixed(1) + '" y="' + (y(fcVal) + 16).toFixed(1) + '" text-anchor="end" style="fill:#E8B32C">forecast</text>'; }
    var wDots = pts.map(function (p, i) { return '<circle cx="' + x(p.day).toFixed(1) + '" cy="' + y(p.weight).toFixed(1) + '" r="3" fill="#EDEAE3" opacity=".85"/>'; }).join('');
    var eDots = pts.map(function (p) { return '<circle cx="' + x(p.day).toFixed(1) + '" cy="' + y(p.e1rm).toFixed(1) + '" r="3.4" fill="#121417" stroke="#E8B32C" stroke-width="1.6"/>'; }).join('');
    var xs = ignored.map(function (s) { var cx = x(s.day), cy = y(Math.min(vMax, Math.max(vMin, s.e1rm))); return '<path d="M' + (cx - 3) + ' ' + (cy - 3) + 'l6 6m0 -6l-6 6" stroke="#5D636B" stroke-width="1.6"/>'; }).join('');
    trendCtx = { pts: pts, x: x, y: y, W: W, H: H };
    return '<div class="si-legend"><span><i class="ring"></i>Estimated 1RM</span><span><i class="dot" style="background:#EDEAE3"></i>Actual top weight</span>' + (fcDay != null ? '<span><i class="ring" style="border-style:dashed"></i>Next forecast</span>' : '') + '</div>' +
      '<svg class="si-svg" id="si-trend" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Estimated 1RM progression">' + grid + xl +
      '<path d="' + pathOf(est) + '" fill="none" stroke="#E8B32C" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" opacity=".75" class="si-draw si-anim" style="--len:' + len + '"/>' + fcPath + wDots + eDots + xs +
      '<g id="si-tsel" style="display:none"><line id="si-tsl" y1="' + T + '" y2="' + (H - B) + '" stroke="#EDEAE3" stroke-width="1" opacity=".4"/></g></svg>';
  }
  function wireTrend(a, tr) {
    var svg = $('si-trend'), read = $('si-tread'); if (!svg) return;
    var c = trendCtx, pts = tr.points;
    function sel(i) {
      i = Math.max(0, Math.min(pts.length - 1, i)); S.trendSel = i;
      var p = pts[i], sess = a.history.sessions.filter(function (s) { return s.date === p.date; })[0];
      $('si-tsel').style.display = ''; $('si-tsl').setAttribute('x1', c.x(p.day)); $('si-tsl').setAttribute('x2', c.x(p.day));
      var top = sess && sess.topSet ? fwu(sess.topSet.weight) + ' × ' + sess.topSet.reps : '—';
      read.innerHTML = '<b>' + fdate(p.date) + '</b> · est. 1RM <b>' + fwu(p.e1rm) + '</b><br><span style="color:var(--text-dim)">Top set ' + top + (p.lowQuality ? ' · high-rep, less reliable' : '') + '</span>';
    }
    function fromEvent(e) { var r = svg.getBoundingClientRect(), vx = (e.clientX - r.left) / r.width * c.W, best = 0, bd = 1e9; pts.forEach(function (p, i) { var d = Math.abs(c.x(p.day) - vx); if (d < bd) { bd = d; best = i; } }); return best; }
    var drag = false;
    svg.addEventListener('pointerdown', function (e) { drag = true; try { svg.setPointerCapture(e.pointerId); } catch (_) {} sel(fromEvent(e)); });
    svg.addEventListener('pointermove', function (e) { if (drag || e.pointerType === 'mouse') sel(fromEvent(e)); });
    svg.addEventListener('pointerup', function () { drag = false; });
    sel(S.trendSel != null ? S.trendSel : pts.length - 1);
  }

  /* ---------- INSIGHTS pane ---------- */
  function paneInsights(a, pane) {
    var f = a.forecast, h = '';
    if (f && f.atWeight.ok) {
      var p = f.atWeight, sg = f.suggestion;
      h += '<div class="card"><div class="card-title">Next-session forecast</div>' +
        '<div style="font-size:12.5px;color:var(--text-dim);margin-bottom:8px">Last time: <b style="color:var(--text);font-family:var(--font-mono)">' + fwu(f.basis.weight) + ' × ' + f.basis.reps + '</b> · ' + ago(f.basis.daysAgo) + '</div>' +
        '<div class="si-result" style="margin-top:0"><div class="lbl">Expected at ' + fwu(f.basis.weight) + '</div><div class="num" style="font-size:40px">~' + p.reps + '<small>reps</small></div><div class="sub">likely range ' + p.low + '–' + p.high + ' reps' + (Math.abs(f.trendPerSessionPct) >= 0.1 ? ' · recent trend ' + pct(f.trendPerSessionPct) + '/session' : '') + '</div></div>' +
        '<div class="si-kv"><div class="box"><div class="k">Weight for ' + sg.repLow + '–' + sg.repHigh + ' reps</div><div class="v">' + num(SI.roundToIncrement(toDisp(sg.weightLow), step()), 1) + '–' + num(SI.roundToIncrement(toDisp(sg.weightHigh), step()), 1) + ' ' + unit() + '</div></div>' +
        '<div class="box"><div class="k">Typical gap</div><div class="v">~' + Math.round(f.expectedGapDays) + ' days</div></div></div>' +
        f.notes.map(function (n, i, arr) { return '<div class="si-cap" style="' + (i === arr.length - 1 ? '' : 'color:#d9a35c') + '">' + esc(n) + '</div>'; }).join('') + '</div>';
    }
    h += '<div class="si-h">What the data says</div>' + a.insights.map(function (i) { return '<div class="si-ins ' + i.type + '"><h4>' + esc(i.title) + '</h4><p>' + esc(i.detail) + '</p></div>'; }).join('');
    h += '<div class="si-h">Prediction accuracy</div>' + accuracyHtml(a);
    pane.innerHTML = h;
  }
  function accuracyHtml(a) {
    var s = a.backtest.summary, pts = a.backtest.points, out = '';
    if (!s.n) {
      out += '<div class="card"><div class="si-empty">Not enough comparable sessions to back-test yet. Once you have a few sessions at similar weights, this shows how closely the model predicted your top set each time — using only the sessions before it.</div></div>';
    } else {
      out += '<div class="card"><div class="si-stat" style="margin-top:0"><div class="si-tile"><div class="k">Typical miss</div><div class="v" style="font-size:18px">' + num(s.medianAbsRepError, 1) + '<small>reps</small></div></div>' +
        '<div class="si-tile"><div class="k">Within ±1 rep</div><div class="v" style="font-size:18px">' + Math.round(s.within1Rep * 100) + '<small>%</small></div></div>' +
        '<div class="si-tile"><div class="k">Back-tested</div><div class="v" style="font-size:18px">' + s.n + '</div></div></div>' +
        '<div class="si-cap">Each session’s top set was predicted using only earlier sessions' + (s.trend ? ' · accuracy is <b style="color:var(--text)">' + s.trend + '</b>' : '') + (Math.abs(s.meanSignedRepError) >= 0.5 ? ' · on average you ' + (s.meanSignedRepError > 0 ? 'beat' : 'fell short of') + ' the prediction by ' + num(Math.abs(s.meanSignedRepError), 1) + ' rep' + (Math.abs(s.meanSignedRepError) === 1 ? '' : 's') : '') + '.</div>' +
        '<table class="si-table" style="margin-top:10px"><tr><th>Date</th><th>Weight</th><th>Pred.</th><th>Actual</th><th>Error</th></tr>' +
        pts.slice(-8).reverse().map(function (p) { return '<tr><td>' + fdate(p.date) + '</td><td>' + fw(p.weight) + '</td><td>' + p.predicted + '</td><td>' + p.actual + '</td><td class="' + (p.error === 0 ? '' : p.error > 0 ? 'si-ok' : 'si-bad') + '">' + (p.error > 0 ? '+' : '') + p.error + '</td></tr>'; }).join('') + '</table>' +
        '<div class="si-cap">Sessions at a materially different weight or after a long break are skipped, not scored (' + a.backtest.skipped.length + ' skipped).</div></div>';
    }
    var mine = store.forecasts.filter(function (r) { return r.key === a.key && r.status === 'resolved'; }).slice(-6).reverse();
    if (mine.length) {
      out += '<div class="si-h">Forecasts you were shown</div><div class="card"><table class="si-table"><tr><th>Session</th><th>Weight</th><th>Forecast</th><th>Actual</th><th>Error</th></tr>' +
        mine.map(function (r) { return '<tr><td>' + fdate(r.resolvedDate) + '</td><td>' + fw(r.weight) + '</td><td>' + r.expected + ' (' + r.low + '–' + r.high + ')</td><td>' + r.actual + '</td><td class="' + (r.error === 0 ? '' : r.error > 0 ? 'si-ok' : 'si-bad') + '">' + (r.error > 0 ? '+' : '') + r.error + '</td></tr>'; }).join('') + '</table><div class="si-cap">Forecasts are logged when you view them and compared with your next session at the same weight.</div></div>';
    }
    return out;
  }

  return { mountCard: mountCard, open: open, close: close, isOpen: isOpen };
})();
