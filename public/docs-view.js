/* MxScout — documentation, the reader.
 *
 * Draws what docs-data.js builds: a portal in the layout of the mendix-docs
 * skill (rail of sections, a list beside it, the page on the right; light and
 * dark), with every microflow and nanoflow as a WORKFLOW — cards from top to
 * bottom, a decision's branches side by side, loops as frames, error handling
 * to the side, and everything a step says in a card on hover.
 *
 * It has to run in two places: inside MxScout, and inside the exported file,
 * on a machine that has never seen MxScout. So the whole reader is ONE
 * function with no outside references — the export carries its source text
 * (factory.toString()) next to the encrypted data, and MxScout calls the same
 * function. One reader means the file shows exactly what the app showed.
 *
 * It builds its DOM with createElement and textContent only: the text it
 * shows comes from a model, and none of it can become markup.
 */
(function () {
  'use strict';

  function factory() {
    var doc = document;

    function h(tag, attrs, kids) {
      var n = doc.createElement(tag);
      if (attrs) Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'text') n.textContent = v;
        else if (k === 'class') n.className = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v === true ? '' : String(v));
      });
      add(n, kids);
      return n;
    }
    function add(n, kids) {
      if (kids === null || kids === undefined || kids === false) return n;
      if (!Array.isArray(kids)) kids = [kids];
      kids.forEach(function (c) {
        if (c === null || c === undefined || c === false) return;
        if (Array.isArray(c)) add(n, c);
        else n.appendChild(typeof c === 'string' || typeof c === 'number' ? doc.createTextNode(String(c)) : c);
      });
      return n;
    }
    function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
    function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
    function shortName(qn) { return String(qn || '').split('.').pop(); }
    function badgeOf(f) {
      if (f.kind === 'page') return 'PG';
      if (f.kind === 'nanoflow') return 'NF';
      var p = String(f.name).split('_')[0];
      return /^[A-Z]{2,5}$/.test(p) ? p : 'MF';
    }

    var FAM_ICON = { db: '⛁', obj: '✎', save: '✔', call: 'ƒ', ext: '⇄', ui: '▭', msg: '!', var: 'x', act: '•' };
    var LEGEND = [['if', 'decision'], ['db', 'reads data'], ['obj', 'create / change'], ['save', 'commit / delete'], ['call', 'call (click to open)'],
      ['ui', 'page / file'], ['msg', 'message / log'], ['ext', 'outside the app'], ['loop', 'loop']];
    var CASE = { 'true': 'true', 'false': 'false', error: 'on error', '(empty)': 'empty' };

    // ---------------------------------------------------------------- mount
    function mount(data, host, opts) {
      opts = opts || {};
      var st = { view: 'start', module: null, seg: 'microflow', key: null, entity: null, q: '' };
      if (opts.state) Object.keys(opts.state).forEach(function (k) { st[k] = opts.state[k]; });
      if (opts.hash) readHash();
      var theme = opts.theme || 'auto';
      try { theme = localStorage.getItem('mxdocs-theme') || theme; } catch (e) { /* storage may be blocked */ }

      var root = h('div', { class: 'dx' });
      var titleEl = h('h1'), subEl = h('div', { class: 'dx-sub' });
      var search = h('input', { type: 'search', class: 'dx-search', placeholder: 'Search the documentation…', 'aria-label': 'Search the documentation' });
      var results = h('div', { class: 'dx-results', hidden: true });
      var themeBtns = {};
      var themeBox = h('div', { class: 'dx-theme', role: 'group', 'aria-label': 'Theme' }, [['light', '☀'], ['dark', '☾'], ['auto', 'Auto']].map(function (t) {
        themeBtns[t[0]] = h('button', { type: 'button', text: t[1], title: t[0] === 'auto' ? 'Follow the system' : t[0].charAt(0).toUpperCase() + t[0].slice(1), onclick: function () { setTheme(t[0]); } });
        return themeBtns[t[0]];
      }));
      var top = h('header', { class: 'dx-top' }, [
        h('div', { class: 'dx-logo' }, [h('i')]),
        h('div', { class: 'dx-title' }, [titleEl, subEl]),
        h('div', { class: 'dx-searchbox' }, [search, results]),
        h('div', { class: 'dx-stamp', text: 'Generated from the model · ' + fmtDate(data.generatedAt) }),
        opts.encrypted ? h('div', { class: 'dx-lock', text: '🔒 Encrypted' }) : null,
        themeBox,
        opts.actions ? h('div', { class: 'dx-actions' }, opts.actions) : null
      ]);
      var RAIL = [['start', '⌂', 'Start'], ['modules', '▦', 'Modules'], ['refs', '❐', 'References'], ['domain', '⬡', 'Domain'], ['quality', '✓', 'Quality']];
      var railBtns = {};
      var rail = h('nav', { class: 'dx-rail', 'aria-label': 'Sections' }, RAIL.map(function (r) {
        railBtns[r[0]] = h('button', { type: 'button', onclick: function () { go({ view: r[0] }); } }, [h('i', { text: r[1] }), r[2]]);
        return railBtns[r[0]];
      }));
      var list = h('aside', { class: 'dx-list' });
      var main = h('main', { class: 'dx-main' });
      var body = h('div', { class: 'dx-body' }, [rail, list, main]);
      add(root, [top, body]);
      clear(host).appendChild(root);

      function setTheme(t) {
        theme = t;
        try { localStorage.setItem('mxdocs-theme', t); } catch (e) { /* fine */ }
        var dark = t === 'dark' || (t === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
        root.setAttribute('data-theme', dark ? 'dark' : 'light');
        Object.keys(themeBtns).forEach(function (k) { themeBtns[k].classList.toggle('on', k === t); });
      }
      setTheme(theme);

      // ---------- navigation ----------
      function go(patch) {
        Object.keys(patch).forEach(function (k) { st[k] = patch[k]; });
        if (opts.hash) writeHash();
        if (opts.onState) opts.onState(st);
        draw();
        main.scrollTop = 0;
      }
      function openKey(key) {
        var f = data.flows[key];
        if (!f) return false;
        go({ view: 'refs', module: f.module, seg: f.kind, key: key });
        return true;
      }
      function readHash() {
        var m = /^#\/(\w+)(?:\/(.*))?$/.exec(location.hash || '');
        if (!m) return;
        st.view = m[1];
        var arg = m[2] ? decodeURIComponent(m[2]) : null;
        if (st.view === 'refs' && arg && data.flows[arg]) { st.key = arg; st.module = data.flows[arg].module; st.seg = data.flows[arg].kind; }
        if (st.view === 'domain' && arg) st.entity = arg;
        if (st.view === 'modules' && arg) st.module = arg;
      }
      function writeHash() {
        var arg = st.view === 'refs' ? st.key : st.view === 'domain' ? st.entity : st.view === 'modules' ? st.module : null;
        var h2 = '#/' + st.view + (arg ? '/' + encodeURIComponent(arg) : '');
        if (location.hash !== h2) history.replaceState(null, '', h2);
      }
      if (opts.hash) window.addEventListener('hashchange', function () { readHash(); draw(); });

      // ---------- search ----------
      var index = [];
      Object.keys(data.flows).forEach(function (k) { var f = data.flows[k]; index.push({ key: k, kind: f.kind, name: f.name, module: f.module, l: f.name.toLowerCase() }); });
      Object.keys(data.entities).forEach(function (q) { var e = data.entities[q]; index.push({ entity: q, kind: 'entity', name: e.name, module: e.module, l: e.name.toLowerCase() }); });
      search.addEventListener('input', function () {
        var q = search.value.trim().toLowerCase();
        clear(results);
        if (!q) { results.hidden = true; return; }
        var hits = index.filter(function (x) { return x.l.indexOf(q) !== -1 || (x.module + '.' + x.l).toLowerCase().indexOf(q) !== -1; })
          .sort(function (a, b) { return (a.l.indexOf(q) === 0 ? 0 : 1) - (b.l.indexOf(q) === 0 ? 0 : 1) || a.l.localeCompare(b.l); }).slice(0, 30);
        results.hidden = false;
        if (!hits.length) { results.appendChild(h('div', { class: 'dx-r-empty', text: 'Nothing named like that.' })); return; }
        hits.forEach(function (x) {
          results.appendChild(h('button', { type: 'button', class: 'dx-r', onclick: function () {
            results.hidden = true; search.value = '';
            if (x.entity) go({ view: 'domain', entity: x.entity }); else openKey(x.key);
          } }, [h('span', { class: 'dx-kind dx-k-' + x.kind, text: x.kind === 'entity' ? 'E' : x.kind === 'page' ? 'PG' : x.kind === 'nanoflow' ? 'NF' : 'MF' }),
            h('b', { text: x.name }), h('small', { text: x.module })]));
        });
      });
      doc.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K') && root.isConnected) { e.preventDefault(); search.focus(); }
        if (e.key === 'Escape') results.hidden = true;
      });

      // ---------- drawing ----------
      function draw() {
        Object.keys(railBtns).forEach(function (k) { railBtns[k].classList.toggle('on', k === st.view); });
        clear(list); clear(main);
        root.classList.toggle('no-list', st.view === 'start' || st.view === 'quality');
        var V = { start: drawStart, modules: drawModules, refs: drawRefs, domain: drawDomain, quality: drawQuality }[st.view] || drawStart;
        V();
      }
      function setTitle(t, sub) { titleEl.textContent = t; subEl.textContent = sub; }
      function crumbs(parts) {
        return h('div', { class: 'dx-crumbs' }, parts.map(function (p, i) {
          var last = i === parts.length - 1;
          return [i ? h('span', { class: 'dx-sep', text: '›' }) : null, last || !p[1] ? h('b', { text: p[0] }) : h('button', { type: 'button', class: 'dx-link', text: p[0], onclick: p[1] })];
        }));
      }
      function tile(n, label, sub) { return h('div', { class: 'dx-card dx-kpi' }, [h('b', { text: String(n) }), h('span', { text: label }), sub ? h('small', { text: sub }) : null]); }

      function drawStart() {
        var k = data.kpi;
        setTitle(data.project, 'Documentation · ' + plural(k.modules, 'module', 'modules') + ' · ' + plural(k.microflows, 'microflow', 'microflows') + ' · ' + plural(k.nanoflows, 'nanoflow', 'nanoflows'));
        main.appendChild(h('div', { class: 'dx-hero' }, [
          h('div', { class: 'dx-hero-k', text: 'Documentation portal' }),
          h('h2', { text: data.project }),
          h('p', { text: 'Everything here is read from the Mendix model' + (data.app ? ' of ' + data.app : '') + ': every module, microflow, nanoflow, page and entity, who may use them, what calls what, and where the model looks unfinished. Rebuilt each time the model is loaded.' }),
          h('div', { class: 'dx-hero-tags' }, [data.mendix ? h('span', { text: 'Mendix ' + data.mendix }) : null, h('span', { text: 'state ' + String(data.generatedAt).slice(0, 10) }), h('span', { text: 'Ctrl K — search everything' })])
        ]));
        main.appendChild(h('div', { class: 'dx-kpis' }, [
          tile(k.modules, 'own modules', k.marketplace ? '+ ' + k.marketplace + ' from the Marketplace' : null),
          tile(k.microflows, 'microflows'), tile(k.nanoflows, 'nanoflows'), tile(k.pages, 'pages'),
          tile(k.entities, 'entities'), tile(k.roles, 'user roles'),
          tile(k.scheduled, 'scheduled events', k.scheduled ? k.scheduledOn + ' of ' + k.scheduled + ' enabled' : null),
          tile(k.services, 'published services')
        ]));
        var q = data.quality;
        var cards = [
          ['❐', 'References', 'Every microflow, nanoflow and page — what it takes, returns and calls, who may run it, and its workflow.', function () { go({ view: 'refs' }); }],
          ['⬡', 'Domain model', 'Each entity with its attributes, and the entities that point to it and that it points to.', function () { go({ view: 'domain' }); }],
          ['✓', 'Model quality', plural(q.unreached.length, 'element nothing reaches', 'elements nothing reaches') + ' · ' + plural(q.noAccess.length, 'entity without access rules', 'entities without access rules') + '.', function () { go({ view: 'quality' }); }],
          ['▦', 'Modules', 'What each module holds, own modules first, Marketplace modules after.', function () { go({ view: 'modules' }); }]
        ];
        main.appendChild(h('h3', { class: 'dx-h', text: 'Where to start' }));
        main.appendChild(h('div', { class: 'dx-cards' }, cards.map(function (c) {
          return h('button', { type: 'button', class: 'dx-card dx-start', onclick: c[3] }, [h('i', { text: c[0] }), h('b', { text: c[1] }), h('span', { text: c[2] })]);
        })));
        if (!data.drawings) main.appendChild(h('div', { class: 'dx-note', text: 'This model was imported as JSON and carries no drawings, so the workflows are not shown. Load the model from the Mendix project folder to see them.' }));
      }

      function moduleList(onPick, current) {
        list.appendChild(h('div', { class: 'dx-list-head' }, [h('h2', null, ['Modules', h('small', { text: String(data.modules.length) })])]));
        data.modules.forEach(function (m) {
          var n = m.microflows.length + m.nanoflows.length;
          list.appendChild(h('button', { type: 'button', class: 'dx-item' + (current === m.name ? ' on' : ''), onclick: function () { onPick(m.name); } }, [
            h('span', { class: 'dx-badge' + (m.marketplace ? ' mk' : ''), text: m.marketplace ? 'MP' : 'MOD' }),
            h('span', { class: 'dx-item-t' }, [h('b', { text: m.name }), h('small', { text: plural(n, 'flow', 'flows') + ' · ' + plural(m.pages.length, 'page', 'pages') + ' · ' + plural(m.entities.length, 'entity', 'entities') })])
          ]));
        });
      }

      function drawModules() {
        var name = st.module || (data.modules[0] && data.modules[0].name);
        moduleList(function (n) { go({ module: n }); }, name);
        var m = data.modules.filter(function (x) { return x.name === name; })[0];
        setTitle('Modules', data.project + ' · ' + plural(data.modules.length, 'module', 'modules'));
        if (!m) return;
        main.appendChild(crumbs([['Start', function () { go({ view: 'start' }); }], ['Modules'], [m.name]]));
        main.appendChild(h('div', { class: 'dx-card dx-head' }, [h('span', { class: 'dx-badge big' + (m.marketplace ? ' mk' : ''), text: m.marketplace ? 'MP' : 'MOD' }),
          h('div', null, [h('h2', { class: 'mono', text: m.name }), h('p', { text: m.marketplace ? 'Marketplace module' : 'Own module' })])]));
        main.appendChild(h('div', { class: 'dx-kpis four' }, [tile(m.microflows.length, 'microflows'), tile(m.nanoflows.length, 'nanoflows'), tile(m.pages.length, 'pages'), tile(m.entities.length, 'entities')]));
        [['Microflows', m.microflows], ['Nanoflows', m.nanoflows], ['Pages', m.pages]].forEach(function (sec) {
          if (!sec[1].length) return;
          main.appendChild(h('h3', { class: 'dx-h', text: sec[0] + ' (' + sec[1].length + ')' }));
          main.appendChild(h('div', { class: 'dx-chips' }, sec[1].map(function (k) {
            var f = data.flows[k];
            return h('button', { type: 'button', class: 'dx-chip', onclick: function () { openKey(k); } }, [h('span', { class: 'dx-badge', text: badgeOf(f) }), f.name]);
          })));
        });
        if (m.entities.length) {
          main.appendChild(h('h3', { class: 'dx-h', text: 'Entities (' + m.entities.length + ')' }));
          main.appendChild(h('div', { class: 'dx-chips' }, m.entities.map(function (q) {
            return h('button', { type: 'button', class: 'dx-chip', onclick: function () { go({ view: 'domain', entity: q }); } }, [h('span', { class: 'dx-badge', text: 'E' }), shortName(q)]);
          })));
        }
      }

      // ---------- references ----------
      function drawRefs() {
        var mods = data.modules.filter(function (m) { return m.microflows.length + m.nanoflows.length + m.pages.length; });
        var name = st.module || (mods[0] && mods[0].name);
        var m = data.modules.filter(function (x) { return x.name === name; })[0] || mods[0];
        if (!m) { setTitle('References', data.project); main.appendChild(h('div', { class: 'dx-note', text: 'This model has no microflows, nanoflows or pages.' })); return; }
        var seg = st.seg || 'microflow';
        var keys = seg === 'nanoflow' ? m.nanoflows : seg === 'page' ? m.pages : m.microflows;
        if (!keys.length) { seg = m.microflows.length ? 'microflow' : m.nanoflows.length ? 'nanoflow' : 'page'; keys = seg === 'nanoflow' ? m.nanoflows : seg === 'page' ? m.pages : m.microflows; }
        var key = st.key && data.flows[st.key] && data.flows[st.key].module === m.name ? st.key : keys[0];
        setTitle('References', data.project + ' · ' + m.name);

        // the list
        var filter = h('input', { type: 'search', class: 'dx-filter', placeholder: 'Filter by name, e.g. ACT_, SUB_…', value: st.q || '' });
        var items = h('div', { class: 'dx-items' });
        list.appendChild(h('div', { class: 'dx-list-head' }, [
          h('h2', null, [m.name, h('small', { text: (m.microflows.length + m.nanoflows.length + m.pages.length) + ' in module' })]),
          filter,
          h('div', { class: 'dx-mods' }, mods.map(function (x) {
            return h('button', { type: 'button', class: 'dx-pill' + (x.name === m.name ? ' on' : ''), onclick: function () { go({ module: x.name, key: null, q: '' }); } },
              [x.name, h('i', { text: String(x.microflows.length + x.nanoflows.length + x.pages.length) })]);
          }))
        ]));
        list.appendChild(h('div', { class: 'dx-seg' }, [['microflow', 'Microflows', m.microflows], ['nanoflow', 'Nanoflows', m.nanoflows], ['page', 'Pages', m.pages]].map(function (s) {
          return h('button', { type: 'button', class: s[0] === seg ? 'on' : '', onclick: function () { go({ seg: s[0], key: null }); } }, [s[1], h('i', { text: String(s[2].length) })]);
        })));
        list.appendChild(items);
        function fill() {
          clear(items);
          var q = filter.value.trim().toLowerCase();
          keys.forEach(function (k) {
            var f = data.flows[k];
            if (q && f.name.toLowerCase().indexOf(q) === -1) return;
            items.appendChild(h('button', { type: 'button', class: 'dx-item' + (k === key ? ' on' : ''), onclick: function () { go({ key: k }); } }, [
              h('span', { class: 'dx-badge' + (f.kind === 'nanoflow' ? ' nf' : f.kind === 'page' ? ' pg' : ''), text: badgeOf(f) }),
              h('span', { class: 'dx-item-t' }, [h('b', { class: 'mono', text: f.name }), h('small', { text: (f.roles.length ? f.roles.map(shortName).join(', ') : '–') })]),
              f.kind === 'page' ? null : h('span', { class: 'dx-num', title: 'steps', text: String(f.steps || 0) }),
              h('span', { class: 'dx-num', title: 'called by', text: String(f.calledBy.length) })
            ]));
          });
          if (!items.firstChild) items.appendChild(h('div', { class: 'dx-r-empty', text: 'Nothing matches.' }));
        }
        filter.addEventListener('input', function () { st.q = filter.value; fill(); });
        fill();
        if (key) drawFocus(data.flows[key]);
      }

      function drawFocus(f) {
        main.appendChild(crumbs([['Start', function () { go({ view: 'start' }); }], ['References', function () { go({ view: 'refs', key: null }); }], [f.module, function () { go({ view: 'refs', module: f.module, key: null }); }], [f.name]]));
        var kindWord = f.kind === 'page' ? 'page' : f.kind;
        main.appendChild(h('div', { class: 'dx-card dx-head' }, [
          h('span', { class: 'dx-badge big' + (f.kind === 'nanoflow' ? ' nf' : f.kind === 'page' ? ' pg' : ''), text: badgeOf(f) }),
          h('div', null, [h('h2', { class: 'mono', text: f.name }), h('p', { text: f.module + ' · ' + kindWord + (f.kind === 'page' ? '' : ' · ' + plural(f.steps || 0, 'step', 'steps') + ' · ' + plural(f.calls.length, 'call', 'calls')) + (f.path && f.path.length ? ' · ' + f.path.join(' / ') : '') })]),
          h('div', { class: 'dx-roles' }, [h('span', { class: 'mod', text: f.module })]
            .concat(f.roles.map(function (r) { return h('span', { text: shortName(r) }); }))
            .concat(opts.openInModel ? [h('button', { type: 'button', class: 'dx-btn', text: 'Open in MxScout', title: 'Its window in MxScout, with the Studio Pro drawing', onclick: function () { opts.openInModel(f.kind, f.qn); } })] : []))
        ]));
        if (f.doc) main.appendChild(h('div', { class: 'dx-note doc', text: f.doc }));
        var foreign = f.calls.filter(function (c) { return c.qn.split('.')[0] !== f.module; }).length;
        main.appendChild(h('div', { class: 'dx-kpis four' }, f.kind === 'page'
          ? [tile(f.params.length, 'parameters'), tile(f.calledBy.length, 'opened from'), tile(f.roles.length || '–', 'roles with access', f.roles.map(shortName).join(', ')), tile(f.path && f.path.length ? f.path.length : 0, 'folder levels')]
          : [tile(f.steps || 0, 'steps'), tile(f.calls.length, 'calls', foreign ? foreign + ' into another module' : null), tile(f.calledBy.length, 'called by', summarizeCallers(f.calledBy)),
            tile(f.roles.length || '–', 'roles', f.roles.map(shortName).join(', '))]));

        var panel = h('div', { class: 'dx-panel' });
        var TABS = f.kind === 'page'
          ? [['details', 'Details'], ['by', 'Opened from', f.calledBy.length]]
          : [['wf', 'Workflow'], ['calls', 'Calls', f.calls.length], ['by', 'Called by', f.calledBy.length], ['details', 'Details']];
        var cur = TABS[0][0];
        var tabBtns = {};
        var tabs = h('div', { class: 'dx-tabs', role: 'tablist' }, TABS.map(function (t) {
          tabBtns[t[0]] = h('button', { type: 'button', role: 'tab', onclick: function () { show(t[0]); } }, [t[1], t[2] !== undefined ? h('i', { text: String(t[2]) }) : null]);
          return tabBtns[t[0]];
        }));
        main.appendChild(h('div', { class: 'dx-card dx-tabcard' }, [tabs, panel]));
        function show(k) {
          cur = k;
          Object.keys(tabBtns).forEach(function (x) { tabBtns[x].classList.toggle('on', x === k); tabBtns[x].setAttribute('aria-selected', x === k ? 'true' : 'false'); });
          clear(panel);
          if (k !== 'by' && k !== 'calls') panel.appendChild(paramsRow(f));
          if (k === 'wf') panel.appendChild(workflowView(f));
          if (k === 'calls') panel.appendChild(refList(f.calls, 'This ' + f.kind + ' calls nothing else and opens no page.'));
          if (k === 'by') panel.appendChild(refList(f.calledBy, f.kind === 'page' ? 'Nothing in the model opens this page.' : 'Nothing in the model calls this ' + f.kind + '.' + (f.roles.length ? ' Its roles can still run it from the app.' : '')));
          if (k === 'details') panel.appendChild(details(f));
        }
        show(cur);
      }
      function summarizeCallers(by) {
        var c = {};
        by.forEach(function (x) { c[x.kind] = (c[x.kind] || 0) + 1; });
        return Object.keys(c).map(function (k) { return c[k] + ' ' + k + (c[k] === 1 ? '' : 's'); }).join(', ') || null;
      }
      function paramsRow(f) {
        return h('div', { class: 'dx-params' }, [
          h('div', null, [h('small', { text: 'PARAMETERS' }), h('span', { class: 'mono', text: f.params.length ? f.params.map(function (p) { return p.name + ' : ' + p.type; }).join(', ') : '–' })]),
          f.kind === 'page' ? null : h('div', null, [h('small', { text: 'RETURNS' }), h('span', { class: 'mono', text: f.returns || '–' })]),
          h('div', null, [h('small', { text: 'ROLES' }), h('span', { text: f.roles.length ? f.roles.map(shortName).join(', ') : '–' })])
        ]);
      }
      function refList(refs, empty) {
        if (!refs.length) return h('div', { class: 'dx-note', text: empty });
        return h('div', { class: 'dx-xl' }, refs.map(function (r) {
          var key = (r.kind === 'microflow' || r.kind === 'nanoflow' || r.kind === 'page') ? r.kind + ':' + r.qn : null;
          var here = key && data.flows[key];
          return h(here ? 'button' : 'div', { type: here ? 'button' : null, class: 'dx-xl-row' + (here ? ' link' : ''), onclick: here ? function () { openKey(key); } : null }, [
            h('span', { class: 'dx-badge' + (r.kind === 'nanoflow' ? ' nf' : r.kind === 'page' ? ' pg' : ''), text: r.kind === 'page' ? 'PG' : r.kind === 'nanoflow' ? 'NF' : r.kind === 'microflow' ? 'MF' : String(r.kind || '').slice(0, 3).toUpperCase() }),
            h('b', { class: 'mono', text: r.qn }), h('small', { text: r.kind + (here ? ' ↗' : '') })]);
        }));
      }
      function details(f) {
        var rows = [['Qualified name', f.qn], ['Kind', f.kind], ['Folder', f.path && f.path.length ? f.path.join(' / ') : '–']];
        if (f.kind === 'microflow') rows.push(['Entity access', f.entityAccess ? 'applied — the caller’s access rules hold' : 'not applied — reads and writes past the access rules']);
        if (f.reads && f.reads.length) rows.push(['Reads', f.reads.join(', ')]);
        if (f.writes && f.writes.length) rows.push(['Writes', f.writes.join(', ')]);
        return h('dl', { class: 'dx-dl' }, rows.map(function (r) { return [h('dt', { text: r[0] }), h('dd', { text: r[1] })]; }));
      }

      // ---------- the workflow ----------
      function workflowView(f) {
        if (!f.workflow) return h('div', { class: 'dx-note', text: 'No drawing for this ' + f.kind + ' in the model — it was imported as JSON, or the flow is empty.' });
        var pop = h('div', { class: 'wfx-pop', hidden: true });
        var canvas = h('div', { class: 'wfx-canvas' }, [h('div', { class: 'wfx' }, seqNodes(f.workflow, f)), pop]);
        var big = h('button', { type: 'button', class: 'dx-btn', text: '⤢ Enlarge', onclick: function () {
          var on = !canvas.classList.contains('full');
          canvas.classList.toggle('full', on);
          big.textContent = on ? '✕ Close' : '⤢ Enlarge';
          big.classList.toggle('over', on);
        } });
        var head = h('div', { class: 'wfh' }, [
          h('span', { text: 'What happens — step by step, top to bottom. A decision’s branches run side by side, ↻ frames are loops, the dashed red arrow is error handling; hover a step for everything it says.' }),
          h('span', { class: 'leg' }, LEGEND.map(function (x) { return h('i', { class: 'wk-' + x[0], text: x[1] }); })),
          big
        ]);
        canvas.addEventListener('mouseover', function (e) {
          var el = e.target.closest ? e.target.closest('[data-pop]') : null;
          if (!el || !canvas.contains(el)) { pop.hidden = true; return; }
          clear(pop); pop.appendChild(el._pop()); pop.hidden = false;
          var rc = canvas.getBoundingClientRect(), re = el.getBoundingClientRect(), w = pop.offsetWidth, hh = pop.offsetHeight;
          var sl = canvas.scrollLeft, stp = canvas.scrollTop, x, y;
          if (re.right + w + 24 <= rc.right) { x = re.right - rc.left + sl + 14; y = re.top - rc.top + stp - 8; }
          else if (re.left - w - 24 >= rc.left) { x = re.left - rc.left + sl - w - 14; y = re.top - rc.top + stp - 8; }
          else {
            x = Math.min(Math.max(sl + 6, re.left - rc.left + sl), sl + canvas.clientWidth - w - 6);
            y = re.bottom - rc.top + stp + 10;
            if (re.bottom + hh + 16 > rc.bottom && re.top - hh - 16 >= rc.top) y = re.top - rc.top + stp - hh - 10;
          }
          pop.style.left = x + 'px'; pop.style.top = Math.max(stp + 6, y) + 'px';
        });
        canvas.addEventListener('mouseleave', function () { pop.hidden = true; });
        doc.addEventListener('keydown', function (e) { if (e.key === 'Escape' && canvas.classList.contains('full')) big.click(); });
        return h('div', { class: 'wf-wrap' }, [head, canvas]);
      }
      function link() { return h('div', { class: 'wfx-link' }); }
      function caseTag(l) {
        if (l === null || l === undefined || l === '') return null;
        return h('span', { class: 'wfx-case' + (l === 'true' ? ' yes' : l === 'false' ? ' no' : l === 'error' ? ' err' : ''), title: String(l), text: CASE[l] || String(l) });
      }
      function popRows(title, kick, rows, extra) {
        return function () {
          return h('div', null, [h('div', { class: 'k', text: kick }), title ? h('div', { class: 't', text: title }) : null,
            rows.length ? h('dl', null, rows.map(function (r) { return [h('dt', { text: r[0] }), h('dd', { class: /^(Detail|Value|Refers to|Condition|Returns)$/.test(r[0]) ? 'mono' : null, text: r[1] })]; })) : null,
            extra || null]);
        };
      }
      function seqNodes(list, f) {
        var out = [];
        list.forEach(function (b, i) {
          if (i) out.push(link());
          if (b.t === 'start') {
            out.push(h('div', { class: 'wfx-term start' }, [h('i', { text: '▶' }), 'Start', f.params.length ? h('small', { text: f.params.map(function (p) { return p.name + ' : ' + p.type; }).join(', ') }) : null]));
          } else if (b.t === 'end') {
            out.push(h('div', { class: 'wfx-term ' + (b.kind === 'errorEvent' ? 'err' : 'end') }, [h('i', { text: b.kind === 'errorEvent' ? '!' : b.kind === 'continue' ? '↻' : '■' }), b.label, b.returns ? h('small', { text: 'returns ' + b.returns }) : null]));
          } else if (b.t === 'go') {
            out.push(h('div', { class: 'wfx-go', text: '↪ continues at step ' + (b.no || '?') }));
          } else if (b.t === 'orphan') {
            out.push(h('div', { class: 'wfx-orphan', text: 'Separate path' }));
            out = out.concat(seqNodes(b.body, f));
          } else if (b.t === 'loop') {
            out.push(h('div', { class: 'wfx-loop' }, [
              h('div', { class: 'wfx-loop-head' }, b.cond !== null && b.cond !== undefined
                ? ['↻ While ', h('span', { class: 'mono', text: b.cond || 'condition holds' })]
                : ['↻ For each ', h('span', { class: 'mono', text: b.each || 'item' }), ' in ', h('span', { class: 'mono', text: b.over || 'list' }), b.title ? ' · ' + b.title : '']),
              h('div', { class: 'wfx-seq' }, b.body.length ? seqNodes(b.body, f) : [h('div', { class: 'wfx-go', text: 'empty loop' })])
            ]));
          } else if (b.t === 'split') {
            var dec = h('div', { class: 'wfx-dec', 'data-pop': '1' }, [h('span', { class: 'dia' }, [h('b', { text: '?' })]),
              h('div', null, [h('div', { class: 't', text: b.title }), b.cond ? h('div', { class: 'd mono', text: b.cond }) : null])]);
            dec._pop = popRows(b.title, b.kind === 'decision' ? 'Decision · step ' + b.no : 'Object type decision · step ' + b.no,
              [b.cond ? ['Condition', b.cond] : null, ['Branches', b.branches.map(function (x) { return CASE[x.label] || x.label || '–'; }).join(', ')]].filter(Boolean),
              b.doc ? h('div', { class: 'doc', text: b.doc }) : null);
            var going = b.branches.map(function (x, k) { return x.ends ? -1 : k; }).filter(function (k) { return k >= 0; });
            var lo = going.length ? Math.min.apply(null, going) : -1, hi = going.length ? Math.max.apply(null, going) : -1;
            out.push(dec);
            out.push(h('div', { class: 'wfx-stub' }));
            out.push(h('div', { class: 'wfx-split' }, b.branches.map(function (x, k) {
              var bar = !b.after ? '' : k === lo && k === hi ? ' j-one' : k === lo ? ' j-first' : k === hi ? ' j-last' : (k > lo && k < hi ? ' j-mid' : '');
              return h('div', { class: 'wfx-branch' + bar }, [caseTag(x.label),
                h('div', { class: 'wfx-seq' }, x.body.length ? seqNodes(x.body, f) : [h('div', { class: 'wfx-pass' })]),
                bar ? h('i', { class: 'wfx-jb' }) : null]);
            })));
            if (b.after) out.push(h('div', { class: 'wfx-stub' }));
          } else if (b.t === 'step') {
            var c = b.card;
            var target = c.ref ? c.ref.kind + ':' + c.ref.qn : null;
            var opens = target && data.flows[target];
            var node = h('div', { class: 'wfx-step wk-' + c.fam + (c.off ? ' off' : '') + (opens ? ' link' : ''), 'data-pop': '1', tabindex: opens ? '0' : null, role: opens ? 'link' : null,
              onclick: opens ? function () { openKey(target); } : null, onkeydown: opens ? function (e) { if (e.key === 'Enter') openKey(target); } : null }, [
              h('span', { class: 'ic', text: FAM_ICON[c.fam] || '•' }),
              h('div', { class: 'tx' }, [h('div', { class: 'k' }, [c.kick, h('span', { class: 'no', text: String(b.no) })]), h('div', { class: 't', text: c.title }),
                c.detail ? h('div', { class: 'd', text: c.detail }) : null,
                c.err ? h('span', { class: 'tag', text: 'custom error handling' }) : null, c.off ? h('span', { class: 'tag', text: 'disabled' }) : null])
            ]);
            node._pop = popRows(c.title, c.kick + ' · step ' + b.no, c.rows, [c.doc ? h('div', { class: 'doc', text: c.doc }) : null,
              opens ? h('div', { class: 'go', text: 'Click to open ' + shortName(c.ref.qn) + ' →' }) : (c.ref ? h('div', { class: 'go dim', text: c.ref.qn + ' is not in this documentation' }) : null)]);
            if (b.error) {
              out.push(h('div', { class: 'wfx-side' }, [node, h('div', { class: 'wfx-errline' }), h('div', { class: 'wfx-seq wfx-errcol' }, [caseTag('error')].concat(seqNodes(b.error, f)))]));
            } else out.push(node);
          }
        });
        return out;
      }

      // ---------- domain model ----------
      function drawDomain() {
        var all = Object.keys(data.entities).sort(function (a, b) { return shortName(a).localeCompare(shortName(b)); });
        var q = st.entity && data.entities[st.entity] ? st.entity : all[0];
        setTitle('Domain model', data.project + ' · ' + plural(all.length, 'entity', 'entities'));
        var filter = h('input', { type: 'search', class: 'dx-filter', placeholder: 'Filter entities…' });
        var items = h('div', { class: 'dx-items' });
        list.appendChild(h('div', { class: 'dx-list-head' }, [h('h2', null, ['Entities', h('small', { text: String(all.length) })]), filter]));
        list.appendChild(items);
        function fill() {
          clear(items);
          var t = filter.value.trim().toLowerCase();
          all.forEach(function (k) {
            var e = data.entities[k];
            if (t && k.toLowerCase().indexOf(t) === -1) return;
            items.appendChild(h('button', { type: 'button', class: 'dx-item' + (k === q ? ' on' : ''), onclick: function () { go({ entity: k }); } }, [
              h('span', { class: 'dx-badge', text: 'E' }), h('span', { class: 'dx-item-t' }, [h('b', { class: 'mono', text: e.name }), h('small', { text: e.module + (e.persistable ? '' : ' · not persistable') })]),
              h('span', { class: 'dx-num', title: 'attributes', text: String(e.attributes.length) })]));
          });
        }
        filter.addEventListener('input', fill);
        fill();
        if (!q) { main.appendChild(h('div', { class: 'dx-note', text: 'This model has no entities.' })); return; }
        var e = data.entities[q];
        main.appendChild(crumbs([['Start', function () { go({ view: 'start' }); }], ['Domain model'], [e.module], [e.name]]));
        var inn = {}, out = {};
        data.associations.forEach(function (a) {
          if (a.from === q) (out[a.to] = out[a.to] || []).push(a);
          if (a.to === q && a.from !== q) (inn[a.from] = inn[a.from] || []).push(a);
        });
        var specials = Object.keys(data.entities).filter(function (k) { return data.entities[k].generalization === q; });
        function side(map, title, empty) {
          var ks = Object.keys(map);
          return h('div', { class: 'dm-col' }, [h('div', { class: 'dm-col-h', text: title + ' (' + ks.length + ')' })].concat(ks.length ? ks.map(function (k) {
            var known = data.entities[k];
            return h(known ? 'button' : 'div', { type: known ? 'button' : null, class: 'dm-n' + (known ? ' link' : ''), onclick: known ? function () { go({ entity: k }); } : null }, [
              h('b', { class: 'mono', text: shortName(k) }), h('small', { text: k.split('.')[0] }),
              h('span', { class: 'dm-a', text: map[k].map(function (a) { return a.name + (a.many ? ' (*–*)' : ' (*–1)'); }).join(', ') })]);
          }) : [h('div', { class: 'dm-empty', text: empty })]));
        }
        var center = h('div', { class: 'dm-center dx-card' }, [
          h('div', { class: 'dm-ch' }, [h('h2', { class: 'mono', text: e.name }), h('small', { text: e.module + (e.persistable ? ' · persistable' : ' · not persistable') + (e.view ? ' · view entity' : '') })]),
          e.generalization ? h('div', { class: 'dm-gen' }, ['Specializes ', data.entities[e.generalization]
            ? h('button', { type: 'button', class: 'dx-link mono', text: e.generalization, onclick: function () { go({ entity: e.generalization }); } }) : h('span', { class: 'mono', text: e.generalization })]) : null,
          h('ul', { class: 'dm-attrs' }, e.attributes.length ? e.attributes.map(function (a) { return h('li', null, [h('b', { class: 'mono', text: a.name }), h('span', { text: a.type })]); }) : [h('li', { class: 'dm-empty', text: 'No attributes of its own.' })]),
          h('div', { class: 'dm-roles', text: e.rules ? plural(e.rules, 'access rule', 'access rules') + ' · ' + (e.roles.map(shortName).join(', ') || '–') : (e.persistable ? 'No access rules — no role can read it.' : 'Not persistable — access rules do not apply.') }),
          specials.length ? h('div', { class: 'dm-gen' }, ['Specialized by ', specials.map(function (k, i) { return [i ? ', ' : '', h('button', { type: 'button', class: 'dx-link mono', text: shortName(k), onclick: function () { go({ entity: k }); } })]; })]) : null
        ]);
        main.appendChild(h('div', { class: 'dm' }, [side(inn, 'Point to it', 'Nothing points to it.'), center, side(out, 'It points to', 'It points to nothing.')]));
      }

      // ---------- model quality ----------
      function drawQuality() {
        var Q = data.quality;
        setTitle('Model quality', data.project);
        main.appendChild(crumbs([['Start', function () { go({ view: 'start' }); }], ['Model quality']]));
        main.appendChild(h('div', { class: 'dx-kpis four' }, [tile(Q.unreached.length, 'nothing reaches'), tile(Q.noAccess.length, 'entities without access rules'),
          tile(Q.pastAccess.length, 'microflows past entity access'), tile(Q.disabled, 'disabled steps')]));
        function table(title, note, keys, row) {
          main.appendChild(h('h3', { class: 'dx-h', text: title + ' (' + keys.length + ')' }));
          main.appendChild(h('p', { class: 'dx-p', text: note }));
          if (!keys.length) { main.appendChild(h('div', { class: 'dx-note ok', text: 'None.' })); return; }
          main.appendChild(h('div', { class: 'dx-xl' }, keys.map(row)));
        }
        function flowRow(k) {
          var f = data.flows[k];
          return h('button', { type: 'button', class: 'dx-xl-row link', onclick: function () { openKey(k); } }, [h('span', { class: 'dx-badge' + (f.kind === 'nanoflow' ? ' nf' : f.kind === 'page' ? ' pg' : ''), text: badgeOf(f) }), h('b', { class: 'mono', text: f.qn }), h('small', { text: f.kind + ' ↗' })]);
        }
        table('Nothing reaches these', 'No microflow, page, menu, schedule, service or button in the model refers to them, and no role may run them directly. Candidates for removal — or for a reference that was forgotten. Marketplace modules are left out.', Q.unreached, flowRow);
        table('Entities without access rules', 'Persistable entities in own modules with no access rule: no role can read or write them through the client, only microflows that skip entity access.', Q.noAccess, function (q) {
          return h('button', { type: 'button', class: 'dx-xl-row link', onclick: function () { go({ view: 'domain', entity: q }); } }, [h('span', { class: 'dx-badge', text: 'E' }), h('b', { class: 'mono', text: q }), h('small', { text: 'entity ↗' })]);
        });
        table('Microflows that skip entity access', 'Callable by roles, but read and write past the access rules — whatever role starts them. Usually deliberate; worth knowing.', Q.pastAccess, flowRow);
      }

      draw();
      return { go: go, state: function () { return st; } };
    }

    function fmtDate(iso) {
      var d = new Date(iso);
      if (isNaN(d)) return String(iso || '');
      function p(n) { return n < 10 ? '0' + n : String(n); }
      return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() + ', ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }

    return { mount: mount };
  }

  window.MxDocsView = factory();
  // The source of the reader, for the exported file (see docs.js).
  window.MxDocsView.source = '(' + factory.toString() + ')()';
})();
