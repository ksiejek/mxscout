#!/usr/bin/env node
/* The mendix-assist skill's checker. No dependencies — Node only.
 *
 *   node check-assist.js check <file.json> [--pack ai-pack.md]
 *       Checks an Assist envelope ({ "format": "mxscout-assist", "version": 1, "items": [ … ] }) before it
 *       goes into the project folder's inbox/ or through the agent channel: the envelope, every item's
 *       required fields for its kind, the lists of allowed values, the id's form, the dates. An error is
 *       what MxScout would refuse (exit 1); a warning is what it would keep but show worse. With --pack
 *       (the AI pack, ai-pack.md in the project folder) it also warns about qualified names not in the model.
 *
 *   node check-assist.js list <project-folder> [--kind ticket|jira|idea|other] [--status open,in-progress]
 *       Prints the items MxScout keeps under assist/<kind>/<id>.json — kind, id, status, planned date,
 *       last update and title — and the files still waiting in inbox/. Read it before answering, so you
 *       know what is open, planned and closed.
 *
 *   node check-assist.js knowledge <id>-<slug>.md
 *       Checks a case note (reference/knowledge-format.md) — written in the work folder first — before
 *       agent.js case puts it into knowledge/ or it is handed to MxScout: the front matter, the five sections,
 *       the file's name against its id — and personal data: an e-mail address, a phone number, an IBAN, a
 *       "Reported by" line or a long number is an error.
 *
 *   node check-assist.js cases <folder> [--find "words names"] [--pack ai-pack.md]
 *       The solved cases in knowledge/ — the Mendix project, its mxscout/, or a project folder — one line
 *       each from the front matter, the best matches for --find first; which commit each was checked against
 *       beside the one HEAD names now; and with --pack, a case whose flows or pages changed since (their
 *       fingerprints moved) or are gone is marked "may be out of date". Read it before working a new item.
 *
 * The formats are reference/assist-format.md and reference/knowledge-format.md; a case note is read with
 * mendix-describe's repodocs.js (MxScout's own), beside this skill. This file reads; it writes nothing. A file
 * named without a path (check, knowledge, --pack) is looked for in the work folder first — node
 * ../mendix-describe/agent.js workdir prints it — then here.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const FORMAT = 'mxscout-assist';
const KINDS = ['ticket', 'jira', 'idea', 'other'];
const FOLDERS = { ticket: 'tickets', jira: 'jira', idea: 'ideas', other: 'other' };
const NAMES = { ticket: 'a ticket', jira: 'a Jira issue', idea: 'an idea', other: 'a workbook item' };
const STATUSES = ['open', 'waiting', 'in-progress', 'done', 'dropped'];
const OPEN_STATUSES = ['open', 'waiting', 'in-progress'];
const QSTATUSES = ['open', 'answered', 'dropped'];
const NSTATUSES = ['open', 'done', 'dropped'];
const NID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const FROM = ['reporter', 'person', 'agent'];
const QID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UPDATE_FIELDS = ['id', 'kind', 'update', 'updated', 'status', 'planned', 'closed', 'history', 'thread', 'questions', 'notes', 'knowledge', 'business', 'technical'];
const VERDICTS = ['bug', 'as-designed', 'data-config', 'cannot-tell'];
const CONFIDENCE = ['high', 'medium', 'low'];
const FEASIBLE = ['yes', 'partly', 'no'];
const BY = ['person', 'agent'];
const CHANGE_KINDS = ['microflow', 'nanoflow', 'page', 'entity', 'attribute', 'association', 'enumeration', 'security', 'scheduled event', 'integration', 'other'];
const ACTIONS = ['add', 'change', 'remove'];
const LEVELS = ['P1', 'P2', 'P3'];
const COMMON = ['id', 'kind', 'title', 'reported', 'source', 'created', 'updated', 'status', 'planned', 'closed', 'history', 'questions', 'thread', 'notes', 'language', 'modelVersion', 'knowledge', 'business', 'technical'];
// The case note an item's solution is recorded in (reference/knowledge-format.md): knowledge/<id>-<slug>.md.
const KNOWLEDGE_PATH = /^knowledge\/[A-Za-z0-9][A-Za-z0-9._-]*\.md$/;
const OWN = {
  ticket: ['verdict', 'confidence', 'summary', 'story', 'traced', 'evidence', 'needs', 'reply', 'fix', 'risk'],
  jira: ['summary', 'story', 'scope', 'proposal', 'impact', 'risks', 'open', 'effort', 'reply'],
  idea: ['now', 'proposal', 'impact', 'risks', 'open', 'effort', 'reply'],
  other: ['summary', 'story', 'sources', 'proposal', 'reply']
};

// A tracker's key or number (SD-4711, INC0012345, 4711); a slug for an idea or other help (discount-approval).
// Both become a file name, so neither may hold a slash, a space or start with a dot.
const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LANG = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/;

function realDate(y, m, d) {
  const t = new Date(Date.UTC(+y, +m - 1, +d));
  return t.getUTCFullYear() === +y && t.getUTCMonth() === +m - 1 && t.getUTCDate() === +d;
}
function isDate(v) { const m = DATE.exec(String(v)); return typeof v === 'string' && !!m && realDate(m[1], m[2], m[3]); }
function isDateOrTime(v) {
  if (isDate(v)) return true;
  const m = DATETIME.exec(String(v));
  return typeof v === 'string' && !!m && realDate(m[1], m[2], m[3]) && +m[4] < 24 && +m[5] < 60 && (m[6] === undefined || +m[6] < 60);
}
const str = (v) => typeof v === 'string' && v.trim() !== '';
const words = (s) => (String(s).match(/\S+/g) || []).length;

// ---------- the pack, when given: which names the model has ----------
// mendix-describe's reader, beside this skill; without it the --pack check is skipped, never guessed.
function loadPack(file, warn) {
  let readPack;
  try { ({ readPack } = require(path.join(__dirname, '..', 'mendix-describe', 'check-descriptions.js'))); }
  catch (e) { warn('--pack: mendix-describe is not installed beside this skill, so names are not checked against the model.'); return null; }
  try { return readPack(fs.readFileSync(file, 'utf8')); }
  catch (e) { warn('--pack: ' + e.message.split('\n')[0]); return null; }
}
function inPack(pack, kind, qn) {
  if (!pack) return null;
  const parts = String(qn).split('.');
  const flow = !!(pack.microflows[qn] || pack.nanoflows[qn] || pack.pages[qn]);
  if (kind === 'flow') return flow || !!pack.entities[qn];
  if (kind === 'microflow' || kind === 'nanoflow' || kind === 'page') return !!pack[kind + 's'][qn];
  if (kind === 'entity') return !!pack.entities[qn];
  if (kind === 'attribute') return parts.length === 3 && !!pack.entities[parts[0] + '.' + parts[1]];
  if (kind === 'association') return !!pack.modules[parts[0]];
  return null; // the pack does not list the other kinds by name
}

// ---------- check ----------
function check(envelope, opts) {
  opts = opts || {};
  const errors = [], warnings = [];
  const err = (m) => errors.push(m), warn = (m) => warnings.push(m);
  const pack = opts.pack || null;

  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) { err('The file is not a JSON object.'); return { errors, warnings }; }
  if (envelope.format !== FORMAT) err('"format" must be "' + FORMAT + '"' + (envelope.format === 'mxscout-descriptions' ? ' — this is a descriptions file; Assist items go in an envelope of their own.' : '.'));
  if (envelope.version !== 1) err('"version" must be 1.');
  ['tickets', 'changes'].forEach((k) => { if (envelope[k] !== undefined) err('"' + k + '" belongs to no file any more: write each as an item in "items" (reference/assist-format.md).'); });
  if (envelope.written !== undefined && !isDateOrTime(envelope.written)) warn('"written" is not an ISO date.');
  if (envelope.language !== undefined && !LANG.test(String(envelope.language))) warn('"language" should be an ISO 639 code ("en", "pl"); English is assumed.');
  if (envelope.setLanguage !== undefined && typeof envelope.setLanguage !== 'boolean') err('"setLanguage" must be true or false.');
  if (envelope.setLanguage === true && !LANG.test(String(envelope.language || ''))) err('"setLanguage": true needs "language" — the ISO code the project should keep ("en", "pl").');
  ['project', 'by'].forEach((k) => { if (envelope[k] !== undefined && typeof envelope[k] !== 'string') warn('"' + k + '" should be text.'); });
  Object.keys(envelope).forEach((k) => { if (['format', 'version', 'items', 'project', 'language', 'setLanguage', 'by', 'written', 'tickets', 'changes'].indexOf(k) === -1) warn('"' + k + '" is not part of the envelope; MxScout ignores it.'); });
  if (!Array.isArray(envelope.items) || envelope.items.length === 0) { err('"items" must be a list with at least one item.'); return { errors, warnings }; }

  const seen = {};
  envelope.items.forEach((it, i) => {
    let w = 'item ' + (i + 1);
    if (!it || typeof it !== 'object' || Array.isArray(it)) { err(w + ': not an object.'); return; }
    const kind = it.kind;
    if (KINDS.indexOf(kind) === -1) { err(w + ': "kind" must be one of ' + KINDS.join(', ') + '.'); return; }
    // ----- the id: how the item is found later, and its file name -----
    if (!str(it.id)) err(w + ': "id" is required.');
    else {
      w = kind + ' ' + it.id;
      if (kind === 'ticket' || kind === 'jira') {
        if (!KEY.test(it.id)) err(w + ': the id must be the tracker\'s number or key as given — letters, digits, dots, hyphens and underscores, starting with a letter or digit, at most 80' + (/^#/.test(it.id) ? ' (drop the leading #)' : '') + '.');
        else if (!/\d/.test(it.id)) warn(w + ': the id has no number in it — ask the person for the ' + (kind === 'jira' ? 'Jira issue\'s key' : 'ticket\'s number') + ', so the item can be found later.');
      } else if (!SLUG.test(it.id) || it.id.length > 80) err(w + ': the id must be a slug — lower-case letters, digits and single hyphens, at most 80 (e.g. "discount-approval").');
      const key = kind + '/' + it.id;
      if (seen[key]) err(w + ': this kind and id appear twice in the file.');
      seen[key] = true;
    }
    // ----- status, dates, history, questions and thread: a full item and an update share these -----
    const statusAndDates = () => {
      if (it.status !== undefined && STATUSES.indexOf(it.status) === -1) err(w + ': "status" must be one of ' + STATUSES.join(', ') + '.');
      ['planned', 'closed'].forEach((k) => { if (it[k] !== undefined && it[k] !== null && !isDate(it[k])) err(w + ': "' + k + '" must be an ISO date (YYYY-MM-DD): ' + JSON.stringify(it[k]) + '.'); });
      if ((it.status === 'done' || it.status === 'dropped') && !it.closed) warn(w + ': it is ' + it.status + ' — set "closed" to the date it was.');
      if (OPEN_STATUSES.indexOf(it.status) !== -1 && it.closed) warn(w + ': it is ' + it.status + ' but has "closed" — leave "closed" out until it is done or dropped.');
      if (it.knowledge !== undefined && it.knowledge !== null && !(typeof it.knowledge === 'string' && KNOWLEDGE_PATH.test(it.knowledge) && it.knowledge.indexOf('..') === -1)) err(w + ': "knowledge" must be the case note\'s path, knowledge/<id>-<slug>.md.');
      else if (typeof it.knowledge === 'string' && str(it.id) && it.knowledge.slice(10).indexOf(it.id) !== 0) warn(w + ': "knowledge" names ' + it.knowledge + ', whose file name does not start with the item\'s id.');
    };
    const history = (required) => {
      if (it.history === undefined && !required) return;
      if (!Array.isArray(it.history)) { err(w + ': "history" is required — a list of { date, what, by }.'); return; }
      if (it.history.length === 0 && required) warn(w + ': "history" is empty — add what you did ("Checked against the model: …").');
      it.history.forEach((h, j) => {
        const hw = w + ': history ' + (j + 1);
        if (!h || typeof h !== 'object') { err(hw + ': not an object.'); return; }
        if (!isDateOrTime(h.date)) err(hw + ': "date" is not an ISO date.');
        if (!str(h.what)) err(hw + ': "what" is required.');
        if (BY.indexOf(h.by) === -1) err(hw + ': "by" must be "person" or "agent".');
      });
      for (let j = 1; j < it.history.length; j++) {
        const a = it.history[j - 1], b = it.history[j];
        if (a && b && isDateOrTime(a.date) && isDateOrTime(b.date) && String(b.date) < String(a.date)) { warn(w + ': "history" is not oldest first.'); break; }
      }
    };
    // questions[]: what to ask the reporter. In a full item each is whole; in an update, one with "text" is a
    // new question (whole too), one without only changes the status of a question MxScout keeps.
    const questions = (partial) => {
      if (it.questions === undefined) return [];
      if (!Array.isArray(it.questions)) { err(w + ': "questions" must be a list of { id, text, why, status, asked }.'); return []; }
      const ids = [];
      it.questions.forEach((q, j) => {
        const qw = w + ': question ' + (q && q.id ? q.id : j + 1);
        if (!q || typeof q !== 'object') { err(qw + ': not an object.'); return; }
        if (!(typeof q.id === 'string' && QID.test(q.id))) err(qw + ': "id" must be a short slug, unique in the item ("q1", "q2", "role").');
        else if (ids.indexOf(q.id) !== -1) err(qw + ': the id appears twice.');
        else ids.push(q.id);
        if (QSTATUSES.indexOf(q.status) === -1) err(qw + ': "status" must be one of ' + QSTATUSES.join(', ') + '.');
        const whole = !partial || q.text !== undefined;
        if (whole) {
          if (!str(q.text)) err(qw + ': "text" is required — the question as the reporter will read it.');
          if (!str(q.why)) err(qw + ': "why" is required — what it settles for the verdict or the proposal.');
          if (!isDate(q.asked)) err(qw + ': "asked" must be an ISO date (YYYY-MM-DD).');
        }
        if (q.answered !== undefined && !isDate(q.answered)) err(qw + ': "answered" must be an ISO date (YYYY-MM-DD).');
        if (q.status === 'answered' && q.answered === undefined) warn(qw + ': answered — set "answered" to the date.');
        if (q.status !== 'answered' && q.answered !== undefined) warn(qw + ': it has "answered" but its status is ' + q.status + '.');
      });
      return ids;
    };
    // thread[]: the exchange with the reporter, append-only — MxScout keeps what it has and adds the rest.
    const thread = (qids, partial) => {
      if (it.thread === undefined) return;
      if (!Array.isArray(it.thread)) { err(w + ': "thread" must be a list of { date, from, text }.'); return; }
      it.thread.forEach((t, j) => {
        const tw = w + ': thread ' + (j + 1);
        if (!t || typeof t !== 'object') { err(tw + ': not an object.'); return; }
        if (!isDateOrTime(t.date)) err(tw + ': "date" is not an ISO date.');
        if (FROM.indexOf(t.from) === -1) err(tw + ': "from" must be one of ' + FROM.join(', ') + '.');
        if (!str(t.text)) err(tw + ': "text" is required.');
        if (t.answers !== undefined) {
          if (!Array.isArray(t.answers) || t.answers.some((a) => typeof a !== 'string')) err(tw + ': "answers" must be a list of question ids.');
          else t.answers.forEach((a) => {
            if (!partial && qids.indexOf(a) === -1) err(tw + ': answers "' + a + '", which is not one of the item\'s questions.');
            const q = (it.questions || []).find((x) => x && x.id === a);
            if (q && q.status === 'open') warn(tw + ': it answers ' + a + ', which is still open — mark it answered.');
          });
        }
      });
      for (let j = 1; j < it.thread.length; j++) {
        const a = it.thread[j - 1], b = it.thread[j];
        if (a && b && isDateOrTime(a.date) && isDateOrTime(b.date) && String(b.date) < String(a.date)) { warn(w + ': "thread" is not oldest first.'); break; }
      }
    };
    // notes[]: what the person asked to keep on the item — { id?, text, topic?, refs?, status?, date? }. A new
    // note has its text (MxScout numbers one sent without an id); in an update, one kept is found by its id
    // and carries only what changes.
    const notes = (partial) => {
      if (it.notes === undefined) return;
      if (!Array.isArray(it.notes)) { err(w + ': "notes" must be a list of { text, topic, refs }.'); return; }
      const ids = [];
      it.notes.forEach((n, j) => {
        const nw = w + ': note ' + (n && n.id ? n.id : j + 1);
        if (!n || typeof n !== 'object') { err(nw + ': not an object.'); return; }
        if (n.id !== undefined) {
          if (!(typeof n.id === 'string' && NID.test(n.id))) err(nw + ': "id" must be a short id ("n3"), or left out for a new note.');
          else if (ids.indexOf(n.id) !== -1) err(nw + ': the id appears twice.');
          else ids.push(n.id);
        }
        if (n.text !== undefined && !str(n.text)) err(nw + ': "text" is empty.');
        if (!str(n.text) && (!partial || n.id === undefined)) err(nw + ': "text" is required — what to keep, in a sentence or two.');
        else if (str(n.text) && n.text.length > 2000) warn(nw + ': "text" is over 2000 characters; MxScout keeps the first 2000.');
        if (n.topic !== undefined && !str(n.topic)) err(nw + ': "topic" must be text ("Security", "Performance").');
        if (n.status !== undefined && NSTATUSES.indexOf(n.status) === -1) err(nw + ': "status" must be one of ' + NSTATUSES.join(', ') + '.');
        if (n.date !== undefined && !isDateOrTime(n.date)) err(nw + ': "date" is not an ISO date.');
        if (n.refs !== undefined) {
          if (!Array.isArray(n.refs) || n.refs.some((r) => typeof r !== 'string')) err(nw + ': "refs" must be a list of qualified names.');
          else n.refs.forEach((qn) => {
            if (!str(qn)) err(nw + ': "refs" holds an empty name.');
            // A flow, a page or an entity by its name; an attribute by its entity.
            else if (inPack(pack, 'flow', qn) === false && inPack(pack, 'attribute', qn) === false) warn(nw + ': "refs" names ' + qn + ', which is not in the pack.');
          });
        }
      });
    };
    // business, technical: a description of the change, written when the person asks — { title, written,
    // summary, sections: [{ heading, text }] }, plain text: paragraphs, "- " lists and `Module.Name`, nothing else.
    const writeups = (partial) => {
      ['business', 'technical'].forEach((k) => {
        const v = it[k], ww = w + ': "' + k + '"';
        if (v === undefined || (v === null && partial)) return;
        if (!v || typeof v !== 'object' || Array.isArray(v)) { err(ww + ' must be { title, written, summary, sections: [{ heading, text }] }' + (partial ? ', or null to take it away' : '') + '.'); return; }
        if (v.sections !== undefined && !Array.isArray(v.sections)) { err(ww + ': "sections" must be a list of { heading, text }.'); return; }
        const secs = v.sections || [];
        if (!str(v.summary) && !secs.length) { err(ww + ' needs a summary or at least one section.'); return; }
        if (!str(v.summary)) warn(ww + ': no "summary" — say the change in one to three sentences first.');
        if (v.written === undefined) warn(ww + ': no "written" — the date you wrote it.');
        else if (!isDateOrTime(v.written)) err(ww + ': "written" is not an ISO date.');
        if (v.title !== undefined && !str(v.title)) err(ww + ': "title" must be text.');
        const texts = [v.summary];
        secs.forEach((sc, j) => {
          if (!sc || typeof sc !== 'object' || !str(sc.text)) { err(ww + ': section ' + (j + 1) + ' needs a "text".'); return; }
          if (sc.heading !== undefined && !str(sc.heading)) err(ww + ': section ' + (j + 1) + ': "heading" must be text.');
          texts.push(sc.text, sc.heading);
        });
        if (texts.some((t) => typeof t === 'string' && (/<\/?[a-z][^>]*>/i.test(t) || /\*\*|^#{1,6}\s|\[[^\]]+\]\([^)]+\)/m.test(t))))
          warn(ww + ': plain text only — paragraphs, "- " lists and `Module.Name`; MxScout shows HTML, **bold**, # headings and links as they are written.');
      });
    };
    const waitingRule = () => {
      const open = (it.questions || []).filter((q) => q && q.status === 'open').length;
      if (open && (it.status === 'open' || it.status === 'in-progress')) warn(w + ': ' + open + ' question(s) to the reporter are open — the status is "waiting" until they answer.');
      if (it.status === 'waiting' && !open && Array.isArray(it.questions)) warn(w + ': "waiting" with no open question — say what you are waiting for, or set it open.');
    };

    // ----- an update: only what changed, merged into the item MxScout keeps -----
    if (it.update !== undefined) {
      if (it.update !== true) { err(w + ': "update" is true or left out.'); return; }
      if (!isDateOrTime(it.updated)) err(w + ': "updated" is required (an ISO date).');
      const unknown = Object.keys(it).filter((k) => UPDATE_FIELDS.indexOf(k) === -1);
      if (unknown.length) err(w + ': an update carries only ' + UPDATE_FIELDS.join(', ') + ' — to change ' + unknown.join(', ') + ', send the whole item without "update".');
      if (!['status', 'planned', 'closed', 'history', 'thread', 'questions', 'notes', 'knowledge', 'business', 'technical'].some((k) => it[k] !== undefined)) warn(w + ': the update changes nothing.');
      statusAndDates();
      history(false);
      const qids = questions(true);
      thread(qids, true);
      notes(true);
      writeups(true);
      waitingRule();
      return;
    }

    // ----- every item -----
    if (!str(it.title)) err(w + ': "title" is required.');
    else if (it.title.length > 200) warn(w + ': "title" is over 200 characters — say it in a line.');
    if (!str(it.reported)) err(w + ': "reported" is required — the text as the person pasted it, trimmed.');
    else if (it.reported !== it.reported.trim()) warn(w + ': "reported" has spaces or blank lines around it; trim it.');
    if (it.language !== undefined && !LANG.test(String(it.language))) warn(w + ': "language" should be an ISO 639 code ("en", "pl"); English is assumed.');
    if (it.source !== undefined && typeof it.source !== 'string') err(w + ': "source" must be text (it is shown, never opened).');
    ['created', 'updated'].forEach((k) => {
      if (it[k] === undefined) err(w + ': "' + k + '" is required (an ISO date).');
      else if (!isDateOrTime(it[k])) err(w + ': "' + k + '" is not an ISO date or date-time: ' + JSON.stringify(it[k]) + '.');
    });
    if (isDateOrTime(it.created) && isDateOrTime(it.updated) && String(it.updated).slice(0, 10) < String(it.created).slice(0, 10)) warn(w + ': "updated" is before "created".');
    if (it.status === undefined) err(w + ': "status" must be one of ' + STATUSES.join(', ') + '.');
    statusAndDates();
    history(true);
    const qids = questions(false);
    thread(qids, false);
    notes(false);
    writeups(false);
    waitingRule();
    const allowed = COMMON.concat(OWN[kind]);
    Object.keys(it).forEach((k) => {
      if (allowed.indexOf(k) !== -1) return;
      const other = KINDS.filter((x) => OWN[x].indexOf(k) !== -1).map((x) => NAMES[x]);
      warn(w + ': "' + k + '" is not a field of ' + NAMES[kind] + (other.length ? ' (it is one of ' + other.join(', of ') + ')' : '') + '; MxScout ignores it.');
    });

    const flows = (list, where) => {
      if (list === undefined) return;
      if (!Array.isArray(list)) { err(w + ': ' + where + ' must be a list of qualified names.'); return; }
      list.forEach((qn) => {
        if (!str(qn)) err(w + ': ' + where + ' holds an empty name.');
        else if (inPack(pack, 'flow', qn) === false) warn(w + ': ' + where + ' names ' + qn + ', which is not in the pack.');
      });
    };
    const texts = (list, where) => {
      if (list === undefined) return;
      if (!Array.isArray(list) || list.some((s) => !str(s))) err(w + ': ' + where + ' must be a list of sentences.');
    };
    const diagram = (d, where, depth) => {
      if (d === undefined) return;
      if (!Array.isArray(d)) { err(w + ': ' + where + ' must be a list of steps, decisions and ends.'); return; }
      d.forEach((x, j) => {
        const xw = where + '[' + j + ']';
        if (!x || typeof x !== 'object') { err(w + ': ' + xw + ' is not an object.'); return; }
        if (str(x.step) || str(x.end)) return;
        if (str(x.decision)) {
          if (!Array.isArray(x.ways) || x.ways.length < 2) warn(w + ': ' + xw + ' is a decision with fewer than two ways.');
          (Array.isArray(x.ways) ? x.ways : []).forEach((way, k) => {
            if (!way || typeof way !== 'object') { err(w + ': ' + xw + ' way ' + (k + 1) + ' is not an object.'); return; }
            if (depth < 6) diagram(way.then, xw + '.ways[' + k + '].then', depth + 1);
            else if (way.then !== undefined) warn(w + ': ' + xw + ' nests deeper than 6 levels; the rest is dropped.');
          });
          return;
        }
        err(w + ': ' + xw + ' has no "step", "decision" or "end".');
      });
    };
    const story = (s, where, min) => {
      if (!str(s)) { err(w + ': ' + where + ' is required.'); return; }
      if (min && words(s) < min) warn(w + ': ' + where + ' has ' + words(s) + ' words — at least ' + min + ' tell the case.');
      if (/^\s*(?:[-*•]\s|#{1,6}\s)|\*\*|<\/?[a-z][^>]*>/im.test(s)) warn(w + ': ' + where + ' looks like markup; it is shown as plain text — paragraphs separated by a blank line.');
    };
    const risks = (list, where) => {
      if (list === undefined) return;
      if (!Array.isArray(list)) { err(w + ': ' + where + ' must be a list.'); return; }
      list.forEach((r, j) => {
        if (!r || LEVELS.indexOf(r.level) === -1 || !str(r.title)) err(w + ': ' + where + '[' + j + '] needs a "level" (P1, P2 or P3) and a "title".');
      });
    };
    const impact = (v) => {
      if (v === undefined) return;
      if (!v || typeof v !== 'object' || Array.isArray(v)) { err(w + ': "impact" must be { flows, roles, data }.'); return; }
      flows(v.flows, 'impact.flows');
      texts(v.roles, 'impact.roles');
      if (v.data !== undefined && typeof v.data !== 'string') err(w + ': impact.data must be text.');
    };
    const proposal = (p, where, required) => {
      if (p === undefined) { if (required) err(w + ': "' + where + '" is required.'); return; }
      if (!p || typeof p !== 'object' || Array.isArray(p)) { err(w + ': "' + where + '" must be an object.'); return; }
      if (!str(p.summary)) err(w + ': ' + where + '.summary is required.');
      if (p.story !== undefined) story(p.story, where + '.story', 0);
      texts(p.steps, where + '.steps');
      diagram(p.diagram, where + '.diagram', 0);
      if (!Array.isArray(p.changes) || p.changes.length === 0) err(w + ': ' + where + '.changes must list at least one model change.');
      else p.changes.forEach((c, j) => {
        const cw = where + '.changes[' + j + ']';
        if (!c || typeof c !== 'object') { err(w + ': ' + cw + ' is not an object.'); return; }
        if (CHANGE_KINDS.indexOf(c.kind) === -1) err(w + ': ' + cw + ' "kind" must be one of ' + CHANGE_KINDS.join(', ') + '.');
        if (!str(c.target)) err(w + ': ' + cw + ' needs a "target" (a qualified name).');
        if (ACTIONS.indexOf(c.action) === -1) err(w + ': ' + cw + ' "action" must be add, change or remove.');
        if (!str(c.what)) err(w + ': ' + cw + ' needs "what" — one or two sentences.');
        if (c.action !== 'add' && str(c.target) && inPack(pack, c.kind, c.target) === false) warn(w + ': ' + cw + ' ' + c.target + ' is not in the pack — name an existing one as the pack does; for something new the action is "add".');
      });
      if (p.effort !== undefined && typeof p.effort !== 'string') err(w + ': ' + where + '.effort must be text.');
    };

    // ----- per kind -----
    if (kind === 'ticket') {
      if (VERDICTS.indexOf(it.verdict) === -1) err(w + ': "verdict" must be one of ' + VERDICTS.join(', ') + '.');
      if (CONFIDENCE.indexOf(it.confidence) === -1) err(w + ': "confidence" must be one of ' + CONFIDENCE.join(', ') + '.');
      if (!str(it.summary)) err(w + ': "summary" is required.');
      story(it.story, '"story"', 80);
      if (it.traced !== undefined) {
        if (!it.traced || typeof it.traced !== 'object') err(w + ': "traced" must be { steps, flows, diagram }.');
        else { texts(it.traced.steps, 'traced.steps'); flows(it.traced.flows, 'traced.flows'); diagram(it.traced.diagram, 'traced.diagram', 0); }
      } else warn(w + ': no "traced" — the behaviour as the model has it is what the verdict rests on.');
      if (it.evidence === undefined || (Array.isArray(it.evidence) && it.evidence.length === 0)) warn(w + ': no "evidence" — cite each place the verdict rests on.');
      else if (!Array.isArray(it.evidence)) err(w + ': "evidence" must be a list of { kind, target, what }.');
      else it.evidence.forEach((e, j) => {
        if (!e || CHANGE_KINDS.indexOf(e.kind) === -1 || !str(e.target) || !str(e.what)) err(w + ': evidence[' + j + '] needs "kind" (one of ' + CHANGE_KINDS.join(', ') + '), "target" and "what".');
        else if (inPack(pack, e.kind, e.target) === false) warn(w + ': evidence[' + j + '] ' + e.target + ' is not in the pack.');
      });
      texts(it.needs, '"needs"');
      if ((it.verdict === 'cannot-tell' || it.confidence === 'low') && !(Array.isArray(it.needs) && it.needs.length)) warn(w + ': ' + (it.verdict === 'cannot-tell' ? 'cannot-tell' : 'low confidence') + ' — say in "needs" what would settle it.');
      if (!str(it.reply)) warn(w + ': no "reply" — a few sentences to paste back into the ticket.');
      if (it.verdict === 'bug') { if (it.fix === undefined) warn(w + ': a bug — propose the fix in "fix".'); }
      proposal(it.fix, 'fix', false);
      if (it.risk !== undefined && !(typeof it.risk === 'string' && (SLUG.test(it.risk) || /^c-[0-9a-z-]+$/i.test(it.risk)))) err(w + ': "risk" must be a known risk\'s id, as the pack or the documentation gives it.');
      if (it.risk !== undefined && pack && pack.triage && pack.triage.length && !pack.triage.some((r) => r.id === it.risk)) warn(w + ': "risk" ' + it.risk + ' is not in the pack\'s risk triage — use it only when the documentation\'s Risks section gives that id.');
    }
    if (kind === 'jira') {
      if (!str(it.summary)) err(w + ': "summary" is required.');
      story(it.story, '"story"', 80);
      const s = it.scope;
      if (!s || typeof s !== 'object' || Array.isArray(s)) err(w + ': "scope" is required — { feasible, why, modules, touches }.');
      else {
        if (FEASIBLE.indexOf(s.feasible) === -1) err(w + ': scope.feasible must be one of ' + FEASIBLE.join(', ') + '.');
        if (!str(s.why)) warn(w + ': scope.why — say in a sentence why.');
        texts(s.modules, 'scope.modules');
        flows(s.touches, 'scope.touches');
      }
      proposal(it.proposal, 'proposal', true);
    }
    if (kind === 'idea') {
      const n = it.now;
      if (!n || typeof n !== 'object' || Array.isArray(n)) err(w + ': "now" is required — how it works today: { summary, story, steps, flows, diagram }.');
      else {
        if (!str(n.summary)) err(w + ': now.summary is required.');
        story(n.story, 'now.story', 80);
        texts(n.steps, 'now.steps');
        flows(n.flows, 'now.flows');
        diagram(n.diagram, 'now.diagram', 0);
      }
      proposal(it.proposal, 'proposal', true);
    }
    if (kind === 'jira' || kind === 'idea') {
      impact(it.impact);
      risks(it.risks, '"risks"');
      texts(it.open, '"open"');
      if (it.effort !== undefined && typeof it.effort !== 'string') err(w + ': "effort" must be text.');
      if (!str(it.effort)) warn(w + ': no "effort" — a rough size, in words.');
    }
    if (kind !== 'ticket' && it.reply !== undefined && typeof it.reply !== 'string') err(w + ': "reply" must be text.');
    if (kind === 'other') {
      if (!str(it.summary)) err(w + ': "summary" is required.');
      story(it.story, '"story"', 0);
      if (it.sources === undefined || (Array.isArray(it.sources) && !it.sources.length)) warn(w + ': no "sources" — name the flows the answer rests on.');
      flows(it.sources, '"sources"');
      proposal(it.proposal, 'proposal', false);
    }
  });
  return { errors, warnings };
}

// ---------- solved cases (reference/knowledge-format.md) ----------
// The case note's rules are MxScout's own (public/repodocs.js), carried by mendix-describe beside this skill.
function repoDocs() {
  const file = path.join(__dirname, '..', 'mendix-describe', 'repodocs.js');
  if (!fs.existsSync(file)) throw new Error('mendix-describe is not installed beside this skill (no ../mendix-describe/repodocs.js) — a case note is read with it.');
  const vm = require('vm');
  const ctx = { console, TextEncoder, crypto: require('crypto').webcrypto };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: 'repodocs.js' });
  return ctx.MxRepoDocs;
}
// A case note on disk, checked: { errors, warnings, value }.
function checkCase(file) {
  const text = fs.readFileSync(file, 'utf8');
  const r = repoDocs().caseCheck(text, 'knowledge/' + path.basename(file));
  return r;
}
// Where the solved cases are: <Mendix project>/mxscout/knowledge, <mxscout>/knowledge, <project folder>/knowledge —
// or a Mendix project with no MxScout at all: its mxscout/knowledge (which may not be there yet).
function knowledgeOf(folder) {
  if (path.basename(folder) === 'knowledge') return folder;
  if (fs.existsSync(path.join(folder, 'mxscout', 'mxscout.json')) || (fs.existsSync(path.join(folder, 'mxscout')) && !fs.existsSync(path.join(folder, 'project.json')))) return path.join(folder, 'mxscout', 'knowledge');
  if (fs.existsSync(path.join(folder, 'mxscout.json')) || fs.existsSync(path.join(folder, 'project.json'))) return path.join(folder, 'knowledge');
  if (fs.readdirSync(folder).some((f) => /\.mpr$/i.test(f))) return path.join(folder, 'mxscout', 'knowledge');
  return path.join(folder, 'knowledge');
}
// The commit HEAD names in the git repository the folder is in (read as files, no git program), or null.
function headOf(dir) {
  let d = path.resolve(dir);
  for (let i = 0; i < 8; i++) {
    let git = path.join(d, '.git');
    try {
      if (fs.statSync(git).isFile()) { const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(git, 'utf8')); git = m ? path.resolve(d, m[1].trim()) : null; }
      if (git) {
        const head = fs.readFileSync(path.join(git, 'HEAD'), 'utf8').trim();
        const ref = /^ref:\s*(refs\/\S+)$/.exec(head);
        if (!ref) return /^[0-9a-f]{40,64}$/.test(head) ? head : null;
        const common = fs.existsSync(path.join(git, 'commondir')) ? path.resolve(git, fs.readFileSync(path.join(git, 'commondir'), 'utf8').trim()) : git;
        try { return fs.readFileSync(path.join(common, ref[1]), 'utf8').trim(); } catch (e) {
          const l = (fs.readFileSync(path.join(common, 'packed-refs'), 'utf8').split('\n')).find((x) => x.endsWith(' ' + ref[1]));
          return l ? l.split(' ')[0] : null;
        }
      }
    } catch (e) { /* not here */ }
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}
// The cases, with how well each matches the words (front matter first, then the text), and whether the flows
// and pages they name changed since (with a pack: their fingerprints).
function cases(folder, opts) {
  opts = opts || {};
  const R = repoDocs();
  const dir = knowledgeOf(folder);
  const out = { dir, cases: [], unreadable: [], head: headOf(dir) };
  let names = [];
  try { names = fs.readdirSync(dir).filter((f) => /\.md$/i.test(f) && f[0] !== '.').sort(); } catch (e) { return out; }
  const words = String(opts.find || '').toLowerCase().split(/[\s,;]+/).filter((w) => w.length > 1);
  const pack = opts.pack || null;
  names.forEach((f) => {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const r = R.caseCheck(text, 'knowledge/' + f);
    if (!r.value) { out.unreadable.push(f + ': ' + r.errors[0]); return; }
    const c = r.value;
    const front = [c.id, c.title, c.kind, c.status].concat(c.flows, c.entities, c.pages, c.keywords, c.related).join(' ').toLowerCase();
    const all = text.toLowerCase();
    const score = words.reduce((n, w) => n + (front.indexOf(w) !== -1 ? 3 : all.indexOf(w) !== -1 ? 1 : 0), 0);
    const changed = [];
    if (pack) c.flows.concat(c.pages).forEach((qn) => {
      const now = pack.microflows[qn] || pack.nanoflows[qn] || pack.pages[qn];
      if (!now) { if (pack.modules[String(qn).split('.')[0]]) changed.push(qn + ' is not in the model any more'); return; }
      if (c.fingerprints[qn] && c.fingerprints[qn] !== now.hash) changed.push(qn + ' changed since (#' + c.fingerprints[qn] + ' → #' + now.hash + ')');
    });
    out.cases.push({ id: c.id, kind: c.kind, status: c.status, solved: c.solved || '', model: c.model, title: c.title, file: 'knowledge/' + f, score, changed,
      problem: R.caseSummary(c), problems: r.errors.length });
  });
  if (words.length) out.cases.sort((a, b) => b.score - a.score || (a.file < b.file ? -1 : 1));
  return out;
}
function printCases(r, opts) {
  if (!r.cases.length && !r.unreadable.length) { console.log('No solved cases in ' + r.dir + ' yet.'); return; }
  const shown = opts.find ? r.cases.filter((c) => c.score > 0) : r.cases;
  console.log((opts.find ? shown.length + ' of ' + r.cases.length + ' cases match' : r.cases.length + ' case' + (r.cases.length === 1 ? '' : 's')) + ' in ' + r.dir + (r.head ? ' (HEAD is ' + r.head.slice(0, 7) + ')' : '') + ':');
  shown.forEach((c) => {
    console.log(c.id + ' | ' + c.kind + ' | ' + c.status + ' | solved ' + (c.solved || '?') + ' | ' + c.title + ' | ' + c.file + (opts.find ? ' | match ' + c.score : ''));
    if (c.problem) console.log('    ' + c.problem);
    const at = c.model ? 'checked against ' + c.model.slice(0, 7) + (r.head ? (r.head.indexOf(c.model) === 0 ? ' — HEAD' : ' — not HEAD: git log --oneline ' + c.model.slice(0, 12) + '..HEAD shows what moved since') : '') : 'model commit not known';
    console.log('    ' + at);
    if (c.changed.length) console.log('    may be out of date: ' + c.changed.join('; '));
    if (c.problems) console.log('    (the note has ' + c.problems + ' problem(s) — node check-assist.js knowledge ' + c.file + ')');
  });
  r.unreadable.forEach((u) => console.log('not a case note: ' + u));
  if (shown.length) console.log('Read a matching case whole before you work the new item out, and cite it by its id.');
}

