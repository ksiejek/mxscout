/* MxScout — what version this is, and what changed in it.
 *
 * MxScout does NOT check whether a newer version exists. Not automatically,
 * not behind a button, not at all. That is a decision, not an omission, and it
 * is worth stating where someone will read it:
 *
 *  - The server process promises to open no outbound connections for the whole
 *    of its life. A version check is an outbound connection. Keeping the
 *    promise is worth more than the convenience — it is the single sentence a
 *    security review remembers.
 *  - In a corporate network github.com is often unreachable anyway, so an
 *    automatic check would mostly produce an error at startup: a tool that
 *    greets you with a failure it caused itself.
 *  - MxScout has no write access to its own directory and should not have any.
 *    An application that overwrites itself is the pattern security departments
 *    block most often. Updating is `git pull`, done by a person.
 *
 * What it CAN do without any of that, and does:
 *
 *  - Tell you exactly which version is running, read from the server rather
 *    than from a constant, so it cannot claim a version it is not.
 *  - Show you what is in that version, from the CHANGELOG that ships with it.
 *  - Notice, at startup, that the version has CHANGED since you last used it —
 *    which needs no network, because the fact lives in this browser — and show
 *    you what you just moved onto. That is the "new version, here is what
 *    changed, confirm" moment, arriving when the update actually happened
 *    instead of when a remote server was asked about one.
 */
