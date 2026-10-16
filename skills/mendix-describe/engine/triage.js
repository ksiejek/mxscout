/* MxScout — risk triage: the risks in the documentation as something to work through.
 *
 * Karol, 2026-10-14: "I get risks, I fix things, I update the model, it checks
 * whether they are still there." A risk an AI agent wrote (describe.js), or one a
 * person raised in a comment (comments.js, a comment marked as a risk), can be
 * marked a FALSE POSITIVE with the reason, or FIXED with a note; Reopen undoes
 * either. What was decided is kept per project, in this browser's database
 * (store.js, the `triage` store), apart from the descriptions: importing new
 * descriptions replaces them, and the decisions stay.
 *
 * When new descriptions come in (a file, the agent channel, the chat
 * assistant), they are reconciled against what was decided: a risk marked
 * fixed that the agent reports again is REOPENED; one a full file no longer
 * lists is VERIFIED; a false positive reported again stays a false positive,
 * and the history says it came back; an open risk a full file no longer lists
 * is marked GONE ("no longer reported"). A file that adds (one process) says
 * nothing about the risks it does not list, and a file without a risks list
 * touches no risk. Risks a person raised are theirs: an import leaves them as
 * they are, except where the agent answers for one marked fixed (`verify`).
 *
 * Only open and reopened risks count as risks — on the Risks page, in the
 * overview, beside a flow. The rest stay on the Risks page under their own
 * filter, with their reason and their history, and travel in the exported
 * documentation as labels (read-only there) and in the .mxscout package.
 * Each entry keeps a copy of the risk as it was last seen, so a risk the agent
 * no longer writes is still shown, with what was decided about it.
 *
 * Every text here is set as text. Nothing is sent anywhere.
 */
