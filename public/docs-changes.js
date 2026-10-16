/* MxScout — a change, as the Assist page draws it.
 *
 * A change is something the person wants made to the application, worked out
 * by an agent ("A change, when the person asks"; Karol, 2026-10-14): how that
 * part of the application works now, the solution it proposes, the concrete
 * changes to the model, and what they touch. It is a proposal. MxScout shows
 * it; nothing of it is applied to the model or anywhere else.
 *
 * Since 2026-10-15 a change is an idea, or the proposal of a Jira issue, on
 * the Assist page (assist.js, docs-assist.js), and no longer a page of the
 * documentation. This file draws those parts for that page: now beside the
 * proposal, the model changes grouped by kind with a link to what is already
 * there and "new" on what is not, and the impact, risks, open questions and
 * effort. It has no references of its own: the page hands it what it draws
 * with each time. The exported documentation does not carry it.
 *
 * It builds its DOM with the reader's builder, text only: everything here was
 * written by an agent, and none of it can become markup.
 */
(function () {
  'use strict';

  // The model changes, grouped by what they change, in the order a developer works through them.
  var KINDS = [['entity', 'Entities'], ['attribute', 'Attributes'], ['association', 'Associations'], ['enumeration', 'Enumerations'],
    ['microflow', 'Microflows'], ['nanoflow', 'Nanoflows'], ['page', 'Pages'], ['security', 'Security'],
    ['scheduled event', 'Scheduled events'], ['integration', 'Integrations'], ['other', 'Other']];
  var ACTION = { add: 'Add', change: 'Change', remove: 'Remove' };

  // Where a qualified name a change names is in the documentation's data: the patch that opens it,
  // or null. An attribute or an association opens its entity. flowKey is the reader's.
  function placeOf(data, flowKey, qn, kind) {
    var seg = { microflow: 'mf', nanoflow: 'nf', page: 'pg' }[kind];
    var k = (seg || kind === 'other') ? flowKey(qn, seg) : null;
    if (k) return { view: 'refs', module: data.flows[k].module, seg: data.flows[k].kind, key: k };
    var parts = String(qn).split('.'), ent = parts.length === 3 ? parts[0] + '.' + parts[1] : qn;
    if (kind === 'attribute' && data.entities[ent] && !(data.entities[ent].attributes || []).some(function (a) { return a.name === parts[2]; })) return null;
    if ((kind === 'entity' || kind === 'attribute' || kind === 'other') && data.entities[ent]) return { view: 'domain', entity: ent, dmodule: data.entities[ent].module };
    var as = kind === 'association' ? (data.associations || []).filter(function (a) { return a.name === qn || a.module + '.' + a.name === qn; })[0] : null;
    return as && data.entities[as.from] ? { view: 'domain', entity: as.from, dmodule: data.entities[as.from].module } : null;
  }

  function cap(h, text) { return h('h3', { class: 'dx-cap', text: text }); }
  function steps(h, list) {
    return list && list.length ? h('ol', { class: 'dx-pd-steps dx-ch-steps' }, list.map(function (x, i) { return h('li', null, [h('span', { class: 'dx-pd-sn', text: String(i + 1) }), h('span', { text: x })]); })) : null;
  }

  // How it works now (or null), beside the proposed solution. kit: h, paragraphs, flowRows, diagram.
  function cols(kit, now, pr) {
    var h = kit.h;
    function col(cls, title, x, flowsCap) {
      return h('section', { class: 'dx-ch-col ' + cls }, [
        cap(h, title),
        x.summary ? h('p', { class: 'dx-ch-lead', text: x.summary }) : null,
        steps(h, x.steps),
        kit.diagram(x.diagram, cls === 'now' ? 'Diagram · now' : 'Diagram · proposed'),
        x.story ? h('div', { class: 'dx-pd-story' }, kit.paragraphs(x.story).map(function (p) { return h('p', { text: p }); })) : null,
        flowsCap && x.flows && x.flows.length ? h('section', { class: 'dx-ch-sub' }, [cap(h, flowsCap + ' · ' + x.flows.length), kit.flowRows(x.flows)]) : null
      ]);
    }
    return h('div', { class: 'dx-ch-cols' + (now ? '' : ' one') }, [
      now ? col('now', 'How it works now', now, 'Flows that carry it') : null,
      col('proposal', 'Proposed solution', pr, null)
    ]);
  }

  // What changes in the model, grouped by kind. kit: h, ln, place.
  function modelTable(kit, list) {
    var h = kit.h, ln = kit.ln;
    if (!list || !list.length) return null;
    var groups = KINDS.map(function (k) { return [k[1], list.filter(function (x) { return x.kind === k[0]; })]; }).filter(function (g) { return g[1].length; });
    return h('section', { class: 'dx-pd-sec dx-ch-model' }, [cap(h, 'What changes in the model · ' + list.length),
      h('table', { class: 'dx-ch-table' }, [
        h('thead', null, h('tr', null, [h('th', { text: 'Action' }), h('th', { text: 'Target' }), h('th', { text: 'What' })])),
        groups.map(function (g) {
          return h('tbody', null, [h('tr', { class: 'dx-ch-kind' }, h('th', { colspan: '3', scope: 'colgroup' }, [g[0], h('span', { class: 'mono', text: ' ' + g[1].length })]))].concat(g[1].map(function (x) {
            var where = x.action === 'add' ? null : kit.place(x.target, x.kind);
            return h('tr', null, [
              h('td', null, h('span', { class: 'dx-ch-act ' + x.action, text: ACTION[x.action] })),
              h('td', { class: 'dx-ch-target' }, [where ? ln(where, { class: 'dx-code link' }, x.target) : h('code', { class: 'dx-code', text: x.target }),
                x.action === 'add' ? h('span', { class: 'dx-ch-new', text: 'new' }) : null]),
              h('td', { text: x.what || '' })
            ]);
          })));
        })
      ])]);
  }

  // What it touches, what could go wrong, what is not known, how much work: { impact, risks, open, effort }.
  function more(kit, c) {
    var h = kit.h, im = c.impact || { flows: [], roles: [], data: null };
    var side = [
      im.flows.length || im.roles.length || im.data ? h('section', { class: 'dx-ch-sub' }, [cap(h, 'Impact'),
        im.flows.length ? kit.flowRows(im.flows) : null,
        im.roles.length ? h('div', { class: 'dx-ch-roles' }, [h('span', { text: 'Roles' })].concat(im.roles.map(function (r) { return h('span', { class: 'dx-ch-role', text: r }); }))) : null,
        im.data ? h('p', { class: 'dx-ch-data' }, [h('b', { text: 'Data. ' }), im.data]) : null]) : null,
      c.risks && c.risks.length && window.MxDocsTickets ? h('section', { class: 'dx-ch-sub' }, [cap(h, 'Risks · ' + c.risks.length), window.MxDocsTickets.risks(h, c.risks)]) : null,
      c.open && c.open.length ? h('section', { class: 'dx-ch-sub' }, [cap(h, 'Open questions · ' + c.open.length), h('ol', { class: 'dx-ch-open' }, c.open.map(function (x) { return h('li', { text: x }); }))]) : null,
      c.effort ? h('section', { class: 'dx-ch-sub' }, [cap(h, 'Effort'), h('p', { class: 'dx-ch-data', text: c.effort })]) : null
    ].filter(Boolean);
    return side.length ? h('div', { class: 'dx-ch-more' }, side) : null;
  }

  window.MxDocsChanges = { cols: cols, modelTable: modelTable, more: more, place: placeOf, KINDS: KINDS, ACTION: ACTION };
})();
