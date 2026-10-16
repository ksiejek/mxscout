/* MxScout — a page drawn the way Studio Pro's page editor draws it (Karol,
 * 2026-10-14: "more visual, what it looks like; only clicking shows what is
 * inside"). Not a pixel copy: the layout as a frame (a pop-up window, or a
 * page with a header and a menu), and every widget as what it is — a text
 * box as a labelled field with the attribute's name in grey, a drop-down with
 * its arrow, a button as a button, tabs that switch, columns side by side, a
 * list as its item and two faded repeats. A data container wears a chip with
 * its entity, a snippet a dotted outline, a widget shown only on a condition
 * a small amber eye. Nothing code-like is on the drawing — no XPath, no
 * qualified name, no $parameter: those are in the details of what you click,
 * in plain words first and under "For developers" as the model says them.
 *
 * It draws the `structure` mpr.js reads for each page (readPageStructure),
 * as docs-data.js's pageEntry carries it in `entry.preview`, so the app's
 * Pages screen and the exported documentation draw the same thing; it
 * travels inside the exported file beside flowview.js, which places it. It
 * reaches nothing of the app's. Every piece of model text is set as text.
 *
 *   MxPagePreview.canvas(preview, st, hooks)   the drawing, with "Show structure"
 *   MxPagePreview.details(preview, st, hooks)  what the picked element is, or null
 *   MxPagePreview.summary(preview)             counts, for the page's own facts
 *     st      its state, kept by the caller: { sel, tab: {}, structure }
 *     hooks   { rerender(), openFlow(kind, qn), canOpen(kind, qn) }
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
  // Line icons: fixed paths of this file, never model data.
  var PATHS = {
    cal: 'M3 6h18M7 3v4M17 3v4M4 5h16v15H4z', chev: 'M6 9l6 6 6-6',
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13', pencil: 'M4 20l4-1 11-11-3-3L5 16l-1 4z',
    down: 'M12 4v11M7 10l5 5 5-5M5 20h14', open: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
    bolt: 'M13 3L5 14h6l-1 7 8-11h-6l1-7z', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z',
    image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4', user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c1-4 4-6 8-6s7 2 8 6',
    plus: 'M12 5v14M5 12h14', back: 'M19 12H5M11 6l-6 6 6 6', check: 'M5 12l5 5 9-10', x: 'M6 6l12 12M18 6L6 18',
    mail: 'M3 6h18v12H3zM3 7l9 6 9-6', refresh: 'M20 11a8 8 0 10-2 5.5M20 4v7h-7', link: 'M10 14a4 4 0 006 0l3-3a4 4 0 00-6-6l-1 1M14 10a4 4 0 00-6 0l-3 3a4 4 0 006 6l1-1',
    search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5', dot: 'M12 12m-3 0a3 3 0 106 0 3 3 0 10-6 0'
  };
  function icon(name) {
    var s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS(SVG_NS, 'path'); p.setAttribute('d', PATHS[name] || PATHS.dot); s.appendChild(p);
    return s;
  }

  // ---------- words ----------
  function last(qn) { var p = String(qn || '').split('.'); return p[p.length - 1]; }
  function words(name) {
    return String(name || '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim()
      .replace(/^./, function (c) { return c.toUpperCase(); });
  }
  function lower(s) { return String(s).replace(/^./, function (c) { return c.toLowerCase(); }); }
  function entName(qn) { return words(last(qn)); }
  function attrName(qn) { return words(last(qn)); }
  function ownerOf(attr) { return String(attr || '').split('.').slice(0, 2).join('.'); }

  var DATA = { dataview: 'Data view', listview: 'List view', datagrid: 'Data grid', gallery: 'Gallery', datalist: 'List' };

  // ---------- one pass over a copy: ids, parents, the object each widget works on ----------
  // On a copy, so the entry the caller holds is never given parent links.
  var prepared = typeof WeakMap === 'function' ? new WeakMap() : null;
  function prepare(preview) {
    var hit = prepared && prepared.get(preview);
    if (hit) return hit;
    var P = { preview: preview, byId: {}, order: [], names: {}, regions: [], counts: { data: 0, input: 0, button: 0, cond: 0, starts: 0 } };
    var seq = 0, starts = {};
    var snippetText = JSON.stringify(preview.snippets || {});
    function walk(n, parent, ctx) {
      n._id = 'pw' + (++seq); P.byId[n._id] = n; n._parent = parent; n._ctx = ctx; P.order.push(n);
      if (n.name) P.names[n.name] = n;
      if (DATA[n.kind]) P.counts.data++; else if (n.kind === 'input') P.counts.input++; else if (n.kind === 'button') P.counts.button++;
      if (n.visible) P.counts.cond++;
      (n.actions || []).forEach(function (a) { if (a.flow || a.page) starts[a.flow || a.page] = true; });
      var inner = DATA[n.kind] ? { entity: (n.source && n.source.entity) || null, node: n } : ctx;
      (n.widgets || []).forEach(function (c) { walk(c, n, inner); });
      (n.footer || []).forEach(function (c) { walk(c, n, inner); });
      if (n.kind === 'snippet' && n.snippet && (preview.snippets || {})[n.snippet]) {
        var sn = JSON.parse(snippetText)[n.snippet];
        n._inner = [];
        (sn.structure.regions || []).forEach(function (r) { (r.widgets || []).forEach(function (w) { n._inner.push(w); walk(w, n, inner); }); });
      }
    }
    P.regions = JSON.parse(JSON.stringify(preview.structure.regions || []));
    P.regions.forEach(function (r) { walk(r, null, null); });
    P.counts.starts = Object.keys(starts).length;
    if (prepared) prepared.set(preview, P);
    return P;
  }

  // ---------- drawing ----------
  // The drawing is kept with the state it was drawn for, and handed back while
  // only the pick changed: a click on an element draws the screen again, and a
  // large page is thousands of nodes that did not change — only the outline
  // moves to what was clicked. Another tab, the structure outlines or another
  // page draw it anew. The last few pages are kept, not every page visited.
  var drawn = [], KEEP_DRAWN = 4;
  function canvas(preview, st, hooks) {
    st.tab = st.tab || {};
    var sig = (st.structure ? 's' : '') + JSON.stringify(st.tab);
    var was = null;
    for (var i = 0; i < drawn.length; i++) if (drawn[i].st === st) { was = drawn[i]; drawn.splice(i, 1); break; }
    if (was && was.preview === preview && was.sig === sig) {
      drawn.unshift(was);
      was.live.hooks = hooks;
      Array.prototype.forEach.call(was.root.querySelectorAll('.pp-sel, .pp-hov'), function (n) { n.classList.remove('pp-sel'); n.classList.remove('pp-hov'); });
      if (st.sel) Array.prototype.forEach.call(was.root.querySelectorAll('[data-pp]'), function (n) { if (n.getAttribute('data-pp') === st.sel) n.classList.add('pp-sel'); });
      return was.root;
    }
    var root = draw0(preview, st, hooks);
    drawn.unshift({ st: st, preview: preview, sig: sig, root: root.node, live: root.live });
    drawn.length = Math.min(drawn.length, KEEP_DRAWN);
    return root.node;
  }
  function draw0(preview, st, hooks0) {
    // What the drawing's own clicks call: the hooks of the latest draw that handed it out.
    var live = { hooks: hooks0 };
    var P = prepare(preview), S = preview.structure;
    // g: a faded repeat of a list's item — drawn, but not something to click.
    function wrap(n, el, kindLabel, g) {
      if (g) return el;
      el.classList.add('pp-w');
      el.setAttribute('data-pp', n._id);
      el.setAttribute('data-kind', kindLabel);
      if (n._id === st.sel) el.classList.add('pp-sel');
      if (n.visible) el.appendChild(h('span', { class: 'pp-cmark', title: 'Shown only on a condition' }, [icon('eye')]));
      return el;
    }
    function list(nodes, g) {
      var out = [], btns = [];
      function flush() { if (btns.length) { out.push(h('div', { class: 'pp-btnrow' }, btns)); btns = []; } }
      (nodes || []).forEach(function (n) {
        if (n.kind === 'button') { btns.push(button(n, g)); return; }
        flush();
        var r = draw(n, g);
        if (r) out.push(r);
      });
      flush();
      return out;
    }
    function draw(n, g) {
      var k = n.kind;
      if (k === 'input') return input(n, g);
      if (k === 'text') return text(n, g);
      if (k === 'dataview') return dataview(n, g);
      if (k === 'listview' || k === 'gallery' || k === 'datalist') return listish(n, g);
      if (k === 'datagrid') return datagrid(n, g);
      if (k === 'tabs') return tabs(n, g);
      if (k === 'grid') return grid(n, g);
      if (k === 'snippet') return snippet(n, g);
      if (k === 'image') return wrap(n, h('div', { class: 'pp-img' + (n.type === 'StaticImageViewer' ? ' static' : '') }, [icon(n.type === 'StaticImageViewer' ? 'image' : 'user')]), 'Image', g);
      if (k === 'container' || k === 'slot' || k === 'other') return container(n, g);
      if (k === 'button') return h('div', { class: 'pp-btnrow' }, [button(n, g)]);
      return wrap(n, h('span', { class: 'pp-plug', text: words(n.type || 'Widget') }), words(n.type || 'Widget'), g);
    }
    function container(n, g) {
      var kids = list(n.widgets, g);
      var slots = (n.widgets || []).filter(function (c) { return c.kind === 'slot'; });
      if (slots.length > 1) {
        // A pluggable container with named areas — a tooltip: what you point at, and what pops up.
        kids = [h('div', { class: 'pp-stack' }, list(slots[0].widgets, g))];
        slots.slice(1).forEach(function (s) {
          kids.push(h('div', { class: 'pp-callout' }, [h('span', { class: 'pp-callout-tag', text: words(s.type) }), h('div', { class: 'pp-stack' }, list(s.widgets, g))]));
        });
      }
      var click = (n.actions || []).some(function (a) { return a.on === 'click'; });
      return wrap(n, h('div', { class: 'pp-cont pp-stack' + (click ? ' clickable' : ''), 'data-name': n.name || '' }, kids), n.type === 'DivContainer' ? 'Container' : words(n.type || 'Container'), g);
    }
    function grid(n, g) {
      var rows = (n.widgets || []).map(function (r) {
        return h('div', { class: 'pp-row' }, (r.widgets || []).map(function (c) {
          var col = h('div', { class: 'pp-col' }, [h('div', { class: 'pp-stack' }, list(c.widgets, g))]);
          if (c.weight > 0) col.style.flexGrow = String(c.weight);
          return col;
        }));
      });
      return wrap(n, h('div', { class: 'pp-grid pp-stack', 'data-name': n.name || '' }, rows), n.type === 'Table' ? 'Table' : 'Layout grid', g);
    }
    function input(n, g) {
      var t = String(n.type || '');
      var a = n.attribute ? (preview.attributes || {})[n.attribute] : null;
      var field;
      if (/radio/i.test(t)) {
        var opts = a && a.values ? a.values.slice(0, 4) : (a && a.type === 'Boolean' ? ['Yes', 'No'] : ['Option', 'Option']);
        if (a && a.values && a.values.length > 4) opts.push('…');
        field = h('div', { class: 'pp-radios' }, opts.map(function (o) { return h('span', { class: 'pp-radio' }, [h('i'), o]); }));
      } else if (/check/i.test(t)) {
        field = h('div', { class: 'pp-check' }, [h('i')]);
      } else {
        var glyph = /date/i.test(t) ? icon('cal') : /combo|drop|select|reference/i.test(t) ? icon('chev') : null;
        var ph = n.attribute ? attrName(n.attribute) : n.entity ? entName(n.entity) : '';
        field = h('div', { class: 'pp-ctl' + (/area/i.test(t) ? ' area' : '') }, [h('span', { class: 'pp-ph', text: ph }), glyph ? h('span', { class: 'pp-gl' }, [glyph]) : null]);
      }
      return wrap(n, h('div', { class: 'pp-fld' + (n.caption ? '' : ' nolabel') + (n.readOnly ? ' ro' : '') }, [n.caption ? h('div', { class: 'pp-lbl', text: n.caption }) : null, field]), t || 'Input', g);
    }
    function button(n, g) {
      var look = buttonLook(n);
      var kids = [];
      if (look.icon) kids.push(icon(look.icon));
      if (n.caption) kids.push(n.caption);
      return wrap(n, h('span', { class: 'pp-btn ' + look.cls + (n.caption ? '' : ' icon') }, kids), n.link ? 'Link button' : 'Button', g);
    }
    function text(n, g) {
      var t = n.caption || '', parts = [], re = /\{([^}]*)\}/g, at = 0, m;
      while ((m = re.exec(t))) {
        if (m.index > at) parts.push(t.slice(at, m.index));
        parts.push(h('span', { class: 'pp-tok', text: words(m[1]) }));
        at = re.lastIndex;
      }
      if (at < t.length) parts.push(t.slice(at));
      var big = n.type === 'Title';
      return wrap(n, h('div', { class: big ? 'pp-ttl' : 'pp-txt' }, parts), big ? 'Title' : 'Text', g);
    }
    function chip(n, label) {
      var e = n.source && n.source.entity, info = e ? (preview.entities || {})[e] : null;
      return h('span', { class: 'pp-echip' + (info && info.stored === false ? ' np' : '') + (label ? ' list' : ''), text: (label ? label + ' · ' : '') + (e ? entName(e) : 'Object') });
    }
    function dataview(n, g) {
      var el = h('div', { class: 'pp-dv pp-stack' }, [chip(n)].concat(list(n.widgets, g)));
      if (n.footer && n.footer.length) el.appendChild(h('div', { class: 'pp-dv-foot' }, n.footer.map(function (b) { return b.kind === 'button' ? button(b, g) : draw(b, g); })));
      return wrap(n, el, 'Data view', g);
    }
    function listish(n, g) {
      var items = [h('div', { class: 'pp-item pp-stack' }, list(n.widgets, g))];
      if (!g) for (var i = 0; i < 2; i++) items.push(h('div', { class: 'pp-item pp-stack pp-ghost', 'aria-hidden': 'true' }, list(n.widgets, true)));
      return wrap(n, h('div', { class: 'pp-lst' }, [chip(n, n.kind === 'gallery' ? 'Gallery' : 'List')].concat(items)), DATA[n.kind] || 'List', g);
    }
    function datagrid(n, g) {
      var cols = (n.widgets || []).filter(function (c) { return c.kind === 'item'; });
      var head = h('tr', null, cols.map(function (c) { return h('th', { text: c.caption || '' }); }));
      var rows = [0, 1, 2].map(function (r) {
        return h('tr', null, cols.map(function (c, i) { return h('td', null, [h('span', { class: 'pp-bar', style: 'width:' + (40 + ((i * 23 + r * 17) % 50)) + '%' })]); }));
      });
      var extra = list((n.widgets || []).filter(function (c) { return c.kind !== 'item'; }), g);
      return wrap(n, h('div', { class: 'pp-lst pp-stack' }, [chip(n, 'Grid')].concat(extra, [h('table', { class: 'pp-tbl' }, [h('thead', null, [head]), h('tbody', null, rows)])])), 'Data grid', g);
    }
    function tabs(n, g) {
      var pages = n.widgets || [];
      var sel = Math.min(st.tab[n._id] || 0, Math.max(0, pages.length - 1));
      var strip = h('div', { class: 'pp-tabstrip', role: g ? null : 'tablist' }, pages.map(function (t, i) {
        var on = i === sel;
        var tab = h(g ? 'span' : 'button', { type: g ? null : 'button', class: 'pp-tab' + (on ? ' on' : ''), role: g ? null : 'tab', 'aria-selected': g ? null : (on ? 'true' : 'false'),
          title: t.visible ? 'Shown only on a condition' : null }, [t.caption || 'Tab', t.visible ? h('span', { class: 'pp-tdot' }) : null]);
        if (!g) tab.addEventListener('click', function (ev) { ev.stopPropagation(); st.tab[n._id] = i; live.hooks.rerender(); });
        return tab;
      }));
      var cur = pages[sel];
      return wrap(n, h('div', { class: 'pp-tabs' }, [strip, h('div', { class: 'pp-tabpane pp-stack' }, cur ? list(cur.widgets, g) : [])]), 'Tab container', g);
    }
    function snippet(n, g) {
      var inner = n._inner ? list(n._inner, g) : [h('span', { class: 'pp-plug', text: 'Snippet' })];
      return wrap(n, h('div', { class: 'pp-snip pp-stack' }, [h('span', { class: 'pp-schip', text: 'snippet · ' + words(last(n.snippet)) })].concat(inner)), 'Snippet', g);
    }

    var regions = P.regions.map(function (r) { return h('div', { class: 'pp-stack' }, list(r.widgets)); });
    var title = S.title || '';
    var frame = /popup/i.test(S.layout || '')
      ? h('div', { class: 'pp-popup', style: 'width:' + (S.popupWidth || 800) + 'px' }, [
        h('div', { class: 'pp-popup-title' }, [h('span', { text: title }), h('span', { class: 'pp-x', 'aria-hidden': 'true', text: '×' })]),
        h('div', { class: 'pp-popup-body pp-stack' }, regions)])
      // A full page: what its layout puts around it is not on the page, so it is only named, in a quiet
      // strip, as Studio Pro greys it (Karol, 2026-10-14: a dark bar there meant nothing and looked wrong).
      : h('div', { class: 'pp-pageframe' }, [
        h('div', { class: 'pp-pf-head' }, [h('span', { class: 'pp-pf-layout', text: S.layout ? 'Layout · ' + words(last(S.layout)) : 'Layout' })]),
        h('div', { class: 'pp-pf-body pp-stack' }, (title ? [h('div', { class: 'pp-ttl', text: title })] : []).concat(regions))]);
    var root = h('div', { class: 'pp' + (st.structure ? ' pp-struct' : ''), 'aria-label': 'The page, drawn' }, [frame]);
    function target(ev) { var t = ev.target.closest ? ev.target.closest('[data-pp]') : null; return t && root.contains(t) ? t : null; }
    root.addEventListener('mouseover', function (ev) {
      var t = target(ev), old = root.querySelector('.pp-hov');
      if (old && old !== t) old.classList.remove('pp-hov');
      if (t) t.classList.add('pp-hov');
    });
    root.addEventListener('mouseleave', function () { var old = root.querySelector('.pp-hov'); if (old) old.classList.remove('pp-hov'); });
    root.addEventListener('click', function (ev) {
      var t = target(ev);
      st.sel = t ? t.getAttribute('data-pp') : null;
      live.hooks.rerender();
    });
    return { node: root, live: live };
  }
  // Studio Pro's own button style and icon when the model says (mpr.js reads
  // both); what it does decides only when the model is silent.
  var GLYPHS = { '2b': 'plus', 'e020': 'trash', '270f': 'pencil', 'e065': 'pencil', 'e025': 'down', 'e026': 'down', 'e014': 'x', 'e013': 'check', 'e031': 'refresh', 'e003': 'search', 'e105': 'eye', 'e079': 'back', 'e091': 'back' };
  var ICON_WORDS = [[/trash|delete|remove/i, 'trash'], [/edit|pencil/i, 'pencil'], [/new|add|plus/i, 'plus'], [/back|left/i, 'back'], [/save|check|ok/i, 'check'],
    [/cancel|close/i, 'x'], [/down/i, 'down'], [/view|eye/i, 'eye'], [/mail/i, 'mail'], [/refresh|sync/i, 'refresh'], [/link/i, 'link'], [/search|find/i, 'search']];
  var STYLE_CLASS = { Primary: 'primary', Success: 'success', Danger: 'danger', Warning: 'warning', Info: 'info', Inverse: 'inverse' };
  function buttonLook(n) {
    var a = (n.actions || [])[0] || {};
    var cls = n.link ? 'link' : STYLE_CLASS[n.style] || (n.style === undefined && a.kind === 'save' ? 'primary' : '');
    var ic = null;
    if (n.icon) {
      if (n.icon.indexOf('glyph:') === 0) ic = GLYPHS[n.icon.slice(6)] || 'dot';
      else ICON_WORDS.some(function (w) { if (w[0].test(n.icon)) { ic = w[1]; return true; } return false; });
      if (!ic) ic = 'dot';
    } else if (!n.caption) {
      // No caption and no icon in the model: a mark from what it does, so there is something to click.
      var target = String(a.flow || a.page || '');
      ic = a.kind === 'delete' || /delete/i.test(target) ? 'trash' : a.kind === 'create' ? 'plus' : /download/i.test(target) ? 'down' : /edit/i.test(target) ? 'pencil' : a.kind === 'page' ? 'open' : 'bolt';
    }
    return { cls: cls, icon: ic };
  }

  // ---------- the details of what was clicked ----------
  function details(preview, st, hooks) {
    var P = prepare(preview), n = st.sel ? P.byId[st.sel] : null;
    if (!n) return null;
    var dl = [], dev = [];
    function row(dt, dd) { if (dd) dl.push(h('dt', { text: dt }), h('dd', null, Array.isArray(dd) ? dd : [dd])); }
    function devRow(k, v) { if (v) dev.push(h('span', { text: k }), h('code', { text: v })); }
    function entPill(qn) { var info = (preview.entities || {})[qn]; return qn ? h('span', { class: 'pp-pill ent' + (info && info.stored === false ? ' np' : ''), text: entName(qn) }) : null; }
    var outer = n._ctx && n._ctx.entity ? entName(n._ctx.entity) : null;
    if (n.kind === 'input') {
      var a = n.attribute ? (preview.attributes || {})[n.attribute] : null;
      row('Shows', n.attribute && n.path && n.path.length ? attrName(n.attribute) + ' of the ' + lower(entName(ownerOf(n.attribute))) + ' it is linked to'
        : n.attribute ? attrName(n.attribute) + ' of the ' + lower(entName(ownerOf(n.attribute)))
          : n.path && n.path.length ? 'Which ' + lower(entName(n.entity)) + ' this ' + lower(outer || 'object') + ' is linked to' : 'Nothing it is bound to');
      if (a) row('Value', a.values ? 'One of: ' + a.values.join(', ') : words(a.type));
      row('Editable', n.readOnly ? 'No — it only shows the value' : n.editableIf ? 'Only under a condition' : 'Yes');
      devRow('Attribute', n.attribute); devRow('Association', (n.path || []).join(' / '));
      devRow('Options from', n.options ? (n.options.entity || n.options.kind) + (n.options.xpath ? ' ' + n.options.xpath : '') : null);
    }
    if (DATA[n.kind]) {
      var s = n.source || {}, e = s.entity ? entName(s.entity) : 'object', many = n.kind !== 'dataview';
      var said = s.kind === 'parameter' ? 'The ' + e + ' this page is opened with.'
        : s.kind === 'database' ? (many ? (s.xpath ? e + ' records from the database, filtered.' : 'Every ' + e + ' in the database.') : 'One ' + e + ' from the database.')
          : s.kind === 'association' ? (many ? 'The ' + e + ' records' : 'The ' + e) + ' linked to the ' + (outer || 'surrounding object') + '.'
            : s.kind === 'microflow' || s.kind === 'nanoflow' ? 'Whatever the ' + s.kind + ' “' + words(last(s.flow)) + '” returns.'
              : s.kind === 'listen' ? 'The ' + e + ' picked in the ' + lower((P.names[s.widget] && DATA[P.names[s.widget].kind]) || 'list') + ' beside it.'
                : s.kind === 'context' ? 'The ' + (outer || e) + ' around it.' : e + '.';
      row('Shows', [entPill(s.entity), h('span', { class: 'pp-sub', text: said })]);
      if (s.flow) row('Data from', flowLink(s.kind, s.flow));
      if (n.readOnly) row('Editable', 'No');
      devRow('Source', s.kind); devRow('Entity', s.entity); devRow('Parameter', s.param ? '$' + s.param : null);
      devRow('Association', (s.path || []).join(' / ')); devRow('XPath', s.xpath); devRow('Flow', s.flow); devRow('Listens to', s.widget);
    }
    (n.actions || []).forEach(function (act) {
      var kids = [h('span', { text: actionWords(act, outer) })];
      if (act.flow || act.page) kids.unshift(flowLink(act.flow ? act.kind : 'page', act.flow || act.page));
      if (act.args) kids.push(h('span', { class: 'pp-sub', text: 'Also hands over — ' + act.args.map(argWords).join('; ') }));
      if (act.confirm) kids.push(h('span', { class: 'pp-sub', text: 'Asks first: “' + (typeof act.confirm === 'string' ? act.confirm : 'Are you sure?') + '”' }));
      row(act.on === 'change' ? 'On change' : 'On click', kids);
      devRow(words(act.kind), act.flow || act.page || act.entity);
      (act.args || []).forEach(function (x) { devRow('Argument', x.name + ' = ' + x.value); });
    });
    if (n.kind === 'button') {
      row('Looks', (n.link ? 'A link' : n.style ? words(n.style) + ' button' : 'Default button') + (n.icon ? ', with an icon' : ''));
      if (!n.icon && !n.caption) dl.push(h('dt', { text: '' }), h('dd', null, [h('span', { class: 'pp-sub', text: 'No caption or icon in the model; the mark drawn here is a guess from what it does.' })]));
    }
    if (n.kind === 'text' && n.caption) row('Says', n.caption.replace(/\{([^}]*)\}/g, function (m, x) { return '‹' + words(x) + '›'; }));
    if (n.kind === 'snippet') {
      var sn = (preview.snippets || {})[n.snippet];
      row('What', 'A reusable piece placed here; the same snippet can sit on other pages.');
      if (sn && sn.parameters && sn.parameters.length) row('Needs', sn.parameters.map(function (p) { return entPill(p.type); }));
      devRow('Snippet', n.snippet);
    }
    if (n.kind === 'tab' || n.kind === 'tabs' || n.kind === 'container' || n.kind === 'grid') {
      var c = { d: 0, i: 0, b: 0 };
      (function walk(x) { (x.widgets || []).concat(x.footer || [], x._inner || []).forEach(function (k) { if (DATA[k.kind]) c.d++; else if (k.kind === 'input') c.i++; else if (k.kind === 'button') c.b++; walk(k); }); })(n);
      var bits = [];
      if (c.i) bits.push(c.i + (c.i === 1 ? ' field' : ' fields'));
      if (c.d) bits.push(c.d + (c.d === 1 ? ' place that shows data' : ' places that show data'));
      if (c.b) bits.push(c.b + (c.b === 1 ? ' button' : ' buttons'));
      row('Holds', bits.length ? bits.join(', ') : 'Text and layout only');
    }
    if (n.kind === 'tabs') row('Tabs', (n.widgets || []).map(function (t) { return t.caption; }).join(', '));
    if (n.visible) {
      row('Visible', h('span', { class: 'pp-pill cond', text: condWords(n.visible) }));
      devRow('Visible if', n.visible.expression || (n.visible.attribute ? (n.visible.of ? n.visible.of + '/' : '') + n.visible.attribute + ' in [' + (n.visible.values || []).join(', ') + ']' : null));
      devRow('Roles', n.visible.roles ? n.visible.roles.join(', ') : null);
    } else row('Visible', 'Always');
    if (n.editableIf) devRow('Editable if', n.editableIf.expression || n.editableIf.attribute || null);
    row('Where', where(n));
    devRow('Widget name', n.name); devRow('Widget type', n.type);
    function flowLink(kind, qn) {
      var cls = kind === 'microflow' ? 'mf' : kind === 'nanoflow' ? 'nf' : 'pg';
      var label = words(last(qn));
      if (hooks.openFlow && (!hooks.canOpen || hooks.canOpen(kind, qn))) {
        return h('button', { type: 'button', class: 'pp-pill ' + cls + ' pp-go', title: 'Open ' + qn, onclick: function () { hooks.openFlow(kind, qn); } }, ['Open ' + label, h('span', { 'aria-hidden': 'true', text: ' →' })]);
      }
      return h('span', { class: 'pp-pill ' + cls, text: label });
    }
    return h('div', { class: 'pp-detail' }, [
      h('button', { type: 'button', class: 'pp-back', text: '← The whole page', onclick: function () { st.sel = null; hooks.rerender(); } }),
      h('div', { class: 'pp-kind', text: kindLabel(n) }),
      h('h3', { class: 'pp-title', text: titleOf(n) }),
      h('dl', { class: 'pp-dl' }, dl),
      dev.length ? h('details', { class: 'pp-dev' }, [h('summary', { text: 'For developers' }), h('div', { class: 'pp-dev-grid' }, dev)]) : null
    ]);
  }
  function actionWords(a, outer) {
    if (a.kind === 'microflow' || a.kind === 'nanoflow') return 'Runs the ' + a.kind + ' “' + words(last(a.flow)) + '”.';
    if (a.kind === 'page') return 'Opens the page “' + words(last(a.page)) + '”.';
    if (a.kind === 'create') return 'Creates a new ' + entName(a.entity) + (a.page ? ' and opens “' + words(last(a.page)) + '”' : '') + '.';
    if (a.kind === 'save') return 'Saves the changes' + (a.closes ? ' and closes the page' : '') + '.';
    if (a.kind === 'cancel') return 'Throws the changes away' + (a.closes ? ' and closes the page' : '') + '.';
    if (a.kind === 'close') return 'Closes the page.';
    if (a.kind === 'delete') return 'Deletes this ' + (outer || 'object') + (a.closes ? ' and closes the page' : '') + '.';
    return words(a.kind) + '.';
  }
  function argWords(x) {
    var v = x.value;
    if (v === '$currentObject') return words(x.name) + ': the object it sits in';
    if (/^\$\w+$/.test(v)) return words(x.name) + ': the page’s ' + words(v.slice(1));
    return words(x.name) + ': a value worked out from an expression';
  }
  function condWords(v) {
    var bits = [];
    if (v.attribute) bits.push('when ' + lower(attrName(v.attribute)) + ' is ' + (v.values && v.values.length ? v.values.map(words).join(' or ') : 'not set'));
    if (v.expression) bits.push('when a condition written by the developer holds');
    if (v.roles) bits.push('for ' + v.roles.map(function (r) { return words(last(r)); }).join(', '));
    return 'Only ' + bits.join(', and ');
  }
  function where(n) {
    var bits = [];
    for (var p = n._parent; p; p = p._parent) {
      if (p.kind === 'tab') bits.unshift('tab “' + p.caption + '”');
      else if (DATA[p.kind]) bits.unshift(lower(DATA[p.kind]) + ' of ' + (p.source && p.source.entity ? entName(p.source.entity) : 'object'));
      else if (p.kind === 'snippet') bits.unshift('snippet “' + words(last(p.snippet)) + '”');
    }
    return bits.length ? 'In the ' + bits.join(' › ') : 'Directly on the page';
  }
  function kindLabel(n) {
    if (n.kind === 'input') return n.type || 'Input';
    if (n.kind === 'button') return n.link ? 'Link button' : 'Button';
    if (n.kind === 'text') return 'Text';
    if (DATA[n.kind]) return DATA[n.kind];
    if (n.kind === 'tabs') return 'Tab container';
    if (n.kind === 'tab') return 'Tab';
    if (n.kind === 'grid') return 'Layout grid';
    if (n.kind === 'snippet') return 'Snippet';
    if (n.kind === 'image') return 'Image';
    if (n.kind === 'container') return n.type === 'DivContainer' ? 'Container' : words(n.type);
    return words(n.type || n.kind);
  }
  function titleOf(n) {
    if (n.caption) return n.caption;
    if (DATA[n.kind]) return n.source && n.source.entity ? entName(n.source.entity) : DATA[n.kind];
    if (n.kind === 'snippet') return words(last(n.snippet));
    if (n.kind === 'button') return 'Button without a caption';
    return kindLabel(n);
  }

  function summary(preview) {
    var P = prepare(preview);
    return { data: P.counts.data, inputs: P.counts.input, buttons: P.counts.button, conditional: P.counts.cond, starts: P.counts.starts,
      widgets: preview.structure.widgets || P.order.length, popup: /popup/i.test(preview.structure.layout || ''),
      unused: preview.structure.unusedParameters || [] };
  }

  window.MxPagePreview = { canvas: canvas, details: details, summary: summary };
})();
