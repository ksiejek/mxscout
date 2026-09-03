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
  var state = { open: false, query: '', index: 0, focus: false, pick: null };

  function init(api) {
    app = api;
    el = api.el;
  }

  // The section list is app.sections, not a copy: the sidebar and the palette
  // naming the same thing differently is exactly the drift the sidebar's own
  // comment warns about.

  // Two ways in, one box. Typing `/` walks a PATH — project, then section,
  // then module or object — which is also how the module filter is expressed:
  // once the path says `/HeadQuarters/entities/Sales`, the view is scoped to
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

  function matchesTerm(text, term) {
    if (!term) return true;
    return String(text).toLowerCase().indexOf(term.toLowerCase()) !== -1;
  }

  // Committed segments are resolved by exact name (case-insensitive), so
  // `/HeadQuarters/entities/` behaves the same whichever way the user got
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
    return app.sections.filter(function (sec) { return matchesTerm(sec.label, term); }).map(function (sec) {
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
    return app.moduleNamesOf(app.state.detail.model)
      .filter(function (name) { return matchesTerm(name, term); })
      .map(function (name) {
        return {
          kind: 'Module',
          label: name,
          sub: 'narrow this view to ' + name,
          color: app.moduleColor(name),
          run: function () { close(); app.scopeToModule(name, sectionKey); }
        };
      });
  }

  function paletteObjectRows(term, sectionKey) {
    if (!app.state.detail) return [];
    var model = app.state.detail.model;
    var keys = sectionKey ? [sectionKey] : ['entities', 'microflows', 'nanoflows', 'pages'];
    var rows = [];
    keys.forEach(function (key) {
      var label = SECTION_SINGULAR[key] || key;
      app.objectsOfSection(model, key).forEach(function (item) {
        if (!matchesTerm(item.name, term) && !matchesTerm(item.qualifiedName || '', term)) return;
        rows.push({
          kind: label,
          label: item.name,
          sub: item.module,
          color: app.moduleColor(item.module),
          run: function () {
            var picker = state.pick;
            close();
            if (picker) picker.onPick(key, item);
            else app.jumpToObject(key, item);
          }
        });
      });
    });
    return rows;
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

  function render() {
    if (!state.open) return null;
    var rows = paletteRows();
    if (state.index >= rows.length) state.index = Math.max(0, rows.length - 1);

    var input = el('input', {
      class: 'palette-input', type: 'text',
      placeholder: state.pick ? state.pick.prompt : 'Type to search, or / to walk projects \u2192 sections \u2192 modules',
      value: state.query
    });
    input.addEventListener('input', function () {
      state.query = input.value;
      state.index = 0;
      state.focus = true;
      app.render();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { close(); app.render(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); state.index = Math.min(rows.length - 1, state.index + 1); state.focus = true; app.render(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); state.index = Math.max(0, state.index - 1); state.focus = true; app.render(); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (rows[state.index]) rows[state.index].run();
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
        app.render();
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
        app.render();
      }
    });

    var list = rows.length
      ? el('div', { class: 'palette-list' }, rows.map(function (row, i) {
          var node = el('button', {
            class: 'palette-row' + (i === state.index ? ' active' : ''),
            onclick: function () { row.run(); }
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
        input,
        list,
        el('div', { class: 'palette-help' }, [
          el('span', { text: '↑↓ move' }),
          el('span', { text: '⏎ open' }),
          el('span', { text: '⇥ narrow' }),
          el('span', { text: '⌫ up a level' }),
          el('span', { text: 'esc close' })
        ])
      ])
    ]);
    return backdrop;
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
    state.focus = false;
  }

  window.MxPalette = {
    init: init, open: open, openPicker: openPicker, isOpen: isOpen,
    render: render, focusIfNeeded: focusIfNeeded, installShortcuts: installShortcuts
  };
})();
