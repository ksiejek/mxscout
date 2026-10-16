/* MxScout — the Assist page: what an agent helped with.
 *
 * Karol, 2026-10-15: one page for the agent's help, in four tabs — Tickets
 * (a ticket checked against the model), Jira (an issue worked out from the
 * model), Ideas (a change someone wants, how it works now and the proposal)
 * and Workbook (kind "other": a larger piece of work, or any other help).
 * Any item may carry notes the person asked the agent to keep (2026-10-16):
 * what to watch out for and where in the model, grouped by topic, each a box
 * the person ticks when it is dealt with, each element it names a link. Each tab is a history list, searched and filtered by status;
 * each item opens with its sections for its kind, and the buttons that move
 * it — In progress, Close, Drop, Reopen — and a planned date. Every move is
 * written in the item's history, with who made it: the person clicking here,
 * or an agent sending an update (assist.js).
 *
 * The page is drawn in MxScout's own Assist screen by the documentation
 * reader (docs-view.js, which hands it what it draws with) — and ONLY there:
 * the reader shows the page only when MxScout hands it the items and what to
 * do on a click (opts.assist), which the exported documentation never has.
 * The exported file does not carry this file, nor any item.
 *
 * It reuses the ticket's body (docs-tickets.js) and a change's parts
 * (docs-changes.js). Text only: everything here was written by an agent or
 * pasted from a ticket, and none of it can become markup.
 */
