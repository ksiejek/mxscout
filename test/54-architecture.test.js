/* Notes on a module and the architecture (public/describe.js, public/docs-view.js, skills/mendix-describe).
 *
 * An agent writes, beside its descriptions, the notes a developer needs on each module and the C4 picture of
 * the application: who uses it, what it talks to, what it runs as. MxScout draws the picture itself, from nodes
 * and links, and reads the third level — how the modules lean on one another — from the model. What has to hold:
 *  - everything the agent wrote is kept as text, bounded, and a link to a node that is not there is dropped;
 *  - the Architecture page exists only when there is a picture, so a file from before adds nothing;
 *  - the picture is drawn left to right in the direction of the links, one box per node and one line per link;
 *  - the checker says what MxScout would drop, and todo says what is missing. */
'use strict';
const fs = require('fs');
const path = require('path');
const { todo, check, merge, readPack } = require(path.join(__dirname, '..', 'skills', 'mendix-describe', 'check-descriptions.js'));

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore && !!window.MxDescribe && !!window.MxDocsData && !!window.MxDocsView', 15000, 'MxScout loaded');
  for (const src of ['/sqlite.js', '/bson.js', '/mpr.js']) {
    await mx.evaluate(`new Promise(function (res, rej) { var x = document.createElement('script'); x.src = '${src}'; x.onload = function () { res(true); }; x.onerror = rej; document.head.appendChild(x); })`);
  }
  const v1b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  const packText = await mx.evaluate(`(async function () {
    var bytes = Uint8Array.from(atob("${v1b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    window.__model = await window.MxMpr.buildModel({ mprBytes: bytes, appName: 'Sales', readContentsFile: function () { throw new Error('v1'); } });
    return MxDescribe.pack(MxDocsData.build(window.__model, { name: 'ArchDemo' })).text;
  })()`);

  const NOTES = [
    { title: 'Key entities', table: { columns: ['Entity', 'Role in the business'], rows: [['Sales.Order', 'One customer’s purchase, from draft to paid'], ['<img src=x onerror=alert(1)>', 'kept as text']] } },
    { title: 'Business processes', items: ['Taking an order: Sales.CreateOrder numbers it and sets the status.'], text: 'First paragraph.\n\nSecond paragraph.' },
    { title: 'To confirm', items: ['Sales.CleanUp is switched off in the model.'] },
    { title: '', items: ['a section without a title is dropped'] },
    { title: 'Empty' }
  ];
  const C4 = {
    context: {
      nodes: [
        { id: 'users', name: 'Operators', note: 'work tickets', kind: 'person', group: 'People' },
        { id: 'app', name: 'ArchDemo', note: 'Mendix application', kind: 'app' },
        { id: 'erp', name: 'ERP <b>system</b>', note: 'published REST', kind: 'bogus', group: 'Systems' },
        { id: 'users', name: 'duplicate id', kind: 'person' },
        { id: '__proto__', name: 'proto', kind: 'system' }
      ],
      links: [
        { from: 'users', to: 'app', label: 'browser' },
        { from: 'app', to: 'erp', label: 'orders' },
        { from: 'app', to: 'nowhere', label: 'dropped' },
        { from: 'toString', to: 'app', label: 'dropped too' },
        { from: 'app', to: 'app', label: 'to itself' }
      ]
    },
    containers: { nodes: [{ id: 'rt', name: 'Mendix Runtime', kind: 'part' }, { id: 'db', name: 'Database', kind: 'store' }], links: [{ from: 'rt', to: 'db', label: 'SQL' }] },
    open: ['Where the application is hosted cannot be told from the model.']
  };
  const file = {
    format: 'mxscout-descriptions', version: 1, by: 'test agent',
    modules: { Sales: { summary: 'Orders.', story: 'Long.', notes: NOTES } }, c4: C4
  };

  // ---- what MxScout keeps ----
  const kept = JSON.parse(await mx.evaluate(`JSON.stringify((function () {
    var p = MxDescribe.parse(${JSON.stringify(JSON.stringify(file))}).value;
    var only = MxDescribe.parse(JSON.stringify({ format: 'mxscout-descriptions', version: 1, c4: { context: { nodes: [{ id: 'a', name: 'A' }] } } }));
    var none = MxDescribe.parse(JSON.stringify({ format: 'mxscout-descriptions', version: 1, c4: { context: { nodes: [] } } }));
    var notesOnly = MxDescribe.parse(JSON.stringify({ format: 'mxscout-descriptions', version: 1, modules: { Sales: { notes: [{ title: 'T', items: ['x'] }] } } }));
    return { sections: p.modules.Sales.notes.map(function (s) { return s.title; }), cell: p.modules.Sales.notes[0].table.rows[1][0],
      paras: p.modules.Sales.notes[1].text, nodes: p.c4.context.nodes.map(function (n) { return n.id + ':' + n.kind + ':' + n.name; }),
      links: p.c4.context.links.map(function (l) { return l.from + '>' + l.to; }), containers: p.c4.containers.nodes.length, open: p.c4.open,
      onlyC4: !!only.value && !!only.value.c4, noneErr: none.error || null, notesOnly: !!notesOnly.value && notesOnly.value.modules.Sales.notes.length };
  })())`));
  t.ok(kept.sections.join('|') === 'Key entities|Business processes|To confirm', 'a section without a title, and an empty one, are dropped: ' + kept.sections.join('|'));
  t.ok(kept.cell === '<img src=x onerror=alert(1)>' && /\n\n/.test(kept.paras), 'a table cell is kept as text, and a paragraph break in a section stays');
  t.ok(kept.nodes.join('|') === 'users:person:Operators|app:app:ArchDemo|erp:system:ERP <b>system</b>|__proto__:system:proto',
    'nodes are kept as text, an unknown kind becomes a system and a duplicate id is dropped: ' + kept.nodes.join(' | '));
  t.ok(kept.links.join('|') === 'users>app|app>erp', 'a link to a node that is not there, from a name that is not a node, or to itself is dropped: ' + kept.links.join('|'));
  t.ok(kept.containers === 2 && kept.open.length === 1, 'the containers and what the model does not show are kept');
  t.ok(kept.onlyC4 && kept.noneErr && /no descriptions/.test(kept.noneErr), 'a file that holds only a diagram is accepted, one whose diagram has no nodes is not');
  t.ok(kept.notesOnly === 1, 'a module with notes and no summary is kept');

  // ---- the reader ----
  const view = JSON.parse(await mx.evaluate(`JSON.stringify((function () {
    var data = MxDocsData.build(window.__model, { name: 'ArchDemo' });
    var own = data.modules.filter(function (m) { return !m.marketplace; })[0].name;
    // a second own module that calls into the first, so the third level has something to read
    var src = data.flows[data.modules.filter(function (m) { return !m.marketplace; })[0].microflows[0]];
    var other = JSON.parse(JSON.stringify(src)); other.qn = 'Other.Starter'; other.name = 'Starter'; other.module = 'Other'; other.calledBy = [{ kind: 'microflow', qn: own + '.' + src.name }];
    src.calledBy = []; data.flows['microflow:Other.Starter'] = other;
    data.modules.push({ name: 'Other', marketplace: false, microflows: ['microflow:Other.Starter'], nanoflows: [], pages: [], entities: [] });
    var calls = JSON.parse(JSON.stringify(src)); // the real flow now calls Other.Starter: record it as a caller of Other
    other.calledBy = [{ kind: 'microflow', qn: src.qn }];
    MxDescribe.attach(data, MxDescribe.parse(${JSON.stringify(JSON.stringify(file))}).value);
    var host = document.createElement('div'); document.body.appendChild(host);
    var v = MxDocsView.mount(data, host, { preview: true, state: { view: 'modules', module: own } });
    var r = { mod: own, nav: Array.from(host.querySelectorAll('.dx-nav-item')).map(function (b) { return b.querySelector('.dx-nav-label').textContent; }) };
    var notes = host.querySelector('.dx-md-notes');
    r.notes = notes ? { sections: notes.querySelectorAll('.dx-md-note').length, table: notes.querySelectorAll('.dx-md-table .dx-md-tr').length, items: notes.querySelectorAll('li').length,
      paras: notes.querySelectorAll('.dx-md-note p').length, links: notes.querySelectorAll('.dx-code.link').length, img: !!host.querySelector('.dx-md img'),
      cell: notes.querySelector('.dx-md-table .dx-md-tr:not(.head) span').textContent, prov: (host.querySelector('.dx-md-about .dx-prov') || {}).textContent } : null;
    v.go({ view: 'arch' });
    function side(g) { return g.style.gridColumn === '1' ? 'left' : g.style.gridColumn === '5' ? 'right' : 'top'; }
    r.arch = {
      anchors: Array.from(host.querySelectorAll('.dx-anchor')).map(function (a) { return a.textContent; }),
      groups: Array.from(host.querySelectorAll('.dx-ar .dx-ctx-g')).map(function (g) { return side(g) + ':' + g.querySelector('.dx-ctx-gl').textContent + ':' + Array.from(g.querySelectorAll('.dx-ctx-chip')).map(function (c) { return c.textContent; }).join('+'); }),
      partners: Array.from(host.querySelectorAll('.dx-ar-table.ctx .dx-ar-tr:not(.head)')).map(function (tr) { return Array.from(tr.children).map(function (c) { return c.textContent; }).join(' | '); }),
      html: Array.from(host.querySelectorAll('.dx-ar *')).some(function (n) { return n.tagName === 'IMG' || (n.tagName === 'B' && n.parentNode.tagName === 'B'); }),
      rt: Array.from(host.querySelectorAll('.dx-rt-node')).map(function (n) { return n.className.replace('dx-rt-node ', '') + ':' + n.querySelector('b').textContent; }),
      rtLabels: Array.from(host.querySelectorAll('.dx-rt-label')).map(function (n) { return n.textContent; }),
      open: Array.from(host.querySelectorAll('.dx-ar-open li')).map(function (li) { return li.textContent; })
    };
    // the module matrix: pick the own module and read what it uses
    Array.from(host.querySelectorAll('.dx-dsm:not(.roles) .dx-dsm-rh')).filter(function (b) { return b.textContent === own; })[0].click();
    var sideM = host.querySelector('.dx-dsm:not(.roles)').closest('.dx-ar-grid').querySelector('.dx-ar-side');
    r.dsm = { sel: sideM.querySelector('.dx-ar-sel b').textContent, uses: Array.from(sideM.querySelectorAll('.dx-ln-row b')).map(function (b) { return b.textContent; }),
      heads: Array.from(sideM.querySelectorAll('h3')).map(function (x) { return x.textContent; }), cell: Array.from(host.querySelectorAll('.dx-dsm:not(.roles) .dx-dsm-c[title]')).map(function (c) { return c.title; }) };
    // the exported file carries the same reader, so the same drawing
    r.inSource = MxDocsView.source.indexOf('runtimeDiagram') !== -1 && MxDocsView.source.indexOf('roleMatrix') !== -1;
    // without a picture the page stays, with what the model holds
    var old = JSON.parse(JSON.stringify(data)); old.ai.c4 = null;
    var h2 = document.createElement('div'); document.body.appendChild(h2); MxDocsView.mount(old, h2, { preview: true, state: { view: 'arch' } });
    r.oldNav = Array.from(h2.querySelectorAll('.dx-nav-item')).map(function (b) { return b.querySelector('.dx-nav-label').textContent; });
    r.oldAnchors = Array.from(h2.querySelectorAll('.dx-anchor')).map(function (a) { return a.textContent; });
    r.oldRt = h2.querySelectorAll('.dx-rt-node').length;
    host.remove(); h2.remove();
    return r;
  })())`));
  t.ok(view.nav.indexOf('Architecture') !== -1, 'the documentation has an Architecture page: ' + view.nav.join(' | '));
  t.ok(view.notes && view.notes.sections === 3 && view.notes.table === 3 && view.notes.paras >= 2 && view.notes.items >= 2 && !view.notes.img && view.notes.cell === 'Order',
    'a module’s notes are sections of text, lines and a table — the table a table, its first column without the module, all of it text: ' + JSON.stringify(view.notes));
  t.ok(view.notes && view.notes.links >= 1 && view.notes.prov === 'Written by an agent from the model.', 'a flow named in a note links to it, and the description says an agent wrote it');
  t.ok(JSON.stringify(view.arch.groups) === JSON.stringify(['left:People:Operatorswork tickets', 'right:Systems:ERP <b>system</b>published REST', 'right:It calls:protopublished REST'.replace('protopublished REST', 'proto')]) ||
    (view.arch.groups.some((g) => /^left:People:Operators/.test(g)) && view.arch.groups.some((g) => /^right:Systems:ERP <b>system<\/b>/.test(g))),
    'the context puts the people on the left and the system the application calls on the right, each with its note: ' + JSON.stringify(view.arch.groups));
  t.ok(view.arch.partners.length === 3 && view.arch.partners.indexOf('Operators | People | → ArchDemo | browser · work tickets') !== -1 && view.arch.partners.indexOf('ERP <b>system</b> | Systems | ArchDemo → | orders · published REST') !== -1,
    'every partner is in the table with its direction and what goes over: ' + JSON.stringify(view.arch.partners));
  t.ok(!view.arch.html, 'a name with markup in it is only text');
  t.ok(view.arch.rt.join('|') === 'part:Mendix Runtime|store:Database' && view.arch.rtLabels.join() === 'SQL', 'the runtime: a box per part, the store marked, the line labelled: ' + JSON.stringify(view.arch));
  t.ok(view.arch.open.length === 1 && /^01Where the application is hosted/.test(view.arch.open[0]), 'what the model does not show is listed, numbered');
  t.ok(view.arch.anchors.join('|') === '1Context|2Runtime|3Modules|4Roles|5Open questions' || view.arch.anchors.join('|') === '1Context|2Runtime|3Modules|4Open questions',
    'the header leads to each section: ' + view.arch.anchors.join('|'));
  // Other.Starter is a copy of a flow of the own module, so it makes that flow's calls into it: Other uses the own module.
  t.ok(view.dsm.sel === view.mod && view.dsm.uses.join() === 'Other' && view.dsm.heads.join('|') === 'Uses · 0|Used by · 1' && view.dsm.cell.some((c) => new RegExp('^Other uses ' + view.mod + ': \\d+ calls?$').test(c)),
    'the module matrix is read from the model: a module whose flows call another’s uses it: ' + JSON.stringify(view.dsm));
  t.ok(view.inSource, 'the exported file carries the same reader, so the same drawing');
  t.ok(view.oldNav.indexOf('Architecture') !== -1 && view.oldAnchors.every((a) => !/Context|Open questions/.test(a)) && view.oldRt === 0,
    'without a picture the page stays, with only what the model holds: ' + view.oldAnchors.join(' | '));

  // ---- the skill's checker ----
  const pack = readPack(packText);
  const good = JSON.parse(JSON.stringify(file));
  good.modules.Sales.notes = good.modules.Sales.notes.slice(0, 3);
  good.c4.context.nodes = good.c4.context.nodes.slice(0, 3); good.c4.context.nodes[2].kind = 'system';
  good.c4.context.links = good.c4.context.links.slice(0, 2);
  const none = check(pack, good).filter((p) => p.level === 'error');
  t.ok(none.length === 0, 'a correct file passes the check: ' + JSON.stringify(none));
  const bad = check(pack, file).map((p) => p.level + ' ' + p.text);
  t.ok(bad.some((p) => /^error .*notes\[3\].*needs a "title"/.test(p)) && bad.some((p) => /^warning .*notes\[4\].*nothing in it/.test(p)), 'a section with no title is an error and an empty one a warning: ' + bad.filter((p) => /notes/.test(p)).length);
  t.ok(bad.some((p) => /^error .*id "users" is used twice/.test(p)) && bad.some((p) => /^warning .*kind "bogus"/.test(p)) && bad.some((p) => /^warning .*links\[2\]/.test(p)), 'the diagram’s duplicate id, unknown kind and dangling link are flagged');
  const sparse = JSON.parse(JSON.stringify(good)); delete sparse.c4; sparse.modules.Sales.notes = [];
  const td = todo(pack, sparse);
  t.ok(td.c4 === true && td.noNotes.indexOf('Sales') !== -1 && todo(pack, good).c4 === false && todo(pack, good).noNotes.indexOf('Sales') === -1,
    'todo says when the architecture and a module’s notes are missing, and when they are there');
  const m = merge([{ format: 'mxscout-descriptions', version: 1, modules: { Sales: { summary: 'a', notes: [{ title: 'x', items: ['y'] }] } } }, { c4: good.c4 }]);
  t.ok(m.c4 && m.modules.Sales.notes.length === 1, 'merge carries the architecture and the notes of a part');
  await mx.close();
};
