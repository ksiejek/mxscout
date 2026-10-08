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
    whatsNew: null,     // the version we just moved ONTO, if we noticed a change
    expanded: {}        // "version#index" -> true for an entry somebody opened
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

  // The file is read as versions holding entries, because that is how it is
  // written: every `## version` is a release, every `### heading` under it is
  // one change, and nearly every change opens with a **bold sentence** saying
  // it in one line. Drawn as one long document, all three were lost — 645
  // lines in a single scroll with nothing to steer by. Grouped, a release
  // reads as a list of headlines first, with the detail one click away.
  //
  // Everything before the first version heading is the file's preamble — its
  // title, and why MxScout does not check for updates. That is for whoever
  // opens CHANGELOG.md in the repository; the panel says it in its own words
  // beside the list, so it is dropped here.
  function group(blocks) {
    var versions = [];
    var version = null;
    var entry = null;
    blocks.forEach(function (b) {
      if (b.type === 'h' && b.level === 2) {
        version = { name: spanText(b.spans).trim(), spans: b.spans, intro: [], entries: [] };
        versions.push(version);
        entry = null;
        return;
      }
      if (!version) return;
      if (b.type === 'h' && b.level === 3) {
        entry = { spans: b.spans, blocks: [] };
        version.entries.push(entry);
        return;
      }
      (entry ? entry.blocks : version.intro).push(b);
    });
    return versions;
  }

  function spanText(spans) { return spans.map(function (s) { return s.text; }).join(''); }

  // The headline under a heading: the bold run an entry's first paragraph
  // opens with. An entry written without one has no headline — its heading
  // is still a usable summary, so nothing is made up in its place.
  function lead(entry) {
    var first = entry.blocks[0];
    if (!first || first.type !== 'p' || !first.spans.length || first.spans[0].kind !== 'strong') return null;
    return first.spans[0].text;
  }

  function renderBlock(b) {
    if (b.type === 'h') return app.el('h' + Math.min(6, b.level + 1), { class: 'changelog-h changelog-h' + b.level }, renderSpans(b.spans));
    if (b.type === 'ul') {
      return app.el('ul', { class: 'changelog-list' }, b.items.map(function (item) {
        return app.el('li', {}, renderSpans(item));
      }));
    }
    return app.el('p', {}, renderSpans(b.spans));
  }

  // One change, closed by default — except, in the full changelog, in the
  // version that is running, which is the one whose detail a person most often
  // came for. "MxScout was updated" shows only that version and keeps it as
  // headlines: there it is a summary of what moved, not the place to read it.
  // A closed <details> still holds all of its text — closed is a matter of
  // what is drawn, not of what was left out — so find-in-page still reaches
  // inside an entry nobody has opened. Once somebody opens or closes an entry,
  // that choice wins over the default until the page is reloaded.
  function renderEntry(versionName, entry, index, openCurrent) {
    var key = versionName + '#' + index;
    var headline = lead(entry);
    var node = app.el('details', {
      class: 'changelog-entry',
      ontoggle: function () { state.expanded[key] = node.open; }
    }, [
      app.el('summary', { class: 'changelog-entry-head' }, [
        app.el('span', { class: 'changelog-entry-title' }, renderSpans(entry.spans)),
        headline ? app.el('span', { class: 'changelog-entry-lead', text: headline }) : null
      ]),
      app.el('div', { class: 'changelog-entry-body' }, entry.blocks.map(renderBlock))
    ]);
    if (key in state.expanded ? state.expanded[key] : openCurrent && versionName === state.version) node.open = true;
    return node;
  }

  function changeCount(v) {
    return v.entries.length === 1 ? '1 change' : v.entries.length + ' changes';
  }

  function versionTag(v) {
    if (v.name === state.version) return 'this copy';
    if (/^unreleased$/i.test(v.name)) return 'not released yet';
    return null;
  }

  function renderVersion(v, openCurrent) {
    var tag = versionTag(v);
    return app.el('section', { class: 'changelog-version', 'data-version': v.name }, [
      app.el('div', { class: 'changelog-version-head' }, [
        app.el('h3', { class: 'changelog-h changelog-h2' }, renderSpans(v.spans)),
        tag ? app.el('span', { class: 'changelog-tag' + (v.name === state.version ? ' is-current' : ''), text: tag }) : null,
        app.el('span', { class: 'changelog-count', text: changeCount(v) })
      ]),
      v.intro.length ? app.el('div', { class: 'changelog-intro' }, v.intro.map(renderBlock)) : null
    ].concat(v.entries.map(function (e, i) { return renderEntry(v.name, e, i, openCurrent); })));
  }

  function renderVersions(blocks, limitToVersion, openCurrent) {
    return group(blocks).filter(function (v) {
      return !limitToVersion || v.name === limitToVersion;
    }).map(function (v) { return renderVersion(v, openCurrent); });
  }

  // Opening or closing every entry of the list on screen. Done on the
  // elements themselves rather than through a re-render, which would throw
  // away where the list was scrolled to.
  function setAllOpen(root, open) {
    Array.prototype.forEach.call(root.querySelectorAll('details.changelog-entry'), function (d) { d.open = open; });
  }

  // The left column: every version, how many changes it holds, and a jump to
  // it. scrollIntoView rather than setting scrollTop, because on a phone the
  // list is no longer its own scroller — the whole window is.
  function renderNav(list) {
    if (!state.changelog) return null;
    return app.el('nav', { class: 'changelog-nav', 'aria-label': 'Versions' }, group(state.changelog).map(function (v) {
      return app.el('button', {
        class: 'changelog-nav-item' + (v.name === state.version ? ' is-current' : ''),
        title: versionTag(v) || null,
        onclick: function () {
          var target = list.querySelector('[data-version="' + v.name.replace(/"/g, '') + '"]');
          if (target) target.scrollIntoView({ block: 'start' });
        }
      }, [
        app.el('span', { class: 'changelog-nav-name', text: v.name }),
        app.el('span', { class: 'changelog-nav-meta', text: changeCount(v) })
      ]);
    }));
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

  function body(limitToVersion, openCurrent) {
    if (state.loading) return [app.el('div', { class: 'changelog-wait' }, [app.el('span', { class: 'spinner' }), app.el('span', { text: ' Reading the changelog…' })])];
    if (state.error) return [app.el('p', { class: 'warn-text', text: state.error })];
    if (!state.changelog) return [app.el('p', { class: 'muted', text: 'No changelog is available in this copy.' })];
    var blocks = renderVersions(state.changelog, limitToVersion || null, !!openCurrent);
    if (!blocks.length) return [app.el('p', { class: 'muted', text: 'This version has no changelog entry yet.' })];
    return blocks;
  }

  function renderPanel() {
    if (!state.open) return null;
    var list = app.el('div', { class: 'changelog-scroll' }, body(null, true));
    var backdrop = app.el('div', {
      class: 'modal-backdrop',
      onclick: function (e) { if (e.target === backdrop) close(); }
    }, [
      app.el('div', { class: 'modal modal-changelog' }, [
        app.el('div', { class: 'popup-head' }, [
          app.el('div', {}, [
            app.el('h3', { text: 'MxScout ' + (state.version || 'unknown version') }),
            app.el('p', { class: 'muted', text: 'Read from the running server, so it cannot claim a version it is not.' })
          ]),
          app.el('div', { class: 'popup-head-actions' }, [
            state.changelog ? app.el('button', { class: 'btn btn-sm btn-ghost changelog-bulk', text: 'Expand all', onclick: function () { setAllOpen(list, true); } }) : null,
            state.changelog ? app.el('button', { class: 'btn btn-sm btn-ghost changelog-bulk', text: 'Collapse all', onclick: function () { setAllOpen(list, false); } }) : null,
            app.el('button', { class: 'btn btn-sm', text: 'Close', onclick: close })
          ])
        ]),
        app.el('div', { class: 'changelog-layout' }, [
          app.el('aside', { class: 'changelog-side' }, [
            renderNav(list),
            // Kept, and kept on screen, but no longer the first thing read: it
            // answers "is there a newer one?", which is not the question most
            // people opening a list of changes came with.
            app.el('div', { class: 'update-how' }, [
              app.el('h4', { text: 'Is there a newer one?' }),
              app.el('p', { class: 'muted', text: 'MxScout does not know, and does not ask. It opens no connection to find out — that promise is worth more than the convenience, and in a corporate network the check would usually fail anyway.' }),
              app.el('p', { class: 'muted', text: 'To find out, look at the repository yourself. To move to a newer version, run this in the MxScout directory:' }),
              app.el('code', { class: 'update-command', text: 'git pull' }),
              app.el('p', { class: 'hint', text: 'MxScout never rewrites its own files. It has no write access to its own directory, and should not have any.' })
            ])
          ]),
          list
        ])
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
