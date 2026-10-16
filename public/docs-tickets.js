/* MxScout — a ticket, as the Assist page draws it.
 *
 * A ticket is something reported on the application — a Jira issue, an e-mail
 * from a user — that an agent with the mendix-assist skill checked
 * against the model (Karol, 2026-10-14: "I paste a ticket, it checks whether
 * the ticket is right"): a verdict — a bug in the model, works as designed,
 * data or configuration, or cannot tell from the model — with how sure it is,
 * the reasoning, what the model does, the places in the model that show it,
 * what would settle it, a reply to paste back into the ticket, and for a bug
 * the idea that would fix it. It is an agent's judgement. MxScout shows it and
 * acts on none of it: nothing is sent to the tracker, and a ticket's source
 * address is shown as text, never opened or fetched.
 *
 * Since 2026-10-15 a ticket is an item on the Assist page (assist.js,
 * docs-assist.js), and no longer a page of the documentation: this file draws
 * one ticket's body for that page — the verdict, the reasoning, the evidence,
 * the reply with its Copy button. It has no references of its own: the page
 * hands it what it draws with each time. The exported documentation does not
 * carry it, because it carries no Assist item.
 *
 * It builds its DOM with the reader's builder, text only: everything here was
 * written by an agent or pasted from a ticket, and none of it can become markup.
 */
