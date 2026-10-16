/* MxScout — the command palette.
 *
 * One control that reaches everything: press `/` (or Ctrl-K) anywhere and walk
 * project → section → object, or just type a name and get a flat list. It is
 * how you leave any screen, which is why it floats over everything including
 * the About page, and why it owns the keyboard while it is up.
 *
 * The path is the idea. `/` starts one, Tab commits a segment into it,
 * Backspace at the start of an empty segment climbs back out, and what you see
 * at each level is only what can follow — so the palette teaches the structure
 * of the model while you use it, instead of asking you to remember it.
 *
 * It keeps its own state and exposes four verbs. Everything it does TO the
 * application — opening a project, jumping to an object, scoping to a module —
 * goes through the API passed to init(), because those mutate the detail view
 * and that belongs to app.js.
 */
(function () {
  'use strict';

  var app = null;
  var el = null;
  // The palette's OWN state. Everything about projects, the open project and
  // which screen is showing lives in app.state, reached through the API — the
  // palette reads that, it does not keep a second copy of it.
  var state = { open: false, query: '', index: 0, focus: false, pick: null, all: {} };

  function init(api) {
    app = api;
    el = api.el;
  }

  // The section list is app.sections, not a copy: the sidebar and the palette
  // naming the same thing differently is exactly the drift the sidebar's own
  // comment warns about.

  // Two ways in, one box. Typing `/` walks a PATH — project, then section,
  // then module or object — which is also how the module filter is expressed:
  // once the path says `/Riverside/entities/Sales`, the view is scoped to
  // that module and the chip row collapses into a breadcrumb, because a filter
  // stated in the path should not also be stated in the chrome.
  //
  // Typing anything without a leading slash searches everything in the open
  // project at once — entities, flows, pages, modules and comments — which is
  // what people actually reach for when they know a name but not where it
  // lives.
  var PALETTE_LIMIT = 40;
  // Spelled out rather than derived: chopping the plural off "entities" gives
  // "Entitie".
  var SECTION_SINGULAR = { entities: 'Entity', microflows: 'Microflow', nanoflows: 'Nanoflow', pages: 'Page' };

  function open(prefill) {
    state.open = true;
    state.pick = null;
    state.all = {};
    state.query = prefill || '';
    state.index = 0;
    state.focus = true;
    app.render();
  }

  // The same list, borrowed as a picker: choosing a row hands the object to
  // `onPick` instead of navigating to it. Only objects are offered — projects,
  // sections and modules are places to go, and there is nowhere to go here.
  function openPicker(prompt, onPick) {
    state.open = true;
    state.pick = { prompt: prompt || 'Pick an object', onPick: onPick };
    state.query = '';
    state.index = 0;
    state.focus = true;
    app.render();
  }

  function close() {
    state.open = false;
    state.pick = null;
    state.query = '';
    state.index = 0;
  }

  // Segments of a `/`-prefixed query. The LAST one is what the user is still
  // typing; everything before it has been committed by typing a slash.
  function paletteSegments(query) {
    if (query.charAt(0) !== '/') return null;
    return query.slice(1).split('/');
  }

  // Lower case without accents, one character for one, so a match found in
  // the folded text marks the same characters in the original ("dyzur"
  // finds "dyżur").
  //
  // Kept per string: every keystroke folds every name in the model, and the
  // names do not change while the palette is typed into (a large model has
  // thousands, and folding them was most of a keystroke). Dropped when it
  // grows past what one model holds, so it cannot grow without end.
  var folded = typeof Map === 'function' ? new Map() : null;
  function fold(str) {
    var s2 = String(str || '');
    var hit = folded && folded.get(s2);
    if (hit !== undefined) return hit;
    var out = '';
    for (var i = 0; i < s2.length; i++) {
      var c = s2.charAt(i), f = c.normalize ? c.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : c;
      out += (f || c).charAt(0).toLowerCase();
    }
    if (folded) { if (folded.size > 50000) folded.clear(); folded.set(s2, out); }
    return out;
  }
  function matchesTerm(text, term) {
    if (!term) return true;
    return fold(text).indexOf(fold(term)) !== -1;
  }

  // Committed segments are resolved by exact name (case-insensitive), so
  // `/Riverside/entities/` behaves the same whichever way the user got
  // there — typed out, or picked from the list.
  function resolveProjectSegment(segment) {
    var lower = String(segment || '').toLowerCase();
    for (var i = 0; i < app.state.projects.length; i++) {
      if (app.state.projects[i].name.toLowerCase() === lower) return app.state.projects[i];
    }
    return null;
  }

  function resolveSectionSegment(segment) {
    var lower = String(segment || '').toLowerCase();
    for (var i = 0; i < app.sections.length; i++) {
      if (app.sections[i].dev && !(app.devTools && app.devTools())) continue; // a Developer tool, off for this project
      if (app.sections[i].label.toLowerCase() === lower || app.sections[i].key === lower) return app.sections[i];
    }
    return null;
  }

  // ---------- the rows offered at each level ----------
  function paletteProjectRows(term) {
    return app.state.projects.filter(function (p) { return matchesTerm(p.name, term); }).map(function (p) {
      return {
        kind: 'Project',
        label: p.name,
        sub: (p.summary && p.summary.appName) || '',
        run: function () {
          close();
          app.state.about = null;
          app.state.guide = null;
          app.state.logs = null;
          app.state.newProject.open = false;
          if (app.state.activeId === p.id && app.state.detail) { app.render(); return; }
          app.openProject(p.id).then(render);
        }
      };
    });
  }

  function paletteSectionRows(term) {
    if (!app.state.detail) return [];
    var project = app.findProject(app.state.activeId);
    return app.sections.filter(function (sec) { return (!sec.dev || (app.devTools && app.devTools())) && matchesTerm(sec.label, term); }).map(function (sec) {
      var count = app.sectionCount(project, sec);
      return {
        kind: 'Section',
        label: sec.label,
        sub: count === null ? '' : count + ' items',
        run: function () { close(); app.goToSection(sec.key); }
      };
    });
  }

  function paletteModuleRows(term, sectionKey) {
    if (!app.state.detail) return [];
    // The colour is the accent, the same for every row: read once, not once a row
    // (each read asks the browser for the page's computed style).
    var color = null;
    return app.moduleNamesOf(app.state.detail.model)
      .filter(function (name) { return matchesTerm(name, term); })
      .map(function (name) {
        if (color === null) color = app.moduleColor(name);
        return {
          kind: 'Module',
          label: name,
          sub: 'narrow this view to ' + name,
          color: color,
          run: function () { close(); app.scopeToModule(name, sectionKey); }
        };
      });
  }

  function paletteObjectRows(term, sectionKey) {
    if (!app.state.detail) return [];
    var model = app.state.detail.model;
    var keys = sectionKey ? [sectionKey] : ['entities', 'microflows', 'nanoflows', 'pages'];
    var rows = [], color = null;
    keys.forEach(function (key) {
      var label = SECTION_SINGULAR[key] || key;
      app.objectsOfSection(model, key).forEach(function (item) {
        if (!matchesTerm(item.name, term) && !matchesTerm(item.qualifiedName || '', term)) return;
        if (color === null) color = app.moduleColor(item.module);
        rows.push({
          kind: label,
          label: item.name,
          sub: item.module,
          color: color,
          // Shift with Enter or the click: in a window over this screen
          // instead of going there, for a look that keeps your place.
          run: function (aside) {
            var picker = state.pick;
            close();
            if (picker) picker.onPick(key, item);
            else if (aside) app.peekObject(key, item);
            else app.jumpToObject(key, item);
          }
        });
      });
    });
    return rows;
  }

  // ---------- typing a name: the results grouped, as the documentation's search does ----------
  // Karol, 2026-10-13: the flat list was a wall, and the documentation's
  // "Search everything" read better. So a plain query shows what it found by
  // kind — modules, microflows, nanoflows, pages, entities, then places to go
  // — each with its count and the best match first (the name starting with
  // what was typed, then the shortest), six at a time with the rest a click
  // away. The `/` path and the picker keep the plain list.
  var GROUPS = [['Modules', null], ['Microflows', 'microflows'], ['Nanoflows', 'nanoflows'], ['Pages', 'pages'], ['Entities', 'entities'], ['Go to', null]];
  var SHOWN = 6;
  function rank(term) {
    var f = fold(term);
    return function (a, b) {
      var pa = fold(a.label).indexOf(f) === 0 ? 0 : fold(a.label).indexOf(f) !== -1 ? 1 : 2;
      var pb = fold(b.label).indexOf(f) === 0 ? 0 : fold(b.label).indexOf(f) !== -1 ? 1 : 2;
      return pa - pb || a.label.length - b.label.length || a.label.localeCompare(b.label);
    };
  }
  function groupedRows(term) {
    var groups = [];
    GROUPS.forEach(function (g) {
      var rows = g[0] === 'Modules' ? paletteModuleRows(term, null)
        : g[0] === 'Go to' ? paletteSectionRows(term).concat(paletteProjectRows(term))
          : paletteObjectRows(term, g[1]);
      if (!rows.length) return;
      if (g[0] === 'Modules') rows.forEach(function (r) { r.sub = 'show only this module'; });
      rows.sort(rank(term));
      groups.push({ name: g[0], total: rows.length, rows: state.all[g[0]] ? rows : rows.slice(0, SHOWN) });
    });
    return groups;
  }

  function paletteRows() {
    var query = state.query;
    var segments = paletteSegments(query);

    // Picking is about objects only: a project or a section is somewhere to
    // go, and a picker has nowhere to go.
    if (state.pick) return paletteObjectRows(query.trim(), null).slice(0, PALETTE_LIMIT);

    if (!segments) {
      // No slash: one flat search over everything reachable right now.
      var term = query.trim();
      var rows = paletteProjectRows(term)
        .concat(paletteSectionRows(term))
        .concat(paletteModuleRows(term, null))
        .concat(paletteObjectRows(term, null));
      return rows.slice(0, PALETTE_LIMIT);
    }

    var typing = segments[segments.length - 1];

    if (segments.length === 1) {
      // Projects, plus the open project's own sections — so `/ent` works
      // without naming the project you are already looking at.
      var top = paletteProjectRows(typing).concat(paletteSectionRows(typing));
      // Someone who hits `/` and then types an object name should find it
      // rather than an empty list. Objects come last so path-walking still
      // reads top-down, and only once there is enough to type to be a search
      // rather than every object in the model.
      if (typing.length >= 2) top = top.concat(paletteObjectRows(typing, null));
      return top.slice(0, PALETTE_LIMIT);
    }

    var project = resolveProjectSegment(segments[0]);
    var sectionSegment = project ? segments[1] : segments[0];
    var section = resolveSectionSegment(sectionSegment);

    if (!section) return paletteSectionRows(typing).slice(0, PALETTE_LIMIT);

    // Inside a section: modules narrow the view, objects jump to one thing.
    return paletteModuleRows(typing, section.key)
      .concat(paletteObjectRows(typing, section.key))
      .slice(0, PALETTE_LIMIT);
  }

  function searchIcon() {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('width', '16'); svg.setAttribute('height', '16');
    svg.setAttribute('class', 'palette-icon'); svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.6'); svg.setAttribute('stroke-linecap', 'round');
    var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); c.setAttribute('cx', '7'); c.setAttribute('cy', '7'); c.setAttribute('r', '4.5');
    var l = document.createElementNS('http://www.w3.org/2000/svg', 'path'); l.setAttribute('d', 'M10.5 10.5L14 14');
    svg.appendChild(c); svg.appendChild(l);
    return svg;
  }
  function marked(text, term) {
    var at = term ? fold(text).indexOf(fold(term)) : -1;
    if (at < 0) return [el('span', { text: text })];
    return [el('span', { text: text.slice(0, at) }), el('mark', { text: text.slice(at, at + term.length) }), el('span', { text: text.slice(at + term.length) })];
  }

  function render() {
    if (!state.open) return null;
    var term = state.query.trim();
    var grouped = !state.pick && !paletteSegments(state.query) && term ? groupedRows(term) : null;
    var rows = grouped ? [].concat.apply([], grouped.map(function (g) { return g.rows; })) : paletteRows();
    if (state.index >= rows.length) state.index = Math.max(0, rows.length - 1);

    var input = el('input', {
      class: 'palette-input', type: 'text',
      placeholder: state.pick ? state.pick.prompt : 'Search modules, flows, pages, entities',
      value: state.query
    });
    input.addEventListener('input', function () {
      state.query = input.value;
      state.all = {};
      state.index = 0;
      state.focus = true;
      redraw();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { close(); app.render(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); state.index = Math.min(rows.length - 1, state.index + 1); state.focus = true; redraw(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); state.index = Math.max(0, state.index - 1); state.focus = true; redraw(); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (rows[state.index]) rows[state.index].run(e.shiftKey);
        return;
      }
      if (e.key === 'Tab') {
        // Tab commits the highlighted row INTO the path rather than acting on
        // it, which is what makes `/project/section/module` typeable without
        // spelling every segment out.
        e.preventDefault();
        var row = rows[state.index];
        if (!row) return;
        var segs = paletteSegments(state.query) || [];
        segs[Math.max(0, segs.length - 1)] = row.label;
        state.query = '/' + segs.join('/') + '/';
        state.index = 0;
        state.focus = true;
        redraw();
        return;
      }
      if (e.key === 'Backspace' && state.query.slice(-1) === '/' && state.query.length > 1) {
        // Backspace on an empty segment climbs a level instead of nibbling
        // one character off the segment above it.
        e.preventDefault();
        var parts = state.query.slice(1, -1).split('/');
        parts.pop();
        state.query = '/' + (parts.length ? parts.join('/') + '/' : '');
        state.index = 0;
        state.focus = true;
        redraw();
      }
    });

    function rowNode(row, i) {
      var node = el('button', {
        class: 'palette-row' + (i === state.index ? ' active' : ''),
        onclick: function (e) { row.run(e.shiftKey); }
      }, [
        el('span', { class: 'palette-kind', text: row.kind }),
        el('span', { class: 'palette-label' }, marked(row.label, term)),
        row.sub ? el('span', { class: 'palette-sub', text: row.sub }) : null
      ].filter(Boolean));
      if (row.color) node.style.setProperty('--mod', row.color);
      return node;
    }
    var at = 0, total = 0;
    var list = grouped
      ? (grouped.length ? el('div', { class: 'palette-list' }, [].concat.apply([], grouped.map(function (g) {
          total += g.total;
          var kids = [el('div', { class: 'palette-group' }, [el('span', { text: g.name }), el('span', { class: 'palette-group-n', text: String(g.total) })])];
          g.rows.forEach(function (row) { kids.push(rowNode(row, at++)); });
          if (g.total > g.rows.length) {
            kids.push(el('button', { class: 'palette-more', text: 'Show all ' + g.total, onclick: function () { state.all[g.name] = true; state.focus = true; redraw(); } }));
          }
          return kids;
        }))) : el('p', { class: 'palette-empty', text: 'Nothing matches “' + term + '”.' }))
      : !state.pick && !paletteSegments(state.query) && !term
        ? el('p', { class: 'palette-empty', text: 'Type a name — a module, a microflow, a page, an entity — or / to walk projects → sections → modules.' })
        : rows.length
      ? el('div', { class: 'palette-list' }, rows.map(function (row, i) {
          var node = el('button', {
            class: 'palette-row' + (i === state.index ? ' active' : ''),
            onclick: function (e) { row.run(e.shiftKey); }
          }, [
            el('span', { class: 'palette-kind', text: row.kind }),
            el('span', { class: 'palette-label', text: row.label }),
            row.sub ? el('span', { class: 'palette-sub', text: row.sub }) : null
          ].filter(Boolean));
          if (row.color) node.style.setProperty('--mod', row.color);
          return node;
        }))
      : el('p', { class: 'palette-empty', text: 'Nothing matches.' });

    var backdrop = el('div', {
      class: 'palette-backdrop',
      onclick: function (e) { if (e.target === backdrop) { close(); app.render(); } }
    }, [
      el('div', { class: 'palette' }, [
        el('label', { class: 'palette-field' }, [searchIcon(), input]),
        list,
        el('div', { class: 'palette-help' }, [
          grouped && total ? el('span', { class: 'palette-total', text: total + (total === 1 ? ' result' : ' results') }) : null,
          el('span', { text: '↑↓ move' }),
          el('span', { text: '⏎ go there' }),
          el('span', { text: '⇧⏎ in a window' }),
          el('span', { text: '⇥ narrow' }),
          el('span', { text: '⌫ up a level' }),
          el('span', { text: 'esc close' })
        ])
      ])
    ]);
    shown = backdrop;
    return backdrop;
  }

  // Typing, moving the highlight or showing a group in full changes only the
  // palette, so only the palette is drawn again — not the screen under it,
  // which on a large page or diagram cost more than the search itself. When
  // the palette is not where it was last put (a dialog took its place), the
  // whole app is drawn, as before.
  var shown = null;
  function redraw() {
    var old = shown;
    if (!old || !old.parentNode || !old.isConnected) { app.render(); return; }
    var fresh = render();
    if (!fresh) { app.render(); return; }
    old.parentNode.replaceChild(fresh, old);
    focusIfNeeded(fresh);
  }

  // One global key handler, installed once. It deliberately ignores keystrokes
  // aimed at a text field — `/` is a character people legitimately type into
  // a filter box, and stealing it there would be worse than not having a
  // shortcut at all.
  function isTypingTarget(node) {
    if (!node) return false;
    var tag = (node.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || node.isContentEditable;
  }

  function installShortcuts() {
    document.addEventListener('keydown', function (e) {
      if (state.open) return; // the input owns the keyboard while it is up
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        open('');
        return;
      }
      if (e.key === '/' && !isTypingTarget(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        open('/');
      }
    });
  }

  function isOpen() { return state.open; }

  // Focus has to happen after the node is in the document, so app.js hands it
  // back once it has appended it.
  function focusIfNeeded(node) {
    if (!state.focus) return;
    var input = node.querySelector('.palette-input');
    if (input) {
      input.focus();
      var end = input.value.length;
      input.setSelectionRange(end, end);
    }
    var active = node.querySelector('.palette-row.active');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
    state.focus = false;
  }

  window.MxPalette = {
    init: init, open: open, openPicker: openPicker, isOpen: isOpen,
    render: render, focusIfNeeded: focusIfNeeded, installShortcuts: installShortcuts
  };
})();
