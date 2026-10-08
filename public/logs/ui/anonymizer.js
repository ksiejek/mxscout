/* MxScout — Log analysis: the Log & Text Anonymizer.
 *
 * Strips what should not leave the building from a log before it goes to support: e-mail addresses, IPs,
 * UUIDs, MAC addresses, Mendix object ids, Luhn-checked card numbers, custom keywords and custom regexes —
 * and secrets: JWTs, Bearer/Basic values, AWS access key ids, passwords embedded in URLs, Cookie and
 * Set-Cookie values, anything written as api_key / client_secret / password = value (including those same
 * headers inside a HAR, where name and value are separate fields). Only the secret itself is replaced; the
 * label, header name, URL host and user stay readable, so the log is still diagnosable afterwards. Generic
 * secrets are matched by their LABEL, not by value shape, because an API key has no universal format — a
 * secret kept under an unusual name needs a custom keyword or regex.
 *
 * The masking is MxDevSwissTool's (Mikołaj / RealMecowhy, MIT): ../engine/anonymizer.js runs in a Worker
 * (../anonymize-worker.js), so a 100 MB log is masked off the main thread. Both sides are shown, scrolled
 * together, with every replaced span marked on the left and its replacement marked on the right.
 */
(function () {
  'use strict';

  var L = window.MxLogs;
  var h = L.h;
  var W = L.w;

  var ui = {};
  var worker = null;
  var debounce = null;

  // ---------- a text viewer that only draws the lines on screen ----------
  // Renders text of tens of megabytes by drawing just the visible lines. \x01 … \x02 wrap a replaced span, so
  // the viewer marks it; getText() strips those markers, which is what Copy and Download hand out.
  function TextViewer(host, placeholder) {
    var LH = 20, PAD = 12;
    var text = '', offsets = new Uint32Array(0), lineCount = 0, busy = false;
    var spacer = h('div', { class: 'lg-tv-spacer' });
    var content = h('div', { class: 'lg-tv-content' });
    host.classList.add('lg-tv');
    host.tabIndex = 0;
    host.appendChild(spacer);
    host.appendChild(content);
    var self = { host: host, onPaste: null };

    function showPlaceholder() { L.replace(content, [h('span', { class: 'lg-muted', text: placeholder })]); }

    function computeOffsets() {
      var count = 1, i;
      for (i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) count++;
      lineCount = count;
      offsets = new Uint32Array(count + 1);
      var idx = 0;
      offsets[idx++] = 0;
      for (i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) offsets[idx++] = i + 1;
      offsets[idx] = text.length + 1;
    }

    // One line → nodes: plain text, with each \x01…\x02 run in a <mark>. State does not carry across lines,
    // as in the original — a replaced span never contains a newline.
    function lineNodes(line) {
      if (line.indexOf('\x01') === -1) return [line || ' '];
      var out = [], pos = 0;
      while (pos < line.length) {
        var a = line.indexOf('\x01', pos);
        if (a === -1) { out.push(line.slice(pos)); break; }
        if (a > pos) out.push(line.slice(pos, a));
        var b = line.indexOf('\x02', a + 1);
        if (b === -1) b = line.length;
        out.push(h('mark', { class: 'lg-anon-hl', text: line.slice(a + 1, b) }));
        pos = b + 1;
      }
      return out.length ? out : [' '];
    }

    self.render = function () {
      if (!lineCount) return;
      var scrollTop = host.scrollTop, clientHeight = host.clientHeight;
      var startNode = Math.floor(Math.max(0, scrollTop - PAD) / LH);
      var visible = Math.ceil(clientHeight / LH);
      var buffer = 15;
      var start = Math.max(0, startNode - buffer);
      var end = Math.min(lineCount - 1, startNode + visible + buffer);
      content.style.transform = 'translateY(' + (start * LH + PAD) + 'px)';
      L.clear(content);
      var frag = document.createDocumentFragment();
      for (var i = start; i <= end; i++) {
        var s = offsets[i], e = offsets[i + 1] - 1;
        if (e < s) e = s;
        frag.appendChild(h('div', { class: 'lg-tv-line', style: 'height:' + LH + 'px;line-height:' + LH + 'px' }, lineNodes(text.substring(s, e))));
      }
      content.appendChild(frag);
    };
    self.setText = function (t) {
      text = t || '';
      if (!text) { lineCount = 0; spacer.style.height = '0px'; showPlaceholder(); return; }
      computeOffsets();
      spacer.style.height = (lineCount * LH + PAD * 2) + 'px';
      self.render();
    };
    self.getText = function () { return text.replace(/\x01|\x02/g, ''); };

    host.addEventListener('scroll', function () {
      if (busy) return;
      busy = true;
      requestAnimationFrame(function () { self.render(); busy = false; });
    });
    host.addEventListener('paste', function (e) {
      e.preventDefault();
      var t = (e.clipboardData || window.clipboardData).getData('text');
      if (self.onPaste) self.onPaste(t); else self.setText(t);
    });
    showPlaceholder();
    return self;
  }

  // ---------- running the mask ----------
  var OPTIONS = [
    { id: 'uuid', label: 'Mask UUIDs', on: true },
    { id: 'ip', label: 'Mask IP addresses', on: true },
    { id: 'email', label: 'Mask e-mail addresses', on: true },
    { id: 'mendixId', label: 'Mask Mendix object IDs', on: true },
    { id: 'datetime', label: 'Mask timestamps & dates', on: false },
    { id: 'mac', label: 'Mask MAC addresses', on: true },
    { id: 'creditcard', label: 'Mask credit card numbers', on: true },
    { id: 'auth', label: 'Mask auth tokens & secrets (JWT, Bearer, AWS keys, API keys, URL passwords, cookies)', on: true },
    { id: 'number', label: 'Mask all standalone numbers', on: false }
  ];

  function options() {
    var o = {};
    OPTIONS.forEach(function (x) { o[x.id] = ui.opt[x.id].input.checked; });
    o.consistent = ui.consistent.input.checked;
    o.keywords = ui.keywords.value;
    o.customRegex = ui.regex.value;
    return o;
  }

  function autorun() { return ui.autorun.input.checked; }
  function schedule() { clearTimeout(debounce); debounce = setTimeout(run, 300); }

  function run() {
    if (worker) { worker.terminate(); worker = null; }
    clearTimeout(debounce);
    var rawText = ui.raw.getText();
    if (!rawText) { ui.clean.setText(''); setStatus('Ready. Paste some logs to anonymize.'); return; }
    var opts = options();

    // Custom regexes are validated here so the reader gets immediate feedback; invalid lines are skipped by
    // the worker.
    var invalid = [];
    opts.customRegex.split('\n').map(function (l) { return l.trim(); }).filter(Boolean).forEach(function (line) {
      try { new RegExp(line, 'gi'); } catch (e) { invalid.push(line); }
    });

    L.loader.show('Anonymizing logs... 0%', 0);
    setStatus('Processing...', 'Status:');
    try { worker = new Worker('/logs/anonymize-worker.js'); }
    catch (err) { L.loader.hide(); console.error('Failed to create Web Worker:', err); setStatus('Cannot create Web Worker. Check the console.', 'Error:'); return; }

    worker.onmessage = function (msg) {
      var d = msg.data;
      if (d.type === 'progress') { L.loader.show(d.phase || ('Anonymizing logs... ' + d.progress + '%'), d.progress); return; }
      if (d.type !== 'complete') return;
      var stats = d.stats;
      ui.clean.setText(d.result);
      // The left side carries markers on what was replaced.
      if (d.rawResult) ui.raw.setText(d.rawResult);
      var parts = [];
      if (stats.uuid > 0) parts.push(stats.uuid + ' UUIDs');
      if (stats.ip > 0) parts.push(stats.ip + ' IPs');
      if (stats.email > 0) parts.push(stats.email + ' e-mails');
      if (stats.mendixId > 0) parts.push(stats.mendixId + ' Mendix IDs');
      if (stats.datetime > 0) parts.push(stats.datetime + ' timestamps');
      if (stats.mac > 0) parts.push(stats.mac + ' MACs');
      if (stats.creditcard > 0) parts.push(stats.creditcard + ' credit cards');
      if (stats.auth > 0) parts.push(stats.auth + ' auth tokens & secrets');
      if (stats.number > 0) parts.push(stats.number + ' numbers');
      if (stats.keywords > 0) parts.push(stats.keywords + ' custom words');
      if (stats.custom > 0) parts.push(stats.custom + ' custom regex');
      var line = parts.length ? 'Anonymized: ' + parts.join(', ') + '.' : 'No sensitive data detected with the active rules.';
      setStatus(line, 'Status:', invalid.length ? 'Invalid regex skipped: ' + invalid.join(', ') : null);
      L.loader.hide();
      worker.terminate();
      worker = null;
    };
    worker.onerror = function (err) {
      L.loader.hide();
      console.error('Anonymizer worker error:', err);
      setStatus('Anonymization failed. ' + (err.message || ''), 'Error:');
      worker = null;
    };
    worker.postMessage({ rawText: rawText, opts: opts });
  }

  function setStatus(text, label, warn) {
    L.replace(ui.status, [label ? h('strong', { text: label + ' ' }) : null, text, warn ? h('span', { class: 'lg-tone-error', text: ' ' + warn }) : null]);
  }

  function loadFiles(files) {
    var f = files[0];
    if (!f) return;
    L.loader.show('Reading log file...');
    L.readFileText(f).then(function (t) {
      ui.raw.setText(t);
      L.loader.hide();
      if (autorun()) run();
    }, function (e) { L.loader.hide(); L.toast('Could not read "' + f.name + '": ' + e.message, 'error'); });
  }

  // Another tool hands text over (the Log Viewer's "Anonymize in tool", the Nginx analyzer).
  function setInput(text) {
    ui.raw.setText(text);
    run();
  }

  function clearAll() {
    if (worker) { worker.terminate(); worker = null; }
    clearTimeout(debounce);
    ui.raw.setText('');
    ui.clean.setText('');
    setStatus('Ready. Paste some logs to anonymize.');
  }

  function build() {
    ui.opt = {};
    var optionBoxes = OPTIONS.map(function (o) {
      var c = W.checkbox(o.label, o.on, function () { if (autorun()) run(); });
      ui.opt[o.id] = c;
      return c.el;
    });
    ui.consistent = W.checkbox('Consistent masking (pseudonymization)', true, function () { if (autorun()) run(); });
    ui.keywords = h('textarea', { class: 'lg-textarea', rows: '3', placeholder: 'e.g. John, AcmeCorp, MySecretValue', spellcheck: 'false', 'aria-label': 'Custom keywords' });
    ui.regex = h('textarea', { class: 'lg-textarea lg-mono', rows: '3', placeholder: 'e.g. ORD-\\d{6}\nPROJ_[A-Z]+_KEY', spellcheck: 'false', 'aria-label': 'Custom regex patterns' });
    ui.keywords.addEventListener('input', function () { if (autorun()) schedule(); });
    ui.regex.addEventListener('input', function () { if (autorun()) schedule(); });
    ui.autorun = W.checkbox('Auto-run on changes', true, function () {});

    var settings = h('div', { class: 'lg-an-settings' }, [
      h('h4', { class: 'lg-label', text: 'Masking options' }),
      h('div', { class: 'lg-an-checks' }, optionBoxes),
      h('div', { class: 'lg-an-group' }, [ui.consistent.el, h('p', { class: 'lg-hint', text: 'Replaces identical values with the same alias, e.g. [IP-1], so the log still reads as one story.' })]),
      h('div', { class: 'lg-an-group' }, [h('div', { class: 'lg-label', text: 'Custom keywords (comma-separated)' }), ui.keywords, h('p', { class: 'lg-hint', text: 'Case-insensitive; replaced with [REDACTED].' })]),
      h('div', { class: 'lg-an-group' }, [h('div', { class: 'lg-label', text: 'Custom regex patterns (one per line)' }), ui.regex, h('p', { class: 'lg-hint', text: 'JavaScript regex, case-insensitive, without slashes. Matches are replaced with [CUSTOM].' })]),
      h('div', { class: 'lg-an-group lg-an-last' }, [ui.autorun.el])
    ]);

    ui.status = h('span', { class: 'lg-an-status', text: 'Ready. Paste some logs to anonymize.' });
    ui.rawHost = h('div', { class: 'lg-an-viewer' });
    ui.cleanHost = h('div', { class: 'lg-an-viewer' });
    ui.raw = TextViewer(ui.rawHost, 'Paste logs here, or drag & drop a log file…');
    ui.clean = TextViewer(ui.cleanHost, 'Anonymized results will appear here…');
    L.keepScroll(ui.rawHost); L.keepScroll(ui.cleanHost);

    // Scroll the two sides together.
    var syncing = false;
    function link(a, b) {
      a.addEventListener('scroll', function () {
        if (syncing) { syncing = false; return; }
        syncing = true;
        b.scrollTop = a.scrollTop; b.scrollLeft = a.scrollLeft;
      });
    }
    link(ui.rawHost, ui.cleanHost); link(ui.cleanHost, ui.rawHost);

    // Pasting goes through the viewer's own hook: the text is kept whole, never put in a text field.
    ui.raw.onPaste = function (t) { ui.raw.setText(t); if (autorun()) schedule(); };
    W.dropTarget(ui.rawHost, loadFiles);

    var picker = W.filePicker('Browse file', { accept: '.log,.txt,.csv,.gz' }, loadFiles);
    var split = 'split';
    var grid = h('div', { class: 'lg-an-grid is-split' });
    var viewSeg = W.segmented([{ id: 'split', label: 'Split' }, { id: 'raw', label: 'Raw' }, { id: 'result', label: 'Result' }], 'split', function (v) {
      split = v;
      grid.classList.toggle('is-split', v === 'split'); grid.classList.toggle('is-raw', v === 'raw'); grid.classList.toggle('is-result', v === 'result');
      ui.raw.render(); ui.clean.render();
    });

    var rawPane = h('div', { class: 'lg-an-pane lg-an-rawpane' }, [h('div', { class: 'lg-an-panehead' }, [h('strong', { text: 'Raw text input' }), h('span', { class: 'muted', text: 'drop a file or paste text below' }), h('span', { class: 'lg-grow' }), picker.button, picker.input]), ui.rawHost]);
    var cleanPane = h('div', { class: 'lg-an-pane lg-an-cleanpane' }, [h('div', { class: 'lg-an-panehead' }, [h('strong', { text: 'Anonymized output' }), ui.status]), ui.cleanHost]);
    grid.appendChild(settings); grid.appendChild(rawPane); grid.appendChild(cleanPane);

    var actions = h('div', { class: 'lg-actions' }, [
      viewSeg.el,
      h('button', { class: 'btn btn-sm', type: 'button', text: 'Copy', onclick: function (e) { var t = ui.clean.getText(); if (t) { L.copy(t, e.currentTarget); L.toast('Anonymized log copied to the clipboard.', 'ok'); } } }),
      h('button', { class: 'btn btn-sm', type: 'button', text: 'Download', onclick: function () { var t = ui.clean.getText(); if (t) L.download(t, 'anonymized-logs.txt'); } }),
      h('button', { class: 'btn btn-sm', type: 'button', text: 'Settings', title: 'Show or hide the masking options', onclick: function () { settings.hidden = !settings.hidden; } }),
      h('button', { class: 'btn btn-sm btn-danger-outline', type: 'button', text: 'Clear', onclick: clearAll }),
      h('button', { class: 'btn btn-primary btn-sm', type: 'button', text: 'Anonymize', onclick: run })
    ]);
    ui.split = function () { return split; };
    return h('div', { class: 'lg-tool lg-an' }, [actions, grid]);
  }

  L.register({
    id: 'log-anonymizer', label: 'Anonymizer',
    hint: 'Strip e-mails, IPs, ids, tokens and secrets from a log before it is shared.',
    build: build,
    setInput: setInput,
    onShow: function () { if (ui.raw) { ui.raw.render(); ui.clean.render(); } }
  });
})();