(function () {
  'use strict';

  // The verdicts, in the order a list sorts them: what needs fixing first.
  var VERDICTS = [['bug', 'Bug in the model'], ['data-config', 'Data or configuration'], ['as-designed', 'Works as designed'], ['cannot-tell', 'Cannot tell from the model']];
  var VERDICT = {};
  VERDICTS.forEach(function (v) { VERDICT[v[0]] = v[1]; });
  var KIND = { microflow: 'Microflow', nanoflow: 'Nanoflow', page: 'Page', entity: 'Entity', attribute: 'Attribute', association: 'Association', enumeration: 'Enumeration',
    security: 'Security', 'scheduled event': 'Scheduled event', integration: 'Integration', other: 'Other' };

  function badge(h, v) { return v ? h('span', { class: 'dx-tk-v ' + v, text: VERDICT[v] || v }) : null; }

  // kit: h, ln, paragraphs, plural, flowRows, diagram, place (qualified name, kind → the patch that opens
  // it, or null), idea (an idea's id → { title, summary, patch } or null), and with Developer tools on risk (a
  // risk's id → { r, no, at } on the Risks page, or null) — the known risk a ticket says it is about.
  // → the nodes of one ticket, under its heading: the verdict and why, what the model does, where it
  // shows it, and beside them what would settle it, the fix, the reply and the risks.
  function body(kit, t) {
    var h = kit.h, ln = kit.ln, out = [];
    function cap(text) { return h('h3', { class: 'dx-cap', text: text }); }
    function sec(kids) { return h('section', { class: 'dx-ch-sub' }, kids); }

    if (t.verdict || t.summary) {
      out.push(h('section', { class: 'dx-tk-verdict ' + (t.verdict || '') }, [
        t.verdict ? h('div', { class: 'dx-tk-vh' }, [badge(h, t.verdict), t.confidence ? h('span', { class: 'dx-tk-conf ' + t.confidence, text: t.confidence + ' confidence' }) : null]) : null,
        t.summary ? h('p', { class: 'dx-ch-lead', text: t.summary }) : null
      ]));
    }
    if (t.story) out.push(h('section', { class: 'dx-pd-sec' }, [cap('Why'), h('div', { class: 'dx-pd-story' }, kit.paragraphs(t.story).map(function (p) { return h('p', { text: p }); }))]));

    var tr = t.traced;
    if (tr && (tr.steps.length || tr.flows.length || tr.diagram.length)) {
      out.push(h('section', { class: 'dx-pd-sec dx-tk-traced' }, [cap('What the model does'),
        tr.steps.length ? h('ol', { class: 'dx-pd-steps dx-ch-steps' }, tr.steps.map(function (x, i) { return h('li', null, [h('span', { class: 'dx-pd-sn', text: String(i + 1) }), h('span', { text: x })]); })) : null,
        kit.diagram(tr.diagram, 'Diagram · as the model has it'),
        tr.flows.length ? sec([cap('Flows on its way · ' + tr.flows.length), kit.flowRows(tr.flows)]) : null]));
    }

    if (t.evidence && t.evidence.length) {
      out.push(h('section', { class: 'dx-pd-sec dx-tk-evidence' }, [cap('Where the model shows it · ' + t.evidence.length),
        h('table', { class: 'dx-ch-table' }, [
          h('thead', null, h('tr', null, [h('th', { text: 'Kind' }), h('th', { text: 'Where' }), h('th', { text: 'What it shows' })])),
          h('tbody', null, t.evidence.map(function (x) {
            var where = kit.place(x.target, x.kind);
            return h('tr', null, [h('td', { class: 'dx-tk-kind', text: KIND[x.kind] || x.kind }),
              h('td', { class: 'dx-ch-target' }, where ? ln(where, { class: 'dx-code link' }, x.target) : h('code', { class: 'dx-code', text: x.target })),
              h('td', { text: x.what || '' })]);
          }))
        ])]));
    }

    var fix = null;
    if (t.change) {
      var c = kit.idea ? kit.idea(t.change) : null;
      fix = sec([cap('Proposed fix'), c
        ? ln(c.patch, { class: 'dx-ch-row dx-tk-change' }, [h('span', { class: 'dx-ch-row-h' }, [h('b', { text: c.title })]), c.summary ? h('span', { class: 'dx-ch-row-s', text: c.summary }) : null, h('small', { text: 'Among the ideas' })])
        : h('p', { class: 'dx-ch-data' }, ['The idea ', h('code', { class: 'dx-code', text: t.change }), ' is not on this page.'])]);
    }
    // The known risk the ticket is about (an agent's, or one a person raised in a comment): a link to it on
    // the Risks page. Only where the risks are triaged (Developer tools), which hands kit.risk over.
    var rk = t.risk && kit.risk ? kit.risk(t.risk) : null;
    var side = [
      t.needs && t.needs.length ? sec([cap('What would settle it · ' + t.needs.length), h('ol', { class: 'dx-ch-open dx-tk-needs' }, t.needs.map(function (x) { return h('li', { text: x }); }))]) : null,
      fix,
      t.risk && kit.risk ? sec([cap('The risk it is about'), rk
        ? ln(rk.at, { class: 'dx-ch-row dx-tk-risk' }, [h('span', { class: 'dx-ch-row-h' }, [h('span', { class: 'dx-lv ' + rk.r.level.toLowerCase(), text: rk.r.level }), h('b', { text: rk.r.title })]),
          h('small', { text: rk.no + ' on the Risks page' + (rk.r.origin === 'person' ? ' · raised by ' + (rk.r.by || 'a person') : '') })])
        : h('p', { class: 'dx-ch-data' }, ['The risk ', h('code', { class: 'dx-code', text: t.risk }), ' is not in this documentation.'])]) : null,
      t.reply ? sec([cap('Suggested reply'), reply(h, t.reply)]) : null,
      t.risks && t.risks.length ? sec([cap('Risks · ' + t.risks.length), risks(h, t.risks)]) : null
    ].filter(Boolean);
    if (side.length) out.push(h('div', { class: 'dx-ch-more' }, side));
    return out;
  }

  // On a risk (docs-view.js, the Risks page, with Developer tools on): the tickets on the Assist page that say they
  // are about it, each with its verdict, a link back to the ticket. ids: the risk's own id and, for one a
  // person raised, its "c-" id.
  function forRisk(kit, tickets, ids) {
    var h = kit.h, mine = (tickets || []).filter(function (t) { return t.kind === 'ticket' && t.risk && ids.indexOf(t.risk) !== -1; });
    if (!mine.length) return null;
    return h('section', { class: 'dx-rk-sec dx-rk-tickets' }, [h('h3', { class: 'dx-cap', text: 'Tickets · ' + mine.length }),
      h('div', { class: 'dx-pd-rows' }, mine.map(function (t) {
        return kit.ln({ view: 'assist', akind: 'ticket', aid: t.id }, { class: 'dx-tk-onrisk' }, [
          h('span', null, ['Ticket ', h('code', { class: 'dx-tk-id', text: t.id }), ': ', t.verdict ? h('span', { class: 'dx-tk-v ' + t.verdict, text: VERDICT[t.verdict] || t.verdict }) : 'not checked yet']),
          h('small', { text: t.title })]);
      }))]);
  }

  function risks(h, list) {
    return h('div', { class: 'dx-pd-rows' }, list.map(function (r) {
      return h('div', { class: 'dx-ch-risk' }, [h('span', { class: 'dx-lv ' + r.level.toLowerCase(), text: r.level }), h('div', null, [h('b', { text: r.title }),
        r.detail ? h('p', { text: r.detail }) : null, r.fix ? h('p', null, [h('b', { text: 'What to do. ' }), r.fix]) : null])]);
    }));
  }

  // A reply to paste back, with the button that copies it.
  function reply(h, text) { return h('div', { class: 'dx-tk-reply' }, [h('p', { class: 'dx-tk-reply-t', text: text }), copyButton(h, text)]); }

  // Copies the reply to the clipboard and says so on the button; where the browser will not, it selects
  // the text instead, for Ctrl C. Nothing leaves the page.
  function copyButton(h, text) {
    var b = h('button', { type: 'button', class: 'mf-btn dx-tk-copy', text: 'Copy reply' });
    b.addEventListener('click', function () {
      function said() { b.textContent = 'Reply copied'; b.classList.add('done'); setTimeout(function () { b.textContent = 'Copy reply'; b.classList.remove('done'); }, 2000); }
      function select() {
        var p = b.parentNode && b.parentNode.querySelector('.dx-tk-reply-t'), sel = window.getSelection && window.getSelection();
        if (!p || !sel) return;
        var r = document.createRange(); r.selectNodeContents(p); sel.removeAllRanges(); sel.addRange(r);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(said, select); else select();
    });
    return b;
  }

  window.MxDocsTickets = { body: body, badge: badge, reply: reply, risks: risks, forRisk: forRisk, VERDICTS: VERDICTS, VERDICT: VERDICT };
})();
