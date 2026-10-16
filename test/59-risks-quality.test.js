/* The documentation's Risks and Model quality pages (public/docs-view.js, redesign specs 17 and 18),
 * and App Settings counted as a reference (public/mpr.js).
 *
 * Risks, from the spec's acceptance list:
 *  - the facets count by level, pattern and module, and a facet's counts leave out its own filter;
 *  - the conclusion is said only when one pattern holds most of the P1 findings;
 *  - grouped by module the list runs A to Z, P1 to P3 inside a module;
 *  - an address restores the filters and the finding (#/risks/R-003?th=access);
 *  - every place has its kind and leads to its page; a name the model lacks stays text.
 * Model quality: six checks, values read from the data; each guideline a quote with its source,
 * the switched-off step without one; rows lead to a flow or a module; no agent text on the page. */
'use strict';
const fs = require('fs');
const path = require('path');
const { check } = require(path.join(__dirname, '..', 'skills', 'mendix-describe', 'check-descriptions.js'));

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxDescribe && !!window.MxDocsData && !!window.MxDocsView && !!window.MxReportData', 15000, 'MxScout loaded');
  for (const src of ['/sqlite.js', '/bson.js', '/mpr.js']) {
    await mx.evaluate(`new Promise(function (res, rej) { var x = document.createElement('script'); x.src = '${src}'; x.onload = function () { res(true); }; x.onerror = rej; document.head.appendChild(x); })`);
  }

  // ---- App Settings name flows the runtime starts ----
  const refs = JSON.parse(await mx.evaluate(`JSON.stringify(MxMpr.collectReferences({ '$Type': 'Settings$ProjectSettings', Settings: [{ '$Type': 'Settings$ModelSettings',
    AfterStartupMicroflow: 'General.AfterStartup', BeforeShutdownMicroflow: 'General.BeforeShutdown', HealthCheckMicroflow: 'General.Health', HashAlgorithm: 'BCrypt' }] }, {}))`));
  t.ok(JSON.stringify(refs) === JSON.stringify({ 'General.AfterStartup': 'flow', 'General.BeforeShutdown': 'flow', 'General.Health': 'flow' }),
    'the after-startup, before-shutdown and health-check microflows of App Settings count as reached: ' + JSON.stringify(refs));

  // The skill's checker asks for a pattern on each risk, from the ten.
  const pack = { project: 'RiskDemo', microflows: { 'Sales.CreateOrder': { hash: 'x' } }, nanoflows: {}, pages: {}, entities: {} };
  const themeWarn = (theme) => check(pack, { format: 'mxscout-descriptions', version: 1, risks: [Object.assign({ level: 'P1', title: 'x', fix: 'y', where: ['Sales.CreateOrder'] }, theme === undefined ? {} : { theme: theme })] })
    .filter((p) => /"theme"/.test(p.text)).map((p) => p.level);
  t.ok(themeWarn('access').length === 0 && themeWarn(undefined).join() === 'warning' && themeWarn('bogus').join() === 'warning',
    'the checker takes a known pattern, and warns about a missing or an unknown one');

  const v1b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  const R = (level, theme, title, where) => ({ level: level, theme: theme, title: title, detail: 'Detail of ' + title + '.', fix: 'Fix ' + title + '.', where: where });
  const desc = {
    format: 'mxscout-descriptions', version: 1,
    risks: [
      R('P2', 'logic', 'Saved twice', ['Sales.CreateOrder']),
      R('P1', 'access', 'Anyone can sweep', ['Sales.SweepOrders', 'Sales.Order', 'Sales.NoSuchThing']),
      R('P1', 'access', 'Anyone can create', ['Sales.CreateOrder|mf']),
      R('P3', 'naming', 'Odd name', ['Admin.Thing']),
      R('P1', 'secrets', 'A key in a flow', ['Admin.Other']),
      R('P2', 'access', 'Page without a check', ['Sales.CreateOrder|pg'])
    ]
  };
  const r = JSON.parse(await mx.evaluate(`(async function () {
    var bytes = Uint8Array.from(atob("${v1b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    var model = await window.MxMpr.buildModel({ mprBytes: bytes, appName: 'Sales', readContentsFile: function () { throw new Error('v1'); } });
    var data = MxDocsData.build(model, { name: 'RiskDemo' });
    MxDescribe.attach(data, MxDescribe.parse(${JSON.stringify(JSON.stringify(desc))}).value);
    window.__rq = data;
    var host = document.createElement('div'); host.style.height = '900px'; document.body.appendChild(host);
    var v = MxDocsView.mount(data, host, { preview: true, state: { view: 'risks' } });
    function txt(sel) { var n = host.querySelector(sel); return n ? n.textContent : null; }
    function all(sel) { return Array.from(host.querySelectorAll(sel)).map(function (x) { return x.textContent; }); }
    function strip(sel) { return all('.dx-rk-strip ' + sel); }
    function click(sel, re) { Array.from(host.querySelectorAll(sel)).filter(function (b) { return re.test(b.textContent); })[0].click(); }
    var out = {};
    out.sub = txt('.dx-sub');
    out.sev = strip('.dx-fc-sev .dx-fc-n').join('/');
    out.insight = txt('.dx-rk-strip .dx-insight b');
    out.pats = strip('.dx-pat').filter(function (x) { return !/0$/.test(x); });
    out.mods = strip('.dx-fc-mod');
    // picking a module filters the list and keeps the order; the modules stand first, on the left
    click('.dx-rk-strip .dx-fc-mod', /^Admin/);
    out.modsPicked = { order: strip('.dx-fc-mod'), on: txt('.dx-rk-strip .dx-fc-mod.on'), first: host.querySelector('.dx-rk-strip > .dx-fc').getAttribute('aria-label') };
    click('.dx-rk-strip .dx-fc-mod', /^Admin/);
    out.firstId = txt('.dx-rk-id');
    v.go({ view: 'risks', sub: 'R-002' });
    out.first = { id: txt('.dx-rk-id'), pos: txt('.dx-rk-navs span'), title: txt('.dx-rk-head h2'), when: txt('.dx-rk-when'), pills: all('.dx-rk-pills > *') };
    out.where = Array.from(host.querySelectorAll('.dx-rk-where')).map(function (w) { return w.tagName + ':' + w.textContent; });
    out.same = all('.dx-rk-rail > .dx-rk-sec:first-child .dx-rk-sib');
    // a pattern: its own counts stay, the others follow
    click('.dx-rk-strip .dx-pat', /^Missing access/);
    out.access = { label: txt('.dx-rk-lh-row b'), sev: strip('.dx-fc-sev .dx-fc-n').join('/'), pats: strip('.dx-pat .dx-fc-n').join('/'), chips: all('.dx-rk-chip') };
    click('.dx-rk-strip .dx-fc-sev', /^P2/);
    out.p2 = { label: txt('.dx-rk-lh-row b'), sev: strip('.dx-fc-sev .dx-fc-n').join('/'), rows: all('.dx-rk-row .dx-rk-t b'), id: txt('.dx-rk-id') };
    click('.dx-rk-chip', /^P2/); click('.dx-rk-chip', /^Missing/);
    // grouped by module
    click('.dx-seg2 button', /^Module$/);
    out.groups = all('.dx-rk-g b');
    out.byMod = Array.from(host.querySelectorAll('.dx-rk-row')).map(function (x) { return x.querySelector('.dx-lv').textContent + ':' + x.querySelector('b').textContent; });
    // no text filter of its own: the screen's search finds a risk (Karol, 2026-10-14)
    out.text = !host.querySelector('.dx-rk-q');
    // next / previous
    click('.dx-seg2 button', /^Severity$/);
    v.go({ view: 'risks', sub: 'R-002' });
    host.querySelector('.dx-rk-nav[aria-label="Next finding"]').click();
    out.next = txt('.dx-rk-id');
    // a place leads to its page
    v.go({ view: 'risks', sub: 'R-002' });
    click('.dx-rk-where', /SweepOrders/);
    out.opened = v.state().view + ':' + v.state().key;
    v.go({ view: 'risks', sub: 'R-002' });
    click('.dx-rk-where', /Order$|OrderOpen entity/);
    out.entity = v.state().view + ':' + v.state().entity;

    // ---- model quality ----
    v.go({ view: 'quality' });
    out.q = { sub: txt('.dx-sub'), cards: Array.from(host.querySelectorAll('.dx-q-card')).map(function (c) { return c.querySelector('.dx-q-v').textContent + '|' + c.querySelector('b').textContent; }), checks: {} };
    ['unreached', 'off', 'sched', 'large', 'names', 'access'].forEach(function (id) {
      v.go({ view: 'quality', sub: id });
      var rule = host.querySelector('.dx-q-rule');
      out.q.checks[id] = { on: host.querySelector('.dx-q-card.on b').textContent, h2: txt('.dx-q-left h2'), rule: rule ? rule.querySelector('.dx-q-quote').textContent : null,
        cite: rule ? rule.querySelector('cite').textContent : null, rows: host.querySelectorAll('.dx-q-table .dx-q-row').length,
        links: host.querySelectorAll('.dx-q-table button.dx-q-row').length, ai: !!host.querySelector('.dx-main .dx-ai') };
    });
    out.data = { unreached: data.quality.unreached.length, sched: data.scheduled.length, schedOff: data.scheduled.filter(function (x) { return !x.enabled; }).length,
      mf: Object.keys(data.flows).filter(function (k) { return data.flows[k].kind === 'microflow'; }).length };
    v.go({ view: 'quality', sub: 'off' });
    var offRow = host.querySelector('.dx-q-table button.dx-q-row');
    if (offRow) { offRow.click(); out.offOpened = v.state().view + ':' + v.state().key + ':' + v.state().step; }
    host.remove();

    // ---- the address restores filters and the finding ----
    history.replaceState(null, '', '#/risks/R-003?th=access&group=mod');
    var h2 = document.createElement('div'); h2.style.height = '900px'; document.body.appendChild(h2);
    MxDocsView.mount(data, h2, { hash: true });
    out.deep = { id: (h2.querySelector('.dx-rk-id') || {}).textContent, label: h2.querySelector('.dx-rk-lh-row b').textContent, chips: Array.from(h2.querySelectorAll('.dx-rk-chip')).map(function (x) { return x.textContent; }),
      group: h2.querySelector('.dx-seg2 button.on').textContent };
    Array.from(h2.querySelectorAll('.dx-rk-strip .dx-fc-sev')).filter(function (b) { return /^P1/.test(b.textContent); })[0].click();
    out.deep.hash = location.hash;
    h2.remove();
    history.replaceState(null, '', '#');
    return JSON.stringify(out);
  })()`));

  t.ok(r.sub === '6 findings in 2 modules. An agent read them from the model, so check each one before you act on it.', 'Risks says how many, where, and that an agent wrote them: ' + r.sub);
  t.ok(r.sev === '3/2/1', 'the severity facet counts each level: ' + r.sev);
  t.ok(r.insight === '2 of the 3 P1 findings are missing access checks.', 'and one pattern holding most of the P1 findings is said in a sentence: ' + r.insight);
  t.ok(r.pats.join('|') === 'Missing access checks3|Secrets in the model1|Logic and data errors1|Names and messages1', 'each pattern with its count: ' + r.pats.join('|'));
  t.ok(r.mods.join('|') === 'Sales4|Admin2', 'where they gather, the busiest module first: ' + r.mods.join('|'));
  t.ok(r.modsPicked.order.join('|') === 'Sales4|Admin2' && /^Admin/.test(r.modsPicked.on) && r.modsPicked.first === 'Modules',
    'picking a module keeps the order, and the modules stand first on the left, above the list they filter: ' + JSON.stringify(r.modsPicked));
  t.ok(r.firstId === 'R-005', 'the list opens on its first finding — P1 first, modules A to Z: ' + r.firstId);
  t.ok(r.first.id === 'R-002' && r.first.pos === 'P1 · 2 of 3' && r.first.title === 'Anyone can sweep' && r.first.when === 'Fix before the next release.' && r.first.pills.join('|') === 'P1Security and data|Missing access checks|Sales',
    'the first finding: its address, its place in its group, its level, pattern and module: ' + JSON.stringify(r.first));
  t.ok(r.where.length === 3 && /^BUTTON:MFSales\.SweepOrdersOpen flow$/.test(r.where[0]) && /^BUTTON:ENSales\.OrderOpen entity$/.test(r.where[1]) && r.where[2] === 'DIV:··Sales.NoSuchThing',
    'every place has its kind and a way to its page, and a name the model lacks stays text: ' + JSON.stringify(r.where));
  t.ok(r.same.length === 2 && /Anyone can create/.test(r.same[0]) && /Page without a check/.test(r.same[1]), 'the same pattern elsewhere, P1 first: ' + JSON.stringify(r.same));
  t.ok(r.access.label === '3 of 6 findings' && r.access.pats === '3/1/1/0/0/0/0/0/0/1' && r.access.sev === '2/1/0' && r.access.chips.join() === 'Missing access checks×',
    'a pattern filters the list and the other facets, and its own facet keeps its counts: ' + JSON.stringify(r.access));
  t.ok(r.p2.label === '1 of 6 findings' && r.p2.sev === '2/1/0' && r.p2.rows.join() === 'Page without a check' && r.p2.id === 'R-006',
    'filters add up, and a finding the filters hide gives way to the first one left: ' + JSON.stringify(r.p2));
  t.ok(r.groups.join(',') === 'Admin,Sales' && r.byMod.join(',') === 'P1:A key in a flow,P3:Odd name,P1:Anyone can sweep,P1:Anyone can create,P2:Saved twice,P2:Page without a check',
    'grouped by module: A to Z, and P1 to P3 inside each: ' + r.byMod.join(','));
  t.ok(r.text === true, 'the page has no text filter of its own beside the screen’s search');
  t.ok(r.next === 'R-003', 'Next goes to the next finding in the list: ' + r.next);
  t.ok(r.opened === 'refs:microflow:Sales.SweepOrders' && r.entity === 'domain:Sales.Order', 'a place opens its flow or its entity: ' + r.opened + ' ' + r.entity);
  t.ok(r.deep.id === 'R-003' && r.deep.label === '3 of 6 findings' && r.deep.chips.join() === 'Missing access checks×' && r.deep.group === 'Module',
    'an address restores the filters, the grouping and the finding: ' + JSON.stringify(r.deep));
  t.ok(r.deep.hash === '#/risks/R-003?lv=P1&th=access&group=mod', 'and a filter changed writes itself into the address: ' + r.deep.hash);

  const q = r.q, d = r.data;
  t.ok(/^Six checks read straight from the model/.test(q.sub) && /Nothing on this page was written by an agent\.$/.test(q.sub) && Object.keys(q.checks).every((k) => !q.checks[k].ai),
    'Model quality says it holds no agent text, and holds none');
  t.ok(q.cards.length === 6 && q.cards[0] === d.unreached + '|Nothing reaches these' && q.cards[2] === d.schedOff + 'of ' + d.sched + '|Scheduled events switched off' && new RegExp('^\\\\d+of ' + d.mf + '\\\\|Microflows that apply entity access$').test(q.cards[5]),
    'six checks, their values read from the data: ' + JSON.stringify(q.cards));
  const C = q.checks;
  t.ok(C.off.rule === null && ['unreached', 'sched', 'large', 'names', 'access'].every((k) => C[k].rule && /^Mendix docs · /.test(C[k].cite)),
    'each guideline is quoted with its source, and the check Mendix has none for shows none');
  t.ok(/^Unused and excluded documents should be removed/.test(C.unreached.rule) && /^The size of a microflow should not exceed 25 elements\./.test(C.large.rule) && /^By default entity access is not applied\./.test(C.access.rule),
    'in Mendix’s own words');
  t.ok(C.unreached.rows === d.unreached && C.unreached.links === d.unreached && C.access.links === C.access.rows && C.access.rows >= 1, 'its rows lead to a flow or a module: ' + JSON.stringify(C.unreached) + ' ' + JSON.stringify(C.access));
  if (r.offOpened) t.ok(/^refs:microflow:.+:\d+$/.test(r.offOpened), 'a switched-off step opens its flow at that step: ' + r.offOpened);
};