(function () {
  'use strict';

  var app = null; // { el, store, render, setMessage, findings(projectId), author(), setCommentStatus(id, status) }
  // projectId -> the triage record ({ projectId, risks: { key: entry }, updatedAt }), null when there is
  // none, undefined while it loads.
  var recs = {};
  var dialog = null; // { projectId, risk, to, note, error, busy }

  var LABEL = { open: 'Open', reopened: 'Reopened', fixed: 'Fixed — to verify', verified: 'Verified', 'false-positive': 'False positive', gone: 'No longer reported' };
  var COUNTED = { open: true, reopened: true };
  var HISTORY_MAX = 40;
  var KIND_TAG = { entity: 'en', microflow: 'mf', nanoflow: 'nf', page: 'pg' };

  function init(api) {
    app = api;
    // Another tab decided about a risk: read the record again rather than draw — and later save over — the old copy.
    if (app.store.onOtherTab) app.store.onOtherTab(function (name, projectId) { if (name === 'triage' && Object.prototype.hasOwnProperty.call(recs, projectId)) { forget(projectId); app.render(); } });
  }

  function now() { return new Date().toISOString(); }
  function clone(x) { return x ? JSON.parse(JSON.stringify(x)) : x; }
  function empty(projectId) { return { projectId: projectId, risks: {}, updatedAt: null }; }

  // ---------- storage ----------
  function load(projectId) {
    if (!projectId || Object.prototype.hasOwnProperty.call(recs, projectId)) return;
    recs[projectId] = undefined;
    app.store.get('triage', projectId).then(function (row) { recs[projectId] = row || null; app.render(); }, function () { recs[projectId] = null; });
  }
  // The record of a project: null when nothing was decided, undefined while it loads (a render follows).
  function recordFor(projectId) { load(projectId); return recs[projectId]; }
  // Read again from storage on the next draw (a package brought decisions in).
  function forget(projectId) { delete recs[projectId]; }
  // Every change is made on the record as the database holds it NOW — read, changed and written in one
  // transaction, with a revision number (store.update) — never on this tab's copy, which a second tab's save
  // makes stale (an external audit, 2026-10-15, B05). fn(current or null) → the record to keep, or undefined.
  function change(projectId, fn) {
    return app.store.update('triage', projectId, function (cur) {
      var rec = fn(cur || null);
      if (rec) rec.updatedAt = now();
      return rec || undefined;
    }).then(function (r) { recs[projectId] = r.value || null; return r.value; });
  }

  // ---------- identity ----------
  function riskKey(r) { return r.key || window.MxDescribe.riskKey(r); }
  // An AI risk's entry: by its key, or by its level and title when the agent has since given it an id.
  function find(E, r) {
    var k = riskKey(r);
    if (E[k]) return E[k];
    if (r.origin === 'person') return null;
    var t = window.MxDescribe.titleKey(r), hit = null;
    Object.keys(E).forEach(function (x) { if (!hit && E[x].origin !== 'person' && E[x].tkey === t) hit = E[x]; });
    return hit;
  }
  function snapshot(r) {
    return { id: r.id || null, level: r.level, title: r.title, detail: r.detail || null, fix: r.fix || null, theme: r.theme || null, where: (r.where || []).slice(0, 40) };
  }
  function entryFor(r, status) {
    return { key: riskKey(r), tkey: r.origin === 'person' ? null : window.MxDescribe.titleKey(r), origin: r.origin === 'person' ? 'person' : 'ai',
      status: status || 'open', note: null, by: null, at: null, risk: snapshot(r), history: [] };
  }
  function log(e, item) {
    e.history.push(item);
    if (e.history.length > HISTORY_MAX) e.history = e.history.slice(-HISTORY_MAX);
  }
  // A change MxScout made itself, on an update.
  function move(e, to, note, when) {
    log(e, { at: when, by: null, from: e.status, to: to, note: note, auto: true });
    e.status = to; e.at = when;
  }

  // ---------- a comment that is a risk ----------
  // Its first line is the title; the rest, when there is more, its detail; what should change, its fix.
  function commentRisk(f) {
    if (!f || !/^P[123]$/.test(f.risk || '') || !f.target) return null;
    var text = String(f.problem || '').trim(), lines = text.split(/\n/);
    var title = lines[0].trim(), detail = lines.slice(1).join('\n').trim() || null;
    if (title.length > 200) { detail = text; title = title.slice(0, 199) + '…'; }
    var tag = KIND_TAG[f.target.kind];
    return {
      id: null, level: f.risk, title: title || '(no title)', detail: detail, fix: f.change || null, theme: null,
      where: [f.target.qualifiedName + (tag ? '|' + tag : '')],
      origin: 'person', by: f.author || 'you', raisedAt: f.createdAt || null, key: 'c:' + f.id, pid: 'c-' + f.id
    };
  }

  // ---------- every risk, with what was decided ----------
  // The agent's risks in the order of its file, then the risks people raised, then what is kept of
  // risks the agent no longer writes. Each a copy, with its status; `no` is its place, for its address.
  // from: { rec, findings } read from storage (docs.js repoDocs) — the record and the comments as they are kept,
  // not this tab's copies, which may still be loading or belong only to the open project.
  function view(projectId, descValue, from) {
    load(projectId);
    var rec = (from ? from.rec : recs[projectId]) || null, E = rec ? rec.risks : {};
    var seen = {}, out = [];
    function put(r, e) {
      var k = e ? e.key : riskKey(r);
      if (seen[k]) return;
      seen[k] = true;
      if (e) seen[e.key] = true;
      var x = Object.assign({}, r, { key: k, origin: r.origin || 'ai', status: e ? e.status : 'open', note: e ? e.note : null, decidedBy: e ? e.by : null, decidedAt: e ? e.at : null, history: e ? e.history.slice() : [] });
      out.push(x);
    }
    ((descValue && descValue.risks) || []).forEach(function (r) { put(Object.assign({}, r, { origin: 'ai' }), find(E, Object.assign({}, r, { origin: 'ai' }))); });
    ((from ? from.findings : app.findings(projectId)) || []).forEach(function (f) { var r = commentRisk(f); if (r) put(r, E[r.key] || null); });
    Object.keys(E).map(function (k) { return E[k]; }).filter(function (e) { return e.origin !== 'person' && !seen[e.key]; })
      .sort(function (a, b) { return String(a.at || '').localeCompare(String(b.at || '')); })
      .forEach(function (e) { put(Object.assign({}, e.risk, { origin: 'ai', key: e.key }), e); });
    out.forEach(function (r, i) { r.no = i + 1; });
    return out;
  }
  function counted(r) { return !!COUNTED[r.status || 'open']; }

  // Onto the documentation's data (docs.js, after describe.js attach): the risks that count in
  // data.ai.risks, the rest in data.ai.triaged. With no descriptions but risks people raised, the
  // data gets an ai part of its own, which says no agent wrote anything (agent: false).
  function apply(data, projectId, descValue, from) {
    var rows = view(projectId, descValue, from);
    if (!data.ai) {
      if (!rows.length) return data;
      data.ai = { app: null, by: null, written: null, language: null, risks: [], context: null, c4: null, modules: {}, agent: false };
    }
    data.ai.risks = rows.filter(counted);
    data.ai.triaged = rows.filter(function (r) { return !counted(r); });
    return data;
  }
  // The risks that count, by the documents they name — for the Microflows screen (microflows.js).
  function riskIndex(projectId, descValue) { return window.MxDescribe.riskIndex({ risks: view(projectId, descValue).filter(counted) }); }

  // What the documentation is drawn from changes when this does: what was decided, and the comments marked as risks.
  function stamp(projectId) {
    var rec = recs[projectId];
    return String(rec ? rec.updatedAt : '') + '|' + (app.findings(projectId) || []).filter(function (f) { return f.risk; })
      .map(function (f) { return f.id + ':' + f.risk + ':' + f.updatedAt; }).join(',');
  }

  // ---------- reconciling with new descriptions ----------
  // incoming: the file as parsed (describe.js parse), before it is merged; previous: the descriptions
  // kept before it. Returns the new record and what happened; the record passed in is not changed.
  function reconcile(rec, incoming, previous, when, projectId) {
    rec = clone(rec) || empty(projectId);
    var E = rec.risks, sum = { reopened: 0, verified: 0, kept: 0, gone: 0, back: 0, people: 0 };
    var date = String(when).slice(0, 10);
    // What the agent says about risks people raised and marked fixed.
    (incoming.verify || []).forEach(function (v) {
      var e = E['c:' + v.id.slice(2)];
      if (!e || e.origin !== 'person' || e.status !== 'fixed') return;
      move(e, v.still ? 'reopened' : 'verified', (v.still ? 'the agent still finds it after the fix' : 'the agent no longer finds it') + (v.why ? ': ' + v.why : '') + ', ' + date, when);
      sum.people++;
    });
    var listed = incoming.risksListed || (incoming.risks && incoming.risks.length);
    if (!listed) return { rec: rec, sum: sum };
    var keys = {}, tkeys = {};
    (incoming.risks || []).forEach(function (r0) {
      var r = Object.assign({}, r0, { origin: 'ai' });
      var k = riskKey(r), t = window.MxDescribe.titleKey(r);
      keys[k] = true; tkeys[t] = true;
      var e = find(E, r);
      if (!e) return;
      // The agent gave it an id since: from now on it is known by that.
      if (e.key !== k) { delete E[e.key]; e.key = k; E[k] = e; }
      e.tkey = t; e.risk = snapshot(r);
      if (e.status === 'fixed' || e.status === 'verified') { move(e, 'reopened', 'still found after the fix, ' + date, when); sum.reopened++; }
      else if (e.status === 'gone') { move(e, 'open', 'reported again, ' + date, when); sum.back++; }
      else if (e.status === 'false-positive') { log(e, { at: when, by: null, from: e.status, to: e.status, note: 'reported again, kept as false positive, ' + date, auto: true }); sum.kept++; }
    });
    var absent = function (k, t) { return !keys[k] && !(t && tkeys[t]); };
    if (!incoming.add) {
      Object.keys(E).forEach(function (k) {
        var e = E[k];
        if (e.origin === 'person' || !absent(e.key, e.tkey)) return;
        if (e.status === 'fixed') { move(e, 'verified', 'not found any more, ' + date, when); sum.verified++; }
        else if (e.status === 'open' || e.status === 'reopened') { move(e, 'gone', 'no longer reported, ' + date, when); sum.gone++; }
      });
      // An open risk nobody had touched, which the new file no longer lists: kept, as gone.
      ((previous && previous.risks) || []).forEach(function (r0) {
        var r = Object.assign({}, r0, { origin: 'ai' });
        if (!absent(riskKey(r), window.MxDescribe.titleKey(r)) || find(E, r)) return;
        var e = entryFor(r, 'open');
        move(e, 'gone', 'no longer reported, ' + date, when);
        E[e.key] = e; sum.gone++;
      });
    }
    return { rec: rec, sum: sum };
  }

  // After new descriptions were kept (docs.js): reconcile, save, and say what happened in a sentence.
  function afterImport(projectId, incoming, previous) {
    var s = null;
    return change(projectId, function (rec) {
      var r = reconcile(rec || null, incoming, previous, now(), projectId);
      s = r.sum;
      if (!s.reopened && !s.verified && !s.kept && !s.gone && !s.back && !s.people && !rec) return undefined;
      return r.rec;
    }).then(function (kept) {
      if (!kept) return '';
      return Promise.resolve().then(function () {
        var parts = [];
        if (s.verified) parts.push(s.verified + ' fixed ' + (s.verified === 1 ? 'risk' : 'risks') + ' verified');
        if (s.reopened) parts.push(s.reopened + ' reopened — still found after the fix');
        if (s.kept) parts.push(s.kept + ' false ' + (s.kept === 1 ? 'positive' : 'positives') + ' reported again, kept as such');
        if (s.gone) parts.push(s.gone + ' no longer reported');
        if (s.back) parts.push(s.back + ' reported again');
        if (s.people) parts.push(s.people + ' raised by people checked by the agent');
        return parts.length ? ' Risks: ' + parts.join(', ') + '.' : '';
      });
    });
  }

  // ---------- a person's decision ----------
  function set(projectId, risk, to, note) {
    var e = null;
    return change(projectId, function (cur) {
      var rec = clone(cur) || empty(projectId);
      e = find(rec.risks, risk);
      if (!e) { e = entryFor(risk, risk.status || 'open'); rec.risks[e.key] = e; }
      var when = now(), by = app.author() || null;
      log(e, { at: when, by: by, from: e.status, to: to, note: note || null });
      e.status = to; e.note = note || null; e.by = by; e.at = when;
      if (risk.origin !== 'person') e.risk = snapshot(risk);
      return rec;
    }).then(function () {
      // A comment that is a risk says the same on the Comments page.
      if (risk.origin === 'person' && app.setCommentStatus) app.setCommentStatus(String(risk.key).slice(2), to === 'false-positive' ? 'wontfix' : to === 'fixed' || to === 'verified' ? 'fixed' : 'open');
      return e;
    });
  }

  // The buttons on a risk (the Risks page's hook, docs-view.js opts.riskActions).
  function actions(projectId, risk) {
    var el = app.el;
    if (!projectId || !risk) return [];
    function open(to) { return function () { dialog = { projectId: projectId, risk: risk, to: to, note: '', error: null, busy: false }; app.render(); }; }
    if (counted(risk)) return [
      el('button', { type: 'button', class: 'btn btn-sm', text: 'False positive…', title: 'Not a risk: say why, and it leaves the count', onclick: open('false-positive') }),
      el('button', { type: 'button', class: 'btn btn-sm btn-primary', text: 'Mark fixed…', title: 'You fixed it: the next update checks whether it is still there', onclick: open('fixed') })
    ];
    return [el('button', { type: 'button', class: 'btn btn-sm', text: 'Reopen', title: 'Count it as an open risk again', onclick: function () {
      set(projectId, risk, 'open', null).then(function () { app.setMessage('Risk reopened.', 'ok'); app.render(); }, function (err) { app.setMessage('Could not save: ' + ((err && err.message) || err), 'error'); app.render(); });
    } })];
  }

  function renderDialog() {
    if (!dialog) return null;
    var el = app.el, d = dialog;
    var fp = d.to === 'false-positive';
    var close = function () { if (d.busy) return; dialog = null; app.render(); };
    var area = el('textarea', { class: 'editor-area', rows: '5', placeholder: fp ? 'Why is this not a risk? (required)' : 'What did you change? (optional)' });
    area.value = d.note;
    area.addEventListener('input', function () { d.note = area.value; });
    function submit() {
      var note = String(d.note || '').trim();
      if (fp && !note) { d.error = 'Say why it is not a risk — the reason is what the next reader and the agent go by.'; app.render(); return; }
      d.busy = true; app.render();
      set(d.projectId, d.risk, d.to, note).then(function () {
        dialog = null;
        app.setMessage(fp ? 'Marked as a false positive. It no longer counts as a risk; it stays under False positive.' : 'Marked fixed. The next update of the descriptions checks whether it is still there.', 'ok');
        app.render();
      }, function (err) { d.busy = false; d.error = 'Could not save: ' + ((err && err.message) || err); app.render(); });
    }
    var backdrop = el('div', { class: 'modal-backdrop', onclick: function (e) { if (e.target === backdrop) close(); } }, [window.MxDialog.modal(el('div', { class: 'modal triage-modal' }, [
      el('h3', { text: fp ? 'Mark as a false positive' : 'Mark as fixed' }),
      el('p', { class: 'triage-risk' }, [el('b', { text: d.risk.level + ' · ' }), document.createTextNode(d.risk.title)]),
      el('p', { text: fp ? 'It stops counting as a risk and stays on the Risks page under False positive, with your reason. The agent is told, and does not raise it again unless the model changes so the reason no longer holds.'
        : 'It stops counting as a risk and waits under Fixed — to verify. When new descriptions come in, MxScout checks: still reported, it is reopened; gone, it is verified.' }),
      el('label', { class: 'field' }, [el('span', { text: fp ? 'Reason' : 'Note' }), area]),
      d.error ? el('p', { class: 'warn-text', text: d.error }) : null,
      el('div', { class: 'modal-actions' }, [
        el('button', { class: 'btn', text: 'Cancel', onclick: close }),
        el('button', { class: 'btn btn-primary', text: d.busy ? 'Saving…' : fp ? 'Mark false positive' : 'Mark fixed', disabled: d.busy ? 'disabled' : null, onclick: submit })
      ])
    ]), close)]);
    return backdrop;
  }

  // ---------- in a package ----------
  // A whitelist, like comments.js serialize: what leaves is named here. Without the comments, the
  // decisions about risks people raised in them stay behind too.
  function serialize(rec, withComments) {
    if (!rec || !rec.risks) return null;
    var out = {};
    Object.keys(rec.risks).forEach(function (k) {
      var e = rec.risks[k];
      if (e.origin === 'person' && !withComments) return;
      out[k] = { key: e.key, tkey: e.tkey || null, origin: e.origin, status: e.status, note: e.note || null, by: e.by || null, at: e.at || null, risk: e.risk,
        history: (e.history || []).map(function (h) { return { at: h.at, by: h.by || null, from: h.from, to: h.to, note: h.note || null, auto: !!h.auto }; }) };
    });
    return Object.keys(out).length ? { risks: out } : null;
  }
  // What a package brought, checked as an import checks a file: known statuses, bounded text.
  function str(v, max) { return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null; }
  function clean(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object' || !raw.risks || typeof raw.risks !== 'object') return out;
    Object.keys(raw.risks).slice(0, 5000).forEach(function (k) {
      var e = raw.risks[k], r = e && e.risk;
      if (!e || typeof e !== 'object' || !LABEL[e.status] || !r || !/^P[123]$/.test(r.level) || !str(r.title, 300) || typeof k !== 'string' || k.length > 400) return;
      out[k] = { key: k, tkey: str(e.tkey, 400), origin: e.origin === 'person' ? 'person' : 'ai', status: e.status, note: str(e.note, 2000), by: str(e.by, 200), at: str(e.at, 40),
        risk: { id: str(r.id, 80), level: r.level, title: str(r.title, 300), detail: str(r.detail, 3000), fix: str(r.fix, 1000), theme: str(r.theme, 20),
          where: (Array.isArray(r.where) ? r.where : []).map(function (w) { return str(w, 300); }).filter(Boolean).slice(0, 40) },
        history: (Array.isArray(e.history) ? e.history : []).slice(-HISTORY_MAX).filter(function (h) { return h && LABEL[h.to] && LABEL[h.from]; })
          .map(function (h) { return { at: str(h.at, 40), by: str(h.by, 200), from: h.from, to: h.to, note: str(h.note, 2000), auto: !!h.auto }; }) };
    });
    return out;
  }
  // Into this browser: per risk, the copy decided last wins — a package travels both ways.
  function takeFromPackage(projectId, raw) {
    var incoming = clean(raw);
    if (!Object.keys(incoming).length) return Promise.resolve(0);
    var n = 0;
    return change(projectId, function (cur) {
      var rec = clone(cur) || empty(projectId);
      Object.keys(incoming).forEach(function (k) {
        var mine = rec.risks[k];
        if (!mine || String(incoming[k].at || '') > String(mine.at || '')) { rec.risks[k] = incoming[k]; n++; }
      });
      return n ? rec : undefined;
    }).then(function () { if (n) forget(projectId); return n; });
  }

  function remove(projectId) { recs[projectId] = null; }

  // Puts back a record as it was before an import reconciled it (docs.js Undo); null removes it.
  function restore(projectId, rec) {
    if (!projectId) return Promise.resolve();
    var done = rec ? app.store.put('triage', rec) : app.store.delete('triage', projectId);
    return done.then(function () { recs[projectId] = rec || null; });
  }
  window.MxTriage = {
    init: init, recordFor: recordFor, forget: forget, remove: remove, view: view, apply: apply, riskIndex: riskIndex, stamp: stamp,
    reconcile: reconcile, afterImport: afterImport, restore: restore, set: set, actions: actions, renderDialog: renderDialog,
    serialize: serialize, clean: clean, takeFromPackage: takeFromPackage, commentRisk: commentRisk, LABEL: LABEL
  };
})();
