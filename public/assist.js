/* MxScout — Assist: what an agent helped with, kept as items with a status.
 *
 * Karol, 2026-10-15: a page "Assist" — the agent's help — with tabs Tickets,
 * Jira, Ideas and Workbook (kind "other": shown as Workbook since 2026-10-16,
 * kept as "other" in files and envelopes, so nothing written before moves). A ticket an agent checked against the model, a Jira
 * issue it worked out, an idea for a change, anything else: each is an item
 * with a status (open, in progress, waiting for the reporter, done,
 * dropped), a planned date when someone gave it one, and a history of who
 * moved it and when. It may carry questions for the reporter about what is
 * missing, and the conversation with them (append-only): the person pastes
 * the reporter's answer, the agent checks again. The person moves an item by
 * clicking; an agent by sending an update.
 *
 * Any item may also carry two descriptions of the change, written by an agent
 * when the person asks (Karol, 2026-10-16): one for the business — plain
 * words, with the technical details a person with basic technical knowledge
 * follows — and a technical one, for a developer or another agent. The page
 * shows them, copies them (for an e-mail) and downloads them as HTML or
 * Markdown; they are never sent anywhere.
 *
 * Every kind may also carry notes (Karol, 2026-10-16): what the person asked
 * the agent to write down while they work on it — what to watch out for, and
 * where in the model. An agent adds them; the person ticks them done. A note is
 * never lost: an item written again keeps every note it had.
 *
 * Items are a LOCAL base. They live in this browser's database (the `assist`
 * store, through store.js), one record per project. They are never in the
 * .mxscout package (transfer.js carries the model and the descriptions, and
 * nothing here), never in the exported documentation or its Markdown copy
 * (docs-view.js draws the Assist page only when MxScout hands it the items,
 * which the export never does). The one place they go is the documentation an
 * agent reads (docs-file.js forAgent), as a short list — id, kind, title,
 * status, planned date — so the agent knows what is open and what is closed.
 *
 * The agent hands items in as an envelope:
 *   { "format": "mxscout-assist", "version": 1, "items": [ … ] }
 * An item with an id already kept (of the same kind) replaces it; its history
 * and its conversation are appended to, never lost. An entry with only
 * { id, kind, status?, planned?, note?, thread?, questions?, notes? } moves an item
 * without rewriting it: thread entries appended, questions and notes changed by id. parseEnvelope checks
 * it the same way whichever way it came — the agent channel, an import, a
 * project folder's inbox — and keeps only what it understands, as text.
 *
 * The tickets and changes an older descriptions file carried move here
 * (migrate): a ticket to Tickets, a change to Ideas.
 */