(function () {
  'use strict';

  var app = null;
  var SETTING_KEY = 'version.lastSeen.v1';

  var state = {
    version: null,      // what the running server reports
    changelog: null,    // parsed sections, once fetched
    loading: false,
    error: null,
    open: false,        // the panel is showing
    whatsNew: null      // the version we just moved ONTO, if we noticed a change
  };

  function init(api) {
    app = api;
    return app.api('/api/health').then(function (health) {
      state.version = health && health.version || null;
      return checkForChange();
    }, function () {
      state.error = 'MxScout could not read its own version from the server.';
      return null;
    });
  }

  // ---------- "you are on a different version than last time" ----------
  // Deliberately compares against what THIS browser last saw, not against
  // anything remote. Downgrades count too: if someone checks out an older
  // copy, saying so is more useful than silence.
  function checkForChange() {
    if (!state.version) return null;
    return app.store.get('settings', SETTING_KEY).then(function (row) {
      var last = row && row.value;
      if (!last) return remember();          // first run: nothing to announce
      if (last === state.version) return null;
      state.whatsNew = { from: last, to: state.version };
      // NOT recorded yet. Karol asked to see the changes and confirm them, so
      // the record is what confirming means: close the browser without reading
      // it and it is waiting again next time, rather than having been silently
      // ticked off on your behalf.
      return null;
    }).catch(function () { return null; });
  }

  function remember() {
    return app.store.put('settings', { key: SETTING_KEY, value: state.version, at: new Date().toISOString() })
      .catch(function () { return null; });
  }

  function dismissWhatsNew() {
    state.whatsNew = null;
    remember();
    app.render();
  }

  // ---------- the changelog ----------
  function load() {
    if (state.changelog || state.loading) return;
    state.loading = true;
    app.api('/api/changelog').then(function (data) {
      state.loading = false;
      state.changelog = data && data.text ? parse(data.text) : null;
      if (!state.changelog) state.error = 'MxScout could not read its own CHANGELOG.md.';
      app.render();
    }, function () {
      state.loading = false;
      state.error = 'MxScout could not read its own CHANGELOG.md.';
      app.render();
    });
  }

  // A deliberately tiny Markdown reader: headings, bullets, paragraphs, bold
  // and inline code. It returns a TREE, not markup — there is no string of
  // HTML anywhere in this file, and the renderer below builds elements and
  // sets textContent, exactly like the rest of MxScout. A CHANGELOG is a file
  // in this repository rather than untrusted input, but "the input is
  // trusted" is how every innerHTML gets written, so it does not get one.
  function parse(text) {
    var lines = String(text).split(/\r?\n/);
    var blocks = [];
    var para = [];
    var bullets = [];

    function flushPara() {
      if (!para.length) return;
      blocks.push({ type: 'p', spans: inline(para.join(' ')) });
      para = [];
    }
    function flushBullets() {
      if (!bullets.length) return;
      blocks.push({ type: 'ul', items: bullets.map(inline) });
      bullets = [];
    }
    function flush() { flushPara(); flushBullets(); }

    lines.forEach(function (raw) {
      var line = raw.replace(/\s+$/, '');
      var heading = /^(#{1,4})\s+(.*)$/.exec(line);
      if (heading) {
        flush();
        blocks.push({ type: 'h', level: heading[1].length, spans: inline(heading[2]) });
        return;
      }
      var bullet = /^\s*[-*]\s+(.*)$/.exec(line);
      if (bullet) { flushPara(); bullets.push(bullet[1]); return; }
      if (!line.trim()) { flush(); return; }
      // A plain line while a list is open CONTINUES the last bullet. Markdown
      // calls this lazy continuation, and it is what makes a wrapped bullet
      // one bullet. Treating it as a new paragraph instead did something
      // worse than look wrong: it split the line in the middle, so a **bold**
      // run spanning the wrap lost its pair and rendered its asterisks.
      if (bullets.length) { bullets[bullets.length - 1] += ' ' + line.trim(); return; }
      para.push(line.trim());
    });
    flush();
    return blocks;
  }

  // **bold** and `code`, nothing else. Anything that is not one of those is a
  // plain run of text — including a stray asterisk or backtick, which comes
  // out as itself rather than swallowing the rest of the line.
  function inline(text) {
    var spans = [];
    var re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
    var at = 0;
    var m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > at) spans.push({ kind: 'text', text: text.slice(at, m.index) });
      if (m[1] != null) spans.push({ kind: 'strong', text: m[1] });
      else spans.push({ kind: 'code', text: m[2] });
      at = m.index + m[0].length;
    }
    if (at < text.length) spans.push({ kind: 'text', text: text.slice(at) });
    return spans;
  }

  function renderSpans(spans) {
    return spans.map(function (s) {
      if (s.kind === 'strong') return app.el('strong', { text: s.text });
      if (s.kind === 'code') return app.el('code', { class: 'inline-code', text: s.text });
      return document.createTextNode(s.text);
    });
  }

  function renderBlocks(blocks, limitToVersion) {
    var out = [];
    // Everything before the first version heading is the file's preamble —
    // its title, and an explanation of why MxScout does not check for updates.
    // That is for whoever opens CHANGELOG.md in the repository. In here the
    // panel has already said it, one paragraph up, so repeating it reads as
    // nobody having edited the page.
    var started = false;
    var skipping = false;
    blocks.forEach(function (b) {
      // "Only this version" stops at the next top-level version heading.
      if (b.type === 'h' && b.level === 2) {
        started = true;
        var name = b.spans.map(function (s) { return s.text; }).join('');
        skipping = !!limitToVersion && name.trim() !== limitToVersion;
      }
      if (!started || skipping) return;
      if (b.type === 'h') {
        out.push(app.el('h' + Math.min(4, b.level + 1), { class: 'changelog-h changelog-h' + b.level }, renderSpans(b.spans)));
        return;
      }
      if (b.type === 'ul') {
        out.push(app.el('ul', { class: 'changelog-list' }, b.items.map(function (item) {
          return app.el('li', {}, renderSpans(item));
        })));
        return;
      }
      out.push(app.el('p', {}, renderSpans(b.spans)));
    });
    return out;
  }

  // ---------- the panel ----------
  function open() {
    state.open = true;
    state.error = null;
    load();
    app.render();
  }
  function close() { state.open = false; app.render(); }
  function isOpen() { return state.open; }
  function version() { return state.version; }

  function body(limitToVersion) {
    if (state.loading) return [app.el('div', { class: 'changelog-wait' }, [app.el('span', { class: 'spinner' }), app.el('span', { text: ' Reading the changelog…' })])];
    if (state.error) return [app.el('p', { class: 'warn-text', text: state.error })];
    if (!state.changelog) return [app.el('p', { class: 'muted', text: 'No changelog is available in this copy.' })];
    var blocks = renderBlocks(state.changelog, limitToVersion || null);
    if (!blocks.length) return [app.el('p', { class: 'muted', text: 'This version has no changelog entry yet.' })];
    return blocks;
  }

  function renderPanel() {
    if (!state.open) return null;
    var backdrop = app.el('div', {
      class: 'modal-backdrop',
      onclick: function (e) { if (e.target === backdrop) close(); }
    }, [
      app.el('div', { class: 'modal modal-wide' }, [
        app.el('div', { class: 'popup-head' }, [
          app.el('div', {}, [
            app.el('h3', { text: 'MxScout ' + (state.version || 'unknown version') }),
            app.el('p', { class: 'muted', text: 'Read from the running server, so it cannot claim a version it is not.' })
          ]),
          app.el('div', { class: 'popup-head-actions' }, [
            app.el('button', { class: 'btn btn-sm', text: 'Close', onclick: close })
          ])
        ]),
        app.el('div', { class: 'popup-section update-how' }, [
          app.el('h4', { text: 'Is there a newer one?' }),
          app.el('p', { class: 'muted', text: 'MxScout does not know, and does not ask. It opens no connection to find out — that promise is worth more than the convenience, and in a corporate network the check would usually fail anyway.' }),
          app.el('p', {}, [
            document.createTextNode('To find out, look at the repository yourself. To move to a newer version, run this in the MxScout directory:')
          ]),
          app.el('code', { class: 'update-command', text: 'git pull' }),
          app.el('p', { class: 'hint', text: 'MxScout never rewrites its own files. It has no write access to its own directory, and should not have any.' })
        ]),
        app.el('div', { class: 'popup-section' }, [
          app.el('h4', { text: 'What is in this copy' })
        ].concat(body(null)))
      ])
    ]);
    return backdrop;
  }

  // Shown once, after the version actually changed — the "new version, here is
  // what changed" moment, triggered by the update rather than by asking a
  // server about one.
  function renderWhatsNew() {
    if (!state.whatsNew || state.open) return null;
    load();
    var backdrop = app.el('div', {
      class: 'modal-backdrop',
      onclick: function (e) { if (e.target === backdrop) dismissWhatsNew(); }
    }, [
      app.el('div', { class: 'modal modal-wide' }, [
        app.el('h3', { text: 'MxScout was updated' }),
        app.el('p', { class: 'muted', text: 'You were on ' + state.whatsNew.from + '. This is ' + state.whatsNew.to + '. Here is what changed.' }),
        app.el('div', { class: 'changelog-body' }, body(state.whatsNew.to)),
        app.el('div', { class: 'modal-actions' }, [
          app.el('button', { class: 'btn', text: 'See the whole changelog', onclick: function () { state.whatsNew = null; remember(); open(); } }),
          app.el('button', { class: 'btn btn-primary', text: 'Got it', onclick: dismissWhatsNew })
        ])
      ])
    ]);
    return backdrop;
  }

  window.MxVersion = {
    init: init,
    open: open,
    isOpen: isOpen,
    version: version,
    renderPanel: renderPanel,
    renderWhatsNew: renderWhatsNew,
    parse: parse,
    inline: inline
  };
})();
