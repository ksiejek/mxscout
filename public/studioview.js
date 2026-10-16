/* MxScout — a flow as Studio Pro lays it out, with its properties dialogs.
 *
 * The "Studio Pro view" of the Microflows screen (private redesign spec 02
 * §7): the flow from left to right, outputs under each activity, parameters
 * above, decisions as diamonds, the merge drawn, and under the canvas the
 * properties dialog of the step you picked, read-only — every field Studio
 * Pro shows, and "[not read yet]" for each one this model does not hold
 * rather than a field left out.
 *
 * The layout is the spec's algorithm (Karol, 2026-10-13), not the positions
 * stored in the model: activities 104×56, 134px apart, the main path on one
 * row and each way out to the side on a row 122px further down. The spec only
 * draws one decision deep; here every way out — a nested decision's, an error
 * handler's — takes the next free row down, and a loop is a frame around its
 * body on the row it sits on. What it reads is the workflow (docs-data.js)
 * and flowtrace.js's analysis, so the selection, the item usages and the
 * step numbers are the same as the drawing beside it.
 */
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var W = 104, H = 56, GAP = 30, STEP = W + GAP, Y = 150, LANE = 122, DEC = 60, MERGE = 44;

  function h(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'style') Object.keys(attrs.style).forEach(function (p) { node.style[p] = attrs.style[p]; });
      else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }
  function px(n) { return Math.round(n * 100) / 100 + 'px'; }

  // Studio Pro's own activity icons (spec 02, appendix A).
  var ICONS = {
    var: [['rect', { x: 2, y: 3, width: 12, height: 10, rx: 1.5 }], ['path', { d: 'M5 6.5l2 3M7 6.5l-2 3M9 8h3' }]],
    db: [['rect', { x: 2, y: 2, width: 9, height: 11, rx: 1.2 }], ['path', { d: 'M4.5 5h4M4.5 7.5h4M10 10.5l2 2.5 2-2.5M12 13V7' }]],
    obj: [['rect', { x: 2, y: 2, width: 9, height: 11, rx: 1.2 }], ['path', { d: 'M4.5 5h4M4.5 7.5h3M12.5 9v5M10 11.5h5' }]],
    call: [['circle', { cx: 8, cy: 8, r: 6 }], ['path', { d: 'M6.6 5.4l3.6 2.6-3.6 2.6z' }]],
    commit: [['rect', { x: 2, y: 2, width: 9, height: 11, rx: 1.2 }], ['path', { d: 'M10 11.5l1.8 1.8L15 10' }]],
    del: [['rect', { x: 2, y: 2, width: 9, height: 11, rx: 1.2 }], ['path', { d: 'M10.5 10l3.5 3.5M14 10l-3.5 3.5' }]],
    close: [['path', { d: 'M4 4l8 8M12 4l-8 8' }]]
  };
  function icon(name, size, cls) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'sv-icon' + (cls ? ' ' + cls : ''));
    (ICONS[name] || []).forEach(function (s) {
      var node = document.createElementNS(SVG_NS, s[0]);
      Object.keys(s[1]).forEach(function (k) { node.setAttribute(k, String(s[1][k])); });
      svg.appendChild(node);
    });
    return svg;
  }
  function studioIcon(card) {
    var l = window.MxFlowGraph.look(card);
    if (l.icon === 'del') return 'del';
    if (l.icon === 'commit') return 'commit';
    return { db: 'db', obj: 'obj', call: 'call', save: 'commit' }[l.fam] || 'var';
  }

  function shortName(qn) { return String(qn || '').split('.').pop(); }
  // The caption Studio Pro shows on an activity: the one a person typed, or
  // the one Studio Pro generates, by its own rules for the common actions.
  function caption(card) {
    if (card.caption) return card.caption;
    var p = card.props || {}, a = card.action || '';
    var obj = p.object || (String(card.title || '').charAt(0) === '$' ? String(card.title).slice(1) : null);
    if (a === 'RetrieveAction') return p.association ? 'Retrieve ' + shortName(p.association) + ' by association' : 'Retrieve ' + shortName(p.entity || card.title) + ' from database';
    if (a === 'CreateChangeAction') return 'Create ' + shortName(p.entity || card.title);
    if (a === 'ChangeAction' || a === 'ChangeVariableAction') return obj ? "Change '" + obj + "'" : 'Change';
    if (a === 'CreateVariableAction') return 'Create variable';
    if (a === 'CommitAction') return obj ? "Commit '" + obj + "'" : 'Commit';
    if (a === 'DeleteAction') return obj ? "Delete '" + obj + "'" : 'Delete';
    if (/CallAction$/.test(a)) return shortName((card.ref && card.ref.qn) || p.target || card.title);
    return card.title || card.kick || 'Activity';
  }

  // ---------- layout ----------
  function layout(entry, an) {
    var acts = [], decs = [], merges = [], ends = [], segs = [], frames = [], notes = [];
    var maxX = 0, lowest = Y;
    function grow(x, y) { if (x > maxX) maxX = x; if (y > lowest) lowest = y; }
    var lanes = 0;
    function newLane() { lanes++; return Y + lanes * LANE; }
    function seg(x1, y1, x2, y2, arrow, label) { segs.push({ x1: x1, y1: y1, x2: x2, y2: y2, arrow: arrow, label: label || null }); }

    // Lays a list out from (x, y), joined to `from` (the point the line
    // leaves). Returns { x: next free x, from: the point the next line
    // leaves, open: whether the path goes on }.
    function lay(list, x, y, from, label) {
      var open = true;
      function link(toX) {
        if (from) seg(from.x, from.y, toX, y, 'r', label);
        label = null;
      }
      (list || []).forEach(function (b) {
        // Steps nothing leads to are drawn on a row of their own, even after the end.
        if (b.t === 'orphan') {
          var oy = newLane();
          notes.push({ x: 28, y: oy - 44, text: 'not reached from the start' });
          lay(b.body, 28, oy, null, null);
          return;
        }
        if (!open) return;
        if (b.t === 'start') return;
        if (b.t === 'step') {
          link(x);
          var c = b.card || {}, p = c.props || {};
          acts.push({ no: b.no, x: x, y: y, card: c, caption: caption(c), out: p.out || null, outType: p.out ? (an.types[p.out] || null) : null });
          grow(x + W, y + (p.out ? 60 : 28));
          from = { x: x + W, y: y };
          if (b.error && b.error.length) {
            var ly = newLane();
            seg(x + W / 2, y + H / 2, x + W / 2, ly, null, 'error');
            var r = lay(b.error, x + W / 2 + GAP, ly, { x: x + W / 2, y: ly }, null);
            void r;
          }
          x += STEP;
        } else if (b.t === 'split') {
          link(x);
          var cx = x + DEC / 2;
          decs.push({ no: b.no, cx: cx, cy: y, caption: b.title || 'Decision' });
          grow(cx + DEC / 2, y + DEC / 2);
          var mi = window.MxFlowTrace.mainBranch(b);
          var main = b.branches[mi];
          var sides = b.branches.filter(function (z, i) { return i !== mi; });
          var sideEnds = [];
          sides.forEach(function (br) {
            var ly = newLane();
            seg(cx, y + DEC / 2, cx, ly, null, br.label === null || br.label === undefined ? 'otherwise' : String(br.label));
            var r = lay(br.body, cx + DEC / 2, ly, { x: cx, y: ly }, null);
            if (r.open) sideEnds.push({ x: r.fromX, y: ly, from: r.from });
          });
          var after = lay(main ? main.body : [], cx + DEC / 2 + GAP, y, { x: cx + DEC / 2, y: y }, main ? (main.label === null || main.label === undefined ? 'otherwise' : String(main.label)) : null);
          if (b.after) {
            // The ways join: a merge on the main row, past the furthest of them.
            var mx = Math.max(after.x, sideEnds.reduce(function (m, s) { return Math.max(m, s.from ? s.from.x + MERGE : 0); }, 0)) + MERGE / 2;
            merges.push({ cx: mx, cy: y });
            if (after.from) seg(after.from.x, after.from.y, mx - MERGE / 2, y, 'r', after.label);
            sideEnds.forEach(function (s) {
              if (!s.from) return;
              seg(s.from.x, s.from.y, mx, s.from.y, null);
              seg(mx, s.from.y, mx, y + MERGE / 2, 'u');
            });
            grow(mx + MERGE / 2, y);
            from = { x: mx + MERGE / 2, y: y };
            x = mx + MERGE / 2 + GAP;
          } else {
            open = after.open;
            from = after.from;
            x = after.x;
            if (open && after.label) label = after.label;
          }
        } else if (b.t === 'loop') {
          link(x);
          var top = y - H / 2 - 22, x0 = x;
          var lanesBefore = lanes;
          var inner = lay(b.body, x + 16, y, null, null);
          var x1 = Math.max(inner.x - GAP + 16, x + W);
          frames.push({ no: b.no, x: x0, y: top, w: x1 - x0, h: (lanes > lanesBefore ? Y + lanes * LANE - top + 40 : H + 44), label: b.each && b.over ? 'For each ' + b.each + ' in ' + b.over : b.cond ? 'While ' + b.cond : (b.title || 'Loop') });
          grow(x1, top + H + 44);
          from = { x: x1, y: y };
          x = x1 + GAP;
        } else if (b.t === 'end') {
          link(x);
          ends.push({ cx: x + 11, cy: y, label: b.returns || null, error: b.kind === 'errorEvent' });
          grow(x + 22, y + 30);
          from = null; open = false;
          x += 22 + GAP;
        } else if (b.t === 'go') {
          link(x);
          notes.push({ x: x, y: y - 8, text: (b.back ? '↩ step ' : '→ step ') + (b.no || '?') });
          grow(x + 60, y);
          from = null; open = false;
        }
      });
      return { x: x, from: open ? from : null, fromX: from ? from.x : x, open: open, label: label };
    }

    var params = (entry.params || []).map(function (p, i) { return { x: 28 + i * STEP, name: p.name, type: shortName(p.type) }; });
    var startCx = 40;
    lay(entry.workflow || [], 78, Y, { x: startCx + 11, y: Y }, null);
    params.forEach(function (p) { grow(p.x + W, 70); });
    return { acts: acts, decs: decs, merges: merges, ends: ends, segs: segs, frames: frames, notes: notes, params: params, start: { cx: startCx, cy: Y }, w: Math.max(maxX + 35, 300), h: lowest + 30 + 12 };
  }

  // ---------- what the picked step marks ----------
  // Item usages (spec 02 §7.4): what the picked step uses gets its name
  // marked; every activity that uses what it makes gets a "Usage" mark.
  function usages(an, sel) {
    var used = {}, usage = {};
    if (sel) {
      Object.keys(an.du).forEach(function (v) {
        var r = an.du[v][sel];
        if (r && r !== 'defines' && r !== 'parameter') used[v] = true;
        if (r === 'defines') Object.keys(an.du[v]).forEach(function (k) { if (an.du[v][k] !== 'defines' && /^\d+$/.test(k)) usage[k] = true; });
      });
    }
    return { used: used, usage: usage };
  }
  // Every node the pick changes, noted while the drawing is made, so another
  // pick changes those and nothing else (select below): what shows it is the
  // picked one, each output's name, and where a "Usage" mark goes.
  function marker() {
    var m = { on: {}, names: [], usage: [] };
    m.pick = function (no, node, before, after) { if (no) (m.on[no] = m.on[no] || []).push({ node: node, before: before, after: after }); return node; };
    m.name = function (v, node) { m.names.push({ v: v, node: node }); return node; };
    // where the "Usage" mark of step `no` goes: right after its activity
    m.spot = function (no, act, style, node) { if (no) m.usage.push({ no: no, act: act, style: style, node: node || null }); };
    return m;
  }
  function usageMark(style) { return h('span', { class: 'sv-usage', text: 'Usage', style: style }); }

  // ---------- drawing the canvas ----------
  function canvas(L, an, opts, M) {
    var sel = opts.selected;
    var u0 = usages(an, sel), used = u0.used, usage = u0.usage;
    var kids = [];
    L.frames.forEach(function (f) {
      kids.push(h('div', { class: 'sv-frame', style: { left: px(f.x), top: px(f.y), width: px(f.w), height: px(f.h) } }, [h('span', { class: 'sv-frame-label', text: f.label })]));
    });
    L.segs.forEach(function (s) {
      var horiz = s.y1 === s.y2;
      var x = Math.min(s.x1, s.x2), y = Math.min(s.y1, s.y2);
      kids.push(h('span', { class: 'sv-line', style: horiz ? { left: px(x), top: px(s.y1 - 0.75), width: px(Math.abs(s.x2 - s.x1)), height: '1.5px' } : { left: px(s.x1 - 0.75), top: px(y), width: '1.5px', height: px(Math.abs(s.y2 - s.y1)) } }));
      if (s.arrow === 'r') kids.push(h('span', { class: 'sv-arrow r', style: { left: px(s.x2 - 7), top: px(s.y2 - 4.5) } }));
      if (s.arrow === 'u') kids.push(h('span', { class: 'sv-arrow u', style: { left: px(s.x2 - 4.5), top: px(s.y2) } }));
      if (s.label) {
        kids.push(h('span', { class: 'sv-seg-label', text: s.label, style: horiz ? { left: px((s.x1 + s.x2) / 2 - 18), top: px(s.y1 - 20), width: '36px' } : { left: px(s.x1 + 6), top: px((s.y1 + s.y2) / 2 - 8) } }));
      }
    });
    L.params.forEach(function (p) {
      var svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('viewBox', '0 0 26 22'); svg.setAttribute('width', '26'); svg.setAttribute('height', '22'); svg.setAttribute('class', 'sv-param'); svg.setAttribute('aria-hidden', 'true');
      var path = document.createElementNS(SVG_NS, 'path'); path.setAttribute('d', 'M2 2h14l7 9-7 9H2z'); svg.appendChild(path);
      kids.push(h('span', { class: 'sv-param-wrap', style: { left: px(p.x + 39), top: '18px' } }, [svg]));
      kids.push(h('span', { class: 'sv-out', style: { left: px(p.x - 10), top: '44px', width: px(W + 20) } }, [M.name(p.name, h('span', { class: 'sv-out-name' + (used[p.name] ? ' used' : ''), text: p.name })), h('span', { class: 'sv-out-type', text: p.type })]));
    });
    kids.push(h('span', { class: 'sv-start', style: { left: px(L.start.cx - 11), top: px(L.start.cy - 11) }, 'aria-label': 'Start' }));
    L.acts.forEach(function (a) {
      var on = sel === a.no;
      var act = M.pick(a.no, h('button', {
        type: 'button', class: 'sv-act' + (on ? ' on' : '') + (a.card.off ? ' off' : ''), 'aria-label': 'Step ' + a.no + ': ' + a.caption,
        style: { left: px(a.x), top: px(a.y - H / 2), width: px(W), height: px(H) }, onclick: function () { opts.onPick(a.no); }
      }, [icon(studioIcon(a.card), 15), h('span', { class: 'sv-act-cap', text: a.caption })]), 'sv-act', a.card.off ? ' off' : '');
      kids.push(act);
      var ustyle = { left: px(a.x + W / 2 - 25), top: px(a.y - 50) };
      var mk = usage[a.no] ? usageMark(ustyle) : null;
      if (mk) kids.push(mk);
      M.spot(a.no, act, ustyle, mk);
      if (a.out) kids.push(h('span', { class: 'sv-out', style: { left: px(a.x - 10), top: px(a.y + 34), width: px(W + 20) } }, [
        M.name(a.out, h('span', { class: 'sv-out-name' + (used[a.out] ? ' used' : ''), text: a.out })), a.outType ? h('span', { class: 'sv-out-type', text: a.outType }) : null]));
    });
    L.decs.forEach(function (d) {
      var on = sel === d.no;
      var side = Math.round(DEC / 1.414);
      kids.push(M.pick(d.no, h('button', {
        type: 'button', class: 'sv-dec' + (on ? ' on' : ''), 'aria-label': 'Step ' + d.no + ': decision ' + d.caption,
        style: { left: px(d.cx - side / 2), top: px(d.cy - side / 2), width: px(side), height: px(side) }, onclick: function () { opts.onPick(d.no); }
      }), 'sv-dec', ''));
      kids.push(h('span', { class: 'sv-dec-cap', text: d.caption, style: { left: px(d.cx - 32), top: px(d.cy - 8) } }));
    });
    L.merges.forEach(function (m) {
      var side = Math.round(MERGE / 1.414);
      kids.push(h('span', { class: 'sv-merge', 'aria-label': 'Merge', role: 'img', style: { left: px(m.cx - side / 2), top: px(m.cy - side / 2), width: px(side), height: px(side) } }));
    });
    L.ends.forEach(function (e) {
      kids.push(h('span', { class: 'sv-end' + (e.error ? ' error' : ''), 'aria-label': 'End', style: { left: px(e.cx - 11), top: px(e.cy - 11) } }));
      if (e.label) kids.push(h('span', { class: 'sv-end-label', text: e.label, style: { left: px(e.cx - 40), top: px(e.cy + 16) } }));
    });
    L.notes.forEach(function (n) { kids.push(h('span', { class: 'sv-note', text: n.text, style: { left: px(n.x), top: px(n.y) } })); });
    return h('div', { class: 'sv-canvas', style: { width: px(L.w), height: px(L.h) } }, kids);
  }

  // ---------- the drawing Studio Pro keeps (docs-data.js canvasOf) ----------
  // Karol, 2026-10-13: a big flow laid out again by MxScout was unreadable,
  // and "Mendix has them drawn already". So when the model carries where
  // every object stands, that is what is drawn: each at its place and size,
  // each line leaving and entering by the side Studio Pro records, routed at
  // right angles. Only a model without positions falls back to layout().
  var DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  function sidePoint(b, s) {
    return s === 0 ? { x: b.x + b.w / 2, y: b.y } : s === 1 ? { x: b.x + b.w, y: b.y + b.h / 2 }
      : s === 2 ? { x: b.x + b.w / 2, y: b.y + b.h } : { x: b.x, y: b.y + b.h / 2 };
  }
  // Where a line meets an object: the shape drawn, not the box Studio Pro
  // keeps for it. A diamond is as wide as the box is short, a start or an end
  // is a 22px circle in a bigger box; a line to the box's edge stopped short
  // of them (Karol, 2026-10-14).
  function outline(kind, b) {
    var cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    function at(w, hh) { return { x: cx - w / 2, y: cy - hh / 2, w: w, h: hh }; }
    if (kind === 'decision' || kind === 'objectTypeDecision' || kind === 'merge') { var s = Math.min(b.w, b.h); return at(s, s); }
    if (kind === 'start' || kind === 'end' || kind === 'errorEvent') return at(22, 22);
    if (kind === 'break' || kind === 'continue') return at(18, 18);
    if (kind === 'parameter') return at(24, 20);
    return b;
  }
  function route(a, sa, b, sb) {
    sa = sa >= 0 && sa <= 3 ? sa : 1; sb = sb >= 0 && sb <= 3 ? sb : 3;
    var p1 = sidePoint(a, sa), p2 = sidePoint(b, sb), d1 = DIRS[sa], d2 = DIRS[sb];
    var q1 = { x: p1.x + d1[0] * 12, y: p1.y + d1[1] * 12 }, q2 = { x: p2.x + d2[0] * 12, y: p2.y + d2[1] * 12 };
    var h1 = d1[1] === 0, h2 = d2[1] === 0, pts = [p1, q1];
    if (h1 && h2) { var mx = (q1.x + q2.x) / 2; pts.push({ x: mx, y: q1.y }, { x: mx, y: q2.y }); }
    else if (!h1 && !h2) { var my = (q1.y + q2.y) / 2; pts.push({ x: q1.x, y: my }, { x: q2.x, y: my }); }
    else if (h1) pts.push({ x: q2.x, y: q1.y });
    else pts.push({ x: q1.x, y: q2.y });
    pts.push(q2, p2);
    return pts.filter(function (p, i) { return !i || Math.abs(p.x - pts[i - 1].x) > 0.1 || Math.abs(p.y - pts[i - 1].y) > 0.1; });
  }
  var markerSeq = 0;
  function drawn(entry, an, opts, M) {
    var C = entry.canvas, PAD = 40;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    C.n.forEach(function (n) { minX = Math.min(minX, n[1]); minY = Math.min(minY, n[2]); maxX = Math.max(maxX, n[1] + n[3]); maxY = Math.max(maxY, n[2] + n[4]); });
    var ox = PAD - minX, oy = PAD - minY;
    var box = C.n.map(function (n) { return { x: n[1] + ox, y: n[2] + oy, w: n[3], h: n[4] }; });
    var W2 = maxX - minX + PAD * 2, H2 = maxY - minY + PAD * 2 + 40;
    var sel = opts.selected, u0 = usages(an, sel), used = u0.used, usage = u0.usage;
    var kids = [];
    // loops first, so what is in them sits on top
    C.n.forEach(function (n, i) {
      if (n[0] !== 'loop') return;
      var b = box[i], it = n[6] && an.byNo[n[6]] ? an.byNo[n[6]].b : null;
      kids.push(M.pick(n[6], h('div', { class: 'sv-frame' + (sel && sel === n[6] ? ' on' : ''), style: { left: px(b.x), top: px(b.y), width: px(b.w), height: px(b.h) } },
        [h('span', { class: 'sv-frame-label', text: it && it.each && it.over ? 'For each ' + it.each + ' in ' + it.over : (n[7] || 'Loop') })]), 'sv-frame', ''));
    });
    // the lines, in one drawing under the shapes
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'sv-lines'); svg.setAttribute('width', String(W2)); svg.setAttribute('height', String(H2)); svg.setAttribute('aria-hidden', 'true');
    var mid = 'sv-arr-' + (++markerSeq);
    var defs = document.createElementNS(SVG_NS, 'defs'), marker = document.createElementNS(SVG_NS, 'marker');
    [['id', mid], ['viewBox', '0 0 8 8'], ['refX', '8'], ['refY', '4'], ['markerWidth', '8'], ['markerHeight', '8'], ['orient', 'auto-start-reverse'], ['markerUnits', 'userSpaceOnUse']].forEach(function (a) { marker.setAttribute(a[0], a[1]); });
    var tip = document.createElementNS(SVG_NS, 'path'); tip.setAttribute('d', 'M0 0.5L8 4 0 7.5z'); tip.setAttribute('class', 'sv-tip');
    marker.appendChild(tip); defs.appendChild(marker); svg.appendChild(defs);
    C.e.forEach(function (e) {
      var pts = route(outline(C.n[e[0]][0], box[e[0]]), e[2], outline(C.n[e[1]][0], box[e[1]]), e[3]);
      var pl = document.createElementNS(SVG_NS, 'polyline');
      pl.setAttribute('points', pts.map(function (p) { return Math.round(p.x * 10) / 10 + ',' + Math.round(p.y * 10) / 10; }).join(' '));
      pl.setAttribute('class', 'sv-edge' + (e[5] ? ' error' : '') + (e[6] ? ' note' : ''));
      if (!e[6]) pl.setAttribute('marker-end', 'url(#' + mid + ')');
      svg.appendChild(pl);
      if (e[4]) {
        var a = pts[0], d = DIRS[e[2] >= 0 && e[2] <= 3 ? e[2] : 1];
        kids.push(h('span', { class: 'sv-seg-label', text: e[4], style: d[1] === 0
          ? { left: px(a.x + (d[0] > 0 ? 6 : -6 - Math.min(90, e[4].length * 6.5))), top: px(a.y - 18) }
          : { left: px(a.x + 6), top: px(a.y + (d[1] > 0 ? 4 : -20)) } }));
      }
    });
    kids.unshift(svg);
    C.n.forEach(function (n, i) {
      var b = box[i], kind = n[0], no = n[6];
      if (kind === 'start') kids.push(h('span', { class: 'sv-start', 'aria-label': 'Start', style: { left: px(b.x + b.w / 2 - 11), top: px(b.y + b.h / 2 - 11) } }));
      else if (kind === 'end' || kind === 'errorEvent') {
        kids.push(h('span', { class: 'sv-end' + (kind === 'errorEvent' ? ' error' : ''), 'aria-label': kind === 'errorEvent' ? 'Error end' : 'End', style: { left: px(b.x + b.w / 2 - 11), top: px(b.y + b.h / 2 - 11) } }));
        if (n[7]) kids.push(h('span', { class: 'sv-end-label', text: n[7], style: { left: px(b.x + b.w / 2 - 40), top: px(b.y + b.h + 4) } }));
      } else if (kind === 'break' || kind === 'continue') {
        kids.push(h('span', { class: 'sv-end small', 'aria-label': kind, style: { left: px(b.x + b.w / 2 - 9), top: px(b.y + b.h / 2 - 9) } }));
        kids.push(h('span', { class: 'sv-note', text: kind === 'break' ? 'break' : 'continue', style: { left: px(b.x), top: px(b.y + b.h + 2) } }));
      } else if (kind === 'merge') {
        var ms = Math.round(Math.min(b.w, b.h) / 1.414);
        kids.push(h('span', { class: 'sv-merge', role: 'img', 'aria-label': 'Merge', style: { left: px(b.x + b.w / 2 - ms / 2), top: px(b.y + b.h / 2 - ms / 2), width: px(ms), height: px(ms) } }));
      } else if (kind === 'decision' || kind === 'objectTypeDecision') {
        var ds = Math.round(Math.min(b.w, b.h) / 1.414);
        kids.push(M.pick(no, h('button', { type: 'button', class: 'sv-dec' + (sel === no ? ' on' : ''), 'aria-label': 'Step ' + no + ': decision ' + (n[7] || ''),
          style: { left: px(b.x + b.w / 2 - ds / 2), top: px(b.y + b.h / 2 - ds / 2), width: px(ds), height: px(ds) }, onclick: function () { if (no) opts.onPick(no); } }), 'sv-dec', ''));
        // the caption inside the diamond, as Studio Pro writes it
        kids.push(h('span', { class: 'sv-dec-cap in', title: n[7] || 'Decision', text: n[7] || 'Decision', style: { left: px(b.x + b.w / 2 - 60), top: px(b.y + b.h / 2 - 8), width: '120px' } }));
      } else if (kind === 'parameter') {
        var ps = document.createElementNS(SVG_NS, 'svg');
        ps.setAttribute('viewBox', '0 0 26 22'); ps.setAttribute('width', '26'); ps.setAttribute('height', '22'); ps.setAttribute('class', 'sv-param'); ps.setAttribute('aria-hidden', 'true');
        var pp = document.createElementNS(SVG_NS, 'path'); pp.setAttribute('d', 'M2 2h14l7 9-7 9H2z'); ps.appendChild(pp);
        kids.push(h('span', { class: 'sv-param-wrap', style: { left: px(b.x + b.w / 2 - 13), top: px(b.y + b.h / 2 - 11) } }, [ps]));
        var param = (entry.params || []).filter(function (p) { return p.name === n[7]; })[0];
        kids.push(h('span', { class: 'sv-out', style: { left: px(b.x + b.w / 2 - 70), top: px(b.y + b.h + 2), width: '140px' } }, [
          M.name(n[7], h('span', { class: 'sv-out-name' + (used[n[7]] ? ' used' : ''), text: n[7] || '' })), param ? h('span', { class: 'sv-out-type', text: shortName(param.type) }) : null]));
      } else if (kind === 'annotation') {
        kids.push(h('span', { class: 'sv-annot', text: n[7] || '', style: { left: px(b.x), top: px(b.y), width: px(b.w), minHeight: px(b.h) } }));
      } else if (kind !== 'loop') {
        var it = no && an.byNo[no] ? an.byNo[no].b : null, c = (it && it.card) || { title: n[7] }, p = c.props || {};
        var act = M.pick(no, h('button', {
          type: 'button', class: 'sv-act' + (sel === no ? ' on' : '') + (c.off ? ' off' : ''), 'aria-label': 'Step ' + no + ': ' + caption(c),
          style: { left: px(b.x), top: px(b.y), width: px(b.w), height: px(b.h) }, onclick: function () { if (no) opts.onPick(no); }
        }, [icon(studioIcon(c), 15), h('span', { class: 'sv-act-cap', text: caption(c) })]), 'sv-act', c.off ? ' off' : '');
        kids.push(act);
        var ustyle = { left: px(b.x + b.w / 2 - 25), top: px(b.y - 20) };
        var mk = no && usage[no] ? usageMark(ustyle) : null;
        if (mk) kids.push(mk);
        M.spot(no, act, ustyle, mk);
        if (p.out) kids.push(h('span', { class: 'sv-out', style: { left: px(b.x - 10), top: px(b.y + b.h + 3), width: px(b.w + 20) } }, [
          M.name(p.out, h('span', { class: 'sv-out-name' + (used[p.out] ? ' used' : ''), text: p.out })), an.types[p.out] ? h('span', { class: 'sv-out-type', text: an.types[p.out] }) : null]));
      }
    });
    return { w: W2, h: H2, node: h('div', { class: 'sv-canvas drawn', style: { width: px(W2), height: px(H2) } }, kids) };
  }

  // ---------- the properties dialog (spec 02 §7.5) ----------
  var PH = null; // a field this model does not hold
  function field(label, value, mono) {
    var missing = value === PH || value === undefined;
    return [h('span', { class: 'sv-flabel', text: label }), h('span', { class: 'sv-field' + (mono && !missing ? ' mono' : '') + (missing ? ' ph' : ''), text: missing ? '[not read yet]' : String(value) })];
  }
  function form(legend, rows) {
    var g = h('div', { class: 'sv-form' });
    rows.forEach(function (r) { field(r[0], r[1], r[2]).forEach(function (n) { g.appendChild(n); }); });
    return h('fieldset', { class: 'sv-fs' }, [h('legend', { text: legend }), g]);
  }
  function table(legend, head, rows, tall, flagCol) {
    return h('fieldset', { class: 'sv-fs wide' }, [h('legend', { text: legend }), h('div', { class: 'sv-table' + (tall ? ' tall' : '') }, [h('table', null, [
      h('thead', null, [h('tr', null, head.map(function (t) { return h('th', { text: t }); }))]),
      h('tbody', null, rows.length ? rows.map(function (r) {
        return h('tr', null, r.map(function (c, i) { return h('td', { class: 'c' + i + (i === 0 && flagCol && r.flag ? ' flagged' : ''), text: c === PH || c === undefined ? '[not read yet]' : String(c) }); }));
      }) : [h('tr', null, [h('td', { colspan: String(head.length), class: 'c1', text: 'None.' })])])
    ])])]);
  }
  function v(name) { return name ? '$' + name : PH; }

  function properties(b, an, opts) {
    if (!b) return { title: 'Nothing picked', groups: [] };
    if (b.t === 'split') {
      var after = null;
      var it = an.byNo[b.no], i0 = an.items.indexOf(it);
      for (var i = i0 + 1; i < an.items.length; i++) { if (an.items[i].path.length <= it.path.length && an.items[i].b.no) { after = an.items[i].b; break; } }
      function goesTo(br) {
        var first = null;
        for (var j = 0; j < br.body.length; j++) { if (br.body[j].no || br.body[j].t === 'end') { first = br.body[j]; break; } }
        if (first && first.t === 'end') return ['End' + (first.returns ? ' · ' + first.returns : ''), '—'];
        if (first) return [first.card ? caption(first.card) : first.t === 'loop' ? 'Loop' + (first.over ? ' over ' + first.over : '') : first.title || 'Decision', String(first.no)];
        if (after) return ['Merge, then ' + (after.card ? caption(after.card) : after.t === 'loop' ? 'Loop' : after.title || 'the next step'), String(after.no)];
        return ['Merge', '—'];
      }
      var isRule = /^rule /.test(String(b.cond || ''));
      return { title: 'Decision', groups: [
        form('Decision', [['Caption', b.title || PH], ['Decision type', b.kind === 'objectTypeDecision' ? 'Object type' : isRule ? 'Rule' : 'Expression'], [isRule ? 'Rule' : 'Expression', b.cond || PH, true]]),
        table('Outgoing flows', ['Value', 'Goes to', 'Step'], b.branches.map(function (br) { var g = goesTo(br); return [br.label === null || br.label === undefined ? '(other)' : br.label, g[0], g[1]]; }), false)
      ] };
    }
    if (b.t !== 'step') return { title: 'Loop', groups: [form('Loop', [['Iterate over', b.over || PH, true], ['Loop object', b.each || PH, true]])] };
    var c = b.card || {}, p = c.props || {}, a = c.action || '';
    var hasProps = !!c.props;
    function get(k) { return p[k] !== undefined ? p[k] : (hasProps ? PH : PH); }
    function memberTable() {
      var entity = p.entity || (p.object && an.types[p.object]) || null;
      var m = window.MxFlowTrace.members(c.fields || [], entity, an, opts.ctx);
      // A long if-chain laid out a branch a line, as the step's own panel used to (flowview.js layoutExpr).
      var lay = window.MxFlowView && window.MxFlowView.layoutExpr ? window.MxFlowView.layoutExpr : function (x) { return x; };
      return table('Members', ['Member', 'Type', 'Value'], m.rows.map(function (r) { var row = [r.name, r.type || PH, r.value ? lay(r.value) : r.value]; row.flag = r.flag; return row; }), true, true);
    }
    if (a === 'CreateVariableAction') return { title: 'Create Variable', groups: [form('Input', [['Data type', get('dataType')], ['Value', p.value !== undefined ? p.value : (c.detail || PH), true]]), form('Output', [['Variable name', get('out'), true]])] };
    if (a === 'RetrieveAction') return { title: 'Retrieve Objects', groups: [
      form('Input', p.association ? [['Source', 'By association'], ['Association', p.association, true], ['From', v(p.from), true]] :
        [['Source', get('source')], ['Entity', p.entity || PH, true], ['XPath constraint', p.xpath !== undefined ? (p.xpath || '(none)') : PH, true], ['Range', get('range')], ['Sorting', get('sorting')]]),
      form('Output', [['Name', get('out'), true]])] };
    if (/CallAction$/.test(a)) {
      var target = p.target || (c.ref && c.ref.qn) || null;
      var callee = target && opts.model ? (opts.model.microflows || []).concat(opts.model.nanoflows || []).filter(function (f) { return f.qualifiedName === target; })[0] : null;
      var ptype = {};
      ((callee && callee.parameters) || []).forEach(function (q) { ptype[q.name] = q.entityQualifiedName || q.type; });
      var title = a === 'NanoflowCallAction' ? 'Call Nanoflow' : a === 'MicroflowCallAction' ? 'Call Microflow' : 'Call Java Action';
      return { title: title, groups: [
        form('Action', [[a === 'NanoflowCallAction' ? 'Nanoflow' : a === 'MicroflowCallAction' ? 'Microflow' : 'Java action', target || PH, true]]),
        table('Parameters', ['Parameter', 'Type', 'Argument'], (c.fields || []).map(function (f) { return [f.name, ptype[f.name] || PH, f.value || 'empty']; }), false),
        form('Output', [['Use return value', get('useReturn')], ['Variable name', get('out'), true], ['Type', p.out ? (an.types[p.out] || PH) : PH]])
      ] };
    }
    if (a === 'ChangeVariableAction') return { title: 'Change Variable', groups: [form('Input', [['Variable', v(p.object), true], ['Value', p.value !== undefined ? p.value : (c.detail || PH), true]])] };
    if (a === 'CreateChangeAction') return { title: 'Create Object', groups: [form('Action', [['Entity', p.entity || PH, true], ['Commit', get('commit')], ['Refresh in client', get('refresh')]]), memberTable(), form('Output', [['Object name', get('out'), true]])] };
    if (a === 'ChangeAction') return { title: 'Change Object', groups: [form('Action', [['Object', v(p.object), true], ['Commit', get('commit')], ['Refresh in client', get('refresh')]]), memberTable()] };
    if (a === 'DeleteAction') return { title: 'Delete Object(s)', groups: [form('Input', [['Object or list', v(p.object), true], ['Refresh in client', get('refresh')]])] };
    if (a === 'CommitAction') return { title: 'Commit Object(s)', groups: [form('Input', [['Object or list', v(p.object), true], ['With events', get('withEvents')], ['Refresh in client', get('refresh')]])] };
    return { title: c.kick || 'Activity', groups: [form('Action', (c.rows || []).filter(function (r) { return r[0] !== 'State' && r[0] !== 'On error'; }).map(function (r) { return [r[0], r[1], true]; }))] };
  }

  // ---------- the dialog ----------
  // How far the drawing is zoomed, kept while the same flow stays open.
  var zoom = { qn: null, z: 1 };
  // The drawing with its zoom: the canvas Studio Pro keeps (or, for a model
  // without positions, the left-to-right layout), the zoom bar for under it.
  // The Microflows screen shows this and nothing else in the middle (Karol,
  // 2026-10-14: "only this drawing"); the dialog below wraps it too.
  function board(entry, an, opts) {
    if (zoom.qn !== opts.qn) zoom = { qn: opts.qn, z: 1 };
    // A click goes to whatever the board was last handed (select below).
    var B = null, M = marker();
    var at = Object.assign({}, opts, { onPick: function (no) { B.onPick(no); } });
    var D = entry.canvas && entry.canvas.n && entry.canvas.n.length ? drawn(entry, an, at, M) : null;
    var L = D ? null : layout(entry, an);
    var stage = D ? D.node : canvas(L, an, at, M);
    var sized = h('div', { class: 'sv-zoomed' }, [stage]);
    var zl = h('span', { class: 'sv-mono', text: '100%' });
    function applyZoom() {
      if (!D) return;
      stage.style.transformOrigin = '0 0';
      stage.style.transform = 'scale(' + zoom.z + ')';
      sized.style.width = px(D.w * zoom.z); sized.style.height = px(D.h * zoom.z);
      zl.textContent = Math.round(zoom.z * 100) + '%';
    }
    function setZoom(z) { zoom.z = Math.max(0.2, Math.min(2, Math.round(z * 100) / 100)); applyZoom(); }
    var strip = h('div', { class: 'sv-strip' + (D ? ' drawn' : '') + (opts.inline ? ' inline' : '') }, [sized]);
    if (D) {
      // Ctrl (or Cmd) and the wheel zoom around the pointer, as in Studio Pro.
      strip.addEventListener('wheel', function (ev) {
        if (!ev.ctrlKey && !ev.metaKey) return;
        ev.preventDefault();
        var r = strip.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
        var ax = (strip.scrollLeft + mx) / zoom.z, ay = (strip.scrollTop + my) / zoom.z;
        setZoom(zoom.z * Math.exp(-ev.deltaY * 0.0025));
        strip.scrollLeft = ax * zoom.z - mx; strip.scrollTop = ay * zoom.z - my;
      }, { passive: false });
      applyZoom();
    }
    var zoomBar = D ? h('div', { class: 'sv-zoom' }, [
      h('button', { type: 'button', 'aria-label': 'Zoom out', text: '−', onclick: function () { setZoom(zoom.z - 0.1); } }), zl,
      h('button', { type: 'button', 'aria-label': 'Zoom in', text: '+', onclick: function () { setZoom(zoom.z + 0.1); } }),
      h('button', { type: 'button', class: 'fit', text: 'Fit', onclick: function () { var r = strip.getBoundingClientRect(); setZoom(Math.min(1, (r.width - 20) / D.w, Math.max(0.2, (r.height - 20) / D.h))); } })
    ]) : h('span', { class: 'sv-mono', text: '100%' });
    B = { strip: strip, zoomBar: zoomBar, drawn: !!D,
      note: D ? 'Drawn as it is in Studio Pro: every object where the model keeps it. Click an activity to see its properties; Ctrl and the wheel zoom.'
        : 'Laid out as in Studio Pro: left to right, outputs under each activity, parameters above. Click an activity to see its properties.',
      onPick: opts.onPick, marks: M, an: an, qn: opts.qn, selected: opts.selected || null };
    return B;
  }
  // A board already drawn, with another step picked (or none): the nodes that
  // say which step is picked, what it uses and what uses its output change,
  // and nothing else is drawn again. False when it is not the same flow's
  // board, or the zoom has since moved to another flow's: draw it again.
  function select(B, sel, onPick) {
    if (!B || !B.marks || zoom.qn !== B.qn) return false;
    if (onPick) B.onPick = onPick;
    sel = sel || null;
    if (B.selected === sel) return true;
    var M = B.marks, u0 = usages(B.an, sel);
    [B.selected, sel].forEach(function (n) {
      (M.on[n] || []).forEach(function (x) { x.node.setAttribute('class', x.before + (n === sel ? ' on' : '') + x.after); });
    });
    M.names.forEach(function (x) { x.node.setAttribute('class', 'sv-out-name' + (u0.used[x.v] ? ' used' : '')); });
    M.usage.forEach(function (x) {
      var want = !!u0.usage[x.no];
      if (want && !x.node) { x.node = usageMark(x.style); x.act.parentNode.insertBefore(x.node, x.act.nextSibling); }
      else if (!want && x.node) { x.node.parentNode.removeChild(x.node); x.node = null; }
    });
    B.selected = sel;
    return true;
  }
  function render(entry, an, opts) {
    var B = board(entry, an, opts), strip = B.strip, zoomBar = B.zoomBar, D = B.drawn;
    var it = opts.selected ? an.byNo[opts.selected] : null;
    var P = properties(it ? it.b : null, an, opts);
    var close = h('button', { type: 'button', class: 'sv-close', 'aria-label': 'Close Studio Pro view', onclick: opts.onClose }, [icon('close', 15)]);
    var dialog = h('div', { class: 'sv-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Studio Pro view of ' + opts.name }, [
      h('div', { class: 'sv-head' }, [
        h('div', { class: 'sv-titles' }, [h('span', { class: 'xe-caps', text: 'Studio Pro view' }), h('span', { class: 'sv-qn', text: opts.qn })]),
        h('div', { class: 'sv-legend' }, [
          h('span', { class: 'sv-chip-name', text: 'Name' }), h('span', { text: 'used by the selected activity' }),
          h('span', { class: 'sv-usage static', text: 'Usage' }), h('span', { text: 'uses its output' })
        ]),
        close
      ]),
      // One scroll for the whole dialog (Karol, 2026-10-13: "one scroll, not
      // two"): the canvas at its full height, then the step's details.
      h('div', { class: 'sv-body' }, [
      strip,
      // Under the canvas: what the step does, as the inspector beside the
      // graph says it (opts.inspector, from flowview.js), and the properties
      // dialog Studio Pro would show; a button to what the step works on.
      h('div', { class: 'sv-props' + (opts.inspector ? ' with-insp' : '') }, [
        opts.inspector ? h('div', { class: 'sv-insp' }, [opts.inspector]) : null,
        h('div', { class: 'sv-props-main' }, [
          h('div', { class: 'sv-props-head' }, [
            h('h3', { text: P.title }),
            it ? h('span', { class: 'sv-props-sub' }, ['step ', h('span', { class: 'sv-mono', text: String(it.b.no) }), ' · the properties dialog, read-only']) : null,
            opts.go ? h('button', { type: 'button', class: 'sv-go', title: opts.go.title, onclick: opts.go.run }, [opts.go.label, h('span', { 'aria-hidden': 'true', text: ' →' })]) : null
          ]),
          h('div', { class: 'sv-groups' }, P.groups)
        ])
      ])
      ]),
      h('div', { class: 'sv-foot' }, [h('span', { text: D
        ? 'Drawn as it is in Studio Pro: every object where the model keeps it. Click an activity to see its properties; Ctrl and the wheel zoom.'
        : 'Laid out as in Studio Pro: left to right, outputs under each activity, parameters above. Click an activity to see its properties.' }), zoomBar])
    ]);
    var overlay = h('div', { class: 'sv-overlay', onclick: function (e) { if (e.target === overlay) opts.onClose(); } }, [dialog]);
    // The dialog takes the focus while it is open; Esc closes it (microflows.js).
    setTimeout(function () { if (overlay.isConnected && !overlay.contains(document.activeElement)) close.focus(); }, 0);
    return overlay;
  }

  window.MxStudioView = { render: render, board: board, select: select, properties: properties, layout: layout, caption: caption };
})();
