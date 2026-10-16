/* Search everything in the documentation (public/docs-view.js openSearch, spec 10 [LUKA];
 * Karol 2026-10-13: a dialog, names and text).
 *
 * What has to hold:
 *  - Ctrl K, or the field in the sidebar, opens a dialog with the focus in its input; Esc closes it;
 *  - names come grouped by what they are, in a fixed order, each group with its count, the best
 *    match first; a long group shows six and offers the rest;
 *  - the words an agent wrote are searched too, shown as a snippet with the match marked;
 *  - case and accents do not matter ("dyzur" finds "dyżur");
 *  - the arrows move, Enter goes to what was found and closes the dialog;
 *  - text is set as text: a name with markup in it stays text;
 *  - the app's own small previews never open it. */
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxDescribe && !!window.MxDocsData && !!window.MxDocsView', 15000, 'MxScout loaded');
  for (const src of ['/sqlite.js', '/bson.js', '/mpr.js']) {
    await mx.evaluate(`new Promise(function (res, rej) { var x = document.createElement('script'); x.src = '${src}'; x.onload = function () { res(true); }; x.onerror = rej; document.head.appendChild(x); })`);
  }
  const v1b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  const desc = {
    format: 'mxscout-descriptions', version: 1,
    app: { summary: 'Orders.', story: 'The clerk on duty — dyżur — takes orders.', processes: [{ name: 'Taking an order', steps: ['Save'], flows: ['Sales.CreateOrder'] }] },
    microflows: { 'Sales.SweepOrders': { text: 'Sweeps the old orders away at night.' } },
    risks: [{ level: 'P2', title: 'Orders <b>pile</b> up', detail: 'Nothing archives them.', fix: 'Archive.', where: ['Sales.SweepOrders'] }]
  };
  const r = JSON.parse(await mx.evaluate(`(async function () {
    var bytes = Uint8Array.from(atob("${v1b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    var model = await window.MxMpr.buildModel({ mprBytes: bytes, appName: 'Sales', readContentsFile: function () { throw new Error('v1'); } });
    var data = MxDocsData.build(model, { name: 'SearchDemo' });
    // many flows named alike, so a group has more than six
    var src = data.flows['microflow:Sales.CreateOrder'];
    for (var i = 0; i < 9; i++) { var c = JSON.parse(JSON.stringify(src)); c.qn = 'Sales.Order_Step' + i; c.name = 'Order_Step' + i; c.key = 'microflow:' + c.qn; data.flows[c.key] = c; data.modules[0].microflows.push(c.key); }
    MxDescribe.attach(data, MxDescribe.parse(${JSON.stringify(JSON.stringify(desc))}).value);
    var host = document.createElement('div'); host.style.height = '800px'; document.body.appendChild(host);
    var v = MxDocsView.mount(data, host, {});
    function q(text) { var i = host.querySelector('.dx-sd-q'); i.value = text; i.dispatchEvent(new Event('input')); }
    function groups() { return Array.from(host.querySelectorAll('.dx-sd-g')).map(function (g) { return g.firstChild.textContent + ':' + g.lastChild.textContent; }); }
    function key(k) { host.querySelector('.dx-sd-q').dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); }
    var out = {};
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    out.opened = !!host.querySelector('.dx-sd') && document.activeElement === host.querySelector('.dx-sd-q');
    q('order');
    out.order = { groups: groups(), first: host.querySelector('.dx-sd-row').textContent, mfRows: Array.from(host.querySelectorAll('.dx-sd-row')).filter(function (x) { return /^MF/.test(x.textContent); }).length,
      more: (host.querySelector('.dx-sd-more') || {}).textContent, marks: host.querySelectorAll('.dx-sd-row mark').length };
    host.querySelector('.dx-sd-more').click();
    out.allMf = Array.from(host.querySelectorAll('.dx-sd-row')).filter(function (x) { return /^MF/.test(x.textContent); }).length;
    q('DYZUR');
    out.accent = { groups: groups(), snip: Array.from(host.querySelectorAll('.dx-sd-snip')).map(function (s) { return s.textContent; }), mark: (host.querySelector('.dx-sd-snip mark') || {}).textContent };
    q('night');
    out.text = { groups: groups(), where: (host.querySelector('.dx-sd-tt b') || {}).textContent };
    key('Enter');
    out.afterText = { view: v.state().view, key: v.state().key, closed: !host.querySelector('.dx-sd') };
    host.querySelector('.dx-searchbox').click();
    q('pile');
    out.markup = { title: (host.querySelector('.dx-sd-t') || {}).textContent, html: !!host.querySelector('.dx-sd-t b') };
    q('sweep');
    out.sweepRows = Array.from(host.querySelectorAll('.dx-sd-row')).map(function (x) { return x.textContent; });
    key('ArrowDown');
    out.active = host.querySelector('.dx-sd-row.on').textContent;
    key('Enter');
    out.afterArrow = v.state().view + ':' + (v.state().key || v.state().sub);
    host.querySelector('.dx-searchbox').click();
    q('zzzz');
    out.none = (host.querySelector('.dx-sd-empty') || {}).textContent;
    key('Escape');
    out.escClosed = !host.querySelector('.dx-sd');
    host.remove();
    // the app's previews never open it
    var h2 = document.createElement('div'); document.body.appendChild(h2);
    MxDocsView.mount(data, h2, { preview: true });
    h2.querySelector('.dx-searchbox').click();
    out.preview = !h2.querySelector('.dx-sd');
    h2.remove();
    return JSON.stringify(out);
  })()`));
  t.ok(r.opened, 'Ctrl K opens the dialog with the focus in its input');
  const ORDER = ['Modules', 'Processes', 'Microflows', 'Nanoflows', 'Pages', 'Entities', 'Risks', 'In the text an agent wrote'];
  const gNames = r.order.groups.map((g) => g.split(':')[0]);
  t.ok(r.order.groups.indexOf('Microflows:11') !== -1 && gNames.every((g, i) => i === 0 || ORDER.indexOf(gNames[i - 1]) < ORDER.indexOf(g)) && gNames[gNames.length - 1] === 'In the text an agent wrote',
    'names come grouped by what they are, in a fixed order with a count, the text last: ' + JSON.stringify(r.order.groups));
  t.ok(/^01Taking an order/.test(r.order.first) && r.order.marks >= 6, 'the first group’s best match leads, and the match is marked: ' + r.order.first);
  t.ok(r.order.mfRows === 6 && r.order.more === 'Show all 11' && r.allMf === 11, 'a long group shows six and offers the rest: ' + JSON.stringify([r.order.mfRows, r.order.more, r.allMf]));
  t.ok(r.accent.mark && r.accent.mark.toLowerCase() === 'dyżur' && r.accent.groups.some((g) => /^In the text an agent wrote:\d+$/.test(g)), 'case and accents do not matter, and the agent’s text is searched: ' + JSON.stringify(r.accent));
  t.ok(r.text.where === 'Sales.SweepOrders' && r.afterText.view === 'refs' && r.afterText.key === 'microflow:Sales.SweepOrders' && r.afterText.closed,
    'a word in a flow’s description finds the flow, and Enter opens it and closes the dialog: ' + JSON.stringify(r.afterText));
  t.ok(r.markup.title === 'Orders <b>pile</b> up' && !r.markup.html, 'a name with markup in it stays text');
  t.ok(r.sweepRows.length >= 2 && r.active === r.sweepRows[1] && /^(refs|risks):/.test(r.afterArrow), 'the arrows move, Enter goes there: ' + JSON.stringify([r.sweepRows, r.afterArrow]));
  t.ok(r.none === 'Nothing matches “zzzz”.' && r.escClosed, 'an empty search says so, and Esc closes the dialog');
  t.ok(r.preview, 'the app’s small previews never open it');
};
