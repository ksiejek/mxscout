/* The documentation's Modules, Architecture and For developers pages (public/docs-view.js,
 * redesign specs 13, 16 and 19), from their acceptance lists:
 *  - Modules sorts A to Z without regard to case, by size (documents and entities), by risks (P1 first);
 *    the groups of a module's contents add up to its documents; "both ways" marks exactly the mutual
 *    pairs; a module with no scheduled events or services says it starts from elsewhere;
 *  - Architecture's module facts are counted from the data, a mutual pair is red on both sides of the
 *    diagonal, and the role matrix matches the roles' module roles;
 *  - For developers: the filter narrows the list and the facet's counts together, a module picked shows
 *    every item that names it, another tab clears the module, and pattern counts come from the names. */
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxDescribe && !!window.MxDocsData && !!window.MxDocsView && !!window.MxReportData', 15000, 'MxScout loaded');
  for (const src of ['/sqlite.js', '/bson.js', '/mpr.js']) {
    await mx.evaluate(`new Promise(function (res, rej) { var x = document.createElement('script'); x.src = '${src}'; x.onload = function () { res(true); }; x.onerror = rej; document.head.appendChild(x); })`);
  }
  const v1b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  const desc = {
    format: 'mxscout-descriptions', version: 1,
    risks: [{ level: 'P1', title: 'Admin is open', where: ['admin.Open'] }, { level: 'P3', title: 'Sales nit', where: ['Sales.CreateOrder'] }, { level: 'P2', title: 'Sales bug', where: ['Sales.SweepOrders'] }],
    context: {
      where: [{ topic: 'Where an order starts', place: 'Sales.CreateOrder, then beta.Helper.' }, { topic: 'Where help lives', place: 'beta.Helper does it.' }, { topic: 'Where settings live', place: 'Nowhere special.' }],
      conventions: [{ pattern: 'Create*', meaning: 'Makes a new record, as Sales.CreateOrder does.' }, { pattern: 'Constants are upper case', meaning: 'Not a name pattern.' }],
      pitfalls: ['Changing Sales.CreateOrder skips beta.Helper.', 'Orders are slow.']
    }
  };
  const r = JSON.parse(await mx.evaluate(`(async function () {
    var bytes = Uint8Array.from(atob("${v1b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    var model = await window.MxMpr.buildModel({ mprBytes: bytes, appName: 'Sales', readContentsFile: function () { throw new Error('v1'); } });
    var data = MxDocsData.build(model, { name: 'ModDemo' });
    // two more own modules: "beta", small and lower case, whose flow and Sales.CreateOrder call each other; "admin", empty
    var src = data.flows['microflow:Sales.CreateOrder'];
    var helper = JSON.parse(JSON.stringify(src)); helper.qn = 'beta.Helper'; helper.name = 'Helper'; helper.module = 'beta'; helper.key = 'microflow:beta.Helper';
    helper.calls = [{ kind: 'microflow', qn: 'Sales.CreateOrder' }]; helper.calledBy = [{ kind: 'microflow', qn: 'Sales.CreateOrder' }];
    data.flows['microflow:beta.Helper'] = helper;
    src.calls = src.calls.concat([{ kind: 'microflow', qn: 'beta.Helper' }]);
    data.modules.push({ name: 'beta', marketplace: false, microflows: ['microflow:beta.Helper'], nanoflows: [], pages: [], entities: [] });
    data.modules.push({ name: 'admin', marketplace: false, microflows: [], nanoflows: [], pages: [], entities: [] });
    MxDescribe.attach(data, MxDescribe.parse(${JSON.stringify(JSON.stringify(desc))}).value);
    var host = document.createElement('div'); host.style.height = '900px'; document.body.appendChild(host);
    var v = MxDocsView.mount(data, host, { preview: true, state: { view: 'modules' } });
    function names() { return Array.from(host.querySelectorAll('.dx-ml-t b')).map(function (b) { return b.textContent; }); }
    function sort(label) { Array.from(host.querySelectorAll('.dx-head-tools .dx-seg2 button')).filter(function (b) { return b.textContent === label; })[0].click(); }
    var out = { az: names() };
    sort('Size'); out.size = names();
    sort('Risks'); out.risk = names();
    sort('A–Z');
    var sales = data.modules.filter(function (m) { return m.name === 'Sales'; })[0];
    v.go({ view: 'modules', module: 'Sales', mtab: 'contents' });
    out.items = host.querySelectorAll('.dx-mc-item:not(.ent)').length;
    out.docs = sales.microflows.length + sales.nanoflows.length + sales.pages.length;
    out.groupSum = Array.from(host.querySelectorAll('.dx-mc')).filter(function (c) { return c.querySelector('.dx-mc-h b').textContent !== 'Entities'; })
      .reduce(function (s, c) { return s + Number(c.querySelector('.dx-mc-h .dx-fc-n').textContent); }, 0);
    v.go({ view: 'modules', module: 'Sales', mtab: 'links' });
    out.salesLinks = Array.from(host.querySelectorAll('.dx-ln-row')).map(function (x) { return x.textContent; });
    v.go({ view: 'modules', module: 'beta', mtab: 'links' });
    out.betaRuns = Array.from(host.querySelectorAll('.dx-md-links section')).pop().querySelector('.dx-empty').textContent;
    out.betaTab = host.querySelector('.dx-tabs2 button.on').textContent;

    // architecture
    v.go({ view: 'arch' });
    out.facts = Array.from(host.querySelectorAll('.dx-ar-fact')).map(function (f) { return f.textContent; });
    var dsm = host.querySelector('.dx-dsm:not(.roles)');
    var order = Array.from(dsm.querySelectorAll('.dx-dsm-rh')).map(function (b) { return b.textContent; });
    function cell(a, b) { var row = dsm.querySelectorAll('.dx-dsm-r:not(.head)')[order.indexOf(a)]; return row.querySelectorAll('.dx-dsm-c')[order.indexOf(b)]; }
    out.mutual = [cell('Sales', 'beta').className, cell('beta', 'Sales').className];
    var D = data.derived;
    out.roles = D.arch.roles.map(function (role, i) {
      var row = host.querySelectorAll('.dx-dsm.roles .dx-dsm-r:not(.head)')[i];
      var filled = Array.from(row.querySelectorAll('.dx-dsm-c')).filter(function (c) { return / v[34]/.test(c.className); }).length;
      return role.n + ':' + filled + '/' + Object.keys(role.own).length + '/' + row.querySelector('.dx-dsm-tot').textContent;
    });

    // for developers
    v.go({ view: 'dev' });
    function facet() { return Array.from(host.querySelectorAll('.dx-dv-mod')).map(function (b) { return b.textContent; }); }
    function shown() { return Array.from(host.querySelectorAll('.dx-dv-where b')).map(function (b) { return b.textContent; }); }
    out.dev = { facet: facet(), shown: shown(), groups: Array.from(host.querySelectorAll('.dx-dv-gh b')).map(function (b) { return b.textContent; }) };
    var q = host.querySelector('.dx-head-tools .dx-rk-q'); q.value = 'help lives'; q.dispatchEvent(new Event('input'));
    out.dev.q = { facet: facet(), shown: shown() };
    q = host.querySelector('.dx-head-tools .dx-rk-q'); q.value = ''; q.dispatchEvent(new Event('input'));
    Array.from(host.querySelectorAll('.dx-dv-mod')).filter(function (b) { return /^beta/.test(b.textContent); })[0].click();
    out.dev.beta = shown();
    Array.from(host.querySelectorAll('.dx-dv-tab')).filter(function (b) { return /^Before you change/.test(b.textContent); })[0].click();
    out.dev.pitMod = !!host.querySelector('.dx-dv-mod.on');
    out.dev.pits = Array.from(host.querySelectorAll('.dx-dv-pits li')).map(function (li) { return li.textContent; });
    Array.from(host.querySelectorAll('.dx-dv-tab')).filter(function (b) { return /^Naming/.test(b.textContent); })[0].click();
    out.dev.conv = Array.from(host.querySelectorAll('.dx-dv-cr:not(.head)')).map(function (row) { return row.children[0].textContent + '=' + row.children[2].textContent; });
    out.creates = Object.keys(data.flows).filter(function (k) { return /^Create/.test(data.flows[k].name); }).length;
    host.remove();
    return JSON.stringify(out);
  })()`));

  t.ok(r.az.join() === 'admin,beta,Sales', 'A–Z ignores letter case: ' + r.az.join());
  t.ok(r.size[0] === 'Sales' && r.size[2] === 'admin', 'Size counts documents and entities, the largest first: ' + r.size.join());
  t.ok(r.risk.join() === 'admin,Sales,beta', 'Risks puts a module with a P1 first, then the most risks: ' + r.risk.join());
  t.ok(r.items === r.docs && r.groupSum === r.docs, 'the groups of a module’s contents add up to its documents: ' + JSON.stringify([r.items, r.groupSum, r.docs]));
  t.ok(r.salesLinks.length === 2 && r.salesLinks.every((x) => /^betaboth ways/.test(x)), 'a pair that uses each other is marked both ways, on each side: ' + JSON.stringify(r.salesLinks));
  t.ok(r.betaRuns === 'Nothing. Everything here starts from a page or from another module.' && /^Connections/.test(r.betaTab), 'a module with nothing of its own to run says where it starts from, and keeps the tab');
  t.ok(r.facts.length === 3 && /^1pair of modules use each other$/.test(r.facts[1]), 'the module facts are counted from the data: ' + JSON.stringify(r.facts));
  t.ok(r.mutual.every((c) => / mu\b/.test(c)), 'a mutual pair is red on both sides of the diagonal: ' + JSON.stringify(r.mutual));
  t.ok(r.roles.length >= 1 && r.roles.every((x) => { const p = x.split(':')[1].split('/'); return p[0] === p[1] && p[1] === p[2]; }), 'the role matrix matches each role’s module roles: ' + r.roles.join(' '));
  t.ok(r.dev.facet[0] === 'Across the app1' && r.dev.facet.indexOf('Sales1') !== -1 && r.dev.facet.indexOf('beta2') !== -1, 'the facet counts the modules items name, the ones that name none first: ' + JSON.stringify(r.dev.facet));
  t.ok(r.dev.groups.join() === 'Across the app,beta,Sales', 'grouped by the first module named: ' + r.dev.groups.join());
  t.ok(r.dev.q.shown.join() === 'Where help lives' && r.dev.q.facet.join() === 'beta1', 'the filter narrows the list and the facet together: ' + JSON.stringify(r.dev.q));
  t.ok(r.dev.beta.join() === 'Where an order starts,Where help lives', 'a module picked shows every item that names it, not only its own group: ' + r.dev.beta.join());
  t.ok(!r.dev.pitMod && r.dev.pits.length === 2, 'another tab starts with no module picked');
  t.ok(r.dev.conv[0] === 'Create*=' + r.creates && r.dev.conv[1] === 'Constants are upper case=—', 'a pattern counts the names it matches, and a convention that is no name pattern shows none: ' + JSON.stringify(r.dev.conv));
};
