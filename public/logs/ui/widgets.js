/* MxScout — Log analysis: the small pieces the screens are built from.
 *
 * Tabs, a segmented switch, a stat bar, a file picker that also takes a drop, the chips that link a
 * log line to the model — and highlighted SQL. A statement in a log is somebody else's text, so it is
 * never handed to the page as markup: the engine tokenises it and each token becomes a span.
 */
(function () {
  'use strict';

  var L = window.MxLogs;
  var h = L.h;
  var W = L.w;

  // ---------- tokens → spans (SQL) ----------
  // The engine's tokenizer yields [{t, v, g?}]. Whitespace stays plain text so `white-space: pre-wrap`
  // keeps the layout; every other token is a span carrying its kind, and `data-g` when it belongs to a
  // matched pair of brackets, so hovering one lights the other.
  W.tokens = function (tokens, prefix) {
    var frag = document.createDocumentFragment();
    for (var i = 0; i < tokens.length; i++) {
      var tk = tokens[i];
      if (tk.t === 'ws') { frag.appendChild(document.createTextNode(tk.v)); continue; }
      var attrs = { class: 'lg-tok ' + (prefix || 'lg-sql-') + tk.t, text: tk.v };
      if (tk.g != null) attrs['data-g'] = String(tk.g);
      frag.appendChild(h('span', attrs));
    }
    return frag;
  };

  // Hovering a grouped token lights every token with the same group id — a bracket and its partner.
  function bindPairs(pre) {
    if (pre._lgBound) return;
    pre._lgBound = true;
    pre.addEventListener('mouseover', function (e) {
      var t = e.target.closest ? e.target.closest('[data-g]') : null;
      if (!t || !pre.contains(t)) return;
      pre.querySelectorAll('[data-g="' + t.getAttribute('data-g') + '"]').forEach(function (n) { n.classList.add('lg-hi'); });
    });
    pre.addEventListener('mouseout', function () {
      pre.querySelectorAll('.lg-hi').forEach(function (n) { n.classList.remove('lg-hi'); });
    });
  }

  W.sqlBlock = function (sql, attrs) {
    var pre = h('pre', Object.assign({ class: 'lg-code lg-code-sql' }, attrs || {}));
    if (sql) pre.appendChild(W.tokens(window.sqlHighlightTokens(sql)));
    bindPairs(pre);
    return pre;
  };

  // ---------- controls ----------
  // Tabs. `items` = [{ id, label, title?, count? }]; returns { el, set(id), setCount(id, text) }.
  W.tabs = function (items, active, onPick, cls) {
    var buttons = {};
    var counts = {};
    var el = h('div', { class: cls || 'lg-tabs', role: 'tablist' });
    items.forEach(function (it) {
      var count = h('span', { class: 'lg-tab-count' });
      counts[it.id] = count;
      var b = h('button', {
        class: 'lg-tab' + (it.id === active ? ' is-active' : ''), type: 'button', role: 'tab',
        'aria-selected': it.id === active ? 'true' : 'false', title: it.title || null,
        onclick: function () { set(it.id); if (onPick) onPick(it.id); }
      }, [it.label, count]);
      buttons[it.id] = b;
      el.appendChild(b);
    });
    function set(id) {
      Object.keys(buttons).forEach(function (k) {
        var on = k === id;
        buttons[k].classList.toggle('is-active', on);
        buttons[k].setAttribute('aria-selected', on ? 'true' : 'false');
      });
    }
    return { el: el, set: set, setCount: function (id, text) { if (counts[id]) counts[id].textContent = text || ''; } };
  };

  // A pair or trio of buttons that choose one view (Executions / By statement …).
  W.segmented = function (items, active, onPick) {
    var buttons = {};
    var el = h('div', { class: 'lg-seg', role: 'group' });
    items.forEach(function (it) {
      var b = h('button', {
        class: 'lg-seg-btn' + (it.id === active ? ' is-active' : ''), type: 'button', text: it.label, title: it.title || null,
        'aria-pressed': it.id === active ? 'true' : 'false',
        onclick: function () { set(it.id); onPick(it.id); }
      });
      buttons[it.id] = b;
      el.appendChild(b);
    });
    function set(id) {
      Object.keys(buttons).forEach(function (k) {
        buttons[k].classList.toggle('is-active', k === id);
        buttons[k].setAttribute('aria-pressed', k === id ? 'true' : 'false');
      });
    }
    return { el: el, set: set };
  };

  // A row of figures: [{ id, label, title?, onClick?, tone? }] → { el, set(id, text), show(id, bool) }.
  W.statBar = function (items) {
    var vals = {}, boxes = {};
    var el = h('div', { class: 'lg-stats', hidden: true });
    items.forEach(function (it) {
      var v = h('strong', { text: '–' });
      if (it.tone) v.className = 'lg-tone-' + it.tone;
      vals[it.id] = v;
      var b = h(it.onClick ? 'button' : 'span', {
        class: 'lg-stat' + (it.onClick ? ' is-link' : ''), title: it.title || null, type: it.onClick ? 'button' : null,
        onclick: it.onClick || null
      }, [it.label + ' ', v]);
      if (it.hidden) b.hidden = true;
      boxes[it.id] = b;
      el.appendChild(b);
    });
    return {
      el: el,
      set: function (id, text) { if (vals[id]) vals[id].textContent = text; },
      show: function (id, on) { if (boxes[id]) boxes[id].hidden = !on; },
      visible: function (on) { el.hidden = !on; }
    };
  };

  // ---------- links into the model ----------
  var KIND_BADGE = { entity: 'E', microflow: 'MF', nanoflow: 'NF', page: 'P' };

  // One model object, as a chip: what it is, its name (opens it), and a flag that starts a comment on it
  // with the log lines already in. `draft` is a function from the object to { severity, problem, change }.
  W.modelChip = function (o, draft) {
    var m = L.model;
    var n = m && m.findings ? m.findings(o) : 0;
    return h('span', { class: 'lg-mlink' }, [
      h('span', { class: 'lg-mkind lg-mkind-' + o.kind, title: o.kind, text: KIND_BADGE[o.kind] || '?' }),
      h('button', {
        class: 'lg-mname', type: 'button', text: o.qualifiedName, title: 'Open ' + o.qualifiedName + ' in the model',
        onclick: function (ev) { ev.stopPropagation(); L.closeModals(); m.open(o); }
      }),
      n ? h('span', { class: 'lg-mcount', title: n + ' open comment' + (n === 1 ? '' : 's') + ' on this object', text: n + ' 💬' }) : null,
      draft ? h('button', {
        class: 'lg-mflag', type: 'button', text: '⚑ Report', title: 'Write a comment on ' + o.qualifiedName + ' from these log lines',
        onclick: function (ev) { ev.stopPropagation(); L.closeModals(); m.report(o, draft(o)); }
      }) : null
    ]);
  };

  // A row of chips for every model object a text names; null when nothing is named (or there is no model).
  W.modelLinks = function (text, draft, limit) {
    var found = L.modelFind(text, limit);
    if (!found.length) return null;
    return h('div', { class: 'lg-mlinks' }, [h('span', { class: 'lg-mlinks-label', text: 'In your model' })].concat(found.map(function (o) { return W.modelChip(o, draft); })));
  };

  // A file picker button that also takes a drop. Returns { button, input, open() }.
  W.filePicker = function (label, opts, onFiles) {
    opts = opts || {};
    var input = h('input', { type: 'file', accept: opts.accept || '.log,.txt,.csv,.gz', multiple: !!opts.multiple, class: 'lg-hidden-input' });
    input.addEventListener('change', function () {
      var files = Array.from(input.files || []);
      input.value = '';
      if (files.length) onFiles(files);
    });
    var button = h('button', {
      class: 'btn ' + (opts.primary ? 'btn-primary ' : '') + 'btn-sm', type: 'button', text: label, title: opts.title || null,
      onclick: function () { input.click(); }
    });
    return { button: button, input: input, open: function () { input.click(); } };
  };

  // Turns an element into a drop target for files.
  W.dropTarget = function (el, onFiles, filter) {
    el.addEventListener('dragover', function (e) { e.preventDefault(); el.classList.add('is-dragover'); });
    el.addEventListener('dragleave', function () { el.classList.remove('is-dragover'); });
    el.addEventListener('drop', function (e) {
      e.preventDefault();
      el.classList.remove('is-dragover');
      var files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
      if (filter) files = files.filter(filter);
      if (files.length) onFiles(files);
    });
  };

  // "How to get this data" — the part of an empty state that says where the input comes from.
  W.howTo = function (title, children) {
    return h('details', { class: 'lg-howto' }, [h('summary', { text: title || 'How to get this data' }), h('div', { class: 'lg-howto-body' }, children)]);
  };

  W.empty = function (title, children, actions) {
    return h('div', { class: 'lg-empty' }, [
      title ? h('p', { class: 'lg-empty-title', text: title }) : null,
      children,
      actions ? h('div', { class: 'lg-empty-actions' }, actions) : null
    ]);
  };

  // A search box. onInput is called on every keystroke.
  W.searchBox = function (placeholder, onInput, cls) {
    var input = h('input', { type: 'text', class: 'lg-input ' + (cls || ''), placeholder: placeholder, spellcheck: 'false', autocomplete: 'off' });
    input.addEventListener('input', function () { onInput(input.value); });
    return input;
  };

  // A message that says what is missing and how to get it — shown instead of an empty table.
  W.note = function (text, tone) { return h('div', { class: 'lg-note' + (tone ? ' lg-note-' + tone : ''), text: text }); };
})();