(function () {
  'use strict';

  var FORMAT = 'mxscout-assist';
  var VERSION = 1;
  var KINDS = ['ticket', 'jira', 'idea', 'other'];
  var KIND_LABEL = { ticket: 'Tickets', jira: 'Jira', idea: 'Ideas', other: 'Workbook' };
  var KIND_ONE = { ticket: 'ticket', jira: 'Jira issue', idea: 'idea', other: 'workbook item' };
  var KIND_MANY = { ticket: 'tickets', jira: 'Jira issues', idea: 'ideas', other: 'workbook items' };
  // waiting: waiting for the reporter, to answer the questions asked of them.
  var STATUSES = ['open', 'in-progress', 'waiting', 'done', 'dropped'];
  var STATUS_LABEL = { open: 'Open', 'in-progress': 'In progress', waiting: 'Waiting for the reporter', done: 'Done', dropped: 'Dropped' };
  var Q_STATUS = { open: true, answered: true, dropped: true };
  var FROM = { reporter: true, person: true, agent: true };
  var MAX_ITEMS = 2000, MAX_HISTORY = 200, MAX_QUESTIONS = 60, MAX_THREAD = 500, MAX_NOTES = 500;
  var N_STATUS = { open: true, done: true, dropped: true };
  var ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
  // A ticket's or a Jira issue's id is the tracker's key as given (a leading # dropped), with a digit in it;
  // an idea's and other help's is a slug (skills/mendix-assist/reference/assist-format.md, "Every item").
  var SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  var LANG = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;
  // Where a project folder keeps each kind (assist/<folder>/<id>.json).
  var FOLDER = { ticket: 'tickets', jira: 'jira', idea: 'ideas', other: 'other' };
  var KIND_OF_FOLDER = { tickets: 'ticket', jira: 'jira', ideas: 'idea', other: 'other' };
  function idOf(raw, kind) {
    var v = typeof raw === 'string' ? raw.trim() : '';
    if (kind === 'ticket' || kind === 'jira') { v = v.replace(/^#/, ''); return v.length <= 80 && ID.test(v) && /\d/.test(v) ? v : null; }
    return v.length <= 80 && SLUG.test(v) ? v : null;
  }
  function langOf(v) { return typeof v === 'string' && LANG.test(v.trim()) ? v.trim() : null; }
  // The case note an item's solution was recorded in (repodocs.js, the solved cases): knowledge/<id>-<slug>.md.
  var KNOWLEDGE = /^knowledge\/[A-Za-z0-9][A-Za-z0-9._-]*\.md$/;
  function knowledgeOf(v) { return typeof v === 'string' && v.length <= 200 && KNOWLEDGE.test(v.trim()) && v.indexOf('..') === -1 ? v.trim() : null; }
  var DAY = /^\d{4}-\d{2}-\d{2}$/;

  var store = null;
  var appendixOf = null; // (projectId, item) → the elements its sources name, as the model has them (basket.js), for its exports
  var rows = {};       // projectId -> the record { projectId, items, migrated, updatedAt }, null when none, undefined while it loads
  var loading = {};    // projectId -> the promise of its read
  var watchers = [];

  // api: { store, onChange(projectId), appendix(projectId, item) } — app.js.
  function init(api) {
    store = api.store;
    appendixOf = api.appendix || null;
    if (api.onChange) watchers.push(api.onChange);
    // Another tab saved a project's items: read them again, so this one draws — and changes — what is kept now.
    if (store.onOtherTab) store.onOtherTab(function (name, projectId) { if (name === 'assist' && Object.prototype.hasOwnProperty.call(rows, projectId)) reload(projectId); });
  }
  function tell(projectId) { watchers.forEach(function (fn) { try { fn(projectId); } catch (e) { /* the watcher's own problem */ } }); }
  function now() { return new Date().toISOString(); }
  function clone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }
  function isKind(k) { return KINDS.indexOf(k) !== -1; }
  function isStatus(s) { return STATUSES.indexOf(s) !== -1; }
  function P() { return window.MxDescribe.parts; }

  // ---------- one item ----------
  function historyOf(list) {
    var str = P().str;
    return (Array.isArray(list) ? list : []).slice(-MAX_HISTORY).map(function (h) {
      if (!h || typeof h !== 'object' || !str(h.what, 500)) return null;
      return { date: str(h.date, 40) || null, what: str(h.what, 500), by: h.by === 'person' ? 'person' : 'agent' };
    }).filter(Boolean);
  }
  function plannedOf(v) { return typeof v === 'string' && DAY.test(v.trim()) ? v.trim() : null; }
  // Questions to ask the reporter about what is missing: { id, text, why, status, asked, answered }.
  // partial: a change to questions already kept (an update), where only the id is required.
  function questionOf(q, i, partial) {
    var str = P().str;
    if (!q || typeof q !== 'object') return null;
    var id = str(q.id, 40) || (partial ? null : 'q' + (i + 1));
    if (!id || !ID.test(id)) return null;
    var x = { id: id, text: str(q.text, 1000), why: str(q.why, 1000), status: Q_STATUS[q.status] === true ? q.status : (partial ? null : 'open'),
      asked: str(q.asked, 40), answered: str(q.answered, 40) };
    if (!partial && !x.text) return null;
    return x;
  }
  function questionsOf(list, partial) {
    var seen = {};
    return (Array.isArray(list) ? list : []).slice(0, MAX_QUESTIONS).map(function (q, i) { return questionOf(q, i, partial); })
      .filter(function (q) { if (!q || seen[q.id]) return false; seen[q.id] = true; return true; });
  }
  // The conversation with the reporter, append-only: { date, from: reporter|person|agent, text, answers: [question ids] }.
  function threadOf(list) {
    var str = P().str;
    return (Array.isArray(list) ? list : []).slice(-MAX_THREAD).map(function (e) {
      if (!e || typeof e !== 'object' || !str(e.text, 8000)) return null;
      return { date: str(e.date, 40) || null, from: FROM[e.from] === true ? e.from : 'agent', text: str(e.text, 8000),
        answers: (Array.isArray(e.answers) ? e.answers : []).slice(0, MAX_QUESTIONS).map(function (a) { return str(a, 40); }).filter(Boolean) };
    }).filter(Boolean);
  }
  // A description of the change: { title, written, summary, sections: [{ heading, text }] } — text only; a
  // text's paragraphs are separated by a blank line, and lines starting "- " are a list.
  var WRITEUPS = ['business', 'technical'];
  var WRITEUP_NAME = { business: 'Business description', technical: 'Technical description' };
  function writeupOf(v) {
    var str = P().str;
    if (!v || typeof v !== 'object') return null;
    var x = { title: str(v.title, 200), written: str(v.written, 40), summary: str(v.summary, 3000),
      sections: (Array.isArray(v.sections) ? v.sections : []).slice(0, 40).map(function (sec) {
        return sec && typeof sec === 'object' && str(sec.text, 12000) ? { heading: str(sec.heading, 200), text: str(sec.text, 12000) } : null;
      }).filter(Boolean) };
    return x.summary || x.sections.length ? x : null;
  }

  // Notes kept on an item: { id, text, topic, refs: [qualified names], status: open|done|dropped, by, date, done }.
  // partial: a change to notes already kept (an update), where a note is found by its id and carries only
  // what changes — its text, topic, refs or status; one without an id is a new note.
  function noteOf(n, partial) {
    var p = P(), str = p.str;
    if (!n || typeof n !== 'object') return null;
    var id = str(n.id, 40);
    if (id && !ID.test(id)) return null;
    var x = { id: id, text: str(n.text, 2000), topic: str(n.topic, 80), refs: Array.isArray(n.refs) ? p.texts(n.refs, 300, 20) : (partial ? null : []),
      status: N_STATUS[n.status] === true ? n.status : (partial ? null : 'open'), by: n.by === 'person' ? 'person' : 'agent', date: str(n.date, 40), done: str(n.done, 40) };
    if (!partial && !x.text) return null;
    if (!partial && x.status !== 'done') x.done = null;
    return x;
  }
  function notesOf(list) {
    var seen = {}, out = (Array.isArray(list) ? list : []).slice(0, MAX_NOTES).map(function (n) { return noteOf(n, false); })
      .filter(function (n) { if (!n || (n.id && seen[n.id])) return false; if (n.id) seen[n.id] = true; return true; });
    // Numbered when kept (apply, mergeNotes) — against the notes the item already has, not this copy's alone.
    return out;
  }
  // A note sent without an id gets the first free one of n1, n2, … — free among the ids the item has.
  function numberNotes(list, kept) {
    var taken = {}, next = 1;
    kept.concat(list).forEach(function (n) { if (n.id) taken[n.id] = true; });
    list.forEach(function (n) {
      if (n.id) return;
      while (taken['n' + next]) next++;
      n.id = 'n' + next;
      taken[n.id] = true;
    });
    return list;
  }
  // Notes added or changed, by id: a new one with a text is added; one kept takes the text, topic and refs
  // sent, and — unless keepStatus (an item written again whole, whose copy may be older than a tick the
  // person made since) — the status. A note is never removed: one no longer wanted is dropped.
  // → [what was said], for the history.
  function mergeNotes(it, list, at, keepStatus) {
    it.notes = it.notes || [];
    numberNotes(list, it.notes);
    var added = 0, edited = 0, moved = [];
    list.forEach(function (n) {
      var old = null;
      it.notes.forEach(function (x) { if (x.id === n.id) old = x; });
      if (!old) {
        if (!n.text || it.notes.length >= MAX_NOTES) return;
        var st = n.status || 'open';
        it.notes.push({ id: n.id, text: n.text, topic: n.topic || null, refs: n.refs || [], status: st, by: n.by || 'agent', date: n.date || at, done: st === 'done' ? n.done || at : null });
        added++;
        return;
      }
      var was = JSON.stringify([old.text, old.topic, old.refs]);
      if (n.text) old.text = n.text;
      if (n.topic) old.topic = n.topic;
      // An item written again whole says nothing by an empty list: the refs kept stay. An update may clear them.
      if (n.refs && (n.refs.length || !keepStatus)) old.refs = n.refs;
      if (JSON.stringify([old.text, old.topic, old.refs]) !== was) edited++;
      if (!keepStatus && n.status && n.status !== old.status) {
        old.status = n.status;
        old.done = n.status === 'done' ? n.done || at : null;
        moved.push(old.id + ' ' + n.status);
      }
    });
    var said = [];
    if (added) said.push(added === 1 ? 'one note added' : added + ' notes added');
    if (edited) said.push(edited === 1 ? 'one note changed' : edited + ' notes changed');
    if (moved.length) said.push('notes: ' + moved.join(', '));
    return said;
  }
  function entryKey(e) { return (e.date || '') + '|' + e.from + '|' + e.text; }
  // Entries added to a thread: the ones it does not have yet, at its end. Nothing in it is ever dropped.
  function appendThread(it, entries, at) {
    var seen = {}, added = 0;
    it.thread.forEach(function (e) { seen[entryKey(e)] = true; });
    entries.forEach(function (e) {
      var x = { date: e.date || at, from: e.from, text: e.text, answers: e.answers || [] };
      if (seen[entryKey(x)]) return;
      seen[entryKey(x)] = true;
      it.thread.push(x);
      added++;
      // An entry that says which questions it answers marks them answered.
      x.answers.forEach(function (qid) { (it.questions || []).forEach(function (q) { if (q.id === qid && q.status === 'open') { q.status = 'answered'; q.answered = x.date; } }); });
    });
    it.thread = it.thread.slice(-MAX_THREAD);
    return added;
  }
  // Questions changed or added: by id, what the change gives replaces what is kept; a new id with a text is added.
  function mergeQuestions(it, list, at) {
    var said = [];
    list.forEach(function (q) {
      var old = null;
      it.questions.forEach(function (x) { if (x.id === q.id) old = x; });
      if (!old) {
        if (!q.text) return;
        it.questions.push({ id: q.id, text: q.text, why: q.why, status: q.status || 'open', asked: q.asked || at, answered: q.answered || (q.status === 'answered' ? at : null) });
        said.push('asked ' + q.id);
        return;
      }
      if (q.text) old.text = q.text;
      if (q.why) old.why = q.why;
      if (q.status && q.status !== old.status) {
        old.status = q.status;
        if (q.status === 'answered') old.answered = q.answered || at;
        said.push(q.id + ' ' + q.status);
      }
    });
    it.questions = it.questions.slice(0, MAX_QUESTIONS);
    return said;
  }

  // A whole item: the fields every kind has, then its own. null with a reason when it cannot be kept.
  // `given` says which of status and planned the entry itself set, so an agent that rewrites an item
  // without them leaves where the person put it alone.
  // loose: an item moved from an older descriptions file, whose ticket keys were not held to a digit.
  function itemOf(raw, defaultLang, loose) {
    var p = P(), str = p.str, texts = p.texts;
    if (!raw || typeof raw !== 'object') return { error: 'not an object' };
    var kind = raw.kind, id = !isKind(kind) ? str(raw.id, 80) : loose ? (ID.test(str(raw.id, 80) || '') ? str(raw.id, 80) : null) : idOf(raw.id, kind);
    if (!isKind(kind)) return { error: (id || 'an item') + ': "kind" must be one of ' + KINDS.join(', ') };
    if (!id) return { error: 'no usable "id"' + (kind === 'ticket' || kind === 'jira' ? ' (the tracker’s key, with a digit in it)' : ' (a slug: lower-case letters, digits and hyphens)') };
    var title = str(raw.title, 200);
    if (!title) return { error: id + ': no "title"' };
    var it = {
      id: id, kind: kind, title: title, reported: str(raw.reported, 8000), source: str(raw.source, 300),
      created: str(raw.created, 40), updated: str(raw.updated, 40),
      status: isStatus(raw.status) ? raw.status : 'open', planned: plannedOf(raw.planned), closed: str(raw.closed, 40),
      history: historyOf(raw.history), questions: questionsOf(raw.questions), thread: threadOf(raw.thread), notes: notesOf(raw.notes),
      language: langOf(raw.language) || defaultLang || 'en', reply: str(raw.reply, 4000)
    };
    // The model version the agent checked it against ("main @ a1b2c3d", or a commit), when it says — optional, text.
    if (str(raw.modelVersion, 120)) it.modelVersion = str(raw.modelVersion, 120);
    WRITEUPS.forEach(function (w) { var x = writeupOf(raw[w]); if (x) it[w] = x; });
    // Where its solution is written down for the next one (a solved case in knowledge/), when it is — optional.
    if (knowledgeOf(raw.knowledge)) it.knowledge = knowledgeOf(raw.knowledge);
    if (kind === 'ticket') {
      it.verdict = p.VERDICTS[raw.verdict] === true ? raw.verdict : null;
      it.confidence = p.CONFIDENCE[raw.confidence] === true ? raw.confidence : (it.verdict ? 'low' : null);
      it.summary = str(raw.summary, 2000); it.story = str(raw.story, p.STORY_MAX);
      it.traced = p.traced(raw.traced); it.evidence = p.evidence(raw.evidence);
      it.needs = texts(raw.needs, 1000, 30);
      // For a bug, the proposed fix: a proposal and how much work it is.
      it.fix = raw.fix && typeof raw.fix === 'object' ? Object.assign(p.proposal(raw.fix), { effort: str(raw.fix.effort, 300) }) : null;
      // A change that would fix it — an idea on this page, by its id — and the risks it found (a ticket moved from an older file).
      var ch = str(raw.change, 80);
      it.change = ch && ID.test(ch) ? ch : null;
      it.risks = p.risks(raw.risks);
      // The known risk this ticket is about (the risk triage (Developer tools)), by its id — read as describe.js reads it there.
      it.risk = p.riskRef ? p.riskRef(raw.risk) : str(raw.risk, 80);
    } else if (kind === 'jira') {
      it.summary = str(raw.summary, 2000); it.story = str(raw.story, p.STORY_MAX); it.scope = scopeOf(raw.scope);
      it.proposal = p.proposal(raw.proposal); it.impact = p.impact(raw.impact); it.risks = p.risks(raw.risks);
      it.open = texts(raw.open, 1000, 30); it.effort = str(raw.effort, 300);
    } else if (kind === 'idea') {
      it.now = p.now(raw.now); it.proposal = p.proposal(raw.proposal); it.impact = p.impact(raw.impact); it.risks = p.risks(raw.risks);
      it.open = texts(raw.open, 1000, 30); it.effort = str(raw.effort, 300);
    } else {
      it.summary = str(raw.summary, 2000); it.story = str(raw.story, p.STORY_MAX); it.sources = texts(raw.sources, 300, 40);
      it.proposal = raw.proposal && typeof raw.proposal === 'object' ? p.proposal(raw.proposal) : null;
    }
    if (it.status !== 'done' && it.status !== 'dropped') it.closed = null;
    // The questions whose status the entry gave: a question it lists without one keeps the status kept.
    var qGiven = {};
    (Array.isArray(raw.questions) ? raw.questions : []).forEach(function (q) { if (q && Q_STATUS[q.status] === true && typeof q.id === 'string') qGiven[q.id] = true; });
    return { item: it, given: { status: isStatus(raw.status), planned: Object.prototype.hasOwnProperty.call(raw, 'planned'), questions: qGiven } };
  }

  // A Jira issue's scope: { feasible: yes|partly|no, why, modules[], touches[] } — or, written as text, the why alone.
  var FEASIBLE = { yes: true, partly: true, no: true };
  function scopeOf(v) {
    var p = P();
    if (typeof v === 'string') return p.str(v, 4000) ? { feasible: null, why: p.str(v, 4000), modules: [], touches: [] } : null;
    if (!v || typeof v !== 'object') return null;
    var x = { feasible: FEASIBLE[v.feasible] === true ? v.feasible : null, why: p.str(v.why, 2000), modules: p.texts(v.modules, 120, 40), touches: p.texts(v.touches, 300, 80) };
    return x.feasible || x.why || x.modules.length || x.touches.length ? x : null;
  }

  // An update: "update": true with the item's id and kind, and only what changed — updated, status,
  // planned, closed, new history and thread entries, and questions (a new one whole; one kept, its id,
  // status and answered). Anything else is an error: the whole item is sent instead. → { update } or
  // { error }, or null when it is not an update.
  var UPDATE_KEYS = { id: 1, kind: 1, update: 1, updated: 1, status: 1, planned: 1, closed: 1, history: 1, thread: 1, questions: 1, notes: 1, knowledge: 1, business: 1, technical: 1 };
  function updateOf(raw) {
    var str = P().str;
    if (!raw || typeof raw !== 'object' || raw.update !== true) return null;
    var kind = raw.kind, id = isKind(kind) ? idOf(raw.id, kind) : null;
    if (!isKind(kind)) return { error: 'an update: "kind" must be one of ' + KINDS.join(', ') };
    if (!id) return { error: 'an update: no usable "id"' };
    var extra = Object.keys(raw).filter(function (k) { return !UPDATE_KEYS[k]; });
    if (extra.length) return { error: id + ': an update carries only what changed — ' + extra.map(function (k) { return '"' + k + '"'; }).join(', ') + ' is not one of its fields; send the whole item instead' };
    var u = { id: id, kind: kind, updated: str(raw.updated, 40) };
    if (raw.status !== undefined) { if (!isStatus(raw.status)) return { error: id + ': "status" must be one of ' + STATUSES.join(', ') }; u.status = raw.status; }
    if (Object.prototype.hasOwnProperty.call(raw, 'planned')) {
      if (raw.planned !== null && raw.planned !== '' && !plannedOf(raw.planned)) return { error: id + ': "planned" must be an ISO date' };
      u.planned = plannedOf(raw.planned);
    }
    if (str(raw.closed, 40)) u.closed = str(raw.closed, 40);
    if (raw.knowledge !== undefined) {
      if (raw.knowledge !== null && !knowledgeOf(raw.knowledge)) return { error: id + ': "knowledge" must be the case note’s path, knowledge/<id>-<slug>.md' };
      u.knowledge = knowledgeOf(raw.knowledge);
    }
    var hs = historyOf(raw.history), th = threadOf(raw.thread), qs = [], qerr = null;
    (Array.isArray(raw.questions) ? raw.questions : []).slice(0, MAX_QUESTIONS).forEach(function (q) {
      if (qerr || !q || typeof q !== 'object') return;
      if (str(q.text, 1000)) { var nq = questionOf(q, qs.length, true); if (nq) qs.push(nq); return; }
      var bad = Object.keys(q).filter(function (k) { return k !== 'id' && k !== 'status' && k !== 'answered'; });
      if (bad.length) { qerr = id + ': a question kept is changed by its id, status and answered alone — or sent whole, with its text'; return; }
      var pq = questionOf(q, qs.length, true);
      if (pq) qs.push(pq);
    });
    if (qerr) return { error: qerr };
    // Notes: a new one with its text (and no id, or one of its own); one kept by its id, with what changes.
    var ns = [], nerr = null;
    (Array.isArray(raw.notes) ? raw.notes : []).slice(0, MAX_NOTES).forEach(function (n) {
      if (nerr) return;
      var x = noteOf(n, true);
      if (!x || (!x.id && !x.text)) { nerr = id + ': a note is sent with its text (a new one) or with its id and what changes (one kept)'; return; }
      ns.push(x);
    });
    if (nerr) return { error: nerr };
    if (ns.length) u.notes = ns;
    // A description, whole, in the place of the one kept; null takes it away.
    var werr = null;
    WRITEUPS.forEach(function (w) {
      if (werr || raw[w] === undefined) return;
      if (raw[w] === null) { u[w] = null; return; }
      var x = writeupOf(raw[w]);
      if (!x) { werr = id + ': "' + w + '" needs a summary or at least one section with a text'; return; }
      u[w] = x;
    });
    if (werr) return { error: werr };
    if (hs.length) u.history = hs;
    if (th.length) u.thread = th;
    if (qs.length) u.questions = qs;
    return { update: u };
  }

  // ---------- the envelope ----------
  function isEnvelope(text) {
    if (text && typeof text === 'object') return text.format === FORMAT;
    return typeof text === 'string' && /"format"\s*:\s*"mxscout-assist"/.test(text.slice(0, 4000));
  }
  // text: the envelope as JSON (or already read into an object). → { value: { items, updates, dropped } } or { error }.
  // Whatever it says is data to show, never markup and never instructions.
  function parseEnvelope(text) {
    var raw = text;
    if (typeof text === 'string') { try { raw = JSON.parse(text); } catch (e) { return { error: 'That is not JSON.' }; } }
    if (!raw || typeof raw !== 'object' || raw.format !== FORMAT) return { error: 'That is not an Assist file — it should say "format": "' + FORMAT + '".' };
    if (raw.version !== VERSION) return { error: 'This Assist file is version ' + raw.version + '; this MxScout reads version ' + VERSION + '.' };
    if (!Array.isArray(raw.items)) return { error: 'The file has no "items".' };
    var items = [], updates = [], dropped = [], seen = {}, lang = langOf(raw.language);
    // More entries than a project can keep at all are refused by number, said, never cut off silently.
    if (raw.items.length > MAX_ITEMS) dropped.push('items ' + (MAX_ITEMS + 1) + '–' + raw.items.length + ': a file carries at most ' + MAX_ITEMS + ' items; send the rest in another');
    raw.items.slice(0, MAX_ITEMS).forEach(function (x, i) {
      var u = updateOf(x);
      if (u && u.error) { dropped.push('item ' + (i + 1) + ': ' + u.error); return; }
      if (u) { updates.push(u.update); return; }
      var r = itemOf(x, lang);
      if (r.error) { dropped.push('item ' + (i + 1) + ': ' + r.error); return; }
      var key = r.item.kind + ':' + r.item.id;
      if (seen[key]) { dropped.push('item ' + (i + 1) + ': ' + r.item.id + ' is in the file twice'); return; }
      seen[key] = true;
      r.item.given = r.given;
      items.push(r.item);
    });
    if (!items.length && !updates.length) return { error: 'The file has the right format but no item MxScout can keep' + (dropped.length ? ' (' + dropped.slice(0, 3).join('; ') + ')' : '') + '.' };
    // "setLanguage": true — the project's language becomes the envelope's (the person chose it when the agent asked).
    return { value: { items: items, updates: updates, dropped: dropped, language: lang, setLanguage: raw.setLanguage === true && lang ? lang : null } };
  }

  // ---------- the record ----------
  // `rows` is this tab's copy, for drawing. Every change is made on the record as the database holds it
  // NOW (store.update: read, change and write in one transaction, with a revision number), never on that
  // copy — a second tab, or this one a moment ago, may have saved since (an external audit, 2026-10-15,
  // B05: two tabs each added an item, and the second one's save of its whole copy dropped the first's).
  // Another tab's save is heard (store.onOtherTab) and the copy read again.
  var reads = {};      // projectId -> how many reads were started, so an older read never lands over a newer one
  function read(projectId) {
    var n = reads[projectId] = (reads[projectId] || 0) + 1;
    var p = store.get('assist', projectId).then(function (row) { return row || null; }, function () { return null; }).then(function (row) {
      if (reads[projectId] === n) { delete loading[projectId]; keep(projectId, row); }
      return rows[projectId];
    });
    loading[projectId] = p;
    return p;
  }
  // The copy, unless the one kept here is newer (a save of this tab that landed after the read began).
  function keep(projectId, row) {
    var was = rows[projectId];
    if (was && row && (was.rev || 0) > (row.rev || 0)) return;
    rows[projectId] = row;
    tell(projectId);
  }
  function load(projectId) {
    if (Object.prototype.hasOwnProperty.call(rows, projectId) && rows[projectId] !== undefined) return Promise.resolve(rows[projectId]);
    if (loading[projectId]) return loading[projectId];
    rows[projectId] = undefined;
    return read(projectId);
  }
  function reload(projectId) { return read(projectId); }
  // fn(current) → { row, result }: `row` the record to keep (or null to leave it as it is), worked out from
  // `current` — the record as the database holds it now — synchronously. → result, with result.row the
  // record kept after it.
  function change(projectId, fn) {
    var out = null;
    return store.update('assist', projectId, function (cur) {
      out = fn(cur || null);
      if (!out.row) return undefined;
      out.row.updatedAt = now();
      return out.row;
    }).then(function (r) {
      var row = r.value || null;
      if (r.changed || !rows[projectId] || (row && (rows[projectId].rev || 0) < (row.rev || 0))) keep(projectId, row);
      var res = out.result || {};
      res.row = rows[projectId];
      return res;
    });
  }
  function emptyRow(projectId) { return { projectId: projectId, items: [], migrated: null, updatedAt: null }; }
  function find(row, kind, id) {
    var at = -1;
    (row ? row.items : []).forEach(function (x, i) { if (at < 0 && x.kind === kind && x.id === id) at = i; });
    return at;
  }
  // Items taken out on purpose (an Undo of the save that added them): the folder's files of these go, and
  // no other — store.js never removes an item's file because the item is simply not in the record.
  var MAX_REMOVED = 500;
  function markRemoved(row, gone, at) {
    var keys = {};
    gone.forEach(function (x) { keys[x.kind + ':' + x.id] = true; });
    row.removed = (row.removed || []).filter(function (r) { return !keys[r.kind + ':' + r.id]; })
      .concat(gone.map(function (x) { return { kind: x.kind, id: x.id, at: at }; })).slice(-MAX_REMOVED);
  }

  // The items of a project, read from storage the first time.
  function list(projectId) { return load(projectId).then(function (row) { return row ? row.items.slice() : []; }); }
  // The items as they are now, or undefined while they are still read (a change is told when they are in).
  function peek(projectId) {
    if (!projectId) return [];
    if (rows[projectId] === undefined) { load(projectId); return undefined; }
    return rows[projectId] ? rows[projectId].items : [];
  }
  // Still to be dealt with: open, in progress, or waiting for the reporter.
  function isOpen(it) { return it.status === 'open' || it.status === 'in-progress' || it.status === 'waiting'; }
  function openCount(items) { return (items || []).filter(isOpen).length; }

  function names(list) {
    var by = {};
    list.forEach(function (x) { (by[x.kind] = by[x.kind] || []).push(x.id); });
    return KINDS.filter(function (k) { return by[k]; }).map(function (k) {
      return (by[k].length === 1 ? 'the ' + KIND_ONE[k] + ' ' : by[k].length + ' ' + KIND_MANY[k] + ' ') + by[k].join(', ');
    }).join('; ');
  }
  function statusWords(s) { return { open: 'Reopened', 'in-progress': 'In progress', waiting: 'Waiting for the reporter', done: 'Closed (done)', dropped: 'Dropped' }[s]; }

  // Saves what an agent sent: each item added or put in the place of the one with its id, each move
  // made. → { changed: [{ kind, id, title, how }], missing, dropped, what, before, row } — `before` is the
  // record as it was, for Undo (undo below).
  function apply(projectId, envelope) {
    var parsed = envelope && envelope.items && envelope.updates ? { value: envelope } : parseEnvelope(envelope);
    if (parsed.error) return Promise.reject(new Error(parsed.error));
    var v = parsed.value;
    return change(projectId, function (was) {
      // An update for an item this project does not keep refuses the whole file: nothing is saved.
      var missing = v.updates.filter(function (u) { return find(was, u.kind, u.id) < 0; }).map(function (u) { return u.kind + ' ' + u.id; });
      if (missing.length) throw new Error('Nothing was saved: ' + (missing.length === 1 ? 'an update is' : 'updates are') + ' for ' + missing.join(', ') + ', which MxScout does not keep for this project — send the whole item instead.');
      // The most a project keeps is MAX_ITEMS. New items past it refuse the whole file — nothing is ever
      // dropped to make room (B07: the oldest item used to go, silently, and with it its file in the folder).
      var fresh = v.items.filter(function (it) { return find(was, it.kind, it.id) < 0; }).length, held = was ? was.items.length : 0;
      if (fresh && held + fresh > MAX_ITEMS) throw new Error(limitText(held, fresh));
      var before = clone(was);
      var row = clone(was) || emptyRow(projectId);
      var at = now(), changed = [];
      v.items.forEach(function (src) {
        var it = clone(src), given = it.given || { status: true, planned: true };
        delete it.given;
        var i = find(row, it.kind, it.id), old = i < 0 ? null : row.items[i];
        if (old) {
          if (!given.status) { it.status = old.status; it.closed = old.closed; }
          if (!given.planned) it.planned = old.planned;
          it.created = old.created || it.created || at;
          if (!it.knowledge && old.knowledge) it.knowledge = old.knowledge;
          // A description the copy does not carry stays: it is written on request, and sent by an update.
          WRITEUPS.forEach(function (w) { if (!it[w] && old[w]) it[w] = old[w]; });
          var seen = {};
          old.history.forEach(function (h) { seen[h.date + '|' + h.what + '|' + h.by] = true; });
          it.history = old.history.concat(it.history.filter(function (h) { return !seen[h.date + '|' + h.what + '|' + h.by]; }));
          // The conversation is never lost: the one kept, then what the new copy has that it does not. The
          // questions by id: the new copy's wording and status, the ones it no longer lists kept as they were.
          var thread = it.thread, qs = it.questions.map(function (q) { return given.questions && !given.questions[q.id] ? Object.assign({}, q, { status: null }) : q; });
          it.thread = clone(old.thread || []); it.questions = clone(old.questions || []);
          mergeQuestions(it, qs, at);
          appendThread(it, thread, at);
          // The notes the same way: every note kept stays, with the status it has now; the copy's new ones are added.
          var notes = it.notes;
          it.notes = clone(old.notes || []);
          mergeNotes(it, notes, at, true);
          it.history.push({ date: at, what: 'Written again by the agent' + (it.status !== old.status ? ' · ' + STATUS_LABEL[old.status] + ' → ' + STATUS_LABEL[it.status] : ''), by: 'agent' });
        } else {
          numberNotes(it.notes, []);
          it.notes.forEach(function (n) { n.date = n.date || at; if (n.status === 'done' && !n.done) n.done = at; });
          it.created = it.created || at;
          it.history.push({ date: at, what: 'Handed in by the agent', by: 'agent' });
        }
        if ((it.status === 'done' || it.status === 'dropped') && !it.closed) it.closed = at;
        it.updated = at;
        it.history = it.history.slice(-MAX_HISTORY);
        if (old) row.items[i] = it; else row.items.push(it);
        changed.push({ kind: it.kind, id: it.id, title: it.title, how: old ? 'replaced' : 'added' });
      });
      v.updates.forEach(function (u) {
        var i = find(row, u.kind, u.id);
        var it = row.items[i];
        it.thread = it.thread || []; it.questions = it.questions || [];
        var said = u.questions ? mergeQuestions(it, u.questions, at) : [];
        var noted2 = u.notes ? mergeNotes(it, u.notes, at, false) : [];
        WRITEUPS.forEach(function (w) {
          if (u[w] === undefined) return;
          if (u[w]) { noted2.push(WRITEUP_NAME[w] + (it[w] ? ' written again' : ' written')); it[w] = u[w]; }
          else if (it[w]) { noted2.push(WRITEUP_NAME[w] + ' removed'); delete it[w]; }
        });
        var added = u.thread ? appendThread(it, u.thread, at) : 0;
        var noted = u.knowledge !== undefined && u.knowledge !== (it.knowledge || null);
        if (u.knowledge !== undefined) { if (u.knowledge) it.knowledge = u.knowledge; else delete it.knowledge; }
        var note = [added ? (added === 1 ? 'one entry' : added + ' entries') + ' added to the conversation' : null, said.length ? 'questions: ' + said.join(', ') : null,
          noted ? (u.knowledge ? 'Recorded as a solved case: ' + u.knowledge : 'No longer linked to a solved case') : null].concat(noted2).filter(Boolean).join(' · ');
        // The agent's own history entries say what happened; without any, MxScout writes one.
        var own = u.history ? appendHistory(it, u.history) : 0;
        move(it, { status: u.status, planned: u.planned }, 'agent', note, at, own > 0);
        if (u.closed && (it.status === 'done' || it.status === 'dropped')) it.closed = u.closed;
        it.updated = u.updated || at;
        changed.push({ kind: it.kind, id: it.id, title: it.title, how: 'updated' });
      });
      var what = names(changed) || 'nothing';
      return { row: changed.length ? row : null, result: { changed: changed, missing: [], dropped: v.dropped, what: what, before: before, setLanguage: v.setLanguage || null } };
    });
  }
  // What the person reads when new items would pass the limit: the limit, that nothing was saved or removed, and what still works.
  function limitText(held, fresh) {
    return 'Nothing was saved, and nothing was removed: MxScout keeps at most ' + MAX_ITEMS + ' items on the Assist page of one project, this one has ' + held +
      ', and ' + (fresh === 1 ? 'one more' : fresh + ' more') + ' would pass it. Updates to the items already here still go through — ask the agent to update an item rather than add one. MxScout never drops an item to make room.';
  }

  // History entries added: the ones it does not have yet, at its end.
  function appendHistory(it, list) {
    var seen = {}, n = 0;
    it.history.forEach(function (h) { seen[h.date + '|' + h.what + '|' + h.by] = true; });
    list.forEach(function (h) { var k = h.date + '|' + h.what + '|' + h.by; if (!seen[k]) { seen[k] = true; it.history.push(h); n++; } });
    it.history = it.history.slice(-MAX_HISTORY);
    return n;
  }

  // An item moved: its status, its planned date, each step written in its history — unless `quiet`,
  // when whoever moved it wrote the history entry themselves.
  function move(it, change, by, note, at, quiet) {
    var said = [];
    if (change.status && change.status !== it.status) {
      said.push(statusWords(change.status));
      it.status = change.status;
      it.closed = change.status === 'done' || change.status === 'dropped' ? at : null;
    }
    if (change.planned !== undefined && change.planned !== it.planned) {
      it.planned = change.planned || null;
      said.push(it.planned ? 'Planned for ' + it.planned : 'Planned date cleared');
    }
    if (note) said.push(note);
    if (!said.length) return quiet;
    it.updated = at;
    if (!quiet) it.history.push({ date: at, what: said.join(' · '), by: by });
    it.history = it.history.slice(-MAX_HISTORY);
    return true;
  }

  // The person's click: Close, Reopen, Drop, In progress, Waiting, a planned date — or the reporter's
  // answer, pasted: change { status?, planned?, answer?: { text, answers: [question ids] } } — or a note
  // ticked done or open again: note: { id, status }, kept on the note (its `done` date), not in the history. The answer
  // is appended to the conversation as the reporter's, marks the questions it answers, and takes an item
  // that was waiting for it back to open, for the agent to check again.
  // `seen`: the item as the person saw it when they clicked (its status, planned date and `updated`). When
  // it moved since — another tab, an agent — a click that changes what moved, to something else, is refused
  // and says what it is now; one that changes something else is made on top of the other change, so both stay.
  function set(projectId, kind, id, change, by, seen) {
    change = change || {};
    return changeRow(projectId, function (was) {
      var row = clone(was);
      var i = find(row, kind, id);
      if (i < 0) throw new Error('That item is no longer here.');
      var it = row.items[i], at = now(), who = by === 'agent' ? 'agent' : 'person', note = null, mv = { status: change.status, planned: change.planned };
      if (seen && seen.updated !== it.updated) {
        var clash = [];
        if (mv.status && it.status !== seen.status && it.status !== mv.status) clash.push('its status is ' + STATUS_LABEL[it.status] + ' now');
        if (mv.planned !== undefined && (it.planned || null) !== (seen.planned || null) && (it.planned || null) !== (mv.planned || null)) clash.push(it.planned ? 'it is planned for ' + it.planned + ' now' : 'its planned date was cleared');
        if (clash.length) throw new Error('Not saved: ' + KIND_ONE[kind] + ' ' + id + ' was changed elsewhere meanwhile — another tab or an agent — and ' + clash.join(' and ') + '. Look at it again and choose.');
      }
      var ticked = false;
      if (change.note) {
        var n = null;
        (it.notes || []).forEach(function (x) { if (x.id === change.note.id) n = x; });
        if (!n) throw new Error('That note is no longer here.');
        if (N_STATUS[change.note.status] === true && n.status !== change.note.status) {
          n.status = change.note.status;
          n.done = n.status === 'done' ? at : null;
          it.updated = at;
          ticked = true;
        }
      }
      if (change.answer) {
        var e = threadOf([{ date: at, from: 'reporter', text: change.answer.text, answers: change.answer.answers }])[0];
        if (!e) throw new Error('There is no answer to add.');
        it.thread = it.thread || []; it.questions = it.questions || [];
        appendThread(it, [e], at);
        note = 'Added the reporter’s answer' + (e.answers.length ? ' (' + e.answers.join(', ') + ')' : '');
        if (!mv.status && it.status === 'waiting') mv.status = 'open';
      }
      if (!move(it, mv, who, note, at) && !ticked) return null;
      return row;
    });
  }
  // change() for a whole record and nothing else to say: fn(current) → the record to keep, or null.
  function changeRow(projectId, fn) {
    return change(projectId, function (cur) { return { row: fn(cur) }; }).then(function (res) { return res.row; });
  }

  // Undo an agent's save: the record goes back to what it was, if nothing moved since.
  // Only while the record is the one that save left — by its revision, as the database holds it, so a
  // change another tab made since is never undone with it.
  function canUndo(projectId, result) { return !!result && !!result.row && !!rows[projectId] && rows[projectId].rev === result.row.rev && result.changed.length > 0; }
  function undo(projectId, result) {
    var refused = 'Something changed on the Assist page since; there is nothing to undo.';
    if (!canUndo(projectId, result)) return Promise.reject(new Error(refused));
    return changeRow(projectId, function (cur) {
      if (!cur || cur.rev !== result.row.rev) throw new Error(refused);
      var back = clone(result.before) || emptyRow(projectId);
      // What the save added, and Undo takes away, is marked so: its file in the folder goes too.
      var gone = cur.items.filter(function (x) { return find(back, x.kind, x.id) < 0; });
      back.removed = cur.removed || [];
      if (gone.length) markRemoved(back, gone, now());
      return back;
    });
  }

  // ---------- files, for a project kept in a folder ----------
  // An item as a file writes it: the drawings back in the form a file has (describe.js reads them again).
  function fileItem(it) {
    var x = clone(it), out = P().diagramFile;
    if (x.traced) x.traced.diagram = out(it.traced.diagram);
    if (x.now) x.now.diagram = out(it.now.diagram);
    if (x.proposal) x.proposal.diagram = out(it.proposal.diagram);
    if (x.fix) x.fix.diagram = out(it.fix.diagram);
    delete x.given;
    return x;
  }
  // items → [{ path: 'assist/<folder>/<id>.json', text }] — folder tickets, jira, ideas or other. Pure.
  // removed (the record's marks, markRemoved): the list's `gone` — the files of items taken out on purpose,
  // the only ones store.js may remove; an item merely missing from the record never loses its file.
  function pathOf(it) { return 'assist/' + FOLDER[it.kind] + '/' + it.id + '.json'; }
  function toFiles(items, removed) {
    var files = (items || []).map(function (it) { return { path: pathOf(it), text: JSON.stringify(fileItem(it), null, 2) + '\n' }; });
    var here = {};
    files.forEach(function (f) { here[f.path] = true; });
    files.gone = (removed || []).filter(function (r) { return FOLDER[r.kind] && !here[pathOf(r)]; }).map(pathOf);
    return files;
  }
  // [{ path, text }] → { items, errors: [{ path, error }] }: each file one item, its path agreeing with its kind and id. Pure.
  function fromFiles(files) {
    var items = [], errors = [], seen = {};
    (files || []).forEach(function (f) {
      var m = /^(?:.*\/)?assist\/([a-z]+)\/([^/]+)\.json$/.exec(String(f && f.path || ''));
      if (!m || !KIND_OF_FOLDER[m[1]]) { errors.push({ path: f && f.path, error: 'not an assist/<tickets|jira|ideas|other>/<id>.json file' }); return; }
      m[1] = KIND_OF_FOLDER[m[1]];
      var raw;
      try { raw = JSON.parse(f.text); } catch (e) { errors.push({ path: f.path, error: 'not JSON' }); return; }
      var r = itemOf(raw, null, true);
      if (r.error) { errors.push({ path: f.path, error: r.error }); return; }
      if (r.item.kind !== m[1] || r.item.id !== m[2]) { errors.push({ path: f.path, error: 'its kind and id are not the ones its path names' }); return; }
      numberNotes(r.item.notes, []);
      if (seen[m[1] + ':' + m[2]]) return;
      seen[m[1] + ':' + m[2]] = true;
      items.push(r.item);
    });
    return { items: items, errors: errors };
  }

  // The Assist files of a project's folder that were newer than this browser's copy (store.js
  // folderChanges), or those of a folder opened as a project: the folder wins — each item in the
  // place of the one with its kind and id, a new one added; an item the folder does not have stays.
  // → { taken: [items], errors: [{ path, error }] }.
  function adoptFiles(projectId, files) {
    var got = fromFiles(files);
    // No limit here: what the folder holds is taken whole — refusing part of it would leave files the record
    // does not know, and the folder is the person's.
    return change(projectId, function (was) {
      var row = clone(was) || emptyRow(projectId), taken = [];
      got.items.forEach(function (it) {
        var i = find(row, it.kind, it.id);
        if (i >= 0 && JSON.stringify(fileItem(row.items[i])) === JSON.stringify(fileItem(it))) return;
        if (i >= 0) row.items[i] = it; else row.items.push(it);
        taken.push(it);
      });
      return { row: taken.length ? row : null, result: { taken: taken, errors: got.errors } };
    });
  }

  // ---------- the tickets and changes of an older descriptions file ----------
  var CHANGE_STATUS = { proposed: 'open', accepted: 'in-progress', done: 'done', dropped: 'dropped' };
  function fromTicket(t, at) {
    if (!t || !t.id) return null;
    t = Object.assign({ traced: {} }, t); t.traced = Object.assign({ steps: [], flows: [], diagram: [] }, t.traced);
    var r = itemOf({ id: t.id, kind: 'ticket', title: t.title, reported: t.reported, source: t.source, created: t.date || at, updated: t.date || at, status: 'open',
      verdict: t.verdict, confidence: t.confidence, summary: t.summary, story: t.story, traced: { steps: t.traced.steps, flows: t.traced.flows, diagram: P().diagramFile(t.traced.diagram) },
      evidence: t.evidence, needs: t.needs, reply: t.reply, change: t.change, risks: t.risks, risk: t.risk,
      history: [{ date: t.date || at, what: 'Checked by an agent (moved here from the Tickets page)', by: 'agent' }] }, null, true);
    return r.item || null;
  }
  function fromChange(c, at) {
    if (!c || !c.id) return null;
    c = Object.assign({ now: {}, proposal: {} }, c);
    var out = P().diagramFile, st = CHANGE_STATUS[c.status] || 'open';
    var r = itemOf({ id: c.id, kind: 'idea', title: c.title, reported: c.asked, created: c.date || at, updated: c.date || at, status: st, closed: st === 'done' || st === 'dropped' ? (c.date || at) : null,
      now: { summary: c.now.summary, story: c.now.story, steps: c.now.steps, flows: c.now.flows, diagram: out(c.now.diagram) },
      proposal: { summary: c.proposal.summary, story: c.proposal.story, steps: c.proposal.steps, diagram: out(c.proposal.diagram), changes: c.proposal.changes },
      impact: c.impact, risks: c.risks, open: c.open, effort: c.effort,
      history: [{ date: c.date || at, what: 'Worked out by an agent (moved here from the Changes page)', by: 'agent' }] }, null, true);
    return r.item || null;
  }
  // Moves the tickets of a project's descriptions to Tickets and its changes to Ideas. Idempotent: an
  // item already here, by its kind and id, is left as it is — moved before, and perhaps moved on since.
  // The descriptions are not changed; the documentation simply no longer shows them. → { moved }.
  function migrate(projectId, value) {
    var tickets = value && Array.isArray(value.tickets) ? value.tickets : [], changes = value && Array.isArray(value.changes) ? value.changes : [];
    return change(projectId, function (was) {
      var at = now(), row = clone(was) || emptyRow(projectId), moved = 0;
      tickets.map(function (t) { return fromTicket(t, at); }).concat(changes.map(function (c) { return fromChange(c, at); })).forEach(function (it) {
        if (!it || find(row, it.kind, it.id) >= 0) return;
        row.items.push(it);
        moved++;
      });
      if (!moved && was && was.migrated) return { row: null, result: { moved: 0 } };
      row.migrated = { at: (was && was.migrated && was.migrated.at) || at, tickets: tickets.length, changes: changes.length, last: at };
      return { row: row, result: { moved: moved } };
    });
  }

  // The items of a project as the documentation's pages take them (docs.js pageScreen, through app.js):
  // one object per project, so a page mounted with it keeps it; `version` moves whenever an item does.
  var hooks = {};
  function hook(projectId, onError) {
    return hooks[projectId] || (hooks[projectId] = {
      items: function () { return peek(projectId) || []; },
      version: function () { return peek(projectId); },
      // A workbook item's sources as the model has them: what its technical description's HTML and Markdown append.
      appendix: function (x) { try { return appendixOf ? appendixOf(projectId, x) || [] : []; } catch (e) { return []; } },
      // seen: the item as it was drawn when the person clicked — a change made elsewhere since is not undone by the click.
      act: function (kind, id, change, seen) { return set(projectId, kind, id, change, 'person', seen ? { status: seen.status, planned: seen.planned || null, updated: seen.updated } : null).catch(function (err) { if (onError) onError(err); throw err; }); }
    });
  }

  // Deleting a project: store.js takes its record with it; the copy here goes too.
  function forget(projectId) { delete rows[projectId]; delete loading[projectId]; reads[projectId] = (reads[projectId] || 0) + 1; }

  window.MxAssist = {
    init: init, parseEnvelope: parseEnvelope, isEnvelope: isEnvelope, apply: apply, list: list, peek: peek, set: set,
    undo: undo, canUndo: canUndo, toFiles: toFiles, fromFiles: fromFiles, adoptFiles: adoptFiles, migrate: migrate, forget: forget,
    openCount: openCount, isOpen: isOpen, hook: hook,
    FORMAT: FORMAT, KINDS: KINDS, KIND_LABEL: KIND_LABEL, KIND_ONE: KIND_ONE, STATUSES: STATUSES, STATUS_LABEL: STATUS_LABEL, QUESTION_STATUSES: Object.keys(Q_STATUS), NOTE_STATUSES: Object.keys(N_STATUS)
  };
})();
