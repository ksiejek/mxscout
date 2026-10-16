/* MxScout — a flow, drawn as a graph.
 *
 * The redesign's picture of a microflow or nanoflow (spec 02 §4, DRAKON):
 * the main path runs straight down the page; the other way out of a decision
 * leaves to the right, with its own steps under its label, and either
 * "rejoins the main path" or ends there. Every step is a card with its
 * family's colour and icon. It draws the workflow docs-data.js already folds
 * out of the model (MxDocsData.flowEntry) and nothing else, and which way
 * stays on the main path is flowtrace.js's rule (mainBranch), so every
 * drawing of a flow agrees.
 *
 * The Microflows screen's Workflow view, the default (Karol, 2026-10-14: two
 * views behind a switch, Workflow and Modeler): steps to click, a variable
 * to trace. A way out to the side leaves from the node's own edge. Self-contained — its own element helper, no other
 * MxScout module reached except MxFlowTrace — because the same drawing is
 * meant to travel inside the exported documentation; every node is built
 * with createElement / createElementNS and every text set as text.
 *
 * What the design did not draw is drawn plainly: a loop is a dashed frame
 * with the main path inside it, an error handler leaves to the right like a
 * second way out, labelled "error", and a decision inside a side way is drawn
 * small, its ways one under the other.
 */
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function h(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  // Icons (spec 02, appendix A): 16-unit viewBox, stroked, decorative. One
  // map, used by every place that draws a step.
  var ICONS = {
    db: [['ellipse', { cx: 8, cy: 4, rx: 5, ry: 2 }], ['path', { d: 'M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2' }]],
    call: [['path', { d: 'M2.5 8h9M8.5 5l3 3-3 3' }], ['path', { d: 'M13.5 3.5v9' }]],
    obj: [['rect', { x: 2.5, y: 2.5, width: 11, height: 11, rx: 2 }], ['path', { d: 'M8 5.3v5.4M5.3 8h5.4' }]],
    commit: [['path', { d: 'M3 8.5l3 3 7-7' }]],
    del: [['path', { d: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5' }]],
    page: [['rect', { x: 3, y: 2, width: 10, height: 12, rx: 1.5 }], ['path', { d: 'M5.5 5.5h5M5.5 8h5M5.5 10.5h3' }]],
    msg: [['path', { d: 'M2.5 3.5h11v7.5h-6l-3 2.5V11h-2z' }]],
    rejoin: [['path', { d: 'M12 3v5a3 3 0 0 1-3 3H3M6 8l-3 3 3 3' }]],
    loop: [['path', { d: 'M13 8a5 5 0 1 1-1.5-3.6' }], ['path', { d: 'M12 1.8v2.8H9.2' }]],
    // A process's diagram (docs-view.js drawProcesses): a step a person takes, a step the application takes.
    person: [['circle', { cx: 8, cy: 5, r: 2.5 }], ['path', { d: 'M3 13.5c.6-2.6 2.6-4 5-4s4.4 1.4 5 4' }]],
    app: [['rect', { x: 2, y: 3, width: 12, height: 8.5, rx: 1.5 }], ['path', { d: 'M6 14h4M8 11.5V14' }]]
  };
  // A jump to a step already drawn: forward it rejoins, back it repeats.
  function goText(b) {
    if (!b.no) return b.back ? 'goes back up' : 'continues';
    return (b.back ? 'goes back to step ' : 'continues at step ') + b.no;
  }
  function icon(name, size) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'fg-icon');
    (ICONS[name] || []).forEach(function (s) {
      var node = document.createElementNS(SVG_NS, s[0]);
      Object.keys(s[1]).forEach(function (k) { node.setAttribute(k, String(s[1][k])); });
      svg.appendChild(node);
    });
    return svg;
  }

  // docs-data's families, onto the six the design colours (spec 02 §4.5: no
  // new colours). The ones the design left out take the nearest: an external
  // call (Java, REST, web service) the database's blue with the call arrow, a
  // page or a download the object's orange, a message or a log the variable's
  // grey. Same mapping as the documentation's stylesheet.
  function look(card) {
    var a = String(card.action || ''), t = String(card.kick || '') + ' ' + String(card.title || '');
    switch (card.fam) {
      case 'db': return { fam: 'db', icon: 'db' };
      case 'obj': return { fam: 'obj', icon: 'obj' };
      case 'save': return { fam: 'save', icon: a === 'DeleteAction' || /delete/i.test(t) ? 'del' : 'commit' };
      case 'call': return { fam: 'call', icon: 'call' };
      case 'ext': return { fam: 'db', icon: 'call' };
      case 'ui': return { fam: 'obj', icon: 'page' };
      case 'msg': return { fam: 'var', icon: 'msg' };
      case 'person': return { fam: 'obj', icon: 'person' };
      case 'app': return { fam: 'db', icon: 'app' };
      default: return { fam: 'var', glyph: 'x=' };
    }
  }
  function tile(card, size) {
    var l = look(card);
    var node = h('span', { class: 'fg-tile fg-' + l.fam + ' s' + size, 'aria-hidden': 'true' });
    if (l.glyph) node.textContent = l.glyph;
    else node.appendChild(icon(l.icon, size > 26 ? 15 : 13));
    return node;
  }

  // ---------- what a card says ----------
  function shortName(qn) { return String(qn || '').split('.').pop(); }
  // The kind of step, then what it works on: "Retrieve from database ·
  // MDM.Country", "Commit object · with events".
  function kicker(c) {
    var p = c.props || {}, k = c.kick || '';
    var q = null;
    if (p.entity && k.indexOf(p.entity) === -1 && (c.fam === 'db' || c.fam === 'obj')) q = p.entity;
    if (c.action === 'CommitAction' && p.withEvents) q = p.withEvents === 'Yes' ? 'with events' : 'without events';
    return q ? k + ' · ' + q : k;
  }
  function outVar(c) {
    var p = c.props || {};
    if (!p.out) return null;
    return String(c.title || '').trim() === '$' + p.out ? null : ' → $' + p.out;
  }

  // ---------- drawing ----------
  function render(entry, opts) {
    opts = opts || {};
    var an = opts.analysis || null;
    // A click goes to whatever the drawing was last handed (select below), so
    // a drawing kept across redraws calls the screen it is on now.
    var root = null;
    var pick = typeof opts.onPick === 'function' ? function (no) { root.fgOnPick(no); } : null;
    // Every node that shows whether it is the picked step: its class without
    // and with "on", so a new pick changes those two nodes and nothing else.
    var marks = {};
    function mark(no, node, before, after) {
      (marks[no] = marks[no] || []).push({ node: node, before: before, after: after, pressed: !!pick });
      return node;
    }
    var traceVar = opts.traceVar || null;

    function roleAt(key) { return an && traceVar ? an.roleAt(traceVar, key) : null; }
    var STRONG = { parameter: 1, defines: 1 }, MID = { changes: 1, commits: 1, deletes: 1 };
    function tag(role) {
      if (!role) return null;
      return h('span', { class: 'fg-role ' + (STRONG[role] ? 'strong' : MID[role] ? 'mid' : 'weak'), text: role });
    }
    function dimmed(key) { return traceVar && !roleAt(key) ? ' dim' : ''; }

    function stepCard(b, small) {
      var c = b.card || {};
      var on = opts.selected === b.no;
      // A process's diagram (docs-view.js) says its steps in words, not in code: no code font for them.
      var biz = c.fam === 'person' || c.fam === 'app';
      var before = 'fg-card' + (small ? ' small' : '') + (biz ? ' biz' : '') + (c.off ? ' off' : ''), after = dimmed(b.no);
      var attrs = { class: before + (on ? ' on' : '') + after, 'data-step': String(b.no) };
      var body = small
        ? [tile(c, 24), h('span', { class: 'fg-text' }, [
            h('span', { class: 'fg-kind', text: c.kick || '' }),
            h('span', { class: 'fg-main' }, [c.title || '', outVar(c) ? h('span', { class: 'fg-muted', text: outVar(c) }) : null])
          ]), h('span', { class: 'fg-right' }, [h('span', { class: 'fg-no', text: String(b.no) }), tag(roleAt(b.no))])]
        : [tile(c, 30), h('span', { class: 'fg-text' }, [
            h('span', { class: 'fg-kind', text: kicker(c) }),
            h('span', { class: 'fg-main' }, [c.title || '', outVar(c) ? h('span', { class: 'fg-muted', text: outVar(c) }) : null])
          ]), h('span', { class: 'fg-right' }, [h('span', { class: 'fg-no', text: String(b.no) }), tag(roleAt(b.no))])];
      if (!pick) return mark(b.no, h('div', attrs, body), before, after);
      attrs.type = 'button';
      attrs['aria-pressed'] = on ? 'true' : 'false';
      attrs.onclick = function () { pick(b.no); };
      return mark(b.no, h('button', attrs, body), before, after);
    }

    function decision(b, small) {
      var on = opts.selected === b.no;
      var before = 'fg-decision' + (small ? ' small' : ''), after = dimmed(b.no);
      var attrs = { class: before + (on ? ' on' : '') + after, 'data-step': String(b.no) };
      var body = [
        h('span', { class: 'fg-rhomb', 'aria-hidden': 'true' }),
        h('span', { class: 'fg-dec-title', text: b.title || 'Decision' }),
        b.cond ? h('span', { class: 'fg-dec-cond', text: b.cond, title: b.cond }) : null,
        h('span', { class: 'fg-no', text: String(b.no) }),
        tag(roleAt(b.no))
      ];
      if (!pick) return mark(b.no, h('span', attrs, body), before, after);
      attrs.type = 'button';
      attrs['aria-pressed'] = on ? 'true' : 'false';
      attrs.onclick = function () { pick(b.no); };
      return mark(b.no, h('button', attrs, body), before, after);
    }

    function endPill(b) {
      var returns = b.returns ? 'returns ' + b.returns : null;
      return h('span', { class: 'fg-pill fg-end' + (b.kind === 'errorEvent' ? ' error' : '') + dimmed('end') }, [
        h('span', { class: 'fg-ring', 'aria-hidden': 'true' }),
        h('span', { text: b.label + (returns ? ' · ' : '') }),
        returns ? h('span', { class: 'fg-mono', text: returns }) : null,
        b.kind === 'end' ? tag(roleAt('end')) : null
      ]);
    }
    function sideEnd(b) {
      return h('span', { class: 'fg-side-end' + (b.kind === 'errorEvent' ? ' error' : '') + dimmed('end') }, [
        h('span', { class: 'fg-ring small', 'aria-hidden': 'true' }),
        b.label + (b.returns ? ' · ' + b.returns : '')
      ]);
    }
    function rejoins() {
      return h('span', { class: 'fg-rejoin' }, [icon('rejoin', 13), 'rejoins the main path']);
    }

    // A way out to the side: its label, then its steps small, one under the
    // other, then how it finishes.
    function sideWay(label, body, ends) {
      var out = [h('span', { class: 'fg-label', text: label === null || label === undefined ? 'otherwise' : label })];
      sideItems(body).forEach(function (n) { out.push(n); });
      if (!ends) out.push(rejoins());
      return h('div', { class: 'fg-side-way' }, out);
    }
    function sideItems(list) {
      var out = [];
      (list || []).forEach(function (b) {
        if (b.t === 'step') {
          out.push(stepCard(b, true));
          if (b.error && b.error.length) out.push(h('div', { class: 'fg-side-nest' }, [sideWay('error', b.error, true)]));
        } else if (b.t === 'split') {
          out.push(decision(b, true));
          out.push(h('div', { class: 'fg-side-nest' }, b.branches.map(function (br) { return sideWay(br.label, br.body, br.ends); })));
        } else if (b.t === 'loop') {
          out.push(h('div', { class: 'fg-side-nest loop' }, [h('span', { class: 'fg-label', text: loopLabel(b) })].concat(sideItems(b.body))));
        } else if (b.t === 'end') {
          out.push(sideEnd(b));
        } else if (b.t === 'go') {
          out.push(h('span', { class: 'fg-rejoin' }, [icon('rejoin', 13), goText(b)]));
        }
      });
      return out;
    }
    function loopLabel(b) {
      return b.each && b.over ? 'For each ' + b.each + ' in ' + b.over : b.cond ? 'While ' + b.cond : (b.title || 'Loop');
    }

    // The main path as rows of ONE three-column grid: the node, the line that
    // leads right, and what leaves to the side. A way out to the side spans
    // the rows below it until the next row that needs the side column, so the
    // main path goes on next to it instead of waiting underneath (Karol,
    // 2026-10-13). A loop takes the whole width, its body a grid of its own.
    function row(main, side, opts2) {
      opts2 = opts2 || {};
      return { main: main, side: side, full: !!opts2.full, wide: !!opts2.wide, last: !!opts2.last };
    }
    function gap(label) { return { gap: true, label: label }; }
    function place(node, rowPos, colPos) { node.style.gridRow = rowPos; node.style.gridColumn = colPos; return node; }
    // A way out to the side does not size the rows beside it (its cell has no
    // height of its own). Once the drawing is laid out, fit() measures how
    // much taller it is than those rows and gives exactly that to one stretch
    // of line at their end, so the main path stays together under its
    // decision instead of being spread out to match (Karol, 2026-10-13).
    // A grid with nothing to the side — no way out, no loop that has one —
    // is one column, so the path stands in the middle rather than at the left
    // of an empty side column (Karol, 2026-10-13). A loop spans the whole
    // width only when its own body has a way out to the side.
    function assemble(rows) {
      var wide = rows.some(function (r) { return r.side || (r.full && r.wide); });
      var grid = h('div', { class: 'fg-grid' + (wide ? '' : ' single') });
      grid.fgWide = wide;
      // The last thing drawn has no line running on below it.
      for (var k = rows.length - 1; k >= 0; k--) { if (!rows[k].gap) { rows[k].last = true; break; } }
      var spanEnd = [], stretchAfter = {};
      rows.forEach(function (r, i) {
        if (!r.side) return;
        var span = 1;
        while (i + span < rows.length && !rows[i + span].side && !rows[i + span].full) span++;
        spanEnd[i] = i + span - 1;
        stretchAfter[i + span - 1] = true;
      });
      var line = [], stretchLine = {}, n = 0;
      rows.forEach(function (r, i) { line[i] = ++n; if (stretchAfter[i]) stretchLine[i] = ++n; });
      var firstCell = [], stretchCell = {};
      rows.forEach(function (r, i) {
        if (r.gap) {
          firstCell[i] = place(h('div', { class: 'fg-cell-main fg-gap', 'aria-hidden': 'true' }, [h('span', { class: 'fg-vline' }), r.label ? h('span', { class: 'fg-gap-label', text: r.label }) : null]), String(line[i]), '1');
        } else {
          var spans = r.full && r.wide;
          // A row with a way out to the side draws its line from the node's own edge (with-side): a
          // decision is narrower than its column, and the line used to start at the column's edge,
          // a gap short of it (Karol, 2026-10-14: "the arrows do not join").
          firstCell[i] = place(h('div', { class: 'fg-cell-main' + (spans ? ' full' : '') + (r.side ? ' with-side' : '') }, [r.main, r.last || r.full ? null : h('span', { class: 'fg-extend', 'aria-hidden': 'true' })]), String(line[i]), spans ? '1 / -1' : '1');
        }
        grid.appendChild(firstCell[i]);
        if (stretchAfter[i]) {
          stretchCell[i] = place(h('div', { class: 'fg-cell-main fg-stretch', 'aria-hidden': 'true' }, rows[i].last ? [] : [h('span', { class: 'fg-vline' })]), String(stretchLine[i]), '1');
          grid.appendChild(stretchCell[i]);
        }
      });
      rows.forEach(function (r, i) {
        if (!r.side) return;
        grid.appendChild(place(h('div', { class: 'fg-cell-link' }, [h('span', { class: 'fg-hline', 'aria-hidden': 'true' })]), String(line[i]), '2'));
        var cell = place(h('div', { class: 'fg-cell-side' }, [r.side]), line[i] + ' / ' + (stretchLine[spanEnd[i]] + 1), '3');
        fits.push({ grid: grid, side: cell, first: firstCell[i], stretch: stretchCell[spanEnd[i]] });
        grid.appendChild(cell);
      });
      return grid;
    }
    var fits = [];

    function mainRows(list, rows, startLabel) {
      var pending = startLabel || null;
      function push(r) { if (rows.length) rows.push(gap(pending)); pending = null; rows.push(r); }
      (list || []).forEach(function (b) {
        if (b.t === 'start') return;
        if (b.t === 'step') {
          var side = b.error && b.error.length ? h('div', { class: 'fg-side' }, [sideWay('error', b.error, true)]) : null;
          push(row(stepCard(b, false), side));
        } else if (b.t === 'split') {
          var mi = window.MxFlowTrace ? window.MxFlowTrace.mainBranch(b) : 0;
          var main = b.branches[mi];
          var sides = b.branches.filter(function (x, i) { return i !== mi; });
          push(row(decision(b, false), sides.length ? h('div', { class: 'fg-side' }, sides.map(function (br) { return sideWay(br.label, br.body, br.ends); })) : null));
          // The main way's label goes on the line under the decision: on its
          // first step, or on whatever follows when it has none of its own.
          var lab = main ? (main.label === null || main.label === undefined ? 'otherwise' : main.label) : null;
          if (main && main.body.length) { mainRows(main.body, rows, lab); pending = null; } else pending = lab;
        } else if (b.t === 'loop') {
          var body = assemble(mainRows(b.body, [], null));
          push(row(h('div', { class: 'fg-loop' + dimmed(b.no) }, [h('span', { class: 'fg-loop-head' }, [icon('loop', 13), h('span', { text: loopLabel(b) })]), body]), null, { full: true, wide: body.fgWide }));
        } else if (b.t === 'end') {
          push(row(endPill(b), null, { last: true }));
        } else if (b.t === 'go') {
          push(row(h('span', { class: 'fg-rejoin' }, [icon('rejoin', 13), goText(b)]), null, { last: true }));
        } else if (b.t === 'orphan') {
          var lost = assemble(mainRows(b.body, [], null));
          push(row(h('div', { class: 'fg-loop' }, [h('span', { class: 'fg-loop-head' }, [h('span', { text: 'not reached from the start' })]), lost]), null, { full: true, wide: lost.fgWide }));
        }
      });
      return rows;
    }

    var params = (entry.params || []).map(function (p) { return '$' + p.name; });
    // Up to three parameters fit on the Start pill; more turn it into a card
    // with each parameter a chip, so seventeen do not make a round blob
    // (Karol, 2026-10-13).
    var start = params.length <= 3 ? h('span', { class: 'fg-pill fg-start' + dimmed('start') }, [
      h('span', { class: 'fg-start-dot', 'aria-hidden': 'true' }),
      h('span', { text: 'Start' }),
      params.length ? h('span', { class: 'fg-params', text: params.join(' · ') }) : null,
      tag(roleAt('start'))
    ]) : h('div', { class: 'fg-start-card' + dimmed('start') }, [
      h('div', { class: 'fg-start-head' }, [
        h('span', { class: 'fg-start-dot', 'aria-hidden': 'true' }),
        h('span', { text: 'Start' }),
        h('span', { class: 'fg-start-n', text: params.length + ' parameters' }),
        tag(roleAt('start'))
      ]),
      h('div', { class: 'fg-start-params' }, params.map(function (p) { return h('span', { class: 'fg-param', text: p }); }))
    ]);
    var rows = [row(start, null)];
    if (!entry.workflow || !entry.workflow.length) {
      rows.push(row(h('p', { class: 'fg-note', text: 'This model carries no drawing of this flow.' }), null, { last: true }));
    } else {
      mainRows(entry.workflow, rows, null);
    }
    var top = assemble(rows);
    root = h('div', { class: 'fg' + (opts.compact ? ' compact' : '') + (top.fgWide ? '' : ' single') }, [top]);
    root.fgOnPick = opts.onPick || null;
    root.fgMarks = marks;
    root.fgSelected = opts.selected === undefined ? null : opts.selected;
    whenShown(root, function () { fit(fits); });
    return root;
  }

  // A drawing already made, with another step picked: the two steps whose
  // look says so change, and nothing else is drawn again (a click on a step
  // of a big flow used to build the whole drawing anew and fit it again).
  // False when the drawing cannot be kept — it was taken off the page and
  // stopped following its width — and must be drawn again.
  function select(node, no, onPick) {
    if (!node || !node.fgMarks || node.fgGone) return false;
    if (onPick) node.fgOnPick = onPick;
    no = no === undefined ? null : no;
    var was = node.fgSelected;
    if (was === no) return true;
    [was, no].forEach(function (n) {
      (node.fgMarks[n] || []).forEach(function (m) {
        var on = n === no;
        m.node.setAttribute('class', m.before + (on ? ' on' : '') + m.after);
        if (m.pressed) m.node.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    });
    node.fgSelected = no;
    return true;
  }

  // Give each way out to the side the height it needs at the end of the rows
  // beside it. Inner grids (a loop's) first, since their height moves the
  // outer ones; within a grid each way is measured against its own rows only.
  //
  // Measured a level at a time, not a way at a time: every height written
  // made the next measurement lay the whole page out again, a hundred times
  // over on a flow with a hundred ways out. Ways in grids at the same depth
  // do not move one another — each is measured from its own first row to its
  // own stretch, and the rows between them belong to it alone — so a level
  // is read whole, then written whole, and the next level up reads what the
  // one below it left.
  function fit(fits) {
    var depth = function (n) { var d = 0; while (n && n.parentElement) { if (n.classList && n.classList.contains('fg-grid')) d++; n = n.parentElement; } return d; };
    var list = fits.filter(function (f) { return f.side.isConnected; });
    var levels = {};
    list.forEach(function (f) { var d = depth(f.grid); (levels[d] = levels[d] || []).push(f); });
    list.forEach(function (f) { f.stretch.style.height = '0px'; });
    Object.keys(levels).map(Number).sort(function (a, b) { return b - a; }).forEach(function (d) {
      var heights = levels[d].map(function (f) {
        var top = f.first.getBoundingClientRect().top;
        var room = f.stretch.getBoundingClientRect().top - top;
        var need = f.side.firstChild.getBoundingClientRect().height + 10;
        return Math.max(0, Math.ceil(need - room)) + 'px';
      });
      levels[d].forEach(function (f, i) { f.stretch.style.height = heights[i]; });
    });
  }
  // Run fn once the drawing is on the page, and again when its width changes
  // (cards wrap differently, so the heights do too).
  function whenShown(root, fn) {
    var tries = 0, width = -1;
    function tick() {
      // A timer, not an animation frame: frames do not come while the tab
      // is in the background, and the drawing must be right when it shows.
      if (!root.isConnected) { if (tries++ < 100) setTimeout(tick, 20); return; }
      width = root.getBoundingClientRect().width;
      fn();
      if (window.ResizeObserver) {
        var ro = new window.ResizeObserver(function () {
          // A drawing taken off the page is not coming back: let it go.
          if (!root.isConnected) { ro.disconnect(); root.fgGone = true; return; }
          var w = root.getBoundingClientRect().width;
          if (Math.abs(w - width) > 1) { width = w; fn(); }
        });
        ro.observe(root);
      }
    }
    // First as soon as the code that drew it has put it on the page — before
    // the browser paints it, so it is never shown unfitted and fitted again a
    // moment later — and by the timer only when it is not on the page yet.
    if (typeof Promise === 'function') Promise.resolve().then(tick); else tick();
  }

  // The figures the header above a drawing quotes: steps, decisions, ends.
  function counts(entry) {
    var decisions = 0, ends = 0;
    (function walk(list) {
      (list || []).forEach(function (b) {
        if (b.t === 'split') { decisions++; b.branches.forEach(function (x) { walk(x.body); }); }
        if (b.t === 'end') ends++;
        if (b.t === 'loop' || b.t === 'orphan') walk(b.body);
        if (b.error) walk(b.error);
      });
    })(entry.workflow);
    return { steps: entry.steps || 0, decisions: decisions, ends: ends };
  }

  window.MxFlowGraph = { render: render, select: select, counts: counts, look: look, tile: tile, icon: icon, kicker: kicker };
})();
