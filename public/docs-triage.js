/* MxScout — the documentation's side of the risk triage (Developer tools).
 *
 * triage.js keeps what a person decided about a risk — fixed, a false
 * positive, reopened — and what MxScout concluded on an update (verified, no
 * longer reported), and hands the documentation its risks with that status
 * on them. This file is how the documentation reader (docs-view.js) shows it:
 * the status beside a risk, who raised it, what was decided and the history,
 * the filter by status and by whose a risk is, and the Markdown copy's list of
 * the risks that no longer count.
 *
 * Like docs-changes.js and docs-tickets.js, it is part of the reader in a file
 * of its own so the reader stays under 3,000 lines. It has no references of
 * its own: the reader hands it what it draws with each time. The exported file
 * carries it beside the flow drawing (docs-file.js SCRIPTS), so the file shows
 * the same labels, read-only, as MxScout does.
 *
 * It builds its DOM with the reader's builder, text only: notes and names were
 * written by people and agents, and none of it can become markup.
 */
(function () {
  'use strict';

  // Where a risk stands: only open and reopened ones count as risks; the rest are kept on the Risks page
  // under their own filter, with what was decided.
  var RS = { open: 'Open', reopened: 'Reopened', fixed: 'Fixed — to verify', verified: 'Verified', 'false-positive': 'False positive', gone: 'No longer reported' };
  var RS_GROUP = { open: 'open', reopened: 'open', fixed: 'fixed', verified: 'verified', 'false-positive': 'fp', gone: 'gone' };
  var RS_FILTERS = [['open', 'Open'], ['fixed', 'Fixed — to verify'], ['verified', 'Verified'], ['fp', 'False positive'], ['gone', 'No longer reported'], ['all', 'All']];

  // A risk's status as a label beside it; nothing for an open one.
  function statusMark(h, st0) { return st0 && st0 !== 'open' ? h('span', { class: 'dx-rs dx-rs-' + st0, text: RS[st0] }) : null; }

  // Who wrote a risk: an agent (the reader's ✦ AI mark), or a person, in a comment.
  function originMark(kit, r) {
    return r.origin === 'person' ? kit.h('span', { class: 'dx-rk-by', title: 'Raised by a person, in a comment' + (r.raisedAt ? ' on ' + kit.fmtDate(r.raisedAt) : ''), text: 'raised by ' + (r.by || 'a person') }) : kit.aiMark();
  }

  // What was decided about a risk: the reason or note, who and when, and its history, newest first.
  // x: the Risks page's row ({ r: the risk, s: its status }).
  function block(kit, x) {
    var h = kit.h, r = x.r, hist = (r.history || []).slice().reverse();
    if (!r.note && !hist.length) return null;
    return h('section', { class: 'dx-rk-sec dx-rk-tri' }, [
      h('h3', { class: 'dx-cap', text: x.s === 'false-positive' ? 'Why it is not a risk' : x.s === 'fixed' || x.s === 'verified' ? 'The fix' : 'Status' }),
      r.note ? h('p', { class: 'dx-rk-p', text: r.note }) : null,
      r.decidedAt ? h('p', { class: 'dx-rk-tri-who', text: RS[x.s] + (r.decidedBy ? ' · ' + r.decidedBy : '') + ' · ' + kit.fmtDate(r.decidedAt) }) : null,
      hist.length ? h('details', { class: 'dx-rk-hist' }, [h('summary', { text: 'History · ' + hist.length }), h('ol', null, hist.map(function (e) {
        return h('li', null, [h('span', { class: 'mono', text: kit.fmtDate(e.at) }), h('span', { text: (RS[e.from] || e.from) + ' → ' + (RS[e.to] || e.to) + (e.by ? ' · ' + e.by : e.auto ? ' · on an update' : '') + (e.note ? ' — ' + e.note : '') })]);
      }))]) : null
    ]);
  }

  // The status filter above the list: Open by default; fixed, verified, false positives and the ones no
  // longer reported each under their own, as history rather than risks. And whose: an agent's or a person's.
  // kit: h, everything (every row), inOrigin (row → whether the origin filter keeps it), rf (the page's
  // filters), setF (patch → applies it), shown (whether there is anything to filter), people, agents.
  function statusBar(kit) {
    var h = kit.h, rf = kit.rf, stCount = {};
    if (!kit.shown) return null;
    kit.everything.forEach(function (x) { if (kit.inOrigin(x)) { var g = RS_GROUP[x.s]; stCount[g] = (stCount[g] || 0) + 1; stCount.all = (stCount.all || 0) + 1; } });
    return h('div', { class: 'dx-rk-status', role: 'group', 'aria-label': 'Status' }, RS_FILTERS.filter(function (f) {
      return f[0] === 'open' || f[0] === 'all' || stCount[f[0]] || (rf.st || 'open') === f[0];
    }).map(function (f) {
      var on = (rf.st || 'open') === f[0];
      return h('button', { type: 'button', class: 'dx-rk-st' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', onclick: function () { kit.setF({ st: f[0] === 'open' ? null : f[0] }); } },
        [f[1], h('span', { class: 'dx-fc-n', text: String(stCount[f[0]] || 0) })]);
    }).concat(kit.people && kit.agents ? [h('span', { class: 'dx-rk-st-gap' })].concat([[null, 'Everyone'], ['ai', '✦ AI'], ['person', 'People']].map(function (o) {
      var on = rf.or === o[0];
      return h('button', { type: 'button', class: 'dx-rk-st or' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', text: o[1], onclick: function () { kit.setF({ or: o[0] }); } });
    })) : []));
  }

  // The Markdown copy: the risks no longer counted, with what was decided about each, as history.
  // kit: w (writes a line), esc (Markdown-escapes text), counted (how many risks still count).
  function markdown(triaged, kit) {
    var w = kit.w, esc = kit.esc;
    if (!triaged.length) return;
    if (!kit.counted) { w('## Risks'); w(); w('No open risks.'); w(); }
    w('### Not counted as risks (' + triaged.length + ')'); w();
    w('Marked fixed or a false positive, or no longer reported by the agent.'); w();
    triaged.forEach(function (r) {
      var n = String(r.no || ''), id = 'R-' + (n.length < 3 ? ('00' + n).slice(-3) : n);
      w('- ' + id + ' · ' + r.level + ' · ' + esc(r.title) + ' — ' + (RS[r.status] || r.status) + (r.note ? ': ' + esc(r.note) : '') + (r.origin === 'person' ? ' (raised by ' + esc(r.by || 'a person') + ')' : ''));
    });
    w();
  }

  window.MxDocsTriage = { RS: RS, RS_GROUP: RS_GROUP, RS_FILTERS: RS_FILTERS, statusMark: statusMark, originMark: originMark, block: block, statusBar: statusBar, markdown: markdown };
})();