// ---------- list ----------
// Where the Assist items and the inbox are: the project folder itself — or, for a project kept inside the
// Mendix project (mxscout/), its .local/, which is this machine's only: Assist items are personal, never committed.
// (The same rule as mendix-describe's agent.js.) The local part of a project kept in its Mendix project (Karol, 2026-10-16): a folder of its own in the
// person's MxScout folder — $MXSCOUT_PROJECTS, or the one ~/.mxscout/library.json names (the mxscout-project
// skill sets it) — whose project.json has this project's id and "part": "local"; else mxscout/.local/, as before.
function localPartOf(mxscoutDir) {
  const os = require('os');
  const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };
  const mx = read(path.join(mxscoutDir, 'mxscout.json'));
  let home = process.env.MXSCOUT_PROJECTS || null;
  if (!home) { const c = read(path.join(os.homedir(), '.mxscout', 'library.json')); home = c && c.library; }
  if (mx && mx.id && home) {
    let names = [];
    try { names = fs.readdirSync(home); } catch (e) { names = []; }
    for (const n of names) {
      const pj = read(path.join(home, n, 'project.json'));
      if (pj && pj.part === 'local' && pj.id === mx.id) return path.join(home, n);
    }
  }
  return path.join(mxscoutDir, '.local');
}
function localOf(folder) {
  if (fs.existsSync(path.join(folder, 'mxscout', 'mxscout.json'))) return localPartOf(path.join(folder, 'mxscout'));
  if (fs.existsSync(path.join(folder, 'mxscout.json'))) return localPartOf(folder);
  return folder;
}
// The items under <folder>/assist/<kind>/*.json, as MxScout keeps them (a bare item; an envelope of one is
// read too), and the *.json files still waiting in <folder>/inbox/.
function list(folder, opts) {
  opts = opts || {};
  folder = localOf(folder);
  const items = [], problems = [], waiting = [];
  const kinds = opts.kind ? [opts.kind] : KINDS;
  kinds.forEach((kind) => {
    const dir = path.join(folder, 'assist', FOLDERS[kind]);
    let names = [];
    try { names = fs.readdirSync(dir).filter((f) => /\.json$/i.test(f)).sort(); } catch (e) { return; }
    names.forEach((f) => {
      const rel = path.join('assist', FOLDERS[kind], f);
      let it;
      try { it = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { problems.push(rel + ': not JSON'); return; }
      if (it && it.format === FORMAT && Array.isArray(it.items)) it = it.items[0];
      if (!it || typeof it !== 'object') { problems.push(rel + ': not an item'); return; }
      const h = Array.isArray(it.history) && it.history.length ? it.history[it.history.length - 1] : null;
      const asked = Array.isArray(it.questions) ? it.questions.filter((q) => q && q.status === 'open').length : 0;
      items.push({ kind, id: it.id || f.replace(/\.json$/i, ''), status: it.status || '?', asked, planned: it.planned || '', closed: it.closed || '',
        updated: it.updated || '', title: it.title || '', verdict: it.verdict || '', last: h ? h.date + ' ' + h.by + ': ' + h.what : '', file: rel });
    });
  });
  try { fs.readdirSync(path.join(folder, 'inbox')).filter((f) => /\.json$/i.test(f)).sort().forEach((f) => waiting.push(path.join('inbox', f))); } catch (e) { /* no inbox */ }
  const statuses = opts.status ? String(opts.status).split(',') : null;
  return { items: statuses ? items.filter((x) => statuses.indexOf(x.status) !== -1) : items, problems, waiting, hasAssist: fs.existsSync(path.join(folder, 'assist')) };
}

function printList(folder, r) {
  if (!r.hasAssist) console.log('No assist/ folder in ' + folder + ' yet: no items kept.');
  else if (!r.items.length) console.log('No items' + ' under ' + path.join(folder, 'assist') + ' match.');
  else {
    console.log('kind | id | status | open questions | planned | closed | updated | title');
    r.items.forEach((x) => console.log([x.kind, x.id, x.status + (x.verdict ? ' (' + x.verdict + ')' : ''), x.asked || '-', x.planned || '-', x.closed || '-', x.updated || '-', x.title].join(' | ')));
    const count = {};
    r.items.forEach((x) => { count[x.status] = (count[x.status] || 0) + 1; });
    console.log(r.items.length + ' item' + (r.items.length === 1 ? '' : 's') + ': ' + STATUSES.filter((s) => count[s]).map((s) => count[s] + ' ' + s).join(', ') + '. Each file is assist/<kind>/<id>.json — read it whole before you update it.');
  }
  r.problems.forEach((p) => console.log('unreadable: ' + p));
  if (r.waiting.length) console.log('waiting in inbox/ (not taken by MxScout yet — is the project open?): ' + r.waiting.join(', '));
}

// A file named without a path is the agent's own, in the work folder (mendix-describe's check-descriptions.js,
// "the work folder": $MXSCOUT_WORK, or <temp>/mxscout-work/<project>) — or here, when it is only here.
function inWork(file) {
  if (!file) return file;
  try {
    const W = require(path.join(__dirname, '..', 'mendix-describe', 'check-descriptions.js')).workplace;
    return W ? W.inWork(file, W.workFolder([process.cwd()]), true) : file;
  } catch (e) { return file; }
}

function main(argv) {
  const args = argv.slice();
  const take = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v === undefined ? null : v; };
  const packFile = inWork(take('--pack')), kind = take('--kind'), status = take('--status'), find = take('--find');
  const cmd = args[0], arg = cmd === 'check' || cmd === 'knowledge' ? inWork(args[1]) : args[1];
  if (cmd === 'check' && arg) {
    let env;
    try { env = JSON.parse(fs.readFileSync(arg, 'utf8')); } catch (e) { console.error(arg + ': ' + e.message.split('\n')[0]); return 1; }
    const early = [];
    const pack = packFile ? loadPack(packFile, (m) => early.push(m)) : null;
    const r = check(env, { pack });
    r.warnings = early.concat(r.warnings);
    r.errors.forEach((m) => console.log('error: ' + m));
    r.warnings.forEach((m) => console.log('warning: ' + m));
    const n = Array.isArray(env && env.items) ? env.items.length : 0;
    console.log(r.errors.length ? r.errors.length + ' error(s): MxScout would refuse this file. Fix them.' : 'OK: ' + n + ' item' + (n === 1 ? '' : 's') + (r.warnings.length ? ', ' + r.warnings.length + ' warning(s)' : '') + '.');
    return r.errors.length ? 1 : 0;
  }
  if (cmd === 'list' && arg) {
    if (kind && KINDS.indexOf(kind) === -1) { console.error('--kind must be one of ' + KINDS.join(', ')); return 2; }
    if (!fs.existsSync(arg)) { console.error('No such folder: ' + arg); return 1; }
    printList(localOf(arg), list(arg, { kind, status }));
    return 0;
  }
  if (cmd === 'knowledge' && arg) {
    if (!fs.existsSync(arg)) { console.error('No such file: ' + arg); return 1; }
    let r;
    try { r = checkCase(arg); } catch (e) { console.error(e.message); return 1; }
    r.errors.forEach((m) => console.log('error: ' + m));
    r.warnings.forEach((m) => console.log('warning: ' + m));
    console.log(r.errors.length ? r.errors.length + ' error(s): fix them before the note is committed — MxScout would refuse it.' : 'OK: ' + r.value.kind + ' ' + r.value.id + ' — ' + r.value.path + (r.warnings.length ? ', ' + r.warnings.length + ' warning(s)' : '') + '.');
    return r.errors.length ? 1 : 0;
  }
  if (cmd === 'cases' && arg) {
    if (!fs.existsSync(arg)) { console.error('No such folder: ' + arg); return 1; }
    const early = [];
    const pack = packFile ? loadPack(packFile, (m) => early.push(m)) : null;
    early.forEach((m) => console.log('warning: ' + m));
    try { printCases(cases(arg, { find, pack }), { find }); } catch (e) { console.error(e.message); return 1; }
    return 0;
  }
  console.error('Usage: node check-assist.js check <file.json> [--pack ai-pack.md] | list <project-folder> [--kind ticket|jira|idea|other] [--status open,in-progress] | knowledge <note.md> | cases <folder> [--find "words"] [--pack ai-pack.md]');
  return 2;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { check, list, localOf, main, checkCase, cases, knowledgeOf, FORMAT, KINDS, FOLDERS, STATUSES, QSTATUSES, VERDICTS };
