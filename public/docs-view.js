/* MxScout — documentation, the reader.
 *
 * Draws what docs-data.js builds, in the redesign's look: the project's mark, the accent,
 * its sidebar; dark and light, the two themes of the design tokens (tokens.css)
 * MxScout itself uses. Every microflow and
 * nanoflow is a WORKFLOW — cards from top to bottom, what it takes at the top,
 * where it can end at the bottom, a decision's branches side by side, loops as
 * frames, error handling to the side — and a click on a card pins everything
 * that step says, down to the value each member it creates or changes gets.
 * The domain model is a map: the entity in the middle, the entities that point
 * to it on one side and the ones it points to on the other.
 *
 * It has to run in three places: the exported file, on a machine that has
 * never seen MxScout; the previews on the Documentation section; and a flow's
 * own window in MxScout, which draws its Diagram with this same workflow so
 * the two can never disagree. So the whole reader is ONE function with no
 * outside references — the export carries its source text
 * (factory.toString()) next to the data.
 *
 * It builds its DOM with createElement and textContent only: the text it
 * shows comes from a model, and none of it can become markup.
 */
(function () {
  'use strict';

  function factory() {
    var doc = document;
    var SVG = 'http://www.w3.org/2000/svg';

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
    function s(tag, attrs) {
      var n = doc.createElementNS(SVG, tag);
      Object.keys(attrs || {}).forEach(function (k) { if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, String(attrs[k])); });
      return n;
    }
    function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
    function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

    // What a card may say about itself. A short plain value ("'Comics'",
    // "$Order/Number", "from $Ticket") belongs on the card; an expression with
    // logic in it ("if $Supplier/Name = empty then …") makes the card as wide
    // as the expression and says nothing at a glance, so it is shown only in
    // the step's details, laid out (Karol, 2026-10-09).
    function simpleText(text) {
      var t = String(text || '');
      return t.length <= 48 && t.indexOf('\n') === -1 && !/\b(if|then|else)\b/i.test(t);
    }
    // A Mendix expression, laid out to be read: "then" and "else" each start a
    // line, indented under the "if" they belong to, and a long condition
    // breaks before its "and" / "or". Text in quotes is never touched.
    function prettyExpr(src) {
      var text = String(src || '').replace(/\s+/g, ' ').trim();
      if (simpleText(text)) return text;
      var re = /'(?:[^']|'')*'|\b(?:if|then|else|and|or)\b|[^'\s]+|\s+/gi;
      var lines = [], line = '', depth = 0, m;
      function pad(n) { return new Array(n + 1).join('  '); }
      function flush() { if (line.trim()) lines.push(line.replace(/\s+$/, '')); line = ''; }
      while ((m = re.exec(text))) {
        var tok = m[0], kw = tok.toLowerCase();
        if (kw === 'if') { if (line.trim() && !/^\s*(then|else)\s*$/i.test(line)) { flush(); line = pad(depth); } depth++; line += 'if '; continue; }
        if (kw === 'then' || kw === 'else') { flush(); line = pad(Math.max(depth, 1)) + kw + ' '; continue; }
        if ((kw === 'and' || kw === 'or') && line.replace(/^\s+/, '').length > 40) {
          var ind = /^\s*/.exec(line)[0].length / 2;
          flush(); line = pad(ind + 1) + kw + ' '; continue;
        }
        if (/^\s+$/.test(tok)) { if (line && !/\s$/.test(line)) line += ' '; continue; }
        // An XPath's next [constraint] starts a line of its own.
        if (tok.charAt(0) === '[' && /\]\s*$/.test(line) && line.trim().length > 30) { var at = /^\s*/.exec(line)[0]; flush(); line = at; }
        line += tok;
      }
      flush();
      return lines.join('\n');
    }
    function shortName(qn) { return String(qn || '').split('.').pop(); }
    // Every sentence an AI agent wrote carries this mark. The rest of the
    // documentation is read from the model and says so; these are not, and a
    // reader must be able to tell the two apart at a glance.
    function aiMark() { return h('span', { class: 'dx-ai', title: 'Written by an AI agent from this model, not read from it', text: '✦ AI' }); }

    function paragraphs(text) {
      return String(text || '').split(/\n\s*\n/).map(function (p) { return p.replace(/\s*\n\s*/g, ' ').trim(); }).filter(Boolean);
    }
    // The overview's lead is the summary's first sentence and the rest goes
    // under it (redesign spec 11): a sentence ends at . ! ? or … before a
    // capital letter, a digit or an opening quote.
    function firstSentence(text) {
      var t = String(text || '').trim();
      var m = /^([\s\S]+?[.!?…])\s+(?=[\p{Lu}\p{N}"„“'(])/u.exec(t);
      return m ? [m[1], t.slice(m[0].length)] : [t, ''];
    }
    var WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
    function numWord(n) { return WORDS[n] || String(n); }
    function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
    function pad2(n) { return n < 10 ? '0' + n : String(n); }
    function requestFrame(fn) { if (window.requestAnimationFrame) window.requestAnimationFrame(fn); else fn(); }
    // A node brought into view by scrolling its own box only. scrollIntoView
    // scrolls every box around it too — the page, the app around an embedded
    // page — which moved the reader to the bottom of the screen (Karol,
    // 2026-10-13: "a click took me to the bottom").
    function keepInView(box, node, center) {
      if (!box || !node || !node.isConnected) return;
      var b = box.getBoundingClientRect(), r = node.getBoundingClientRect();
      if (r.top >= b.top && r.bottom <= b.bottom) return;
      box.scrollTop += (r.top - b.top) - (center ? Math.max(0, (b.height - r.height) / 2) : 8);
    }
    // Every click draws the page again. A box marked data-keep-scroll — a list
    // of modules, a set of filters — comes back where the reader left it,
    // matched by its key; a new box starts at the top (Karol, 2026-10-14: a
    // click near the bottom of a menu moved the menu and cut off the link).
    function scrollsOf(box) {
      var o = {};
      Array.prototype.forEach.call(box.querySelectorAll('[data-keep-scroll]'), function (n) { o[n.getAttribute('data-keep-scroll')] = [n.scrollTop, n.scrollLeft]; });
      return o;
    }
    function putScrolls(box, o) {
      function put() {
        Array.prototype.forEach.call(box.querySelectorAll('[data-keep-scroll]'), function (n) {
          var at = o[n.getAttribute('data-keep-scroll')];
          if (at && (at[0] || at[1])) { void n.offsetHeight; n.scrollTop = at[0]; n.scrollLeft = at[1]; }
        });
      }
      put(); requestFrame(put);
      // Cut short at its bottom by content that comes a moment later: put back for a few frames while it grows — only a box held at its bottom, never one the reader moved.
      var tries = 8;
      (function again() { if (tries--) requestFrame(function () { var short = false; Array.prototype.forEach.call(box.querySelectorAll('[data-keep-scroll]'), function (n) { var at = o[n.getAttribute('data-keep-scroll')]; if (at && at[0] > n.scrollTop + 1 && n.scrollTop >= n.scrollHeight - n.clientHeight - 1) { n.scrollTop = at[0]; short = short || n.scrollTop < at[0] - 1; } }); if (short) again(); }); })();
    }
    function kindClass(kind) { return kind === 'nanoflow' ? ' nf' : kind === 'page' ? ' pg' : kind === 'entity' ? ' en' : ''; }

    // The shell's icons (redesign spec 10 §2): 16-unit viewBox, stroked, decorative.
    var NAV_ICONS = {
      home: ['M2.5 7.5L8 3l5.5 4.5V13H2.5z', 'M6.5 13V9.5h3V13'],
      proc: ['M3 4h.01M3 8h.01M3 12h.01', 'M6 4h7M6 8h7M6 12h7'],
      change: ['M2.5 5h8.5M8.5 2.5L11 5 8.5 7.5', 'M13.5 11H5M7.5 8.5L5 11l2.5 2.5'],
      ticket: ['M2 4.5h12v2.2a1.4 1.4 0 0 0 0 2.6v2.2H2V9.3a1.4 1.4 0 0 0 0-2.6z', 'M10 5v1M10 7.5v1M10 10v1'],
      case: ['M3 2.5h7.5a2 2 0 0 1 2 2v9H5a2 2 0 0 1-2-2z', 'M6 7.5l1.5 1.5 3-3'],
      module: ['M8 1.8l5.5 3v6.4L8 14.2l-5.5-3V4.8z', 'M2.5 4.8L8 7.8l5.5-3M8 7.8v6.4'],
      flow: ['M3 6.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zM13.4 6.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z', 'M6 5.5h4.5v5H6zM4.6 8H6M10.5 8h1.3'],
      entity: ['M2.5 3h11v10h-11z', 'M2.5 6.5h11M6.5 6.5V13'],
      arch: ['M2.5 2.5h4v4h-4zM9.5 2.5h4v4h-4zM6 9.5h4v4H6z', 'M4.5 6.5v1.5h7V6.5M8 8v1.5'],
      risk: ['M8 2l6 11H2z', 'M8 6.5v3M8 11.5h.01'],
      quality: ['M3 8.5l3 3 7-7'],
      nano: ['M5.3 4.5h5.4a3.5 3.5 0 0 1 0 7H5.3a3.5 3.5 0 0 1 0-7z', 'M5.5 8h4.5M8.5 6.3L10.2 8l-1.7 1.7'],
      page: ['M3 2h10v12H3z', 'M5.5 5.5h5M5.5 8h5M5.5 10.5h3'],
      dev: ['M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5'],
      search: ['M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z', 'M10.5 10.5L14 14'],
      sun: ['M8 5.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z', 'M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1'],
      moon: ['M13.5 9.6A5.6 5.6 0 0 1 6.4 2.5a5.6 5.6 0 1 0 7.1 7.1z'],
      monitor: ['M2 3h12v8.5H2z', 'M6 14h4M8 11.5V14'],
      arrow: ['M3 8h9M8.5 4.5L12 8l-3.5 3.5'],
      chev: ['M6 4l4 4-4 4'],
      person: ['M8 2.8a2.7 2.7 0 1 0 0 5.4 2.7 2.7 0 0 0 0-5.4z', 'M2.8 14c.6-2.8 2.7-4.4 5.2-4.4s4.6 1.6 5.2 4.4'],
      up: ['M4 10l4-4 4 4'],
      download: ['M8 2.5v8M4.8 7.5L8 10.7l3.2-3.2M3 13.5h10'],
      down: ['M4 6l4 4 4-4'],
      info: ['M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2z', 'M8 7.2v3.6M8 5h.01'],
      link: ['M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9', 'M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l.9-.9']
    };
    function navIcon(name, size) {
      var svg = s('svg', { viewBox: '0 0 16 16', width: size, height: size, class: 'dx-icon', 'aria-hidden': 'true' });
      (NAV_ICONS[name] || []).forEach(function (d) { svg.appendChild(s('path', { d: d })); });
      return svg;
    }

    function themeOf(t) {
      return t === 'dark' || (t === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    }

    // ---------- words the pages and the Markdown copy share ----------
    // The Risks page's levels and patterns (spec 17).
    var LV = { P1: ['Security and data', 'Before the next release'], P2: ['Functional errors', 'In one of the next releases'], P3: ['Maintenance', 'When you next work on it'] };
    var PAT = { access: 'Missing access checks', secrets: 'Secrets in the model', logic: 'Logic and data errors', silent: 'Errors that vanish',
      'delete': 'Deletes too much', loops: 'Commits in loops', schedule: 'Relies on switched-off events', dead: 'Unused or duplicated',
      hardcoded: 'Values written into flows', naming: 'Names and messages' };
    var PAT_ORDER = ['access', 'secrets', 'logic', 'silent', 'delete', 'loops', 'schedule', 'dead', 'hardcoded', 'naming'];
    // One sentence per pattern, shown beside the conclusion on a wide screen (Karol, 2026-10-13).
    var PAT_NOTE = {
      access: 'Flows that act on any record without checking who calls them.',
      secrets: 'Keys, passwords and tokens written into the model, where anyone with the model can read them.',
      logic: 'Conditions and calculations that give the wrong answer in some cases.',
      silent: 'Failures that are caught and dropped, so nobody learns something went wrong.',
      'delete': 'Deletes that reach further than the record they were meant for.',
      loops: 'Commits made one object at a time inside a loop: slow, and half done when one fails.',
      schedule: 'Work that depends on scheduled events switched off in the model.',
      dead: 'Flows and pages nothing uses, or the same logic kept in more than one place.',
      hardcoded: 'Values written into flows that belong in configuration or constants.',
      naming: 'Names and messages that mislead whoever reads them.'
    };
    var WHERE_KIND = { mf: ['MF', 'Open flow', 'microflow'], nf: ['NF', 'Open flow', 'nanoflow'], pg: ['PG', 'Open page', 'page'], en: ['EN', 'Open entity', null], dm: ['EN', 'Open entity', null] };
    var LVO = { P1: 0, P2: 1, P3: 2 };
    // Where a risk stands (the risk triage (Developer tools), triage.js), drawn by docs-triage.js: only open and
    // reopened ones count as risks; the rest are kept on the Risks page under their own filter.
    var TRI = window.MxDocsTriage, RS = TRI.RS, RS_GROUP = TRI.RS_GROUP, RS_FILTERS = TRI.RS_FILTERS;

    // A kind's tag — MF, NF, PG, SCH … — microflows blue and nanoflows green, as Mendix colours them.
    function kindTag(t) { return h('span', { class: 'dx-kind' + (t === 'MF' ? ' mf' : t === 'NF' ? ' nf' : ''), text: t }); }

    // ---------- an XPath constraint, to read (Karol, 2026-10-13) ----------
    // [Area_Department/Department/Account_Department_Owner = '[%CurrentUser%]']
    // becomes a path you can follow — Area_Department › Department ›
    // Account_Department_Owner — then "is" and "the current user". Each
    // condition on its own line, joined by and / or; the exact text stays
    // under it. Anything this cannot take apart is shown as written.
    var XP_TOKENS = { '[%CurrentUser%]': 'the current user', '[%CurrentDateTime%]': 'now', '[%BeginOfCurrentDay%]': 'start of today', '[%EndOfCurrentDay%]': 'end of today', '[%CurrentObject%]': 'this object' };
    var XP_OPS = { '=': 'is', '!=': 'is not', '<': 'is below', '<=': 'is at most', '>': 'is above', '>=': 'is at least' };
    function xpTop(str, test) {
      var depth = 0, q = false;
      for (var i = 0; i < str.length; i++) {
        var c = str.charAt(i);
        if (c === "'") { q = !q; continue; }
        if (q) continue;
        if (c === '[' || c === '(') depth++;
        else if (c === ']' || c === ')') depth--;
        else if (!depth) { var hit = test(str, i); if (hit) return { at: i, len: hit }; }
      }
      return null;
    }
    function xpathParse(x) {
      var str = String(x || '').replace(/\s+/g, ' ').trim(), groups = [], depth = 0, from = -1, q = false;
      for (var i = 0; i < str.length; i++) {
        var c = str.charAt(i);
        if (c === "'") { q = !q; continue; }
        if (q) continue;
        if (c === '[') { if (!depth) from = i + 1; depth++; }
        else if (c === ']') { depth--; if (!depth) groups.push(str.slice(from, i)); }
      }
      if (!groups.length) groups = [str];
      var conds = [];
      groups.forEach(function (g, gi) {
        var rest = g.trim(), conn = gi ? 'and' : null;
        while (rest) {
          var cut = xpTop(rest, function (s2, i) { var m = /^ (and|or) /.exec(s2.slice(i)); return m ? m[0].length : 0; });
          var part = cut ? rest.slice(0, cut.at) : rest;
          conds.push({ conn: conn, text: part.trim() });
          if (!cut) break;
          conn = rest.slice(cut.at, cut.at + cut.len).trim();
          rest = rest.slice(cut.at + cut.len);
        }
      });
      return conds.map(function (cd) {
        var op = xpTop(cd.text, function (s2, i) { var m = /^(!=|<=|>=|=|<|>)/.exec(s2.slice(i)); return m ? m[0].length : 0; });
        var lhs = op ? cd.text.slice(0, op.at).trim() : cd.text, rhs = op ? cd.text.slice(op.at + op.len).trim() : null;
        var opText = op ? cd.text.slice(op.at, op.at + op.len) : null;
        if (/[()]/.test(lhs)) return { conn: cd.conn, raw: cd.text };
        var path = lhs.split('/').map(function (p) { return p.trim().split('.').pop(); }).filter(Boolean);
        var val = rhs;
        if (val !== null) {
          var unq = /^'(.*)'$/.exec(val);
          var inner = unq ? unq[1].replace(/''/g, "'") : val;
          val = XP_TOKENS[inner] ? { token: XP_TOKENS[inner] } : unq ? { text: '“' + inner + '”' } : { text: inner.split('.').pop() };
        }
        return { conn: cd.conn, path: path, op: opText ? (XP_OPS[opText] || opText) : 'exists', val: val };
      });
    }
    function xpathView(x) {
      var conds;
      try { conds = xpathParse(x); } catch (err) { conds = null; }
      var raw = String(x || '');
      if (!conds || !conds.length) return h('code', { text: raw });
      return h('div', { class: 'dx-xp', title: raw }, conds.map(function (c) {
        var kids = [c.conn ? h('span', { class: 'dx-xp-conn', text: c.conn }) : null];
        if (c.raw) kids.push(h('code', { text: c.raw }));
        else {
          c.path.forEach(function (p, i) { if (i) kids.push(h('span', { class: 'dx-xp-sep', text: '›' })); kids.push(h('span', { class: 'mono dx-xp-step', text: p })); });
          kids.push(h('span', { class: 'dx-xp-op', text: c.op }));
          if (c.val) kids.push(h('span', { class: c.val.token ? 'dx-xp-val token' : 'mono dx-xp-val', text: c.val.token || c.val.text }));
        }
        return h('div', { class: 'dx-xp-row' }, kids);
      }).concat([h('code', { class: 'dx-xp-raw', text: raw })]));
    }

    // The context diagram's groups, placed by the direction of their links
    // to the application (Karol, 2026-10-13): people on the left ("use it"),
    // systems that only send to it on the left below them ("send data"),
    // systems it only calls on the right ("calls"), and a group that goes
    // both ways above it. A node with no group joins its side's own. The
    // agent names the groups; the model does not, so neither does this.
    function contextGroups(diagram) {
      if (!diagram) return null;
      var app = diagram.nodes.filter(function (n) { return n.kind === 'app'; })[0];
      if (!app) return null;
      var byName = {}, groups = [], systems = 0;
      diagram.nodes.forEach(function (n) {
        if (n === app) return;
        var into = diagram.links.filter(function (l) { return l.from === n.id && l.to === app.id; });
        var from = diagram.links.filter(function (l) { return l.from === app.id && l.to === n.id; });
        var dir = into.length && from.length ? 'both' : into.length ? 'in' : from.length ? 'out' : 'none';
        if (n.kind !== 'person') systems++;
        var key = n.group || ('\u0000' + (n.kind === 'person' ? 'person' : dir));
        var g = byName[key];
        if (!g) {
          g = byName[key] = { name: n.group || { person: 'People', both: 'Both ways', 'in': 'Send data to it', out: 'It calls', none: 'Other' }[n.kind === 'person' ? 'person' : dir], nodes: [], people: true, into: false, from: false };
          groups.push(g);
        }
        g.nodes.push({ name: n.name, via: into.concat(from).map(function (l) { return l.label; }).filter(Boolean).join(', ') || n.note, note: n.note });
        if (n.kind !== 'person') g.people = false;
        if (into.length) g.into = true;
        if (from.length) g.from = true;
      });
      if (!groups.length) return null;
      var top = [], left = [], right = [];
      groups.filter(function (g) { return g.people; }).forEach(function (g) { g.verb = 'use it'; left.push(g); });
      groups.filter(function (g) { return !g.people; }).forEach(function (g) {
        if (g.into && g.from) { g.verb = 'both'; top.push(g); }
        else if (g.into) { g.verb = 'send data'; left.push(g); }
        else { g.verb = g.from ? 'calls' : ''; right.push(g); }
      });
      return { app: app, groups: groups, systems: systems, top: top, left: left, right: right };
    }
    // The Mendix guidelines Model quality measures against, quoted (spec 18); a check Mendix has none for has none.
    var GUIDE = {
      unreached: ['Unused and excluded documents should be removed from the model when they are no longer needed. Make sure that items that appear unused are not called from a Java action before removing them.', 'Mendix docs · General best practices'],
      sched: ['The scheduled event and its microflow should share the same name, prefixed SCE_.', 'Mendix docs · Naming conventions'],
      large: ['The size of a microflow should not exceed 25 elements. Split larger ones, for example by moving part of the logic into a sub-microflow. Validation and data-copying flows are the usual exceptions.', 'Mendix docs · General best practices'],
      names: ['If a microflow does not comply with any of the patterns, it should not have a prefix. Event flows use BCO_, BDE_ and similar; scheduled events use SCE_.', 'Mendix docs · Naming conventions'],
      access: ['By default entity access is not applied. Enable Apply entity access if you want to perform actions that respect the access rights of the current user. Allowed roles are only checked when the microflow is executed from the client.', 'Mendix docs · Microflow properties']
    };

    // The role a name's prefix gives a flow (spec 13 §3).
    var ROLE_PREFIX = { ACT: 'Page actions', SUB: 'Sub-flows', DS: 'Data sources', OCH: 'On change', VAL: 'Validation', BCO: 'Before commit', BCo: 'Before commit',
      BDe: 'Before delete', BDE: 'Before delete', ACO: 'After commit', SCH: 'Scheduled', SCE: 'Scheduled', Schedule: 'Scheduled', GET: 'Getters', Get: 'Getters',
      UPD: 'Updates', IVK: 'Actions, old prefix', AAATODELETE: 'Marked for deletion' };

    // ================================================================ the Markdown copy
    // The same documentation as one Markdown file (redesign spec 20): the
    // pages in the order of the menu, their numbers worked out as the pages
    // work them out, the drawings as tables and lists. Flows are the one
    // place a list of steps stands in for the drawing; a flow with no risk,
    // no description and no process carrying it is one line (Karol,
    // 2026-10-13). Text from the model or an agent is escaped, never markup.
    function markdown(data) {
      var out = [];
      function w(line) { out.push(line === undefined ? '' : line); }
      function esc(t) { return String(t === null || t === undefined ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
      function cell(t) { return esc(t).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' '); }
      function code(t) { var x = String(t === null || t === undefined ? '' : t).replace(/\s*\n\s*/g, ' '); var tick = x.indexOf('`') === -1 ? '`' : '``'; return tick + (tick === '``' ? ' ' + x + ' ' : x) + tick; }
      function paras(t) { paragraphs(t).forEach(function (p) { w(esc(p)); w(); }); }
      function table(head, rows) {
        if (!rows.length) return;
        w('| ' + head.map(cell).join(' | ') + ' |');
        w('|' + head.map(function () { return '---'; }).join('|') + '|');
        rows.forEach(function (r) { w('| ' + r.map(function (c) { return c && c.raw !== undefined ? c.raw : cell(c); }).join(' | ') + ' |'); });
        w();
      }
      function raw(t) { return { raw: t }; }
      function agent() { w('> Written by an agent from the model.'); w(); }
      var D = data.derived || (window.MxReportData ? window.MxReportData.derive(data) : null);
      var ai = data.ai || {}, app = ai.app || null, risks = ai.risks || [], c4 = ai.c4 || null, ctx = ai.context || null;
      var procs = app ? app.processes || [] : [], k = data.kpi;
      var triagedMd = ai.triaged || [];
      function rid(i) { var n = String((risks[i] && risks[i].no) || i + 1); return 'R-' + (n.length < 3 ? ('00' + n).slice(-3) : n); }
      function lvCount(l) { return risks.filter(function (r) { return r.level === l; }).length; }
      var KIND_TAG = { microflow: 'MF', nanoflow: 'NF', page: 'PG' };
      function flowByQn(qn) { return data.flows['microflow:' + qn] || data.flows['nanoflow:' + qn] || data.flows['page:' + qn] || null; }

      w('# ' + esc(data.project) + ' — documentation');
      w([data.mendix ? 'Mendix ' + esc(data.mendix) : null, 'model of ' + esc(fmtDate(data.generatedAt))].filter(Boolean).join(' · '));
      w();

      // ---- overview ----
      w('## Overview'); w();
      if (app && app.summary) { agent(); paras(app.summary); }
      var kinds = [];
      (data.services || []).forEach(function (sv) { if (sv.kind && kinds.indexOf(sv.kind) === -1) kinds.push(sv.kind); });
      table(['At a glance', ''], [
        data.mendix ? ['Mendix', data.mendix] : null,
        data.version ? ['Version', (data.version.branch ? data.version.branch + ' @ ' : '') + data.version.short + (data.version.date ? ' · ' + fmtDate(data.version.date).slice(0, 10) : '') + (data.version.message ? ' · ' + data.version.message : '')] : null,
        ['Model read', fmtDate(data.generatedAt)],
        ['Modules', k.modules + (k.marketplace ? ' · +' + k.marketplace + ' Marketplace' : ' · all own')], ['Microflows', k.microflows], ['Nanoflows', k.nanoflows], ['Pages', k.pages],
        ['Entities', k.entities], ['User roles', k.roles], ['Scheduled events', k.scheduled + (k.scheduled ? ' · ' + k.scheduledOn + ' on' : '')],
        ['Published services', k.services + (kinds.length ? ' · ' + kinds.join(' · ') : '')], risks.length ? ['Risks', risks.length + ' · ' + lvCount('P1') + ' P1'] : null
      ].filter(Boolean).map(function (r) { return [r[0], String(r[1])]; }));
      if (app && ((app.users && app.users.length) || app.audience)) {
        w('### Who uses it'); w();
        if (app.users && app.users.length) app.users.forEach(function (u) { w('- **' + esc(u.who) + '**' + (u.what ? ' — ' + esc(u.what) : '')); });
        else w(esc(app.audience));
        w(); w('The model gives them ' + plural(k.roles, 'user role', 'user roles') + '.'); w();
      }
      var cg = contextGroups(c4 && c4.context);
      if (cg) {
        w('### What it talks to'); w();
        w(plural(cg.systems, 'system', 'systems') + ' in ' + plural(cg.groups.length, 'group', 'groups') + '.'); w();
        table(['Partner', 'Group', 'Direction', 'What goes over'], c4.context.nodes.filter(function (n) { return n !== cg.app; }).map(function (n) {
          var into = c4.context.links.filter(function (l) { return l.from === n.id && l.to === cg.app.id; }), from = c4.context.links.filter(function (l) { return l.from === cg.app.id && l.to === n.id; });
          var l = into.concat(from)[0];
          return [n.name, n.group || '—', into.length && from.length ? '↔ ' + cg.app.name : into.length ? '→ ' + cg.app.name : from.length ? cg.app.name + ' →' : '—', [l && l.label, n.note].filter(Boolean).join(' · ')];
        }));
      }
      if (procs.length) {
        w('### What it does'); w();
        procs.forEach(function (p, i) { w((i + 1) + '. **' + esc(p.name) + '**' + (p.summary ? ' — ' + esc(p.summary) : '') + ' (' + plural(p.steps.length, 'step', 'steps') + ' · ' + plural(p.flows.length, 'flow', 'flows') + ')'); });
        w();
      }
      var Q = D && D.quality;
      w('### What needs attention'); w();
      if (risks.length) { w('- P1 · fix first: ' + lvCount('P1')); w('- P2 · plan a fix: ' + lvCount('P2')); w('- P3 · worth knowing: ' + lvCount('P3')); }
      w('- Elements nothing reaches: ' + data.quality.unreached.length);
      w('- Disabled steps: ' + data.quality.disabled);
      if (k.scheduled) w('- Scheduled events switched off: ' + (k.scheduled - k.scheduledOn) + ' of ' + k.scheduled);
      w();
      var p1 = []; risks.forEach(function (r, i) { if (r.level === 'P1') p1.push([r, i]); });
      if (p1.length) { w('P1 risks:'); w(); p1.forEach(function (x) { w('- ' + esc(x[0].title) + ' (' + code(String((x[0].where || [])[0] || '').split('|')[0].split('.')[0]) + ', ' + rid(x[1]) + ')'); }); w(); }

      // ---- processes ----
      function procRisks(p) {
        var fs = {}; p.flows.forEach(function (q) { fs[q] = true; });
        var o = []; risks.forEach(function (r, i) { if ((r.where || []).some(function (x) { return fs[String(x).split('|')[0]]; })) o.push([r, i]); });
        return o.sort(function (a, b) { return LVO[a[0].level] - LVO[b[0].level] || a[1] - b[1]; });
      }
      if (app && (procs.length || app.story || app.summary)) {
        w('## Processes'); w();
        w('### The application'); w(); agent();
        paras(app.summary);
        if (app.users && app.users.length) w('**Who uses it.** ' + app.users.map(function (u) { return esc(u.who) + (u.what ? ': ' + esc(u.what) : ''); }).join(' '));
        else if (app.audience) w('**Who uses it.** ' + esc(app.audience));
        w();
        paras(app.story);
        procs.forEach(function (p, i) {
          w('### ' + pad2(i + 1) + ' ' + esc(p.name)); w(); agent();
          paras(p.summary);
          if (p.steps.length) { w('Steps:'); w(); p.steps.forEach(function (x, j) { w((j + 1) + '. ' + esc(x)); }); w(); }
          paras(p.story);
          if (p.flows.length) {
            w('Flows that carry it (' + p.flows.length + '):'); w();
            p.flows.forEach(function (q) { var f = flowByQn(q); w('- ' + code(q) + (f ? ' (' + KIND_TAG[f.kind] + (f.steps ? ', ' + plural(f.steps, 'step', 'steps') : '') + ')' : ' (not in the model)')); });
            w();
          }
          var pr = procRisks(p);
          w('Risks along the way (' + pr.length + '):'); w();
          if (pr.length) pr.forEach(function (x) { w('- ' + x[0].level + ' · ' + esc(x[0].title) + ' (' + rid(x[1]) + ')'); }); else w('No risk touches these flows.');
          w();
        });
      }

      // ---- modules ----
      var mods = D && D.modules ? D.modules : [];
      var usedBy = {};
      mods.forEach(function (x) { Object.keys(x.uses || {}).forEach(function (u) { (usedBy[u] = usedBy[u] || {})[x.n] = x.uses[u]; }); });
      function weight(v) { return [v[0] ? plural(v[0], 'call', 'calls') : null, v[1] ? plural(v[1], 'association', 'associations') : null].filter(Boolean).join(' · '); }
      if (mods.length) {
        w('## Modules'); w();
        mods.slice().sort(function (a, b) { return a.n.toLowerCase().localeCompare(b.n.toLowerCase()); }).forEach(function (m) {
          var cnt = function (kk) { return m.items.filter(function (i) { return i[0] === kk; }).length; };
          w('### ' + code(m.n) + ' (' + (m.mp ? 'Marketplace module' : 'own module') + ')'); w();
          w(plural(cnt('mf'), 'microflow', 'microflows') + ' · ' + plural(cnt('nf'), 'nanoflow', 'nanoflows') + ' · ' + plural(cnt('pg'), 'page', 'pages') + ' · ' + plural(m.ent.length, 'entity', 'entities') +
            ' · uses ' + Object.keys(m.uses || {}).length + ' · used by ' + Object.keys(usedBy[m.n] || {}).length + (risks.length ? ' · risks ' + (m.risk[0] + m.risk[1] + m.risk[2]) + ' (' + m.risk[0] + ' P1, ' + m.risk[1] + ' P2, ' + m.risk[2] + ' P3)' : ''));
          w();
          if (m.sum || m.story || (m.notes && m.notes.length)) { agent(); paras(m.sum); paras(m.story); }
          (m.notes || []).forEach(function (n) {
            if (n.title) { w('#### ' + esc(n.title)); w(); }
            paras(n.text);
            if (n.items && n.items.length) { n.items.forEach(function (it) { w('- ' + esc(it)); }); w(); }
            if (n.table) table(n.table.columns, n.table.rows.map(function (r) { return n.table.columns.map(function (c, i) { return r[i] || ''; }); }));
          });
          // contents by the first part of the name, as the page groups it
          var tc = {}, groups = {};
          function tok(nm) { var i = nm.indexOf('_'); return i > 0 ? nm.slice(0, i) : ''; }
          m.items.forEach(function (i) { var t2 = tok(i[1]); if (t2) tc[t2] = (tc[t2] || 0) + 1; });
          m.items.forEach(function (i) { var t2 = tok(i[1]); if (!t2 || (tc[t2] < 2 && !ROLE_PREFIX[t2])) t2 = ''; (groups[t2] = groups[t2] || []).push(i); });
          var gk = Object.keys(groups).sort(function (a, b) { if (!a) return 1; if (!b) return -1; return groups[b].length - groups[a].length || a.localeCompare(b); });
          if (gk.length) {
            w('Contents:'); w();
            gk.forEach(function (g) {
              w('- **' + (g ? esc(g) + '_' : 'Other names') + '** ' + (g ? (ROLE_PREFIX[g] || 'named after ' + esc(g)) : 'no shared prefix') + ' (' + groups[g].length + '): ' +
                groups[g].slice().sort(function (a, b) { return a[1].localeCompare(b[1]); }).map(function (i) { return code(i[1]) + ' ' + i[0].toUpperCase() + (i[3] === 0 && i[4] === 0 ? ' (nothing reaches it)' : ''); }).join(', '));
            });
            if (m.ent.length) w('- **Entities** (' + m.ent.length + '): ' + m.ent.map(code).join(', '));
            w();
          }
          var uk = Object.keys(m.uses || {}), bk = Object.keys(usedBy[m.n] || {});
          if (uk.length) { w('Uses: ' + uk.sort().map(function (u) { return code(u) + ' (' + weight(m.uses[u]) + ((mods.filter(function (x) { return x.n === u; })[0] || { uses: {} }).uses[m.n] ? ', ↔ both ways' : '') + ')'; }).join(', ')); w(); }
          if (bk.length) { w('Used by: ' + bk.sort().map(function (u) { return code(u) + ' (' + weight(usedBy[m.n][u]) + ')'; }).join(', ')); w(); }
          var runs = (m.sched || []).map(function (x) { return 'scheduled event ' + code(x[0]) + ' — ' + esc(x[1] || '') + (x[2] ? ' · on' : ' · switched off'); })
            .concat((m.serv || []).map(function (x) { return 'published ' + esc(x[1]) + ' ' + code(x[0]); }));
          w('Runs on its own: ' + (runs.length ? runs.join('; ') : 'nothing — everything here starts from a page or from another module.')); w();
          var mr = []; risks.forEach(function (r, i) { var x = (r.where || [])[0]; if (x && String(x).split('|')[0].split('.')[0] === m.n) mr.push([r, i]); });
          if (mr.length) { w('Risks:'); w(); mr.sort(function (a, b) { return LVO[a[0].level] - LVO[b[0].level] || a[1] - b[1]; }).forEach(function (x) { w('- ' + x[0].level + ' · ' + esc(x[0].title) + ' (' + rid(x[1]) + ')'); }); w(); }
        });
      }

      // ---- microflows & pages ----
      var inProcess = {}; procs.forEach(function (p) { p.flows.forEach(function (q) { inProcess[q] = true; }); });
      var byPlace = {};
      risks.forEach(function (r, i) { (r.where || []).forEach(function (x) { var m2 = /^([^|]+?)(?:\|(mf|nf|pg|en|dm))?$/.exec(String(x).trim()); if (m2) (byPlace[m2[1]] = byPlace[m2[1]] || []).push([m2[2] || null, i]); }); });
      var TAG = { microflow: 'mf', nanoflow: 'nf', page: 'pg' };
      function flowRisks(f) { return (byPlace[f.qn] || []).filter(function (x) { return !x[0] || x[0] === TAG[f.kind]; }).map(function (x) { return x[1]; }); }
      function stepLines(list, depth) {
        var pad = new Array(depth + 1).join('   ');
        (list || []).forEach(function (b) {
          if (b.t === 'start') return;
          if (b.t === 'step') {
            var c = b.card || {};
            w(pad + b.no + '. ' + esc(c.kick || 'Step') + ': ' + code(c.title || '') + (c.detail ? ' — ' + esc(String(c.detail).replace(/\s*\n\s*/g, ' ')) : '') + (c.off ? ' (switched off)' : ''));
            if (b.error && b.error.length) { w(pad + '   - on error:'); stepLines(b.error, depth + 2); }
          } else if (b.t === 'split') {
            w(pad + b.no + '. Decision: ' + esc(b.title || 'Decision') + (b.cond ? ' — ' + code(b.cond) : ''));
            b.branches.forEach(function (br) {
              w(pad + '   - if ' + (br.label === null || br.label === undefined ? 'otherwise' : esc(br.label)) + ':' + (br.body.length ? '' : ' continues'));
              stepLines(br.body, depth + 2);
            });
          } else if (b.t === 'loop') {
            w(pad + b.no + '. Loop' + (b.each ? ' for each ' + code(b.each) : '') + (b.over ? ' in ' + code(b.over) : '') + (b.cond ? ' while ' + code(b.cond) : '') + ':');
            stepLines(b.body, depth + 1);
          } else if (b.t === 'end') {
            w(pad + '- ' + esc(b.label) + (b.returns ? ', returns ' + code(b.returns) : ''));
          } else if (b.t === 'go') {
            w(pad + '- ' + (b.back ? 'goes back to step ' : 'continues at step ') + (b.no || '?'));
          } else if (b.t === 'orphan') {
            w(pad + '- not connected to the rest:'); stepLines(b.body, depth + 1);
          }
        });
      }
      var fmods = data.modules.filter(function (m) { return m.microflows.length + m.nanoflows.length + m.pages.length; });
      if (fmods.length) {
        w('## Microflows & pages'); w();
        w('Every flow in full where it carries a risk, a description or a process; the others in one line.'); w();
        fmods.forEach(function (m) {
          w('### ' + code(m.name)); w();
          m.microflows.concat(m.nanoflows).forEach(function (key) {
            var f = data.flows[key], rs = flowRisks(f);
            var full = rs.length || f.desc || inProcess[f.qn];
            if (!full) { w('- ' + code(f.qn) + ' · ' + f.kind + ' · ' + plural(f.steps || 0, 'step', 'steps') + ' · calls ' + f.calls.length + ' · called by ' + f.calledBy.length); return; }
            w(); w('#### ' + code(f.qn) + ' — ' + f.kind); w();
            if (f.desc) { agent(); w(esc(f.desc) + (f.descStale ? ' (out of date — the ' + f.kind + ' changed since this was written)' : '')); w(); }
            w('- Parameters: ' + (f.params.length ? f.params.map(function (p) { return code(p.name) + ' (' + esc(p.type) + ')'; }).join(', ') : 'none'));
            w('- Returns: ' + (f.returns ? code(f.returns) : 'nothing'));
            w('- Who can start it: ' + (f.roles.length ? f.roles.map(code).join(', ') : 'no user role — only other flows'));
            if (f.kind === 'microflow') w('- Applies entity access: ' + (f.entityAccess ? 'yes' : 'no'));
            w('- Calls: ' + (f.calls.length ? f.calls.map(function (c) { return code(c.qn) + ' (' + c.kind + ')'; }).join(', ') : 'nothing'));
            w('- Called by: ' + (f.calledBy.length ? f.calledBy.map(function (c) { return code(c.qn || c.kind) + ' (' + c.kind + ')'; }).join(', ') : 'nothing'));
            if (rs.length) w('- Risks: ' + rs.map(function (i) { return risks[i].level + ' · ' + esc(risks[i].title) + ' (' + rid(i) + ')'; }).join('; '));
            w();
            if (f.workflow) { w('Steps (' + (f.steps || 0) + '):'); w(); stepLines(f.workflow, 0); w(); }
          });
          if (m.pages.length) {
            w();
            m.pages.forEach(function (key) {
              var p = data.flows[key];
              w('- ' + code(p.qn) + ' · page' + (p.params.length ? ' · parameters ' + p.params.map(function (x) { return code(x.name); }).join(', ') : '') +
                ' · opened from ' + (p.calledBy.length ? p.calledBy.map(function (c) { return code(c.qn || c.kind); }).join(', ') : 'nothing') + (flowRisks(p).length ? ' · risks ' + flowRisks(p).map(rid).join(', ') : ''));
            });
          }
          w();
        });
      }

      // ---- domain model ----
      var emods = data.modules.filter(function (m) { return m.entities.length; });
      if (emods.length) {
        w('## Domain model'); w();
        w(plural(Object.keys(data.entities).length, 'entity', 'entities') + ' in ' + plural(emods.length, 'module', 'modules') + ', ' + plural((data.associations || []).length, 'association', 'associations') + '.'); w();
        emods.forEach(function (m) {
          var Dm = (D && D.domain && D.domain[m.name]) || (window.MxReportData ? window.MxReportData.domain(data, m.name) : null);
          if (!Dm) return;
          w('### ' + code(m.name)); w();
          Object.keys(Dm.ents).sort().forEach(function (n) {
            var e = Dm.ents[n], q = m.name + '.' + n;
            w('#### ' + code(q) + ' — ' + (e.view ? 'view entity' : e.pers ? 'persistable' : 'non-persistable')); w();
            if (e.desc) { agent(); w(esc(e.desc)); w(); }
            if (e.gen) { w('Generalization: ' + code(e.gen)); w(); }
            table(['Attribute', 'Type'], e.attrs.map(function (a) { return [raw(code(a[0])), a[2]]; }));
            var owned = Dm.assoc.filter(function (a) { return a[1] === q; }), refBy = Dm.assoc.filter(function (a) { return a[2] === q && a[1] !== q; });
            if (owned.length) w('- It refers to: ' + owned.map(function (a) { return code(a[2]) + ' via ' + code(a[0]) + ' (' + (a[3] ? '*–*' : '*–1') + ')'; }).join(', '));
            if (refBy.length) w('- Refers to it: ' + refBy.map(function (a) { return code(a[1]) + ' via ' + code(a[0]) + ' (' + (a[3] ? '*–*' : '1–*') + ')'; }).join(', '));
            var members = e.attrs.length + owned.length;
            if (!e.access.length) w('- Access: no rule — no module role reaches it from the client');
            e.access.forEach(function (r) {
              w('- Access for module role ' + code(r[0]) + ' (user roles: ' + (r[1].length ? r[1].map(esc).join(', ') : 'none') + '): ' +
                [r[2] ? 'read ' + (r[2] >= members ? 'all ' + r[2] : r[2] + ' of ' + members) : 'no read', r[3] ? 'write ' + (r[3] >= members ? 'all ' + r[3] : r[3] + ' of ' + members) : 'no write',
                  r[4] ? 'create' : 'no create', r[5] ? 'delete' : 'no delete'].join(', ') + '; ' + (r[6] ? 'only rows where ' + code(r[6]) : 'every row'));
            });
            w();
          });
        });
      }

      // ---- architecture ----
      var A = D && D.arch;
      w('## Architecture'); w();
      if (cg) { w('### Context'); w(); agent(); w('See “What it talks to” under Overview for the partners and what goes over.'); w(); }
      if (c4 && c4.containers) {
        w('### Runtime'); w(); agent();
        c4.containers.nodes.forEach(function (n) { w('- ' + esc(n.kind) + ' **' + esc(n.name) + '**' + (n.note ? ' — ' + esc(n.note) : '')); });
        w();
        var byId = {}; c4.containers.nodes.forEach(function (n) { byId[n.id] = n.name; });
        c4.containers.links.forEach(function (l) { w('- ' + esc(byId[l.from]) + ' → ' + esc(byId[l.to]) + (l.label ? ' (' + esc(l.label) + ')' : '')); });
        w();
      }
      if (A) {
        table(['Published service', 'Kind'], A.serv.map(function (x) { return [raw(code(x[0])), x[1] || '']; }));
        table(['Scheduled event', 'Runs', 'State'], A.sched.map(function (x) { return [raw(code(x[0])), x[1] || '', x[2] ? 'on' : 'off']; }));
        var val = function (a, b) { var v = A.mat[a] && A.mat[a][b]; return v ? v[0] + v[1] : 0; };
        var linkN = 0, mutualN = 0;
        A.order.forEach(function (a) { A.order.forEach(function (b) { if (a !== b && val(a, b)) { linkN++; if (val(b, a) && a < b) mutualN++; } }); });
        w('### Modules'); w();
        w(linkN + ' links between ' + A.order.length + ' modules; ' + mutualN + (mutualN === 1 ? ' pair' : ' pairs') + ' of modules use each other (↔).'); w();
        table(['Module', 'Uses', 'Used by'], A.order.map(function (a) {
          var uses = A.order.filter(function (b) { return b !== a && val(a, b); }), by = A.order.filter(function (b) { return b !== a && val(b, a); });
          return [raw(code(a)), raw(uses.map(function (b) { return code(b) + ' ' + val(a, b) + (val(b, a) ? ' ↔' : ''); }).join(', ') || '—'), raw(by.map(function (b) { return code(b) + ' ' + val(b, a); }).join(', ') || '—')];
        }));
        w('### Roles'); w();
        table(['User role', 'Modules (module roles)'], A.roles.map(function (r) {
          return [r.n, raw(Object.keys(r.own).sort().map(function (m) { return code(m) + ' (' + r.own[m].map(esc).join(', ') + ')'; }).concat(r.other.map(code)).join(', ') || '—')];
        }));
      }
      if (c4 && c4.open && c4.open.length) { w('### What the model does not show'); w(); agent(); c4.open.forEach(function (x, i) { w((i + 1) + '. ' + esc(x)); }); w(); }

      // ---- risks ----
      if (risks.length) {
        var themes = (D && D.risks) || [];
        w('## Risks'); w();
        w(plural(risks.length, 'finding', 'findings') + ': ' + lvCount('P1') + ' P1, ' + lvCount('P2') + ' P2, ' + lvCount('P3') + ' P3. An agent read them from the model, so check each one before you act on it.'); w();
        ['P1', 'P2', 'P3'].forEach(function (l) {
          var list = []; risks.forEach(function (r, i) { if (r.level === l) list.push([r, i]); });
          if (!list.length) return;
          w('### ' + l + ' · ' + LV[l][0] + ' (' + list.length + ') — fix ' + LV[l][1].charAt(0).toLowerCase() + LV[l][1].slice(1)); w();
          list.forEach(function (x) {
            var r = x[0], th = r.theme || (themes[x[1]] && themes[x[1]][1]) || 'logic';
            w('#### ' + rid(x[1]) + ' · ' + esc(r.title)); w();
            w('- Pattern: ' + (PAT[th] || th) + ' · module ' + code(String((r.where || [])[0] || 'Other').split('|')[0].split('.')[0]) + (r.origin === 'person' ? ' · raised by ' + esc(r.by || 'a person') + (r.raisedAt ? ' on ' + String(r.raisedAt).slice(0, 10) : '') : '') + (r.id || r.pid ? ' · id ' + code(r.id || r.pid) : ''));
            if (r.status === 'reopened') w('- Status: reopened' + (r.note ? ' — ' + esc(r.note) : ''));
            if (r.detail) w('- What happens: ' + esc(r.detail));
            if (r.fix) w('- What to do: ' + esc(r.fix));
            if ((r.where || []).length) w('- Where: ' + r.where.map(function (q) { return code(String(q).split('|')[0]); }).join(', '));
            w();
          });
        });
      }

      // Risks no longer counted (risk triage): what was decided about each, as history — docs-triage.js.
      TRI.markdown(triagedMd, { w: w, esc: esc, counted: risks.length });

      // ---- model quality ----
      if (Q) {
        w('## Model quality'); w();
        w('Six checks read straight from the model and measured against Mendix’s own guidelines.'); w();
        function check(title, n, guide, lines) {
          w('### ' + title + ' (' + n + ')'); w();
          if (guide) { w('> **Mendix guideline.** ' + esc(guide[0]) + ' — ' + esc(guide[1])); w(); }
          if (lines.length) { lines.forEach(function (x) { w('- ' + x); }); w(); } else { w('None.'); w(); }
        }
        check('Nothing reaches these', Q.unr.length, GUIDE.unreached, Q.unr.map(function (u) { return code(u[1]) + ' (' + u[0].toUpperCase() + (u[0] === 'pg' ? '' : ', ' + plural(u[2], 'step', 'steps')) + ')'; }));
        check('Switched-off steps', (Q.offAll || []).length, null, (Q.offAll || []).map(function (o) { return code(o.flow) + ' step ' + o.no + ': ' + esc(o.kick || '') + ' ' + code(o.title || ''); }));
        check('Scheduled events switched off', (Q.sched.filter(function (x) { return !x[2]; }).length) + ' of ' + Q.sched.length, GUIDE.sched, Q.sched.map(function (x) { return code(x[0]) + ' — ' + esc(x[1] || '') + ' · ' + (x[2] ? 'on' : 'off'); }));
        check('Flows over 25 elements', Q.over + ' of ' + Q.flowsN, GUIDE.large, Q.large.map(function (f) { return code(f[1]) + ' — ' + plural(f[2], 'step', 'steps'); }).concat(Q.over > Q.large.length ? ['+ ' + (Q.over - Q.large.length) + ' more over 25 elements'] : []));
        check('Prefixes outside the convention', Q.prefN, GUIDE.names, Q.pref.map(function (p) { return code(p[0] + '_') + ' — ' + p[1] + (p[2] ? ' · Mendix convention: ' + esc(p[2]) : '') + ' · e.g. ' + code(p[3][0]); }));
        check('Microflows that apply entity access', Q.eaApplied + ' of ' + Q.eaTotal, GUIDE.access, Q.ea.filter(function (r) { return r[1]; }).map(function (r) { return code(r[0]) + ' — ' + r[1] + ' microflows, a role can start ' + r[2] + ', apply entity access ' + r[3]; }));
      }

      // ---- for developers ----
      var X = D && D.dev;
      if (ctx && X) {
        w('## For developers'); w(); agent();
        if (X.where.length) { w('### Where things are'); w(); X.where.forEach(function (x) { w('- **' + esc(x[0]) + '** — ' + esc(x[1])); }); w(); }
        if (X.conv.length) { w('### Naming'); w(); table(['Pattern', 'What it means here', 'Names'], X.conv.map(function (c) { return [raw(code(c[0])), c[1], c[2] ? String(c[2]) : '—']; })); }
        if (X.pit.length) { w('### Before you change'); w(); X.pit.forEach(function (p, i) { w((i + 1) + '. ' + esc(p[0])); }); w(); }
      }
      if (data.cases && data.cases.length && window.MxDocsKnowledge) out.push(window.MxDocsKnowledge.markdown(data.cases)); // only when the export was asked for them
      return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';
    }

    // ================================================================ the domain model's layout
    // One module's entities on a grid, their associations as orthogonal lines
    // (redesign spec 15 §2; Karol, 2026-10-13: our own layout, no library).
    // Lines never cross a box: a line between neighbours is straight, any
    // other runs through the channels between the columns and the rows, the
    // outer margin counting as a channel, each line on its own lane. Where
    // the entities sit is searched for: the best-connected one starts in the
    // middle, its neighbours around it, then swaps of two cells are kept
    // while they lower the cost — crossings first, then length and bends.
    //   nodes: [name]; pairs: [{ a, b, n, many }] (a owns); size(name) -> { w, h }
    //   G: { gx, gy, pad, fy } — the channels, the margin, a port's height
    function domainLayout(nodes, pairs, size, G) {
      var n = nodes.length;
      if (!n) return { pos: {}, routes: [], W: 2 * G.pad, H: 2 * G.pad, crossings: 0 };
      var cols = Math.max(1, Math.ceil(Math.sqrt(n))), rows = Math.ceil(n / cols);
      if (n === 2) { cols = 2; rows = 1; }
      var cells = cols * rows;
      var deg = {};
      nodes.forEach(function (x) { deg[x] = 0; });
      pairs.forEach(function (p) { deg[p.a] += p.n; deg[p.b] += p.n; });
      // first placement: the best-connected in the middle, then each next one (most links to those placed) on the free cell nearest them
      var at = {}, taken = {};
      var order = nodes.slice().sort(function (a, b) { return deg[b] - deg[a] || a.localeCompare(b); });
      var placed = [];
      // How many associations join two entities, looked up rather than counted again for every
      // cell tried (a large module asked it millions of times); the sizes likewise, read once.
      var linkN = {};
      pairs.forEach(function (p) {
        var k1 = p.a + '\n' + p.b, k2 = p.b + '\n' + p.a;
        linkN[k1] = (linkN[k1] || 0) + p.n;
        if (k2 !== k1) linkN[k2] = (linkN[k2] || 0) + p.n;
      });
      function links(x, y) { return linkN[x + '\n' + y] || 0; }
      var sizes = {};
      nodes.forEach(function (x) { sizes[x] = size(x); });
      while (placed.length < n) {
        var next = null, best = -1;
        order.forEach(function (x) { if (at[x] !== undefined) return; var s2 = 0; placed.forEach(function (y) { s2 += links(x, y); }); if (s2 > best) { best = s2; next = x; } });
        var bestCell = -1, bestD = Infinity;
        for (var c = 0; c < cells; c++) {
          if (taken[c]) continue;
          var r = Math.floor(c / cols), k = c % cols, dsum = 0;
          if (!placed.length) dsum = Math.abs(r - (rows - 1) / 2) + Math.abs(k - (cols - 1) / 2);
          placed.forEach(function (y) { var w = links(next, y); if (w) { var o = at[y]; dsum += w * (Math.abs(r - Math.floor(o / cols)) + Math.abs(k - o % cols)); } });
          if (dsum < bestD) { bestD = dsum; bestCell = c; }
        }
        at[next] = bestCell; taken[bestCell] = next; placed.push(next);
      }

      function geometry(at) {
        // column widths and row heights from what sits in them
        var colW = [], rowH = [];
        for (var i = 0; i < cols; i++) colW[i] = 0;
        for (var j = 0; j < rows; j++) rowH[j] = 0;
        nodes.forEach(function (x) { var sz = sizes[x], c = at[x]; colW[c % cols] = Math.max(colW[c % cols], sz.w); rowH[Math.floor(c / cols)] = Math.max(rowH[Math.floor(c / cols)], sz.h); });
        var colX = [], rowY = [], x0 = G.pad, y0 = G.pad;
        for (i = 0; i < cols; i++) { colX[i] = x0; x0 += colW[i] + G.gx; }
        for (j = 0; j < rows; j++) { rowY[j] = y0; y0 += rowH[j] + G.gy; }
        var pos = {};
        nodes.forEach(function (x) { var sz = sizes[x], c = at[x]; pos[x] = { x: colX[c % cols], y: rowY[Math.floor(c / cols)], w: sz.w, h: sz.h, c: c % cols, r: Math.floor(c / cols) }; });
        // channel k between column k-1 and k (0 and cols are the outer margins), the same for rows
        var vch = [], hch = [];
        for (i = 0; i <= cols; i++) vch[i] = i === 0 ? G.pad * 0.5 : i === cols ? colX[cols - 1] + colW[cols - 1] + G.pad * 0.5 : colX[i] - G.gx / 2;
        for (j = 0; j <= rows; j++) hch[j] = j === 0 ? G.pad * 0.5 : j === rows ? rowY[rows - 1] + rowH[rows - 1] + G.pad * 0.5 : rowY[j] - G.gy / 2;
        return { pos: pos, vch: vch, hch: hch, W: x0 - G.gx + G.pad, H: y0 - G.gy + G.pad };
      }

      // A route as a list of points with symbolic parts: a port on a box side, then channel moves.
      function route(g, p) {
        var A = g.pos[p.a], B = g.pos[p.b];
        var dc = B.c - A.c, dr = B.r - A.r;
        var right = dc > 0, down = dr > 0;
        if (dr === 0 && Math.abs(dc) === 1) return { kind: 'h', pts: [['side', p.a, right ? 'R' : 'L'], ['side', p.b, right ? 'L' : 'R']] };
        if (dc === 0 && Math.abs(dr) === 1) return { kind: 'v', pts: [['end', p.a, down ? 'B' : 'T'], ['end', p.b, down ? 'T' : 'B']] };
        if (Math.abs(dc) === 1) {
          // diagonal neighbours: out of the side, along the channel between them, into the other's side
          return { kind: 'L', pts: [['side', p.a, right ? 'R' : 'L'], ['v', right ? A.c + 1 : A.c], ['side', p.b, right ? 'L' : 'R']] };
        }
        if (Math.abs(dr) === 1) return { kind: 'L', pts: [['end', p.a, down ? 'B' : 'T'], ['h', down ? A.r + 1 : A.r], ['end', p.b, down ? 'T' : 'B']] };
        if (dr === 0) return { kind: 'U', pts: [['end', p.a, 'T'], ['h', A.r], ['end', p.b, 'T']] };
        if (dc === 0) return { kind: 'U', pts: [['side', p.a, 'R'], ['v', A.c + 1], ['side', p.b, 'R']] };
        return { kind: 'Z', pts: [['side', p.a, right ? 'R' : 'L'], ['v', right ? A.c + 1 : A.c], ['h', down ? B.r : B.r + 1], ['end', p.b, down ? 'T' : 'B']] };
      }

      function realise(at) {
        var g = geometry(at);
        var rs = pairs.map(function (p) { return { p: p, r: route(g, p) }; });
        // lanes: each line using a channel gets its own offset in it
        var lanes = {};
        rs.forEach(function (x, i) { x.r.pts.forEach(function (q) { if (q[0] === 'v' || q[0] === 'h') (lanes[q[0] + q[1]] = lanes[q[0] + q[1]] || []).push(i); }); });
        var laneOf = {};
        // where each line comes from, worked out once rather than in every comparison of the sort
        var keys = rs.map(function (x) { var A = g.pos[x.p.a], B = g.pos[x.p.b]; return (A.y + B.y) / 2 * 10 + (A.x + B.x) / 2 / 100; });
        Object.keys(lanes).forEach(function (k) {
          var list = lanes[k], step = 9;
          // order the lines in a channel by where they come from, so they do not braid
          list.sort(function (i, j) { return keys[i] - keys[j]; });
          list.forEach(function (i, idx) { laneOf[k + ':' + i] = (idx - (list.length - 1) / 2) * step; });
        });
        // ports: the lines on one side of a box spread along it
        var ports = {};
        rs.forEach(function (x, i) {
          [0, x.r.pts.length - 1].forEach(function (end) { var q = x.r.pts[end]; var id = q[1] + '|' + q[2]; (ports[id] = ports[id] || { name: q[1], sd: q[2], list: [] }).list.push([i, end]); });
        });
        var portAt = {};
        Object.keys(ports).forEach(function (id) {
          var list = ports[id].list, sd = ports[id].sd, b = g.pos[ports[id].name];
          // where the line's other end is, along this side — set on each end before the sort
          list.forEach(function (e) { var x = rs[e[0]], o = g.pos[e[1] === 0 ? x.p.b : x.p.a]; e[2] = sd === 'L' || sd === 'R' ? o.y + o.h / 2 : o.x + o.w / 2; });
          list.sort(function (u, v) { return u[2] - v[2]; });
          list.forEach(function (e, k) {
            var v2;
            if (sd === 'L' || sd === 'R') v2 = [sd === 'R' ? b.x + b.w : b.x, Math.min(b.y + G.fy + k * 16, b.y + b.h - 10)];
            else v2 = [b.x + b.w / 2 + (k - (list.length - 1) / 2) * 18, sd === 'B' ? b.y + b.h : b.y];
            portAt[e[0] + ':' + e[1]] = v2;
          });
        });
        var routes = rs.map(function (x, i) {
          var P = x.r.pts, out = [], start = portAt[i + ':0'], end = portAt[i + ':' + (P.length - 1)];
          out.push(start);
          var cur = start;
          for (var k = 1; k < P.length - 1; k++) {
            var q = P[k];
            if (q[0] === 'v') { var cx = g.vch[q[1]] + (laneOf['v' + q[1] + ':' + i] || 0); out.push([cx, cur[1]]); cur = [cx, cur[1]]; }
            else { var cy = g.hch[q[1]] + (laneOf['h' + q[1] + ':' + i] || 0); out.push([cur[0], cy]); cur = [cur[0], cy]; }
          }
          // the last bend lines up with the end port
          var lastQ = P[P.length - 1];
          if (P.length > 2) {
            if (lastQ[0] === 'side') out.push([cur[0], end[1]]); else out.push([end[0], cur[1]]);
          } else if (x.r.kind === 'h' && start[1] !== end[1]) { var mx = (start[0] + end[0]) / 2; out.push([mx, start[1]], [mx, end[1]]); }
          else if (x.r.kind === 'v' && start[0] !== end[0]) { var my = (start[1] + end[1]) / 2; out.push([start[0], my], [end[0], my]); }
          out.push(end);
          // drop repeated points and points on a straight run
          var clean = [];
          out.forEach(function (pt) {
            if (clean.length && clean[clean.length - 1][0] === pt[0] && clean[clean.length - 1][1] === pt[1]) return;
            if (clean.length >= 2) { var a = clean[clean.length - 2], b = clean[clean.length - 1]; if ((a[0] === b[0] && b[0] === pt[0]) || (a[1] === b[1] && b[1] === pt[1])) clean.pop(); }
            clean.push(pt);
          });
          return { p: x.p, pts: clean };
        });
        // the cost: crossings dominate, then length, then bends
        // Two lines cross where a level run passes strictly through an upright one of another
        // line (half a pixel in from the ends). Each level run is set only against the upright
        // runs whose x falls inside it, found in the list sorted by x: the layout's inner loop,
        // run for every swap it tries, so not every pair of runs.
        var hs = [], vs = [];
        routes.forEach(function (rt, i) {
          for (var k = 0; k < rt.pts.length - 1; k++) {
            var a = rt.pts[k], b = rt.pts[k + 1];
            if (a[1] === b[1]) hs.push({ i: i, y: a[1], x1: Math.min(a[0], b[0]), x2: Math.max(a[0], b[0]) });
            else vs.push({ i: i, x: a[0], y1: Math.min(a[1], b[1]), y2: Math.max(a[1], b[1]) });
          }
        });
        vs.sort(function (u, v) { return u.x - v.x; });
        var crossings = 0, len = 0, bends = 0;
        routes.forEach(function (rt) { bends += rt.pts.length - 2; for (var k = 0; k < rt.pts.length - 1; k++) len += Math.abs(rt.pts[k + 1][0] - rt.pts[k][0]) + Math.abs(rt.pts[k + 1][1] - rt.pts[k][1]); });
        for (var s1 = 0; s1 < hs.length; s1++) {
          var hz = hs[s1], lo = hz.x1 + 0.5, hi = hz.x2 - 0.5, from = 0, to = vs.length;
          while (from < to) { var mid = (from + to) >> 1; if (vs[mid].x > lo) to = mid; else from = mid + 1; }
          for (var s2 = from; s2 < vs.length && vs[s2].x < hi; s2++) {
            var vt = vs[s2];
            if (vt.i !== hz.i && hz.y > vt.y1 + 0.5 && hz.y < vt.y2 - 0.5) crossings++;
          }
        }
        return { pos: g.pos, routes: routes, W: g.W, H: g.H, crossings: crossings, cost: crossings * 100000 + len + bends * 40 };
      }

      // improve: swap two cells (a node with a node or with an empty cell) while it helps
      var bestR = realise(at), started = Date.now();
      var improved = true, passes = 0;
      while (improved && passes < 8 && Date.now() - started < 700) {
        improved = false; passes++;
        for (var c1 = 0; c1 < cells; c1++) for (var c2 = c1 + 1; c2 < cells; c2++) {
          var x1 = taken[c1], x2 = taken[c2];
          if (!x1 && !x2) continue;
          if (x1) at[x1] = c2; if (x2) at[x2] = c1;
          var tryR = realise(at);
          if (tryR.cost < bestR.cost - 0.01) { bestR = tryR; taken[c1] = x2; taken[c2] = x1; improved = true; }
          else { if (x1) at[x1] = c1; if (x2) at[x2] = c2; }
        }
      }
      return bestR;
    }

    // ================================================================ mount
    function mount(data, host, opts) {
      opts = opts || {};
      var st = { view: 'start', module: null, seg: 'microflow', key: null, entity: null, q: '' };
      if (opts.state) Object.keys(opts.state).forEach(function (k) { st[k] = opts.state[k]; });
      var theme = opts.theme || 'auto';
      if (!opts.preview && !opts.only) { try { theme = localStorage.getItem('mxdocs-theme') || theme; } catch (e) { /* storage may be blocked */ } }

      // opts.only = 'domain': one page, embedded in MxScout's own Entities
      // screen — no sidebar, no search of its own (the app has one).
      if (opts.only) st.view = opts.only;
      var root = h('div', { class: 'dx' + (opts.preview ? ' preview' : '') + (opts.only ? ' dx-only' : '') });
      // The report is the project's, not the tool's (redesign spec 10): its
      // mark is the project's first letter, and no tool is named anywhere.
      var titleEl = h('h1'), subEl = h('p', { class: 'dx-sub' });
      // The field in the sidebar opens the search dialog (see openSearch); typing into it starts the search there.
      var searchBtn = h('button', { type: 'button', class: 'dx-searchbox', 'aria-haspopup': 'dialog', 'aria-label': 'Search everything', onclick: function () { openSearch(); } },
        [navIcon('search', 15), h('span', { class: 'dx-search', text: 'Search modules, flows, pages, entities…' }), h('kbd', { text: 'Ctrl K' })]);
      searchBtn.addEventListener('keydown', function (e) { if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); openSearch(e.key); } });
      var themeBtns = {};
      var themeBox = h('div', { class: 'dx-theme', role: 'group', 'aria-label': 'Theme' }, [['light', 'sun', 'Light'], ['dark', 'moon', 'Dark'], ['auto', 'monitor', 'Auto']].map(function (t) {
        themeBtns[t[0]] = h('button', { type: 'button', title: t[2] === 'Auto' ? 'Follow the system' : t[2] + ' theme', 'aria-label': t[2] === 'Auto' ? 'Follow the system' : t[2] + ' theme', onclick: function () { setTheme(t[0]); } }, [navIcon(t[1], 14), h('span', { text: t[2] })]);
        return themeBtns[t[0]];
      }));
      // The same documentation as one Markdown file (spec 20), made here from this file's own data and
      // handed to the browser's download; nothing is sent anywhere.
      function mdButton() {
        return h('button', { type: 'button', class: 'dx-md-dl', onclick: function () {
          var url = URL.createObjectURL(new Blob([markdown(data)], { type: 'text/markdown;charset=utf-8' }));
          var a = h('a', { href: url, download: markdownName(data) });
          doc.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
        } }, [navIcon('download', 14), 'Download as Markdown']);
      }
      // Risks, the developers' context, the architecture and the processes exist only when an agent wrote them (describe.js), so their pages too.
      // data.ai.risks: the risks that count; data.ai.triaged: the ones marked fixed, false positive or no
      // longer reported (triage.js), shown only on the Risks page. A risk's address is its place in both.
      var risks = data.ai && data.ai.risks || [], triaged = data.ai && data.ai.triaged || [], allRisks = risks.concat(triaged), devCtx = data.ai && data.ai.context || null, c4 = data.ai && data.ai.c4 || null;
      var procs = data.ai && data.ai.app && data.ai.app.processes || [];
      // The Assist page: only in MxScout, which hands it the items (opts.assist) — never in the exported file.
      var assist = opts.assist || null;
      // The solved cases (docs-knowledge.js): handed over by MxScout (opts.cases), or in the file's data when the export was asked for them.
      var cases = opts.cases || (data.cases && data.cases.length ? { items: function () { return data.cases; } } : null);
      function assistOpen() { return (assist.items() || []).filter(function (x) { return x.status === 'open' || x.status === 'in-progress' || x.status === 'waiting'; }).length; }
      // The application's full description lives on Processes (as its item 0), so the page is there when either is.
      var procPage = !!(data.ai && data.ai.app && (procs.length || data.ai.app.story || data.ai.app.summary));
      var devCount = devCtx ? devCtx.where.length + devCtx.conventions.length + devCtx.pitfalls.length : 0;
      // The sidebar as MxScout's own (Karol, 2026-10-14: the report looks like MxScout, without
      // what needs the running app): what the application is, the model, the review. Microflows,
      // nanoflows and pages are three entries, each the flow screen on its kind.
      var GROUPS = [
        ['Application', [['start', 'Overview', 'home'], procPage ? ['processes', 'Processes', 'proc'] : null, ['modules', 'Modules', 'module'], ['arch', 'Architecture', 'arch']]],
        ['Model', [['domain', 'Entities', 'entity'], ['refs:microflow', 'Microflows', 'flow'], ['refs:nanoflow', 'Nanoflows', 'nano'], ['refs:page', 'Pages', 'page']]],
        ['Review', [allRisks.length ? ['risks', 'Risks', 'risk'] : null, assist ? ['assist', 'Assist', 'ticket'] : null, cases ? ['cases', 'Solved cases', 'case'] : null, ['quality', 'Model quality', 'quality'], devCtx ? ['dev', 'For developers', 'dev'] : null]]
      ].map(function (g) { return [g[0], g[1].filter(Boolean)]; });
      var NAV = [];
      GROUPS.forEach(function (g) { g[1].forEach(function (r) { var v = r[0].split(':')[0]; if (!NAV.some(function (x) { return x[0] === v; })) NAV.push([v, r[1], r[2]]); }); });
      var counts = { processes: procs.length, modules: data.kpi.modules, 'refs:microflow': data.kpi.microflows, 'refs:nanoflow': data.kpi.nanoflows, 'refs:page': data.kpi.pages, domain: data.kpi.entities,
        quality: data.quality.unreached.length, risks: risks.length, dev: devCount, cases: cases ? (cases.items() || []).length : 0 };
      var navBtns = {};
      var initial = String(data.project || '?').charAt(0).toUpperCase();
      var side = h('nav', { class: 'dx-side', 'aria-label': 'Documentation' }, [
        // the project, as MxScout's switcher shows it: its letter, its name, the model it was read from
        h('div', { class: 'dx-brand' }, [h('span', { class: 'dx-brand-tile', 'aria-hidden': 'true', text: initial }), h('div', { class: 'dx-brand-text' }, [h('b', { text: data.project }),
          h('small', { text: (data.mendix ? 'Mendix ' + data.mendix + ' · ' : '') + 'model of ' + fmtDate(data.generatedAt) })])]),
        h('div', { class: 'dx-nav' }, GROUPS.map(function (g) {
          return h('div', { class: 'dx-nav-group' }, [h('span', { class: 'dx-nav-cap', text: g[0] })].concat(g[1].map(function (r) {
            var parts = r[0].split(':');
            navBtns[r[0]] = h('button', { type: 'button', class: 'dx-nav-item', onclick: function () { go(parts[1] ? { view: 'refs', seg: parts[1], key: null } : { view: r[0] }); } },
              [navIcon(r[2], 16), h('span', { class: 'dx-nav-label', text: r[1] }), counts[r[0]] !== undefined ? h('span', { class: 'dx-count', text: String(counts[r[0]]) }) : null]);
            return navBtns[r[0]];
          })));
        })),
        h('div', { class: 'dx-side-foot' }, [
          opts.preview ? null : mdButton(),
          themeBox
        ])
      ]);
      // A page's own controls in its header (a filter, Copy link) — filled by the page, emptied on every draw.
      var headTools = h('div', { class: 'dx-head-tools' });
      // The header as MxScout's: the page's name and what it is for, its own tools, the search.
      var head = h('header', { class: 'dx-page-head' }, [h('div', { class: 'dx-title' }, [titleEl, subEl]), headTools, opts.only ? null : searchBtn, opts.actions ? h('div', { class: 'dx-actions' }, opts.actions) : null]);
      var list = h('aside', { class: 'dx-list' });
      var main = h('main', { class: 'dx-main' });
      // The overview's contents list follows the scroll; other pages leave this empty.
      var onScroll = null;
      main.addEventListener('scroll', function () { if (onScroll) onScroll(); }, { passive: true });
      var island = h('div', { class: 'dx-island' }, [head, h('div', { class: 'dx-body' }, [list, main])]);
      add(root, [side, island]);
      clear(host).appendChild(root);

      function setTheme(t) {
        theme = t;
        if (!opts.preview && !opts.only) { try { localStorage.setItem('mxdocs-theme', t); } catch (e) { /* fine */ } }
        root.setAttribute('data-theme', themeOf(t));
        Object.keys(themeBtns).forEach(function (k) { themeBtns[k].classList.toggle('on', k === t); themeBtns[k].setAttribute('aria-pressed', k === t ? 'true' : 'false'); });
      }
      setTheme(theme);

      // ---------- navigation ----------
      function go(patch) {
        // Embedded in MxScout (opts.only), a link to another page is MxScout's to follow: it opens
        // the app's own screen for it (opts.route), not that page inside this one.
        if (opts.only && opts.route && patch.view !== undefined && patch.view !== st.view && opts.route(patch)) return;
        // A page's place on another page (a section, a risk, a check) does not follow the reader to a new page.
        if (patch.view !== undefined) { if (patch.view !== st.view) st.sub = null; st.sec = null; }
        // Risks reached from another page start unfiltered, so the finding it names is on the list.
        if (patch.view === 'risks' && st.view !== 'risks') { rf = { lv: null, th: null, mod: null, q: '', group: rf.group, st: null, or: null }; rkY = 0; }
        // A link to a risk that no longer counts opens it under All, where it is listed.
        if (patch.view === 'risks' && patch.sub && !rf.st && riskIndexOf(patch.sub) >= risks.length) rf.st = 'all';
        if (patch.view !== undefined && patch.view !== st.view) { st.dmod = null; st.dq = ''; }
        // Another flow: its own first step, nothing traced.
        if (patch.key !== undefined && patch.key !== st.key) { st.step = patch.step || null; st.trace = null; }
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

      // The Risks page's filters (see drawRisks), here because the address restores them.
      // st: the status filter (null is Open), or: whose risks (null both, 'ai', 'person').
      var rf = { lv: null, th: null, mod: null, q: '', group: 'sev', st: null, or: null };
      if (opts.riskFilter) Object.keys(opts.riskFilter).forEach(function (k) { rf[k] = opts.riskFilter[k]; });
      // Where the findings list was scrolled: a click on a finding draws the page again, and the
      // list stays where the reader left it (Karol, 2026-10-13: it kept jumping to the bottom).
      var rkY = 0;
      var riskRows = null;

      // ---------- the address (redesign spec 10 §3) ----------
      // Every state a reader may want to send someone has an address, so
      // "Copy link" copies something that opens exactly that.
      //   #/                      Overview, ?s=users etc. for one of its sections
      //   #/processes/{n}         0 = the whole application, 1.. = a process
      //   #/assist/{kind}/{id}    an item on the Assist page (in MxScout only); #/tickets/{id} and #/changes/{id} open it there too
      //   #/modules/{Module}
      //   #/flows/{Module.Name}   ?seg=all|mf|nf|pg the list, ?step=N the step, ?var=Name the trace
      //   #/domain/{Module}/{Entity}
      //   #/architecture?s={section}  #/risks/{R-012}  #/quality/{check}  #/developers/{tab}
      var ROUTE_OF = { start: '', processes: 'processes', assist: 'assist', cases: 'cases', modules: 'modules', refs: 'flows', domain: 'domain', arch: 'architecture', risks: 'risks', quality: 'quality', dev: 'developers' };
      var VIEW_OF = {};
      Object.keys(ROUTE_OF).forEach(function (k) { VIEW_OF[ROUTE_OF[k]] = k; });
      // Addresses written before these routes existed still open.
      ['start', 'refs', 'arch', 'dev'].forEach(function (k) { VIEW_OF[k] = k; });
      var SEG = { mf: 'microflow', nf: 'nanoflow', pg: 'page', all: 'all' };
      var SEG_OF = { microflow: 'mf', nanoflow: 'nf', page: 'pg', all: 'all' };
      function flowKey(qn, seg) {
        var order = seg && SEG[seg] && seg !== 'all' ? [SEG[seg]] : ['microflow', 'nanoflow', 'page'];
        for (var i = 0; i < order.length; i++) if (data.flows[order[i] + ':' + qn]) return order[i] + ':' + qn;
        return data.flows[qn] ? qn : null;
      }
      function readHash() {
        var m = /^#\/([^/?]*)(?:\/([^?]*))?(?:\?(.*))?$/.exec(location.hash || '');
        if (!m) return;
        var q = {};
        (m[3] || '').split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); });
        // The Tickets and Changes pages became the Assist page's tabs (2026-10-15).
        var view = m[1] === 'tickets' || m[1] === 'changes' ? 'assist' : VIEW_OF[m[1]];
        if (view === undefined) return;
        st.view = view || 'start';
        var arg = m[2] ? decodeURIComponent(m[2]) : null;
        if (st.view === 'refs') {
          var k = arg ? flowKey(arg, q.seg) : null;
          st.key = k; st.seg = SEG[q.seg] || (k ? data.flows[k].kind : 'microflow');
          if (k) st.module = data.flows[k].module;
          st.step = /^\d+$/.test(q.step || '') ? Number(q.step) : null;
          st.trace = q['var'] || null;
        }
        if (st.view === 'domain' && arg) { var e = arg.replace('/', '.'); st.entity = data.entities[e] ? e : arg; st.dmodule = arg.split('/')[0]; }
        if (st.view === 'domain') st.dview = q.view === 'list' ? 'list' : null;
        if (st.view === 'modules' && arg) st.module = arg;
        if (st.view === 'modules') { st.mtab = q.tab || null; st.msort = q.sort || null; }
        if (st.view === 'arch') { st.amod = q.mod || null; st.arole = q.role || null; }
        if (st.view === 'dev') { st.dmod = q.mod || null; st.dq = q.q || ''; }
        if (st.view === 'processes') st.proc = arg && /^\d+$/.test(arg) ? Number(arg) : 0;
        if (st.view === 'assist') {
          var ak = m[1] === 'tickets' ? ['ticket'].concat(arg ? [arg] : []) : m[1] === 'changes' ? ['idea'].concat(arg ? [arg] : []) : String(arg || '').split('/');
          st.akind = ak[0] || null; st.aid = ak[1] || null;
        }
        if (st.view === 'risks' || st.view === 'quality' || st.view === 'dev') st.sub = arg;
        if (st.view === 'cases') st.cid = arg ? 'knowledge/' + arg + '.md' : null;
        if (st.view === 'risks') rf = { lv: /^P[123]$/.test(q.lv) ? q.lv : null, th: PAT[q.th] ? q.th : null, mod: q.mod || null, q: q.q || '', group: q.group === 'mod' ? 'mod' : 'sev',
          st: /^(fixed|verified|fp|gone|all)$/.test(q.st || '') ? q.st : null, or: q.by === 'ai' || q.by === 'person' ? q.by : null };
        if (st.view === 'risks' && arg && !rf.st && riskIndexOf(arg) >= risks.length) rf.st = 'all';
        st.sec = (st.view === 'start' || st.view === 'arch') && q.s ? q.s : null;
      }
      function hashOf(s) {
        var r = ROUTE_OF[s.view] === undefined ? '' : ROUTE_OF[s.view];
        var arg = null, q = null;
        if (s.view === 'refs') {
          var f = s.key && data.flows[s.key], seg = s.seg || (f ? f.kind : 'microflow'), qs = [];
          if (f) arg = f.qn;
          // The list's kind when it is not the item's own, or when the name alone would open another kind.
          if (f ? seg !== f.kind || flowKey(f.qn) !== s.key : seg !== 'microflow') qs.push('seg=' + (SEG_OF[seg] || 'all'));
          if (f && s.step) qs.push('step=' + s.step);
          if (f && s.trace) qs.push('var=' + encodeURIComponent(s.trace));
          q = qs.join('&') || null;
        }
        if (s.view === 'domain' && s.entity) arg = String(s.entity).replace('.', '/');
        if (s.view === 'domain' && s.dview === 'list') q = 'view=list';
        if (s.view === 'modules' && s.module) arg = s.module;
        if (s.view === 'processes') arg = String(s.proc || 0);
        if (s.view === 'assist' && s.akind) arg = s.akind + (s.aid ? '/' + s.aid : '');
        if (s.view === 'cases' && s.cid) arg = String(s.cid).replace(/^knowledge\//, '').replace(/\.md$/, '');
        if ((s.view === 'risks' || s.view === 'quality' || s.view === 'dev') && s.sub) arg = s.sub;
        if ((s.view === 'start' || s.view === 'arch') && s.sec) q = 's=' + encodeURIComponent(s.sec);
        if (s.view === 'modules' || s.view === 'arch' || s.view === 'dev') {
          var mq = q ? [q] : [];
          if (s.view === 'modules' && s.mtab) mq.push('tab=' + s.mtab);
          if (s.view === 'modules' && s.msort && s.msort !== 'az') mq.push('sort=' + s.msort);
          if (s.view === 'arch' && s.amod) mq.push('mod=' + encodeURIComponent(s.amod));
          if (s.view === 'arch' && s.arole) mq.push('role=' + encodeURIComponent(s.arole));
          if (s.view === 'dev' && s.dmod) mq.push('mod=' + encodeURIComponent(s.dmod));
          if (s.view === 'dev' && s.dq) mq.push('q=' + encodeURIComponent(s.dq));
          q = mq.join('&') || null;
        }
        if (s.view === 'risks') {
          var rq = [];
          if (rf.lv) rq.push('lv=' + rf.lv);
          if (rf.th) rq.push('th=' + rf.th);
          if (rf.mod) rq.push('mod=' + encodeURIComponent(rf.mod));
          if (rf.q) rq.push('q=' + encodeURIComponent(rf.q));
          if (rf.group === 'mod') rq.push('group=mod');
          if (rf.st) rq.push('st=' + rf.st);
          if (rf.or) rq.push('by=' + rf.or);
          q = rq.join('&') || null;
        }
        return '#/' + r + (arg ? '/' + arg.split('/').map(encodeURIComponent).join('/') : '') + (q ? '?' + q : '');
      }
      function writeHash() {
        var h2 = hashOf(st);
        if (location.hash !== h2) history.pushState(null, '', h2);
      }
      // A way to another page. In the file it is a real link to that page's
      // address, so it can be opened in a new tab or copied; in MxScout's own
      // previews, which have no addresses, a button. Either way a click goes
      // there in place — or does `onClick` instead, when given.
      function ln(patch, attrs, kids, onClick) {
        var a = h(opts.hash ? 'a' : 'button', attrs, kids);
        if (opts.hash) {
          var to = {};
          Object.keys(st).forEach(function (k) { to[k] = st[k]; });
          to.sub = null; to.sec = null;
          Object.keys(patch).forEach(function (k) { to[k] = patch[k]; });
          a.setAttribute('href', hashOf(to));
        } else a.setAttribute('type', 'button');
        a.addEventListener('click', function (e) {
          if (opts.hash && (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1)) return;
          e.preventDefault();
          if (onClick) onClick(); else go(patch);
        });
        return a;
      }
      // A risk's address: its place in the file's list, counted from 1 (redesign spec 17).
      function riskId(i) { var n = String((allRisks[i] && allRisks[i].no) || i + 1); return 'R-' + (n.length < 3 ? ('00' + n).slice(-3) : n); }
      function riskModule(r) { var w = (r.where || [])[0]; return w ? String(w).split('|')[0].split('.')[0] : ''; }
      if (opts.hash) { readHash(); window.addEventListener('popstate', function () { readHash(); draw(); }); }

      // ---------- search everything (spec 10 [LUKA]; Karol, 2026-10-13: a dialog, names and text) ----------
      // Ctrl K or the field in the sidebar opens a dialog over the page. Names
      // first, grouped by what they are — modules, processes, flows, pages,
      // entities, risks — then the places the words occur in the text: what an
      // agent wrote about a flow, a module, a process, a risk, the notes for
      // developers. Each result goes to the address of what it found.
      // Matching ignores case and accents; text is set as text, a match marked.
      function fold(str) {
        var s2 = String(str || ''), out2 = '';
        for (var i = 0; i < s2.length; i++) { var c = s2.charAt(i), f = c.normalize ? c.normalize('NFD').replace(/[̀-ͯ]/g, '') : c; out2 += (f || c).charAt(0).toLowerCase(); }
        return out2;
      }
      var searchIndex = null;
      function buildIndex() {
        var names = [], texts = [];
        function name(group, label, sub, badge, patch, extra) { names.push({ group: group, label: label, sub: sub, badge: badge, patch: patch, f: fold(label), f2: fold(extra || '') }); }
        function text(where, kindLabel, body, patch) { if (body) texts.push({ where: where, kind: kindLabel, body: String(body).replace(/\s+/g, ' '), f: fold(String(body).replace(/\s+/g, ' ')), patch: patch }); }
        data.modules.forEach(function (m) { name('Modules', m.name, m.marketplace ? 'Marketplace module' : 'own module', 'MOD', { view: 'modules', module: m.name }); });
        procs.forEach(function (p, i) { name('Processes', p.name, 'process ' + pad2(i + 1), pad2(i + 1), { view: 'processes', proc: i + 1 }); });
        var KG = { microflow: ['Microflows', 'MF'], nanoflow: ['Nanoflows', 'NF'], page: ['Pages', 'PG'] };
        Object.keys(data.flows).forEach(function (k) { var f = data.flows[k], g = KG[f.kind]; if (g) name(g[0], f.name, f.module, g[1], { view: 'refs', module: f.module, seg: f.kind, key: k }, f.qn); });
        Object.keys(data.entities).forEach(function (q) { var e = data.entities[q]; name('Entities', e.name, e.module, 'EN', { view: 'domain', entity: q, dmodule: e.module }, q); });
        risks.forEach(function (r, i) { name('Risks', r.title, riskId(i) + ' · ' + LV[r.level][0], r.level, { view: 'risks', sub: riskId(i) }); });
        // what an agent wrote
        var app2 = data.ai && data.ai.app;
        if (app2) { text('The application', 'description', [app2.summary, app2.story].filter(Boolean).join(' '), { view: 'processes', proc: 0 }); }
        procs.forEach(function (p, i) { text(p.name, 'process', [p.summary, p.story].concat(p.steps).filter(Boolean).join(' '), { view: 'processes', proc: i + 1 }); });
        Object.keys((data.ai && data.ai.modules) || {}).forEach(function (m) {
          var md = data.ai.modules[m];
          text(m, 'module', [md.summary, md.story].concat((md.notes || []).map(function (n) { return [n.title, n.text].concat(n.items || [], n.table ? n.table.rows.map(function (r) { return r.join(' '); }) : []).filter(Boolean).join(' '); })).filter(Boolean).join(' '), { view: 'modules', module: m });
        });
        Object.keys(data.flows).forEach(function (k) { var f = data.flows[k]; if (f.desc) text(f.qn, f.kind, f.desc, { view: 'refs', module: f.module, seg: f.kind, key: k }); });
        Object.keys(data.entities).forEach(function (q) { var e = data.entities[q]; if (e.desc) text(q, 'entity', e.desc, { view: 'domain', entity: q, dmodule: e.module }); });
        risks.forEach(function (r, i) { text(riskId(i) + ' · ' + r.title, 'risk', [r.detail, r.fix].filter(Boolean).join(' '), { view: 'risks', sub: riskId(i) }); });
        if (devCtx) {
          devCtx.where.forEach(function (x) { text(x[0], 'where things are', x[1], { view: 'dev', sub: 'where' }); });
          devCtx.conventions.forEach(function (x) { text(x[0], 'naming', x[1], { view: 'dev', sub: 'conv' }); });
          devCtx.pitfalls.forEach(function (x, i) { text('Before you change · ' + pad2(i + 1), 'pitfall', x, { view: 'dev', sub: 'pit' }); });
        }
        return { names: names, texts: texts };
      }
      var GROUPS = ['Modules', 'Processes', 'Changes', 'Microflows', 'Nanoflows', 'Pages', 'Entities', 'Risks', 'Tickets'];
      var searchUi = null;
      function marked(str, at, len) {
        if (at < 0) return [str];
        return [str.slice(0, at), h('mark', { text: str.slice(at, at + len) }), str.slice(at + len)];
      }
      function openSearch(initial) {
        if (opts.preview) return;
        if (!searchIndex) searchIndex = buildIndex();
        if (searchUi) { searchUi.input.focus(); return; }
        var input = h('input', { type: 'text', class: 'dx-sd-q', placeholder: 'Search names and text', 'aria-label': 'Search the documentation', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'dx-sd-list', 'aria-autocomplete': 'list', autocomplete: 'off', spellcheck: 'false' });
        var listEl = h('div', { class: 'dx-sd-list', id: 'dx-sd-list', role: 'listbox', 'aria-label': 'Results' });
        var open = {}, rows = [], active = 0;
        var dialog = h('div', { class: 'dx-sd', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Search everything' }, [
          h('div', { class: 'dx-sd-head' }, [navIcon('search', 16), input, h('kbd', { text: 'Esc' })]), listEl,
          h('div', { class: 'dx-sd-foot' }, [h('span', null, [h('kbd', { text: '↑' }), h('kbd', { text: '↓' }), ' to move']), h('span', null, [h('kbd', { text: 'Enter' }), ' to open']), h('span', { class: 'dx-sd-n' })])
        ]);
        var scrim = h('div', { class: 'dx-sd-scrim', onclick: function (e) { if (e.target === scrim) close(); } }, [dialog]);
        function close() { if (!searchUi) return; scrim.remove(); searchUi = null; searchBtn.focus(); }
        function pick(row) { close(); go(row.patch); }
        function setActive(i) {
          if (!rows.length) return;
          active = (i + rows.length) % rows.length;
          rows.forEach(function (r, k) { r.el.classList.toggle('on', k === active); r.el.setAttribute('aria-selected', k === active ? 'true' : 'false'); });
          input.setAttribute('aria-activedescendant', rows[active].el.id);
          var el2 = rows[active].el;
          if (el2.scrollIntoView) el2.scrollIntoView({ block: 'nearest' });
        }
        function row(r, kids) {
          var el2 = h('div', { class: 'dx-sd-row', role: 'option', id: 'dx-sd-o' + rows.length, 'aria-selected': 'false' }, kids);
          var idx = rows.length;
          el2.addEventListener('mousemove', function () { if (active !== idx) setActive(idx); });
          el2.addEventListener('click', function () { pick(r); });
          rows.push({ el: el2, patch: r.patch });
          return el2;
        }
        function run() {
          var q = input.value.trim(), fq = fold(q);
          clear(listEl); rows = []; active = 0;
          var counter = dialog.querySelector('.dx-sd-n');
          if (!fq) { listEl.appendChild(h('p', { class: 'dx-sd-empty', text: 'Type a name — a module, a flow, a page, an entity, a risk — or any word from the descriptions.' })); counter.textContent = ''; return; }
          var total = 0;
          GROUPS.forEach(function (g) {
            var hits = searchIndex.names.filter(function (x) { return x.group === g && (x.f.indexOf(fq) !== -1 || x.f2.indexOf(fq) !== -1); });
            if (!hits.length) return;
            total += hits.length;
            hits.sort(function (a, b) { var pa = a.f.indexOf(fq) === 0 ? 0 : a.f.indexOf(fq) !== -1 ? 1 : 2, pb = b.f.indexOf(fq) === 0 ? 0 : b.f.indexOf(fq) !== -1 ? 1 : 2; return pa - pb || a.label.length - b.label.length || a.label.localeCompare(b.label); });
            var shown = open[g] ? hits : hits.slice(0, 6);
            listEl.appendChild(h('div', { class: 'dx-sd-g', role: 'presentation' }, [h('span', { class: 'dx-cap', text: g }), h('span', { class: 'mono dx-fc-n', text: String(hits.length) })]));
            shown.forEach(function (x) {
              listEl.appendChild(row(x, [h('span', { class: 'dx-sd-b' + (/^P[123]$/.test(x.badge) ? ' dx-lv ' + x.badge.toLowerCase() : ' dx-kind' + (x.badge === 'MF' ? ' mf' : x.badge === 'NF' ? ' nf' : '')), text: x.badge }),
                h('span', { class: 'dx-sd-t' + (g === 'Risks' || g === 'Processes' || g === 'Changes' || g === 'Tickets' ? '' : ' mono') }, marked(x.label, x.f.indexOf(fq), fq.length)), h('small', { text: x.sub })]));
            });
            if (hits.length > shown.length) listEl.appendChild(h('button', { type: 'button', class: 'dx-sd-more', text: 'Show all ' + hits.length, onclick: function () { open[g] = true; run(); input.focus(); } }));
          });
          var th = searchIndex.texts.filter(function (x) { return x.f.indexOf(fq) !== -1; });
          if (th.length) {
            total += th.length;
            var shownT = open.text ? th : th.slice(0, 8);
            listEl.appendChild(h('div', { class: 'dx-sd-g', role: 'presentation' }, [h('span', { class: 'dx-cap', text: 'In the text an agent wrote' }), h('span', { class: 'mono dx-fc-n', text: String(th.length) })]));
            shownT.forEach(function (x) {
              var at = x.f.indexOf(fq), from = Math.max(0, at - 50), to = Math.min(x.body.length, at + fq.length + 70);
              var snip = (from ? '…' : '') + x.body.slice(from, to) + (to < x.body.length ? '…' : '');
              listEl.appendChild(row(x, [h('span', { class: 'dx-sd-b dx-kind', text: '¶' }),
                h('span', { class: 'dx-sd-tt' }, [h('b', { text: x.where }), h('small', { text: ' · ' + x.kind }), h('span', { class: 'dx-sd-snip' }, marked(snip, at - from + (from ? 1 : 0), fq.length))])]));
            });
            if (th.length > shownT.length) listEl.appendChild(h('button', { type: 'button', class: 'dx-sd-more', text: 'Show all ' + th.length, onclick: function () { open.text = true; run(); input.focus(); } }));
          }
          if (!total) listEl.appendChild(h('p', { class: 'dx-sd-empty', text: 'Nothing matches “' + q + '”.' }));
          counter.textContent = total ? plural(total, 'result', 'results') : '';
          setActive(0);
        }
        input.addEventListener('input', function () { open = {}; run(); });
        input.addEventListener('keydown', function (e) {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
          else if (e.key === 'Enter') { e.preventDefault(); if (rows[active]) pick(rows[active]); }
          else if (e.key === 'Escape') { e.preventDefault(); close(); }
        });
        // keep the focus inside the dialog
        scrim.addEventListener('keydown', function (e) { if (e.key === 'Tab') { e.preventDefault(); input.focus(); } });
        root.appendChild(scrim);
        searchUi = { input: input, close: close };
        if (initial) input.value = initial;
        run();
        input.focus();
      }
      if (!opts.preview && !opts.only) {
        doc.addEventListener('keydown', function (e) {
          if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K') && root.isConnected) { e.preventDefault(); openSearch(); }
          if (e.key === 'Escape' && st.view === 'refs' && fu.mode === 'modeler' && fu.studio && !searchUi) { fu.studio = false; fu.step = null; st.step = null; if (opts.hash) writeHash(); draw(); }
        });
      }

      // ---------- drawing ----------
      // A page this data has no drawing for — an address of the Tickets or Changes pages there were — is the Overview.
      var DRAW = { start: drawStart, processes: drawProcesses, assist: drawAssist, cases: drawCases, modules: drawModules, refs: drawRefs, domain: drawDomain, quality: drawQuality, risks: drawRisks, dev: drawDev, arch: drawArch };
      function draw() {
        Object.keys(navBtns).forEach(function (k) { navBtns[k].classList.toggle('on', k === st.view || (st.view === 'refs' && k === 'refs:' + (st.seg === 'nanoflow' || st.seg === 'page' ? st.seg : 'microflow'))); });
        var kept = scrollsOf(root);
        clear(list); clear(main); clear(headTools);
        if ((st.view === 'risks' && !allRisks.length) || (st.view === 'dev' && !devCtx) || (st.view === 'processes' && !procPage) || (st.view === 'assist' && !assist) || (st.view === 'cases' && !cases) || !DRAW[st.view]) st.view = 'start';
        onScroll = null;
        root.setAttribute('data-view', st.view);
        // The page's own scrolling boxes keep their place while it is the same page and the same item on it —
        // drawn again by a click on it, or with the whole app around it (a change in the project's folder, a
        // message going away: Karol, 2026-10-15, "the page jumps back to the top by itself"). Another page, or
        // another item, has another key, and starts at the top.
        var place = (opts.only || (opts.preview ? 'preview' : 'file')) + '|' + hashOf(st).split('?')[0];
        main.setAttribute('data-keep-scroll', 'dx-main|' + place);
        list.setAttribute('data-keep-scroll', 'dx-list|' + (opts.only || (opts.preview ? 'preview' : 'file')) + '|' + st.view + '|' + (st.view === 'assist' ? st.akind || '' : ''));
        root.classList.toggle('no-list', st.view === 'refs' || st.view === 'domain' || st.view === 'start' || st.view === 'quality' || st.view === 'risks' || st.view === 'dev' || st.view === 'arch');
        DRAW[st.view]();
        putScrolls(root, kept);
      }
      // A page's own controls: in the file, in the header beside its title. Embedded in MxScout,
      // where the screen's header names the page, each page keeps them where they act (Karol,
      // 2026-10-14: a second header row, empty or with one control at its right, took room for
      // nothing): `place(node)` puts them there, or the page leaves them out.
      function tools(node, place) { if (!opts.only) add(headTools, node); else if (place) place(node); }
      function setTitle(t, sub) { titleEl.textContent = t; subEl.textContent = sub; if (opts.onTitle) opts.onTitle(t, sub); }
      function crumbs(parts) {
        return h('div', { class: 'dx-crumbs' }, parts.map(function (p, i) {
          var last = i === parts.length - 1;
          return [i ? h('span', { class: 'dx-sep', text: '/' }) : null, last || !p[1] ? h('b', { text: p[0] }) : h('button', { type: 'button', class: 'dx-link', text: p[0], onclick: p[1] })];
        }));
      }
      // ---------- overview (redesign spec 11) ----------
      // One document, in the order a newcomer asks: what is it, who uses it,
      // what does it talk to, what does it do, what needs attention, where
      // next. Numbers are read from the model; the sentences an agent wrote
      // are the hero's note's business, and the page says so once, up top.
      function drawStart() {
        var k = data.kpi, q = data.quality, app = data.ai && data.ai.app || null;
        setTitle('Overview', 'What this application is, who uses it and how it is built');
        var secs = [];
        function section(id, label, title, sub, more, body) {
          var node = h('section', { class: 'dx-ov-sec', 'data-sec': id }, [
            h('div', { class: 'dx-ov-sec-h' }, [h('div', { class: 'dx-ov-sec-t' }, [h('h2', { text: title }), sub ? h('p', null, sub) : null]), more || null]),
            body
          ]);
          secs.push({ id: id, label: label, node: node });
          return node;
        }
        function more(patch, label) { return ln(patch, { class: 'dx-more-link' }, [label, navIcon('arrow', 13)]); }

        // 1. what it is, and the facts at a glance
        var sum = app && app.summary ? firstSentence(app.summary) : null;
        var kinds = [];
        (data.services || []).forEach(function (sv) { if (sv.kind && kinds.indexOf(sv.kind) === -1) kinds.push(sv.kind); });
        var ver = data.version;
        var facts = [
          data.mendix ? ['Mendix', data.mendix] : null,
          // Which version of the app, from the Mendix project's git: "main @ a1b2c3d · 14.10.2026 · “Fix order status”".
          ver ? ['Version', (ver.branch ? ver.branch + ' @ ' : '') + ver.short, [ver.date ? fmtDate(ver.date).slice(0, 10) : null, ver.message ? '“' + ver.message + '”' : null].filter(Boolean).join(' · ') || null] : null,
          ['Model read', fmtDate(data.generatedAt)],
          ['Modules', k.modules, k.marketplace ? '+' + k.marketplace + ' Marketplace' : 'all own', { view: 'modules' }],
          ['Microflows', k.microflows, null, { view: 'refs', seg: 'microflow', key: null }],
          ['Nanoflows', k.nanoflows, null, { view: 'refs', seg: 'nanoflow', key: null }],
          ['Pages', k.pages, null, { view: 'refs', seg: 'page', key: null }],
          ['Entities', k.entities, null, { view: 'domain' }],
          ['User roles', k.roles, null, { view: 'arch', sec: 'roles' }],
          ['Scheduled events', k.scheduled, k.scheduled ? k.scheduledOn + ' on' : null, { view: 'quality', sub: 'sched' }],
          ['Published services', k.services, kinds.join(' · ') || null, { view: 'arch', sec: 'runtime' }],
          risks.length ? ['Risks', risks.length, levelCount('P1') + ' P1', { view: 'risks' }, 'p1'] : null,
          assist ? ['Assist', assistOpen() + ' open', null, { view: 'assist' }] : null
        ].filter(Boolean);
        var hero = h('header', { class: 'dx-ov-hero', 'data-sec': 'about' }, [
          h('div', { class: 'dx-ov-intro' }, [
            h('span', { class: 'dx-eyebrow', text: 'Mendix application · documentation' }),
            h('h1', { class: 'dx-ov-h1', text: data.project }),
            h('p', { class: 'dx-ov-lead', text: sum ? sum[0] : 'Read from the Mendix model' + (data.app ? ' of ' + data.app : '') + '.' }),
            sum ? (sum[1] ? h('p', { class: 'dx-ov-rest', text: sum[1] }) : null)
              : h('p', { class: 'dx-ov-rest', text: 'Every module, microflow, nanoflow, page and entity: what each flow takes and returns, every step it runs and the data it sets, who may start it, what calls what, and where the model looks unfinished.' }),
            h('div', { class: 'dx-ov-cta' }, [
              procPage ? ln({ view: 'processes', proc: 0 }, { class: 'dx-cta' }, ['Read the full description', navIcon('arrow', 14)]) : null,
              h('span', { class: 'dx-ov-prov', text: data.ai && data.ai.agent !== false
                ? 'Numbers and structure are read from the model. The texts were written from it by an agent' + (data.ai.by ? ' (' + data.ai.by + ')' : '') + ' and can be wrong where the model is ambiguous.'
                : 'Everything here is read from the model. Nothing in it was written by hand.' })
            ])
          ]),
          h('aside', { class: 'dx-glance', 'aria-label': 'At a glance' }, [
            h('div', { class: 'dx-glance-h', text: 'At a glance' }),
            h('dl', null, facts.map(function (f) {
              var v = [String(f[1]), f[2] ? h('span', { class: 'dx-glance-sub', text: ' · ' + f[2] }) : null];
              return [h('dt', { text: f[0] }), h('dd', { class: f[4] || null }, f[3] ? ln(f[3], { class: 'dx-glance-v' }, v) : v)];
            }))
          ])
        ]);
        secs.push({ id: 'about', label: 'About', node: hero });

        // 2. who uses it — groups when the agent wrote them as a list, its sentence when it did not
        var users = app && app.users || [];
        var rolesLink = ln({ view: 'arch', sec: 'roles' }, { class: 'dx-inline-link' }, plural(k.roles, 'user role', 'user roles'));
        var who = app && (users.length || app.audience) ? section('users', 'Who uses it', 'Who uses it',
          [users.length ? cap(numWord(users.length)) + (users.length === 1 ? ' group of people. ' : ' groups of people. ') : '', 'The model gives them ', rolesLink, '.'], null,
          users.length ? h('div', { class: 'dx-users' }, users.map(function (u) {
            return h('div', { class: 'dx-user' }, [h('span', { class: 'dx-user-i', 'aria-hidden': 'true' }, navIcon('person', 16)), h('div', null, [h('b', { text: u.who }), u.what ? h('span', { text: u.what }) : null])]);
          })) : h('p', { class: 'dx-ov-p', text: app.audience })) : null;

        // 3. what it talks to — the agent's context diagram, its groups placed around the application
        var ctx = contextGroups(c4 && c4.context);
        var talks = ctx ? section('context', 'What it talks to', 'What it talks to',
          [h('span', { class: 'mono', text: String(ctx.systems) }), ' ' + (ctx.systems === 1 ? 'system' : 'systems') + ' in ' + numWord(ctx.groups.length) + (ctx.groups.length === 1 ? ' group' : ' groups') + '. Arrows show who calls whom.'],
          more({ view: 'arch', sec: 'context' }, 'Every partner and what it exchanges'), contextDiagram(ctx)) : null;
        var pair = h('div', { class: 'dx-ov-pair' + (who && talks ? '' : ' one') }, [who, talks]);

        // 4. what it does
        var does = procs.length ? section('processes', 'What it does', 'What it does',
          procs.length === 1 ? 'One main process. It opens with its steps and the flows that carry it.' : cap(numWord(procs.length)) + ' main processes. Each opens with its steps and the flows that carry it.', null,
          h('div', { class: 'dx-ov-procs' }, procs.map(function (p, i) {
            return ln({ view: 'processes', proc: i + 1 }, { class: 'dx-ov-proc' }, [
              h('span', { class: 'dx-ov-proc-n', text: pad2(i + 1) }),
              h('span', { class: 'dx-ov-proc-t' }, [h('b', { text: p.name }), p.summary ? h('span', { text: p.summary }) : null,
                h('small', { text: plural(p.steps.length, 'step', 'steps') + ' · ' + plural(p.flows.length, 'flow', 'flows') })]),
              navIcon('chev', 15)
            ]);
          }))) : null;

        // 5. what needs attention: the agent's risks, and what the model shows by itself
        var off = k.scheduled - k.scheduledOn;
        var p1 = [];
        risks.forEach(function (r, i) { if (r.level === 'P1') p1.push([r, i]); });
        var health = section('health', 'What needs attention', 'What needs attention',
          risks.length ? (risks.some(function (r) { return r.origin === 'person'; }) ? 'Risks an agent found in the model or a person raised, and what the model shows directly.' : 'Risks an agent found in the model, and what the model shows directly.') : 'What the model shows directly.',
          risks.length ? more({ view: 'risks' }, 'All ' + risks.length + ' risks') : null,
          h('div', { class: 'dx-health' + (risks.length ? '' : ' one') }, [
            h('div', { class: 'dx-health-l' }, [
              risks.length ? h('div', { class: 'dx-lv3' }, [['P1', 'fix first'], ['P2', 'plan a fix'], ['P3', 'worth knowing']].map(function (l) {
                return h('div', { class: 'dx-lv3-t ' + l[0].toLowerCase() }, [h('b', { text: String(levelCount(l[0])) }), h('span', { text: l[0] + ' · ' + l[1] })]);
              })) : null,
              h('div', { class: 'dx-facts' }, [
                h('span', { class: 'dx-cap', text: 'Read from the model' }),
                ln({ view: 'quality', sub: 'unreached' }, { class: 'dx-fact' }, [h('span', { text: 'Elements nothing reaches' }), h('span', { class: 'mono', text: String(q.unreached.length) })]),
                ln({ view: 'quality', sub: 'off' }, { class: 'dx-fact' }, [h('span', { text: 'Disabled steps' }), h('span', { class: 'mono', text: String(q.disabled) })]),
                k.scheduled ? ln({ view: 'quality', sub: 'sched' }, { class: 'dx-fact' }, [h('span', { text: 'Scheduled events switched off' }), h('span', { class: 'mono', text: off + ' of ' + k.scheduled })]) : null
              ])
            ]),
            risks.length ? h('div', { class: 'dx-p1' }, [
              h('span', { class: 'dx-cap', text: p1.length === 1 ? 'The one P1 risk' : p1.length ? 'The ' + numWord(p1.length) + ' P1 risks' : 'P1 risks' }),
              p1.length ? p1.map(function (x) {
                return ln({ view: 'risks', sub: riskId(x[1]) }, { class: 'dx-p1-row' }, [h('span', { text: x[0].title }), h('span', { class: 'mono', text: riskModule(x[0]) })]);
              }) : h('span', { class: 'dx-empty', text: 'None.' })
            ]) : null
          ]));

        // 6. where next, by what the reader came to do
        var flowsN = k.microflows + k.nanoflows + k.pages;
        var next = section('start', 'Where to go next', 'Where to go next', null, null, h('div', { class: 'dx-next' }, [
          ['Understand the application', 'What each part is for and how the parts fit together.',
            [[{ view: 'modules' }, 'Modules', k.modules], [{ view: 'arch' }, 'Architecture', ''], procs.length ? [{ view: 'processes', proc: 0 }, 'Main processes', procs.length] : null]],
          ['Read the logic', 'Every flow drawn step by step, and the data it works on.',
            [[{ view: 'refs' }, 'Microflows & pages', flowsN], [{ view: 'domain' }, 'Domain model', k.entities]]],
          ['Change it safely', risks.length ? 'What to fix first, what is unused, and what breaks easily.' : 'What is unused or switched off, and what breaks easily.',
            [risks.length ? [{ view: 'risks' }, 'Risks', risks.length] : null, [{ view: 'quality' }, 'Model quality', q.unreached.length], devCtx ? [{ view: 'dev' }, 'For developers', devCount] : null,
              assist ? [{ view: 'assist' }, 'Assist', assistOpen() + ' open'] : null]]
        ].map(function (g) {
          return h('div', { class: 'dx-next-g' }, [h('h3', { text: g[0] }), h('p', { text: g[1] }),
            h('ul', null, g[2].filter(Boolean).map(function (l) { return h('li', null, ln(l[0], null, [h('span', { text: l[1] }), h('span', { class: 'mono', text: String(l[2]) })])); }))]);
        })));
        // a model loaded from JSON has no drawings, and says so where it starts
        var noDrawings = data.drawings ? null : h('div', { class: 'dx-note', text: 'This model was imported as JSON and carries no drawings, so the workflows are not shown. Load the model from the Mendix project folder to see them.' });

        // In the wide layout, a contents list that follows the scroll, and what this file is.
        var tocLinks = {};
        var toc = h('aside', { class: 'dx-toc', 'aria-label': 'On this page' }, [
          h('div', { class: 'dx-toc-l' }, [h('span', { class: 'dx-cap', text: 'On this page' })].concat(secs.map(function (x) {
            tocLinks[x.id] = ln({ view: 'start', sec: x.id }, { class: 'dx-toc-a' }, x.label, function () { st.sec = x.id; if (opts.hash) history.replaceState(null, '', hashOf(st)); toSection(x.id); });
            return tocLinks[x.id];
          }))),
          opts.only ? null : h('div', { class: 'dx-toc-file' }, [h('b', { text: 'This file' }), h('span', { text: 'One HTML file. It opens in any browser, offline, with no password. A Markdown copy with the same content reads well in AI tools.' }), opts.preview ? null : mdButton()])
        ]);
        main.appendChild(h('div', { class: 'dx-ov' }, [h('article', { class: 'dx-ov-doc' }, [hero, pair, does, health, next, noDrawings]), toc]));
        onScroll = function () {
          var top = main.getBoundingClientRect().top + 120, cur = secs[0].id;
          secs.forEach(function (x) { if (x.node.getBoundingClientRect().top <= top) cur = x.id; });
          Object.keys(tocLinks).forEach(function (id) { tocLinks[id].classList.toggle('on', id === cur); });
        };
        onScroll();
        if (st.sec) { var want = st.sec; requestFrame(function () { toSection(want); }); }
      }
      function toSection(id) {
        var node = main.querySelector('[data-sec="' + id + '"]');
        if (node) main.scrollTop += node.getBoundingClientRect().top - main.getBoundingClientRect().top - 24;
      }

      // `notes`: each chip says what the partner is (Architecture) rather than what it exchanges (Overview).
      function contextDiagram(c, notes) {
        function group(g) {
          return h('div', { class: 'dx-ctx-g' }, [h('span', { class: 'dx-ctx-gl', text: g.name }),
            g.nodes.map(function (n) { return h('span', { class: 'dx-ctx-chip', title: n.note || null }, [h('b', { text: n.name }), (notes ? n.note : n.via) ? h('span', { text: notes ? n.note : n.via }) : null]); })]);
        }
        function conn(verb, row, col) {
          var c2 = h('div', { class: 'dx-ctx-conn' + (verb ? '' : ' plain') }, [h('span', { class: 'dx-ctx-cl', text: verb }), h('span', { class: 'dx-ctx-arrow', 'aria-hidden': 'true' })]);
          c2.style.gridRow = String(row); c2.style.gridColumn = String(col);
          return c2;
        }
        var rows = Math.max(c.left.length, c.right.length, 1);
        var kids = [];
        if (c.top.length) {
          kids.push(h('div', { class: 'dx-ctx-top' }, [h('div', { class: 'dx-ctx-tops' }, c.top.map(group)), h('span', { class: 'dx-ctx-both', 'aria-hidden': 'true' })]));
        }
        c.left.forEach(function (g, i) {
          var n = group(g); n.style.gridRow = String(i + 2); n.style.gridColumn = '1';
          kids.push(n, conn(g.verb, i + 2, 2));
        });
        var mid = h('div', { class: 'dx-ctx-app' }, [h('span', { class: 'dx-eyebrow', text: 'Mendix app' }), h('b', { text: c.app.name }), c.app.note ? h('span', { text: c.app.note }) : null]);
        mid.style.gridRow = '2 / span ' + rows;
        kids.push(mid);
        c.right.forEach(function (g, i) {
          var n = group(g); n.style.gridRow = String(i + 2); n.style.gridColumn = '5';
          kids.push(conn(g.verb, i + 2, 4), n);
        });
        return h('div', { class: 'dx-ctx' }, kids);
      }

      // ---------- processes (redesign spec 12) ----------
      // What an agent wrote about the application and its main processes:
      // 0 is the application as a whole, 1.. a process — its steps, how it
      // works, the flows that carry it and the risks on those flows.
      // A process's diagram as the flow drawing takes a workflow (docs-data.js): steps numbered in
      // reading order, a decision's ways as its branches, a way that ends drawn ending, one that does not
      // rejoining the main path — the main path itself chosen as in a microflow (flowtrace.js mainBranch).
      // A way that "join"s a step further on goes on there, drawn as "continues at step N".
      function diagramFlow(items) {
        var no = 0, at = {};
        (function number(list) {
          list.forEach(function (x) {
            if (x.t === 'step') at[x.text] = ++no;
            if (x.t === 'decision') { ++no; x.ways.forEach(function (w) { number(w.items); }); }
          });
        })(items);
        no = 0;
        function ends(list) {
          var last = list[list.length - 1];
          return !!last && (last.t === 'end' || (last.t === 'split' && last.branches.every(function (b) { return b.ends; })));
        }
        function conv(list) {
          return list.map(function (x) {
            if (x.t === 'step') return { t: 'step', no: ++no, card: { fam: x.by === 'app' ? 'app' : 'person', kick: x.who || (x.by === 'app' ? 'Application' : ''), title: x.text } };
            if (x.t === 'decision') {
              var n = ++no;
              return { t: 'split', no: n, kind: 'decision', title: x.text, cond: null, branches: x.ways.map(function (w) {
                var body = conv(w.items);
                if (w.end) body.push({ t: 'end', kind: 'end', label: w.end });
                else if (w.join && at[w.join]) body.push({ t: 'go', no: at[w.join], back: at[w.join] <= n });
                return { label: w.label, body: body, ends: ends(body) || body.some(function (b) { return b.t === 'go'; }) };
              }) };
            }
            return { t: 'end', kind: 'end', label: x.text };
          });
        }
        return [{ t: 'start' }].concat(conv(items));
      }
      function processDiagram(items, caption) {
        if (!items || !items.length || !window.MxFlowGraph) return null;
        return h('section', { class: 'dx-pd-sec dx-pd-diagram' }, [h('h3', { class: 'dx-cap', text: caption || 'Diagram' }),
          h('div', { class: 'dx-pd-graph' }, [window.MxFlowGraph.render({ workflow: diagramFlow(items), params: [] }, {})])]);
      }
      // Flows named by qualified name, each a row: its kind, its name, its size — a link when the model has it.
      function flowRows(qns) {
        return h('div', { class: 'dx-pd-rows' }, qns.map(function (qn) {
          var key = flowKey(qn), f = key ? data.flows[key] : null, dot = qn.indexOf('.');
          var kids = [kindTag(f ? { microflow: 'MF', nanoflow: 'NF', page: 'PG' }[f.kind] : '··'),
            h('span', { class: 'dx-pd-qn mono' }, [h('span', { class: 'dx-mod', text: qn.slice(0, dot + 1) }), qn.slice(dot + 1)]),
            h('span', { class: 'dx-pd-steps-n mono', text: f && f.steps ? plural(f.steps, 'step', 'steps') : '' })];
          return f ? ln({ view: 'refs', module: f.module, seg: f.kind, key: key }, { class: 'dx-pd-flow' }, kids) : h('div', { class: 'dx-pd-flow' }, kids);
        }));
      }

      function drawProcesses() {
        var app = data.ai.app;
        var n = Math.min(Math.max(0, st.proc || 0), procs.length);
        setTitle('Processes', procs.length === 1
          ? 'What ' + data.project + ' does, told as one business process. An agent wrote it from the model; it lists the flows that carry it.'
          : 'What ' + data.project + ' does, told as ' + numWord(procs.length) + ' business processes. An agent wrote them from the model; each one lists the flows that carry it.');
        var paras = paragraphs(app.story);
        var rows = [{ no: '—', name: 'The application', meta: paras.length ? 'Full description · ' + plural(paras.length, 'paragraph', 'paragraphs') : 'Summary' }].concat(procs.map(function (p, i) {
          var r = processRisks(p).length;
          return { no: pad2(i + 1), name: p.name, meta: plural(p.steps.length, 'step', 'steps') + ' · ' + plural(p.flows.length, 'flow', 'flows') + (r ? ' · ' + plural(r, 'risk', 'risks') : '') };
        }));
        list.appendChild(h('div', { class: 'dx-pl', role: 'list' }, rows.map(function (r, i) {
          var a = ln({ view: 'processes', proc: i }, { class: 'dx-pl-item' + (i === n ? ' on' : ''), 'aria-current': i === n ? 'page' : null }, [
            h('span', { class: 'dx-pl-n', text: r.no }), h('span', { class: 'dx-pl-t' }, [h('b', { text: r.name }), h('small', { text: r.meta })])]);
          return h('div', { role: 'listitem' }, a);
        })));

        var wrap = h('div', { class: 'dx-pd' });
        var users = app.users || [];
        if (!n) {
          wrap.appendChild(h('div', { class: 'dx-pd-head' }, [
            h('span', { class: 'dx-pd-eye', text: data.project + ' · full description' }),
            h('h2', { text: 'The application' }),
            app.summary ? h('p', { class: 'dx-pd-lead', text: app.summary }) : null,
            users.length ? h('div', { class: 'dx-pd-who' }, [h('b', { text: 'Who uses it.' }), h('ul', null, users.map(function (u) { return h('li', null, [h('b', { text: u.who }), u.what ? ' ' + u.what : null]); }))])
              : app.audience ? h('p', { class: 'dx-pd-who' }, [h('b', { text: 'Who uses it.' }), ' ' + app.audience]) : null
          ]));
          wrap.appendChild(h('div', { class: 'dx-pd-grid' }, [
            paras.length ? h('section', { class: 'dx-pd-story' }, [h('h3', { class: 'dx-cap', text: 'How it works' }), paras.map(function (p) { return h('p', { text: p }); })]) : null,
            procs.length ? h('section', { class: 'dx-pd-side' }, [
              h('h3', { class: 'dx-cap', text: procs.length === 1 ? 'The one process' : 'The ' + numWord(procs.length) + ' processes' }),
              h('div', { class: 'dx-pd-rows' }, procs.map(function (p, i) {
                return ln({ view: 'processes', proc: i + 1 }, { class: 'dx-pd-idx' }, [h('span', { class: 'dx-pd-no', text: pad2(i + 1) }), h('span', null, [h('b', { text: p.name }), p.summary ? h('span', { text: p.summary }) : null])]);
              }))
            ]) : null
          ]));
        } else {
          var p = procs[n - 1], touched = processRisks(p);
          var steps = h('ol', { class: 'dx-pd-steps' }, p.steps.map(function (x, i) { return h('li', null, [h('span', { class: 'dx-pd-sn', text: String(i + 1) }), h('span', { text: x })]); }));
          wrap.appendChild(h('div', { class: 'dx-pd-head' }, [
            h('span', { class: 'dx-pd-eye', text: 'Process ' + pad2(n) + ' of ' + procs.length }),
            h('h2', { text: p.name }),
            p.summary ? h('p', { class: 'dx-pd-lead', text: p.summary }) : null
          ]));
          if (p.steps.length) wrap.appendChild(h('section', { class: 'dx-pd-sec' }, [h('h3', { class: 'dx-cap', text: 'Steps' }), steps]));
          var drawn = processDiagram(p.diagram);
          if (drawn) wrap.appendChild(drawn);
          var story2 = paragraphs(p.story);
          wrap.appendChild(h('div', { class: 'dx-pd-grid' }, [
            story2.length ? h('section', { class: 'dx-pd-story' }, [h('h3', { class: 'dx-cap', text: 'How it works' }), story2.map(function (x) { return h('p', { text: x }); })]) : null,
            h('div', { class: 'dx-pd-side' }, [
              h('section', null, [
                h('h3', { class: 'dx-cap', text: 'Flows that carry it · ' + p.flows.length }),
                flowRows(p.flows)
              ]),
              h('section', null, [
                h('h3', { class: 'dx-cap', text: 'Risks along the way · ' + touched.length }),
                h('div', { class: 'dx-pd-rows' }, touched.length ? touched.map(function (x) {
                  return ln({ view: 'risks', sub: riskId(x[1]) }, { class: 'dx-pd-risk' }, [h('span', { class: 'dx-lv ' + x[0].level.toLowerCase(), text: x[0].level }), h('span', { text: x[0].title })]);
                }) : h('span', { class: 'dx-empty', text: 'No risk touches these flows.' }))
              ])
            ])
          ]));
        }
        wrap.appendChild(h('p', { class: 'dx-prov', text: 'Written by an agent from the model. Step lists and flow names come from the model; check the wording before you quote it.' }));
        main.appendChild(wrap);
      }
      // ---------- assist ----------
      // What an agent helped with (assist.js), drawn by docs-assist.js — in MxScout only, which hands the
      // items over (opts.assist); the exported file has neither the items nor the file that draws them.
      // A ticket names the known risk it is about by its id: an agent's, or one a person raised ("c-…").
      function riskAt(id) { for (var i = 0; i < allRisks.length; i++) if (allRisks[i].id === id || allRisks[i].pid === id) return { r: allRisks[i], no: riskId(i), at: { view: 'risks', sub: riskId(i) } }; return null; }
      function drawAssist() {
        if (!window.MxDocsAssist) { main.appendChild(h('div', { class: 'dx-note', text: 'This copy cannot draw the Assist page.' })); return; }
        window.MxDocsAssist.draw({ h: h, ln: ln, list: list, main: main, setTitle: setTitle, project: data.project, st: st, assist: assist, cases: cases, risk: riskAt,
          keep: function (p) { Object.keys(p).forEach(function (k) { st[k] = p[k]; }); if (opts.onState) opts.onState(st); },
          paragraphs: paragraphs, plural: plural, flowRows: flowRows, diagram: processDiagram,
          place: function (qn, kind) { return window.MxDocsChanges ? window.MxDocsChanges.place(data, flowKey, qn, { microflow: 1, nanoflow: 1, page: 1, entity: 1, attribute: 1, association: 1 }[kind] ? kind : 'other') : null; } });
      }
      // The solved cases (knowledge.js), drawn by docs-knowledge.js — in MxScout, and in an export that was asked for them.
      function drawCases() {
        if (!window.MxDocsKnowledge) { main.appendChild(h('div', { class: 'dx-note', text: 'This copy cannot draw the solved cases.' })); return; }
        window.MxDocsKnowledge.draw({ h: h, ln: ln, list: list, main: main, setTitle: setTitle, project: data.project, st: st, cases: cases, data: data, plural: plural,
          keep: function (p) { Object.keys(p).forEach(function (k) { st[k] = p[k]; }); if (opts.onState) opts.onState(st); }, flow: function (qn) { var k = flowKey(qn); return k ? { key: k, f: data.flows[k] } : null; } });
      }
      // The risks on a process: those whose places include one of its flows, P1 first, each once.
      function processRisks(p) {
        var fs = {};
        p.flows.forEach(function (qn) { fs[qn] = true; });
        var out = [];
        risks.forEach(function (r, i) { if ((r.where || []).some(function (w) { return fs[String(w).split('|')[0]]; })) out.push([r, i]); });
        return out.map(function (x, i) { return [x, i]; }).sort(function (a, b) { return a[0][0].level < b[0][0].level ? -1 : a[0][0].level > b[0][0].level ? 1 : a[1] - b[1]; }).map(function (x) { return x[0]; });
      }

      // ---------- modules (redesign spec 13) ----------
      // One module at a time: what it is for, its facts, and four tabs —
      // what the agent wrote about it, its contents grouped by the first part
      // of each name, how it leans on other modules, and its risks.
      var KIND_OF_TAG = { mf: 'microflow', nf: 'nanoflow', pg: 'page' };
      // A sentence an agent or the model wrote, its qualified names in code font — a link when the model has them.
      function richText(text) {
        var out = [];
        String(text || '').split(/([A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?|\b[A-Z][A-Za-z]{1,10}_(?:[A-Za-z0-9_…*<>]*)?)/).forEach(function (p, i) {
          if (!p) return;
          if (!(i % 2)) { out.push(p); return; }
          var k = flowKey(p);
          if (k) out.push(ln({ view: 'refs', module: data.flows[k].module, seg: data.flows[k].kind, key: k }, { class: 'dx-code link' }, p));
          else if (data.entities[p]) out.push(ln({ view: 'domain', entity: p }, { class: 'dx-code link' }, p));
          else out.push(h('code', { class: 'dx-code', text: p }));
        });
        return out;
      }
      function drawModules() {
        var D = derived();
        var mods = D && D.modules ? D.modules : [];
        var own = mods.filter(function (x) { return !x.mp; }).length, mp = mods.length - own;
        setTitle('Modules', plural(own, 'own module', 'own modules') + (mp ? ' and ' + mp + ' from the Marketplace' : ', none from the Marketplace') + '. Each one holds part of the application: its flows, pages and entities.');
        if (!mods.length) { main.appendChild(h('div', { class: 'dx-note', text: 'This file holds no modules.' })); return; }
        var sort = st.msort === 'size' || st.msort === 'risk' ? st.msort : 'az';
        tools(h('div', { class: 'dx-seg2', role: 'group', 'aria-label': 'Sort modules' }, [h('span', { text: 'Sort' })].concat([['az', 'A–Z'], ['size', 'Size'], ['risk', 'Risks']].map(function (x) {
          return h('button', { type: 'button', class: sort === x[0] ? 'on' : '', 'aria-pressed': sort === x[0] ? 'true' : 'false', text: x[1], onclick: function () { go({ msort: x[0] }); } });
        }))), function (n) { n.classList.add('dx-ml-sort'); list.appendChild(n); });
        var byName = {}, usedBy = {};
        mods.forEach(function (x) { byName[x.n] = x; });
        mods.forEach(function (x) { Object.keys(x.uses || {}).forEach(function (k) { (usedBy[k] = usedBy[k] || {})[x.n] = x.uses[k]; }); });
        // The project's own modules and the Marketplace's apart (Karol, 2026-10-13), as on the
        // Domain model: Own first, a module picked from the other side opens its side.
        var scope = st.mscope === 'marketplace' || st.mscope === 'own' ? st.mscope : (byName[st.module] && byName[st.module].mp ? 'marketplace' : 'own');
        if (byName[st.module] && (byName[st.module].mp ? 'marketplace' : 'own') !== scope) st.module = null;
        var all2 = mods;
        mods = mods.filter(function (x) { return scope === 'marketplace' ? x.mp : !x.mp; });
        if (!mods.length) mods = all2;
        if (mp) list.appendChild(h('div', { class: 'dx-seg2 dx-dm-scope dx-ml-scope', role: 'group', 'aria-label': 'Which modules' }, [['own', 'Own', own], ['marketplace', 'Marketplace', mp]].map(function (x) {
          return h('button', { type: 'button', class: scope === x[0] ? 'on' : '', 'aria-pressed': scope === x[0] ? 'true' : 'false', onclick: function () { go({ mscope: x[0], module: null }); } }, [x[1], h('span', { class: 'mono', text: String(x[2]) })]);
        })));
        function cnt(x, k) { return x.items.filter(function (i) { return i[0] === k; }).length; }
        function rTotal(x) { return x.risk[0] + x.risk[1] + x.risk[2]; }
        var sorted = mods.slice();
        if (sort === 'size') sorted.sort(function (a, b) { return (b.items.length + b.ent.length) - (a.items.length + a.ent.length) || a.n.toLowerCase().localeCompare(b.n.toLowerCase()); });
        else if (sort === 'risk') sorted.sort(function (a, b) { return b.risk[0] - a.risk[0] || rTotal(b) - rTotal(a) || a.n.toLowerCase().localeCompare(b.n.toLowerCase()); });
        else sorted.sort(function (a, b) { return a.n.toLowerCase().localeCompare(b.n.toLowerCase()); });
        var m = byName[st.module] || sorted[0];
        list.appendChild(h('div', { class: 'dx-ml' }, sorted.map(function (x) {
          var on = x === m;
          return ln({ view: 'modules', module: x.n }, { class: 'dx-ml-item' + (on ? ' on' : ''), 'aria-current': on ? 'page' : null }, [
            h('span', { class: 'dx-ml-t' }, [h('b', { class: 'mono', text: x.n }), h('small', { text: plural(cnt(x, 'mf') + cnt(x, 'nf'), 'flow', 'flows') + ' · ' + plural(cnt(x, 'pg'), 'page', 'pages') + ' · ' + plural(x.ent.length, 'entity', 'entities') })]),
            h('span', { class: 'dx-ml-r' }, [x.risk[0] ? h('span', { class: 'dx-ml-p1', text: x.risk[0] + ' P1' }) : null, h('span', { class: 'mono dx-ml-n', text: rTotal(x) ? String(rTotal(x)) : '' })])
          ], function () { go({ module: x.n }); });
        })));

        var usesK = Object.keys(m.uses || {}), byK = Object.keys(usedBy[m.n] || {});
        var story2 = paragraphs(m.story), notes = m.notes || [];
        var hasAbout = !!(m.sum || story2.length || notes.length);
        var mRisks = [];
        risks.forEach(function (r, i) { var w = (r.where || [])[0]; if (w && String(w).split('|')[0].split('.')[0] === m.n) mRisks.push([r, i]); });
        mRisks.sort(function (a, b) { return LVO[a[0].level] - LVO[b[0].level] || a[1] - b[1]; });
        var tab = { about: 1, contents: 1, links: 1, risks: 1 }[st.mtab] ? st.mtab : (hasAbout ? 'about' : 'contents');
        if (tab === 'risks' && !risks.length) tab = 'contents';
        function toTab(t2) { return function () { go({ mtab: t2 }); }; }
        var nR = rTotal(m);
        var facts = [[cnt(m, 'mf'), 'microflows', 'contents'], [cnt(m, 'nf'), 'nanoflows', 'contents'], [cnt(m, 'pg'), 'pages', 'contents'], [m.ent.length, 'entities', 'contents'],
          [usesK.length + ' · ' + byK.length, 'uses · used by', 'links']].concat(risks.length ? [[nR, ['P1', 'P2', 'P3'].map(function (l, k) { return m.risk[k] ? m.risk[k] + ' ' + l : null; }).filter(Boolean).join(' · ') || 'risks', 'risks', m.risk[0] ? 'p1' : '']] : []);
        var wrap = h('div', { class: 'dx-md' }, [
          h('div', { class: 'dx-md-head' }, [
            h('span', { class: 'dx-pd-eye', text: m.mp ? 'Marketplace module' : 'Own module' }),
            h('h2', { class: 'mono', text: m.n }),
            m.sum ? h('p', { class: 'dx-pd-lead', text: m.sum }) : null,
            h('div', { class: 'dx-md-facts' }, facts.map(function (f) {
              return h('button', { type: 'button', class: 'dx-md-fact', onclick: toTab(f[2]) }, [h('span', { class: 'mono' + (f[3] ? ' ' + f[3] : ''), text: String(f[0]) }), h('small', { text: f[1] })]);
            }))
          ]),
          h('div', { class: 'dx-tabs2', role: 'tablist' }, [['about', 'About'], ['contents', 'Contents', m.items.length + m.ent.length], ['links', 'Connections', usesK.length + byK.length]].concat(risks.length ? [['risks', 'Risks', nR]] : []).map(function (b) {
            var on = tab === b[0];
            return h('button', { type: 'button', role: 'tab', class: on ? 'on' : '', 'aria-selected': on ? 'true' : 'false', onclick: toTab(b[0]) }, [b[1], b[2] !== undefined ? h('span', { class: 'mono', text: String(b[2]) }) : null]);
          }))
        ]);
        if (tab === 'about') {
          wrap.appendChild(hasAbout ? h('div', { class: 'dx-md-about' }, [
            h('section', { class: 'dx-pd-story' }, story2.length ? [h('h3', { class: 'dx-cap', text: 'What it does' })].concat(story2.map(function (p) { return h('p', { text: p }); }), [h('span', { class: 'dx-prov', text: 'Written by an agent from the model.' })])
              : [h('h3', { class: 'dx-cap', text: 'What it does' }), h('p', { class: 'dx-empty', text: 'An agent wrote no description of this module.' })]),
            notes.length ? h('div', { class: 'dx-md-notes' }, notes.map(function (n) {
              var cols = n.table ? n.table.columns : [];
              var grid = cols.length === 3 ? '1.1fr 1.1fr 1.6fr' : cols.map(function () { return '1fr'; }).join(' ');
              return h('section', { class: 'dx-md-note' }, [
                n.title ? h('h3', { class: 'dx-cap', text: n.title }) : null,
                n.text ? paragraphs(n.text).map(function (p) { return h('p', null, richText(p)); }) : null,
                n.items && n.items.length ? h('ul', null, n.items.map(function (it) { return h('li', null, richText(it)); })) : null,
                n.table ? (function () {
                  var tb = h('div', { class: 'dx-md-table', role: 'table' }, [h('div', { class: 'dx-md-tr head', role: 'row' }, cols.map(function (c) { return h('span', { role: 'columnheader', text: c }); }))]
                    .concat(n.table.rows.map(function (r) { return h('div', { class: 'dx-md-tr', role: 'row' }, cols.map(function (c, ci) { return h('span', { role: 'cell', class: ci ? null : 'mono' }, ci ? richText(r[ci] || '') : String(r[ci] || '').replace(/^[A-Za-z_][A-Za-z0-9_]*\./, '')); })); })));
                  Array.prototype.forEach.call(tb.children, function (row) { row.style.gridTemplateColumns = grid; });
                  return tb;
                })() : null
              ]);
            })) : null
          ]) : h('p', { class: 'dx-empty', text: 'An agent wrote nothing about this module.' }));
        } else if (tab === 'contents') {
          // Grouped by the first part of each name (spec 13 §3): a role prefix such as ACT_, or the entity the flows work on.
          function tok(n) { var i = n.indexOf('_'); return i > 0 ? n.slice(0, i) : ''; }
          var tc = {}, groups = {};
          m.items.forEach(function (i) { var k = tok(i[1]); if (k) tc[k] = (tc[k] || 0) + 1; });
          m.items.forEach(function (i) { var k = tok(i[1]); if (!k || (tc[k] < 2 && !ROLE_PREFIX[k])) k = ''; (groups[k] = groups[k] || []).push(i); });
          var keys = Object.keys(groups).sort(function (a, b) { if (!a) return 1; if (!b) return -1; return groups[b].length - groups[a].length || a.localeCompare(b); });
          var cards = keys.map(function (k) {
            var its = groups[k];
            var cols = [['mf', 'Microflows'], ['nf', 'Nanoflows'], ['pg', 'Pages']].map(function (c) {
              var xs = its.filter(function (i) { return i[0] === c[0]; }).sort(function (a, b) { return a[1].localeCompare(b[1]); });
              if (!xs.length) return null;
              return h('div', { class: 'dx-mc-col' }, [h('span', { class: 'dx-cap', text: c[1] + ' · ' + xs.length })].concat(xs.map(function (i) {
                var lost = i[3] === 0 && i[4] === 0;
                var key = flowKey(m.n + '.' + i[1], c[0]);
                var kids = [h('span', { class: 'dx-mc-n', text: k ? i[1].slice(k.length + 1) || i[1] : i[1] }), h('small', { text: i[0] === 'pg' ? '' : plural(i[2], 'step', 'steps') })];
                var attrs = { class: 'dx-mc-item' + (lost ? ' lost' : ''), title: m.n + '.' + i[1] + (lost ? ' — nothing reaches it' : '') };
                return key ? ln({ view: 'refs', module: m.n, seg: KIND_OF_TAG[i[0]], key: key }, attrs, kids) : h('div', attrs, kids);
              })));
            }).filter(Boolean);
            var body = h('div', { class: 'dx-mc-cols' }, cols); body.style.gridTemplateColumns = 'repeat(' + cols.length + ', minmax(0, 1fr))';
            return h('section', { class: 'dx-mc' }, [h('div', { class: 'dx-mc-h' }, [h('b', { class: 'mono', text: k ? k + '_' : 'Other names' }), h('span', { text: k ? (ROLE_PREFIX[k] || 'named after ' + k) : 'no shared prefix' }), h('span', { class: 'mono dx-fc-n', text: String(its.length) })]), body]);
          });
          if (m.ent.length) cards.push(h('section', { class: 'dx-mc' }, [h('div', { class: 'dx-mc-h' }, [h('b', { class: 'mono', text: 'Entities' }), h('span', { text: 'open in the domain model' }), h('span', { class: 'mono dx-fc-n', text: String(m.ent.length) })]),
            h('div', { class: 'dx-mc-cols one' }, [h('div', { class: 'dx-mc-col' }, [h('span', { class: 'dx-cap', text: 'Entities · ' + m.ent.length })].concat(m.ent.map(function (e) {
              var q = m.n + '.' + e;
              return data.entities[q] ? ln({ view: 'domain', entity: q }, { class: 'dx-mc-item ent' }, [h('span', { class: 'dx-mc-n', text: e })]) : h('div', { class: 'dx-mc-item' }, [h('span', { class: 'dx-mc-n', text: e })]);
            })))])]));
          wrap.appendChild(h('div', { class: 'dx-md-sec' }, [h('p', { class: 'dx-md-hint', text: 'Grouped by the first part of each name: a role prefix such as ACT_ or SUB_, or the entity the flows work on. Struck-through names are not reached from anywhere.' }),
            cards.length ? h('div', { class: 'dx-mc-grid' }, cards) : h('p', { class: 'dx-empty', text: 'This module holds nothing.' })]));
        } else if (tab === 'links') {
          function row(name, v, mutual) {
            var what = [];
            if (v[0]) what.push(plural(v[0], 'call', 'calls'));
            if (v[1]) what.push(plural(v[1], 'association', 'associations'));
            return ln({ view: 'modules', module: name, mtab: 'links' }, { class: 'dx-ln-row' }, [h('b', { class: 'mono', text: name }), mutual ? h('span', { class: 'dx-both', title: 'Both modules depend on each other', text: 'both ways' }) : null, h('small', { text: what.join(' · ') })],
              function () { go({ module: name, mtab: 'links' }); });
          }
          function byWeight(o) { return Object.keys(o).sort(function (a, b) { return (o[b][0] + o[b][1]) - (o[a][0] + o[a][1]) || a.localeCompare(b); }); }
          var runs = (m.sched || []).map(function (x) { return h('div', { class: 'dx-run' }, [kindTag('SCH'), h('span', { class: 'mono', text: x[0] }), h('small', { class: x[2] ? 'on' : '', text: (x[1] || '') + (x[2] ? ' · on' : ' · switched off') })]); })
            .concat((m.serv || []).map(function (x) { return h('div', { class: 'dx-run' }, [kindTag(x[1] === 'OData' ? 'ODATA' : x[1] === 'REST' ? 'REST' : 'WS'), h('span', { class: 'mono', text: x[0] }), h('small', { text: 'published ' + x[1] })]); }));
          wrap.appendChild(h('div', { class: 'dx-md-links' }, [
            h('section', null, [h('h3', { class: 'dx-cap', text: 'Uses · ' + usesK.length }), h('p', { class: 'dx-md-hint', text: 'Modules whose flows it calls or whose entities it points to.' }),
              h('div', { class: 'dx-pd-rows' }, usesK.length ? byWeight(m.uses).map(function (k) { return row(k, m.uses[k], !!(byName[k] && byName[k].uses && byName[k].uses[m.n])); }) : [h('span', { class: 'dx-empty', text: 'None.' })])]),
            h('section', null, [h('h3', { class: 'dx-cap', text: 'Used by · ' + byK.length }), h('p', { class: 'dx-md-hint', text: 'Modules that call its flows or point to its entities.' }),
              h('div', { class: 'dx-pd-rows' }, byK.length ? byWeight(usedBy[m.n]).map(function (k) { return row(k, usedBy[m.n][k], !!(m.uses && m.uses[k])); }) : [h('span', { class: 'dx-empty', text: 'None.' })])]),
            h('section', null, [h('h3', { class: 'dx-cap', text: 'Runs on its own' }), h('p', { class: 'dx-md-hint', text: 'Scheduled events and services this module publishes.' }),
              h('div', { class: 'dx-pd-rows' }, runs.length ? runs : [h('span', { class: 'dx-empty', text: 'Nothing. Everything here starts from a page or from another module.' })])])
          ]));
        } else {
          wrap.appendChild(h('div', { class: 'dx-md-sec' }, [h('div', { class: 'dx-pd-rows' }, mRisks.length ? mRisks.map(function (x) {
            return ln({ view: 'risks', sub: riskId(x[1]) }, { class: 'dx-md-risk' }, [h('span', { class: 'dx-lv ' + x[0].level.toLowerCase(), text: x[0].level }),
              h('span', { class: 'dx-md-risk-t' }, [h('b', { text: x[0].title }), x[0].fix ? h('span', { text: x[0].fix }) : null]), h('span', { class: 'dx-rk-open' }, ['Open', navIcon('arrow', 12)])]);
          }) : [h('span', { class: 'dx-empty', text: 'No risks found in this module.' })])]));
        }
        main.appendChild(wrap);
      }

      // ---------- microflows, nanoflows and pages ----------
      // ---------- microflows & pages (redesign spec 14) ----------
      // MxScout's own Microflows screen (flowview.js), in the report's shell:
      // its header says what the page holds with the kind segment, its only
      // action is Copy link, and its state is the address — #/flows/{qn}
      // with ?seg= for the list, ?step= for the step and ?var= for the trace.
      var fu = { module: null, key: null, sort: 'az', show: 'all', filter: '', step: null, trace: null, tab: 'step', mview: 'source', studio: false };
      var flowSrc = null;
      function flowSource() {
        if (flowSrc) return flowSrc;
        var all = Object.keys(data.flows).map(function (k) { return data.flows[k]; });
        // What flowtrace.js and studioview.js read off the model — members'
        // types, a callee's parameters — in the model's own shape.
        var model = {
          entities: Object.keys(data.entities).map(function (q) {
            return { qualifiedName: q, attributes: (data.entities[q].attributes || []).map(function (a) {
              var t = String(a.type || ''), m = /^(\w+)\((\d+)\)$/.exec(t);
              return t.indexOf('Enumeration ') === 0 ? { name: a.name, type: 'Enumeration', enumerationQualifiedName: t.slice(12) } : m ? { name: a.name, type: m[1], length: Number(m[2]) } : { name: a.name, type: t };
            }) };
          }),
          associations: (data.associations || []).map(function (a) { return { name: a.name, owner: a.from, type: a.many ? 'ReferenceSet' : 'Reference' }; }),
          microflows: [], nanoflows: []
        };
        all.forEach(function (f) { if (f.kind !== 'page') model[f.kind + 's'].push({ qualifiedName: f.qn, returnType: f.returns, parameters: f.params.map(function (p) { return { name: p.name, type: p.type }; }) }); });
        // A risk names its places by qualified name, "|mf" (nf, pg) when a page and a flow share one.
        var TAG = { microflow: 'mf', nanoflow: 'nf', page: 'pg' }, byPlace = {};
        risks.forEach(function (r, i) {
          (r.where || []).forEach(function (w) {
            var m = /^([^|]+?)(?:\|(mf|nf|pg|en|dm))?$/.exec(String(w).trim());
            if (m) (byPlace[m[1]] = byPlace[m[1]] || []).push([m[2] || null, i]);
          });
        });
        flowSrc = {
          all: all, model: model,
          entry: function (kind, qn) {
            var ks = kind ? [kind] : ['microflow', 'nanoflow'];
            for (var i = 0; i < ks.length; i++) if (data.flows[ks[i] + ':' + qn]) return data.flows[ks[i] + ':' + qn];
            return null;
          },
          risks: function (e) {
            var seen = {}, out = [];
            (byPlace[e.qn] || []).forEach(function (x) { if ((!x[0] || x[0] === TAG[e.kind]) && !seen[x[1]]) { seen[x[1]] = true; out.push(x[1]); } });
            return out.sort(function (a, b) { return risks[a].level < risks[b].level ? -1 : risks[a].level > risks[b].level ? 1 : a - b; }).map(function (i) { return risks[i]; });
          },
          desc: function (e) { return e.desc ? { text: e.desc, stale: !!e.descStale } : null; }
        };
        return flowSrc;
      }
      function drawRefs() {
        if (!window.MxFlowView) { main.appendChild(h('div', { class: 'dx-note', text: 'This copy of the reader has no flow screen.' })); return; }
        var S = flowSource();
        var seg = st.seg === 'all' || st.seg === 'nanoflow' || st.seg === 'page' ? st.seg : 'microflow';
        var items = seg === 'all' ? S.all : S.all.filter(function (f) { return f.kind === seg; });
        // The address leads; the screen keeps what the address does not hold.
        if (st.key !== fu.key) {
          fu.key = st.key; fu.studio = false; fu.tab = 'step';
          if (st.key && data.flows[st.key]) fu.module = data.flows[st.key].module;
          else if (st.module) fu.module = st.module;
        }
        fu.step = st.step || null; fu.trace = st.trace || null; fu.studio = !!fu.step;
        if (st.mode === 'modeler' || st.mode === 'workflow') fu.mode = st.mode;
        // One kind at a time, as MxScout's Microflows, Nanoflows and Pages: the sidebar picks it.
        var nouns = { all: 'flows and pages', microflow: 'microflows', nanoflow: 'nanoflows', page: 'pages' };
        var mods2 = {};
        items.forEach(function (f) { mods2[f.module] = true; });
        setTitle({ all: 'Microflows & pages', microflow: 'Microflows', nanoflow: 'Nanoflows', page: 'Pages' }[seg],
          items.length + ' ' + nouns[seg] + ' in ' + Object.keys(mods2).length + ' modules, ' + (seg === 'page' ? 'with who may open each and from where' : 'each drawn from the model'));
        main.appendChild(h('div', { class: 'xe mf dx-flows' }, [window.MxFlowView.screen({ items: items, entry: S.entry, model: S.model, risks: S.risks, desc: S.desc }, fu, {
          noun: { all: 'flows and pages', microflow: 'microflows', nanoflow: 'nanoflows', page: 'pages' }[seg],
          kindTags: seg === 'all', empty: 'This model has none.',
          rerender: function () {
            var moved = fu.key !== st.key;
            st.key = fu.key; st.module = fu.module; st.step = fu.step; st.trace = fu.trace; st.mode = fu.mode || null;
            if (opts.hash) { var to = hashOf(st); if (location.hash !== to) history[moved ? 'pushState' : 'replaceState'](null, '', to); }
            if (opts.onState) opts.onState(st);
            draw();
          },
          openFlow: function (kind, qn) { var k = flowKey(qn, SEG_OF[kind]); if (k) go({ view: 'refs', key: k, seg: seg === 'all' ? 'all' : data.flows[k].kind }); },
          openRef: function (kind, qn) {
            if (kind === 'entity') { if (data.entities[qn]) go({ view: 'domain', entity: qn }); return; }
            var k = flowKey(qn, SEG_OF[kind]);
            if (k) go({ view: 'refs', key: k, seg: seg === 'all' ? 'all' : data.flows[k].kind });
          },
          actions: function () { return opts.hash ? [copyLink()] : []; }
        })]));
      }
      // Copy link (spec 10 §5): the address of what is on screen. The button
      // says it was copied (Karol, 2026-10-13: no toast).
      function copyLink() {
        var label = h('span', { text: 'Copy link' });
        var b = h('button', { type: 'button', class: 'mf-btn', title: 'Copy a link to this in this file' }, [navIcon('link', 14), label]);
        b.addEventListener('click', function () {
          if (!navigator.clipboard || !navigator.clipboard.writeText) return;
          navigator.clipboard.writeText(location.href).then(function () {
            label.textContent = 'Link copied';
            b.classList.add('done');
            setTimeout(function () { label.textContent = 'Copy link'; b.classList.remove('done'); }, 2000);
          }, function () { /* the browser said no */ });
        });
        return b;
      }

      // ---------- domain model (redesign spec 15) ----------
      // One module at a time: its entities drawn with the associations between
      // them, links to other modules at the foot of each entity, and the chosen
      // entity in full beside it — attributes, associations, who can access it.
      // A module bigger than DOMAIN_WHOLE is drawn around the chosen entity
      // (Karol, 2026-10-13); the List view always holds the whole module.
      var DOMAIN_WHOLE = 14, domZoom = 1, domLayouts = {};
      function domainOf(mod) {
        var D = derived();
        if (D && D.domain && D.domain[mod]) return D.domain[mod];
        return window.MxReportData ? window.MxReportData.domain(data, mod) : null;
      }
      function drawDomain() {
        var wide = !!(window.matchMedia && window.matchMedia('(min-width: 2000px)').matches);
        // Own modules and Marketplace ones apart, as App Explorer has them
        // (Karol, 2026-10-13): one list at a time, Own first.
        var allMods = [], mkt = {};
        data.modules.forEach(function (m) { if (m.entities.length) { allMods.push([m.name, m.entities.length]); if (m.marketplace) mkt[m.name] = true; } });
        allMods.sort(function (a, b) { return a[0].toLowerCase().localeCompare(b[0].toLowerCase()); });
        var ownMods = allMods.filter(function (m) { return !mkt[m[0]]; }), mktMods = allMods.filter(function (m) { return mkt[m[0]]; });
        var nAssoc = (data.associations || []).length;
        setTitle('Domain model', plural(Object.keys(data.entities).length, 'entity', 'entities') + ' in ' + plural(allMods.length, 'module', 'modules') + ', ' + plural(nAssoc, 'association', 'associations') + '. One module at a time; links to other modules sit at the foot of each entity.');
        if (!allMods.length) { main.appendChild(h('div', { class: 'dx-note', text: 'This model has no entities.' })); return; }
        // what the address names: an entity, or a module; else the first of the chosen list
        var named = st.entity && data.entities[st.entity] ? data.entities[st.entity].module
          : allMods.some(function (m) { return m[0] === st.entity; }) ? st.entity : (st.dmodule && allMods.some(function (m) { return m[0] === st.dmodule; }) ? st.dmodule : null);
        var scope = named ? (mkt[named] ? 'marketplace' : 'own') : (st.dscope === 'marketplace' && mktMods.length ? 'marketplace' : (ownMods.length ? 'own' : 'marketplace'));
        var mods = scope === 'marketplace' ? mktMods : ownMods;
        var mod = named || mods[0][0];
        var Dm = domainOf(mod);
        if (!Dm) { main.appendChild(h('div', { class: 'dx-note', text: 'This copy of the reader cannot draw the domain model.' })); return; }
        var E = Dm.ents, names = Object.keys(E).sort(function (a, b) { return a.localeCompare(b); });
        function short(q) { return String(q).split('.').pop(); }
        function modOf(q) { return String(q).split('.')[0]; }
        var inner = [], ext = {};
        Dm.assoc.forEach(function (a) {
          var fIn = modOf(a[1]) === mod, tIn = modOf(a[2]) === mod;
          if (fIn && tIn) inner.push(a);
          else if (fIn) { var x = ext[short(a[1])] || (ext[short(a[1])] = { out: {}, inn: {} }); x.out[short(a[2])] = (x.out[short(a[2])] || 0) + 1; }
          else if (tIn) { var y = ext[short(a[2])] || (ext[short(a[2])] = { out: {}, inn: {} }); y.inn[short(a[1])] = (y.inn[short(a[1])] || 0) + 1; }
        });
        var degree = {};
        names.forEach(function (n) { degree[n] = 0; });
        inner.forEach(function (a) { if (a[1] !== a[2]) { degree[short(a[1])]++; degree[short(a[2])]++; } });
        var best = names.slice().sort(function (a, b) { return degree[b] - degree[a] || a.localeCompare(b); })[0];
        var picked = st.entity && data.entities[st.entity] && data.entities[st.entity].module === mod ? short(st.entity) : null;
        // Nothing is picked on arrival, so every entity is drawn in full; a
        // click picks one and greys the rest, a click beside the boxes lets go
        // again (Karol, 2026-10-13, for MxScout's Entities screen; 2026-10-14,
        // the report too: it looks like MxScout).
        var free = true;
        var sel = picked || (free ? null : best), anchor = sel || best;
        var view = !free && st.dview === 'list' ? 'list' : 'diagram';
        function pickEntity(n) { return { view: 'domain', entity: mod + '.' + n, dmodule: mod }; }

        // the header: the module, and Diagram | List
        var modSel = h('select', { class: 'dx-dm-mod mono', 'aria-label': 'Module' }, mods.map(function (m) { var o = h('option', { value: m[0], text: m[0] + '  (' + m[1] + ')' }); if (m[0] === mod) o.selected = true; return o; }));
        modSel.addEventListener('change', function () { go({ view: 'domain', entity: modSel.value, dmodule: modSel.value }); });
        tools([h('label', { class: 'dx-dm-modbox' }, [h('span', { text: 'Module' }), modSel]),
          free ? null : h('div', { class: 'dx-seg2', role: 'group', 'aria-label': 'View' }, [['diagram', 'Diagram'], ['list', 'List']].map(function (v) {
            return h('button', { type: 'button', class: view === v[0] ? 'on' : '', 'aria-pressed': view === v[0] ? 'true' : 'false', text: v[1], onclick: function () { go({ dview: v[0] }); } });
          }))], null);

        // the wide layout's module list, with a search over every entity
        var find = h('input', { type: 'text', class: 'dx-rk-q', placeholder: 'Find an entity', 'aria-label': 'Find an entity' });
        var found = h('div', { class: 'dx-dm-found', hidden: true });
        find.addEventListener('input', function () {
          var q = find.value.trim().toLowerCase();
          clear(found); found.hidden = !q;
          if (!q) return;
          var hits = Object.keys(data.entities).filter(function (k) { return data.entities[k].name.toLowerCase().indexOf(q) !== -1; }).sort().slice(0, 12);
          add(found, hits.length ? hits.map(function (k) { return ln({ view: 'domain', entity: k, dmodule: data.entities[k].module }, { class: 'dx-dm-hit' }, [h('b', { class: 'mono', text: data.entities[k].name }), h('small', { class: 'mono', text: data.entities[k].module })]); })
            : [h('span', { class: 'dx-empty', text: 'No entity is called that.' })]);
        });
        function scopeBtn(key, label, list) {
          var on = scope === key;
          return h('button', { type: 'button', class: on ? 'on' : '', 'aria-pressed': on ? 'true' : 'false', disabled: list.length ? null : 'disabled',
            onclick: function () { if (!on && list.length) go({ view: 'domain', dscope: key, entity: list[0][0], dmodule: list[0][0] }); } }, [label, h('span', { class: 'dx-fc-n', text: String(list.length) })]);
        }
        var scopeBar = mktMods.length ? h('div', { class: 'dx-seg2 dx-dm-scope', role: 'group', 'aria-label': 'Which modules' }, [scopeBtn('own', 'Own', ownMods), scopeBtn('marketplace', 'Marketplace', mktMods)]) : null;
        var modList = h('aside', { class: 'dx-dm-mods', 'aria-label': 'Modules', 'data-keep-scroll': 'dm-mods:' + scope }, [h('label', { class: 'dx-rk-search' }, [navIcon('search', 14), find]), found, scopeBar,
          h('span', { class: 'dx-cap', text: 'Modules · ' + mods.length })].concat(mods.map(function (m) {
          return ln({ view: 'domain', entity: m[0], dmodule: m[0] }, { class: 'dx-dm-mrow mono' + (m[0] === mod ? ' on' : '') }, [h('span', { text: m[0] }), h('span', { class: 'dx-fc-n', text: String(m[1]) })]);
        })));

        // ---- the canvas ----
        var G = wide ? { w: 272, gx: 84, gy: 76, rowH: 23, maxA: 10, head: 40, foot: 30, pad: 56 } : { w: 196, gx: 56, gy: 52, rowH: 21, maxA: 5, head: 38, foot: 28, pad: 36 };
        G.fy = Math.round(G.head / 2);
        function footOf(n, shown) {
          var x = ext[n] || { out: {}, inn: {} }, out = {}, inn = {};
          Object.keys(x.out).forEach(function (k) { out[k] = x.out[k]; });
          Object.keys(x.inn).forEach(function (k) { inn[k] = x.inn[k]; });
          // around one entity: the module's own links to entities not drawn go to the foot as well
          inner.forEach(function (a) {
            var f = short(a[1]), t2 = short(a[2]);
            if (f === n && t2 !== n && !shown[t2]) out[t2] = (out[t2] || 0) + 1;
            if (t2 === n && f !== n && !shown[f]) inn[f] = (inn[f] || 0) + 1;
          });
          var o = Object.keys(out).sort(function (a, b) { return out[b] - out[a] || a.localeCompare(b); }).map(function (k) { return k + (out[k] > 1 ? ' ×' + out[k] : ''); });
          var i2 = Object.keys(inn).sort().map(function (k) { return '← ' + k + (inn[k] > 1 ? ' ×' + inn[k] : ''); });
          return (o.length ? '↗ ' + o.join(' · ') : '') + (o.length && i2.length ? '   ' : '') + i2.join(' · ');
        }
        // Embedded in MxScout every entity of the module is drawn, the ones not
        // linked to the picked one greyed rather than left out (Karol,
        // 2026-10-13); the report keeps drawing a big module around one.
        var whole = free || names.length <= DOMAIN_WHOLE;
        function around(x) {
          var o = {};
          if (!x) return o;
          o[x] = true;
          inner.forEach(function (a) { var f = short(a[1]), t2 = short(a[2]); if (f === x) o[t2] = true; if (t2 === x) o[f] = true; });
          return o;
        }
        var nbr = around(sel), near = around(anchor);
        var shownNames = whole ? names : names.filter(function (n) { return near[n]; });
        var shown = {};
        shownNames.forEach(function (n) { shown[n] = true; });
        var pm = {};
        inner.forEach(function (a) {
          var f = short(a[1]), t2 = short(a[2]);
          if (f === t2 || !shown[f] || !shown[t2]) return;
          var k = f < t2 ? f + '>' + t2 : t2 + '>' + f;
          var p = pm[k] || (pm[k] = { a: f, b: t2, n: 0, many: false, names: [], each: [] });
          p.n++; p.names.push(a[0]); if (a[3]) p.many = true;
          p.each.push({ name: a[0], owner: f, many: !!a[3] });
        });
        var pairs = Object.keys(pm).map(function (k) { return pm[k]; });
        function boxH(n) { var na = E[n].attrs.length; return G.head + Math.min(na, G.maxA) * G.rowH + 14 + (footOf(n, shown) ? G.foot : 0); }
        // Where the boxes sit depends on the module and which of its entities are drawn, not on which
        // one is picked: worked out once and kept, so a click on an entity only redraws (a large
        // module's layout is a search that took a second, and boxes moved between two clicks).
        var lkey = mod + '\n' + (wide ? 'w' : 'n') + '\n' + shownNames.join('\n');
        var L = domLayouts[lkey] || (domLayouts[lkey] = domainLayout(shownNames, pairs, function (n) { return { w: G.w, h: boxH(n) }; }, G));
        var stage = h('div', { class: 'dx-dm-stage' });
        stage.style.width = L.W + 'px'; stage.style.height = L.H + 'px';
        var svg = s('svg', { class: 'dx-dm-svg', width: L.W, height: L.H, 'aria-hidden': 'true' });
        stage.appendChild(svg);
        function r1(v) { return Math.round(v * 10) / 10; }
        function pathOf(p, r) {
          var d = 'M' + r1(p[0][0]) + ' ' + r1(p[0][1]);
          for (var i = 1; i < p.length - 1; i++) {
            var a = p[i - 1], b = p[i], c = p[i + 1];
            var l1 = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]), l2 = Math.abs(c[0] - b[0]) + Math.abs(c[1] - b[1]);
            var rr = Math.min(r, l1 / 2, l2 / 2);
            var p1 = [b[0] + (a[0] - b[0]) / (l1 || 1) * rr, b[1] + (a[1] - b[1]) / (l1 || 1) * rr], p2 = [b[0] + (c[0] - b[0]) / (l2 || 1) * rr, b[1] + (c[1] - b[1]) / (l2 || 1) * rr];
            d += ' L' + r1(p1[0]) + ' ' + r1(p1[1]) + ' Q' + r1(b[0]) + ' ' + r1(b[1]) + ' ' + r1(p2[0]) + ' ' + r1(p2[1]);
          }
          var z = p[p.length - 1];
          return d + ' L' + r1(z[0]) + ' ' + r1(z[1]);
        }
        function endLabel(p, q, txt, on) {
          var dx = q[0] - p[0], dy = q[1] - p[1], len = Math.abs(dx) + Math.abs(dy) || 1; dx /= len; dy /= len;
          var t2 = s('text', { class: 'dx-dm-mult' + (on ? ' on' : ''), x: r1(p[0] + dx * 10 - dy * 8), y: r1(p[1] + dy * 10 + dx * 8 + 4), 'text-anchor': 'middle' });
          t2.textContent = txt;
          return t2;
        }
        var lines = L.routes.slice().sort(function (a, b) { return ((a.p.a === sel || a.p.b === sel) ? 1 : 0) - ((b.p.a === sel || b.p.b === sel) ? 1 : 0); });
        // Each association is its own line (Karol, 2026-10-13: "two associations — just draw two"):
        // a pair with more than one is drawn as parallel lines along the same route, 7px apart.
        function offsetPts(pts, d) {
          if (!d) return pts;
          return pts.map(function (pt, i) {
            var ox = 0, oy = 0;
            [[pts[i - 1], pt], [pt, pts[i + 1]]].forEach(function (sg) {
              if (!sg[0] || !sg[1]) return;
              var dx = sg[1][0] - sg[0][0], dy = sg[1][1] - sg[0][1], len = Math.abs(dx) + Math.abs(dy);
              if (!len) return;
              if (Math.abs(dx) >= Math.abs(dy)) oy = (dx > 0 ? 1 : -1) * d; else ox = (dy > 0 ? -1 : 1) * d;
            });
            return [pt[0] + ox, pt[1] + oy];
          });
        }
        lines.forEach(function (rt) {
          var on = rt.p.a === sel || rt.p.b === sel;
          rt.p.each.forEach(function (as, k) {
            var pts = offsetPts(rt.pts, (k - (rt.p.each.length - 1) / 2) * 7);
            // the route runs from p.a to p.b; an association owned at p.b runs the other way
            var fwd = as.owner === rt.p.a;
            var path = s('path', { class: 'dx-dm-edge' + (on ? ' on' : ''), d: pathOf(pts, 8) });
            var ti = s('title'); ti.textContent = as.name; path.appendChild(ti);
            svg.appendChild(path);
            // a line starts at its owner: * there, 1 at the other end — or * for a reference set
            var own = fwd ? [pts[0], pts[1]] : [pts[pts.length - 1], pts[pts.length - 2]];
            var oth = fwd ? [pts[pts.length - 1], pts[pts.length - 2]] : [pts[0], pts[1]];
            svg.appendChild(endLabel(own[0], own[1], '*', on));
            svg.appendChild(endLabel(oth[0], oth[1], as.many ? '*' : '1', on));
          });
        });
        function marker(e) { return h('span', { class: 'dx-dm-mk ' + (e.view ? 'view' : e.pers ? 'pers' : 'np'), 'aria-hidden': 'true' }); }
        shownNames.forEach(function (n) {
          var e = E[n], b = L.pos[n], on = n === sel, dim = !!sel && whole && !nbr[n];
          var na = e.attrs.length, list2 = na > G.maxA ? e.attrs.slice(0, G.maxA - 1) : e.attrs;
          var foot = footOf(n, shown);
          var box = ln(pickEntity(n), { class: 'dx-dm-box' + (e.pers ? '' : ' np') + (e.view ? ' view' : '') + (on ? ' on' : '') + (dim ? ' dim' : ''), 'aria-pressed': on ? 'true' : 'false', title: mod + '.' + n }, [
            // The kind, told two ways (Karol, 2026-10-13: "persistable, not and view must differ more"):
            // the header's colour and the outline (solid, dashed, dotted); the legend names them. The
            // word under the name went (2026-10-14: "not needed").
            h('span', { class: 'dx-dm-bh' }, [marker(e), h('b', { class: 'mono', text: n }), h('small', { class: 'mono', text: String(na) })]),
            h('span', { class: 'dx-dm-attrs' }, list2.map(function (a) { return h('span', { class: 'dx-dm-attr mono' }, [h('span', { text: a[0] }), h('small', { text: a[1] })]); })
              .concat(na > G.maxA ? [h('span', { class: 'dx-dm-attr more', text: '+ ' + (na - G.maxA + 1) + ' more' })] : [])),
            foot ? h('span', { class: 'dx-dm-foot mono', title: foot, text: foot }) : null
          ]);
          box.style.left = b.x + 'px'; box.style.top = b.y + 'px'; box.style.width = b.w + 'px'; box.style.height = b.h + 'px';
          if (opts.entityMenu) box.addEventListener('contextmenu', function (ev) { opts.entityMenu(mod + '.' + n, ev); }); // MxScout's context (basket.js)
          stage.appendChild(box);
        });
        // a visual zoom only (spec 15 [LUKA]; Karol, 2026-10-13): the layout stays, the view scales
        var scaler = h('div', { class: 'dx-dm-scaler' }, [stage]);
        function applyZoom() {
          stage.style.transform = 'scale(' + domZoom + ')';
          scaler.style.width = r1(L.W * domZoom) + 'px'; scaler.style.height = r1(L.H * domZoom) + 'px';
          zoomLabel.textContent = Math.round(domZoom * 100) + '%';
        }
        var zoomLabel = h('span', { class: 'mono dx-dm-zl' });
        var canvas = h('section', { class: 'dx-dm-canvas', 'aria-label': mod + ' entities' });
        var zoomBar = h('div', { class: 'dx-dm-zoom' }, [
          h('button', { type: 'button', 'aria-label': 'Zoom out', text: '−', onclick: function () { domZoom = Math.max(0.5, Math.round((domZoom - 0.1) * 10) / 10); applyZoom(); } }), zoomLabel,
          h('button', { type: 'button', 'aria-label': 'Zoom in', text: '+', onclick: function () { domZoom = Math.min(2, Math.round((domZoom + 0.1) * 10) / 10); applyZoom(); } }),
          h('span', { class: 'dx-dm-zsep' }),
          h('button', { type: 'button', class: 'fit', text: 'Fit', onclick: function () { var r = canvas.getBoundingClientRect(); domZoom = Math.max(0.5, Math.min(2, Math.floor(Math.min((r.width - 40) / L.W, (r.height - 90) / L.H) * 100) / 100)); applyZoom(); } })
        ]);
        var legend = h('div', { class: 'dx-dm-legend' }, [
          h('span', { title: 'Stored in the database' }, [h('i', { class: 'dx-dm-mk pers' }), 'Persistable']),
          h('span', { title: 'Lives only in memory, never stored' }, [h('i', { class: 'dx-dm-mk np' }), 'Non-persistable']),
          h('span', { title: 'Its rows are what an OQL query returns, served read-only' }, [h('i', { class: 'dx-dm-mk view' }), 'View entity']),
          h('span', { title: 'An association: * at the entity that owns it, 1 at the one it points to (* at both ends for a reference set)' }, [h('b', { class: 'mono', text: '* 1' }), 'association']),
          h('span', { title: 'An association to an entity in another module, listed at the foot of the box' }, [h('b', { text: '↗' }), 'other module'])]);
        var wrapEl = h('div', { class: 'dx-dm-wrap', 'data-keep-scroll': 'dm-wrap:' + scope + '|' + mod + '|' + (sel || '') }, [scaler]);
        // Ctrl (or ⌘) and the wheel zoom too, as in Studio Pro — a trackpad's pinch arrives the same
        // way — keeping the point under the pointer where it is.
        wrapEl.addEventListener('wheel', function (ev) {
          if (!ev.ctrlKey && !ev.metaKey) return;
          ev.preventDefault();
          var r = wrapEl.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
          var ax = (wrapEl.scrollLeft + mx) / domZoom, ay = (wrapEl.scrollTop + my) / domZoom;
          var next = Math.max(0.5, Math.min(2, Math.round(domZoom * Math.exp(-ev.deltaY * 0.0025) * 100) / 100));
          if (next === domZoom) return;
          domZoom = next; applyZoom();
          wrapEl.scrollLeft = ax * domZoom - mx; wrapEl.scrollTop = ay * domZoom - my;
        }, { passive: false });
        if (free) wrapEl.addEventListener('click', function (ev) {
          if (sel && !(ev.target.closest && ev.target.closest('.dx-dm-box'))) go({ view: 'domain', entity: mod, dmodule: mod });
        });
        if (view === 'diagram') {
          applyZoom();
          add(canvas, [
            whole ? null : h('p', { class: 'dx-dm-part', text: plural(names.length, 'entity', 'entities') + ' in ' + mod + ' — showing the ones around ' + anchor + '. Pick another to move.' }),
            wrapEl,
            h('div', { class: 'dx-dm-bar' }, [legend, zoomBar])
          ]);
        } else {
          var cnt = function (n) { return Dm.assoc.filter(function (a) { return a[1] === mod + '.' + n || a[2] === mod + '.' + n; }).length; };
          add(canvas, h('div', { class: 'dx-dm-list', role: 'table', 'data-keep-scroll': 'dm-list:' + scope + '|' + mod }, [h('div', { class: 'dx-dm-lr head', role: 'row' }, ['Entity', 'Kind', 'Attributes', 'Associations', 'Access rules', 'Description'].map(function (x) { return h('span', { text: x }); }))]
            .concat(names.map(function (n) {
              var e = E[n];
              return ln(pickEntity(n), { class: 'dx-dm-lr' + (n === sel ? ' on' : ''), role: 'row' }, [h('span', { class: 'mono dx-dm-ln' }, [marker(e), n]), h('span', { text: kindOf(e) }),
                h('span', { class: 'mono num', text: String(e.attrs.length) }), h('span', { class: 'mono num', text: String(cnt(n)) }), h('span', { class: 'mono num', text: String(e.access.length) }), h('span', { class: 'dx-dm-desc', text: e.desc || '—' })]);
            }))));
        }
        function kindOf(e) { return e.view ? 'View entity' : e.pers ? 'Persistable' : 'Non-persistable'; }

        // ---- the inspector ----
        if (!sel) {
          main.appendChild(h('div', { class: 'dx-dm', 'data-keep-scroll': 'dm:' + scope + '|' + mod + '|' }, [modList, canvas, h('aside', { class: 'dx-dm-insp', 'aria-label': 'Entity', 'data-keep-scroll': 'dm-insp:' + scope + '|' + mod + '|' }, [
            h('div', { class: 'dx-dm-ih' }, [
              h('div', { class: 'dx-dm-meta' }, [h('span', { text: 'Module' })]),
              h('h2', { class: 'mono', text: mod }),
              h('div', { class: 'dx-dm-stats' }, [[names.length, names.length === 1 ? 'entity' : 'entities'], [inner.length, 'associations inside'], [Dm.assoc.length - inner.length, 'to other modules']].map(function (x) { return h('div', null, [h('span', { class: 'mono', text: String(x[0]) }), h('small', { text: x[1] })]); })),
              h('p', { class: 'dx-dm-d', text: 'Click an entity to see its attributes, its associations and who may read, write, create and delete it.' })
            ])
          ])]));
          return;
        }
        var e = E[sel];
        var owned = {}, refBy = {};
        Dm.assoc.forEach(function (a) {
          if (a[1] === mod + '.' + sel) { var g = owned[a[2]] || (owned[a[2]] = { q: a[2], many: a[3], names: [] }); g.names.push(a[0]); }
          if (a[2] === mod + '.' + sel && a[1] !== a[2]) { var g2 = refBy[a[1]] || (refBy[a[1]] = { q: a[1], many: a[3], names: [] }); g2.names.push(a[0]); }
        });
        function sortG(m) { return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.names.length - a.names.length || short(a.q).localeCompare(short(b.q)); }); }
        var ownedL = sortG(owned), refL = sortG(refBy);
        var nOwned = ownedL.reduce(function (s2, g) { return s2 + g.names.length; }, 0), nRef = refL.reduce(function (s2, g) { return s2 + g.names.length; }, 0);
        var members = e.attrs.length + nOwned;
        function assocRow(g, out) {
          var inMod = modOf(g.q) === mod && data.entities[g.q];
          var kids = [h('span', { class: 'dx-dm-at' }, [h('b', { class: 'mono' + (inMod ? ' in' : ''), text: short(g.q) }), inMod ? null : h('span', { class: 'mono dx-dm-am', text: modOf(g.q) }), g.names.length > 1 ? h('span', { class: 'mono dx-dm-ac', text: '×' + g.names.length }) : null]),
            h('span', { class: 'mono dx-dm-mu', text: out ? (g.many ? '*–*' : '*–1') : (g.many ? '*–*' : '1–*') }), h('span', { class: 'mono dx-dm-an', text: g.names.join(', ') })];
          return data.entities[g.q] ? ln({ view: 'domain', entity: g.q, dmodule: modOf(g.q) }, { class: 'dx-dm-arow' }, kids) : h('div', { class: 'dx-dm-arow' }, kids);
        }
        function chip(txt, yes) { return h('span', { class: 'dx-dm-can' + (yes ? ' yes' : ' no'), text: txt }); }
        function accChip(txt, r) {
          if (!r[7]) return chip(txt, true);
          return h('button', { type: 'button', class: 'dx-dm-can yes link', title: 'What role ' + r[0] + ' may read and write, member by member', text: txt, onclick: function () { openAccess(r); } });
        }
        // One role's access to this entity, member by member: write green,
        // read plain, nothing faded.
        // What MxScout's own analysis says about one rule (the app passes it; the exported report has none).
        function notesOf(r) { return opts.accessNotes ? opts.accessNotes(mod + '.' + sel, r[0].indexOf('.') > 0 ? r[0] : mod + '.' + r[0]) || [] : []; }
        function openAccess(r) {
          var m = r[7] || {};
          var rows = e.attrs.map(function (a) { return { name: a[0], type: a[1], kind: 'attribute' }; })
            .concat(ownedL.reduce(function (acc, g) { return acc.concat(g.names.map(function (n) { return { name: n, type: '→ ' + short(g.q), kind: 'association' }; })); }, []));
          function level(n) { var v = m[n]; return v === 'rw' ? 'write' : v === 'r' ? 'read' : 'none'; }
          var count = { write: 0, read: 0, none: 0 };
          rows.forEach(function (x) { count[level(x.name)]++; });
          var closeBtn = h('button', { type: 'button', class: 'dx-ac-close', 'aria-label': 'Close', text: '×', onclick: function () { close(); } });
          var dialog = h('div', { class: 'dx-ac', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Access of ' + r[0] + ' to ' + sel }, [
            h('div', { class: 'dx-ac-head' }, [
              h('div', null, [h('span', { class: 'dx-cap', text: 'Module role ' + r[0] }), h('h2', { class: 'mono', text: sel })]),
              closeBtn
            ]),
            h('div', { class: 'dx-ac-sum' }, [
              h('span', { class: 'dx-ac-k write' }, [h('b', { class: 'mono', text: String(count.write) }), ' write']),
              h('span', { class: 'dx-ac-k read' }, [h('b', { class: 'mono', text: String(count.read) }), ' read only']),
              h('span', { class: 'dx-ac-k none' }, [h('b', { class: 'mono', text: String(count.none) }), ' no access']),
              h('span', { class: 'dx-ac-cd', text: (r[4] ? 'create' : 'no create') + ' · ' + (r[5] ? 'delete' : 'no delete') })
            ]),
            h('div', { class: 'dx-ac-list' }, rows.map(function (x) {
              var lv = level(x.name);
              return h('div', { class: 'dx-ac-row ' + lv }, [
                h('span', { class: 'mono dx-ac-n', text: x.name }),
                h('small', { class: 'mono', text: x.type }),
                h('span', { class: 'dx-ac-lv', text: lv === 'write' ? 'read + write' : lv === 'read' ? 'read' : 'no access' })
              ]);
            })),
            r[6] ? h('div', { class: 'dx-dm-x' }, [h('span', { text: 'Only rows where' }), xpathView(r[6])]) : null,
            notesOf(r).length ? h('div', { class: 'dx-ac-notes' }, [h('h3', { class: 'dx-cap', text: 'Checked against what uses it · ' + notesOf(r).length })].concat(notesOf(r).map(function (n) {
              return h('div', { class: 'dx-ac-note ' + n.tone }, [
                h('b', { text: n.title }),
                h('p', { text: n.text }),
                (n.places || []).length ? h('div', { class: 'dx-ac-places' }, n.places.map(function (pl) { return h('span', { class: 'mono', text: pl }); })) : null
              ]);
            }))) : null
          ]);
          var scrim = h('div', { class: 'dx-ac-scrim', onclick: function (ev) { if (ev.target === scrim) close(); } }, [dialog]);
          function close() { scrim.remove(); }
          scrim.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { ev.preventDefault(); close(); } });
          root.appendChild(scrim);
          closeBtn.focus();
        }
        var note = null;
        if (!e.pers) note = sel + ' is not stored in the database. Its access rules still apply on the client.';
        else if (e.access.length && e.access.every(function (r) { return !r[4] && !r[5]; })) note = 'No module role can create or delete ' + sel + ' from the client.';
        var insp = h('aside', { class: 'dx-dm-insp', 'aria-label': 'Entity', 'data-keep-scroll': 'dm-insp:' + scope + '|' + mod + '|' + sel }, [
          h('div', { class: 'dx-dm-ih' }, [
            h('div', { class: 'dx-dm-meta' }, [h('span', null, ['Entity in ', h('span', { class: 'mono', text: mod })]), h('span', { 'aria-hidden': 'true', text: '·' }), h('span', { class: 'dx-dm-kind' }, [marker(e), kindOf(e)])]),
            h('h2', { class: 'mono', text: sel }),
            e.desc ? h('p', { class: 'dx-dm-d', text: e.desc }) : null,
            e.desc ? h('span', { class: 'dx-prov', text: 'Description written by an agent from the model.' }) : null,
            h('div', { class: 'dx-dm-stats' }, [[e.attrs.length, 'attributes'], [nOwned + nRef, 'associations'], [e.access.length, 'access rules']].map(function (x) { return h('div', null, [h('span', { class: 'mono', text: String(x[0]) }), h('small', { text: x[1] })]); })),
            note ? h('p', { class: 'dx-ar-note' }, [navIcon('info', 14), h('span', null, [h('b', { text: 'Read from the model. ' }), note])]) : null,
            // MxScout's own: what the app can do with the entity (its data, a comment).
            opts.entityActions ? h('div', { class: 'dx-dm-acts' }, opts.entityActions(mod + '.' + sel)) : null
          ]),
          opts.entitySection ? opts.entitySection(mod + '.' + sel) : null,
          h('section', { class: 'dx-dm-sec' }, [h('h3', { class: 'dx-cap', text: 'Attributes · ' + e.attrs.length }), h('div', { class: 'dx-pd-rows' }, e.attrs.length ? e.attrs.map(function (a) {
            return h('div', { class: 'dx-dm-attrrow' }, [h('span', { class: 'mono', text: a[0] }), h('small', { text: a[2] })]);
          }) : [h('span', { class: 'dx-empty', text: 'None of its own' + (e.gen ? ' — it inherits those of ' + short(e.gen) + '.' : '.') })])]),
          h('section', { class: 'dx-dm-sec' }, [h('h3', { class: 'dx-cap', text: 'Associations · ' + (nOwned + nRef) })].concat(
            ownedL.length ? [h('span', { class: 'dx-dm-gt', text: 'It refers to · ' + nOwned }), h('div', { class: 'dx-pd-rows' }, ownedL.map(function (g) { return assocRow(g, true); }))] : [],
            refL.length ? [h('span', { class: 'dx-dm-gt', text: 'Refers to it · ' + nRef }), h('div', { class: 'dx-pd-rows' }, refL.map(function (g) { return assocRow(g, false); }))] : [],
            !ownedL.length && !refL.length ? [h('span', { class: 'dx-empty', text: 'None.' })] : [])),
          h('section', { class: 'dx-dm-sec dx-acc' }, [h('h3', { class: 'dx-cap', text: 'Who can access it · ' + e.access.length })].concat(e.access.length ? e.access.map(function (r) {
            return h('div', { class: 'dx-dm-rule dx-acc-row' }, [
              h('div', { class: 'dx-dm-users' }, (r[1].length ? r[1] : ['no user role carries it']).map(function (u) { return h('span', { text: u }); })),
              h('span', { class: 'mono dx-dm-mr', text: 'module role ' + r[0] }),
              h('div', { class: 'dx-dm-cans' }, [
                // read / write open the member list for this role, when the data carries it (Karol, 2026-10-13)
                r[2] ? accChip('read ' + (r[2] >= members ? 'all ' + r[2] : r[2] + ' of ' + members), r) : chip('no read', false),
                r[3] ? accChip('write ' + (r[3] >= members ? 'all ' + r[3] : r[3] + ' of ' + members), r) : chip('no write', false),
                chip(r[4] ? 'create' : 'no create', r[4]), chip(r[5] ? 'delete' : 'no delete', r[5]),
                (function () {
                  var ns = notesOf(r);
                  if (!ns.length) return null;
                  var tone = ns.some(function (n) { return n.tone === 'find'; }) ? 'find' : 'note';
                  return h('button', { type: 'button', class: 'dx-ac-chk ' + tone, title: 'What MxScout found when it set this rule against what uses it', onclick: function () { openAccess(r); } }, [ns.length + (ns.length === 1 ? ' check' : ' checks')]);
                })()]),
              r[6] ? h('div', { class: 'dx-dm-x' }, [h('span', { text: 'Only rows where' }), xpathView(r[6])]) : h('span', { class: 'dx-dm-every', text: 'Every row' })
            ]);
          }) : [h('span', { class: 'dx-empty', text: 'No access rule: no module role reaches it from the client.' })]))
        ]);
        main.appendChild(h('div', { class: 'dx-dm' + (view === 'list' ? ' list' : ''), 'data-keep-scroll': 'dm:' + scope + '|' + mod + '|' + sel + '|' + view }, [modList, canvas, insp]));
        // the chosen box in view
        var onBox = stage.querySelector('.dx-dm-box.on');
        if (view === 'diagram' && onBox) requestFrame(function () { var wrapEl = canvas.querySelector('.dx-dm-wrap'); if (!wrapEl || !onBox.isConnected) return; var r = onBox.getBoundingClientRect(), c = wrapEl.getBoundingClientRect(); if (r.right > c.right || r.bottom > c.bottom || r.left < c.left || r.top < c.top) { wrapEl.scrollTop += (r.top - c.top) - (c.height - r.height) / 2; wrapEl.scrollLeft += (r.left - c.left) - (c.width - r.width) / 2; } });
      }

      // ---------- model quality (redesign spec 18) ----------
      // Six checks read straight from the model, each with its count, the
      // Mendix guideline it is measured against — quoted, with its source —
      // and the elements it found. Nothing here is an agent's.
      var QKIND = { mf: 'MF', nf: 'NF', pg: 'PG' };
      function drawQuality() {
        setTitle('Model quality', 'Six checks read straight from the model and measured against Mendix’s own guidelines. Nothing on this page was written by an agent.');
        var D = derived(), Q = D && D.quality;
        if (!Q) { main.appendChild(h('div', { class: 'dx-note', text: 'This copy of the reader has no checks.' })); return; }
        var schedOff = Q.sched.filter(function (x) { return !x[2]; }).length;
        var allFlows = Object.keys(data.flows).map(function (k) { return data.flows[k]; }).filter(function (f) { return f.kind !== 'page'; });
        var over50 = allFlows.filter(function (f) { return (f.steps || 0) > 50; }).length;
        var offN = (Q.offAll || []).length;
        var CH = [
          { id: 'unreached', group: 'Unused', v: Q.unr.length, label: 'Nothing reaches these', sub: 'No caller, no page, no menu, no role', warn: true },
          { id: 'off', group: 'Unused', v: offN, label: offN === 1 ? 'Switched-off step' : 'Switched-off steps', sub: 'A step disabled inside a flow', warn: true },
          { id: 'sched', group: 'Background', v: schedOff, of: Q.sched.length, label: 'Scheduled events switched off', sub: 'Off in the model; production may differ', warn: true },
          { id: 'large', group: 'Size', v: Q.over, of: Q.flowsN, label: 'Flows over 25 elements', sub: Q.large.length ? 'Longest has ' + plural(Q.large[0][2], 'step', 'steps') : 'None', warn: true },
          { id: 'names', group: 'Naming', v: Q.prefN, label: 'Prefixes outside the convention', sub: Q.pref.length ? plural(Q.pref.length, 'prefix', 'prefixes') + ', e.g. ' + Q.pref.slice(0, 3).map(function (p) { return p[0] + '_'; }).join(', ') : 'None', warn: false },
          { id: 'access', group: 'Security', v: Q.eaApplied, of: Q.eaTotal, label: 'Microflows that apply entity access', sub: 'The rest skip the access rules', warn: false }
        ];
        var chk = CH.some(function (c) { return c.id === st.sub; }) ? st.sub : 'unreached';
        var cards = h('div', { class: 'dx-q-cards', role: 'tablist', 'aria-label': 'Checks' }, CH.map(function (c) {
          var on = c.id === chk;
          return ln({ view: 'quality', sub: c.id }, { class: 'dx-q-card' + (on ? ' on' : ''), role: 'tab', 'aria-selected': on ? 'true' : 'false' }, [
            h('span', { class: 'dx-q-g' }, [h('span', { text: c.group }), h('span', { class: 'dx-q-dot' + (c.warn ? ' warn' : '') })]),
            h('span', { class: 'dx-q-v' }, [h('span', { class: 'mono', text: String(c.v) }), c.of !== undefined ? h('small', { class: 'mono', text: 'of ' + c.of }) : null]),
            h('b', { text: c.label }), h('small', { text: c.sub })
          ]);
        }));

        function split(qn) { var i = String(qn).indexOf('.'); return [qn.slice(0, i + 1), qn.slice(i + 1)]; }
        function qn(name) { var s2 = split(name); return h('span', { class: 'mono dx-q-qn' }, [h('span', { class: 'dx-mod', text: s2[0] }), s2[1]]); }
        function flowLink(kind, name, kids, step) {
          var k = flowKey(name, kind);
          if (!k) return h('div', { class: 'dx-q-row' }, kids);
          return ln({ view: 'refs', module: data.flows[k].module, seg: data.flows[k].kind, key: k, step: step || null }, { class: 'dx-q-row' }, kids);
        }
        function modLink(mod, kids) { return data.modules.some(function (m) { return m.name === mod; }) ? ln({ view: 'modules', module: mod }, { class: 'dx-q-row' }, kids) : h('div', { class: 'dx-q-row' }, kids); }
        var cur;
        if (chk === 'unreached') {
          cur = { title: 'Nothing reaches these', cols: ['', 'Element', 'Steps', 'Folder'], grid: 'unr',
            why: 'No microflow, page, menu, scheduled event, published service, App Settings or button in the model refers to ' + (Q.unr.length === 1 ? 'this element' : 'these ' + Q.unr.length + ' elements') + ', and no role may start ' + (Q.unr.length === 1 ? 'it' : 'them') + ' directly. They are candidates for removal, or a reference was forgotten. Java actions are not read, so a flow only Java code calls shows up here too. Marketplace modules are left out.',
            rule: GUIDE.unreached[0], src: GUIDE.unreached[1],
            rows: Q.unr.map(function (u) { return flowLink(u[0], u[1], [kindTag(QKIND[u[0]] || '··'), qn(u[1]), h('span', { class: 'mono dx-q-num', text: u[0] === 'pg' ? '' : String(u[2]) }), h('span', { class: 'dx-q-muted', text: u[3] || '—' })]); }) };
        } else if (chk === 'off') {
          cur = { title: offN === 1 ? 'A step switched off inside a flow' : 'Steps switched off inside flows', cols: ['', 'Flow', 'Step', 'Switched-off action'], grid: 'off',
            why: offN ? (offN === 1 ? 'One step in the model is switched off. Its flow still runs, but skips it, so whatever that step did no longer happens.'
              : offN + ' steps in the model are switched off. Their flows still run, but skip them, so whatever those steps did no longer happens.') : 'No step in the model is switched off.',
            rule: '', src: '',
            rows: (Q.offAll || []).map(function (o) { return flowLink(null, o.flow, [kindTag('MF'), qn(o.flow), h('span', { class: 'mono dx-q-num', text: String(o.no) }), h('span', { class: 'mono dx-q-qn' }, [h('span', { class: 'dx-mod', text: (o.kick || 'Step') + ' · ' }), o.title || ''])], o.no); }) };
        } else if (chk === 'sched') {
          cur = { title: 'Scheduled events switched off', cols: ['', 'Event', 'Runs', 'State'], grid: 'sched',
            why: schedOff + ' of ' + plural(Q.sched.length, 'scheduled event is', 'scheduled events are') + ' off in the model. Whatever depends on them does not run unless an environment switches them on, and the model cannot show whether one does.',
            rule: GUIDE.sched[0], src: GUIDE.sched[1],
            rows: Q.sched.slice().sort(function (a, b) { return (b[2] ? 1 : 0) - (a[2] ? 1 : 0) || a[0].localeCompare(b[0]); }).map(function (x) {
              return modLink(x[0].split('.')[0], [h('span', { class: 'dx-q-state' + (x[2] ? ' on' : '') }), qn(x[0]), h('span', { class: 'dx-q-muted', text: x[1] || '' }), h('span', { class: 'dx-q-onoff' + (x[2] ? ' on' : ''), text: x[2] ? 'on' : 'off' })]);
            }) };
        } else if (chk === 'large') {
          var maxS = Q.large.length ? Q.large[0][2] : 1;
          cur = { title: 'Flows over 25 elements', cols: ['', 'Flow', 'Steps', ''], grid: 'large',
            why: plural(Q.over, 'flow has', 'flows have') + ' more than 25 steps; ' + over50 + ' of them more than 50. Long flows are hard to read and to test. The list shows the ' + Q.large.length + ' longest. A step is what the drawing numbers: the start, each activity, decision and loop, and each end.',
            rule: GUIDE.large[0], src: GUIDE.large[1],
            chips: ['Where they are', Q.overMod.slice(0, 10)],
            foot: Q.over > Q.large.length ? '+ ' + (Q.over - Q.large.length) + ' more over 25 elements' : null,
            rows: Q.large.map(function (f) {
              var bar = h('span', { class: 'dx-q-bar' }, [h('span', { class: f[2] > 50 ? 'full' : '' })]); bar.firstChild.style.width = Math.round(f[2] / maxS * 100) + '%';
              return flowLink(f[0], f[1], [kindTag(QKIND[f[0]] || '··'), qn(f[1]), bar, h('span', { class: 'mono dx-q-num', text: String(f[2]) })]);
            }) };
        } else if (chk === 'names') {
          cur = { title: 'Prefixes outside the naming convention', cols: ['Prefix', 'Flows', 'Mendix convention', 'For example'], grid: 'names',
            why: plural(Q.prefN, 'flow starts', 'flows start') + ' with a prefix the Mendix convention does not define, or with a known one in different letter case. Most are harmless, but they hide what starts the flow.',
            rule: GUIDE.names[0], src: GUIDE.names[1],
            rows: Q.pref.map(function (p) { return flowLink(null, p[3][0], [h('span', { class: 'mono dx-q-pref', text: p[0] + '_' }), h('span', { class: 'mono', text: String(p[1]) }), h('span', { class: 'dx-q-muted ink', text: p[2] || '—' }), qn(p[3][0])]); }) };
        } else {
          var eaRows = Q.ea.filter(function (r) { return r[1]; }).sort(function (a, b) { return b[2] - a[2]; });
          var maxE = eaRows.length ? Math.max.apply(null, eaRows.map(function (r) { return r[1]; })) : 1;
          cur = { title: 'Microflows that apply entity access', cols: ['Module', 'Microflows', 'A role can start', 'Apply entity access'], grid: 'access',
            why: 'Only ' + Q.eaApplied + ' of ' + plural(Q.eaTotal, 'microflow applies', 'microflows apply') + ' entity access. ' + Q.eaRoleNo + ' of the ' + Q.eaRole + ' that a role may start do not, so they read and write past the access rules and must check the caller themselves. This is the Mendix default, not an error.',
            rule: GUIDE.access[0], src: GUIDE.access[1],
            rows: eaRows.map(function (r) {
              var bar = h('span', { class: 'dx-q-bar acc' }, [h('span')]); bar.firstChild.style.width = Math.max(2, Math.round(r[2] / maxE * 100)) + '%';
              return modLink(r[0], [h('span', { class: 'mono dx-q-pref', text: r[0] }), h('span', { class: 'mono dx-q-muted', text: String(r[1]) }), h('span', { class: 'dx-q-barcell' }, [bar, h('span', { class: 'mono', text: String(r[2]) })]), h('span', { class: 'mono dx-q-num' + (r[3] ? ' ok' : ''), text: r[3] ? String(r[3]) : '—' })]);
            }) };
        }
        var left = h('div', { class: 'dx-q-left' }, [
          h('h2', { text: cur.title }),
          h('p', { class: 'dx-q-why', text: cur.why }),
          cur.rule ? h('blockquote', { class: 'dx-q-rule' }, [h('span', { class: 'dx-cap acc', text: 'Mendix guideline' }), h('span', { class: 'dx-q-quote', text: cur.rule }), h('cite', { text: cur.src })]) : null,
          cur.chips && cur.chips[1].length ? h('div', { class: 'dx-q-chips' }, [h('span', { class: 'dx-cap', text: cur.chips[0] }), h('div', null, cur.chips[1].map(function (m) {
            return ln({ view: 'modules', module: m[0] }, { class: 'dx-q-chip' }, [h('span', { class: 'mono', text: m[0] }), h('span', { class: 'mono dx-q-muted', text: String(m[1]) })]);
          }))]) : null
        ]);
        var table = h('div', { class: 'dx-q-table g-' + cur.grid }, [h('div', { class: 'dx-q-head' }, cur.cols.map(function (c) { return h('span', { class: 'dx-cap', text: c }); }))]
          .concat(cur.rows.length ? cur.rows : [h('p', { class: 'dx-empty', text: 'None.' })])
          .concat(cur.foot ? [h('span', { class: 'dx-q-foot', text: cur.foot })] : []));
        main.appendChild(h('div', { class: 'dx-q' }, [cards, h('section', { class: 'dx-q-detail' }, [left, table])]));
      }

      // ---------- architecture (redesign spec 16) ----------
      // The C4 model adapted to Mendix, as one document: the context and the
      // runtime an agent drew, the modules and the roles read from the model,
      // and what the model does not show. A section exists when its data does,
      // so a model no agent described still has its modules and roles here.
      function drawArch() {
        var D = derived(), A = D && D.arch;
        var secs = [];
        if (c4 && c4.context && contextGroups(c4.context)) secs.push(['context', 'Context']);
        secs.push(['runtime', 'Runtime']);
        if (A && A.order.length > 1) secs.push(['modules', 'Modules']);
        if (A && A.roles.length) secs.push(['roles', 'Roles']);
        if (c4 && c4.open && c4.open.length) secs.push(['open', 'Open questions']);
        setTitle('Architecture', c4 ? 'The C4 model adapted to Mendix. An agent drew the context and the runtime from the model; module links and roles are read from the model.'
          : 'What the application runs, how its modules lean on one another, and who may reach them — read from the model.');
        tools(h('nav', { class: 'dx-seg2 dx-anchors', 'aria-label': 'On this page' }, secs.map(function (x, i) {
          return ln({ view: 'arch', sec: x[0] }, { class: 'dx-anchor' }, [h('span', { class: 'mono', text: String(i + 1) }), x[1]], function () { st.sec = x[0]; if (opts.hash) history.replaceState(null, '', hashOf(st)); toSection(x[0]); });
        })), function (n) { main.appendChild(h('div', { class: 'dx-page-tools' }, [n])); });
        var app = data.project;
        function section(id, title, sub, body) {
          var no = secs.map(function (x) { return x[0]; }).indexOf(id) + 1;
          return h('section', { class: 'dx-ar-sec', 'data-sec': id }, [h('div', { class: 'dx-ar-h' }, [h('span', { class: 'dx-ar-no mono', text: String(no) }), h('div', null, [h('h2', { text: title }), h('p', { text: sub })])])].concat(body));
        }
        var doc = h('div', { class: 'dx-ar' });

        // 1 · context: the overview's picture with the nodes' notes, and the partners as a table
        if (secs[0][0] === 'context') {
          var cx = contextGroups(c4.context), appNode = cx.app;
          var rows = [];
          c4.context.nodes.forEach(function (n) {
            if (n === appNode) return;
            var into = c4.context.links.filter(function (l) { return l.from === n.id && l.to === appNode.id; });
            var from = c4.context.links.filter(function (l) { return l.from === appNode.id && l.to === n.id; });
            var l = into.concat(from)[0];
            rows.push(h('div', { class: 'dx-ar-tr' }, [h('b', { text: n.name }), h('span', { class: 'dx-q-muted ink', text: n.group || '—' }),
              h('span', { class: 'mono dx-ar-dir' + (into.length && !from.length ? '' : ' out'), text: into.length && from.length ? '↔ ' + appNode.name : into.length ? '→ ' + appNode.name : from.length ? appNode.name + ' →' : '—' }),
              h('span', { class: 'dx-q-muted ink', text: [l && l.label, n.note].filter(Boolean).join(' · ') })]));
          });
          doc.appendChild(section('context', 'Context', 'Who uses ' + app + ' and which systems it exchanges data with: ' + plural(rows.length, 'partner', 'partners') + ' in ' + plural(cx.groups.length, 'group', 'groups') + '. The table under the picture says what each one exchanges.', [
            contextDiagram(cx, true),
            h('div', { class: 'dx-ar-table ctx' }, [h('div', { class: 'dx-ar-tr head' }, ['Partner', 'Group', 'Direction', 'What goes over'].map(function (x) { return h('span', { text: x }); }))].concat(rows))
          ]));
        }

        // 2 · runtime: the agent's containers laid out by kind, and what the model says runs
        var serv = (A ? A.serv : (data.services || []).map(function (x) { return [x.name, x.kind]; }));
        var sched = (A ? A.sched : (data.scheduled || []).map(function (x) { return [x.name, x.schedule, x.enabled]; })).slice()
          .sort(function (a, b) { return (b[2] ? 1 : 0) - (a[2] ? 1 : 0) || a[0].localeCompare(b[0]); });
        var on = sched.filter(function (x) { return x[2]; }).length;
        var KIND_SERV = function (k) { return k === 'web service' ? 'SOAP' : String(k || '').toUpperCase(); };
        doc.appendChild(section('runtime', 'Runtime', c4 && c4.containers ? 'What ' + app + ' runs as. In Mendix almost everything is one runtime, so its parts are roles: the client, published services, background work and outgoing connectors, and where the data lives.'
          : 'What ' + app + ' publishes and what it runs on a schedule, read from the model.', [
          c4 && c4.containers ? runtimeDiagram(c4.containers, app) : null,
          h('div', { class: 'dx-ar-two' }, [
            h('div', { 'data-sec': 'services' }, [h('h3', { class: 'dx-cap', text: 'Published services · ' + serv.length }), h('div', { class: 'dx-pd-rows' }, serv.length ? serv.map(function (x) {
              var i = x[0].indexOf('.');
              return h('div', { class: 'dx-ar-serv' }, [kindTag(KIND_SERV(x[1])), h('span', { class: 'mono dx-q-qn' }, [h('span', { class: 'dx-mod', text: x[0].slice(0, i + 1) }), x[0].slice(i + 1)]), h('small', { text: x[1] || '' })]);
            }) : [h('span', { class: 'dx-empty', text: 'None.' })])]),
            h('div', { 'data-sec': 'schedules' }, [h('h3', { class: 'dx-cap', text: 'Scheduled events · ' + sched.length + (sched.length ? ' · ' + on + ' switched on' : '') }), h('div', { class: 'dx-pd-rows' }, sched.length ? sched.map(function (x) {
              var i = x[0].indexOf('.');
              return h('div', { class: 'dx-ar-sched' + (x[2] ? '' : ' off') }, [h('span', { class: 'dx-q-state' + (x[2] ? ' on' : '') }), h('span', { class: 'mono dx-q-qn' }, [h('span', { class: 'dx-mod', text: x[0].slice(0, i + 1) }), x[0].slice(i + 1)]), h('small', { text: (x[1] || '') + (x[2] ? ' · on' : ' · off') })]);
            }) : [h('span', { class: 'dx-empty', text: 'None.' })]), sched.length ? h('p', { class: 'dx-md-hint', text: 'Switched off in the model. Which ones run in production is set per environment.' }) : null])
          ])
        ]));

        // 3 · modules: a dependency structure matrix
        if (A && A.order.length > 1) doc.appendChild(section('modules', 'Modules', 'A module uses another when one of its flows calls a flow there or one of its entities points to an entity there. Read across a row: the row module uses the column module. Modules used least are at the top, the core at the bottom.', [dsm(A)]));
        // 4 · roles and access
        if (A && A.roles.length) doc.appendChild(section('roles', 'Roles and access', plural(A.roles.length, 'user role', 'user roles') + '. A mark means the user role carries at least one module role in that module; the number says how many.', roleMatrix(A)));
        // 5 · what the model does not show
        if (c4 && c4.open && c4.open.length) doc.appendChild(section('open', 'What the model does not show', cap(numWord(c4.open.length)) + (c4.open.length === 1 ? ' thing' : ' things') + ' to confirm in the environment before relying on this picture. Written by an agent.', [
          h('ol', { class: 'dx-ar-open' }, c4.open.map(function (x, i) { return h('li', null, [h('span', { class: 'mono', text: pad2(i + 1) }), h('span', { text: x })]); }))]));
        main.appendChild(doc);
        if (st.sec) { var want = st.sec; requestFrame(function () { toSection(want); }); }
      }

      // The runtime laid out by kind (Karol, 2026-10-13): people, and systems that only call in, on the
      // left; the parts inside a dashed frame, two columns; stores and the systems the parts call on the
      // right. Lines are orthogonal, each with its label. Text is set as text.
      function runtimeDiagram(d, app) {
        var byId = Object.create(null);
        d.nodes.forEach(function (n) { byId[n.id] = n; });
        var parts = d.nodes.filter(function (n) { return n.kind === 'part'; });
        var isPart = function (id) { return byId[id] && byId[id].kind === 'part'; };
        var left = [], right = [];
        d.nodes.forEach(function (n) {
          if (n.kind === 'part') return;
          var toParts = d.links.some(function (l) { return l.from === n.id && isPart(l.to); });
          var fromParts = d.links.some(function (l) { return l.to === n.id && isPart(l.from); });
          if (n.kind === 'person' || (toParts && !fromParts && n.kind !== 'store')) left.push(n); else right.push(n);
        });
        // A part someone on the left reaches goes in the first column, the rest in the second.
        var c1 = parts.filter(function (p) { return d.links.some(function (l) { return l.to === p.id && left.some(function (x) { return x.id === l.from; }); }); });
        var c2 = parts.filter(function (p) { return c1.indexOf(p) === -1; });
        while (c1.length > c2.length + 1) c2.unshift(c1.pop());
        while (c2.length > c1.length + 1) c1.push(c2.shift());
        // A second-column part sits level with the first-column part that talks to it, so their line is straight.
        function rowOf(p) { var r = 99; d.links.forEach(function (l) { var o = l.from === p.id ? l.to : l.to === p.id ? l.from : null; var k = c1.map(function (x) { return x.id; }).indexOf(o); if (k !== -1) r = Math.min(r, k); }); return r; }
        c2.sort(function (a, b) { return rowOf(a) - rowOf(b); });
        var rowsN = Math.max(c1.length, c2.length, 1);
        var W = 180, Hn = 92, ROW = 212, Y0 = 50, pos = Object.create(null);
        c1.forEach(function (p, i) { pos[p.id] = { x: 270, y: Y0 + i * ROW, w: W }; });
        c2.forEach(function (p, i) { pos[p.id] = { x: 510, y: Y0 + i * ROW, w: W }; });
        // Outside nodes sit level with a part they talk to: the ones with fewest lines choose first, so a
        // node with one partner is never pushed off its row by one that has several.
        function place(list, x, w) {
          var used = {};
          function rowsOf(n) {
            return d.links.filter(function (k) { return (k.from === n.id && pos[k.to] && isPart(k.to)) || (k.to === n.id && pos[k.from] && isPart(k.from)); })
              .map(function (k) { return pos[k.from === n.id ? k.to : k.from].y; });
          }
          list.slice().sort(function (p1, p2) { return rowsOf(p1).length - rowsOf(p2).length || list.indexOf(p1) - list.indexOf(p2); }).forEach(function (n) {
            var y = rowsOf(n).filter(function (r) { return !used[r]; })[0];
            if (y === undefined) { y = Y0; while (used[y]) y += ROW; }
            used[y] = true;
            pos[n.id] = { x: x, y: y, w: w };
          });
        }
        place(left, 0, 190);
        place(right, 790, 200);
        var maxY = 0;
        Object.keys(pos).forEach(function (id) { maxY = Math.max(maxY, pos[id].y + Hn); });
        var BUS = maxY + 34, Wd = 990, Hd = BUS + 20;
        var stage = h('div', { class: 'dx-rt', role: 'img', 'aria-label': 'What ' + app + ' runs as' });
        stage.style.width = Wd + 'px'; stage.style.height = Hd + 'px';
        var svg = s('svg', { class: 'dx-rt-svg', width: Wd, height: Hd, 'aria-hidden': 'true' });
        if (parts.length) svg.appendChild(s('rect', { class: 'dx-rt-frame', x: 240, y: 10, width: 480, height: Y0 - 10 + rowsN * ROW - ROW + Hn + 22, rx: 18 }));
        stage.appendChild(svg);
        if (parts.length) { var fl = h('span', { class: 'dx-rt-frame-l', text: app + ' runtime · one Mendix app' }); fl.style.left = '256px'; fl.style.top = '18px'; stage.appendChild(fl); }
        function r1(v) { return Math.round(v * 10) / 10; }
        // A line is straight or has one bend in the gap between columns; one that would cross another box
        // runs along a bus under the frame instead, and lines to one place along the bus share one label.
        function hits(pts, a, b) {
          return Object.keys(pos).some(function (id) {
            var q = pos[id];
            if (q === a || q === b) return false;
            for (var i = 0; i < pts.length - 1; i++) {
              var x1 = Math.min(pts[i][0], pts[i + 1][0]), x2 = Math.max(pts[i][0], pts[i + 1][0]), y1 = Math.min(pts[i][1], pts[i + 1][1]), y2 = Math.max(pts[i][1], pts[i + 1][1]);
              if (x2 > q.x && x1 < q.x + q.w && y2 > q.y && y1 < q.y + Hn) return true;
            }
            return false;
          });
        }
        var busLabels = {}, busN = {};
        d.links.forEach(function (l) {
          var a = pos[l.from], b = pos[l.to];
          if (!a || !b) return;
          var ay = a.y + Hn / 2, by = b.y + Hn / 2, pts, lab = null;
          if (a.x === b.x) {
            var down = b.y > a.y;
            pts = [[a.x + a.w / 2, down ? a.y + Hn : a.y], [b.x + b.w / 2, down ? b.y : b.y + Hn]];
          } else {
            var ltr = b.x > a.x;
            var x1 = ltr ? a.x + a.w : a.x, x2 = ltr ? b.x : b.x + b.w, mx = (x1 + x2) / 2;
            pts = ay === by ? [[x1, ay], [x2, by]] : [[x1, ay], [mx, ay], [mx, by], [x2, by]];
          }
          if (hits(pts, a, b)) {
            var k = busN[l.to] = (busN[l.to] || 0) + 1, sx = a.x + a.w * (0.5 + 0.12 * (k - 1)), bx = b.x + b.w / 2;
            pts = [[sx, a.y + Hn], [sx, BUS], [bx, BUS], [bx, b.y + Hn]];
            // A box below in the same column: leave by the side and go down the gap next to it.
            if (hits([pts[0], pts[1]], a, b)) { var gx = a.x + a.w + 30; pts = [[a.x + a.w, ay], [gx, ay], [gx, BUS], [bx, BUS], [bx, b.y + Hn]]; }
            if (l.label && !busLabels[l.to + '|' + l.label]) { busLabels[l.to + '|' + l.label] = true; lab = [pts[pts.length - 3], pts[pts.length - 2]]; }
          } else if (l.label) lab = pts.length === 4 ? [pts[1], pts[2]] : [pts[0], pts[1]];
          var n = pts.length, z = pts[n - 1], q = pts[n - 2], dx = z[0] - q[0], dy = z[1] - q[1], L = Math.sqrt(dx * dx + dy * dy) || 1;
          dx /= L; dy /= L;
          var base = [z[0] - dx * 7, z[1] - dy * 7];
          var dd = 'M' + r1(pts[0][0]) + ' ' + r1(pts[0][1]);
          for (var i = 1; i < n - 1; i++) dd += ' L' + r1(pts[i][0]) + ' ' + r1(pts[i][1]);
          dd += ' L' + r1(base[0]) + ' ' + r1(base[1]);
          svg.appendChild(s('path', { class: 'dx-rt-edge', d: dd }));
          svg.appendChild(s('path', { class: 'dx-rt-arrow', d: 'M' + r1(z[0]) + ' ' + r1(z[1]) + ' L' + r1(base[0] - dy * 4.5) + ' ' + r1(base[1] + dx * 4.5) + ' L' + r1(base[0] + dy * 4.5) + ' ' + r1(base[1] - dx * 4.5) + ' Z' }));
          if (lab) {
            var le = h('span', { class: 'dx-rt-label', text: l.label });
            le.style.left = r1((lab[0][0] + lab[1][0]) / 2) + 'px'; le.style.top = r1((lab[0][1] + lab[1][1]) / 2) + 'px';
            stage.appendChild(le);
          }
        });
        d.nodes.forEach(function (n) {
          var p = pos[n.id];
          if (!p) return;
          var box = h('div', { class: 'dx-rt-node ' + n.kind, title: n.name + (n.note ? ' — ' + n.note : '') }, [
            h('span', { class: 'dx-rt-nh' }, [h('span', { class: 'dx-rt-ic' }, [navIcon({ person: 'person', store: 'entity', part: 'module' }[n.kind] || 'arch', 14)]), h('b', { text: n.name })]),
            n.note ? h('span', { class: 'dx-rt-note', text: n.note }) : null
          ]);
          box.style.left = p.x + 'px'; box.style.top = p.y + 'px'; box.style.width = p.w + 'px'; box.style.height = Hn + 'px';
          stage.appendChild(box);
        });
        return h('div', { class: 'dx-rt-scroll' }, [stage]);
      }

      // The dependency structure matrix (spec 16 §3.3): a row uses a column; both ways in red.
      function dsm(A) {
        var order = A.order, mat = A.mat;
        function val(a, b) { var v = mat[a] && mat[a][b]; return v ? v[0] + v[1] : 0; }
        var linkN = 0, mutualN = 0, usedByN = {};
        order.forEach(function (a) { order.forEach(function (b) { if (a !== b && val(a, b)) { linkN++; usedByN[b] = (usedByN[b] || 0) + 1; if (val(b, a) && a < b) mutualN++; } }); });
        var top = order.slice().sort(function (a, b) { return (usedByN[b] || 0) - (usedByN[a] || 0); })[0];
        var sel = order.indexOf(st.amod) !== -1 ? st.amod : (order.indexOf(st.module) !== -1 ? st.module : top);
        function pick(name) { return function () { st.amod = name; if (opts.hash) history.replaceState(null, '', hashOf(st)); var y = main.scrollTop; draw(); main.scrollTop = y; }; }
        var table = h('div', { class: 'dx-dsm', role: 'table', 'aria-label': 'Module dependency matrix' }, [
          h('div', { class: 'dx-dsm-r head', role: 'row' }, [h('span', { class: 'dx-dsm-corner' })].concat(order.map(function (b) { return h('span', { class: 'dx-dsm-ch mono' + (b === sel ? ' on' : ''), role: 'columnheader', text: b }); })))
        ].concat(order.map(function (a, i) {
          var rowOn = a === sel;
          return h('div', { class: 'dx-dsm-r', role: 'row' }, [h('button', { type: 'button', class: 'dx-dsm-rh mono' + (rowOn ? ' on' : ''), text: a, onclick: pick(a) })].concat(order.map(function (b, j) {
            var v = val(a, b), mu = v && val(b, a), m = mat[a] && mat[a][b];
            var cls = 'dx-dsm-c' + (i === j ? ' self' : v && mu ? (v >= 5 ? ' mu hi' : ' mu') : v ? (v >= 10 ? ' v4' : v >= 4 ? ' v3' : v >= 2 ? ' v2' : ' v1') : (rowOn || b === sel) ? ' cross' : '');
            return h('span', { class: cls, role: 'cell', title: v ? a + ' uses ' + b + ': ' + [m[0] ? plural(m[0], 'call', 'calls') : null, m[1] ? plural(m[1], 'association', 'associations') : null].filter(Boolean).join(', ') + (mu ? ' · both ways' : '') : null, text: i === j || !v ? '' : String(v) });
          })));
        })));
        function dRow(name, v, mutual) {
          var what = [];
          if (v[0]) what.push(plural(v[0], 'call', 'calls'));
          if (v[1]) what.push(v[1] + ' assoc.');
          return h('button', { type: 'button', class: 'dx-ln-row', onclick: pick(name) }, [h('b', { class: 'mono', text: name }), mutual ? h('span', { class: 'dx-both', text: 'both ways' }) : null, h('small', { text: what.join(' · ') })]);
        }
        var usesL = Object.keys(mat[sel] || {}).filter(function (b) { return b !== sel; }).sort(function (a, b) { return val(sel, b) - val(sel, a) || a.localeCompare(b); });
        var byL = order.filter(function (a) { return a !== sel && val(a, sel); }).sort(function (a, b) { return val(b, sel) - val(a, sel) || a.localeCompare(b); });
        return h('div', null, [
          h('div', { class: 'dx-ar-facts' }, [[linkN, 'links between ' + order.length + ' modules', ''], [mutualN, mutualN === 1 ? 'pair of modules use each other' : 'pairs of modules use each other', 'p1'], [usedByN[top] || 0, plural(usedByN[top] || 0, 'module uses', 'modules use').replace(/^\d+ /, '') + ' ' + top, '']].map(function (f) {
            return h('div', { class: 'dx-ar-fact' }, [h('span', { class: 'mono ' + f[2], text: String(f[0]) }), h('span', { text: f[1] })]);
          })),
          h('div', { class: 'dx-ar-grid' }, [
            h('div', { class: 'dx-ar-mx' }, [h('div', { class: 'dx-ar-mx-scroll', 'data-keep-scroll': 'ar-modules' }, [table]), h('div', { class: 'dx-ar-legend' }, [
              h('span', null, [h('i', { class: 'lg-a' }), 'uses, the darker the more']), h('span', null, [h('i', { class: 'lg-m' }), 'both use each other']), h('span', null, [h('i', { class: 'lg-s' }), 'selected module'])])]),
            h('aside', { class: 'dx-ar-side' }, [
              h('div', { class: 'dx-ar-sel' }, [h('small', { text: 'Selected module' }), h('b', { class: 'mono', text: sel })]),
              h('div', null, [h('h3', { class: 'dx-cap', text: 'Uses · ' + usesL.length }), h('div', { class: 'dx-pd-rows' }, usesL.length ? usesL.map(function (b) { return dRow(b, mat[sel][b], !!val(b, sel)); }) : [h('span', { class: 'dx-empty', text: 'None.' })])]),
              h('div', null, [h('h3', { class: 'dx-cap', text: 'Used by · ' + byL.length }), h('div', { class: 'dx-pd-rows' }, byL.length ? byL.map(function (a) { return dRow(a, mat[a][sel], !!val(sel, a)); }) : [h('span', { class: 'dx-empty', text: 'None.' })])]),
              data.modules.some(function (x) { return x.name === sel; }) ? ln({ view: 'modules', module: sel }, { class: 'dx-more-link' }, ['Open the module page', navIcon('arrow', 13)]) : null
            ])
          ])
        ]);
      }

      // User roles against modules (spec 16 §3.4), read from the model.
      function roleMatrix(A) {
        var mods = A.mods, roles = A.roles;
        var anon = roles.filter(function (r) { return /^anonymous$/i.test(r.n); })[0];
        var admin = roles.filter(function (r) { return /^administrator$/i.test(r.n); })[0];
        var sel = roles.filter(function (r) { return r.n === st.arole; })[0] || anon || roles[0];
        function pick(name) { return function () { st.arole = name; if (opts.hash) history.replaceState(null, '', hashOf(st)); var y = main.scrollTop; draw(); main.scrollTop = y; }; }
        var note = [];
        if (anon) { var am = Object.keys(anon.own); note.push(am.length ? 'Anonymous users, who are not signed in, carry module roles in ' + plural(am.length, 'module', 'modules') + ': ' + (am.length > 1 ? am.slice(0, -1).join(', ') + ' and ' + am[am.length - 1] : am[0]) + '.' : 'Anonymous users, who are not signed in, carry no module role in these modules.'); }
        if (admin) note.push(admin.n + ' reaches ' + Object.keys(admin.own).length + ' of ' + mods.length + '.');
        var table = h('div', { class: 'dx-dsm roles', role: 'table', 'aria-label': 'User roles by module' }, [
          h('div', { class: 'dx-dsm-r head', role: 'row' }, [h('span', { class: 'dx-dsm-corner' })].concat(mods.map(function (m) { return h('span', { class: 'dx-dsm-ch mono', role: 'columnheader', text: m }); }), [h('span', { class: 'dx-dsm-tot', text: 'modules' })]))
        ].concat(roles.map(function (r) {
          var on = r === sel;
          return h('div', { class: 'dx-dsm-r', role: 'row' }, [h('button', { type: 'button', class: 'dx-dsm-rh' + (on ? ' on' : ''), text: r.n, onclick: pick(r.n) })].concat(mods.map(function (m) {
            var rs = r.own[m], n = rs ? rs.length : 0;
            return h('span', { class: 'dx-dsm-c' + (n ? (on ? ' v4' : ' v3') : on ? ' cross' : ''), role: 'cell', title: rs ? r.n + ' in ' + m + ': ' + rs.join(', ') : null, text: n > 1 ? String(n) : '' });
          }), [h('span', { class: 'dx-dsm-tot mono' + (on ? ' on' : ''), text: String(Object.keys(r.own).length) })]));
        })));
        var rk = Object.keys(sel.own).sort(function (a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); });
        var total = rk.reduce(function (n, m) { return n + sel.own[m].length; }, 0) + sel.other.length;
        return [
          note.length ? h('p', { class: 'dx-ar-note' }, [navIcon('info', 14), h('span', null, [h('b', { text: 'Read from the model. ' }), note.join(' ')])]) : null,
          h('div', { class: 'dx-ar-grid' }, [
            h('div', { class: 'dx-ar-mx' }, [h('div', { class: 'dx-ar-mx-scroll', 'data-keep-scroll': 'ar-roles' }, [table])]),
            h('aside', { class: 'dx-ar-side' }, [
              h('div', { class: 'dx-ar-sel' }, [h('small', { text: 'Selected user role' }), h('b', { text: sel.n }), h('span', { text: rk.length + ' of ' + plural(mods.length, 'module', 'modules') + ' · ' + plural(total, 'module role', 'module roles') })]),
              h('div', { class: 'dx-pd-rows' }, rk.length ? rk.map(function (m) { return h('div', { class: 'dx-ar-rrow' }, [h('b', { class: 'mono', text: m }), h('span', { text: sel.own[m].join(', ') })]); }) : [h('span', { class: 'dx-empty', text: 'No module role in these modules.' })]),
              sel.other.length ? h('p', { class: 'dx-md-hint' }, [h('b', { text: 'Also in modules outside this documentation: ' }), h('span', { class: 'mono', text: sel.other.join(', ') })]) : null
            ])
          ])
        ];
      }

      function levelCount(l) { return risks.filter(function (r) { return r.level === l; }).length; }

      // ---------- risks (redesign spec 17) ----------
      // The profile first — how bad, which patterns, where they gather — as
      // facets with counts that filter the list, then one finding at a time:
      // what happens, what to do, where, and the same pattern elsewhere. A
      // facet's counts leave out its own filter (SonarQube's rule), so they
      // say how many a click on another value would bring.
      function riskData() {
        if (riskRows) return riskRows;
        var D = derived();
        riskRows = allRisks.map(function (r, i) {
          var where = (r.where || []).map(function (w) {
            var m = /^([^|]+?)(?:\|(mf|nf|pg|en|dm))?$/.exec(String(w).trim()) || [null, String(w), null];
            var qn = m[1], kind = m[2];
            // A bare name: whatever the model has by that name, a flow before a page before an entity.
            if (!kind) { var k = flowKey(qn); kind = k ? { microflow: 'mf', nanoflow: 'nf', page: 'pg' }[data.flows[k].kind] : data.entities[qn] ? 'en' : null; }
            return { qn: qn, kind: kind };
          });
          var th = r.theme || (D && D.risks && D.risks[i] && D.risks[i][1]) || 'logic';
          // A risk past the counted ones takes its pattern from the file's own list of them (reportdata.js).
          if (!r.theme && i >= risks.length && D && D.triaged && D.triaged[i - risks.length]) th = D.triaged[i - risks.length];
          return { i: i, r: r, lv: r.level, th: PAT[th] ? th : 'logic', mod: where.length ? where[0].qn.split('.')[0] : 'Other', where: where,
            s: RS[r.status] ? r.status : 'open', or: r.origin === 'person' ? 'person' : 'ai',
            text: [r.title, r.detail, r.fix, r.note, r.by].concat(r.where || []).join(' ').toLowerCase() };
        });
        return riskRows;
      }
      // What was decided about a risk, who raised it, where it stands: docs-triage.js.
      var triKit = { h: h, fmtDate: fmtDate, aiMark: aiMark };
      function triageBlock(x) { return TRI.block(triKit, x); }
      function derived() {
        if (data.derived) return data.derived;
        return window.MxReportData ? (data.derived = window.MxReportData.derive(data)) : null;
      }
      function riskIndexOf(id) { for (var i = 0; i < allRisks.length; i++) if (riskId(i) === id) return i; return -1; }

      function originMark(r) { return TRI.originMark(triKit, r); }
      function statusMark(st0) { return TRI.statusMark(h, st0); }

      function drawRisks() {
        var everything = riskData();
        function inStatus(x) { var g = rf.st || 'open'; return g === 'all' || RS_GROUP[x.s] === g; }
        function inOrigin(x) { return !rf.or || x.or === rf.or; }
        var all = everything.filter(function (x) { return inStatus(x) && inOrigin(x); });
        var mods = {};
        all.forEach(function (x) { mods[x.mod] = true; });
        var people = everything.some(function (x) { return x.or === 'person'; }), agents = everything.some(function (x) { return x.or === 'ai'; });
        var nOpen = everything.filter(function (x) { return RS_GROUP[x.s] === 'open'; }).length;
        setTitle('Risks', (rf.st && rf.st !== 'open' ? plural(all.length, 'finding', 'findings') + ' under ' + RS_FILTERS.filter(function (f) { return f[0] === rf.st; })[0][1] + ', ' + plural(nOpen, 'open risk', 'open risks') + ' in all'
          : plural(all.length, 'finding', 'findings') + ' in ' + plural(Object.keys(mods).length, 'module', 'modules')) +
          (people && agents ? '. An agent read most of them from the model, people raised the rest; check each one before you act on it.' : people ? '. People raised them while reading the model.' : '. An agent read them from the model, so check each one before you act on it.'));
        var q = String(rf.q || '').trim().toLowerCase();
        function match(x, skip) {
          if (skip !== 'lv' && rf.lv && x.lv !== rf.lv) return false;
          if (skip !== 'th' && rf.th && x.th !== rf.th) return false;
          if (skip !== 'mod' && rf.mod && x.mod !== rf.mod) return false;
          return !q || x.text.indexOf(q) !== -1;
        }
        function setF(patch) { Object.keys(patch).forEach(function (k) { rf[k] = patch[k]; }); rkY = 0; go({ view: 'risks', sub: st.sub}); }

        // the header: Copy link. The page's own text filter is gone (Karol, 2026-10-14: a second
        // search box beside the screen's own read badly); the search in the header finds a risk.
        tools([opts.hash ? copyLink() : null], null);

        // ---- the facets ----
        function sevFacet(wide) {
          var counts = ['P1', 'P2', 'P3'].map(function (l) { return all.filter(function (x) { return x.lv === l && match(x, 'lv'); }).length; });
          return h('section', { class: 'dx-fc', 'aria-label': 'Severity' }, [
            facetHead('Severity', rf.lv, function () { setF({ lv: null }); }),
            h('div', { class: 'dx-sevbar', 'aria-hidden': 'true' }, ['P1', 'P2', 'P3'].map(function (l, k) {
              var s = h('span', { class: 'b-' + l.toLowerCase() + (rf.lv && rf.lv !== l ? ' dim' : '') }); s.style.flexGrow = String(counts[k]); s.style.minWidth = counts[k] ? '4px' : '0'; return s;
            })),
            h('div', { class: 'dx-fc-rows' }, ['P1', 'P2', 'P3'].map(function (l, k) {
              var on = rf.lv === l;
              return h('button', { type: 'button', class: 'dx-fc-sev' + (wide ? ' wide' : '') + (on ? ' on ' + l.toLowerCase() : '') + (rf.lv && !on ? ' dim' : ''), 'aria-pressed': on ? 'true' : 'false', onclick: function () { setF({ lv: on ? null : l }); } },
                wide ? [h('span', { class: 'dx-lv ' + l.toLowerCase(), text: l }), h('span', { class: 'dx-fc-t' }, [h('b', { text: LV[l][0] }), h('small', { text: LV[l][1] })]), h('span', { class: 'dx-fc-n', text: String(counts[k]) })]
                  : [h('span', { class: 'dx-lv ' + l.toLowerCase(), text: l }), h('b', { text: LV[l][0] }), h('small', { text: LV[l][1] }), h('span', { class: 'dx-fc-n', text: String(counts[k]) })]);
            }))
          ]);
        }
        // The conclusion: one pattern holding most of the P1 findings, said in a sentence; otherwise nothing (Karol, 2026-10-13).
        var p1 = all.filter(function (x) { return x.lv === 'P1'; }), top = null;
        PAT_ORDER.forEach(function (k) { var n = p1.filter(function (x) { return x.th === k; }).length; if (n * 2 > p1.length && (!top || n > top[1])) top = [k, n]; });
        var insight = top ? (top[1] === p1.length && p1.length > 1 ? 'All ' + p1.length : top[1] + ' of the ' + p1.length) + ' P1 findings ' + (top[1] === 1 && p1.length === 1 ? 'is' : 'are') + ' ' + PAT[top[0]].charAt(0).toLowerCase() + PAT[top[0]].slice(1) + '.' : null;
        if (top && top[1] === 1 && p1.length === 1) insight = 'The one P1 finding is ' + PAT[top[0]].charAt(0).toLowerCase() + PAT[top[0]].slice(1) + '.';
        function patFacet(wide) {
          var pats = PAT_ORDER.map(function (k) {
            var n = all.filter(function (x) { return x.th === k && match(x, 'th'); }).length;
            var pp = all.filter(function (x) { return x.th === k && x.lv === 'P1' && match(x, 'th'); }).length;
            return { k: k, n: n, p1: pp };
          });
          var max = Math.max.apply(null, pats.map(function (p) { return p.n; }).concat([1]));
          return h('section', { class: 'dx-fc', 'aria-label': 'Patterns' }, [
            facetHead('Patterns', rf.th, function () { setF({ th: null }); }),
            insight ? h('p', { class: 'dx-insight' }, [h('b', { text: insight }), ' ' + PAT_NOTE[top[0]]]) : null,
            h('div', { class: wide ? 'dx-fc-rows' : 'dx-pats' }, pats.map(function (p) {
              var on = rf.th === p.k;
              var cls = (wide ? 'dx-fc-pat' : 'dx-pat') + (on ? ' on' : '') + ((rf.th && !on) || !p.n ? ' dim' : '');
              if (!wide) return h('button', { type: 'button', class: cls, 'aria-pressed': on ? 'true' : 'false', onclick: function () { setF({ th: on ? null : p.k }); } },
                [p.p1 ? h('span', { class: 'dx-p1dot', 'aria-label': 'has P1' }) : null, PAT[p.k], h('span', { class: 'dx-fc-n', text: String(p.n) })]);
              var bar = h('span', { class: 'dx-fc-bar' }, [h('span')]); bar.firstChild.style.width = Math.round(p.n / max * 100) + '%';
              return h('button', { type: 'button', class: cls, 'aria-pressed': on ? 'true' : 'false', onclick: function () { setF({ th: on ? null : p.k }); } },
                [h('span', { class: 'dx-fc-t row' }, [h('span', { text: PAT[p.k] }), p.p1 ? h('span', { class: 'dx-fc-p1', text: p.p1 + ' P1' }) : null]), h('span', { class: 'dx-fc-n', text: String(p.n) }), bar]);
            }))
          ]);
        }
        function modFacet(wide) {
          var by = {};
          all.forEach(function (x) { if (!match(x, 'mod')) return; var m = by[x.mod] || (by[x.mod] = { name: x.mod, n: 0, P1: 0, P2: 0, P3: 0 }); m.n++; m[x.lv]++; });
          if (rf.mod && !by[rf.mod]) by[rf.mod] = { name: rf.mod, n: 0, P1: 0, P2: 0, P3: 0 };
          var list2 = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.n - a.n || b.P1 - a.P1 || a.name.localeCompare(b.name); });
          var max = list2.length ? Math.max(1, list2[0].n) : 1;
          // Every module, in one order that a pick does not change (Karol, 2026-10-14: the picked
          // one jumped to the top); the strip scrolls when there are many.
          var shown = list2, rest = [];
          return h('section', { class: 'dx-fc', 'aria-label': 'Modules' }, [
            facetHead(wide ? 'Modules' : 'Where they gather', rf.mod, function () { setF({ mod: null }); }),
            h('div', { class: 'dx-fc-rows tight' + (wide ? '' : ' dx-fc-scroll') }, shown.map(function (m) {
              var on = rf.mod === m.name;
              var bars = h('span', { class: 'dx-modbar', 'aria-hidden': 'true' }, ['P1', 'P2', 'P3'].map(function (l) { var s = h('span', { class: 'b-' + l.toLowerCase() }); s.style.width = (m[l] / max * 100).toFixed(1) + '%'; return s; }));
              return h('button', { type: 'button', class: 'dx-fc-mod' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', onclick: function () { setF({ mod: on ? null : m.name }); } },
                [h('span', { class: 'mono', text: m.name }), bars, h('span', { class: 'dx-fc-n', text: String(m.n) })]);
            })),
            !wide && rest.length ? h('span', { class: 'dx-fc-rest', text: '+ ' + plural(rest.length, 'more module', 'more modules') + ', ' + plural(rest.reduce(function (s2, m) { return s2 + m.n; }, 0), 'finding', 'findings') }) : null
          ]);
        }
        function facetHead(label, active, clearFn) {
          return h('div', { class: 'dx-fc-h' }, [h('span', { class: 'dx-cap', text: label }), active ? h('button', { type: 'button', class: 'dx-fc-clear', text: 'Show all', onclick: clearFn }) : null]);
        }

        // ---- the list ----
        var shown = all.filter(function (x) { return match(x, null); });
        var byMod = rf.group === 'mod';
        shown.sort(byMod ? function (a, b) { return a.mod.localeCompare(b.mod) || LVO[a.lv] - LVO[b.lv] || a.i - b.i; }
          : function (a, b) { return LVO[a.lv] - LVO[b.lv] || a.mod.localeCompare(b.mod) || a.i - b.i; });
        // The finding the address names; one the filters hide gives way to the first that is left.
        var want = riskIndexOf(st.sub), cur = shown.filter(function (x) { return x.i === want; })[0] || shown[0] || null;
        var anyF = !!(rf.lv || rf.th || rf.mod || q);
        var chips = [];
        if (rf.lv) chips.push([rf.lv + ' · ' + LV[rf.lv][0], { lv: null }]);
        if (rf.th) chips.push([PAT[rf.th], { th: null }]);
        if (rf.mod) chips.push([rf.mod, { mod: null }]);
        if (q) chips.push(['“' + rf.q.trim() + '”', { q: '' }]);
        var groupN = {};
        shown.forEach(function (x) { var g = byMod ? x.mod : x.lv; groupN[g] = (groupN[g] || 0) + 1; });
        var rows = [], lastG = null;
        shown.forEach(function (x) {
          var g = byMod ? x.mod : x.lv;
          if (g !== lastG) {
            lastG = g;
            rows.push(h('div', { class: 'dx-rk-g' + (byMod ? ' mono' : '') }, byMod ? [h('b', { text: g }), h('span', { class: 'dx-fc-n', text: String(groupN[g]) })]
              : [h('span', { class: 'dx-lv ' + g.toLowerCase(), text: g }), h('b', { text: LV[g][0] }), h('small', { text: LV[g][1] }), h('span', { class: 'dx-fc-n', text: String(groupN[g]) })]));
          }
          var on = cur && x.i === cur.i;
          rows.push(ln({ view: 'risks', sub: riskId(x.i) }, { class: 'dx-rk-row' + (on ? ' on' : ''), 'aria-current': on ? 'true' : 'false' }, [
            h('span', { class: 'dx-lv ' + x.lv.toLowerCase(), text: x.lv }),
            h('span', { class: 'dx-rk-t' }, [h('b', { text: x.r.title }), h('small', { text: x.mod + ' · ' + PAT[x.th] + ' · ' + plural(x.where.length, 'place', 'places') + (x.or === 'person' ? ' · raised by ' + (x.r.by || 'a person') : '') }),
              statusMark(x.s)])
          ], function () { go({ view: 'risks', sub: riskId(x.i)}); }));
        });
        // The status filter (risk triage) and whose a risk is: docs-triage.js.
        var statusBar = TRI.statusBar({ h: h, everything: everything, inOrigin: inOrigin, rf: rf, setF: setF, shown: triaged.length || people, people: people, agents: agents });
        var listCol = h('section', { class: 'dx-rk-list', 'aria-label': 'Findings', 'data-keep-scroll': 'rk-list' }, [
          statusBar,
          h('div', { class: 'dx-rk-lh' }, [
            h('div', { class: 'dx-rk-lh-row' }, [h('b', { text: anyF ? shown.length + ' of ' + plural(all.length, 'finding', 'findings') : plural(all.length, 'finding', 'findings') }),
              h('div', { class: 'dx-seg2', role: 'group', 'aria-label': 'Group by' }, [h('span', { text: 'Group' })].concat([['sev', 'Severity'], ['mod', 'Module']].map(function (g) {
                var on = (rf.group || 'sev') === g[0];
                return h('button', { type: 'button', class: on ? 'on' : '', 'aria-pressed': on ? 'true' : 'false', text: g[1], onclick: function () { setF({ group: g[0] }); } });
              })))]),
            chips.length ? h('div', { class: 'dx-rk-chips' }, chips.map(function (c) {
              return h('button', { type: 'button', class: 'dx-rk-chip', 'aria-label': 'Remove filter ' + c[0], onclick: function () { setF(c[1]); } }, [c[0], h('span', { 'aria-hidden': 'true', text: '×' })]);
            })) : null
          ]),
          shown.length ? null : h('div', { class: 'dx-empty pad', text: (rf.st || 'open') === 'open' && !anyF && !rf.or ? 'No open risks — every one is marked fixed, a false positive or no longer reported. See the other filters above.' : 'No finding matches these filters.' })
        ].concat(rows));

        // ---- the finding ----
        var detail = h('article', { class: 'dx-rk-detail', 'aria-label': 'Finding', 'data-keep-scroll': 'rk-detail:' + (cur ? riskId(cur.i) : '') });
        if (cur) {
          var idx = shown.indexOf(cur), gKey = byMod ? cur.mod : cur.lv;
          var inG = shown.filter(function (x) { return (byMod ? x.mod : x.lv) === gKey; });
          function sib(x) {
            return ln({ view: 'risks', sub: riskId(x.i) }, { class: 'dx-rk-sib' }, [h('span', { class: 'dx-lv ' + x.lv.toLowerCase(), text: x.lv }), h('span', { text: x.r.title }), h('span', { class: 'mono', text: x.mod })],
              function () { go({ view: 'risks', sub: riskId(x.i)}); });
          }
          var byLv = function (a, b) { return LVO[a.lv] - LVO[b.lv] || a.i - b.i; };
          var sameP = all.filter(function (x) { return x.th === cur.th && x.i !== cur.i; }).sort(byLv);
          var sameM = all.filter(function (x) { return x.mod === cur.mod && x.i !== cur.i; }).sort(byLv);
          var patMods = {}; sameP.forEach(function (x) { patMods[x.mod] = true; });
          var nav2 = function (d, label, icon) {
            var t2 = shown[idx + d];
            return h('button', { type: 'button', class: 'dx-rk-nav', 'aria-label': label, disabled: !t2, onclick: function () { if (t2) go({ view: 'risks', sub: riskId(t2.i)}); } }, [navIcon(icon, 14)]);
          };
          var main2 = h('div', { class: 'dx-rk-main' }, [
            h('div', { class: 'dx-rk-top' }, [h('div', { class: 'dx-rk-navs' }, [nav2(-1, 'Previous finding', 'up'), nav2(1, 'Next finding', 'down'), h('span', { text: gKey + ' · ' + (inG.indexOf(cur) + 1) + ' of ' + inG.length })]),
              h('span', { class: 'mono dx-rk-id', text: riskId(cur.i) })]),
            h('div', { class: 'dx-rk-head' }, [
              h('div', { class: 'dx-rk-pills' }, [
                h('span', { class: 'dx-rk-sev ' + cur.lv.toLowerCase() }, [h('b', { class: 'mono', text: cur.lv }), LV[cur.lv][0]]),
                h('button', { type: 'button', class: 'dx-rk-pill', text: PAT[cur.th], title: 'Show only ' + PAT[cur.th].toLowerCase(), onclick: function () { setF({ th: cur.th }); } }),
                h('button', { type: 'button', class: 'dx-rk-pill mono', text: cur.mod, title: 'Show only ' + cur.mod, onclick: function () { setF({ mod: cur.mod }); } }),
                // Whose it is, when some are a person's: every risk is an agent's otherwise, as the foot says.
                people ? h('span', { class: 'dx-rk-pill dx-rk-origin' }, [originMark(cur.r)]) : null,
                statusMark(cur.s)
              ]),
              h('h2', { text: cur.r.title }),
              h('span', { class: 'dx-rk-when', text: RS_GROUP[cur.s] === 'open' ? 'Fix ' + LV[cur.lv][1].charAt(0).toLowerCase() + LV[cur.lv][1].slice(1) + '.' : 'Not counted as a risk: ' + RS[cur.s].toLowerCase() + '.' }),
              opts.riskActions ? h('div', { class: 'dx-rk-acts' }, opts.riskActions(cur.r)) : null
            ]),
            triageBlock(cur),
            assist && window.MxDocsTickets ? window.MxDocsTickets.forRisk({ h: h, ln: ln }, assist.items(), [cur.r.id, cur.r.pid]) : null,
            cur.r.detail ? h('section', { class: 'dx-rk-sec' }, [h('h3', { class: 'dx-cap', text: 'What happens' }), h('p', { class: 'dx-rk-p', text: cur.r.detail })]) : null,
            cur.r.fix ? h('section', { class: 'dx-rk-fix' }, [h('h3', { class: 'dx-cap acc' }, [navIcon('quality', 14), 'What to do']), h('p', { class: 'dx-rk-p', text: cur.r.fix })]) : null,
            h('section', { class: 'dx-rk-sec' }, [h('h3', { class: 'dx-cap', text: 'Where · ' + plural(cur.where.length, 'place', 'places') }),
              h('div', { class: 'dx-pd-rows' }, cur.where.map(function (w) {
                var K = WHERE_KIND[w.kind] || ['··', null, null], dot = w.qn.indexOf('.');
                var key = K[2] ? flowKey(w.qn, { microflow: 'mf', nanoflow: 'nf', page: 'pg' }[K[2]]) : null;
                var ent = !K[2] && w.kind && data.entities[w.qn];
                var kids = [kindTag(K[0]), h('span', { class: 'dx-pd-qn mono' }, [h('span', { class: 'dx-mod', text: w.qn.slice(0, dot + 1) }), w.qn.slice(dot + 1)]),
                  key || ent ? h('span', { class: 'dx-rk-open' }, [K[1], navIcon('arrow', 12)]) : null];
                if (key) return ln({ view: 'refs', module: data.flows[key].module, seg: data.flows[key].kind, key: key }, { class: 'dx-rk-where' }, kids);
                if (ent) return ln({ view: 'domain', entity: w.qn }, { class: 'dx-rk-where' }, kids);
                return h('div', { class: 'dx-rk-where' }, kids);
              }))]),
            h('p', { class: 'dx-rk-foot' }, [navIcon('info', 14), cur.or === 'person'
              ? 'Raised by ' + (cur.r.by || 'a person') + (cur.r.raisedAt ? ' on ' + fmtDate(cur.r.raisedAt) : '') + ', in a comment written while reading the model. A person’s finding, not an agent’s.'
              : 'An agent read the model and wrote this finding. It sees only the model, not the data or the configuration in production.'])
          ]);
          var lvC = { P1: 0, P2: 0, P3: 0 };
          all.forEach(function (x) { if (x.mod === cur.mod) lvC[x.lv]++; });
          // Beside the finding when the window is wide, under it otherwise (docs.css).
          var rail = h('aside', { class: 'dx-rk-rail' }, [
            sameP.length ? h('section', { class: 'dx-rk-sec' }, [h('h3', { class: 'dx-cap', text: 'Same pattern elsewhere' }),
              h('p', { class: 'dx-rk-note', text: plural(sameP.length, 'more finding', 'more findings') + ' in ' + plural(Object.keys(patMods).length, 'module', 'modules') + ' share this pattern.' }),
              h('div', { class: 'dx-pd-rows' }, sameP.slice(0, 6).map(sib)),
              h('button', { type: 'button', class: 'dx-more-link', text: 'All ' + (sameP.length + 1) + ' with this pattern', onclick: function () { setF({ th: cur.th }); } })]) : null,
            sameM.length ? h('section', { class: 'dx-rk-sec' }, [h('h3', { class: 'dx-cap', text: 'Also in ' + cur.mod }),
              h('div', { class: 'dx-rk-lvs' }, ['P1', 'P2', 'P3'].filter(function (l) { return lvC[l]; }).map(function (l) { return h('span', { class: 'dx-lv wide ' + l.toLowerCase(), text: lvC[l] + ' ' + l }); })),
              h('div', { class: 'dx-pd-rows' }, sameM.slice(0, 5).map(sib)),
              h('button', { type: 'button', class: 'dx-more-link', text: 'All ' + (sameM.length + 1) + ' in ' + cur.mod, onclick: function () { setF({ mod: cur.mod }); } })]) : null
          ]);
          add(detail, h('div', { class: 'dx-rk-wrap' }, [main2, rail]));
        }
        main.appendChild(h('div', { class: 'dx-rk' }, [
          h('div', { class: 'dx-rk-strip' }, [modFacet(false), sevFacet(false), patFacet(false)]),
          h('div', { class: 'dx-rk-body' }, [h('aside', { class: 'dx-rk-facets', 'aria-label': 'Filters', 'data-keep-scroll': 'rk-facets' }, [sevFacet(true), patFacet(true), modFacet(true)]), listCol, detail])
        ]));
        // The list where it was; the chosen row in view only if it is not, scrolling the list alone.
        listCol.addEventListener('scroll', function () { rkY = listCol.scrollTop; });
        // Laid out first: a scroll set on a box not yet measured is clamped to nothing.
        var onRow = listCol.querySelector('.dx-rk-row.on');
        function placeList() { if (!listCol.isConnected) return; void listCol.offsetHeight; listCol.scrollTop = rkY; keepInView(listCol, onRow, true); rkY = listCol.scrollTop; }
        placeList();
        requestFrame(placeList);
      }

      // ---------- for developers (redesign spec 19) ----------
      // Three kinds of text, each in its own tab and form: where things are
      // (questions a newcomer asks), the naming (a reference table), and what
      // breaks easily. A filter over the text, and the modules each item
      // names as a facet; both narrow the list and the facet's counts.
      var DEV_ALL = 'Across the app';
      function drawDev() {
        var D = derived(), X = D && D.dev;
        setTitle('For developers', 'What to know before you change this model. An agent read the model and wrote it; names in code font are real elements.');
        if (!X) { main.appendChild(h('div', { class: 'dx-note', text: 'This copy of the reader has no notes for developers.' })); return; }
        var tab = st.sub === 'conv' || st.sub === 'pit' ? st.sub : 'where';
        var q = String(st.dq || '').trim().toLowerCase();
        var search = h('input', { type: 'text', class: 'dx-rk-q', placeholder: 'Filter, e.g. a word, ACT_, a module', value: st.dq || '', 'aria-label': 'Filter' });
        search.addEventListener('input', function () {
          st.dq = search.value; var at = search.selectionStart;
          if (opts.hash) history.replaceState(null, '', hashOf(st));
          draw();
          var again = root.querySelector('.dx-rk-q[aria-label="Filter"]'); if (again) { again.focus(); try { again.setSelectionRange(at, at); } catch (e) { /* fine */ } }
        });
        tools(h('label', { class: 'dx-rk-search wide' }, [navIcon('search', 15), search]), function (n) { main.appendChild(h('div', { class: 'dx-page-tools' }, [n])); });
        var items;
        if (tab === 'where') items = X.where.map(function (w) { return { text: (w[0] + ' ' + w[1]).toLowerCase(), mods: w[2], q: w[0], a: w[1] }; });
        else if (tab === 'conv') items = X.conv.map(function (c) { return { text: (c[0] + ' ' + c[1]).toLowerCase(), mods: c[3], p: c[0], m: c[1], n: c[2] }; });
        else items = X.pit.map(function (p, i) { return { text: p[0].toLowerCase(), mods: p[1], a: p[0], no: pad2(i + 1) }; });
        function matchQ(it) { return !q || it.text.indexOf(q) !== -1; }
        var counts = {};
        items.forEach(function (it) { if (!matchQ(it)) return; (it.mods.length ? it.mods : [DEV_ALL]).forEach(function (m) { counts[m] = (counts[m] || 0) + 1; }); });
        var mod = st.dmod || null;
        var shown = items.filter(function (it) { return matchQ(it) && (!mod || (mod === DEV_ALL ? !it.mods.length : it.mods.indexOf(mod) !== -1)); });
        function setD(patch) { Object.keys(patch).forEach(function (k) { st[k] = patch[k]; }); if (opts.hash) history.replaceState(null, '', hashOf(st)); draw(); }

        var tabsBar = h('div', { class: 'dx-dv-tabs', role: 'tablist' }, [['where', 'Where things are', X.where.length, 'Questions a newcomer asks'], ['conv', 'Naming', X.conv.length, 'How names are built here'], ['pit', 'Before you change', X.pit.length, 'What breaks easily']].map(function (b) {
          var on = tab === b[0];
          // Another tab starts with no module picked (spec 19 §4).
          return ln({ view: 'dev', sub: b[0] }, { class: 'dx-dv-tab' + (on ? ' on' : ''), role: 'tab', 'aria-selected': on ? 'true' : 'false' }, [h('span', null, [b[1], h('span', { class: 'mono', text: String(b[2]) })]), h('small', { text: b[3] })],
            function () { st.dmod = null; go({ view: 'dev', sub: b[0] }); });
        }));
        var facet = h('aside', { class: 'dx-dv-facet', 'aria-label': 'Modules', 'data-keep-scroll': 'dv-facet:' + tab }, [
          h('div', { class: 'dx-fc-h' }, [h('span', { class: 'dx-cap', text: 'Modules' }), mod ? h('button', { type: 'button', class: 'dx-fc-clear', text: 'Show all', onclick: function () { setD({ dmod: null }); } }) : null])
        ].concat(Object.keys(counts).sort(function (a, b) { if (a === DEV_ALL) return -1; if (b === DEV_ALL) return 1; return counts[b] - counts[a] || a.localeCompare(b); }).map(function (m) {
          var on = mod === m;
          return h('button', { type: 'button', class: 'dx-dv-mod' + (on ? ' on' : '') + (m === DEV_ALL ? '' : ' mono'), 'aria-pressed': on ? 'true' : 'false', onclick: function () { setD({ dmod: on ? null : m }); } },
            [h('span', { text: m }), h('span', { class: 'dx-fc-n', text: String(counts[m]) })]);
        })));
        var body = h('div', { class: 'dx-dv-list' });
        if (!shown.length) body.appendChild(h('p', { class: 'dx-empty', text: 'Nothing matches.' }));
        else if (tab === 'conv') {
          body.appendChild(h('div', { class: 'dx-dv-conv' }, [h('div', { class: 'dx-dv-cr head' }, [h('span', { text: 'Pattern' }), h('span', { text: 'What it means here' }), h('span', { text: 'Names' })])].concat(shown.map(function (c) {
            return h('div', { class: 'dx-dv-cr' }, [h('span', { class: 'mono dx-dv-pat', text: c.p }), h('span', null, richText(c.m)), h('span', { class: 'mono dx-dv-n' + (c.n ? '' : ' none'), text: c.n ? String(c.n) : '—' })]);
          }))));
        } else {
          var gm = {}, order = [];
          shown.forEach(function (it) { var k = mod || (it.mods.length ? it.mods[0] : DEV_ALL); if (!gm[k]) { gm[k] = []; order.push(k); } gm[k].push(it); });
          order.sort(function (a, b) { if (a === DEV_ALL) return -1; if (b === DEV_ALL) return 1; return gm[b].length - gm[a].length || a.localeCompare(b); });
          order.forEach(function (k) {
            body.appendChild(h('section', { class: 'dx-dv-g' }, [h('div', { class: 'dx-dv-gh' }, [h('b', { class: k === DEV_ALL ? '' : 'mono', text: k }), h('span', { class: 'mono dx-fc-n', text: String(gm[k].length) })]),
              tab === 'where' ? h('div', { class: 'dx-pd-rows' }, gm[k].map(function (it) { return h('div', { class: 'dx-dv-where' }, [h('b', { text: it.q }), h('span', null, richText(it.a))]); }))
                : h('ol', { class: 'dx-dv-pits' }, gm[k].map(function (it) { return h('li', null, [h('span', { class: 'mono', text: it.no }), h('span', null, richText(it.a))]); }))]));
          });
        }
        main.appendChild(h('div', { class: 'dx-dv' }, [tabsBar, h('div', { class: 'dx-dv-body' }, [facet, h('section', { class: 'dx-dv-main', 'data-keep-scroll': 'dv-main:' + tab + '|' + (mod || '') }, [body])])]));
      }

      draw();
      // pages: the pages this data has — the ones the sidebar lists.
      // redraw: the same place drawn again — MxScout's Assist page after an item moved.
      return { go: go, redraw: function () { draw(); }, state: function () { return st; }, riskFilter: function () { return rf; }, pages: function () { return NAV.map(function (x) { return x[0]; }); } };
    }

    // The Markdown copy's file name, the HTML file's with .md.
    function markdownName(data) {
      return String(data.project || 'documentation').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') + '-documentation-' + String(data.generatedAt || '').slice(0, 10) + '.md';
    }
    function fmtDate(iso) {
      var d = new Date(iso);
      if (isNaN(d)) return String(iso || '');
      function p(n) { return n < 10 ? '0' + n : String(n); }
      return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() + ', ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }

    return { mount: mount, layout: domainLayout, markdown: markdown, markdownName: markdownName };
  }

  window.MxDocsView = factory();
  // The source of the reader, for the exported file (see docs.js).
  window.MxDocsView.source = '(' + factory.toString() + ')()';
})();
