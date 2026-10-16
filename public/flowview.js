/* MxScout — one flow, read the way a developer reads it (private redesign
 * specs 02 and 14): a list of names with their triage on the left; on the
 * right the flow drawn as a graph (flowgraph.js), a bar to trace a variable
 * through it, and beside the drawing either the step you clicked — with every
 * detail of the action, the members a Create or Change sets grouped by where
 * their values come from — or the flow as a whole: what it does, who may
 * start it, what it calls, what calls it, the risks that name it. "Studio Pro
 * view" opens the same flow laid out as Studio Pro lays it out, with its
 * properties dialogs (studioview.js). A page is drawn as Studio Pro's page
 * editor draws it (pagepreview.js), across the whole width and zoomed as the
 * Modeler is; what was clicked on it, or the page's details behind About, in
 * a window over it.
 *
 * One component, two shells (spec 14): MxScout's Microflows screen
 * (microflows.js) and the exported documentation's "Microflows & pages"
 * (docs-view.js) both hand it what it shows and how to move, and differ only
 * in their header and their actions. So it works on the documentation's own
 * entries (docs-data.js) and reaches nothing of the app's — it travels inside
 * the exported file as it is, beside flowgraph.js, flowtrace.js and
 * studioview.js. Text from the model or an agent is set as text only.
 *
 *   MxFlowView.screen(src, u, opts)
 *     src.items     the entries to list (one kind, or several in the report's "All")
 *     src.entry(kind, qn)  any entry by name, kind null for the first that exists
 *     src.model     { entities, associations, microflows, nanoflows } in the
 *                   model's shape, for members' types and a callee's parameters
 *     src.risks(entry), src.desc(entry) -> { text, stale } | null
 *     u             its state, kept by the shell: module, key, sort, show,
 *                   filter, step, trace, tab, mview, studio
 *     opts.rerender(), opts.openFlow(kind, qn), opts.openRef(kind, qn),
 *     opts.actions(entry) -> nodes, opts.copied(qn), opts.kindTags,
 *     opts.rowMenu(entry, event) — a right-click on a row of the list (MxScout's context, basket.js)
 */
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : String(v));
    });
    (kids || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      n.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return n;
  }
  var ICONS = {
    microflow: [['circle', { cx: 3, cy: 8, r: 1.6 }], ['rect', { x: 6, y: 5.5, width: 4.5, height: 5, rx: 1 }], ['circle', { cx: 13.4, cy: 8, r: 1.6 }], ['path', { d: 'M4.6 8H6M10.5 8h1.3' }]],
    nanoflow: [['rect', { x: 1.8, y: 4.5, width: 12.4, height: 7, rx: 3.5 }], ['path', { d: 'M5.5 8h4.5M8.5 6.3L10.2 8l-1.7 1.7' }]],
    page: [['rect', { x: 2.5, y: 2, width: 11, height: 12, rx: 1.5 }], ['path', { d: 'M5 5.5h6M5 8h6M5 10.5h3.5' }]],
    search: [['circle', { cx: 7, cy: 7, r: 4.5 }], ['path', { d: 'M10.5 10.5L14 14' }]],
    sort: [['path', { d: 'M5 3v10M2.8 10.8L5 13l2.2-2.2M11 13V3M8.8 5.2L11 3l2.2 2.2' }]],
    copy: [['rect', { x: 5.5, y: 5.5, width: 8, height: 8, rx: 1.5 }], ['path', { d: 'M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5' }]],
    studio: [['circle', { cx: 2.5, cy: 8, r: 1.5 }], ['rect', { x: 5, y: 6, width: 4, height: 4, rx: 0.8 }], ['path', { d: 'M12.2 5.5l2.3 2.5-2.3 2.5-2.3-2.5z' }], ['path', { d: 'M4 8h1M9 8h0.9' }]],
    shield: [['path', { d: 'M8 1.8l5 2v4c0 3-2.2 5.2-5 6.4-2.8-1.2-5-3.4-5-6.4v-4z' }]],
    arrow: [['path', { d: 'M3 8h9M8.5 4.5L12 8l-3.5 3.5' }]],
    caret: [['path', { d: 'M4 6l4 4 4-4' }]],
    // a snippet, and anything else a flow is named by (an event, a service): not a flow, so not its icon
    snippet: [['rect', { x: 2, y: 3, width: 12, height: 10, rx: 1.5, 'stroke-dasharray': '2.2 1.6' }], ['path', { d: 'M5 8h6' }]],
    other: [['circle', { cx: 8, cy: 8, r: 4.5 }], ['path', { d: 'M8 5.8V8l1.6 1.2' }]]
  };
  function icon(name, size, cls) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'xe-i ic-' + name + (cls ? ' ' + cls : ''));
    (ICONS[name] || []).forEach(function (s) {
      var node = document.createElementNS(SVG_NS, s[0]);
      Object.keys(s[1]).forEach(function (k) { node.setAttribute(k, String(s[1][k])); });
      svg.appendChild(node);
    });
    return svg;
  }
  function moduleOf(qn) { var i = String(qn || '').indexOf('.'); return i > 0 ? qn.slice(0, i) : ''; }
  function shortName(qn) { return String(qn || '').split('.').pop(); }
  function requestFrame(fn) { if (window.requestAnimationFrame) window.requestAnimationFrame(fn); else fn(); }
  var LEVELS = ['P1', 'P2', 'P3'];
  function levels(risks) { return LEVELS.filter(function (l) { return risks.some(function (r) { return r.level === l; }); }); }
  var KIND_TAG = { microflow: 'MF', nanoflow: 'NF', page: 'PG' };
  var KIND_WORD = { microflow: 'Microflow', nanoflow: 'Nanoflow', page: 'Page' };

  // Where in the drawing a call to `target` is made: the first step that refers to it.
  function callStep(workflow, target) {
    var at = null;
    (function walk(list) {
      (list || []).forEach(function (b) {
        if (at) return;
        if (b.t === 'step' && b.card && b.card.ref && b.card.ref.qn === target) { at = b.no; return; }
        if (b.t === 'step') walk(b.error);
        if (b.t === 'split') b.branches.forEach(function (x) { walk(x.body); });
        if (b.t === 'loop' || b.t === 'orphan') walk(b.body);
      });
    })(workflow);
    return at;
  }

  var analysed = new WeakMap();
  // The Workflow drawing last made for a screen's state, to keep across redraws.
  var drawings = new WeakMap();
  var boards = new WeakMap();
  function screen(src, u, opts) {
    var rerender = opts.rerender;
    // Every click draws the screen again; the list and the drawing keep their
    // place, the drawing only while it is the same flow and the list while it
    // is the same module.
    u.scroll = u.scroll || {};
    function keep(node, name, owner) {
      var at = u.scroll[name];
      if (at && at.owner === owner) requestFrame(function () { node.scrollTop = at.top; node.scrollLeft = at.left; });
      // A drawing kept across redraws is the same node: one listener is enough.
      if (node.mfKeeps === name + '|' + owner) return node;
      node.mfKeeps = name + '|' + owner;
      node.addEventListener('scroll', function () { u.scroll[name] = { owner: owner, top: node.scrollTop, left: node.scrollLeft }; }, { passive: true });
      return node;
    }
    // A pane's place across the app drawn again (app.js keeps every box marked data-keep-scroll): the key names
    // this screen's kind and the item it shows, so another flow, step or page starts at the top.
    function placeKey(name, owner) { return (opts.noun || 'microflows') + '|' + name + '|' + owner; }

    // ---------- the list ----------
    function listColumn() {
      var items = src.items, modules = {};
      items.forEach(function (f) { modules[f.module] = true; });
      var names = Object.keys(modules).sort(function (a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); });
      var cur = u.key ? items.filter(function (f) { return f.key === u.key; })[0] : null;
      if (!u.module || !modules[u.module]) u.module = cur ? cur.module : names[0] || null;
      var inModule = items.filter(function (f) {
        return f.module === u.module && (!u.filter || f.name.toLowerCase().indexOf(u.filter.toLowerCase()) !== -1);
      });
      var withRisks = inModule.filter(function (f) { return src.risks(f).length; });
      var noCallers = inModule.filter(function (f) { return !(f.calledBy || []).length; });
      var shown = u.show === 'risks' ? withRisks : u.show === 'callers' ? noCallers : inModule;
      shown = shown.slice().sort(u.sort === 'steps'
        ? function (a, b) { return (b.steps || 0) - (a.steps || 0) || a.name.localeCompare(b.name); }
        : function (a, b) { return a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.kind.localeCompare(b.kind); });
      var noun = opts.noun || 'microflows';
      var filter = h('input', { type: 'text', class: 'xe-filter-input', placeholder: 'Filter ' + noun, value: u.filter || '', 'aria-label': 'Filter ' + noun });
      filter.addEventListener('input', function () {
        u.filter = filter.value;
        var caret = filter.selectionStart;
        rerender();
        var again = document.querySelector('.mf-list .xe-filter-input');
        if (again) { again.focus(); try { again.setSelectionRange(caret, caret); } catch (e) { /* fine */ } }
      });
      // The design has a button here and no list behind it; a select is the
      // usual way to pick one of many.
      var modSelect = h('select', { class: 'mf-module-select', 'aria-label': 'Module filter: ' + (u.module || 'none') });
      modSelect.appendChild(h('option', { value: '', text: 'All modules' }));
      names.forEach(function (n) {
        var o = h('option', { value: n, text: n });
        if (n === u.module) o.setAttribute('selected', 'selected');
        modSelect.appendChild(o);
      });
      modSelect.addEventListener('change', function () {
        u.module = modSelect.value || null;
        if (!u.module) { u.key = null; u.step = null; u.trace = null; u.studio = false; }
        rerender();
      });
      var sortTitle = u.sort === 'steps' ? 'Sorted by steps — switch to A to Z' : 'Sorted A to Z — switch to steps';
      function seg(key, label, n) {
        var on = (u.show || 'all') === key;
        return h('button', { type: 'button', class: 'xe-seg' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', onclick: function () { u.show = key; rerender(); } },
          [label, h('span', { class: 'xe-seg-n', text: String(n) })]);
      }
      var rows = shown.map(function (f) {
        var on = f.key === u.key;
        var lv = levels(src.risks(f));
        return h('button', {
          type: 'button', class: 'mf-row' + (on ? ' on' : ''), 'aria-current': on ? 'true' : 'false', title: f.name,
          onclick: function () { u.key = f.key; u.step = null; u.trace = null; u.tab = 'step'; u.studio = false; rerender(); },
          oncontextmenu: opts.rowMenu ? function (ev) { opts.rowMenu(f, ev); } : null
        }, [
          opts.kindTags ? h('span', { class: 'mf-kind ' + f.kind, text: KIND_TAG[f.kind] || '··' }) : null,
          h('span', { class: 'mf-row-name', text: f.name }),
          !(f.calledBy || []).length ? h('span', { class: 'xe-tag', text: f.kind === 'page' ? 'not opened' : 'no callers' }) : null,
          opts.commentCount && opts.commentCount(f) ? h('span', { class: 'mf-cm', title: opts.commentCount(f) + ' comment' + (opts.commentCount(f) === 1 ? '' : 's'), text: '💬 ' + opts.commentCount(f) }) : null,
          lv.length ? h('span', { class: 'xb xb-' + lv[0].toLowerCase(), text: lv[0] }) : null
        ]);
      });
      return h('section', { class: 'mf-list', 'aria-label': cap(noun) + ' in ' + (u.module || 'no module') }, [
        h('div', { class: 'mf-list-top' }, [
          h('label', { class: 'xe-filter' }, [icon('search', 14), filter]),
          h('div', { class: 'mf-list-row' }, [
            h('label', { class: 'mf-module' }, [h('span', { class: 'mf-module-k', text: 'Module' }), modSelect, icon('caret', 14, 'mf-caret')]),
            h('button', { type: 'button', class: 'xe-sort', 'aria-label': sortTitle, title: sortTitle, onclick: function () { u.sort = u.sort === 'steps' ? 'az' : 'steps'; rerender(); } },
              [icon('sort', 14), u.sort === 'steps' ? 'Steps' : 'A–Z'])
          ]),
          h('div', { class: 'xe-segs wrap', role: 'group', 'aria-label': 'Show' }, [seg('all', 'All', inModule.length), seg('risks', 'With risks', withRisks.length), seg('callers', noun === 'pages' ? 'Not opened' : 'No callers', noCallers.length)])
        ]),
        keep(h('div', { class: 'mf-rows' }, rows.length ? rows : [h('p', { class: 'xe-empty', text: 'Nothing here matches.' })]), 'rows', u.module + '|' + (u.show || 'all') + '|' + (u.filter || ''))
      ]);
    }
    function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

    // ---------- expressions with their variables as chips ----------
    function chip(name, size) {
      var on = u.trace === name;
      return h('button', {
        type: 'button', class: 'mf-chip s' + size + (on ? ' on' : ''), title: 'Trace $' + name,
        onclick: function (e) { e.stopPropagation(); u.trace = on ? null : name; rerender(); }
      }, ['$' + name]);
    }
    function segs(text, an) {
      var out = [], last = 0, re = /\$([A-Za-z_][A-Za-z0-9_]*)/g, m;
      text = String(text === null || text === undefined ? '' : text);
      while ((m = re.exec(text))) {
        if (!an.known[m[1]]) continue;
        if (m.index > last) out.push(text.slice(last, m.index));
        out.push(chip(m[1], 20));
        last = m.index + m[0].length;
      }
      if (last < text.length) out.push(text.slice(last));
      return out;
    }

    // ---------- the trace bar (spec 02 §5.1) ----------
    // ---------- the step inspector (spec 02 §6) ----------
    function kv(rows, an) {
      var g = h('div', { class: 'mf-kv' });
      rows.forEach(function (r) {
        g.appendChild(h('span', { class: 'mf-k', text: r[0] }));
        g.appendChild(h('span', { class: 'mf-v' + (r[2] ? ' ' + r[2] : '') }, r[1] === null || r[1] === undefined ? ['[not read yet]'] : an ? segs(r[1], an) : [String(r[1])]));
      });
      return g;
    }
    function section(title, n, children) {
      return h('div', { class: 'xi-sec' }, [h('h3', { class: 'xe-caps' }, [title, n === null || n === undefined ? null : h('span', { class: 'xe-caps-n', text: ' ' + n })])].concat(children));
    }
    function firstNo(list) {
      for (var i = 0; i < (list || []).length; i++) { var b = list[i]; if (b.t === 'go') return null; if (b.no) return b.no; if (b.t === 'end') return null; }
      return null;
    }
    // The numbered steps on a way, at any depth (a decision's own ways, a loop's body, an error path).
    function stepNos(list, out) {
      (list || []).forEach(function (b) {
        if (b.no && b.t !== 'go') out.push(b.no);
        if (b.branches) b.branches.forEach(function (x) { stepNos(x.body, out); });
        if (b.body) stepNos(b.body, out);
        if (b.error) stepNos(b.error, out);
      });
      return out;
    }
    // What a way out of a decision does, in a few words. "then end" only
    // when it is one step and its end: a way that runs through several
    // steps, decisions of its own included, says which (Karol, 2026-10-13 —
    // "step 3, then end" read as if step 3 were all of it).
    function wayText(br, after) {
      var n = firstNo(br.body);
      var nos = stepNos(br.body, []);
      if (nos.length > 1) {
        var lo = Math.min.apply(null, nos), hi = Math.max.apply(null, nos);
        var lastGo = (br.body || [])[br.body.length - 1];
        var tail = lastGo && lastGo.t === 'go' && lastGo.no ? (lastGo.back ? ', then back to step ' : ', then step ') + lastGo.no : '';
        nos.sort(function (a, b) { return a - b; });
        var said = nos.length <= 4 ? 'steps ' + nos.slice(0, -1).join(', ') + ' and ' + nos[nos.length - 1]
          : hi - lo + 1 === nos.length ? 'steps ' + lo + '–' + hi : nos.length + ' steps from step ' + lo;
        return said + tail;
      }
      var parts = [];
      var last = (br.body || [])[br.body.length - 1];
      if (n) parts.push('step ' + n);
      // A way that jumps does not end there: it goes on at the step it jumps to.
      if (last && last.t === 'go') parts.push(last.no ? (last.back ? 'back to step ' : 'step ') + last.no : last.back ? 'back up' : 'continues');
      else if (br.ends) parts.push('end');
      else if (!n && after) parts.push('step ' + after);
      else if (!br.body.length) parts.push('continues');
      return parts.join(', then ') || 'continues';
    }
    function sectionsFor(b, an) {
      if (b.t === 'split') {
        var after = null;
        var ix = an.items.indexOf(an.byNo[b.no]);
        for (var i = ix + 1; i < an.items.length; i++) { if (an.items[i].path.length <= an.byNo[b.no].path.length && an.items[i].b.no) { after = an.items[i].b.no; break; } }
        return [section('Condition', null, [kv([['If', b.cond || (b.kind === 'objectTypeDecision' ? 'the object’s type' : null)]].concat(b.branches.map(function (br) {
          return [br.label === null || br.label === undefined ? 'otherwise' : br.label, wayText(br, after)];
        })), an)])];
      }
      if (b.t === 'loop') return [section('Loop', null, [kv([['Over', b.over || b.cond], ['Each', b.each]], an)])];
      var c = b.card || {}, p = c.props || {}, a = c.action || '';
      if (a === 'CreateVariableAction') return [section('Value', null, [kv([['Type', p.dataType || null], ['Value', p.value !== undefined ? p.value : c.detail]], an)])];
      if (a === 'ChangeVariableAction') return [section('Value', null, [kv([['Variable', p.object ? '$' + p.object : c.title], ['New value', p.value !== undefined ? p.value : c.detail]], an)])];
      if (a === 'RetrieveAction') {
        if (p.association) return [section('Retrieve', null, [kv([['Association', p.association], ['From', p.from ? '$' + p.from : null]], an)])];
        return [section('Retrieve', null, [kv([['Entity', p.entity || (c.ref ? null : c.title)], ['Where', p.xpath !== undefined ? (p.xpath || 'no constraint') : c.detail]], an)])];
      }
      if (c.rest) {
        // The address, taken apart: where it goes, the path, each query
        // parameter on its own line, then the whole of it as Studio Pro has it.
        var r = c.rest;
        var req = [['Method', r.method], ['Location', r.base], ['Path', r.path]].filter(function (x) { return x[1]; });
        var out = [section('Request', null, [kv(req, an)])];
        if (r.params.length) out.push(section('Query parameters', r.params.length, [kv(r.params.map(function (x) { return [x[0], x[1] || 'empty']; }), an)]));
        out.push(section('Address', null, [h('pre', { class: 'mf-code mf-url' }, segs(r.url, an))]));
        if ((c.fields || []).length) out.push(section('Arguments', null, [kv(c.fields.map(function (f) { return [f.name, f.value || 'empty']; }), an)]));
        return out;
      }
      if (/CallAction$/.test(a)) {
        var args = (c.fields || []).map(function (f) { return [f.name, f.value || 'empty']; });
        return [section('Arguments', null, [args.length ? kv(args, an) : h('p', { class: 'xe-empty', text: 'No arguments.' })])];
      }
      if (a === 'DeleteAction') return [section('Object', null, [kv([['Delete', p.object ? '$' + p.object : c.title]], an)])];
      if (a === 'CommitAction') return [section('Object', null, [kv([['Commit', p.object ? '$' + p.object : c.title], ['Events', p.withEvents ? (p.withEvents === 'Yes' ? 'with events' : 'without events') : null]], an)])];
      if (a === 'ChangeAction') return [section('Object', null, [kv([['Change', p.object ? '$' + p.object : c.title]], an)])];
      if (a === 'CreateChangeAction') return [];
      var rows = (c.rows || []).filter(function (r) { return ['Refers to', 'On error', 'State', 'Action'].indexOf(r[0]) === -1; });
      return rows.length ? [section('Details', null, [kv(rows, an)])] : [];
    }

    // A Mendix expression laid out to read: each `then` body on its own
    // indented line, each `else if` / `else` starting one — outside string
    // literals only. Nothing else is touched (Karol, 2026-10-13: a long
    // if-chain read as one wrapped block).
    function longExpr(text) { return String(text || '').length > 48 || /(^|\s)if\s/.test(String(text || '')); }
    // A value: short ones on the line, long ones as code below it.
    function valueNode(text, mark, an) {
      if (!longExpr(text)) return h('span', { class: 'mf-from' }, [h('span', null, segs(text, an)), mark ? h('span', { class: 'mf-mark', text: mark }) : null]);
      return h('div', { class: 'mf-code-wrap' }, [h('pre', { class: 'mf-code' }, segs(layoutExpr(text), an)), mark ? h('span', { class: 'mf-mark', text: mark }) : null]);
    }
    function membersList(b, an, ctx) {
      var c = b.card || {}, p = c.props || {};
      if (!(c.action === 'CreateChangeAction' || c.action === 'ChangeAction') || !c.fields) return null;
      var entity = p.entity || (p.object && an.types[p.object]) || null;
      var m = window.MxFlowTrace.members(c.fields, entity, an, ctx);
      return section('Members', m.rows.length, [h('div', { class: 'mf-box' }, m.rows.map(function (r) {
        var long = longExpr(r.value);
        var name = h('span', { class: 'mf-target' + (r.flag ? ' flagged' : ''), text: r.name });
        return h('div', { class: 'mf-mo-row' + (long ? ' long' : ''), title: r.flag ? 'Named in risk ' + r.flag.level + ': ' + r.flag.title : null }, [
          h('span', { class: 'mf-mo-left' }, [name, h('span', { class: 'mf-mo-type', text: r.type || 'type not read' })]),
          long ? valueNode(r.value, null, an) : h('span', { class: 'mf-mo-value' }, segs(r.value, an))
        ]);
      }))]);
    }

    // What a step works on, for a button that goes there: the flow it calls,
    // the entity it creates, retrieves or changes (through its variable's
    // type when the step names only the variable). Null for anything else.
    function refOf(b, an) {
      if (!b || b.t !== 'step') return null;
      var c = b.card || {}, p = c.props || {};
      if (c.ref && c.ref.qn) return { kind: c.ref.kind, qn: c.ref.qn };
      if (p.target) return { kind: /Nanoflow/.test(c.action || '') ? 'nanoflow' : 'microflow', qn: p.target };
      // Only an entity the model holds: "Refers to" on a retrieve by
      // association names the association, and a button to nothing is worse
      // than no button.
      var ents = (src.model && src.model.entities) || [];
      function entity(name) {
        var qn = String(name || '').replace(/ \(list\)$|^List of /, '');
        return ents.some(function (e) { return e.qualifiedName === qn; }) ? { kind: 'entity', qn: qn } : null;
      }
      var refRow = (c.rows || []).filter(function (r) { return r[0] === 'Refers to'; })[0];
      return entity(p.entity) || (p.object ? entity(an.types[p.object]) : null) || (refRow && c.fam !== 'call' ? entity(refRow[1]) : null);
    }
    function stepPanel(entry, an, ctx, inStudio) {
      var it = u.step ? an.byNo[u.step] : null;
      if (!it || (it.b.t !== 'step' && it.b.t !== 'split' && it.b.t !== 'loop')) {
        return h('section', { class: 'mf-panel mf-step', 'aria-label': 'Selected step', 'data-keep-scroll': placeKey(inStudio ? 'step-in' : 'step', entry.key + '|') }, [h('p', { class: 'xe-empty', text: 'Click a step in the drawing to see everything it does.' })]);
      }
      var b = it.b, c = b.card || {}, p = c.props || {};
      var tileNode = b.t === 'step' ? window.MxFlowGraph.tile(c, 36) : h('span', { class: 'mf-dec-tile', 'aria-hidden': 'true' }, [h('span', { class: 'fg-rhomb' })]);
      var kick = b.t === 'split' ? 'Decision' : b.t === 'loop' ? 'Loop' : (c.kick || '');
      var title = b.t === 'split' ? (b.title || 'Decision') : b.t === 'loop' ? (b.title || 'Loop')
        : (c.ref && c.ref.qn) || p.target || p.entity || (p.object ? '$' + p.object : null) || c.title || '';
      var refRow = (c.rows || []).filter(function (r) { return r[0] === 'Refers to'; })[0];
      var refersTo = (c.ref && c.ref.qn) || p.entity || p.target || p.association || (refRow ? refRow[1] : null);
      var refKind = c.ref && c.ref.kind ? c.ref.kind : (p.entity || p.association) ? 'entity' : null;
      var out = [
        h('div', { class: 'mf-step-head' }, [tileNode, h('div', { class: 'mf-step-titles' }, [
          h('span', { class: 'mf-step-kick' }, ['Step ', h('span', { class: 'mono', text: String(b.no) }), ' · ' + kick]),
          h('span', { class: 'mf-step-title', text: title })
        ])]),
        h('p', { class: 'mf-step-sum', text: an.stepSummary(b.no) })
      ].concat(sectionsFor(b, an));
      // The members, one list in the model's order: each member, its type, its value. In the
      // Modeler's step window the properties dialog's table beside it says this, so it is left out
      // there (Karol, 2026-10-14: "By source / Model order" and an arrow told him nothing).
      var mem = b.t === 'step' && !inStudio ? membersList(b, an, ctx) : null;
      if (mem) out.push(mem);
      if (p.out) {
        out.push(section('Output', null, [h('div', { class: 'mf-output' }, [chip(p.out, 26), h('span', { class: 'mf-out-type', text: an.types[p.out] || 'type not read' })])]));
      }
      if (b.t === 'step') {
        var props = h('div', { class: 'mf-props' }, [
          h('span', { class: 'mf-k', text: 'Refers to' }),
          refersTo && opts.openRef ? h('button', { type: 'button', class: 'mf-link', text: refersTo, onclick: function () { opts.openRef(refKind, refersTo); } }) : h('span', { text: refersTo || 'nothing' }),
          h('span', { class: 'mf-k', text: 'On error' }), h('span', { text: c.err ? 'continues on its own error path' : 'default handling' }),
          h('span', { class: 'mf-k', text: 'State' }), h('span', { text: c.off ? 'disabled — Studio Pro skips this step' : 'enabled' }),
          h('span', { class: 'mf-k', text: 'Documentation' }), h('span', { text: c.doc || 'none' })
        ]);
        out.push(section('Properties', null, [props, inStudio ? null : h('button', {
          // Only to the Modeler, the flow as Studio Pro draws it — not straight into a step's window over
          // it (Karol, 2026-10-14: a small click that opened a popup made no sense).
          type: 'button', class: 'mf-studio-link', onclick: function () { u.mode = 'modeler'; u.studio = false; rerender(); }
        }, ['Show in the Modeler', icon('arrow', 13)])]));
      }
      return h('section', { class: 'mf-panel mf-step', 'aria-label': 'Selected step', 'data-keep-scroll': placeKey(inStudio ? 'step-in' : 'step', entry.key + '|' + u.step) }, out);
    }

    // ---------- the flow as a whole (spec 02 §6.6), and what calls a flow or opens a page ----------
    function nameOf(qn, home) { return moduleOf(qn) === home ? h('span', { class: 'xi-qn', text: shortName(qn) }) : h('span', { class: 'xi-qn' }, [h('span', { class: 'xi-qn-mod', text: moduleOf(qn) + '.' }), shortName(qn)]); }
    function linkRow(kind, qn, home, cls, extra) {
      var openable = (kind === 'microflow' || kind === 'nanoflow' || kind === 'page') && qn && src.entry(kind, qn);
      // Only a flow or a page carries their icon and opens; a snippet or a scheduled event that
      // names this flow is shown for what it is, not drawn as a microflow one could open.
      var ico = kind === 'microflow' || kind === 'nanoflow' || kind === 'page' ? kind : kind === 'snippet' ? 'snippet' : 'other';
      var kids = [icon(ico, 16, cls), qn ? nameOf(qn, home) : h('span', { class: 'xi-qn', text: kind }), extra ? h('span', { class: 'xi-link-extra', text: extra }) : null];
      if (!openable) return h('div', { class: 'xi-link static' }, kids.concat([kind !== 'microflow' && kind !== 'nanoflow' && kind !== 'page' ? h('span', { class: 'xi-link-extra', text: kind }) : null]));
      return h('button', { type: 'button', class: 'xi-link', onclick: function () { opts.openFlow(kind, qn); } }, kids);
    }
    function descBlock(entry) {
      var d = src.desc(entry);
      return d && d.text ? h('div', { class: 'xi-sec tight' }, [h('p', { class: 'xi-desc', text: d.text }),
        h('p', { class: 'xi-prov', text: 'Written by an agent from the model — can be wrong where the model is ambiguous.' + (d.stale ? ' The ' + entry.kind + ' changed after it was written.' : '') })]) : null;
    }
    function riskList(risks) {
      return risks.length ? section('Risks', risks.length, risks.map(function (r) {
        return h('article', { class: 'xi-risk' }, [
          h('div', { class: 'xi-risk-head' }, [h('span', { class: 'xb xb-' + r.level.toLowerCase() + ' xi-risk-badge', text: r.level }), h('span', { class: 'xi-risk-title', text: r.title })]),
          // Who raised it, when a person did (a comment marked as a risk, Developer tools); reopened after a fix.
          r.origin === 'person' || r.status === 'reopened' ? h('p', { class: 'xi-risk-by', text: [r.origin === 'person' ? 'Raised by ' + (r.by || 'a person') : null, r.status === 'reopened' ? 'Reopened — still found after the fix' : null].filter(Boolean).join(' · ') }) : null,
          r.detail ? h('p', { class: 'xi-risk-text', text: r.detail }) : null,
          r.fix ? h('p', { class: 'xi-risk-fix' }, [h('b', { text: 'Fix · ' }), r.fix]) : null
        ]);
      })) : null;
    }
    function stats(cells) {
      return h('div', { class: 'xi-stats' }, cells.map(function (c) { return h('div', { class: 'xi-stat' }, [h('span', { class: 'xi-stat-v' + (c[2] ? ' ' + c[2] : ''), text: String(c[0]) }), h('span', { class: 'xi-stat-l', text: c[1] })]); }));
    }
    // What it takes and returns, and the data it reads and writes with the steps that do it — the two
    // things App Explorer showed that this screen did not (Karol, 2026-10-14: App Explorer goes).
    function refersOf(workflow) {
      var refers = {};
      (function walk(list) {
        (list || []).forEach(function (b) {
          if (b.t === 'step') {
            (b.card.rows || []).forEach(function (r) { if (r[0] === 'Refers to') (refers[r[1]] = refers[r[1]] || []).push({ no: b.no, fam: b.card.fam, kick: b.card.kick || '' }); });
            walk(b.error);
          }
          if (b.t === 'split') b.branches.forEach(function (x) { walk(x.body); });
          if (b.t === 'loop' || b.t === 'orphan') walk(b.body);
        });
      })(workflow);
      return refers;
    }
    function takesBlock(entry) {
      var returns = (entry.exits || []).filter(function (x) { return x.returns; })[0];
      var sig = h('div', { class: 'xi-sig' });
      entry.params.forEach(function (p) { sig.appendChild(h('span', { class: 'xi-sig-name', text: '$' + p.name })); sig.appendChild(h('span', { class: 'xi-sig-type', text: p.type })); });
      var ret = entry.returns && entry.returns !== 'Void' && entry.returns !== 'Nothing';
      if (ret) {
        sig.appendChild(h('span', { class: 'xi-sig-ret', text: 'returns' }));
        sig.appendChild(h('span', { class: 'xi-sig-ret-v' }, [entry.returns, returns ? h('span', { class: 'xi-muted', text: ' ' + returns.returns }) : null]));
      }
      return section('Takes and returns', null, [entry.params.length || ret ? sig : h('p', { class: 'xe-empty', text: 'Takes nothing and returns nothing.' })]);
    }
    function dataBlock(entry) {
      var refers = refersOf(entry.workflow);
      function chips(list, label, cls) {
        if (!list || !list.length) return [];
        return [h('span', { class: 'xi-data-label', text: label }), h('span', { class: 'xi-data-row' }, list.map(function (q) {
          var at = (refers[q] || []).map(function (s) {
            if (cls === 'reads') return s.fam === 'db' ? 'step ' + s.no : null;
            return /create/i.test(s.kick) ? 'created ' + s.no : /commit/i.test(s.kick) ? 'commit ' + s.no : /delete/i.test(s.kick) ? 'delete ' + s.no : null;
          }).filter(Boolean);
          return h('span', { class: 'xi-chip-wrap' }, [h('span', { class: 'xi-chip ' + cls }, [h('span', { class: 'xi-chip-sq' }), q]), at.length ? h('span', { class: 'xi-muted small', text: at.join(' · ') }) : null]);
        }))];
      }
      var d = chips(entry.reads, 'Reads', 'reads').concat(chips(entry.writes, 'Writes', 'writes'));
      return section('Data', null, [d.length ? h('div', { class: 'xi-data' }, d) : h('p', { class: 'xe-empty', text: 'Reads and writes no entity.' })]);
    }
    function railPanel(entry, risks) {
      var top = levels(risks)[0];
      var calls = entry.calls.filter(function (c) { return c.kind !== 'page'; }).sort(function (a, b) { return a.qn.localeCompare(b.qn); });
      var by = entry.calledBy;
      return h('section', { class: 'mf-panel mf-rail', 'aria-label': 'About this ' + entry.kind, 'data-keep-scroll': placeKey('rail', entry.key) }, [
        descBlock(entry),
        stats([[entry.steps, entry.steps === 1 ? 'step' : 'steps'], [entry.params.length, entry.params.length === 1 ? 'parameter' : 'parameters'],
          [by.length, by.length === 1 ? 'caller' : 'callers'], [risks.length, risks.length === 1 ? 'risk' : 'risks', top ? 'lv-' + top.toLowerCase() : null]]),
        // the app's own: its comments, when it has any (opts.comments; the report has none)
        opts.comments ? opts.comments(entry) : null,
        takesBlock(entry),
        section('Who can start it', null, [h('p', { class: 'xi-note' }, [icon('shield', 15), entry.roles.length
          // A flow's allowed roles are its own module's, so the module's name
          // in front of each said nothing (Karol, 2026-10-13); one from
          // elsewhere, should a model hold one, keeps its module.
          ? (entry.roles.length === 1 ? 'Module role that may start it: ' : 'Module roles that may start it: ') + entry.roles.map(function (r) { return moduleOf(r) === entry.module ? shortName(r) : r; }).join(', ') + '.'
          : 'No user role — it runs only when another flow calls it.'])]),
        h('div', { class: 'xi-sec' }, [h('h3', { class: 'xe-caps' }, ['Calls', h('span', { class: 'xe-caps-n', text: ' ' + calls.length })])]
          .concat(calls.length ? calls.map(function (c) { var n = callStep(entry.workflow, c.qn); return linkRow(c.kind, c.qn, entry.module, 'call', n ? 'step ' + n : null); }) : [h('p', { class: 'xe-empty', text: 'Calls nothing.' })])
          .concat([h('h3', { class: 'xe-caps second' }, ['Called by', h('span', { class: 'xe-caps-n', text: ' ' + by.length })])])
          .concat(by.length ? by.map(function (c) {
            var caller = c.qn ? src.entry(c.kind, c.qn) : null;
            var n = caller && caller.workflow ? callStep(caller.workflow, entry.qn) : null;
            return linkRow(c.kind, c.qn, entry.module, null, n ? 'at its step ' + n : null);
          }) : [h('p', { class: 'xe-empty', text: 'Nothing in the model calls it.' })])),
        dataBlock(entry),
        riskList(risks)
      ]);
    }

    function head(entry, buttons) {
      var path = entry.path && entry.path.length ? entry.path.join(' / ') : (entry.kind === 'page' ? 'Pages' : entry.kind === 'nanoflow' ? 'Nanoflows' : 'Microflows');
      var copy = h('button', {
        type: 'button', class: 'xe-icon-btn small', 'aria-label': 'Copy qualified name', title: 'Copy ' + entry.qn,
        onclick: function () {
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(entry.qn).then(function () { if (opts.copied) opts.copied(entry.qn); }, function () { /* the browser said no */ });
        }
      }, [icon('copy', 15)]);
      return h('div', { class: 'mf-head' }, [
        h('div', { class: 'mf-head-text' }, [
          h('div', { class: 'xi-crumb' }, [icon(entry.kind, 15), h('span', { class: 'xe-caps', text: KIND_WORD[entry.kind] || entry.kind }), h('span', { 'aria-hidden': 'true', text: '·' }), h('span', { class: 'xe-ellipsis', text: entry.module + ' / ' + path })]),
          h('div', { class: 'mf-name-row' }, [h('h2', { class: 'xi-name', text: entry.name }), copy])
        ]),
        h('div', { class: 'mf-actions' }, buttons)
      ]);
    }

    function traceBar(an) {
      var v = u.trace ? an.vars.filter(function (x) { return x.name === u.trace; })[0] : null;
      return h('div', { class: 'mf-trace' }, [
        h('div', { class: 'mf-trace-row' }, [h('span', { class: 'xe-caps', text: 'Trace' })]
          .concat(an.vars.map(function (x) { var c = chip(x.name, 24); c.setAttribute('title', x.type || 'type not read'); return c; }))
          .concat(u.trace ? [h('button', { type: 'button', class: 'mf-clear', text: 'Clear', onclick: function () { u.trace = null; rerender(); } })] : [])),
        v ? h('p', { class: 'mf-trace-sum' }, [h('span', { class: 'mf-trace-name', text: '$' + v.name }), h('span', { class: 'xi-muted', text: ' · ' + (v.type || 'type not read') + ' · ' }), an.summary(v.name)])
          : h('p', { class: 'mf-trace-sum muted', text: 'Pick a variable to see where it is set, changed and read.' })
      ]);
    }


    // ---------- a flow ----------
    // Karol, 2026-10-14: "only this drawing". The middle of the screen is the
    // flow as Studio Pro keeps it, at its full width; a click on a step opens
    // its details in a window over it — what the step does and its properties
    // dialog — and what the flow is as a whole (what it takes, who starts it,
    // what it calls, the data, the risks) is behind "About" in the header.
    // Two ways to read a flow, behind one switch in the header (Karol, 2026-10-14: "both, as a
    // switch"): Workflow, the default — the flow top to bottom as cards, the step and the flow as
    // a whole in the panel beside it — and Modeler, the flow as Studio Pro keeps it with a step's
    // window over it and the flow as a whole behind About.
    function modeSwitch() {
      var mode = u.mode === 'modeler' ? 'modeler' : 'workflow';
      return h('div', { class: 'xe-segs mf-mode', role: 'group', 'aria-label': 'View' }, [['workflow', 'Workflow'], ['modeler', 'Modeler']].map(function (x) {
        var on = mode === x[0];
        return h('button', { type: 'button', class: 'xe-seg' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', onclick: function () { u.mode = x[0]; u.studio = false; u.about = false; rerender(); } }, [x[1]]);
      }));
    }
    function context(risks) {
      return { model: src.model, risks: risks, flow: function (qn) { var x = src.entry(null, qn); return x && x.kind !== 'page' ? { returnType: x.returns } : null; } };
    }
    // What a flow does with its variables is worked out once per flow, not on
    // every click: it reads only the flow and the return types of the flows it
    // calls, and neither changes while the model is the same one.
    function analysis(entry, ctx) {
      var was = analysed.get(entry);
      if (was && was.model === src.model) return was.an;
      var an = window.MxFlowTrace.analyse(entry, ctx);
      analysed.set(entry, { model: src.model, an: an });
      return an;
    }
    function flowDetail(entry) {
      return u.mode === 'modeler' ? modelerDetail(entry) : workflowDetail(entry);
    }
    function workflowDetail(entry) {
      var risks = src.risks(entry);
      var ctx = context(risks);
      var an = analysis(entry, ctx);
      // On arriving at a flow: its first step picked, nothing traced.
      if (!u.step || !an.byNo[u.step]) {
        var first = an.items.filter(function (it) { return it.b.t === 'step'; })[0];
        u.step = first ? first.b.no : null;
      }
      if (u.trace && !an.known[u.trace]) u.trace = null;
      var tab = u.tab === 'flow' ? 'flow' : 'step';
      var buttons = [modeSwitch()].concat(opts.actions ? opts.actions(entry) : []);
      var onPick = function (no) { u.step = no; u.tab = 'step'; rerender(); };
      // The drawing is kept while it draws the same flow with the same variable
      // traced: a click on a step, the tabs beside it, the list — none of them
      // change what it shows but which step is picked, and that it changes in place.
      var kept = drawings.get(u), graph;
      if (kept && kept.entry === entry && kept.an === an && kept.trace === (u.trace || null) && window.MxFlowGraph.select(kept.node, u.step, onPick)) graph = kept.node;
      else {
        graph = window.MxFlowGraph.render(entry, { analysis: an, selected: u.step, traceVar: u.trace, onPick: onPick });
        drawings.set(u, { entry: entry, an: an, trace: u.trace || null, node: graph });
      }
      var tabs = h('div', { class: 'mf-tabs' }, [h('div', { class: 'xe-segs', role: 'group', 'aria-label': 'Details' }, [
        h('button', { type: 'button', class: 'xe-seg' + (tab === 'step' ? ' on' : ''), 'aria-pressed': tab === 'step' ? 'true' : 'false', onclick: function () { u.tab = 'step'; rerender(); } }, ['Step ' + (u.step || '')]),
        h('button', { type: 'button', class: 'xe-seg' + (tab === 'flow' ? ' on' : ''), 'aria-pressed': tab === 'flow' ? 'true' : 'false', onclick: function () { u.tab = 'flow'; rerender(); } }, [KIND_WORD[entry.kind]])
      ])]);
      var side = h('div', { class: 'mf-side tab-' + tab }, [tabs, h('div', { class: 'mf-panels' }, [stepPanel(entry, an, ctx), railPanel(entry, risks)])]);
      return h('section', { class: 'mf-detail', 'aria-label': 'Selected ' + entry.kind + ': ' + entry.name }, [
        head(entry, buttons),
        h('div', { class: 'mf-body', 'data-keep-scroll': placeKey('body', entry.key) }, [
          h('div', { class: 'mf-flow', 'aria-label': 'Flow of ' + entry.name }, [traceBar(an), keep(h('div', { class: 'mf-canvas' }, [graph]), 'canvas', entry.key)]),
          side
        ])
      ]);
    }

    function modelerDetail(entry) {
      var risks = src.risks(entry);
      var ctx = context(risks);
      var an = analysis(entry, ctx);
      if (u.step && !an.byNo[u.step]) { u.step = null; u.studio = false; }
      var open = !!(u.studio && u.step);
      var aboutBtn = h('button', { type: 'button', class: 'mf-btn mf-about-open' + (u.about ? ' on' : ''), 'aria-expanded': u.about ? 'true' : 'false',
        onclick: function () { u.about = !u.about; rerender(); } }, ['About this ' + KIND_WORD[entry.kind].toLowerCase()]);
      var buttons = [modeSwitch(), aboutBtn].concat(opts.actions ? opts.actions(entry) : []);
      var onPick = function (no) { u.step = no; u.studio = true; rerender(); };
      // Kept, as the Workflow drawing is, while it is the same flow: opening a
      // step's window, closing it, About, change only what is marked on it.
      var kept = boards.get(u), B;
      if (kept && kept.entry === entry && kept.an === an && window.MxStudioView.select(kept.B, open ? u.step : null, onPick)) B = kept.B;
      else {
        B = window.MxStudioView.board(entry, an, { selected: open ? u.step : null, qn: entry.qn, name: entry.name, inline: true, onPick: onPick });
        boards.set(u, { entry: entry, an: an, B: B });
      }
      var about = u.about ? h('aside', { class: 'mf-about', 'aria-label': 'About ' + entry.name, 'data-keep-scroll': placeKey('about', entry.key) }, [
        h('div', { class: 'mf-about-head' }, [h('span', { class: 'xe-caps', text: 'About this ' + KIND_WORD[entry.kind].toLowerCase() }),
          h('button', { type: 'button', class: 'mf-x', 'aria-label': 'Close', text: '×', onclick: function () { u.about = false; rerender(); } })]),
        railPanel(entry, risks)
      ]) : null;
      return h('section', { class: 'mf-detail', 'aria-label': 'Selected ' + entry.kind + ': ' + entry.name }, [
        head(entry, buttons),
        h('div', { class: 'mf-body board' + (about ? ' with-about' : ''), 'data-keep-scroll': placeKey('body', entry.key) }, [
          h('div', { class: 'mf-board', 'aria-label': 'Flow of ' + entry.name }, [
            keep(B.strip, 'canvas', entry.key),
            h('div', { class: 'mf-board-foot' }, [h('span', { class: 'mf-board-note', text: B.note }), B.zoomBar])
          ]),
          about
        ]),
        open ? stepWindow(entry, an, ctx) : null
      ]);
    }
    // One step's details, in a window over the drawing: what it does, as the
    // inspector said it, beside the properties dialog Studio Pro would show,
    // and a button to what it works on (an entity, a flow it calls).
    function stepWindow(entry, an, ctx) {
      var it = an.byNo[u.step], b = it ? it.b : null, target = refOf(b, an);
      var P = window.MxStudioView.properties(b, an, { model: src.model, ctx: ctx });
      function close() { u.studio = false; u.step = null; rerender(); }
      var x = h('button', { type: 'button', class: 'mf-x', 'aria-label': 'Close', text: '×', onclick: close });
      var go = target && (target.kind === 'entity' ? opts.openRef : opts.openFlow)
        ? h('button', { type: 'button', class: 'sv-go', title: 'Open ' + target.qn, onclick: function () { u.studio = false; if (target.kind === 'entity') opts.openRef('entity', target.qn); else opts.openFlow(target.kind, target.qn); } }, ['Open ' + shortName(target.qn), h('span', { 'aria-hidden': 'true', text: ' →' })])
        : null;
      var win = h('div', { class: 'mf-step-win', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Step ' + u.step + ' of ' + entry.name }, [
        h('div', { class: 'mf-step-win-head' }, [h('span', { class: 'xe-caps', text: 'Step ' + u.step + ' · ' + P.title }), go, x]),
        h('div', { class: 'mf-step-win-body', 'data-keep-scroll': placeKey('step-win', entry.key + '|' + u.step) }, [
          h('div', { class: 'mf-step-win-insp' }, [stepPanel(entry, an, ctx, true)]),
          h('div', { class: 'mf-step-win-props' }, [h('h3', { class: 'xe-caps', text: 'Properties, as in Studio Pro' }), h('div', { class: 'sv-groups' }, P.groups)])
        ])
      ]);
      var scrim = h('div', { class: 'mf-step-scrim', onclick: function (e) { if (e.target === scrim) close(); } }, [win]);
      setTimeout(function () { if (scrim.isConnected && !scrim.contains(document.activeElement)) x.focus(); }, 0);
      return scrim;
    }

    // ---------- a page (spec 14 [LUKA], Karol 2026-10-13: the spec's proposal) ----------
    // Karol, 2026-10-14: the page drawn as Studio Pro's page editor draws it
    // (pagepreview.js) is the middle of the screen, the way a flow's drawing
    // is; beside it, what was clicked on it — or, with nothing clicked, what
    // the page is, who may open it, what it takes and what opens it. A model
    // read before pages were read down to their widgets has nothing to draw:
    // the facts alone, and a line saying how to get the drawing.
    function pageFacts(entry, preview) {
      var risks = src.risks(entry), by = entry.calledBy || [];
      var rows = [['Qualified name', entry.qn, 'mono'], ['Folder', entry.path && entry.path.length ? entry.path.join(' / ') : 'the module itself'],
        ['Roles that may open it', entry.roles.length ? entry.roles.join(', ') : 'none'],
        ['Parameters', entry.params.length ? entry.params.map(function (p) { return p.name + ': ' + p.type; }).join(', ') : 'none', entry.params.length ? 'mono' : null]];
      var sum = preview && window.MxPagePreview ? window.MxPagePreview.summary(preview) : null;
      if (sum) {
        rows.push(['Layout', preview.structure.layout || 'none', 'mono']);
        if (sum.unused.length) rows.push(['Not used on the page', sum.unused.join(', '), 'mono']);
      }
      if (entry.doc) rows.push(['Documentation', entry.doc]);
      return [
        sum ? h('p', { class: 'pp-hint', text: 'Click anything on the page to see what it is, what it shows and what it does.' }) : null,
        descBlock(entry),
        sum ? stats([[sum.data, sum.data === 1 ? 'place with data' : 'places with data'], [sum.inputs, sum.inputs === 1 ? 'field' : 'fields'], [sum.buttons, sum.buttons === 1 ? 'button' : 'buttons'],
          [sum.conditional, 'shown on a condition']]) : null,
        stats([[entry.params.length, entry.params.length === 1 ? 'parameter' : 'parameters'], [by.length, 'opened from'], [entry.roles.length, entry.roles.length === 1 ? 'role' : 'roles'],
          [risks.length, risks.length === 1 ? 'risk' : 'risks', levels(risks)[0] ? 'lv-' + levels(risks)[0].toLowerCase() : null]]),
        section('Details', null, [kv(rows, null)]),
        h('div', { class: 'xi-sec' }, [h('h3', { class: 'xe-caps' }, ['Opened from', h('span', { class: 'xe-caps-n', text: ' ' + by.length })])]
          .concat(by.length ? by.map(function (c) { return linkRow(c.kind, c.qn, entry.module, null, null); }) : [h('p', { class: 'xe-empty', text: 'Nothing in the model opens this page.' })])),
        riskList(risks),
        opts.comments ? opts.comments(entry) : null
      ];
    }
    function pageDetail(entry) {
      var preview = entry.preview && entry.preview.structure && window.MxPagePreview ? entry.preview : null;
      var actions = opts.actions ? opts.actions(entry) : [];
      if (!preview) {
        return h('section', { class: 'mf-detail', 'aria-label': 'Selected page: ' + entry.name }, [
          head(entry, actions),
          h('div', { class: 'mf-page', 'data-keep-scroll': placeKey('page', entry.key) }, [h('p', { class: 'xe-empty', text: 'This model was read before MxScout drew pages. Read the project again to see the page drawn.' })]
            .concat(pageFacts(entry, null)))
        ]);
      }
      // What the drawing remembers — what is picked, which tab each tab
      // container shows, the structure outlines — kept per page, so coming
      // back to a page finds it as it was left.
      u.pv = u.pv || {};
      var st = u.pv[entry.key] || (u.pv[entry.key] = { sel: null, tab: {}, structure: false });
      var hooks = {
        rerender: rerender,
        openFlow: opts.openFlow ? function (kind, qn) { opts.openFlow(kind, qn); } : null,
        canOpen: function (kind, qn) { return !!src.entry(kind, qn); }
      };
      var picked = window.MxPagePreview.details(preview, st, hooks);
      if (!picked) st.sel = null;
      else st.about = false;
      var toggle = h('input', { type: 'checkbox', 'aria-label': 'Show structure' });
      toggle.checked = !!st.structure;
      toggle.addEventListener('change', function () { st.structure = toggle.checked; rerender(); });
      // Karol, 2026-10-14: a page needs its width as a flow does — the
      // drawing takes the whole middle, zoomed and scrolled the way the
      // Modeler's is (−, +, Fit, Ctrl and the wheel), and what the page is,
      // or what was clicked on it, opens in a window over it.
      var stage = h('div', { class: 'pp-stage' }, [window.MxPagePreview.canvas(preview, st, hooks)]);
      var zl = h('span', { class: 'sv-mono', text: '100%' });
      var strip = h('div', { class: 'pp-strip', 'aria-label': 'Page ' + entry.name }, [stage]);
      function setZoom(z) {
        st.zoom = Math.max(0.2, Math.min(2, Math.round(z * 100) / 100));
        stage.style.zoom = String(st.zoom);
        zl.textContent = Math.round(st.zoom * 100) + '%';
      }
      // The drawing's own size, whatever it is zoomed to now.
      function natural() { var r = stage.getBoundingClientRect(); return { w: r.width / st.zoom, h: r.height / st.zoom }; }
      function fit(widthOnly) {
        var r = strip.getBoundingClientRect(), n = natural();
        if (!n.w || !r.width) return;
        setZoom(Math.min(1, (r.width - 8) / n.w, widthOnly ? 1 : Math.max(0.2, (r.height - 8) / n.h)));
      }
      strip.addEventListener('wheel', function (ev) {
        if (!ev.ctrlKey && !ev.metaKey) return;
        ev.preventDefault();
        var r = strip.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top, z = st.zoom;
        var ax = (strip.scrollLeft + mx) / z, ay = (strip.scrollTop + my) / z;
        setZoom(z * Math.exp(-ev.deltaY * 0.0025));
        strip.scrollLeft = ax * st.zoom - mx; strip.scrollTop = ay * st.zoom - my;
      }, { passive: false });
      if (st.zoom) setZoom(st.zoom);
      else {
        // The first time a page is opened it is fitted to the width, never enlarged.
        st.zoom = 1;
        requestFrame(function () { if (strip.isConnected) fit(true); });
      }
      var zoomBar = h('div', { class: 'sv-zoom' }, [
        h('button', { type: 'button', 'aria-label': 'Zoom out', text: '−', onclick: function () { setZoom(st.zoom - 0.1); } }), zl,
        h('button', { type: 'button', 'aria-label': 'Zoom in', text: '+', onclick: function () { setZoom(st.zoom + 0.1); } }),
        h('button', { type: 'button', class: 'fit', text: 'Fit', onclick: function () { fit(false); } })
      ]);
      var aboutBtn = h('button', { type: 'button', class: 'mf-btn mf-about-open' + (st.about ? ' on' : ''), 'aria-expanded': st.about ? 'true' : 'false',
        onclick: function () { st.about = !st.about; st.sel = null; rerender(); } }, ['About this page']);
      var win = picked ? pageWindow('Selected on ' + entry.name, [picked], function () { st.sel = null; rerender(); }, placeKey('pp-win', entry.key + '|' + JSON.stringify(st.sel)))
        : st.about ? pageWindow('About this page', pageFacts(entry, preview), function () { st.about = false; rerender(); }, placeKey('pp-win', entry.key + '|about')) : null;
      return h('section', { class: 'mf-detail', 'aria-label': 'Selected page: ' + entry.name }, [
        head(entry, [aboutBtn].concat(actions)),
        h('div', { class: 'mf-body board', 'data-keep-scroll': placeKey('body', entry.key) }, [
          h('div', { class: 'mf-board pp-board' }, [
            keep(strip, 'canvas', entry.key),
            h('div', { class: 'mf-board-foot' }, [
              h('span', { class: 'mf-board-note', text: 'As Studio Pro draws it. Click an element for what it is; Ctrl and the wheel zoom.' }),
              h('label', { class: 'pp-structure' }, [toggle, 'Show structure']),
              zoomBar
            ])
          ])
        ]),
        win
      ]);
    }
    // A window over the drawing, as a flow's step opens in one: what the page
    // is, or the element clicked on it.
    function pageWindow(title, kids, close, place) {
      var x = h('button', { type: 'button', class: 'mf-x', 'aria-label': 'Close', text: '×', onclick: close });
      var win = h('div', { class: 'mf-step-win pp-win', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
        h('div', { class: 'mf-step-win-head' }, [h('span', { class: 'xe-caps', text: title }), x]),
        h('div', { class: 'pp-win-body', 'data-keep-scroll': place || null }, kids)
      ]);
      var scrim = h('div', { class: 'mf-step-scrim', onclick: function (e) { if (e.target === scrim) close(); } }, [win]);
      scrim.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); close(); } });
      setTimeout(function () { if (scrim.isConnected && !scrim.contains(document.activeElement)) x.focus(); }, 0);
      return scrim;
    }

    // ---------- nothing picked yet: the modules first (Karol, 2026-10-13) ----------
    // Arriving with no module and no flow, a list of one module's names picked
    // for you said nothing about where to look. The modules come first, each
    // with how many it holds and how many of those carry a risk.
    var SINGULAR = { microflows: 'microflow', nanoflows: 'nanoflow', pages: 'page' };
    function modulesOverview() {
      var noun = opts.noun || 'microflows', by = {};
      src.items.forEach(function (f) { (by[f.module] = by[f.module] || []).push(f); });
      var names = Object.keys(by).sort(function (a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); });
      var q = (u.mfilter || '').toLowerCase();
      var shown = names.filter(function (n) { return !q || n.toLowerCase().indexOf(q) !== -1; });
      var filter = h('input', { type: 'text', class: 'xe-filter-input', placeholder: 'Filter modules', value: u.mfilter || '', 'aria-label': 'Filter modules' });
      filter.addEventListener('input', function () {
        u.mfilter = filter.value;
        var caret = filter.selectionStart;
        rerender();
        var again = document.querySelector('.mf-mods-head .xe-filter-input');
        if (again) { again.focus(); try { again.setSelectionRange(caret, caret); } catch (e) { /* fine */ } }
      });
      var cards = shown.map(function (n) {
        var list = by[n], risky = list.filter(function (f) { return src.risks(f).length; });
        var lv = levels([].concat.apply([], risky.map(function (f) { return src.risks(f); })));
        return h('button', { type: 'button', class: 'mf-mod-card', onclick: function () { u.module = n; u.key = null; u.filter = ''; rerender(); } }, [
          h('span', { class: 'mf-mod-name', text: n }),
          h('span', { class: 'mf-mod-meta' }, [
            h('span', { text: list.length + ' ' + (list.length === 1 ? (SINGULAR[noun] || noun) : noun) }),
            risky.length ? h('span', { text: ' · ' + risky.length + ' with risks' }) : null
          ]),
          lv.length ? h('span', { class: 'xb xb-' + lv[0].toLowerCase(), text: lv[0] }) : null
        ]);
      });
      return h('section', { class: 'mf-mods', 'aria-label': 'Modules', 'data-keep-scroll': placeKey('mods', u.show || 'all') }, [
        h('div', { class: 'mf-mods-head' }, [
          h('div', null, [h('h2', { class: 'mf-mods-title', text: 'Pick a module' }),
            h('p', { class: 'mf-mods-sub', text: names.length + ' modules, ' + src.items.length + ' ' + noun + '.' })]),
          h('label', { class: 'xe-filter' }, [icon('search', 14), filter])
        ]),
        h('div', { class: 'mf-mods-grid' }, cards.length ? cards : [h('p', { class: 'xe-empty', text: 'No module matches.' })])
      ]);
    }
    if (!u.module && !u.key && src.items.length) return modulesOverview();

    var list = listColumn();
    var cur = u.key ? src.items.filter(function (f) { return f.key === u.key && f.module === u.module; })[0] : null;
    if (!cur) {
      // A module picked, or nothing yet: its first item, by name.
      cur = src.items.filter(function (f) { return f.module === u.module; }).sort(function (a, b) { return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); })[0] || null;
      u.key = cur ? cur.key : null; u.step = null; u.trace = null; u.studio = false;
      list = listColumn();
    }
    return h('div', { class: 'mf-grid' }, [
      list,
      cur ? (cur.kind === 'page' ? pageDetail(cur) : flowDetail(cur)) : h('section', { class: 'mf-detail' }, [h('p', { class: 'xe-empty pad', text: opts.empty || 'Nothing to show.' })])
    ]);
  }

  function layoutExpr(src) {
    var str = String(src || ''), out = '', i = 0;
    while (i < str.length) {
      var q = str.indexOf("'", i);
      var plain = q === -1 ? str.slice(i) : str.slice(i, q);
      out += plain.replace(/\s+then\s+/g, ' then\n  ').replace(/\s+else\s+if\s+/g, '\nelse if ').replace(/\s+else\s+(?!if\s)/g, '\nelse\n  ');
      if (q === -1) break;
      var e = q + 1;
      while (e < str.length) { if (str.charAt(e) === "'") { if (str.charAt(e + 1) === "'") { e += 2; continue; } break; } e++; }
      out += str.slice(q, e + 1);
      i = e + 1;
    }
    return out;
  }

  window.MxFlowView = { screen: screen, levels: levels, layoutExpr: layoutExpr };
})();
