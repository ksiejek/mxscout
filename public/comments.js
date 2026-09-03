/* MxScout — comments (findings): the review itself.
 *
 * A comment is one reviewer's claim about one object: what is wrong with it,
 * what should change, and how much it matters. It is the only thing in
 * MxScout nobody can regenerate — a model is one re-import away, three hours
 * of reading is not — which is why it gets its own store (see store.js), its
 * own file, and an append-only history rather than a mutable status field.
 *
 * This file owns everything about comments and reaches the rest of the app
 * through the small API handed to init(). That boundary is the point: app.js
 * had grown past the size where one more feature could be dropped into it,
 * and this is the seam the rest of the split will follow.
 */
(function () {
  'use strict';

  var app = null; // set by init()

  var SEVERITIES = ['critical', 'high', 'medium', 'low'];
  var STATUSES = ['open', 'fixed', 'wontfix'];
  var STATUS_LABEL = { open: 'Open', fixed: 'Fixed', wontfix: 'Won’t fix' };
  var KIND_BADGE = { entity: 'E', microflow: 'MF', nanoflow: 'NF', page: 'P' };

  // Editor state lives here, not in app state: the fields are uncontrolled on
  // purpose. render() rebuilds the whole DOM, and a controlled textarea would
  // lose the caret on every keystroke — so the editor reads its values out of
  // the DOM when it saves, and only re-renders when it opens or closes.
  var editor = null; // { finding, target, nodes }

  // Filters are ANDed across categories and ORed inside one: "(high OR
  // critical) AND (entity) AND (open)". Empty set means "no constraint from
  // this category" rather than "match nothing", which is what makes clearing
  // a filter the same gesture as never setting it.
  var filters = { severity: {}, kind: {}, status: {}, module: {}, sent: {}, date: 'any', text: '', orphansOnly: false };
  var EMPTY_FILTERS = function () {
    return { severity: {}, kind: {}, status: {}, module: {}, sent: {}, date: 'any', text: '', orphansOnly: false };
  };

  // What "has this been sent" means, derived from the export records rather
  // than from a flag on the comment: the same comment travels in several
  // packages, and only a list of sends can answer "which have I not sent yet".
  var SENT_STATES = [
    { key: 'never', label: 'Never sent' },
    { key: 'sent', label: 'Already sent' },
    { key: 'changed', label: 'Changed since sent' }
  ];

  // Date ranges are presets, not two date pickers. "Everything I wrote this
  // week" is the question people actually have, and two empty date fields are
  // a worse way to ask it than one list.
  var DATE_RANGES = [
    { key: 'any', label: 'Any time' },
    { key: 'today', label: 'Today', days: 1 },
    { key: '7', label: 'Last 7 days', days: 7 },
    { key: '30', label: 'Last 30 days', days: 30 },
    { key: '90', label: 'Last 90 days', days: 90 }
  ];

  function lastSentAt(finding) {
    var latest = null;
    (app.state.exports || []).forEach(function (record) {
      var carried = (record.findings || []).some(function (f) { return f.id === finding.id; });
      if (!carried) return;
      if (!latest || String(record.at) > String(latest)) latest = record.at;
    });
    return latest;
  }

  function sentState(finding) {
    var at = lastSentAt(finding);
    if (!at) return 'never';
    return String(finding.updatedAt || '') > String(at) ? 'changed' : 'sent';
  }

  function isOrphan(finding) {
    return !app.objectExists(finding.target.qualifiedName);
  }

  function withinRange(finding, key) {
    if (key === 'any') return true;
    var range = DATE_RANGES.filter(function (r) { return r.key === key; })[0];
    if (!range || !range.days) return true;
    var cutoff = Date.now() - range.days * 24 * 60 * 60 * 1000;
    return new Date(finding.updatedAt || finding.createdAt).getTime() >= cutoff;
  }


  function init(api) { app = api; }

  // ---------- data ----------
  function loadFindings(projectId) {
    return app.store.byIndex('findings', 'byProject', projectId).then(function (rows) {
      app.state.findings = rows;
      sortFindings();
      return rows;
    });
  }

  function sortFindings() {
    var rank = { critical: 0, high: 1, medium: 2, low: 3 };
    app.state.findings.sort(function (a, b) {
      if (rank[a.severity] !== rank[b.severity]) return rank[a.severity] - rank[b.severity];
      return String(b.updatedAt).localeCompare(String(a.updatedAt));
    });
  }

  function authorName() {
    var author = app.state.settings.author;
    return (author && author.name) || null;
  }

  function saveFinding(finding) {
    finding.updatedAt = new Date().toISOString();
    return app.store.put('findings', finding).then(function () {
      var existing = app.state.findings.filter(function (f) { return f.id === finding.id; })[0];
      if (!existing) app.state.findings.push(finding);
      else app.state.findings[app.state.findings.indexOf(existing)] = finding;
      sortFindings();
      return finding;
    }, app.reportWriteFailure);
  }

  function deleteFinding(id) {
    return app.store.delete('findings', id).then(function () {
      app.state.findings = app.state.findings.filter(function (f) { return f.id !== id; });
    }, app.reportWriteFailure);
  }

  function countFor(projectId) {
    return app.state.findings.filter(function (f) { return f.projectId === projectId; }).length;
  }

  // ---------- severity, as intensity rather than hue ----------
  // The accent is amber, so a severity scale in warning colours would make one
  // colour mean two things. This ramp reads by WEIGHT — filled, outlined,
  // dotted, plain — and always carries its word. That survives the accent, and
  // it survives monochrome, which the printed report needs anyway.
  function severityBadge(severity) {
    return app.el('span', { class: 'sev sev-' + severity, text: severity });
  }

  function kindBadge(kind) {
    return app.el('span', { class: 'kind-badge', text: KIND_BADGE[kind] || '?' });
  }

  // ---------- the editor drawer ----------
  // Feedback about the editor's own action (a validation error, a save, a
  // delete) is shown INSIDE the drawer (editor.message), never through the
  // app-wide setMessage banner — that banner renders on the page underneath,
  // and the editor is almost always opened from on top of an entity or flow
  // popup that is itself on top of the page. Routed through setMessage, the
  // banner ends up hidden behind two overlays, invisible until both are
  // closed by hand.
  function openEditor(target, existing) {
    editor = { target: target, finding: existing || null, message: null };
    app.render();
  }

  function closeEditor() {
    editor = null;
    app.render();
  }

  function editorOpen() { return !!editor; }

  // A comment can name several attributes at once, because "these four fields
  // are unprotected" is one finding, not four.
  function attributeChecklist(target, selected) {
    var attrs = (target.attributes || []);
    if (!attrs.length) return null;
    var chosen = {};
    (selected || []).forEach(function (a) { chosen[a] = true; });
    var boxes = attrs.map(function (attr) {
      var box = app.el('input', { type: 'checkbox', value: attr.name });
      if (chosen[attr.name]) box.checked = true;
      var label = app.el('label', { class: 'attr-check' }, [box, app.el('span', { text: attr.name })]);
      return label;
    });
    return app.el('div', {}, [
      app.el('div', { class: 'editor-label', text: 'Which attributes' }),
      app.el('div', { class: 'attr-checks' }, boxes)
    ]);
  }

  function renderEditor() {
    if (!editor) return null;
    var target = editor.target;
    var finding = editor.finding;

    var severitySelect = app.el('select', { class: 'role-select' });
    SEVERITIES.forEach(function (s) {
      var o = app.el('option', { value: s, text: s });
      if ((finding ? finding.severity : 'medium') === s) o.setAttribute('selected', 'selected');
      severitySelect.appendChild(o);
    });

    var problem = app.el('textarea', { class: 'editor-area', rows: '4', placeholder: 'What is the problem?' });
    problem.value = finding ? finding.problem : '';
    var change = app.el('textarea', { class: 'editor-area', rows: '4', placeholder: 'What should change?' });
    change.value = finding ? finding.change : '';

    var attrBlock = target.kind === 'entity'
      ? attributeChecklist(target, finding ? finding.target.attributes : [])
      : null;

    function collectAttributes() {
      if (!attrBlock) return [];
      return Array.prototype.slice.call(attrBlock.querySelectorAll('input:checked')).map(function (b) { return b.value; });
    }

    function save() {
      var problemText = problem.value.trim();
      if (!problemText) {
        editor.message = { text: 'A comment needs at least a problem — say what is wrong before saving.', kind: 'error' };
        app.render();
        return;
      }
      var now = new Date().toISOString();
      var wasNew = !finding;
      var record = finding || {
        id: app.newId(),
        projectId: app.state.activeId,
        status: 'open',
        author: authorName(),
        history: [],
        createdAt: now
      };
      record.target = {
        kind: target.kind,
        qualifiedName: target.qualifiedName,
        module: target.module,
        name: target.name,
        attributes: collectAttributes()
      };
      record.role = app.state.detail.role === 'all' ? null : app.state.detail.role;
      record.severity = severitySelect.value;
      record.problem = problemText;
      record.change = change.value.trim();
      saveFinding(record).then(function () {
        if (wasNew) {
          // Adding a comment closes the window: the writer is done, the
          // comment now shows in the object's Comments tab (and on the
          // Comments page), and keeping the drawer open just adds a second
          // click to dismiss it.
          closeEditor();
          return;
        }
        // Editing keeps the window open with its confirmation, so the change
        // (and Delete) stay to hand.
        editor.finding = record;
        editor.message = { text: 'Comment updated.', kind: 'ok' };
        app.render();
      });
    }

    var body = [
      editor.message ? app.el('p', { class: 'msg ' + editor.message.kind, text: editor.message.text }) : null,
      app.el('div', { class: 'editor-target' }, [
        kindBadge(target.kind),
        app.el('span', { class: 'editor-target-name', text: target.qualifiedName })
      ]),
      attrBlock,
      app.el('div', {}, [
        app.el('div', { class: 'editor-label', text: 'Severity' }),
        severitySelect
      ]),
      app.el('div', {}, [
        app.el('div', { class: 'editor-label', text: 'What is the problem' }),
        problem
      ]),
      app.el('div', {}, [
        app.el('div', { class: 'editor-label', text: 'What should change' }),
        change
      ])
    ].filter(Boolean);

    var drawer = app.withMod(app.el('div', { class: 'editor' }, [
      app.el('div', { class: 'editor-head' }, [
        app.el('h3', { text: finding ? 'Edit comment' : 'New comment' }),
        app.el('button', { class: 'btn btn-sm', text: 'Close', onclick: closeEditor })
      ]),
      app.el('div', { class: 'editor-body' }, body),
      app.el('div', { class: 'editor-foot' }, [
        finding ? app.el('button', {
          class: 'btn btn-danger-outline btn-sm', text: 'Delete',
          onclick: function () {
            deleteFinding(finding.id).then(function () {
              app.setMessage('Comment deleted.', 'ok');
              closeEditor();
            });
          }
        }) : null,
        app.el('button', { class: 'btn btn-primary btn-sm', text: finding ? 'Save changes' : 'Save comment', onclick: save })
      ].filter(Boolean))
    ]), target.module);

    return app.el('div', {
      class: 'editor-backdrop',
      onclick: function (e) { if (e.target.className === 'editor-backdrop') closeEditor(); }
    }, [drawer]);
  }

  // ---------- status changes are history, not a flag ----------
  function setStatus(finding, status) {
    if (finding.status === status) return;
    finding.history = finding.history || [];
    finding.history.push({
      at: new Date().toISOString(),
      by: authorName(),
      from: finding.status,
      to: status
    });
    finding.status = status;
    saveFinding(finding).then(app.render);
  }

  // ---------- filtering ----------
  function activeKeys(group) {
    return Object.keys(group).filter(function (k) { return group[k]; });
  }

  function matchesFilters(finding) {
    var sev = activeKeys(filters.severity);
    if (sev.length && sev.indexOf(finding.severity) === -1) return false;
    var kinds = activeKeys(filters.kind);
    if (kinds.length && kinds.indexOf(finding.target.kind) === -1) return false;
    var statuses = activeKeys(filters.status);
    if (statuses.length && statuses.indexOf(finding.status) === -1) return false;
    var modules = activeKeys(filters.module);
    if (modules.length && modules.indexOf(finding.target.module) === -1) return false;
    var sent = activeKeys(filters.sent);
    if (sent.length && sent.indexOf(sentState(finding)) === -1) return false;
    if (!withinRange(finding, filters.date)) return false;
    if (filters.orphansOnly && !isOrphan(finding)) return false;
    if (filters.text) {
      var hay = [finding.problem, finding.change, finding.target.qualifiedName].join(' ').toLowerCase();
      if (hay.indexOf(filters.text.toLowerCase()) === -1) return false;
    }
    return true;
  }

  // Which filter menu is open, if any. It has to survive a re-render: every
  // checkbox toggle re-renders, and a menu that closed itself on each tick
  // would make picking two values impossible.
  var openMenu = null;
  var moduleSearch = '';
  // The filtered set the bar was last rendered with, so "Send…" reports on
  // exactly what the reader is looking at.
  var currentlyShown = [];

  // What the button says about its own state, so the bar is readable without
  // opening anything: the name alone when nothing is picked, the value itself
  // when one is, a count when several are.
  function filterButtonLabel(name, group, labelFor) {
    var keys = activeKeys(filters[group]);
    if (!keys.length) return name;
    if (keys.length === 1) return name + ': ' + (labelFor ? labelFor(keys[0]) : keys[0]);
    return name + ': ' + keys.length;
  }

  function filterMenuItem(group, key, label, color) {
    var on = !!filters[group][key];
    var box = app.el('input', { type: 'checkbox' });
    if (on) box.checked = true;
    var row = app.el('label', { class: 'filter-item' + (on ? ' on' : '') }, [
      box,
      color ? app.el('span', { class: 'filter-item-dot' }) : null,
      app.el('span', { class: 'filter-item-label', text: label })
    ].filter(Boolean));
    if (color) row.style.setProperty('--mod', color);
    row.addEventListener('click', function (e) {
      // The label owns the click; letting the checkbox fire too would toggle
      // twice and cancel itself out.
      e.preventDefault();
      if (filters[group][key]) delete filters[group][key];
      else filters[group][key] = true;
      app.render();
    });
    return row;
  }

  // The date axis is one choice, not several, so its menu closes on pick —
  // matching what the control actually means instead of applying the
  // multi-select pattern everywhere for consistency's sake.
  function dateMenu() {
    var isOpen = openMenu === 'date';
    var current = DATE_RANGES.filter(function (r) { return r.key === filters.date; })[0] || DATE_RANGES[0];
    var active = filters.date !== 'any';

    var button = app.el('button', {
      class: 'filter-btn' + (active ? ' on' : '') + (isOpen ? ' open' : ''),
      'aria-haspopup': 'true',
      'aria-expanded': isOpen ? 'true' : 'false',
      onclick: function () { openMenu = isOpen ? null : 'date'; app.render(); }
    }, [
      app.el('span', { text: active ? current.label : 'Date' }),
      app.el('span', { class: 'filter-btn-caret', text: '▾' })
    ]);

    var kids = [button];
    if (isOpen) {
      kids.push(app.el('div', { class: 'filter-backdrop', onclick: function () { openMenu = null; app.render(); } }));
      kids.push(app.el('div', { class: 'filter-menu' }, [
        app.el('div', { class: 'filter-menu-list' }, DATE_RANGES.map(function (range) {
          return app.el('button', {
            class: 'filter-item' + (filters.date === range.key ? ' on' : ''),
            text: range.label,
            onclick: function () { filters.date = range.key; openMenu = null; app.render(); }
          });
        }))
      ]));
    }
    return app.el('div', { class: 'filter-menu-wrap' }, kids);
  }

  // One dropdown, multi-select, staying open while you pick. A transparent
  // backdrop does the closing rather than a document listener, because
  // render() replaces the very DOM such a listener would be attached to.
  function filterMenu(name, group, options, opts) {
    opts = opts || {};
    var isOpen = openMenu === group;
    var count = activeKeys(filters[group]).length;

    var button = app.el('button', {
      class: 'filter-btn' + (count ? ' on' : '') + (isOpen ? ' open' : ''),
      'aria-haspopup': 'true',
      'aria-expanded': isOpen ? 'true' : 'false',
      onclick: function () { openMenu = isOpen ? null : group; app.render(); }
    }, [
      app.el('span', { text: filterButtonLabel(name, group, opts.labelFor) }),
      app.el('span', { class: 'filter-btn-caret', text: '▾' })
    ]);

    var kids = [button];
    if (isOpen) {
      var items = options.map(function (o) { return filterMenuItem(group, o.key, o.label, o.color); });

      // A project can have forty modules. A list that long needs its own way
      // in, or the dropdown just moves the scrolling problem somewhere else.
      var head = null;
      if (opts.searchable && opts.total > 8) {
        var search = app.el('input', {
          class: 'filter-menu-search', type: 'text',
          placeholder: 'Filter ' + name.toLowerCase() + '…', value: opts.searchValue || ''
        });
        search.addEventListener('input', function () {
          opts.onSearch(search.value);
          var again = document.querySelector('.filter-menu-search');
          if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
        });
        head = search;
      }

      kids.push(app.el('div', {
        class: 'filter-backdrop',
        onclick: function () { openMenu = null; app.render(); }
      }));
      kids.push(app.el('div', { class: 'filter-menu' }, [
        head,
        items.length
          ? app.el('div', { class: 'filter-menu-list' }, items)
          : app.el('p', { class: 'filter-menu-empty', text: 'Nothing matches.' }),
        count ? app.el('button', {
          class: 'filter-menu-clear', text: 'Clear ' + name.toLowerCase(),
          onclick: function () { filters[group] = {}; app.render(); }
        }) : null
      ].filter(Boolean)));
    }

    return app.el('div', { class: 'filter-menu-wrap' }, kids);
  }

  // One row: search, then a dropdown per axis, then the count. Four rows of
  // chips said the same thing and cost four times the height — and with forty
  // modules the chip row alone would have pushed the comments off screen.
  function renderFilters(model, shownCount, totalCount) {
    var anyActive = ['severity', 'kind', 'status', 'module', 'sent'].some(function (g) { return activeKeys(filters[g]).length; })
      || filters.text || filters.date !== 'any' || filters.orphansOnly;

    var text = app.el('input', { type: 'search', class: 'filter-input', placeholder: 'Search comments…', value: filters.text });
    text.addEventListener('input', function () {
      filters.text = text.value;
      renderKeepingFocus(text);
    });

    var allModules = app.moduleNamesOf(model);
    var moduleOptions = allModules
      .filter(function (m) { return !moduleSearch || m.toLowerCase().indexOf(moduleSearch.toLowerCase()) !== -1; })
      .map(function (m) { return { key: m, label: m, color: app.moduleColor(m) }; });

    var bar = [
      text,
      filterMenu('Severity', 'severity', SEVERITIES.map(function (s) { return { key: s, label: s }; })),
      filterMenu('Type', 'kind', Object.keys(KIND_BADGE).map(function (k) { return { key: k, label: k }; })),
      filterMenu('Status', 'status', STATUSES.map(function (s) { return { key: s, label: STATUS_LABEL[s] }; }), {
        labelFor: function (k) { return STATUS_LABEL[k]; }
      }),
      filterMenu('Module', 'module', moduleOptions, {
        searchable: true,
        total: allModules.length,
        searchValue: moduleSearch,
        onSearch: function (v) { moduleSearch = v; app.render(); }
      }),
      filterMenu('Sent', 'sent', SENT_STATES.map(function (s) { return { key: s.key, label: s.label }; }), {
        labelFor: function (k) {
          return (SENT_STATES.filter(function (s) { return s.key === k; })[0] || {}).label || k;
        }
      }),
      dateMenu()
    ];

    if (anyActive) {
      bar.push(app.el('button', {
        class: 'filter-clear', text: 'Clear all',
        onclick: function () {
          filters = EMPTY_FILTERS();
          moduleSearch = '';
          openMenu = null;
          app.render();
        }
      }));
    }

    // The count sits in the same row as the controls that change it, so the
    // effect of a filter is visible without the eye having to travel.
    bar.push(app.el('span', {
      class: 'filter-count',
      text: anyActive ? shownCount + ' of ' + totalCount + ' shown' : totalCount + ' comment' + (totalCount === 1 ? '' : 's')
    }));
    // Writing a comment from HERE, where no object is open: the palette does
    // the choosing, then the editor opens on whatever was picked. Without
    // this the only way in is to find the object first, which is backwards
    // when the thing you have in mind is the comment, not the object.
    bar.push(app.el('button', {
      class: 'btn btn-sm btn-primary', text: '+ Comment',
      title: 'Pick the object this is about, then write it',
      onclick: function () {
        app.pickObject('Which object is this comment about?', function (target) {
          openEditor(target);
        });
      }
    }));
    bar.push(app.el('button', {
      class: 'btn btn-sm', text: 'Send…',
      title: 'Turn what is shown into a report',
      disabled: shownCount ? null : 'disabled',
      onclick: function () { openReport(currentlyShown); }
    }));

    return app.el('div', { class: 'filter-bar' }, bar);
  }

  // The search box is the one control here that holds a caret, so it gets the
  // same treatment as the view filters: re-render, then put the caret back.
  function renderKeepingFocus(node) {
    var start = node.selectionStart;
    app.render();
    var again = document.querySelector('.comment-filters .filter-input');
    if (again) { again.focus(); again.setSelectionRange(start, start); }
  }

  // ---------- the list ----------
  function renderRow(finding) {
    var statusSelect = app.el('select', { class: 'role-select comment-status' });
    STATUSES.forEach(function (s) {
      var o = app.el('option', { value: s, text: STATUS_LABEL[s] });
      if (finding.status === s) o.setAttribute('selected', 'selected');
      statusSelect.appendChild(o);
    });
    statusSelect.addEventListener('change', function () { setStatus(finding, statusSelect.value); });

    var attrs = (finding.target.attributes || []);
    var meta = [
      finding.target.module,
      attrs.length ? attrs.join(', ') : null,
      finding.role ? 'as ' + finding.role : null,
      finding.author || null,
      app.formatDate(finding.updatedAt)
    ].filter(Boolean).join(' · ');

    var marks = [];
    // Only markers someone can act on. "Never sent" would be true of most
    // comments most of the time, so it stays a filter rather than a badge.
    if (sentState(finding) === 'changed') {
      marks.push(app.el('span', {
        class: 'comment-mark',
        text: 'changed since sent',
        title: 'Whoever received the last package is holding an older version of this comment.'
      }));
    }
    if (isOrphan(finding)) {
      marks.push(app.el('span', {
        class: 'comment-mark orphan',
        text: 'not in this model',
        title: 'This object was renamed or removed from the model after the comment was written.'
      }));
    }

    return app.withMod(app.el('div', { class: 'comment-row status-' + finding.status }, [
      app.el('div', { class: 'comment-row-head' }, [
        severityBadge(finding.severity),
        kindBadge(finding.target.kind),
        app.el('button', {
          class: 'comment-target', text: finding.target.qualifiedName,
          title: 'Go to this object',
          onclick: function () { app.jumpToFinding(finding); }
        }),
        statusSelect,
        app.el('button', { class: 'btn btn-sm', text: 'Edit', onclick: function () { openEditor(targetOf(finding), finding); } })
      ].concat(marks.length ? [app.el('div', { class: 'comment-marks' }, marks)] : [])),
      app.el('p', { class: 'comment-problem', text: finding.problem }),
      finding.change ? app.el('p', { class: 'comment-change', text: '→ ' + finding.change }) : null,
      app.el('div', { class: 'comment-meta', text: meta }),
      (finding.history && finding.history.length)
        ? app.el('div', { class: 'comment-history', text: finding.history.map(function (h) {
            return app.formatDate(h.at) + ': ' + (h.from || '?') + ' → ' + h.to + (h.by ? ' (' + h.by + ')' : '');
          }).join('  ·  ') })
        : null
    ].filter(Boolean)), finding.target.module);
  }

  // The editor needs a target shaped the way it was created, whether it comes
  // from the model (a fresh comment) or from the finding itself (an edit of a
  // comment whose object may since have been renamed away).
  function targetOf(finding) {
    return {
      kind: finding.target.kind,
      qualifiedName: finding.target.qualifiedName,
      module: finding.target.module,
      name: finding.target.name,
      attributes: app.attributesOf(finding.target.qualifiedName)
    };
  }

  function renderList(model) {
    var all = app.state.findings;
    var shown = all.filter(matchesFilters);
    currentlyShown = shown;
    var orphans = all.filter(isOrphan);

    // Orphans are announced rather than silently filtered away: a comment
    // whose object vanished is either work someone still owes an answer to, or
    // evidence that it was fixed by deletion. Both need a human.
    var orphanBanner = (orphans.length && !filters.orphansOnly)
      ? app.el('div', { class: 'orphan-banner' }, [
          app.el('span', { text: orphans.length === 1
            ? 'One comment points at an object that is no longer in this model.'
            : orphans.length + ' comments point at objects that are no longer in this model.' }),
          app.el('button', {
            class: 'btn btn-sm', text: 'Show them',
            onclick: function () { filters.orphansOnly = true; app.render(); }
          })
        ])
      : null;

    var orphanNotice = filters.orphansOnly
      ? app.el('div', { class: 'orphan-banner' }, [
          app.el('span', { text: 'Showing only comments whose object is missing from the current model.' }),
          app.el('button', {
            class: 'btn btn-sm', text: 'Show all',
            onclick: function () { filters.orphansOnly = false; app.render(); }
          })
        ])
      : null;

    // The filter bar carries the "+ Comment" button — the one way to start a
    // comment from this page without already having an object open — so it
    // stays up even at zero comments rather than being replaced by a plain
    // empty-state card that offers no way to act on it.
    var body = !all.length
      ? app.el('div', { class: 'card' }, [
          app.el('h3', { class: 'live-h', text: 'No comments yet' }),
          app.el('p', { class: 'muted', text: 'Press “+ Comment” above to pick an object and write one — or open an entity, a microflow, a nanoflow or a page and use its own Comments tab.' }),
          authorName() ? null : app.el('p', { class: 'muted', text: 'Set your name in Settings first — it is stamped on each comment when it is written, not when it is sent.' })
        ].filter(Boolean))
      : (shown.length
          ? app.el('div', { class: 'comment-list' }, shown.map(renderRow))
          : app.el('div', { class: 'empty' }, [app.el('p', { text: 'No comments match the current filters.' })]));

    return app.el('div', {}, [
      renderFilters(model, shown.length, all.length),
      orphanBanner,
      orphanNotice,
      body,
      renderDeliveryHistory()
    ].filter(Boolean));
  }

  // ---------- sending the review out ----------
  // Whatever the list is showing IS the report. There is no second screen for
  // choosing what goes in, so the filters and the report can never disagree
  // about their own contents.
  var report = null;

  function filterSummaryText() {
    var parts = [];
    ['severity', 'kind', 'status', 'module', 'sent'].forEach(function (group) {
      var keys = activeKeys(filters[group]);
      if (keys.length) parts.push(group + ': ' + keys.join(', '));
    });
    if (filters.date !== 'any') {
      var range = DATE_RANGES.filter(function (r) { return r.key === filters.date; })[0];
      if (range) parts.push(range.label.toLowerCase());
    }
    if (filters.orphansOnly) parts.push('objects missing from the model');
    if (filters.text) parts.push('matching \u201c' + filters.text + '\u201d');
    return parts.length ? parts.join('; ') : 'all comments';
  }

  function openReport(shown) {
    report = { findings: shown, summary: filterSummaryText(), busy: false, code: null, fileName: null, note: null, error: null };
    app.render();
  }

  function reportData() {
    var project = app.findProject(app.state.activeId) || { name: 'Project' };
    return window.MxReport.buildReportData(project, report.findings, report.summary);
  }

  function doCopyForWord() {
    var data = reportData();
    report.busy = true;
    app.render();
    window.MxReport.copyForWord(data).then(function (ok) {
      report.busy = false;
      if (ok) {
        report.note = 'Copied. Paste into Word \u2014 each comment arrives as a heading and its details, recommendation included.';
        // A copy is a send: someone now holds this content outside MxScout.
        app.recordExport(app.state.activeId, 'word', 'Copied for Word', null, report.findings);
      } else {
        report.error = 'This browser refused the clipboard. Use the encrypted HTML file instead.';
      }
      app.render();
    });
  }

  function doEncryptedHtml() {
    var data = reportData();
    var code = window.MxCrypto.generateCode();
    report.busy = true;
    report.error = null;
    app.render();

    window.MxCrypto.pack(data, code).then(function (envelope) {
      var html = window.MxReport.buildStandaloneReport(envelope, data.project);
      var fileName = String(data.project).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') +
        '-report-' + String(data.generatedAt).slice(0, 10) + '.html';
      app.downloadText(html, fileName, 'text/html');
      app.recordExport(app.state.activeId, 'html', 'Encrypted HTML report', fileName, report.findings);
      report.busy = false;
      report.code = code;
      report.fileName = fileName;
      app.render();
    }, function (err) {
      report.busy = false;
      report.error = (err && err.message) || 'Could not build the report.';
      app.render();
    });
  }

  function renderReportModal() {
    if (!report) return null;
    var close = function () { report = null; app.render(); };

    var kids = [
      app.el('h3', { text: 'Send this review out' }),
      app.el('p', { class: 'muted', text: report.findings.length + ' comment' + (report.findings.length === 1 ? '' : 's') + ' \u2014 ' + report.summary + '. Change the filters to change what goes in.' }),

      app.el('div', { class: 'report-option' }, [
        app.el('div', { class: 'report-option-head' }, [
          app.el('strong', { text: 'Encrypted HTML file' }),
          app.el('button', {
            class: 'btn btn-sm btn-primary', text: report.busy ? 'Working\u2026' : 'Build file',
            disabled: report.busy ? 'disabled' : null,
            onclick: doEncryptedHtml
          })
        ]),
        app.el('p', { class: 'muted', text: 'One file that opens in any browser and asks for an access code. For someone who does not have MxScout \u2014 they can print it to PDF themselves.' })
      ]),

      app.el('div', { class: 'report-option' }, [
        app.el('div', { class: 'report-option-head' }, [
          app.el('strong', { text: 'Copy for Word' }),
          app.el('button', {
            class: 'btn btn-sm', text: 'Copy',
            disabled: report.busy ? 'disabled' : null,
            onclick: doCopyForWord
          })
        ]),
        app.el('p', { class: 'muted', text: 'A block per comment on the clipboard \u2014 heading, attributes, problem, recommendation \u2014 ready to paste into someone else\u2019s document. Authors are removed.' }),
        app.el('p', { class: 'warn-text', text: 'This one is not protected. Removing the authors does not make it safe \u2014 the comments themselves are a list of where the application is weak.' })
      ])
    ];

    if (report.code) {
      kids.push(app.el('div', { class: 'code-display' }, [
        app.el('code', { class: 'code-value', text: report.code }),
        app.el('button', {
          class: 'btn btn-sm', text: 'Copy code',
          onclick: function () {
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(report.code);
            report.note = 'Code copied. Send it by a different channel than the file.';
            app.render();
          }
        })
      ]));
      kids.push(app.el('p', { class: 'warn-text', text: report.fileName + ' downloaded. MxScout does not keep this code \u2014 a new report means a new code.' }));
    }
    if (report.note) kids.push(app.el('p', { class: 'ok-text', text: report.note }));
    if (report.error) kids.push(app.el('p', { class: 'warn-text', text: report.error }));

    kids.push(app.el('div', { class: 'modal-actions' }, [
      app.el('button', { class: 'btn', text: 'Close', onclick: close })
    ]));

    var backdrop = app.el('div', {
      class: 'modal-backdrop',
      onclick: function (e) { if (e.target === backdrop && !report.busy) close(); }
    }, [app.el('div', { class: 'modal modal-wide' }, kids)]);
    return backdrop;
  }

  // ---------- what has been sent, and when ----------
  // Kept because "I reported that in August" is a sentence people have to be
  // able to back up. Each record holds a snapshot of what actually went, so
  // the history stays true even after a comment is edited or deleted.
  function renderDeliveryHistory() {
    var records = app.state.exports || [];
    if (!records.length) return null;
    var open = historyOpen;
    return app.el('div', { class: 'history-block' }, [
      app.el('button', {
        class: 'history-toggle',
        onclick: function () { historyOpen = !historyOpen; app.render(); }
      }, [
        app.el('span', { text: (open ? '▾ ' : '▸ ') + 'Sent ' + records.length + ' time' + (records.length === 1 ? '' : 's') })
      ]),
      open ? app.el('div', { class: 'history-list' }, records.map(function (record) {
        return app.el('div', { class: 'history-row' }, [
          app.el('span', { class: 'history-when', text: app.formatDate(record.at) }),
          app.el('span', { class: 'history-what', text: (record.label || record.format) + ' · ' + (record.findings || []).length + ' comment' + ((record.findings || []).length === 1 ? '' : 's') }),
          app.el('span', { class: 'history-who', text: record.author || 'unnamed' })
        ]);
      })) : null
    ].filter(Boolean));
  }
  var historyOpen = false;

  // ---------- the "add comment" affordance other views use ----------
  function addButton(target, label) {
    return app.el('button', {
      class: 'btn btn-sm', text: label || 'Add comment',
      onclick: function () { openEditor(target); }
    });
  }

  function findingsFor(qualifiedName) {
    return app.state.findings.filter(function (f) { return f.target.qualifiedName === qualifiedName; });
  }

  // ---------- the wire shape, and how two copies of it reconcile ----------
  // Both of these used to live in app.js because packaging did. They belong
  // here: what a finding looks like when it travels, and what happens when two
  // copies of the same finding meet, are the finding's own business.
  //
  // serialize() is a WHITELIST, not a copy. Whatever else a stored finding
  // picks up over time — UI flags, cached lookups, a field added next month —
  // it does not leave the browser unless it is named here.
  function serialize(f) {
    return {
      id: f.id,
      target: f.target,
      role: f.role || null,
      severity: f.severity,
      problem: f.problem,
      change: f.change || '',
      status: f.status,
      author: f.author || null,
      history: f.history || [],
      createdAt: f.createdAt,
      updatedAt: f.updatedAt
    };
  }

  // Merge by id, newest updatedAt wins.
  //
  // By id and not by object, because the same comment travels in several
  // packages and comes home again: a reviewer sends findings out, the
  // developer marks two fixed and sends the project back, and the reviewer
  // imports it. Matching on the object would turn every round trip into
  // duplicates on the same entity.
  //
  // Newest-wins is a deliberate choice over merging field by field. Two people
  // editing one comment is rare; a stale copy arriving late is not. A string
  // compare is correct here only because updatedAt is always an ISO-8601 UTC
  // timestamp, where lexical and chronological order agree — if that ever
  // stops being true, this comparison silently stops working.
  //
  // An incoming finding with no id or no target is dropped rather than
  // repaired: it cannot be matched to anything, and inventing an id for it
  // would create a duplicate on the next round trip.
  function merge(existing, incoming, projectId) {
    var byId = {};
    (existing || []).forEach(function (f) { byId[f.id] = f; });
    var added = 0, updated = 0;
    (incoming || []).forEach(function (raw) {
      if (!raw || !raw.id || !raw.target) return;
      var f = serialize(raw);
      f.projectId = projectId;
      var current = byId[f.id];
      if (!current) { byId[f.id] = f; added += 1; return; }
      if (String(f.updatedAt || '') > String(current.updatedAt || '')) {
        byId[f.id] = f;
        updated += 1;
      }
    });
    return { merged: Object.keys(byId).map(function (k) { return byId[k]; }), added: added, updated: updated };
  }

  window.MxComments = {
    init: init,
    serialize: serialize,
    merge: merge,
    loadFindings: loadFindings,
    countFor: countFor,
    renderList: renderList,
    renderEditor: renderEditor,
    renderReportModal: renderReportModal,
    editorOpen: editorOpen,
    addButton: addButton,
    findingsFor: findingsFor,
    severityBadge: severityBadge,
    // A full comment row — same rendering the Comments page uses — so the
    // object popup's Comments tab can show the whole thing (change, meta,
    // status, Edit, history) instead of a stripped one-liner.
    renderRow: renderRow
  };
})();
