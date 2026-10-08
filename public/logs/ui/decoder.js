/* MxScout — Log analysis: the Mendix Error Decoder.
 *
 * Paste a Mendix, Java or PostgreSQL error message or stack trace and get the MECHANISM behind it —
 * decoded, not guessed. For every known signature it matches it shows three things: what happened
 * technically (certain), typical causes (an explicit list of hypotheses) and how to check which one
 * applies (a diagnostic checklist that points at the other tools). It is a decoder, not a fix advisor: it
 * always shows the pattern it matched so the reader can judge the fit, and when it does not recognise a
 * message it says so rather than inventing a cause.
 *
 * The ruleset — mined from real production logs, 89.7% of ERROR/WARNING volume across ten apps — is
 * MxDevSwissTool's (Mikołaj / RealMecowhy, MIT): ../engine/decoder.js, unchanged. This is the screen.
 */
(function () {
  'use strict';

  var L = window.MxLogs;
  var h = L.h;
  var W = L.w;

  // Which tool a diagnostic check can point at, and what to call it. The original listed ten; the five that
  // are not part of MxScout (JVM health, SAML debugger, Query Intelligence, XPath formatter, character
  // sanitiser) are left as plain text in the check — the advice stays, there is just no button.
  var TOOL_LABELS = {
    'log-query-extractor': 'Query Extractor',
    'microflow-tracer': 'Microflow Tracer',
    'ws-rest-extractor': 'REST & WS Extractor',
    'log-viewer': 'Log Viewer',
    'nginx-log': 'Nginx Log Analyzer'
  };

  // The checklist tells the reader to "look for two commits with the same key around this timestamp" and
  // hands them a button. Without the timestamp that button lands in an unfiltered 60 MB log, which is the
  // same as landing nowhere. When the decode came from a log row (the Explain chip) we keep that row's time and
  // correlation ID, and narrow the target tool on the way in. A pasted error has no context — then these
  // buttons behave exactly as they always did.
  var context = null;          // { ts, corrId } currently in force
  var pendingContext = null;   // set by decodeText, consumed by the next analyze
  var WINDOW_MS = 30000;       // ±30 s around the error — wide enough for the commit pair, narrow enough to read
  var ui = {};
  var timer = null;

  function contextMs() { return (context && context.ts) ? window.mtTsToMs(context.ts) : NaN; }

  function renderContext() {
    L.clear(ui.context);
    if (!context) { ui.context.hidden = true; return; }
    ui.context.hidden = false;
    var bits = [];
    if (context.ts) bits.push(h('span', { class: 'lg-mono', text: context.ts }));
    if (context.corrId) bits.push(['corr ', h('span', { class: 'lg-mono', text: context.corrId })]);
    ui.context.appendChild(h('span', { class: 'muted', text: 'From the Log Viewer: ' }));
    bits.forEach(function (b, i) { if (i) L.add(ui.context, ' · '); L.add(ui.context, b); });
    ui.context.appendChild(h('span', { class: 'muted', text: ' — the buttons below open each tool narrowed to this error' + (context.ts ? ' (±30 s)' : '') + '.' }));
  }

  // Each target narrows through the entry point it already has — no new filtering machinery anywhere, just the
  // arguments the tool had all along.
  function openTool(toolId) {
    L.goto(toolId, { withReturn: true });
    if (!context) return;
    var ms = contextMs();
    var tool = L.tools[toolId];
    if (toolId === 'log-query-extractor' && !isNaN(ms)) tool.setTimeWindow(ms - WINDOW_MS, ms + WINDOW_MS, 'error ±30 s');
    else if (toolId === 'log-viewer' && context.corrId) tool.filterInsight('', '', context.corrId);
    else if (toolId === 'microflow-tracer' && context.corrId) tool.search(context.corrId);
  }

  // What the current context lets a given target be narrowed by — empty when the error was pasted, or when this
  // tool has nothing to narrow with.
  function narrowingNote(toolId) {
    if (!context) return '';
    if (toolId === 'log-query-extractor' && !isNaN(contextMs())) return ', showing only the SQL from ±30 s around this error';
    if (toolId === 'log-viewer' && context.corrId) return ', filtered to this error’s correlation ID';
    if (toolId === 'microflow-tracer' && context.corrId) return ', searched for this error’s correlation ID';
    return '';
  }

  function checkNode(check) {
    // The check text is authored in the ruleset (trusted, with <code>/<em>); only the optional tool button is
    // generated here. Say what the button will actually do — "opens narrowed to ±30 s" is a different promise
    // from "opens the tool", and only one of them is true here.
    var li = h('li', { class: 'lg-check-item' }, [h('span', { class: 'lg-check-mark', text: '✓' })]);
    var body = h('span', { class: 'lg-check-body' }, [W.rich(check.text)]);
    if (check.tool && TOOL_LABELS[check.tool] && L.tools[check.tool]) {
      L.add(body, ' ');
      body.appendChild(h('button', {
        class: 'lg-toollink', type: 'button', text: TOOL_LABELS[check.tool] + ' ↗',
        title: 'Open the ' + TOOL_LABELS[check.tool] + narrowingNote(check.tool), onclick: function () { openTool(check.tool); }
      }));
    }
    li.appendChild(body);
    return li;
  }

  // PostgreSQL errors name tables (`eshop$order`), Mendix developers think in entities (`eShop.Order`). When
  // the open project has told us its entities (MxLogs.setTableMap) the message is translated; with no model
  // the section does not appear.
  function card(match, messageText) {
    var tables = window.edxMapTables(messageText || match.matchedText, L.tableMap ? L.tableMap() : null);
    return h('div', { class: 'lg-edx-card' }, [
      h('div', { class: 'lg-edx-head' }, [h('span', { class: 'lg-edx-cat', text: match.category }), h('span', { class: 'lg-edx-title', text: match.title })]),
      h('div', { class: 'lg-edx-matched' }, [h('span', { class: 'lg-edx-matched-label', text: 'Matched pattern' }), match.matchedText]),
      tables.length ? h('div', { class: 'lg-edx-section' }, [h('div', { class: 'lg-edx-label', text: 'Tables in this message' }),
        h('ul', { class: 'lg-edx-list' }, tables.map(function (t) { return h('li', null, [h('code', { text: t.table }), ' → ', h('strong', { text: t.entity })]); }))]) : null,
      h('div', { class: 'lg-edx-section lg-edx-mechanism' }, [h('div', { class: 'lg-edx-label', text: 'What happened technically' }), h('p', null, [W.rich(match.mechanism)])]),
      h('div', { class: 'lg-edx-section' }, [h('div', { class: 'lg-edx-label' }, ['Typical causes ', h('span', { class: 'lg-edx-hyp', text: '(hypotheses)' })]),
        h('ul', { class: 'lg-edx-list' }, (match.causes || []).map(function (c) { return h('li', null, [W.rich(c)]); }))]),
      h('div', { class: 'lg-edx-section' }, [h('div', { class: 'lg-edx-label', text: 'How to check which' }), h('ul', { class: 'lg-edx-list lg-edx-checks' }, (match.checks || []).map(checkNode))])
    ]);
  }

  function render(result) {
    var out = ui.results;
    L.clear(out);
    if (result.input.empty) {
      out.appendChild(h('div', { class: 'lg-edx-empty' }, [
        h('p', { class: 'lg-empty-title', text: 'Paste an error to decode its mechanism' }),
        h('p', null, ['The decoder recognizes known Mendix, Java and PostgreSQL error signatures and explains, for each one it matches: ', h('strong', { text: 'what happened technically' }), ' (certain), ', h('strong', { text: 'typical causes' }),
          ' (hypotheses) and ', h('strong', { text: 'how to check which cause applies' }), ' (a diagnostic checklist).']),
        h('p', { text: 'It is a decoder, not a fix advisor — it never tells you what to change, and when it does not recognize a message it says so rather than guessing.' })
      ]));
      return;
    }
    var stackNote = result.input.hasStackTrace ? 'stack trace detected' : 'no stack trace — pasting the full trace (with “Caused by:”) improves matching';

    if (result.matches.length === 0) {
      // Data-driven rule: no recognised signature ⇒ say so, never invent a cause.
      out.appendChild(h('div', { class: 'lg-edx-context', text: result.input.lineCount + ' line(s) analyzed · ' + stackNote }));
      out.appendChild(h('div', { class: 'lg-edx-empty' }, [
        h('p', { class: 'lg-empty-title', text: 'No known pattern matched' }),
        h('p', { text: 'The decoder only shows a card when it recognizes an error mechanism with confidence — it will not guess a cause for an unrecognized message.' }),
        h('p', null, ['Try pasting the ', h('strong', { text: 'full stack trace' }), ', including the deepest “Caused by:” line (that root cause is usually what a pattern keys off), or open the message in the ',
          h('button', { class: 'lg-toollink', type: 'button', text: 'Log Viewer ↗', onclick: function () { openTool('log-viewer'); } }), ' to see its surrounding context.']),
        h('p', null, [h('button', {
          class: 'btn btn-sm', type: 'button', text: 'Report unmatched — copy signature', title: 'Copies a redacted signature (IDs/timestamps/emails replaced) — share it to request a new pattern',
          onclick: function (e) { copySignature(e.currentTarget); }
        })])
      ]));
      return;
    }
    var many = result.matches.length > 1;
    out.appendChild(h('div', { class: 'lg-edx-context' }, [result.input.lineCount + ' line(s) analyzed · ' + stackNote + ' · ', h('strong', { text: String(result.matches.length) }), ' matched pattern' + (many ? 's' : '') +
      (many ? ' — shown most specific first. A wrapped exception’s deepest match is usually its root cause; read the cards together.' : '')]));
    var inModel = W.modelLinks(result.input.text, function (o) {
      return { severity: 'high', change: '',
        problem: 'Decoded: ' + result.matches[0].title + (context && context.ts ? ' (' + context.ts + ')' : '') + ' — this ' + o.kind + ' is named in:\n\n' +
          result.input.text.split('\n').slice(0, 12).join('\n') };
    });
    if (inModel) out.appendChild(inModel);
    result.matches.forEach(function (m) { out.appendChild(card(m, result.input.text)); });
    out.appendChild(h('div', { class: 'lg-edx-disclaimer', text: 'This decoder explains error mechanisms and lists causes to check — it does not prescribe fixes. Always confirm the matched pattern fits your actual message before acting on it.' }));
  }

  function analyze() {
    // Context only survives the analyze it arrived with: re-analyzing pasted text must not silently narrow the
    // tools to an error the reader has moved on from.
    context = pendingContext;
    pendingContext = null;
    renderContext();
    render(window.edxDecode(ui.input.value));
  }

  // "Report unmatched": no rule fit, so instead of guessing, copy a shareable signature (the same header+stack
  // normalisation the Aggregate Errors dialog uses, so ids/UUIDs/timestamps are redacted) for the reader to file
  // as a new pattern request.
  function copySignature(btn) {
    var text = ui.input.value;
    if (!text.trim()) return;
    L.copy(window.logGetSignature({ msg: text }).key, btn);
  }

  // Cross-tool hand-off: the Log Viewer's "Explain" chip lands here and feeds the ERROR record's full message
  // (headline + stack) straight in.
  function decodeText(text, ctx) {
    ui.input.value = text != null ? String(text) : '';
    pendingContext = (ctx && (ctx.ts || ctx.corrId)) ? ctx : null;
    analyze();
  }

  function clearAll() {
    ui.input.value = '';
    // Clearing the error clears the log row it came from — otherwise the next pasted error would inherit the
    // previous one's time window.
    context = null; pendingContext = null;
    renderContext();
    render(window.edxDecode(''));
  }

  function loadExample() {
    ui.input.value = [
      "2026-07-18T09:14:22.517 [runtime-container/abc]  ERROR - Connector: com.mendix.systemwideinterfaces.core.UserException: An error has occurred while handling the request. [User 'Anonymous_9f' with roles 'Guest']",
      "com.mendix.modules.microflowengine.MicroflowException: Error in (sub)microflow call 'MyFirstModule.ACT_Order_Save'",
      'Advanced stacktrace:',
      '\tat com.mendix.modules.microflowengine.MicroflowEngine.executeMicroflow(MicroflowEngine.java:120)',
      'Caused by: org.postgresql.util.PSQLException: ERROR: duplicate key value violates unique constraint "order_ordernumber_key"',
      '  Detail: Key (ordernumber)=(ORD-100241) already exists.',
      '\tat org.postgresql.core.v3.QueryExecutorImpl.receiveErrorResponse(QueryExecutorImpl.java:2725)'
    ].join('\n');
    analyze();
  }

  function build() {
    ui.input = h('textarea', { class: 'lg-textarea lg-textarea-tall', placeholder: 'Paste an error message or a full stack trace here…', spellcheck: 'false', 'aria-label': 'Error message or stack trace' });
    ui.input.addEventListener('input', function () { if (timer) clearTimeout(timer); timer = setTimeout(analyze, 250); });
    ui.context = h('div', { class: 'lg-edx-ctx', hidden: true });
    ui.results = h('div', { class: 'lg-edx-results' });

    var actions = h('div', { class: 'lg-actions' }, [
      h('button', { class: 'btn btn-primary btn-sm', type: 'button', text: 'Decode', onclick: analyze }),
      h('button', { class: 'btn btn-sm', type: 'button', text: 'Clean log prefixes', title: 'Strip the timestamp / level / node that a pasted log line carries on every visual line', onclick: function () { ui.input.value = window.edxCleanStackTrace(ui.input.value); analyze(); } }),
      h('button', { class: 'btn btn-sm', type: 'button', text: 'Example', onclick: loadExample }),
      h('button', { class: 'btn btn-sm btn-danger-outline', type: 'button', text: 'Clear', onclick: clearAll })
    ]);
    var root = h('div', { class: 'lg-tool lg-edx' }, [actions, h('div', { class: 'lg-edx-body' }, [h('div', { class: 'lg-edx-in' }, [ui.input, ui.context]), ui.results])]);
    render(window.edxDecode(''));
    return root;
  }

  L.register({
    id: 'error-decoder', label: 'Error Decoder',
    hint: 'The mechanism behind a Mendix, Java or PostgreSQL error — decoded from known signatures, never guessed.',
    build: build,
    decodeText: decodeText
  });
})();
