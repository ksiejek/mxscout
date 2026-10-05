/* MxScout — Log analysis: the small pieces the screens are built from.
 *
 * Tabs, a segmented switch, a stat bar, sortable column heads, a file picker that also takes a drop —
 * and the three ways to show text that is not plain: highlighted SQL, a JSON or XML payload, and the
 * short rich-text strings the Error Decoder's ruleset and the help are written in.
 *
 * The last two deserve a sentence. A payload in a log is somebody else's text; the decoder's rules
 * weave a captured value into a sentence. Neither is ever handed to the page as markup. A payload is
 * tokenised and each token becomes a span; a rich string is parsed by DOMParser into a document that
 * is never attached to the page — it cannot run a script or load a resource — and only a short
 * whitelist of its elements is rebuilt, attribute-free, in the live page. Anything else is dropped to
 * its text.
 */
(function () {
  'use strict';

  var L = window.MxLogs;
  var h = L.h;
  var W = L.w;

  // ---------- rich text (a whitelist, never markup) ----------
  var KEEP = { P: 'p', UL: 'ul', OL: 'ol', LI: 'li', STRONG: 'strong', B: 'strong', EM: 'em', I: 'em', CODE: 'code', BR: 'br', PRE: 'pre', H4: 'h4', H5: 'h4' };

  function rebuild(node, into) {
    node.childNodes.forEach(function (c) {
      if (c.nodeType === 3) { into.appendChild(document.createTextNode(c.nodeValue)); return; }
      if (c.nodeType !== 1) return;
      var tag = KEEP[c.nodeName];
      if (!tag) { rebuild(c, into); return; }   // an element we do not know: keep what it says, not what it is
      var out = document.createElement(tag);
      rebuild(c, out);
      into.appendChild(out);
    });
  }

  // html-ish string → DocumentFragment of plain, attribute-free elements.
  W.rich = function (html) {
    var frag = document.createDocumentFragment();
    var doc = new DOMParser().parseFromString('<!doctype html><body>' + String(html == null ? '' : html), 'text/html');
    rebuild(doc.body, frag);
    return frag;
  };
  // The same string as plain text, for copying and tooltips.
  W.richText = function (html) {
    var doc = new DOMParser().parseFromString('<!doctype html><body>' + String(html == null ? '' : html), 'text/html');
    return doc.body.textContent || '';
  };

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

  // ---------- JSON ----------
  // The original coloured keys, strings, numbers, booleans and null by regex over the escaped text;
  // here the same regex runs over the plain text and the pieces between matches stay plain.
  var JSON_TOKEN = /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g;

  W.jsonNodes = function (value) {
    var json = typeof value === 'string' ? value : JSON.stringify(value, undefined, 2);
    var frag = document.createDocumentFragment();
    var last = 0, m;
    JSON_TOKEN.lastIndex = 0;
    while ((m = JSON_TOKEN.exec(json)) !== null) {
      if (m.index > last) frag.appendChild(document.createTextNode(json.slice(last, m.index)));
      var cls = 'lg-j-num', s = m[0];
      if (/^"/.test(s)) cls = /:$/.test(s) ? 'lg-j-key' : 'lg-j-str';
      else if (/true|false/.test(s)) cls = 'lg-j-bool';
      else if (/null/.test(s)) cls = 'lg-j-null';
      frag.appendChild(h('span', { class: cls, text: s }));
      last = m.index + s.length;
    }
    if (last < json.length) frag.appendChild(document.createTextNode(json.slice(last)));
    return frag;
  };

  // ---------- XML ----------
  // serializeXmlPretty, as the original's XML formatter wrote it: indentation by two spaces, a leaf with
  // text on one line.
  function xmlPretty(node, depth) {
    var i = '  '.repeat(depth), ni = '  '.repeat(depth + 1);
    if (node.nodeType === 3) { var text = node.nodeValue.trim(); return text ? text : ''; }
    if (node.nodeType === 4) return '<![CDATA[' + node.nodeValue + ']]>';
    if (node.nodeType === 8) return '<!--' + node.nodeValue + '-->';
    if (node.nodeType === 7) return '<?' + node.nodeName + ' ' + node.nodeValue + '?>';
    if (node.nodeType === 1) {
      var name = node.nodeName, attrs = '';
      for (var j = 0; j < node.attributes.length; j++) attrs += ' ' + node.attributes[j].name + '="' + node.attributes[j].value + '"';
      var children = Array.from(node.childNodes).filter(function (c) { return !(c.nodeType === 3 && !c.nodeValue.trim()); });
      if (children.length === 0) return '<' + name + attrs + ' />';
      if (children.length === 1 && children[0].nodeType === 3) return '<' + name + attrs + '>' + children[0].nodeValue.trim() + '</' + name + '>';
      return '<' + name + attrs + '>\n' +
        children.map(function (c) { return ni + xmlPretty(c, depth + 1); }).filter(function (s) { return s.trim() !== ''; }).join('\n') +
        '\n' + i + '</' + name + '>';
    }
    if (node.nodeType === 9) return Array.from(node.childNodes).map(function (c) { return xmlPretty(c, 0); }).filter(function (s) { return s.trim() !== ''; }).join('\n');
    return '';
  }

  // text → a parsed XML document, or null when it is not well-formed XML.
  function parseXml(text) {
    var t = text.trim();
    var prolog = t.match(/^<\?xml[^?]*\?>/i);
    var body = prolog ? t.substring(prolog[0].length).trim() : t;
    try {
      var doc = new DOMParser().parseFromString(body, 'application/xml');
      if (doc.querySelector('parsererror')) return null;
      return { doc: doc, prolog: prolog ? prolog[0] : '' };
    } catch (e) { return null; }
  }

  function leafClass(text) {
    var l = text.toLowerCase();
    if (!isNaN(Number(text))) return 'lg-j-num';
    if (l === 'true' || l === 'false') return 'lg-j-bool';
    return 'lg-j-str';
  }

  // A collapsible tree: an element with children has a ▼/▶ to fold it, and its opening and closing tag
  // names light together on hover.
  var xmlSeq = 0;
  function xmlTree(node, depth) {
    var frag = document.createDocumentFragment();
    var sp = function (cls, text) { return h('span', { class: cls, text: text }); };
    if (node.nodeType === 3) {
      var tx = node.nodeValue.trim();
      if (tx) frag.appendChild(sp(leafClass(tx), tx));
      return frag;
    }
    if (node.nodeType === 4) { frag.appendChild(sp('lg-x-cdata', '<![CDATA[' + node.nodeValue + ']]>')); return frag; }
    if (node.nodeType === 8) { frag.appendChild(sp('lg-x-comment', '<!--' + node.nodeValue + '-->')); return frag; }
    if (node.nodeType === 7) { frag.appendChild(sp('lg-x-cdata', '<?' + node.nodeName + ' ' + node.nodeValue + '?>')); return frag; }
    if (node.nodeType !== 1) return frag;

    var attrs = [];
    for (var j = 0; j < node.attributes.length; j++) {
      attrs.push(' ', sp('lg-x-attr', node.attributes[j].name), '=', sp('lg-x-val', '"' + node.attributes[j].value + '"'));
    }
    var children = Array.from(node.childNodes).filter(function (c) { return !(c.nodeType === 3 && !c.nodeValue.trim()); });
    var g = 'x' + (xmlSeq++);
    var tag = function () { return h('span', { class: 'lg-x-tag', 'data-g': g, text: node.nodeName }); };
    var line = h('span', { class: 'lg-x-line' });
    if (children.length === 0) {
      L.add(line, [sp('lg-x-br', '<'), tag(), attrs, sp('lg-x-br', ' />')]);
      frag.appendChild(line);
      return frag;
    }
    if (children.length === 1 && children[0].nodeType === 3) {
      var leaf = children[0].nodeValue.trim();
      L.add(line, [sp('lg-x-br', '<'), tag(), attrs, sp('lg-x-br', '>'), leaf ? sp(leafClass(leaf), leaf) : null, sp('lg-x-br', '</'), tag(), sp('lg-x-br', '>')]);
      frag.appendChild(line);
      return frag;
    }
    var body = h('div', { class: 'lg-x-body' });
    children.forEach(function (c) { body.appendChild(h('div', { class: 'lg-x-child' }, [xmlTree(c, depth + 1)])); });
    var placeholder = h('span', { class: 'lg-x-ph', hidden: true }, ['… ', sp('lg-x-br', '</'), tag(), sp('lg-x-br', '>')]);
    var fold = h('button', { class: 'lg-x-fold', type: 'button', 'aria-label': 'Collapse or expand', text: '▼' });
    fold.addEventListener('click', function () {
      var collapsed = body.hidden;
      body.hidden = !collapsed;
      placeholder.hidden = collapsed;
      fold.textContent = collapsed ? '▼' : '▶';
    });
    L.add(line, [fold, sp('lg-x-br', '<'), tag(), attrs, sp('lg-x-br', '>'), placeholder]);
    frag.appendChild(line);
    frag.appendChild(body);
    frag.appendChild(h('span', { class: 'lg-x-line' }, [sp('lg-x-br', '</'), tag(), sp('lg-x-br', '>')]));
    return frag;
  }

  // ---------- a payload: JSON, XML or plain text ----------
  // Pretty-printed where it can be (JSON through parse/stringify, XML through the serializer above) and
  // coloured; anything that is neither stays as it was logged.
  W.payload = function (text, emptyMessage) {
    if (!text) return h('div', { class: 'lg-muted-block', text: emptyMessage || 'Nothing logged.' });
    var t = text.trim();
    var pre = h('pre', { class: 'lg-code lg-code-payload' });
    if (t[0] === '{' || t[0] === '[') {
      try { JSON.parse(t); pre.appendChild(W.jsonNodes(JSON.stringify(JSON.parse(t), null, 2))); return pre; } catch (e) { /* not JSON after all */ }
    }
    if (t[0] === '<') {
      var x = parseXml(t);
      if (x) {
        pre.classList.add('lg-xml');
        if (x.prolog) pre.appendChild(h('div', { class: 'lg-x-line lg-x-comment', text: x.prolog }));
        pre.appendChild(xmlTree(x.doc.documentElement, 0));
        bindPairs(pre);
        return pre;
      }
    }
    pre.textContent = text;
    return pre;
  };

  // The text a Copy button should put on the clipboard for a payload.
  W.payloadText = function (text) {
    if (!text) return '';
    var t = text.trim();
    if (t[0] === '{' || t[0] === '[') { try { return JSON.stringify(JSON.parse(t), null, 2); } catch (e) { return text; } }
    if (t[0] === '<') { var x = parseXml(t); if (x) return (x.prolog ? x.prolog + '\n' : '') + xmlPretty(x.doc.documentElement, 0); }
    return text;
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

  // Column heads of a list laid out as a grid. cols = [{ label, key?, title?, align? }]; a column with a key
  // sorts on click. onSort(key) is told which; setSort(key, dir) draws the arrow.
  W.gridHead = function (cols, template, onSort) {
    var arrows = {};
    var el = h('div', { class: 'lg-ghead', style: 'grid-template-columns:' + template });
    cols.forEach(function (c) {
      var arrow = h('span', { class: 'lg-sort-arrow' });
      if (c.key) arrows[c.key] = arrow;
      el.appendChild(h(c.key ? 'button' : 'div', {
        class: 'lg-gh' + (c.key ? ' is-sortable' : '') + (c.align === 'right' ? ' is-right' : ''), type: c.key ? 'button' : null, title: c.title || null,
        onclick: c.key ? function () { onSort(c.key); } : null
      }, [c.label || '', c.key ? arrow : null]));
    });
    return {
      el: el,
      setSort: function (key, dir) { Object.keys(arrows).forEach(function (k) { arrows[k].textContent = k === key ? (dir === 1 ? ' ▲' : ' ▼') : ''; }); },
      show: function (on) { el.hidden = !on; }
    };
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

  W.copyButton = function (getText, label, cls) {
    var b = h('button', { class: cls || 'btn btn-ghost btn-sm', type: 'button', text: label || 'Copy' });
    b.addEventListener('click', function () { var t = getText(); if (t) L.copy(t, b); });
    return b;
  };

  // A table from plain rows. cols = [{ label, title?, align?, cell?(row) → node|string }]; rows are arrays or
  // objects, as `cell` and `get` need them. Used by the cards that list a "top ten".
  W.table = function (cols, rows, opts) {
    opts = opts || {};
    var thead = h('thead', null, [h('tr', null, cols.map(function (c) { return h('th', { text: c.label, title: c.title || null, class: c.align === 'right' ? 'is-right' : null }); }))]);
    var tbody = h('tbody');
    rows.forEach(function (r) {
      var tr = h('tr', { class: opts.rowClass ? opts.rowClass(r) : null });
      cols.forEach(function (c, i) {
        var v = c.cell ? c.cell(r) : r[i];
        tr.appendChild(h('td', { class: c.align === 'right' ? 'is-right' : null, title: c.tip ? c.tip(r) : null }, [v == null ? '' : v]));
      });
      tbody.appendChild(tr);
    });
    if (!rows.length && opts.empty) tbody.appendChild(h('tr', null, [h('td', { colspan: String(cols.length), class: 'lg-table-empty', text: opts.empty })]));
    return h('table', { class: 'lg-table' }, [thead, tbody]);
  };

  // A link-looking cell that filters something.
  W.linkCell = function (text, onClick, title) {
    return h('button', { class: 'lg-link', type: 'button', text: text, title: title || text, onclick: onClick });
  };

  // A search box. onInput is called on every keystroke.
  W.searchBox = function (placeholder, onInput, cls) {
    var input = h('input', { type: 'text', class: 'lg-input ' + (cls || ''), placeholder: placeholder, spellcheck: 'false', autocomplete: 'off' });
    input.addEventListener('input', function () { onInput(input.value); });
    return input;
  };

  // A number input with a unit label, used for the "slow only > N ms" thresholds.
  W.numberInput = function (value, onInput, attrs) {
    var input = h('input', Object.assign({ type: 'number', class: 'lg-input lg-input-num', value: String(value), min: '0' }, attrs || {}));
    input.addEventListener('input', function () { onInput(input.value); });
    return input;
  };

  W.checkbox = function (label, checked, onChange, title) {
    var input = h('input', { type: 'checkbox', checked: !!checked });
    input.addEventListener('change', function () { onChange(input.checked); });
    return { el: h('label', { class: 'lg-check', title: title || null }, [input, h('span', { text: label })]), input: input };
  };

  // Hours, minutes, seconds: a thin wrapper so every tool says the same thing about its range.
  W.hint = function (text) { return h('p', { class: 'lg-hint', text: text }); };

  // A message that says what is missing and how to get it — shown instead of an empty table.
  W.note = function (text, tone) { return h('div', { class: 'lg-note' + (tone ? ' lg-note-' + tone : ''), text: text }); };

  // A <pre> for plain text with a copy button above it.
  W.textPane = function (id) {
    var pre = h('pre', { class: 'lg-code lg-code-plain', id: id || null });
    return pre;
  };
})();
