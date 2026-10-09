/* MxScout — drawing a microflow or nanoflow.
 *
 * Studio Pro keeps the picture in the project file — where every activity
 * sits, how big it is, which side each arrow leaves and enters by and how it
 * curves — and mpr.js already reads all of it into `flow.graph`. So nothing
 * here lays a flow out: it draws what the developer drew, at the place they
 * put it, so the picture in MxScout is the picture they know from Studio Pro.
 * That is also why there is no layout library behind it (a layered layout
 * would rearrange every flow into something its own author has never seen).
 *
 * What it adds is the reading: a box holds as much of its text as fits,
 * wrapped, and hovering it shows ALL of it — the action, the variable, the
 * expression, the documentation — in a card. A box that calls another flow
 * or opens a page is a link to it.
 *
 * Built with createElementNS and textContent only, like everything else in
 * MxScout: nothing from a model can become markup. It reads `flow.graph` and
 * nothing else, has no state outside the element it returns, and writes no
 * storage.
 */
(function () {
  'use strict';

  var app = null; // { el }
  var NS = 'http://www.w3.org/2000/svg';

  // Studio Pro's units are small (an activity is 120 × 60); drawn at 1:1 the
  // text in a box would be unreadable. Everything — positions, sizes, curves —
  // is scaled by the same factor, so the shape of the flow does not change.
  var SCALE = 1.5;
  var PAD = 40;

  // One pair of window listeners for the life of the page; a drawing that is
  // being dragged registers itself here. app.js redraws the page often, and a
  // pair per drawing would pile up with every redraw.
  var activeDrag = null;
  function init(api) {
    app = api;
    window.addEventListener('pointermove', function (e) { if (activeDrag) activeDrag.move(e); });
    window.addEventListener('pointerup', function () { if (activeDrag) { activeDrag.up(); activeDrag = null; } });
  }

  function s(tag, attrs, kids) {
    var node = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'text') node.textContent = v;
      else node.setAttribute(k, String(v));
    });
    (kids || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  // ---------- what an activity is, by its action ----------
  // One colour per family, so a long flow can be read for its shape at a
  // glance: where it reads, where it writes, where it leaves for somewhere else.
  var FAMILY = {
    RetrieveAction: 'data', AggregateListAction: 'data', ListOperationAction: 'variable',
    CreateObjectAction: 'object', ChangeObjectAction: 'object', CommitAction: 'object',
    DeleteAction: 'object', RollbackAction: 'object', CastAction: 'object',
    MicroflowCallAction: 'call', NanoflowCallAction: 'call', JavaActionCallAction: 'call',
    JavaScriptActionCallAction: 'call',
    ShowFormAction: 'client', ShowPageAction: 'client', CloseFormAction: 'client', ShowMessageAction: 'client',
    ValidationFeedbackAction: 'client', DownloadFileAction: 'client', ShowHomePageAction: 'client',
    RestCallAction: 'integration', WebServiceCallAction: 'integration', ImportXmlAction: 'integration',
    ExportXmlAction: 'integration', CallExternalAction: 'integration', RestOperationCallAction: 'integration',
    CreateVariableAction: 'variable', ChangeVariableAction: 'variable', CreateListAction: 'variable',
    ChangeListAction: 'variable', LogMessageAction: 'log'
  };
  var FAMILY_LABEL = {
    data: 'reads data', object: 'creates, changes or deletes objects', call: 'calls another flow or action',
    client: 'talks to the user', integration: 'calls outside the app', variable: 'variables and lists',
    log: 'writes to the log', other: 'other'
  };
  function familyOf(node) {
    if (node.kind !== 'activity') return null;
    return FAMILY[node.action] || 'other';
  }

  // ---------- text that fits a box ----------
  var measureCtx = null;
  function measure(text, font) {
    if (!measureCtx) {
      try { measureCtx = document.createElement('canvas').getContext('2d'); } catch (e) { measureCtx = null; }
    }
    if (!measureCtx) return String(text).length * 6.5;
    measureCtx.font = font;
    return measureCtx.measureText(String(text)).width;
  }

  // Words onto lines no wider than `width`; a word longer than a line is
  // broken where it has to be (a qualified name has no spaces to break on).
  function wrap(text, font, width) {
    var lines = [], cur = '';
    String(text).split(/\s+/).filter(Boolean).forEach(function (word) {
      var tryLine = cur ? cur + ' ' + word : word;
      if (measure(tryLine, font) <= width) { cur = tryLine; return; }
      if (cur) lines.push(cur);
      cur = '';
      while (measure(word, font) > width && word.length > 1) {
        var cut = word.length - 1;
        while (cut > 1 && measure(word.slice(0, cut), font) > width) cut--;
        lines.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      cur = word;
    });
    if (cur) lines.push(cur);
    return lines;
  }

  function ellipsize(line, font, width) {
    var t = line;
    while (t.length > 1 && measure(t + '…', font) > width) t = t.slice(0, -1);
    return t + '…';
  }

  var FONT = {
    kicker: '600 10px system-ui, -apple-system, Segoe UI, sans-serif',
    title: '600 12px system-ui, -apple-system, Segoe UI, sans-serif',
    meta: '11px system-ui, -apple-system, Segoe UI, sans-serif',
    note: '11px system-ui, -apple-system, Segoe UI, sans-serif'
  };
  var LINE_H = { kicker: 13, title: 15, meta: 14, note: 14 };

  // Lays out [{ text, style }] blocks inside `width` × `height`, top-down,
  // and says whether anything had to be left out (the card shows it all).
  function layoutText(blocks, width, height) {
    var out = [], used = 0, truncated = false;
    blocks.forEach(function (b) {
      if (!b.text || truncated) { if (b.text) truncated = true; return; }
      var lines = wrap(b.text, FONT[b.style], width);
      for (var i = 0; i < lines.length; i++) {
        if (used + LINE_H[b.style] > height) {
          if (out.length) {
            var last = out[out.length - 1];
            last.text = ellipsize(last.text, FONT[last.style], width);
          }
          truncated = true;
          return;
        }
        out.push({ text: lines[i], style: b.style, y: used });
        used += LINE_H[b.style];
      }
    });
    return { lines: out, height: used, truncated: truncated };
  }

  function textNode(laid, x, yTop, anchor, cls) {
    var g = s('g', { class: cls || null });
    laid.lines.forEach(function (ln) {
      g.appendChild(s('text', {
        class: 'fd-t fd-t-' + ln.style, x: x, y: yTop + ln.y + LINE_H[ln.style] - 4,
        'text-anchor': anchor || 'start', text: ln.text
      }));
    });
    return g;
  }

  // ---------- geometry ----------
  // A node inside a loop is placed relative to the loop. Studio Pro measures
  // that from the loop's top-left corner; if a file ever says otherwise (every
  // child already inside the loop's own box), the absolute reading is kept.
  function absoluteBoxes(nodes) {
    var byId = {}, boxes = {};
    nodes.forEach(function (n) { byId[n.id] = n; });
    function box(n) {
      if (boxes[n.id]) return boxes[n.id];
      var w = n.size ? n.size.width : 120, h = n.size ? n.size.height : 60;
      var cx = n.at ? n.at.x : 0, cy = n.at ? n.at.y : 0;
      var parent = n.parentId && byId[n.parentId];
      if (parent) {
        var pb = box(parent);
        var rel = { x: pb.x + cx * 1, y: pb.y + cy * 1 };
        var insideAsAbsolute = cx >= pb.x && cx <= pb.x + pb.w && cy >= pb.y && cy <= pb.y + pb.h;
        var insideAsRelative = cx >= 0 && cx <= pb.w && cy >= 0 && cy <= pb.h;
        if (!(insideAsAbsolute && !insideAsRelative)) { cx = rel.x; cy = rel.y; }
      }
      boxes[n.id] = { x: cx - w / 2, y: cy - h / 2, w: w, h: h, cx: cx, cy: cy };
      return boxes[n.id];
    }
    nodes.forEach(box);
    // To drawing units.
    Object.keys(boxes).forEach(function (id) {
      var b = boxes[id];
      boxes[id] = { x: b.x * SCALE, y: b.y * SCALE, w: b.w * SCALE, h: b.h * SCALE, cx: b.cx * SCALE, cy: b.cy * SCALE };
    });
    return boxes;
  }

  // Mendix numbers the sides of a box 0 top, 1 right, 2 bottom, 3 left.
  var SIDE_DIR = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
  function sidePoint(b, side) {
    if (side === 0) return { x: b.cx, y: b.y };
    if (side === 1) return { x: b.x + b.w, y: b.cy };
    if (side === 2) return { x: b.cx, y: b.y + b.h };
    return { x: b.x, y: b.cy };
  }
  // No side in the file: the one facing the other box.
  function facingSide(from, to) {
    var dx = to.cx - from.cx, dy = to.cy - from.cy;
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 1 : 3;
    return dy >= 0 ? 2 : 0;
  }

  function edgeGeometry(edge, a, b) {
    var fs = typeof edge.fromSide === 'number' && edge.fromSide >= 0 && edge.fromSide <= 3 ? edge.fromSide : facingSide(a, b);
    var ts = typeof edge.toSide === 'number' && edge.toSide >= 0 && edge.toSide <= 3 ? edge.toSide : facingSide(b, a);
    var p0 = sidePoint(a, fs), p3 = sidePoint(b, ts);
    var dist = Math.sqrt(Math.pow(p3.x - p0.x, 2) + Math.pow(p3.y - p0.y, 2));
    var reach = Math.max(24, Math.min(90, dist / 3));
    var c1 = edge.fromVector ? { x: p0.x + edge.fromVector.x * SCALE, y: p0.y + edge.fromVector.y * SCALE }
      : { x: p0.x + SIDE_DIR[fs].x * reach, y: p0.y + SIDE_DIR[fs].y * reach };
    var c2 = edge.toVector ? { x: p3.x + edge.toVector.x * SCALE, y: p3.y + edge.toVector.y * SCALE }
      : { x: p3.x + SIDE_DIR[ts].x * reach, y: p3.y + SIDE_DIR[ts].y * reach };
    // The point halfway along the curve, for the branch label.
    var t = 0.5, mt = 1 - t;
    var mid = {
      x: mt * mt * mt * p0.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * p3.x,
      y: mt * mt * mt * p0.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * p3.y
    };
    return {
      d: 'M' + p0.x + ',' + p0.y + ' C' + c1.x + ',' + c1.y + ' ' + c2.x + ',' + c2.y + ' ' + p3.x + ',' + p3.y,
      mid: mid
    };
  }

  function shortName(qn) { return String(qn || '').split('.').pop(); }

  function branchLabel(edge) {
    if (edge.caseValue === null || edge.caseValue === undefined) return null;
    if (edge.caseKind === 'inheritance') return shortName(edge.caseValue);
    return String(edge.caseValue);
  }

  // ---------- one node ----------
  function drawNode(n, b, ctx) {
    var fam = familyOf(n);
    var openable = n.ref && ctx.canOpen && ctx.canOpen(n.ref);
    var cls = 'fd-node fd-' + n.kind + (fam ? ' fd-fam-' + fam : '') + (n.disabled ? ' is-disabled' : '') + (openable ? ' is-link' : '');
    var g = s('g', { class: cls, 'data-id': n.id, tabindex: openable ? '0' : null, role: openable ? 'link' : null });
    var truncated = false;

    if (n.kind === 'start' || n.kind === 'end' || n.kind === 'errorEvent' || n.kind === 'break' || n.kind === 'continue') {
      var r = Math.min(b.w, b.h) / 2;
      g.appendChild(s('circle', { cx: b.cx, cy: b.cy, r: r, class: 'fd-event' }));
      var glyph = { errorEvent: '!', break: '■', continue: '↻' }[n.kind];
      if (glyph) g.appendChild(s('text', { x: b.cx, y: b.cy + 4, 'text-anchor': 'middle', class: 'fd-glyph', text: glyph }));
      var below = n.kind === 'end' && n.returnValue ? 'returns ' + n.returnValue.replace(/\s+/g, ' ') : null;
      if (below) {
        var laidB = layoutText([{ text: below, style: 'meta' }], 170, LINE_H.meta * 2);
        truncated = laidB.truncated;
        g.appendChild(textNode(laidB, b.cx, b.y + b.h + 4, 'middle', 'fd-below'));
      }
    } else if (n.kind === 'decision' || n.kind === 'objectTypeDecision' || n.kind === 'merge') {
      var pts = [[b.cx, b.y], [b.x + b.w, b.cy], [b.cx, b.y + b.h], [b.x, b.cy]].map(function (p) { return p.join(','); }).join(' ');
      g.appendChild(s('polygon', { points: pts, class: 'fd-diamond' }));
      if (n.kind !== 'merge') {
        // Inside a diamond only its middle is usable; whatever does not fit
        // goes underneath, where Studio Pro would let it run on too.
        var text = n.title || n.meta || '';
        var laidD = layoutText([{ text: text, style: 'title' }], Math.max(40, b.w * 0.62), Math.max(LINE_H.title, b.h * 0.5));
        if (laidD.truncated) {
          laidD = layoutText([{ text: text, style: 'title' }], 190, LINE_H.title * 3);
          truncated = laidD.truncated;
          g.appendChild(textNode(laidD, b.cx, b.y + b.h + 4, 'middle', 'fd-below'));
        } else {
          g.appendChild(textNode(laidD, b.cx, b.cy - laidD.height / 2, 'middle'));
        }
      }
    } else if (n.kind === 'loop') {
      g.appendChild(s('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 10, class: 'fd-loopbox' }));
      var head = '↻ ' + [n.title, n.meta ? 'in ' + n.meta : null].filter(Boolean).join(' ');
      var laidL = layoutText([{ text: head, style: 'kicker' }], b.w - 16, LINE_H.kicker);
      truncated = laidL.truncated;
      g.appendChild(textNode(laidL, b.x + 8, b.y + 6, 'start'));
    } else if (n.kind === 'annotation') {
      g.appendChild(s('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 4, class: 'fd-note' }));
      var laidN = layoutText([{ text: n.title || '', style: 'note' }], b.w - 14, b.h - 10);
      truncated = laidN.truncated;
      g.appendChild(textNode(laidN, b.x + 7, b.y + 5, 'start'));
    } else if (n.kind === 'parameter') {
      // Studio Pro draws a parameter as a yellow shape that narrows to a point,
      // not as a box: square on top, a triangle pointing into the flow below.
      g.appendChild(s('path', { d: 'M' + b.x + ',' + b.y + ' H' + (b.x + b.w) + ' V' + (b.y + b.h * 0.55) + ' L' + b.cx + ',' + (b.y + b.h) + ' L' + b.x + ',' + (b.y + b.h * 0.55) + ' Z', class: 'fd-param', 'stroke-linejoin': 'round' }));
      var laidP = layoutText([{ text: n.title || 'Parameter', style: 'meta' }], Math.max(60, b.w + 120), LINE_H.meta);
      truncated = laidP.truncated;
      g.appendChild(textNode(laidP, b.cx, b.y + b.h + 2, 'middle', 'fd-below'));
    } else {
      // An activity, or a shape this version of MxScout has no name for —
      // drawn as a box all the same, because leaving it out would cut a hole
      // in somebody's diagram.
      g.appendChild(s('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 8, class: 'fd-box' }));
      g.appendChild(s('rect', { x: b.x, y: b.y + 6, width: 4, height: Math.max(0, b.h - 12), rx: 2, class: 'fd-stripe' }));
      var laidA = layoutText([
        { text: n.kicker || (n.kind === 'activity' ? 'Activity' : n.kind), style: 'kicker' },
        { text: n.title, style: 'title' },
        { text: n.meta, style: 'meta' }
      ], b.w - 20, b.h - 10);
      truncated = laidA.truncated;
      g.appendChild(textNode(laidA, b.x + 12, b.y + 5, 'start'));
    }
    if (truncated) g.setAttribute('data-more', '1');
    return g;
  }

  // ---------- the card shown on hover ----------
  var KIND_NAME = {
    start: 'Start', end: 'End', errorEvent: 'Error end', break: 'Break', continue: 'Continue',
    decision: 'Decision', objectTypeDecision: 'Object type decision', merge: 'Merge', loop: 'Loop',
    annotation: 'Annotation', parameter: 'Parameter', activity: 'Activity'
  };
  function cardFor(n, ctx) {
    var el = app.el;
    var rows = [];
    function row(k, v, mono) {
      if (v === null || v === undefined || v === '') return;
      rows.push(el('div', { class: 'fd-card-row' }, [
        el('span', { class: 'fd-card-k', text: k }),
        el('span', { class: 'fd-card-v' + (mono ? ' fd-mono' : ''), text: String(v) })
      ]));
    }
    var fam = familyOf(n);
    if (n.kind === 'activity') row('Action', n.action ? n.action.replace(/Action$/, '').replace(/([a-z])([A-Z])/g, '$1 $2') : null);
    if (n.kind === 'decision' || n.kind === 'objectTypeDecision') {
      row('Condition', n.expression, true);
      row('Rule', n.rule, true);
      row('Splits on', n.variable ? '$' + n.variable : null, true);
    } else if (n.kind === 'loop') {
      row('Iterates', n.title, true);
      row('Over', n.meta, true);
    } else if (n.kind !== 'annotation') {
      row(n.kind === 'activity' ? 'Detail' : 'Value', n.meta, true);
    }
    row('Refers to', n.ref, true);
    row('Returns', n.returnValue, true);
    row('Kind', fam ? FAMILY_LABEL[fam] : null);
    var errOut = (ctx.errorFrom || {})[n.id];
    if (errOut) row('On error', 'continues on its own error path');
    var kids = [
      el('div', { class: 'fd-card-kicker', text: n.kicker || KIND_NAME[n.kind] || n.kind }),
      n.title ? el('div', { class: 'fd-card-title', text: n.kind === 'annotation' ? n.title : n.title }) : null,
      n.disabled ? el('div', { class: 'fd-card-flag', text: 'Disabled — Studio Pro skips this step' }) : null
    ];
    if (rows.length) kids.push(el('div', { class: 'fd-card-rows' }, rows));
    if (n.documentation) kids.push(el('div', { class: 'fd-card-doc', text: n.documentation }));
    if (n.ref && ctx.canOpen && ctx.canOpen(n.ref)) kids.push(el('div', { class: 'fd-card-hint', text: 'Click to open ' + shortName(n.ref) }));
    return el('div', { class: 'fd-card-in' }, kids.filter(Boolean));
  }

  // ---------- the whole drawing ----------
  // opts: { canOpen(qualifiedName) → bool, open(qualifiedName), highlight: [nodeId] , height }
  function render(flow, opts) {
    opts = opts || {};
    var el = app.el;
    var graph = flow && flow.graph;
    if (!graph || !graph.nodes || !graph.nodes.length) {
      return el('div', { class: 'fd-empty' }, [
        el('p', { text: 'No drawing for this flow.' }),
        el('p', { class: 'muted', text: 'Drawings are read from a Mendix project folder. A model imported as JSON carries none — replace the model from the project folder to see it.' })
      ]);
    }

    var nodes = graph.nodes;
    var boxes = absoluteBoxes(nodes);
    var byId = {};
    nodes.forEach(function (n) { byId[n.id] = n; });
    var errorFrom = {};
    (graph.edges || []).forEach(function (e) { if (e.isError) errorFrom[e.from] = true; });
    var ctx = { canOpen: opts.canOpen, errorFrom: errorFrom };
    var highlight = {};
    (opts.highlight || []).forEach(function (id) { highlight[id] = true; });

    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    Object.keys(boxes).forEach(function (id) {
      var b = boxes[id];
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h + 30);
    });
    var world = { x: minX - PAD, y: minY - PAD, w: (maxX - minX) + PAD * 2, h: (maxY - minY) + PAD * 2 };

    var defs = s('defs', {}, [
      s('marker', { id: 'fd-arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' }, [
        s('path', { d: 'M0,0 L10,5 L0,10 z', class: 'fd-arrowhead' })
      ]),
      s('marker', { id: 'fd-arrow-err', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' }, [
        s('path', { d: 'M0,0 L10,5 L0,10 z', class: 'fd-arrowhead-err' })
      ])
    ]);

    // Loops first, so the boxes inside them are drawn over them; edges next,
    // so an arrow never hides the text of a box it touches.
    var layerLoops = s('g', { class: 'fd-layer-loops' });
    var layerEdges = s('g', { class: 'fd-layer-edges' });
    var layerNodes = s('g', { class: 'fd-layer-nodes' });
    var layerLabels = s('g', { class: 'fd-layer-labels' });

    nodes.forEach(function (n) {
      var node = drawNode(n, boxes[n.id], ctx);
      if (highlight[n.id]) node.classList.add('is-highlight');
      (n.kind === 'loop' ? layerLoops : layerNodes).appendChild(node);
    });

    (graph.edges || []).forEach(function (e) {
      var a = boxes[e.from], b = boxes[e.to];
      if (!a || !b) return;
      var geo = edgeGeometry(e, a, b);
      var kind = e.kind === 'annotation' ? 'annotation' : (e.isError ? 'error' : 'sequence');
      layerEdges.appendChild(s('path', {
        d: geo.d, class: 'fd-edge fd-edge-' + kind,
        'marker-end': kind === 'annotation' ? null : (kind === 'error' ? 'url(#fd-arrow-err)' : 'url(#fd-arrow)')
      }));
      var label = branchLabel(e) || (e.isError ? 'error' : null);
      if (label) {
        var w = Math.min(160, measure(label, FONT.meta) + 12);
        var shown = measure(label, FONT.meta) + 12 > 160 ? ellipsize(label, FONT.meta, 148) : label;
        layerLabels.appendChild(s('g', { class: 'fd-branch' + (e.isError ? ' fd-branch-err' : '') }, [
          s('title', { text: label }),
          s('rect', { x: geo.mid.x - w / 2, y: geo.mid.y - 9, width: w, height: 18, rx: 9 }),
          s('text', { x: geo.mid.x, y: geo.mid.y + 4, 'text-anchor': 'middle', text: shown })
        ]));
      }
    });

    var svg = s('svg', { class: 'fd-svg', role: 'img', 'aria-label': 'Diagram of ' + (flow.qualifiedName || flow.name || 'this flow') },
      [defs, layerLoops, layerEdges, layerNodes, layerLabels]);

    // ---------- the frame: pan, zoom, fit, hover, click ----------
    var card = el('div', { class: 'fd-card', hidden: true });
    var zoomLabel = el('span', { class: 'fd-zoom-label', text: '100%' });
    var view = { x: world.x, y: world.y, w: world.w, h: world.h };
    var frame = el('div', { class: 'fd-frame', style: opts.height ? 'height:' + opts.height : null });
    var stage = el('div', { class: 'fd-stage' }, [svg, card]);

    function apply() {
      svg.setAttribute('viewBox', view.x + ' ' + view.y + ' ' + view.w + ' ' + view.h);
      var rect = stage.getBoundingClientRect();
      var pct = rect.width ? Math.round(rect.width / view.w * 100) : 100;
      zoomLabel.textContent = pct + '%';
    }
    function fit() {
      var rect = stage.getBoundingClientRect();
      var ratio = rect.width && rect.height ? rect.width / rect.height : 2;
      var w = world.w, h = world.h;
      // Never larger than 100% on a small flow: a three-box flow blown up to
      // fill the screen reads worse, not better.
      if (rect.width && w < rect.width && h < rect.height) { w = rect.width; h = rect.height; }
      if (w / h > ratio) h = w / ratio; else w = h * ratio;
      view = { x: world.x + (world.w - w) / 2, y: world.y + (world.h - h) / 2, w: w, h: h };
      apply();
    }
    function zoomAt(factor, cx, cy) {
      var nw = Math.max(80, Math.min(world.w * 8, view.w / factor));
      var f = nw / view.w;
      var rect = stage.getBoundingClientRect();
      var px = rect.width ? (cx - rect.left) / rect.width : 0.5, py = rect.height ? (cy - rect.top) / rect.height : 0.5;
      var wx = view.x + px * view.w, wy = view.y + py * view.h;
      view = { x: wx - px * view.w * f, y: wy - py * view.h * f, w: view.w * f, h: view.h * f };
      apply();
    }
    function center() { var r = stage.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

    var toolbar = el('div', { class: 'fd-tools' }, [
      el('button', { class: 'btn btn-sm', type: 'button', text: '−', title: 'Zoom out', 'aria-label': 'Zoom out', onclick: function () { var c = center(); zoomAt(1 / 1.25, c.x, c.y); } }),
      zoomLabel,
      el('button', { class: 'btn btn-sm', type: 'button', text: '+', title: 'Zoom in', 'aria-label': 'Zoom in', onclick: function () { var c = center(); zoomAt(1.25, c.x, c.y); } }),
      el('button', { class: 'btn btn-sm', type: 'button', text: 'Fit', title: 'Show the whole flow', onclick: fit }),
      el('span', { class: 'fd-tools-hint muted', text: 'Drag to move · Ctrl + wheel to zoom · hover a step for everything it says' })
    ]);

    // Wheel pans; Ctrl/⌘ + wheel (and a trackpad pinch, which arrives as one) zooms.
    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      var rect = stage.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) { zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY); return; }
      var k = rect.width ? view.w / rect.width : 1;
      view.x += e.deltaX * k; view.y += e.deltaY * k;
      apply();
    }, { passive: false });

    var drag = null, moved = false;
    stage.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
      moved = false;
      // The move and the release are listened for on the window (a drag may
      // leave the frame), through ONE pair of listeners for the whole page.
      activeDrag = {
        move: function (ev) {
          var dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
          if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
          moved = true;
          stage.classList.add('is-panning');
          card.hidden = true;
          var rect = stage.getBoundingClientRect();
          var k = rect.width ? view.w / rect.width : 1;
          view.x = drag.vx - dx * k; view.y = drag.vy - dy * k;
          apply();
        },
        up: function () { drag = null; stage.classList.remove('is-panning'); }
      };
    });

    function nodeOf(target) {
      var g = target && target.closest ? target.closest('.fd-node') : null;
      return g ? byId[g.getAttribute('data-id')] : null;
    }
    var hovered = null;
    stage.addEventListener('mousemove', function (e) {
      if (drag && moved) return;
      var n = nodeOf(e.target);
      if (!n || n.kind === 'merge') { card.hidden = true; hovered = null; return; }
      if (hovered !== n) {
        hovered = n;
        while (card.firstChild) card.removeChild(card.firstChild);
        card.appendChild(cardFor(n, ctx));
      }
      card.hidden = false;
      var rect = stage.getBoundingClientRect();
      var x = e.clientX - rect.left + 16, y = e.clientY - rect.top + 16;
      var cw = card.offsetWidth || 300, ch = card.offsetHeight || 120;
      if (x + cw > rect.width - 8) x = Math.max(8, e.clientX - rect.left - cw - 16);
      if (y + ch > rect.height - 8) y = Math.max(8, rect.height - ch - 8);
      card.style.left = x + 'px';
      card.style.top = y + 'px';
    });
    stage.addEventListener('mouseleave', function () { card.hidden = true; hovered = null; });
    function openNode(n) {
      if (n && n.ref && opts.canOpen && opts.canOpen(n.ref) && opts.open) opts.open(n.ref);
    }
    stage.addEventListener('click', function (e) { if (!moved) openNode(nodeOf(e.target)); });
    stage.addEventListener('keydown', function (e) { if (e.key === 'Enter') openNode(nodeOf(e.target)); });

    var legend = el('div', { class: 'fd-legend' }, ['data', 'object', 'call', 'client', 'integration', 'variable'].map(function (f) {
      return el('span', { class: 'fd-legend-item' }, [el('span', { class: 'fd-swatch fd-swatch-' + f }), el('span', { text: FAMILY_LABEL[f] })]);
    }));

    frame.appendChild(toolbar);
    frame.appendChild(stage);
    frame.appendChild(legend);
    // Fit once the frame has a size: on the next frame after it is attached.
    // A whole long flow fitted into the frame is a picture nobody can read.
    // So it opens readable — at 90%, at its start, the way one reads a flow —
    // and Fit is one click away for the overview.
    function opening() {
      var rect = stage.getBoundingClientRect();
      fit();
      if (!rect.width || rect.width / view.w >= 0.7) return;
      var start = nodes.filter(function (n) { return n.kind === 'start'; })[0];
      var sb = start ? boxes[start.id] : { x: world.x + PAD, cy: world.y + world.h / 2 };
      var w = rect.width / 0.9, h = rect.height / 0.9;
      view = { x: sb.x - 60, y: Math.max(world.y, Math.min(sb.cy - h / 2, world.y + world.h - h)), w: w, h: h };
      apply();
    }
    var tries = 0;
    (function fitWhenSized() {
      if (stage.getBoundingClientRect().width > 0) { opening(); return; }
      if (++tries < 60) requestAnimationFrame(fitWhenSized);
    })();
    frame.fit = fit;
    return frame;
  }

  // app.js rebuilds the page on every change, popup included. A drawing that
  // was rebuilt each time would lose where the reader had panned and zoomed to,
  // so the last few are kept and handed back while their flow's graph is the
  // same object (a replaced model is a new object, and draws afresh).
  var kept = [];
  function renderKept(key, flow, opts) {
    var hit = kept.filter(function (k) { return k.key === key && k.graph === (flow && flow.graph); })[0];
    if (hit) return hit.frame;
    var frame = render(flow, opts);
    kept = kept.filter(function (k) { return k.key !== key; });
    kept.unshift({ key: key, graph: flow && flow.graph, frame: frame });
    kept = kept.slice(0, 6);
    return frame;
  }

  window.MxFlowDraw = { init: init, render: render, renderKept: renderKept };
})();