(function () {
  'use strict';

  var KINDS = [['ticket', 'Tickets'], ['jira', 'Jira'], ['idea', 'Ideas'], ['other', 'Workbook']];
  var ONE = { ticket: 'ticket', jira: 'Jira issue', idea: 'idea', other: 'workbook item' };
  var ONE_SHORT = { ticket: 'Ticket', jira: 'Jira', idea: 'Idea', other: 'Workbook' };
  var STATUSES = [['open', 'Open'], ['in-progress', 'In progress'], ['waiting', 'Waiting'], ['done', 'Done'], ['dropped', 'Dropped']];
  var Q_STATUS = { open: 'Open', answered: 'Answered', dropped: 'Dropped' };
  var FROM = { reporter: 'Reporter', person: 'You', agent: 'Agent' };
  // Still to be dealt with: open, in progress, or waiting for the reporter.
  function live(x) { return x.status === 'open' || x.status === 'in-progress' || x.status === 'waiting'; }
  var STATUS = {};
  STATUSES.forEach(function (s) { STATUS[s[0]] = s[1]; });

  // A ticket pasted at more than this many characters or lines opens folded.
  var LONG_CHARS = 700, LONG_LINES = 10;

  function day(d) { return d ? String(d).slice(0, 10) : ''; }
  function when(d) { var s = String(d || ''); return s.length > 10 ? s.slice(0, 10) + ' ' + s.slice(11, 16) : s; }

  // kit: h, ln, list, main, setTitle, project, paragraphs, plural, flowRows, diagram, place, st (the
  // reader's state: akind, aid, aq, ast), keep (a patch of that state, kept without drawing again),
  // assist ({ items(), act(kind, id, change) → a promise }), cases ({ items() }, the solved cases — an item
  // whose solution is recorded in one links to it: "In the documentation"), and with Developer tools on risk (a
  // risk's id → its place on the Risks page, for the ticket that says it is about it).
  function draw(kit) {
    var h = kit.h, ln = kit.ln, st = kit.st, all = kit.assist.items() || [];
    var KIND = {};
    KINDS.forEach(function (k) { KIND[k[0]] = k[1]; });
    // The list's filters, kept in the reader's state: the kind (afk, '' for every kind), the words (aq), and
    // Open, Closed or All (ast; Open unless chosen). A link to an item names its kind and id (akind, aid) and
    // leaves the filters as they are.
    var fk = KIND[st.afk] ? st.afk : '';
    var fs = st.ast === 'closed' || st.ast === 'all' ? st.ast : 'open';
    // Newest first: what was handed in or moved last is at the top.
    var items = all.slice().sort(function (a, b) { return String(b.updated || '').localeCompare(String(a.updated || '')); });
    function shownBy(x, kind, status) { return (!kind || x.kind === kind) && (status === 'all' || (status === 'open') === live(x)); }
    var it = null;
    items.forEach(function (x) { if (!it && x.id === st.aid && (!st.akind || x.kind === st.akind)) it = x; });
    // Nothing chosen yet: the first item the list shows opens, so the page is never empty while there is one.
    if (!it) items.forEach(function (x) { if (!it && shownBy(x, fk, fs)) it = x; });
    if (!it && items.length) it = items[0];
    var open = all.filter(live).length;
    // The solved case an item's solution is recorded in: the note its `knowledge` names, or the one with its kind and id.
    function caseOf(x) { return kit.cases ? (kit.cases.items() || []).filter(function (c) { return c.path === x.knowledge || (c.id === x.id && c.kind === x.kind); })[0] || null : null; }

    kit.setTitle('Assist', all.length
      ? kit.plural(all.length, 'item', 'items') + ' an agent helped with, ' + open + ' of them open: tickets checked against the model, Jira issues and ideas worked out from it, and your workbook.'
      : 'What an agent helped with: tickets checked against the model, Jira issues and ideas worked out from it, and your workbook.');

    function badge(s) { return h('span', { class: 'dx-as-st ' + s, text: STATUS[s] || s }); }

    // ---- the one list, beside the page: every item, chosen by kind, searched, open or closed ----
    var sel = h('select', { class: 'dx-filter dx-modsel dx-as-kind', 'aria-label': 'Show which kind' }, [['', 'All kinds']].concat(KINDS).map(function (k) {
      var mine = all.filter(function (x) { return !k[0] || x.kind === k[0]; }), n = mine.filter(live).length;
      return h('option', { value: k[0], text: k[1] + ' · ' + mine.length + (n ? ' (' + n + ' open)' : '') });
    }));
    sel.value = fk;
    var q = h('input', { type: 'search', class: 'dx-filter dx-as-q', placeholder: 'Search — an id, a word, a flow…', 'aria-label': 'Search the items', value: st.aq || '' });
    var seg = h('div', { class: 'dx-seg dx-as-seg', role: 'group', 'aria-label': 'Open or closed' });
    var segBtns = [['open', 'Open'], ['closed', 'Closed'], ['all', 'All']].map(function (o) {
      var b = h('button', { type: 'button', 'data-show': o[0], 'aria-pressed': 'false' }, [o[1], h('i', { class: 'mono' })]);
      b.addEventListener('click', function () { fs = o[0]; kit.keep({ ast: o[0] }); apply(); });
      seg.appendChild(b);
      return b;
    });
    var rows = h('div', { class: 'dx-pl dx-as-list', role: 'list' }, items.map(function (x) {
      var on = x === it;
      var nn = (x.notes || []).filter(function (n) { return n.status !== 'dropped'; }), no = nn.filter(function (n) { return n.status === 'open'; }).length;
      var a = ln({ view: 'assist', akind: x.kind, aid: x.id }, { class: 'dx-pl-item dx-tk-item dx-as-li' + (on ? ' on' : ''), 'aria-current': on ? 'page' : null, 'data-id': x.id, 'data-kind': x.kind, 'data-status': x.status }, [
        h('span', { class: 'dx-pl-t' }, [h('b', { text: x.title }), h('small', null, [
          h('span', { class: 'dx-as-kd ' + x.kind, text: ONE_SHORT[x.kind] }), ' ', h('code', { class: 'dx-tk-id', text: x.id }), ' ', badge(x.status),
          x.kind === 'ticket' && x.verdict && window.MxDocsTickets ? window.MxDocsTickets.badge(h, x.verdict) : null,
          caseOf(x) ? h('span', { class: 'dx-as-doc', title: 'Its solution is a solved case in the documentation', text: 'in the docs' }) : null,
          nn.length ? h('span', { class: 'dx-as-nc', title: no ? no + ' of ' + nn.length + ' notes open' : 'every note done', text: (nn.length - no) + '/' + nn.length }) : null]),
          summaryOf(x) ? h('span', { class: 'dx-as-ls', text: summaryOf(x) }) : null])]);
      var row = h('div', { role: 'listitem', class: 'dx-as-lrow' }, a);
      row._x = x;
      row._find = [x.id, x.title, x.reported, x.source, summaryOf(x)].concat((x.notes || []).map(function (n) { return n.text + ' ' + (n.topic || '') + ' ' + n.refs.join(' '); })).filter(Boolean).join(' ').toLowerCase();
      return row;
    }));
    var none = h('p', { class: 'dx-as-none dx-as-lnone' });
    function apply() {
      var words = String(q.value || '').toLowerCase().split(/\s+/).filter(Boolean), shown = 0;
      segBtns.forEach(function (b) {
        var k = b.getAttribute('data-show'), on = k === fs;
        b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.querySelector('i').textContent = String(items.filter(function (x) { return shownBy(x, fk, k); }).length);
      });
      Array.prototype.forEach.call(rows.children, function (r) {
        var hide = !shownBy(r._x, fk, fs) || words.some(function (w) { return r._find.indexOf(w) === -1; });
        r.hidden = hide;
        if (!hide) shown++;
      });
      none.textContent = !items.length ? 'Nothing here yet.' : 'Nothing matches.';
      none.hidden = shown > 0;
    }
    sel.addEventListener('change', function () { fk = sel.value; kit.keep({ afk: fk || null }); apply(); });
    q.addEventListener('input', function () { kit.keep({ aq: q.value }); apply(); });
    kit.list.appendChild(h('div', { class: 'dx-list-head dx-as-head' }, [
      h('h2', null, ['Assist', h('small', { text: kit.plural(all.length, 'item', 'items') + ' · ' + open + ' open' })]), sel, q]));
    kit.list.appendChild(seg);
    kit.list.appendChild(rows);
    kit.list.appendChild(none);
    apply();
    // The open item in view in the list.
    var onRow = rows.querySelector('.dx-as-li.on');
    if (onRow && onRow.scrollIntoView) setTimeout(function () { if (onRow.isConnected) onRow.scrollIntoView({ block: 'nearest' }); }, 0);

    var wrap = h('div', { class: 'dx-pd dx-ch dx-tk dx-as' });
    if (it) one(it);
    else wrap.appendChild(h('div', { class: 'dx-note dx-as-empty', text: 'Nothing here yet. Bring a Service Desk ticket, a Jira issue or an idea to an agent with the mendix-assist skill — or tell it about a larger piece of work you are starting and ask it to keep notes as you go — through the project’s folder or while you share this project with it, and what it sends lands here.' }));
    wrap.appendChild(h('p', { class: 'dx-prov' }, [h('span', { class: 'dx-ai', title: 'Written by an AI agent from this model, not read from it', text: '✦ AI' }),
      ' Written by an agent from the model, which shows how the application is built — not what it did on a given day, nor the data it holds. Kept in this browser only: not in a package, not in the exported documentation.']));
    kit.main.appendChild(wrap);

    // ---- one item ----
    function one(x) {
      var long = x.reported && (x.reported.length > LONG_CHARS || x.reported.split('\n').length > LONG_LINES);
      var quote = x.reported ? h('blockquote', { class: 'dx-ch-asked dx-tk-rep' }, [long ? null : h('span', { class: 'dx-cap', text: x.kind === 'idea' ? 'Asked for' : 'Reported' }), h('p', { text: x.reported })]) : null;
      wrap.appendChild(h('div', { class: 'dx-pd-head' }, [
        h('span', { class: 'dx-pd-eye' }, [KIND[x.kind] + ' · ', h('code', { class: 'dx-tk-id', text: x.id }), x.source ? ' · ' + x.source : null, x.created ? ' · since ' + day(x.created) : null, x.language && x.language !== 'en' ? ' · written in ' + x.language : null, x.modelVersion ? ' · checked against the model at ' + x.modelVersion : null]),
        h('h2', { text: x.title }),
        long ? h('details', { class: 'dx-tk-fold' }, [h('summary', { text: 'As reported · ' + kit.plural(x.reported.split('\n').length, 'line', 'lines') }), quote]) : quote
      ]));
      wrap.appendChild(actions(x));
      // Two tabs on the item (Karol, 2026-10-16): Work — the notes, the solving and the conversation, what
      // matters while it is worked on — open first; Description — the descriptions of the change, entered when wanted.
      var work = h('div', { class: 'dx-as-pane', 'data-pane': 'work', role: 'tabpanel' });
      var desc = h('div', { class: 'dx-as-pane', 'data-pane': 'desc', role: 'tabpanel' });
      var openNotes = (x.notes || []).filter(function (n) { return n.status === 'open'; }).length, written = WU.filter(function (w) { return !!x[w[0]]; }).length;
      var tabs = h('div', { class: 'dx-as-itabs', role: 'tablist', 'aria-label': 'What to show' }, [
        ['work', 'Work', openNotes ? openNotes + ' open' : null], ['desc', 'Description', written ? (written === 2 ? 'business · technical' : WU.filter(function (w) { return !!x[w[0]]; })[0][1].toLowerCase()) : null]
      ].map(function (t) {
        var b = h('button', { type: 'button', role: 'tab', class: 'dx-as-itab', 'data-pane': t[0] }, [t[1], t[2] ? h('span', { class: 'dx-as-itab-n', text: t[2] }) : null]);
        b.addEventListener('click', function () { kit.keep({ apane: t[0] }); pane(t[0]); });
        return b;
      }));
      function pane(p) {
        Array.prototype.forEach.call(tabs.children, function (b) { var on = b.getAttribute('data-pane') === p; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
        work.hidden = p !== 'work'; desc.hidden = p !== 'desc';
      }
      wrap.appendChild(tabs);
      wrap.appendChild(work);
      wrap.appendChild(desc);
      desc.appendChild(writeups(x));
      pane(st.apane === 'desc' ? 'desc' : 'work');
      var nb = notes(x);
      if (nb) work.appendChild(nb);
      var kc = caseOf(x);
      if (kc || x.knowledge) {
        work.appendChild(h('p', { class: 'dx-as-case' }, kc ? [ln({ view: 'cases', cid: kc.path }, { class: 'mf-btn dx-as-case-link' }, 'In the documentation'), ' Solved case ' + kc.id + ' — ' + kc.title + ', in ', h('code', { text: kc.path })]
          : ['Its solution is recorded in ', h('code', { text: x.knowledge }), ', which is not in this project’s knowledge/ yet — commit it, or pull, and it shows here.']));
      }
      var qb = questions(x);
      if (qb) work.appendChild(qb);
      // A workbook item has no reporter until someone asks one a question: no empty conversation there.
      if (x.kind !== 'other' || (x.thread || []).length || (x.questions || []).length) work.appendChild(conversation(x));

      var parts = { h: h, ln: ln, paragraphs: kit.paragraphs, plural: kit.plural, flowRows: kit.flowRows, diagram: kit.diagram, place: kit.place, risk: kit.risk || null,
        idea: function (id) { var c = all.filter(function (y) { return y.kind === 'idea' && y.id === id; })[0]; return c ? { title: c.title, summary: c.proposal && c.proposal.summary, patch: { view: 'assist', akind: 'idea', aid: c.id } } : null; } };
      var C = window.MxDocsChanges, T = window.MxDocsTickets;
      if (x.kind === 'ticket' && T) T.body(parts, x).forEach(function (n) { work.appendChild(n); });
      // A bug's proposed fix: the proposal, the model changes it takes, and how much work it is.
      if (x.kind === 'ticket' && x.fix && C) {
        work.appendChild(h('h3', { class: 'dx-cap dx-as-fix', text: 'Proposed fix' }));
        work.appendChild(C.cols(parts, null, x.fix));
        var ft = C.modelTable(parts, x.fix.changes);
        if (ft) work.appendChild(ft);
        if (x.fix.effort) work.appendChild(h('p', { class: 'dx-ch-data' }, [h('b', { text: 'Effort. ' }), x.fix.effort]));
      }
      if (x.kind === 'jira' || x.kind === 'other') {
        if (x.summary) work.appendChild(h('section', { class: 'dx-tk-verdict' }, [h('p', { class: 'dx-ch-lead', text: x.summary })]));
        if (x.scope) work.appendChild(scope(x.scope));
        if (x.story) work.appendChild(h('section', { class: 'dx-pd-sec' }, [h('h3', { class: 'dx-cap', text: 'What the model shows' }), h('div', { class: 'dx-pd-story' }, kit.paragraphs(x.story).map(function (p) { return h('p', { text: p }); }))]));
        if (x.sources && x.sources.length) work.appendChild(h('section', { class: 'dx-pd-sec' }, [h('h3', { class: 'dx-cap', text: 'Where it looked · ' + x.sources.length }), h('ul', { class: 'dx-ch-open' }, x.sources.map(function (s) { var where = kit.place(s, 'other'); return h('li', null, where ? ln(where, { class: 'dx-code link' }, s) : h('code', { class: 'dx-code', text: s })); }))]));
      }
      if (C && (x.kind === 'idea' || ((x.kind === 'jira' || x.kind === 'other') && x.proposal && (x.proposal.summary || x.proposal.steps.length || x.proposal.changes.length)))) {
        work.appendChild(C.cols(parts, x.kind === 'idea' ? x.now : null, x.proposal));
        var table = C.modelTable(parts, x.proposal.changes);
        if (table) work.appendChild(table);
      }
      if (C && (x.kind === 'idea' || x.kind === 'jira')) { var more = C.more(parts, x); if (more) work.appendChild(more); }
      if (x.kind !== 'ticket' && x.reply && T) work.appendChild(h('section', { class: 'dx-pd-sec dx-as-reply' }, [h('h3', { class: 'dx-cap', text: 'Suggested reply' }), T.reply(h, x.reply)]));

      // ---- what happened to it ----
      if (x.history.length) {
        work.appendChild(h('section', { class: 'dx-pd-sec dx-as-history' }, [h('h3', { class: 'dx-cap', text: 'History · ' + x.history.length }),
          h('ol', { class: 'dx-as-hist' }, x.history.slice().reverse().map(function (e) {
            return h('li', null, [h('span', { class: 'mono', text: when(e.date) }), h('span', { class: 'dx-as-by ' + e.by, text: e.by === 'person' ? 'You' : 'Agent' }), h('span', { text: e.what })]);
          }))]));
      }
    }

    // A Jira issue's scope: whether it can be done, why, the modules and what it reaches in the model.
    function scope(sc) {
      var FEAS = { yes: 'Feasible', partly: 'Partly feasible', no: 'Not feasible' };
      return h('section', { class: 'dx-pd-sec dx-as-scope' }, [h('h3', { class: 'dx-cap', text: 'Scope' }),
        sc.feasible ? h('span', { class: 'dx-as-feas ' + sc.feasible, text: FEAS[sc.feasible] }) : null,
        sc.why ? h('p', { class: 'dx-ch-data', text: sc.why }) : null,
        sc.modules.length ? h('div', { class: 'dx-ch-roles' }, [h('span', { text: 'Modules' })].concat(sc.modules.map(function (m) { return h('span', { class: 'dx-ch-role', text: m }); }))) : null,
        sc.touches.length ? h('div', { class: 'dx-as-touches' }, sc.touches.map(function (qn) {
          var where = kit.place(qn, 'other');
          return where ? ln(where, { class: 'dx-code link' }, qn) : h('code', { class: 'dx-code', text: qn });
        })) : null]);
    }

    // The buttons that move it, and its planned date. Each is one click, written in its history.
    function actions(x) {
      var busy = false, msg = h('span', { class: 'dx-as-msg', role: 'status' });
      function act(change) {
        if (busy) return;
        busy = true;
        kit.assist.act(x.kind, x.id, change, x).then(function () { busy = false; }, function (err) { busy = false; msg.textContent = (err && err.message) || 'Could not save that.'; });
      }
      function btn(label, status, primary) {
        return h('button', { type: 'button', class: 'mf-btn dx-as-act' + (primary ? ' primary' : ''), 'data-status': status, text: label, onclick: function () { act({ status: status }); } });
      }
      var s = x.status, btns = [];
      if (s === 'open') btns.push(btn('In progress', 'in-progress'), btn('Waiting for the reporter', 'waiting'), btn('Close', 'done', true), btn('Drop', 'dropped'));
      else if (s === 'in-progress') btns.push(btn('Close', 'done', true), btn('Waiting for the reporter', 'waiting'), btn('Back to open', 'open'), btn('Drop', 'dropped'));
      else if (s === 'waiting') btns.push(btn('Back to open', 'open', true), btn('Close', 'done'), btn('Drop', 'dropped'));
      else btns.push(btn('Reopen', 'open', true));
      var date = h('input', { type: 'date', class: 'dx-as-date', 'aria-label': 'Planned date', value: x.planned || '' });
      date.addEventListener('change', function () { act({ planned: date.value || null }); });
      return h('div', { class: 'dx-as-bar' }, [
        h('div', { class: 'dx-as-now' }, [badge(s), x.closed && (s === 'done' || s === 'dropped') ? h('small', { text: (s === 'done' ? 'closed ' : 'dropped ') + day(x.closed) }) : null]),
        h('div', { class: 'dx-as-btns' }, btns),
        h('label', { class: 'dx-as-plan' }, [h('span', { text: 'Planned' }), date,
          x.planned ? h('button', { type: 'button', class: 'mf-btn dx-as-clear', text: 'Clear', onclick: function () { act({ planned: null }); } }) : null]),
        msg
      ]);
    }

    // The notes the person asked the agent to keep on it, by topic in the order they first came: Open,
    // Done or All (a dropped note only under All, struck through). A box ticks a note done or opens it
    // again; each element of the model it names opens where the model has it.
    function notes(x) {
      var ns = x.notes || [];
      if (!ns.length) return x.kind === 'other' ? h('section', { class: 'dx-pd-sec dx-as-notes' }, [h('h3', { class: 'dx-cap', text: 'Notes' }),
        h('p', { class: 'dx-ch-data', text: 'None yet. Ask the agent to write down what to watch out for as you work on this — and where: “note that ACT_Order_Cancel must roll back the stock” — and it lands here, for you to tick off.' })]) : null;
      var live = ns.filter(function (n) { return n.status !== 'dropped'; }), open = live.filter(function (n) { return n.status === 'open'; }).length;
      var shown = st.anf === 'done' || st.anf === 'all' ? st.anf : 'open';
      var topics = [], by = {};
      ns.forEach(function (n) { var k = n.topic || ''; if (!by[k]) { by[k] = []; topics.push(k); } by[k].push(n); });
      // Notes without a topic come first — under "General" when others have one, under no heading when none has.
      topics.sort(function (a, b) { return (a ? 1 : 0) - (b ? 1 : 0); });
      var groups = topics.map(function (k) {
        var list = h('ul', { class: 'dx-as-n-list' }, by[k].map(note));
        var left = by[k].filter(function (n) { return n.status === 'open'; }).length, all = by[k].filter(function (n) { return n.status !== 'dropped'; }).length;
        var head = k || topics.length > 1 ? h('h4', { class: 'dx-as-n-topic' }, [h('span', { text: k || 'General' }), h('span', { class: 'dx-as-n-count' + (left ? '' : ' clear'), text: left ? left + ' open' : all ? 'all done' : '' })]) : null;
        return h('div', { class: 'dx-as-n-group', 'data-topic': k }, [head, list]);
      });
      function note(n) {
        var box = h('input', { type: 'checkbox', class: 'dx-as-n-box', 'aria-label': (n.status === 'done' ? 'Done: ' : 'Mark done: ') + n.text });
        box.checked = n.status === 'done';
        box.disabled = n.status === 'dropped';
        box.addEventListener('change', function () {
          box.disabled = true;
          kit.assist.act(x.kind, x.id, { note: { id: n.id, status: box.checked ? 'done' : 'open' } }).then(null, function (e) { box.disabled = false; box.checked = !box.checked; err.textContent = (e && e.message) || 'Could not save that.'; });
        });
        return h('li', { class: 'dx-as-n ' + n.status, 'data-note': n.id, 'data-status': n.status }, [box,
          h('div', { class: 'dx-as-n-b' }, [
            h('p', { class: 'dx-as-n-t', text: n.text }),
            n.refs.length ? h('div', { class: 'dx-as-touches dx-as-n-refs' }, n.refs.map(function (qn) {
              var where = kit.place(qn, 'other');
              return where ? ln(where, { class: 'dx-code link' }, qn) : h('code', { class: 'dx-code', text: qn });
            })) : null,
            h('small', { class: 'dx-as-n-meta', text: [n.id, n.by === 'person' ? 'you' : 'agent', day(n.date), n.status === 'done' && n.done ? 'done ' + day(n.done) : null, n.status === 'dropped' ? 'dropped' : null].filter(Boolean).join(' · ') })
          ])]);
      }
      var chips = [['open', 'Open', open], ['done', 'Done', live.length - open], ['all', 'All', ns.length]].map(function (c) {
        var b = h('button', { type: 'button', class: 'dx-tk-chip dx-as-chip dx-as-n-chip', 'data-show': c[0], 'aria-pressed': 'false' }, [c[1], h('span', { class: 'mono', text: ' ' + c[2] })]);
        b.addEventListener('click', function () { shown = c[0]; kit.keep({ anf: c[0] }); apply(); });
        return b;
      });
      var none = h('p', { class: 'dx-ch-data dx-as-n-none' });
      var err = h('span', { class: 'dx-as-msg', role: 'status' });
      function apply() {
        chips.forEach(function (c) { var on = c.getAttribute('data-show') === shown; c.classList.toggle('on', on); c.setAttribute('aria-pressed', on ? 'true' : 'false'); });
        var any = false;
        groups.forEach(function (g) {
          var seen = 0;
          Array.prototype.forEach.call(g.querySelectorAll('.dx-as-n'), function (li) {
            var s = li.getAttribute('data-status'), hide = shown === 'all' ? false : s !== shown;
            li.hidden = hide;
            if (!hide) seen++;
          });
          g.hidden = !seen;
          if (seen) any = true;
        });
        none.textContent = shown === 'open' ? 'Every note is done.' : shown === 'done' ? 'None done yet.' : '';
        none.hidden = any;
      }
      // How far along it is: the notes done out of those not dropped.
      var bar = live.length ? h('div', { class: 'dx-as-n-bar', role: 'progressbar', 'aria-label': 'Notes done', 'aria-valuemin': '0', 'aria-valuemax': String(live.length), 'aria-valuenow': String(live.length - open) }, [h('span')]) : null;
      if (bar) bar.firstChild.style.width = Math.round(100 * (live.length - open) / live.length) + '%';
      var sec = h('section', { class: 'dx-pd-sec dx-as-notes' }, [
        h('div', { class: 'dx-as-sec-h' }, [h('h3', { class: 'dx-cap', text: 'Notes · ' + (open ? open + ' of ' + live.length + ' open' : live.length ? 'all ' + live.length + ' done' : 'none open') }),
          h('div', { class: 'dx-tk-chips', role: 'group', 'aria-label': 'Show notes' }, chips)]),
        bar, h('div', { class: 'dx-as-n-groups' }, groups), none, err
      ]);
      apply();
      return sec;
    }

    // The two descriptions of the change an agent writes when asked: for the business, and technical. One
    // shown at a time; each copied (for an e-mail: formatted, with plain text beside it) or downloaded as
    // HTML or Markdown — a file the browser saves, built here, sent nowhere.
    function writeups(x) {
      var has = WU.filter(function (w) { return !!x[w[0]]; });
      var sec = h('section', { class: 'dx-pd-sec dx-as-wu' });
      if (!has.length) {
        sec.appendChild(h('p', { class: 'dx-ch-data dx-as-wu-none', text: 'When the change is made, ask the agent to describe it — “write the business description of this change”, “and the technical one” — and it lands here, to copy into an e-mail or download as HTML or Markdown.' }));
        return sec;
      }
      var cur = has.some(function (w) { return w[0] === st.awu; }) ? st.awu : has[0][0];
      var seg = h('div', { class: 'dx-seg dx-as-wu-seg', role: 'group', 'aria-label': 'Which description' }, WU.map(function (w) {
        var b = h('button', { type: 'button', 'data-wu': w[0], 'aria-pressed': w[0] === cur ? 'true' : 'false', class: w[0] === cur ? 'on' : null, text: w[1] });
        b.disabled = !x[w[0]];
        b.addEventListener('click', function () { kit.keep({ awu: w[0] }); show(w[0]); });
        return b;
      }));
      var body = h('div', { class: 'dx-as-wu-body' });
      var msg = h('span', { class: 'dx-as-wu-msg', role: 'status' });
      var tools = h('div', { class: 'dx-as-wu-tools' });
      sec.appendChild(seg);
      sec.appendChild(h('div', { class: 'dx-as-wu-card' }, [tools, body]));
      function show(w) {
        cur = w;
        Array.prototype.forEach.call(seg.children, function (b) { var on = b.getAttribute('data-wu') === w; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
        while (body.firstChild) body.removeChild(body.firstChild);
        while (tools.firstChild) tools.removeChild(tools.firstChild);
        var d = x[w], name = x.id + '-' + w;
        // A workbook item's technical description carries the elements it rests on, as the model has them,
        // when it is downloaded or copied (basket.js: the context it was talked over from).
        var extra = w === 'technical' && kit.assist.appendix ? kit.assist.appendix(x) : [];
        tools.appendChild(h('span', { class: 'dx-as-wu-when', text: (w === 'business' ? 'For the business' : 'For a developer or an agent') + (d.written ? ' · written ' + day(d.written) : '') }));
        var copy = h('button', { type: 'button', class: 'mf-btn primary dx-as-wu-copy', text: w === 'business' ? 'Copy for e-mail' : 'Copy Markdown' });
        copy.addEventListener('click', function () {
          var md = asMarkdown(x, w, extra);
          function said(t) { msg.textContent = t; setTimeout(function () { msg.textContent = ''; }, 2500); }
          var c = navigator.clipboard;
          if (w === 'business' && c && c.write && window.ClipboardItem) {
            c.write([new window.ClipboardItem({ 'text/html': new Blob([asHtml(x, w, true)], { type: 'text/html' }), 'text/plain': new Blob([md], { type: 'text/plain' }) })])
              .then(function () { said('Copied — paste it into an e-mail.'); }, function () { plain(); });
          } else plain();
          function plain() {
            if (c && c.writeText) c.writeText(md).then(function () { said(w === 'business' ? 'Copied as text.' : 'Copied — paste it to an agent or a developer.'); }, function () { said('The browser would not copy it — download it instead.'); });
            else said('The browser would not copy it — download it instead.');
          }
        });
        tools.appendChild(copy);
        tools.appendChild(h('button', { type: 'button', class: 'mf-btn dx-as-wu-html', text: 'HTML', title: 'Download as an HTML file', onclick: function () { save(asHtml(x, w, false, extra), name + '.html', 'text/html'); } }));
        tools.appendChild(h('button', { type: 'button', class: 'mf-btn dx-as-wu-md', text: 'Markdown', title: 'Download as a Markdown file', onclick: function () { save(asMarkdown(x, w, extra), name + '.md', 'text/markdown'); } }));
        tools.appendChild(msg);
        if (extra.length) tools.appendChild(h('span', { class: 'dx-as-wu-when dx-as-wu-extra', text: 'With ' + kit.plural(extra.length, 'element', 'elements') + ' of the model appended' }));
        body.appendChild(h('h4', { class: 'dx-as-wu-t', text: titleOf(x, w) }));
        if (d.summary) body.appendChild(h('div', { class: 'dx-as-wu-lead' }, drawBlocks(d.summary)));
        d.sections.forEach(function (sc) {
          if (sc.heading) body.appendChild(h('h5', { class: 'dx-as-wu-h', text: sc.heading }));
          drawBlocks(sc.text).forEach(function (n) { body.appendChild(n); });
        });
      }
      function drawBlocks(text) {
        return blocks(text).map(function (b) {
          return b.list ? h('ul', { class: 'dx-as-wu-ul' }, b.list.map(function (li) { return h('li', null, inline(li)); })) : h('p', null, inline(b.p));
        });
      }
      function inline(t) { return spans(t).map(function (sp) { return sp.code ? h('code', { class: 'dx-code', text: sp.code }) : sp.text; }); }
      show(cur);
      return sec;
    }
    function save(text, fileName, mime) {
      var url = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' }));
      var a = h('a', { href: url, download: fileName, rel: 'noopener' });
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    // Questions for the reporter about what is missing: the open ones first, each with why it is asked.
    // Copy questions puts the open ones on the clipboard as plain text, to paste into the ticket — nothing
    // is sent anywhere.
    function questions(x) {
      var qs = (x.questions || []).slice();
      if (!qs.length) return null;
      var order = { open: 0, answered: 1, dropped: 2 };
      qs.sort(function (a, b) { return order[a.status] - order[b.status]; });
      var open = qs.filter(function (q) { return q.status === 'open'; });
      var text = open.map(function (q, i) { return (i + 1) + '. ' + q.text; }).join('\n');
      var copy = open.length ? h('button', { type: 'button', class: 'mf-btn dx-as-copyq', text: 'Copy questions' }) : null;
      if (copy) copy.addEventListener('click', function () {
        function said() { copy.textContent = 'Questions copied'; setTimeout(function () { copy.textContent = 'Copy questions'; }, 2000); }
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(said, function () { copy.textContent = 'Select the questions to copy them'; });
        else copy.textContent = 'Select the questions to copy them';
      });
      return h('section', { class: 'dx-pd-sec dx-as-questions' }, [
        h('div', { class: 'dx-as-sec-h' }, [h('h3', { class: 'dx-cap', text: 'Questions for the reporter · ' + (open.length ? open.length + ' open' : 'none open') }), copy]),
        h('ol', { class: 'dx-as-q-list' }, qs.map(function (q) {
          return h('li', { class: 'dx-as-qn ' + q.status, 'data-q': q.id }, [
            h('div', { class: 'dx-as-q-h' }, [h('code', { class: 'dx-tk-id', text: q.id }), h('span', { class: 'dx-as-q-t', text: q.text }),
              q.status !== 'open' ? h('span', { class: 'dx-as-qst ' + q.status, text: Q_STATUS[q.status] + (q.answered && q.status === 'answered' ? ' ' + day(q.answered) : '') }) : null]),
            q.why ? h('p', { class: 'dx-as-q-why', text: q.why }) : null
          ]);
        }))
      ]);
    }

    // The conversation with the reporter, newest last, and the way to add what they answered: pasted here,
    // the questions it answers ticked. It is written as the reporter's, and an item that was waiting goes
    // back to open, for the agent to check again.
    function conversation(x) {
      var thread = x.thread || [], openQs = (x.questions || []).filter(function (q) { return q.status === 'open'; });
      var form = h('div', { class: 'dx-as-answer', hidden: true });
      var area = h('textarea', { class: 'dx-as-answer-t', rows: '5', 'aria-label': 'The reporter’s answer', placeholder: 'Paste what the reporter answered…' });
      var ticks = openQs.map(function (q) { var b = h('input', { type: 'checkbox', value: q.id }); return [b, h('label', { class: 'dx-as-tick' }, [b, ' ', h('code', { class: 'dx-tk-id', text: q.id }), ' ' + q.text])]; });
      var err = h('span', { class: 'dx-as-msg', role: 'status' });
      var add = h('button', { type: 'button', class: 'mf-btn dx-as-add', text: 'Add the reporter’s answer', onclick: function () { form.hidden = false; add.hidden = true; area.focus(); } });
      var save = h('button', { type: 'button', class: 'mf-btn primary dx-as-act dx-as-save', text: 'Add to the conversation', onclick: function () {
        var text = area.value.trim();
        if (!text) { err.textContent = 'Paste the answer first.'; return; }
        var answers = ticks.filter(function (t) { return t[0].checked; }).map(function (t) { return t[0].value; });
        save.disabled = true;
        kit.assist.act(x.kind, x.id, { answer: { text: text, answers: answers } }).then(null, function (e) { save.disabled = false; err.textContent = (e && e.message) || 'Could not save that.'; });
      } });
      var cancel = h('button', { type: 'button', class: 'mf-btn', text: 'Cancel', onclick: function () { form.hidden = true; add.hidden = false; } });
      [area, ticks.length ? h('div', { class: 'dx-as-ticks' }, [h('span', { class: 'dx-cap', text: 'It answers' })].concat(ticks.map(function (t) { return t[1]; }))) : null,
        h('div', { class: 'dx-as-form-btns' }, [save, cancel]), err].forEach(function (n) { if (n) form.appendChild(n); });
      return h('section', { class: 'dx-pd-sec dx-as-thread' }, [
        h('h3', { class: 'dx-cap', text: 'Conversation' + (thread.length ? ' · ' + thread.length : '') }),
        thread.length ? h('ol', { class: 'dx-as-th' }, thread.map(function (e) {
          return h('li', { class: 'dx-as-th-e ' + e.from }, [
            h('div', { class: 'dx-as-th-h' }, [h('span', { class: 'dx-as-by ' + e.from, text: FROM[e.from] || e.from }), h('span', { class: 'mono', text: when(e.date) }),
              e.answers && e.answers.length ? h('small', { text: 'answers ' + e.answers.join(', ') }) : null]),
            h('p', { class: 'dx-as-th-t', text: e.text })
          ]);
        })) : h('p', { class: 'dx-ch-data', text: 'Nothing yet. When the reporter answers, paste it here; the agent reads it when it checks the item again.' }),
        add, form
      ]);
    }
  }

  // ---- the descriptions as text, HTML and Markdown (pure, so they are checked on their own) ----
  var WU = [['business', 'Business'], ['technical', 'Technical']];
  // A text's blocks: paragraphs (a blank line between) and lists (lines starting "- ").
  function blocks(text) {
    var out = [];
    String(text || '').replace(/\r\n/g, '\n').split(/\n[ \t]*\n/).forEach(function (para) {
      var cur = null;
      para.split('\n').forEach(function (l) {
        var m = /^\s*[-•*]\s+(.*)$/.exec(l);
        if (m) { if (!cur || !cur.list) { cur = { list: [] }; out.push(cur); } cur.list.push(m[1].trim()); }
        else if (l.trim()) { if (!cur || cur.list) { cur = { p: l.trim() }; out.push(cur); } else cur.p += ' ' + l.trim(); }
      });
    });
    return out;
  }
  // `Module.Name` in a text is a name in the model: drawn as code, kept as `…` in Markdown.
  function spans(t) {
    var out = [];
    String(t).split(/`([^`\n]+)`/).forEach(function (part, i) { if (part) out.push(i % 2 ? { code: part } : { text: part }); });
    return out;
  }
  var KIND_NAME = { ticket: 'Ticket', jira: 'Jira issue', idea: 'Idea', other: 'Workbook' };
  function titleOf(x, w) { var d = x[w]; return (d && d.title) || x.title; }
  function metaOf(x, w) { var d = x[w]; return [w === 'business' ? 'Business description' : 'Technical description', KIND_NAME[x.kind] + ' ' + x.id, d && d.written ? day(d.written) : null].filter(Boolean).join(' · '); }
  // extra: the elements of the model appended to it — [{ qn, word, text }], text as the AI pack writes it.
  var EXTRA_LEAD = 'The elements this rests on, as MxScout read them from the Mendix model. E entity, MF microflow, NF nanoflow, PG page; {member=value} is the data a step sets or passes; → owns an association to, ← is owned by; "access <module role>:" is what that role may do; #xxxxxxxx is a fingerprint to ignore.';
  function asMarkdown(x, w, extra) {
    var d = x[w], out = ['# ' + titleOf(x, w), '', '*' + metaOf(x, w) + '*', ''];
    function add(text) { blocks(text).forEach(function (b) { out.push(b.list ? b.list.map(function (li) { return '- ' + li; }).join('\n') : b.p, ''); }); }
    if (d.summary) add(d.summary);
    d.sections.forEach(function (sc) { if (sc.heading) out.push('## ' + sc.heading, ''); add(sc.text); });
    if (extra && extra.length) {
      out.push('## From the model', '', '*' + EXTRA_LEAD + '*', '');
      extra.forEach(function (e) { out.push('### ' + e.word + ' `' + e.qn + '`', '', '```text', e.text.replace(/```/g, "'''"), '```', ''); });
    }
    return out.join('\n').replace(/\n+$/, '') + '\n';
  }
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  // forMail: a fragment with its styles on each element (mail programs drop a <style>); otherwise a whole page.
  function asHtml(x, w, forMail, extra) {
    var d = x[w];
    var S = forMail ? {
      wrap: ' style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#1d1f24;max-width:720px"',
      h1: ' style="font-size:20px;line-height:1.3;margin:0 0 4px"', meta: ' style="color:#6b7080;font-size:12px;margin:0 0 14px"',
      lead: ' style="background:#f3f6ff;border-left:3px solid #3d63dd;padding:10px 14px;margin:0 0 6px"', h2: ' style="font-size:15px;margin:20px 0 6px"',
      p: ' style="margin:0 0 10px"', ul: ' style="margin:0 0 10px;padding-left:20px"', code: ' style="font-family:Consolas,Menlo,monospace;font-size:12.5px;background:#f2f3f5;padding:1px 4px;border-radius:3px"'
    } : { wrap: '', h1: '', meta: ' class="meta"', lead: ' class="lead"', h2: '', p: '', ul: '', code: '' };
    function inl(t) { return spans(t).map(function (sp) { return sp.code ? '<code' + S.code + '>' + esc(sp.code) + '</code>' : esc(sp.text); }).join(''); }
    function blk(text) { return blocks(text).map(function (b) { return b.list ? '<ul' + S.ul + '>' + b.list.map(function (li) { return '<li>' + inl(li) + '</li>'; }).join('') + '</ul>' : '<p' + S.p + '>' + inl(b.p) + '</p>'; }).join('\n'); }
    var body = ['<h1' + S.h1 + '>' + esc(titleOf(x, w)) + '</h1>', '<p' + S.meta + '>' + esc(metaOf(x, w)) + '</p>'];
    if (d.summary) body.push('<div' + S.lead + '>' + blk(d.summary) + '</div>');
    d.sections.forEach(function (sc) { if (sc.heading) body.push('<h2' + S.h2 + '>' + esc(sc.heading) + '</h2>'); body.push(blk(sc.text)); });
    // The model's part goes into the page, not into an e-mail (forMail), where it would bury the text.
    if (!forMail && extra && extra.length) {
      body.push('<section class="model"><h2>From the model</h2>', '<p class="meta">' + esc(EXTRA_LEAD) + '</p>');
      extra.forEach(function (e) { body.push('<h3>' + esc(e.word) + ' <code>' + esc(e.qn) + '</code></h3>', '<pre>' + esc(e.text) + '</pre>'); });
      body.push('</section>');
    }
    if (forMail) return '<div' + S.wrap + '>\n' + body.join('\n') + '\n</div>';
    return ['<!doctype html>', '<html lang="' + esc(x.language || 'en') + '">', '<head>', '<meta charset="utf-8">', '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<title>' + esc(titleOf(x, w)) + '</title>',
      '<style>body{font:15px/1.6 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1d1f24;background:#fff;max-width:760px;margin:40px auto;padding:0 20px}' +
      'h1{font-size:26px;line-height:1.25;margin:0 0 6px}.meta{color:#6b7080;font-size:13px;margin:0 0 22px}' +
      '.lead{font-size:16.5px;background:#f3f6ff;border-left:3px solid #3d63dd;padding:12px 16px;border-radius:6px}.lead p:last-child{margin-bottom:0}' +
      'h2{font-size:17px;margin:28px 0 8px}h3{font-size:14.5px;margin:20px 0 6px}.model{margin-top:40px;padding-top:8px;border-top:1px solid #e3e5ea}' +
      'pre{font:12.5px/1.5 ui-monospace,Menlo,Consolas,monospace;background:#f6f7f9;border:1px solid #e3e5ea;border-radius:6px;padding:10px 12px;white-space:pre-wrap;word-break:break-word;margin:0 0 12px}' +
      'ul{padding-left:22px}li{margin:3px 0}code{font:13px ui-monospace,Menlo,Consolas,monospace;background:#f2f3f5;padding:1px 5px;border-radius:4px}' +
      'footer{margin-top:40px;padding-top:12px;border-top:1px solid #e3e5ea;color:#8a8f9c;font-size:12px}' +
      '@media (prefers-color-scheme: dark){body{background:#16171b;color:#e6e7ea}.lead{background:#1c2236}code{background:#24262c}pre{background:#1d1f24;border-color:#2c2f36}.model{border-color:#2c2f36}.meta,footer{color:#9a9fab}footer{border-color:#2c2f36}}</style>',
      '</head>', '<body>', body.join('\n'), '<footer>Written by an AI agent from the Mendix model; check it before you send it on.</footer>', '</body>', '</html>', ''].join('\n');
  }

  function summaryOf(x) {
    if (x.kind === 'idea') return (x.proposal && x.proposal.summary) || (x.now && x.now.summary) || null;
    return x.summary || null;
  }

  window.MxDocsAssist = { draw: draw, KINDS: KINDS, STATUS: STATUS, asMarkdown: asMarkdown, asHtml: asHtml, blocks: blocks };
})();
