/* ============================================================
   Plate & Progress — tiny offline PDF writer for the training report
   ------------------------------------------------------------
   No libraries, no network. Writes a real PDF 1.4 (Helvetica,
   A4, print friendly) with text, bullets, bars and sparklines.
   ReportPDF.render(report, {name}) -> Uint8Array
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReportPDF = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Helvetica advance widths for ASCII 32..126 (1/1000 em) */
  var HW = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015,
    667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
    278, 278, 278, 469, 556, 333,
    556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500,
    334, 260, 334, 584];
  var PW = 595.28, PH = 841.89, MX = 44, TOP = 52, BOT = 54;
  var C = {
    ink: [0.10, 0.11, 0.13], dim: [0.38, 0.40, 0.44], faint: [0.62, 0.64, 0.67], line: [0.86, 0.87, 0.89],
    amber: [0.91, 0.70, 0.17], amberDark: [0.62, 0.45, 0.04], rust: [0.76, 0.33, 0.23], good: [0.28, 0.58, 0.38],
    band: [0.07, 0.08, 0.09], card: [0.97, 0.96, 0.93], white: [1, 1, 1], bar: [0.85, 0.86, 0.88]
  };

  function clean(t) {
    return String(t == null ? '' : t)
      .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
      .replace(/→/g, '->').replace(/×/g, 'x').replace(/≤/g, '<=').replace(/≥/g, '>=')
      .replace(/≈/g, '~').replace(/[·•]/g, '-').replace(/&middot;/g, '-').replace(/&times;/g, 'x')
      .replace(/[\r\n\t]+/g, ' ').replace(/[^\x20-\x7E]/g, '');
  }
  function width(t, size, bold) {
    var w = 0; for (var i = 0; i < t.length; i++) { var c = t.charCodeAt(i) - 32; w += HW[c] != null ? HW[c] : 556; }
    return w * size / 1000 * (bold ? 1.07 : 1);
  }
  function wrap(text, size, maxW, bold) {
    var words = clean(text).split(' ').filter(function (x) { return x.length; }), lines = [], cur = '';
    words.forEach(function (w) {
      var test = cur ? cur + ' ' + w : w;
      if (width(test, size, bold) <= maxW || !cur) {
        if (width(w, size, bold) > maxW && !cur) { // very long token: hard split
          var piece = ''; for (var i = 0; i < w.length; i++) { if (width(piece + w[i], size, bold) > maxW) { lines.push(piece); piece = ''; } piece += w[i]; }
          cur = piece;
        } else cur = test;
      } else { lines.push(cur); cur = w; }
    });
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }
  function esc(t) { return t.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }
  function f2(n) { return (Math.round(n * 100) / 100).toString(); }
  function col(c, stroke) { return f2(c[0]) + ' ' + f2(c[1]) + ' ' + f2(c[2]) + (stroke ? ' RG' : ' rg'); }

  /* ---------- document builder ---------- */
  function Doc(meta) {
    this.pages = []; this.meta = meta || {}; this.y = 0; this.page = null; this.newPage();
  }
  Doc.prototype.newPage = function () {
    this.page = { ops: [] }; this.pages.push(this.page); this.y = PH - TOP;
  };
  Doc.prototype.need = function (h) { if (this.y - h < BOT) this.newPage(); };
  Doc.prototype.op = function (s) { this.page.ops.push(s); };
  Doc.prototype.text = function (x, y, t, size, color, bold) {
    this.op('BT ' + col(color || C.ink) + ' /' + (bold ? 'F2' : 'F1') + ' ' + f2(size) + ' Tf ' + f2(x) + ' ' + f2(y) + ' Td (' + esc(clean(t)) + ') Tj ET');
  };
  Doc.prototype.rect = function (x, y, w, h, color) { this.op(col(color) + ' ' + f2(x) + ' ' + f2(y) + ' ' + f2(w) + ' ' + f2(h) + ' re f'); };
  Doc.prototype.strokeRect = function (x, y, w, h, color, lw) { this.op(col(color, true) + ' ' + f2(lw || 0.7) + ' w ' + f2(x) + ' ' + f2(y) + ' ' + f2(w) + ' ' + f2(h) + ' re S'); };
  Doc.prototype.line = function (x1, y1, x2, y2, color, lw) { this.op(col(color, true) + ' ' + f2(lw || 0.7) + ' w ' + f2(x1) + ' ' + f2(y1) + ' m ' + f2(x2) + ' ' + f2(y2) + ' l S'); };
  Doc.prototype.dashed = function (x1, y1, x2, y2, color) { this.op('[3 3] 0 d ' + col(color, true) + ' 0.7 w ' + f2(x1) + ' ' + f2(y1) + ' m ' + f2(x2) + ' ' + f2(y2) + ' l S [] 0 d'); };
  Doc.prototype.poly = function (pts, color, lw) {
    if (pts.length < 2) return; var s = col(color, true) + ' ' + f2(lw || 1.4) + ' w 1 J 1 j ' + f2(pts[0][0]) + ' ' + f2(pts[0][1]) + ' m';
    for (var i = 1; i < pts.length; i++) s += ' ' + f2(pts[i][0]) + ' ' + f2(pts[i][1]) + ' l'; this.op(s + ' S');
  };
  Doc.prototype.gap = function (h) { this.y -= h; };
  Doc.prototype.para = function (t, o) {
    o = o || {}; var size = o.size || 10, lead = o.lead || size * 1.38, x = MX + (o.indent || 0), maxW = PW - MX - x - (o.right || 0);
    var lines = wrap(t, size, maxW, o.bold);
    for (var i = 0; i < lines.length; i++) { this.need(lead); this.y -= lead; this.text(x, this.y + lead * 0.22, lines[i], size, o.color, o.bold); }
    if (o.after) this.y -= o.after;
  };
  Doc.prototype.h1 = function (t) { this.need(80); this.gap(10); this.y -= 18; this.text(MX, this.y, t, 16, C.ink, true); this.gap(5); this.line(MX, this.y, PW - MX, this.y, C.amber, 1.6); this.gap(6); };
  Doc.prototype.h2 = function (t, color) { this.need(30); this.gap(6); this.y -= 13; this.text(MX, this.y, t, 11.5, color || C.ink, true); this.gap(3); };
  Doc.prototype.bullet = function (t, o) {
    o = o || {}; var size = o.size || 10, lead = size * 1.38, ind = o.indent || 14, maxW = PW - 2 * MX - ind;
    var lines = wrap(t, size, maxW, false);
    this.need(lead * Math.min(lines.length, 3) + 2);
    for (var i = 0; i < lines.length; i++) {
      this.need(lead); this.y -= lead;
      if (i === 0) this.rect(MX + 2, this.y + size * 0.28, 4, 4, o.color || C.amber);
      this.text(MX + ind, this.y + lead * 0.22, lines[i], size, o.textColor || C.ink);
    }
    this.gap(o.after != null ? o.after : 3);
  };

  /* ---------- composite blocks ---------- */
  Doc.prototype.tile = function (x, y, w, h, label, value, sub) {
    this.rect(x, y, w, h, C.card); this.strokeRect(x, y, w, h, C.line, 0.6);
    this.text(x + 9, y + h - 15, label.toUpperCase(), 7.2, C.dim, true);
    this.text(x + 9, y + h - 36, value, 18, C.ink, true);
    if (sub) this.text(x + 9, y + 9, sub, 7.8, C.dim);
  };
  Doc.prototype.priority = function (n, p) {
    var inner = PW - 2 * MX - 46, tl = wrap(p.title, 11.5, inner, true), al = wrap(p.action, 9.6, inner), cl = wrap('Check: ' + p.check, 9.2, inner, true);
    var h = 14 + tl.length * 15 + al.length * 13.2 + cl.length * 12.6 + 14;
    this.need(h + 8); var top = this.y, x = MX, y = top - h;
    this.rect(x, y, PW - 2 * MX, h, C.card); this.strokeRect(x, y, PW - 2 * MX, h, C.line, 0.6);
    this.rect(x, y, 4, h, C.amber);
    this.text(x + 16, top - 24, String(n), 20, C.amber, true);
    var cy = top - 15; tl.forEach(function (l) { this.text(x + 40, cy - 3, l, 11.5, C.ink, true); cy -= 15; }, this);
    cy -= 1; al.forEach(function (l) { this.text(x + 40, cy - 3, l, 9.6, C.ink); cy -= 13.2; }, this);
    cy -= 2; cl.forEach(function (l) { this.text(x + 40, cy - 3, l, 9.2, C.amberDark, true); cy -= 12.6; }, this);
    this.y = y - 8;
  };

  /* bar chart: values [{label, value, sub?}], with optional goal line and band */
  Doc.prototype.bars = function (title, rows, o) {
    o = o || {}; var h = 14 + (o.height || 86) + 20; this.need(h + 18);
    this.text(MX, this.y - 10, title, 9.5, C.ink, true);
    if (o.note) this.text(PW - MX - width(clean(o.note), 7.6), this.y - 10, o.note, 7.6, C.dim);
    var cx = MX, cw = PW - 2 * MX, ch = o.height || 86, base = this.y - 24 - ch;
    var maxV = Math.max.apply(null, rows.map(function (r) { return r.value; }).concat([o.goal || 0, o.max || 0, 1])) * 1.1;
    this.line(cx, base, cx + cw, base, C.line, 0.7);
    var n = rows.length, slot = cw / n, bw = Math.min(34, slot * 0.58);
    if (o.goal) { var gy = base + o.goal / maxV * ch; this.dashed(cx, gy, cx + cw, gy, C.faint); this.text(cx + cw - 24, gy + 3, o.goalLabel || 'goal', 7, C.dim); }
    rows.forEach(function (r, i) {
      var bx = cx + slot * i + (slot - bw) / 2, bh = r.value / maxV * ch;
      this.rect(bx, base, bw, Math.max(bh, r.value > 0 ? 1.5 : 0), r.color || (r.hot ? C.amber : C.bar));
      var vt = String(r.text != null ? r.text : r.value), vw = width(clean(vt), 7.6, true);
      this.text(bx + bw / 2 - vw / 2, base + bh + 3, vt, 7.6, C.ink, true);
      var lw = width(clean(r.label), 7.4); this.text(bx + bw / 2 - lw / 2, base - 10, r.label, 7.4, C.dim);
    }, this);
    this.y = base - 20;
  };
  /* horizontal bars for muscle groups with an optional target band */
  Doc.prototype.hbars = function (title, rows, o) {
    o = o || {}; var rh = 17, h = 20 + rows.length * rh + 12; this.need(h);
    this.text(MX, this.y - 10, title, 9.5, C.ink, true); if (o.note) this.text(PW - MX - width(clean(o.note), 7.6), this.y - 10, o.note, 7.6, C.dim);
    var x0 = MX + 66, cw = PW - 2 * MX - 66 - 40, top = this.y - 22;
    var maxV = Math.max.apply(null, rows.map(function (r) { return r.value; }).concat([o.bandHi || 0, 1])) * 1.15;
    if (o.bandLo != null) this.rect(x0 + o.bandLo / maxV * cw, top - rows.length * rh + 3, (o.bandHi - o.bandLo) / maxV * cw, rows.length * rh - 2, [0.93, 0.96, 0.93]);
    rows.forEach(function (r, i) {
      var y = top - (i + 1) * rh + 4;
      this.text(MX, y + 2, r.label, 8.6, C.ink, true);
      this.rect(x0, y, Math.max(r.value / maxV * cw, r.value > 0 ? 1.5 : 0), 9, r.color || C.amber);
      this.text(x0 + r.value / maxV * cw + 5, y + 1.5, String(r.text != null ? r.text : r.value), 8, C.dim, true);
    }, this);
    this.y = top - rows.length * rh - 6;
  };
  Doc.prototype.spark = function (x, y, w, h, vals, color) {
    if (vals.length < 2) return; var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals); if (mx === mn) { mx += 1; mn -= 1; }
    var pts = vals.map(function (v, i) { return [x + i / (vals.length - 1) * w, y + (v - mn) / (mx - mn) * h]; });
    this.poly(pts, color || C.amber, 1.5);
    var p = pts[pts.length - 1]; this.rect(p[0] - 2, p[1] - 2, 4, 4, color || C.amber);
  };

  /* ---------- serialise ---------- */
  Doc.prototype.finish = function () {
    var n = this.pages.length, objs = [], self = this;
    function add(s) { objs.push(s); return objs.length; }
    var catalog = add(null), pagesObj = add(null), f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'), f2o = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    var kids = [];
    this.pages.forEach(function (pg, i) {
      // footer
      var foot = 'BT ' + col(C.faint) + ' /F1 7.6 Tf ' + f2(MX) + ' 28 Td (' + esc(clean('Plate & Progress  -  ' + (self.meta.footer || 'Training report'))) + ') Tj ET ' +
        'BT ' + col(C.faint) + ' /F1 7.6 Tf ' + f2(PW - MX - 38) + ' 28 Td (' + esc('Page ' + (i + 1) + ' / ' + n) + ') Tj ET ' + col(C.line, true) + ' 0.5 w ' + f2(MX) + ' 40 m ' + f2(PW - MX) + ' 40 l S';
      var stream = pg.ops.join('\n') + '\n' + foot;
      var sid = add('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
      var pid = add('<< /Type /Page /Parent ' + pagesObj + ' 0 R /MediaBox [0 0 ' + f2(PW) + ' ' + f2(PH) + '] /Resources << /Font << /F1 ' + f1 + ' 0 R /F2 ' + f2o + ' 0 R >> >> /Contents ' + sid + ' 0 R >>');
      kids.push(pid + ' 0 R');
    });
    objs[catalog - 1] = '<< /Type /Catalog /Pages ' + pagesObj + ' 0 R >>';
    objs[pagesObj - 1] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + n + ' >>';
    var info = add('<< /Title (' + esc(clean(this.meta.title || 'Training report')) + ') /Producer (Plate & Progress) >>');
    var out = '%PDF-1.4\n', offs = [];
    objs.forEach(function (o, i) { offs.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
    var xref = out.length;
    out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
    offs.forEach(function (o) { out += ('0000000000' + o).slice(-10) + ' 00000 n \n'; });
    out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root ' + catalog + ' 0 R /Info ' + info + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF';
    var bytes = new Uint8Array(out.length); for (var i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
    return bytes;
  };

  /* ============================================================
     THE REPORT
     ============================================================ */
  var SCIENCE = [
    { topic: 'Weekly sets per muscle', rule: 'About 10-20 hard sets per muscle per week; below ~10 grows less, beyond ~20 returns shrink.', level: 'Strong evidence', ref: 'Schoenfeld, Ogborn & Krieger 2017, J Sports Sci (dose-response of weekly volume)' },
    { topic: 'Training close to failure', rule: 'Most sets within 0-3 reps of failure; sets with 4+ reps left add little growth stimulus.', level: 'Strong evidence', ref: 'Refalo et al. 2023, Sports Med (proximity to failure meta-analysis)' },
    { topic: 'Frequency', rule: 'Hitting a muscle about twice a week is a convenient way to spread weekly sets; once volume is equal, frequency itself matters little.', level: 'Moderate evidence', ref: 'Schoenfeld, Grgic & Krieger 2016, Sports Med (frequency meta-analysis)' },
    { topic: 'Rep range', rule: 'Roughly 5-30 reps all build muscle if sets are taken close to failure; 6-12 for compounds and 10-20 for isolation are efficient.', level: 'Strong evidence', ref: 'Schoenfeld et al. 2017, J Strength Cond Res (low vs high load)' },
    { topic: 'Progressive overload', rule: 'Muscle grows when the load or reps you handle keep rising; use double progression (add reps up to the top of the range, then add weight).', level: 'Strong evidence', ref: 'Core principle of resistance training; ACSM position stand 2009' },
    { topic: 'Volume ramps and lighter weeks', rule: 'Raise weekly volume gradually and plan a lighter week when performance drops.', level: 'Practical guideline', ref: 'Coaching consensus; evidence for exact numbers is limited' }
  ];
  var SEV = { alert: 'Needs attention', warn: 'Worth fixing', info: 'Worth knowing', good: 'Going well' };
  function fmtLong(s) { var d = new Date(s + 'T00:00:00Z'); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); }
  function fmtShort(s) { var d = new Date(s + 'T00:00:00Z'); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }); }

  function render(rep, opts) {
    opts = opts || {};
    var d = new Doc({ title: 'Plate & Progress training report', footer: 'Training report ' + fmtLong(rep.today) });
    // header band
    d.rect(0, PH - 112, PW, 112, C.band);
    d.rect(0, PH - 114, PW, 2.4, C.amber);
    d.text(MX, PH - 44, 'PLATE & PROGRESS', 9, C.amber, true);
    d.text(MX, PH - 74, 'Your training report', 25, C.white, true);
    var sub = fmtLong(rep.today) + (rep.splitName ? '   |   ' + rep.splitName : '') + '   |   ' + rep.snapshot.sessions + ' sessions logged since ' + fmtShort(rep.snapshot.firstDate);
    d.text(MX, PH - 96, sub, 9.2, [0.72, 0.74, 0.77]);
    d.y = PH - 112 - 14;

    if (rep.insufficient) {
      d.h1('Not enough data yet');
      d.para(rep.limits[0], { size: 10.5 });
      d.para('Come back after a few more sets. Everything in this report is built from the sets you log.', { size: 10, color: C.dim });
      return d.finish();
    }
    if (rep.limited) { d.para('EARLY REPORT: built from very little data (under 3 sessions). Treat it as a first read; it gets much sharper after a few weeks of logging.', { size: 9.4, bold: true, color: C.amberDark, after: 6 }); }

    // snapshot tiles
    var S = rep.snapshot, tw = (PW - 2 * MX - 3 * 10) / 4, ty = d.y - 64, tx = MX;
    var vc = S.volumeChangePct;
    var tiles = [
      ['Sessions, 4 wks', String(S.last28.sessions), S.prev28.sessions + ' in the 4 wks before'],
      ['Hard sets, 4 wks', String(S.last28.hardSets), S.prev28.hardSets + ' in the 4 wks before'],
      ['Volume change', vc == null ? 'n/a' : (vc > 0 ? '+' : '') + Math.round(vc) + '%', S.last28.volume.toLocaleString('en-US') + ' kg lifted'],
      ['Week streak', String(rep.consistency.streakWeeks), 'weeks hitting ' + rep.consistency.goal + ' sessions']
    ];
    tiles.forEach(function (t, i) { d.tile(tx + i * (tw + 10), ty, tw, 58, t[0], t[1], t[2]); });
    d.y = ty - 6;

    // priorities
    d.h1('Your 3 priorities');
    if (rep.priorities.length) rep.priorities.forEach(function (p, i) { d.priority(i + 1, p); if (p.why) { d.y += 4; d.para('Why: ' + p.why + '  [' + p.level + ']', { size: 8.6, color: C.dim, indent: 8, after: 6 }); } });
    else d.para('Nothing urgent. Keep doing what you are doing and keep logging.', { size: 10.5 });

    // going well
    if (rep.going.length) {
      d.h1('What is going well');
      rep.going.slice(0, 6).forEach(function (g) { d.bullet(g.title + '. ' + g.evidence, { color: C.good }); });
    }

    // do / don't
    d.h1('What to do');
    if (rep.doList.length) rep.doList.forEach(function (t) { d.bullet(t, { color: C.good }); }); else d.para('No changes needed right now.', { size: 10 });
    d.h1('What not to do');
    if (rep.dontList.length) rep.dontList.forEach(function (t) { d.bullet(t, { color: C.rust }); }); else d.para('Nothing specific to avoid right now.', { size: 10 });

    // charts
    d.h1('Your numbers at a glance');
    var cd = rep.consistency;
    d.bars('Sessions per week', cd.weeks.map(function (w) { return { label: fmtShort(w.start), value: w.n, hot: w.partial, color: w.partial ? C.amber : null, text: w.n + (w.partial ? '*' : '') }; }), { goal: cd.goal, goalLabel: 'goal ' + cd.goal, note: '* current week' });
    if (rep.balance.totalHard >= 12) {
      var G = ['chest', 'back', 'shoulders', 'arms', 'legs', 'core'], L = { chest: 'Chest', back: 'Back', shoulders: 'Shoulders', arms: 'Arms', legs: 'Legs', core: 'Core' };
      d.hbars('Hard sets per muscle group, per week (4-week average)', G.map(function (g) { var v = rep.balance.perGroup[g].perWeek; return { label: L[g], value: v, color: (v >= 8 && v <= 20) ? C.good : (v < 4 ? C.rust : C.amber) }; }), { bandLo: 8, bandHi: 20, note: 'green band = 8-20' });
    }
    var wk = rep.weekly.weeks || [];
    if (wk.some(function (w) { return w.volume > 0; })) d.bars('Weekly volume (kg lifted)', wk.map(function (w) { return { label: fmtShort(w.start), value: w.volume, text: w.volume >= 1000 ? (Math.round(w.volume / 100) / 10) + 'k' : String(w.volume), hot: w.partial, color: w.partial ? C.amber : null }; }), { height: 76 });
    var ef = rep.effort;
    if (ef.rated >= 6) d.bars('Effort: how many reps you had left (RIR), last 4 weeks', ef.distribution.map(function (v, i) { return { label: i === 5 ? '5+' : String(i), value: v, color: i <= 3 ? C.amber : C.bar }; }), { height: 60, note: 'RIR 0-3 counts as a hard set' });

    // lifts
    if (rep.lifts.length) {
      d.h1('Your main lifts');
      rep.lifts.forEach(function (l) {
        var t = l.trend90 || {}, status = l.regress ? 'Trending down' : l.stalled ? 'Stalled' : (t.d === 'up' ? 'Progressing' : 'Holding steady');
        var sc = l.regress || l.stalled ? C.rust : (t.d === 'up' ? C.good : C.dim);
        d.need(54);
        var top = d.y, h = 46;
        d.rect(MX, top - h, PW - 2 * MX, h, C.card); d.strokeRect(MX, top - h, PW - 2 * MX, h, C.line, 0.6);
        d.text(MX + 10, top - 16, l.name, 11, C.ink, true);
        d.text(MX + 10, top - 31, status + (t.ch != null ? '  (' + (Math.abs(t.ch) < 0.5 ? 'flat' : (t.ch > 0 ? '+' : '') + (Math.round(t.ch * 10) / 10) + '%') + ' est. 1RM, 90 days)' : ''), 8.8, sc, true);
        var extra = []; if (l.e1rm) extra.push('est. 1RM ~' + Math.round(l.e1rm) + ' kg'); if (l.forecast) extra.push('next: ~' + l.forecast.reps + ' reps at ' + l.forecast.weight + ' kg'); if (l.avgRir != null) extra.push('avg RIR ' + (Math.round(l.avgRir * 10) / 10));
        d.text(MX + 10, top - 42, extra.join('   |   '), 7.8, C.dim);
        var vals = l.series.slice(-12).map(function (s) { return s.e1rm; });
        d.spark(PW - MX - 150, top - h + 9, 138, h - 20, vals, sc);
        d.y = top - h - 7;
      });
    }

    // graph-by-graph reading
    d.h1('Reading your graphs');
    d.para('Each block below matches a screen in the app, says what the graph shows for you right now, and what to do about it.', { size: 9.4, color: C.dim, after: 2 });
    rep.graphs.forEach(function (g) {
      d.h2(g.screen, C.amberDark);
      g.items.forEach(function (it) {
        d.need(46);
        d.para(it.chart, { size: 9.8, bold: true, after: 0 });
        d.para(it.reading, { size: 9.2, color: C.dim, indent: 8, after: 0 });
        d.para('Takeaway: ' + it.advice, { size: 9.2, indent: 8, after: 4 });
      });
    });

    // all findings with evidence
    if (rep.findings.length) {
      d.h1('Everything the report found');
      rep.findings.forEach(function (f) {
        d.need(40);
        var c = f.severity === 'good' ? C.good : (f.severity === 'info' ? C.dim : C.rust);
        d.para(SEV[f.severity].toUpperCase() + '   ' + f.title, { size: 9.6, bold: true, color: c, after: 0 });
        d.para(f.evidence, { size: 9, color: C.dim, indent: 8, after: f.why ? 0 : 3 });
        if (f.why) d.para('Why: ' + f.why + '  [' + f.level + ']', { size: 8.4, color: C.faint, indent: 8, after: 3 });
      });
    }

    d.h1('The science behind these suggestions');
    d.para('Advice in this report follows hypertrophy research and standard coaching practice; each note says how firm the evidence is.', { size: 9.2, color: C.dim, after: 3 });
    SCIENCE.forEach(function (sc) { d.need(46); d.para(sc.topic + '   [' + sc.level + ']', { size: 9.4, bold: true, after: 0 }); d.para(sc.rule, { size: 9, indent: 8, after: 0 }); d.para(sc.ref, { size: 8.2, color: C.faint, indent: 8, after: 3 }); });

    d.h1('How to read this report');
    rep.limits.forEach(function (t) { d.bullet(t, { size: 9, color: C.faint }); });
    return d.finish();
  }


  /* ============================================================
     THE WEEKLY REPORT
     ============================================================ */
  var GRAY2 = [0.78, 0.80, 0.83], PALE = [0.90, 0.95, 0.91];
  var LVLCOL = { 'Strong evidence': C.good, 'Moderate evidence': C.amberDark, 'Practical guideline': C.dim };
  function pctTxt(v) { return v == null ? 'n/a' : (Math.abs(v) < 0.5 ? 'flat' : (v > 0 ? '+' : '') + Math.round(v) + '%'); }
  function nn(v) { return String(Math.round(v * 100) / 100); }
  function sessTxt(s) { if (!s) return 'n/a'; return nn(s.top) + ' kg x ' + s.reps.join(',') + (s.avgRir != null ? ' (RIR ' + (Math.round(s.avgRir * 10) / 10) + ')' : ''); }

  Doc.prototype.cmpbars = function (title, rows, o) {
    o = o || {}; var rh = 23, h = 26 + rows.length * rh + 10; this.need(h);
    this.text(MX, this.y - 10, title, 9.5, C.ink, true);
    var lx = PW - MX - 168; this.rect(lx, this.y - 11, 8, 8, C.amber); this.text(lx + 11, this.y - 9, 'this week', 7.6, C.dim);
    this.rect(lx + 66, this.y - 11, 8, 8, GRAY2); this.text(lx + 77, this.y - 9, o.prevLabel || 'last week', 7.6, C.dim);
    var x0 = MX + 62, cw = PW - 2 * MX - 62 - 36, top = this.y - 24, maxV = 1;
    rows.forEach(function (r) { maxV = Math.max(maxV, r.now, r.prev || 0, r.hi || 0); }); maxV *= 1.12;
    rows.forEach(function (r, i) {
      var y = top - (i + 1) * rh + 3;
      if (r.hi) this.rect(x0 + r.lo / maxV * cw, y - 1, (r.hi - r.lo) / maxV * cw, rh - 3, PALE);
      this.text(MX, y + 8, r.label, 8.6, C.ink, true);
      this.rect(x0, y + 9, Math.max(r.now / maxV * cw, r.now > 0 ? 1.5 : 0), 7, r.color || C.amber);
      this.text(x0 + r.now / maxV * cw + 4, y + 9.5, String(r.now), 7.8, C.ink, true);
      if (r.prev != null) { this.rect(x0, y + 1, Math.max(r.prev / maxV * cw, r.prev > 0 ? 1.5 : 0), 6, GRAY2); this.text(x0 + r.prev / maxV * cw + 4, y + 1.5, String(r.prev), 7.2, C.dim); }
    }, this);
    this.y = top - rows.length * rh - 4;
    if (o.note) { this.text(MX, this.y - 8, o.note, 7.6, C.dim); this.y -= 12; }
  };
  Doc.prototype.pill = function (x, y, w, label, note, ok) {
    var c = ok === true ? C.good : ok === false ? C.rust : C.faint;
    this.rect(x, y, w, 36, C.card); this.strokeRect(x, y, w, 36, C.line, 0.6); this.rect(x, y, 4, 36, c);
    this.text(x + 12, y + 22, label, 9.4, C.ink, true); this.text(x + 12, y + 9, note, 7.8, C.dim);
    this.text(x + w - 16, y + 20, ok === true ? 'OK' : ok === false ? '!' : '-', 10, c, true);
  };

  function renderWeekly(rep) {
    var d = new Doc({ title: 'Plate & Progress weekly report', footer: 'Weekly report ' + fmtShort(rep.weekStart) + ' - ' + fmtShort(rep.weekEnd) });
    d.rect(0, PH - 112, PW, 112, C.band); d.rect(0, PH - 114, PW, 2.4, C.amber);
    d.text(MX, PH - 44, 'PLATE & PROGRESS', 9, C.amber, true);
    d.text(MX, PH - 74, 'Your weekly report', 25, C.white, true);
    var sub = fmtShort(rep.weekStart) + ' - ' + fmtLong(rep.weekEnd) + (rep.splitName ? '   |   ' + rep.splitName : '') + '   |   ' + (rep.partial ? 'week in progress (day ' + rep.dayOfWeek + ' of 7)' : 'complete week');
    d.text(MX, PH - 96, sub, 9.2, [0.72, 0.74, 0.77]);
    d.y = PH - 112 - 14;
    if (rep.insufficient) {
      d.h1('Nothing to report yet'); d.para(rep.limits[0], { size: 10.5 }); return d.finish();
    }
    var T = rep.totals, c = T.cur, p = T.prev, dl = T.d, tw = (PW - 2 * MX - 30) / 4, ty = d.y - 64;
    var vs = rep.compare.has ? 'vs ' + rep.compare.label : 'no earlier week';
    var tiles = [
      ['Sessions', c.sessions + ' / ' + c.goal, p ? p.sessions + ' ' + rep.compare.label : vs],
      ['Hard sets', String(c.hardSets), dl ? pctTxt(dl.hard) + ' ' + vs : vs],
      ['Volume', c.volume >= 1000 ? (Math.round(c.volume / 100) / 10) + 'k kg' : c.volume + ' kg', dl ? pctTxt(dl.volume) + ' ' + vs : vs],
      ['Average RIR', c.avgRir == null ? 'n/a' : String(Math.round(c.avgRir * 10) / 10), p && p.avgRir != null ? (Math.round(p.avgRir * 10) / 10) + ' ' + rep.compare.label : 'RIR not logged']
    ];
    tiles.forEach(function (t, i) { d.tile(MX + i * (tw + 10), ty, tw, 58, t[0], t[1], t[2].length > 30 ? t[2].slice(0, 30) : t[2]); });
    d.y = ty - 8;
    d.text(MX, d.y - 8, rep.headline.toUpperCase() + '  -  ' + rep.checksPassed + ' of ' + rep.checksKnown + ' checks passed', 9.2, C.amberDark, true); d.y -= 16;
    var pw4 = (PW - 2 * MX - 30) / 4, py = d.y - 38;
    rep.checks.forEach(function (k, i) { d.pill(MX + i * (pw4 + 10), py, pw4, k.label, k.note.length > 24 ? k.note.slice(0, 24) : k.note, k.ok); });
    d.y = py - 6;

    d.h1('Your 3 priorities for the next week');
    if (rep.priorities.length) rep.priorities.forEach(function (pr, i) {
      d.priority(i + 1, pr);
      d.y += 4; d.para('Why: ' + pr.why + '  [' + pr.level + ']', { size: 8.6, color: C.dim, indent: 8, after: 6 });
    }); else d.para('Nothing urgent. Repeat what you did this week and aim to beat your top sets.', { size: 10.5 });

    if (rep.going.length) { d.h1('What went well'); rep.going.slice(0, 6).forEach(function (g) { d.bullet(g.title + '. ' + g.evidence, { color: C.good }); }); }

    if (rep.days.length) {
      d.h1('Your split: this week vs ' + (rep.compare.has ? 'last logged' : 'nothing yet'));
      var cols = [MX, MX + 130, MX + 205, MX + 300, MX + 395];
      d.need(30 + Math.min(rep.days.length, 3) * 15); d.y -= 14;
      ['Day', 'Status', 'Hard sets', 'Volume (kg)', 'Avg RIR'].forEach(function (h, i) { d.text(cols[i], d.y, h.toUpperCase(), 7.2, C.dim, true); });
      d.gap(4); d.line(MX, d.y, PW - MX, d.y, C.line, 0.6);
      rep.days.forEach(function (r) {
        d.need(18); d.y -= 14;
        var sc = r.status === 'done' ? C.good : r.status === 'missed' ? C.rust : C.dim;
        d.text(cols[0], d.y, r.name, 9.4, C.ink, true);
        d.text(cols[1], d.y, r.status === 'done' ? 'Done' + (r.date ? ' ' + fmtShort(r.date) : '') : r.status === 'missed' ? 'Missed' : 'Still to do', 9, sc, true);
        d.text(cols[2], d.y, r.status === 'done' ? r.hardSets + (r.prevHardSets != null ? '  (was ' + r.prevHardSets + ')' : '') : '-', 9, C.ink);
        d.text(cols[3], d.y, r.status === 'done' ? r.volume.toLocaleString('en-US') + (r.prevVolume != null ? '  (' + r.prevVolume.toLocaleString('en-US') + ')' : '') : '-', 9, C.ink);
        d.text(cols[4], d.y, r.avgRir != null ? String(Math.round(r.avgRir * 10) / 10) + (r.prevAvgRir != null ? '  (' + Math.round(r.prevAvgRir * 10) / 10 + ')' : '') : '-', 9, C.ink);
      });
      d.gap(4);
    }

    d.h1('Muscles: hard sets against the growth range');
    var G = ['chest', 'back', 'shoulders', 'arms', 'legs'], rowsM = [];
    G.forEach(function (g) { var m = rep.muscles[g]; if (!m.sets && !m.prev && !m.planned) return; rowsM.push({ label: { chest: 'Chest', back: 'Back', shoulders: 'Shoulders', arms: 'Arms', legs: 'Legs' }[g], now: m.sets, prev: m.prev, lo: m.target[0], hi: m.target[1], color: m.status === 'ok' ? C.good : m.status === 'high' ? C.rust : C.amber }); });
    if (rowsM.length) d.cmpbars('Hard sets per muscle group', rowsM, { prevLabel: rep.compare.has ? 'last week' : '', note: 'green band = target range (10-20 for chest, back, legs; 8-20 for shoulders, arms)' + (rep.partial ? '. Week still in progress.' : '') });
    if (rep.fine && rep.fine.length) d.para('Finer view (hard sets this week): ' + rep.fine.map(function (m) { return m.muscle + ' ' + m.sets + (m.prev ? ' (was ' + m.prev + ')' : ''); }).join(', ') + '.', { size: 8.8, color: C.dim, after: 4 });
    var b = rep.balance; if (b.push + b.pull >= 6) d.para('Push ' + b.push + ' : pull ' + b.pull + (b.quads + b.post >= 4 ? '   |   quads ' + b.quads + ' : hamstrings/glutes ' + b.post : ''), { size: 9, bold: true, after: 4 });

    if (rep.lifts.length) {
      d.h1('Your lifts: this week vs the previous session');
      rep.lifts.forEach(function (l) {
        var vc = l.verdict === 'up' ? C.good : l.verdict === 'down' ? C.rust : C.dim, vt = l.verdict === 'up' ? 'Progressed' : l.verdict === 'down' ? 'Dropped' : l.verdict === 'same' ? 'Held steady' : 'New lift';
        var tl = wrap('Next: ' + l.target.text, 8.6, PW - 2 * MX - 20, true), h = 46 + tl.length * 11.6;
        d.need(h + 6); var top = d.y;
        d.rect(MX, top - h, PW - 2 * MX, h, C.card); d.strokeRect(MX, top - h, PW - 2 * MX, h, C.line, 0.6); d.rect(MX, top - h, 4, h, vc);
        d.text(MX + 12, top - 15, l.name, 10.6, C.ink, true);
        var st = vt + (l.change != null ? '  ' + pctTxt(l.change) + ' est. 1RM' + (l.effortAdjusted ? ' (reps + RIR)' : '') : '');
        d.text(PW - MX - 10 - width(clean(st), 8.6, true), top - 15, st, 8.6, vc, true);
        d.text(MX + 12, top - 28, (l.prev ? 'Before: ' + sessTxt(l.prev) + '    ->    ' : '') + 'Now: ' + sessTxt(l.now), 8.8, C.dim);
        d.text(MX + 12, top - 40, l.now.sets + (l.now.sets === 1 ? ' set' : ' sets') + ' this session' + (l.prev ? ' (' + l.prev.sets + ' before)' : ''), 7.8, C.faint);
        var cy = top - 52; tl.forEach(function (ln) { d.text(MX + 12, cy, ln, 8.6, C.amberDark, true); cy -= 11.6; });
        d.y = top - h - 6;
      });
    }

    d.h1('Effort and rep ranges');
    var ef = rep.effort;
    if (ef.rated >= 4) d.bars('Reps left in reserve (RIR), sets this week', ef.dist.map(function (v, i) { return { label: i === 5 ? '5+' : String(i), value: v, color: i <= 3 ? C.amber : C.bar }; }), { height: 54, note: 'RIR 0-3 = hard set' });
    else d.para('Too few sets have RIR logged to chart effort (' + ef.rated + ' of ' + ef.total + ').', { size: 9.4, color: C.dim });
    if (rep.reps.total >= 6) d.bars('Reps per hard set', rep.reps.buckets.map(function (v, i) { return { label: rep.reps.labels[i], value: v, color: (i >= 1 && i <= 3) ? C.amber : C.bar }; }), { height: 54, note: '5-20 reps is the efficient zone' });

    if (rep.records.length) { d.h1('Records this week'); rep.records.slice(0, 8).forEach(function (r) { d.bullet(r.name + ': ' + r.label + ' (' + fmtShort(r.date) + ')', { color: C.amber }); }); }

    d.h1('What to do'); if (rep.doList.length) rep.doList.forEach(function (t) { d.bullet(t, { color: C.good }); }); else d.para('No changes needed. Keep going.', { size: 10 });
    d.h1('What not to do'); if (rep.dontList.length) rep.dontList.forEach(function (t) { d.bullet(t, { color: C.rust }); }); else d.para('Nothing specific to avoid.', { size: 10 });

    d.h1('Your plan for next week');
    if (rep.plan.muscles.length) {
      d.h2('Weekly hard sets to aim for', C.amberDark);
      rep.plan.muscles.forEach(function (m) { d.bullet(m.label + ': ' + m.now + ' -> ' + m.target + ' hard sets' + ({ 'build up': '  (build up gradually)', trim: '  (trim, you were above the range)', hold: '  (hold)', 'room to add': '  (room to add, lifts are going up)', 'keep to range': '  (stay in range)' }[m.note] || ''), { size: 9.6, color: C.amber }); });
    }
    if (rep.plan.lifts.length) {
      d.h2('Lift targets (double progression)', C.amberDark);
      rep.plan.lifts.forEach(function (l) { d.bullet(l.name + ': ' + l.text, { size: 9.4, color: C.amber }); });
    }

    d.h1('Everything this report found');
    rep.findings.forEach(function (f) {
      d.need(46); var col2 = f.severity === 'good' ? C.good : f.severity === 'info' ? C.dim : C.rust;
      d.para(SEV[f.severity].toUpperCase() + '   ' + f.title, { size: 9.6, bold: true, color: col2, after: 0 });
      d.para(f.evidence, { size: 9, color: C.dim, indent: 8, after: 0 });
      if (f.why) d.para('Why: ' + f.why, { size: 8.6, color: C.dim, indent: 8, after: 0 });
      if (f.level) d.para('Evidence: ' + f.level, { size: 8.4, bold: true, color: LVLCOL[f.level] || C.dim, indent: 8, after: 3 });
    });

    d.h1('The science behind these suggestions');
    d.para('Every rule above comes from hypertrophy research or standard coaching practice. Each is labelled with how firm the evidence is.', { size: 9.2, color: C.dim, after: 3 });
    rep.science.forEach(function (s) {
      d.need(46);
      d.para(s.topic + '   [' + s.level + ']', { size: 9.4, bold: true, color: LVLCOL[s.level] || C.ink, after: 0 });
      d.para(s.rule, { size: 9, indent: 8, after: 0 }); d.para(s.ref, { size: 8.2, color: C.faint, indent: 8, after: 3 });
    });
    d.h1('How to read this report'); rep.limits.forEach(function (t) { d.bullet(t, { size: 9, color: C.faint }); });
    return d.finish();
  }

  return { render: render, renderWeekly: renderWeekly, _wrap: wrap, _width: width, _clean: clean };
}));
