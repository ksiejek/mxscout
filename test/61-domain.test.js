/* The documentation's Domain model (public/docs-view.js, redesign spec 15).
 *
 * The layout is MxScout's own (domainLayout, Karol 2026-10-13: no library): entities on a grid, the
 * associations as orthogonal lines through the channels between them. What has to hold:
 *  - on the redesign's own example — a mail module of a real project, 8 entities, 13 pairs — no two
 *    lines cross, and no line runs through a box; bigger graphs keep that second promise too;
 *  - every association inside the module is drawn, one line per pair with ×N for more; every association
 *    to another module sits at the foot of its entity instead;
 *  - "read N of M" counts the members the way the design does: attributes plus owned associations;
 *  - a non-persistable entity is told apart without colour (a dashed outline);
 *  - a module bigger than fourteen entities is drawn around the chosen entity, and says so;
 *  - picking a module or an entity, or the List view, is in the address. */
'use strict';
const fs = require('fs');
const path = require('path');

// The module's associations (owner > other, count, reference set), and its attribute counts.
const POST = {
  attrs: { Address: 12, Route: 9, Courier: 8, Comment: 2, Parcel: 9, Draft: 6, Letter: 6, TimeLine: 4 },
  pairs: [['Parcel', 'Address', 2], ['Draft', 'Address', 2], ['Draft', 'Courier', 2], ['Letter', 'Courier', 2], ['Letter', 'Address', 2],
    ['Route', 'Address', 1], ['Courier', 'Route', 1], ['Comment', 'Parcel', 1], ['Comment', 'Letter', 1], ['Draft', 'Letter', 1],
    ['Letter', 'Parcel', 1], ['TimeLine', 'Parcel', 1], ['TimeLine', 'Letter', 1]]
};

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxDescribe && !!window.MxDocsData && !!window.MxDocsView && !!window.MxReportData', 15000, 'MxScout loaded');
  for (const src of ['/sqlite.js', '/bson.js', '/mpr.js']) {
    await mx.evaluate(`new Promise(function (res, rej) { var x = document.createElement('script'); x.src = '${src}'; x.onload = function () { res(true); }; x.onerror = rej; document.head.appendChild(x); })`);
  }

  // ---- the layout ----
  const lay = JSON.parse(await mx.evaluate(`(function () {
    var R = ${JSON.stringify(POST)};
    function through(L) {
      var bad = 0;
      L.routes.forEach(function (rt) {
        for (var k = 0; k < rt.pts.length - 1; k++) {
          var a = rt.pts[k], b = rt.pts[k + 1];
          Object.keys(L.pos).forEach(function (n) { var q = L.pos[n];
            if (Math.max(a[0], b[0]) > q.x + 1 && Math.min(a[0], b[0]) < q.x + q.w - 1 && Math.max(a[1], b[1]) > q.y + 1 && Math.min(a[1], b[1]) < q.y + q.h - 1) bad++; });
        }
        for (var j = 0; j < rt.pts.length - 1; j++) if (rt.pts[j][0] !== rt.pts[j + 1][0] && rt.pts[j][1] !== rt.pts[j + 1][1]) bad += 1000; // not orthogonal
      });
      return bad;
    }
    // Every pair of runs of two different lines, counted the plain way: the layout counts its crossings
    // without trying every pair (it does so for every swap it tries), and must arrive at this number.
    function crossed(L) {
      var segs = [], n = 0;
      L.routes.forEach(function (rt, i) { for (var k = 0; k < rt.pts.length - 1; k++) segs.push([i, rt.pts[k], rt.pts[k + 1]]); });
      for (var x = 0; x < segs.length; x++) for (var y = x + 1; y < segs.length; y++) {
        if (segs[x][0] === segs[y][0]) continue;
        var a1 = segs[x][1], a2 = segs[x][2], b1 = segs[y][1], b2 = segs[y][2], aH = a1[1] === a2[1], bH = b1[1] === b2[1];
        if (aH === bH) continue;
        var h1 = aH ? a1 : b1, h2 = aH ? a2 : b2, v1 = aH ? b1 : a1, v2 = aH ? b2 : a2, cx = v1[0], cy = h1[1];
        if (cx > Math.min(h1[0], h2[0]) + 0.5 && cx < Math.max(h1[0], h2[0]) - 0.5 && cy > Math.min(v1[1], v2[1]) + 0.5 && cy < Math.max(v1[1], v2[1]) - 0.5) n++;
      }
      return n;
    }
    var G = { gx: 56, gy: 52, pad: 36, fy: 19 };
    var L = MxDocsView.layout(Object.keys(R.attrs), R.pairs.map(function (p) { return { a: p[0], b: p[1], n: p[2], many: false }; }), function (n) { return { w: 196, h: 38 + Math.min(5, R.attrs[n]) * 21 + 14 + 28 }; }, G);
    var out = { crossings: L.crossings, through: through(L), lines: L.routes.length, placed: Object.keys(L.pos).length };
    // bigger, made-up graphs: lines may have to cross, but never through a box
    var seed = 7; function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
    out.big = [[12, 16], [20, 30], [26, 44]].map(function (ne) {
      var nodes = []; for (var i = 0; i < ne[0]; i++) nodes.push('E' + i);
      var ps = {}; while (Object.keys(ps).length < ne[1]) { var a = Math.floor(rnd() * ne[0]), b = Math.floor(rnd() * ne[0]); if (a !== b) ps[Math.min(a, b) + '>' + Math.max(a, b)] = { a: 'E' + a, b: 'E' + b, n: 1 }; }
      var t0 = Date.now();
      var B = MxDocsView.layout(nodes, Object.keys(ps).map(function (k) { return ps[k]; }), function (n) { return { w: 196, h: 90 + (n.length * 13) % 70 }; }, G);
      return { through: through(B), lines: B.routes.length, ms: Date.now() - t0, counted: B.crossings === crossed(B) };
    });
    return JSON.stringify(out);
  })()`));
  t.ok(lay.placed === 8 && lay.lines === 13, 'every entity is placed and every pair has its line');
  t.ok(lay.crossings === 0, 'on the redesign’s own example no two lines cross: ' + lay.crossings);
  t.ok(lay.through === 0, 'and every line is orthogonal and runs past the boxes, never through one');
  t.ok(lay.big.every((b) => b.through === 0) && lay.big.every((b) => b.ms < 3000), 'bigger graphs keep lines out of the boxes, in reasonable time: ' + JSON.stringify(lay.big));
  t.ok(lay.big.every((b) => b.counted), 'and the crossings the layout weighs are every crossing there is, counted pair by pair: ' + JSON.stringify(lay.big));

  // ---- the page ----
  const v1b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  const r = JSON.parse(await mx.evaluate(`(async function () {
    var bytes = Uint8Array.from(atob("${v1b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    var model = await window.MxMpr.buildModel({ mprBytes: bytes, appName: 'Sales', readContentsFile: function () { throw new Error('v1'); } });
    var data = MxDocsData.build(model, { name: 'DomDemo' });
    // a module of its own with a non-persistable entity pointing into Sales, and a big module of twenty
    var anyQ = Object.keys(data.entities).filter(function (q) { return data.entities[q].module === 'Sales'; })[0];
    function ent(mod, name, pers) { var q = mod + '.' + name; data.entities[q] = { qn: q, module: mod, name: name, persistable: pers, generalization: null, view: false, doc: null, attributes: [{ name: 'Name', type: 'String(10)' }], roles: [], rules: 0, access: [] }; return q; }
    data.modules.push({ name: 'Notes', marketplace: false, microflows: [], nanoflows: [], pages: [], entities: [ent('Notes', 'Draft', false), ent('Notes', 'Note', true)] });
    data.associations.push({ name: 'Draft_Note', module: 'Notes', from: 'Notes.Draft', to: 'Notes.Note', many: false });
    data.associations.push({ name: 'Draft_Note_2', module: 'Notes', from: 'Notes.Draft', to: 'Notes.Note', many: false });
    data.associations.push({ name: 'Draft_Sales', module: 'Notes', from: 'Notes.Draft', to: anyQ, many: true });
    var big = []; for (var i = 0; i < 20; i++) big.push(ent('Big', 'B' + (i < 10 ? '0' : '') + i, true));
    for (i = 1; i < 20; i++) data.associations.push({ name: 'L' + i, module: 'Big', from: 'Big.B' + (i < 10 ? '0' : '') + i, to: i % 4 ? 'Big.B00' : 'Big.B01', many: false });
    data.modules.push({ name: 'Big', marketplace: false, microflows: [], nanoflows: [], pages: [], entities: big });
    var host = document.createElement('div'); host.style.height = '900px'; document.body.appendChild(host);
    var v = MxDocsView.mount(data, host, { preview: true, state: { view: 'domain', entity: 'Notes' } });
    function boxes() { return Array.from(host.querySelectorAll('.dx-dm-box')).map(function (b) { return b.querySelector('.dx-dm-bh b').textContent + (b.classList.contains('np') ? ':np' : '') + (b.classList.contains('on') ? ':on' : ''); }); }
    var band = function (name) { var b = Array.from(host.querySelectorAll('.dx-dm-box')).find(function (x) { return x.querySelector('.dx-dm-bh b').textContent === name; }); var k = b && b.querySelector('.dx-dm-kband'); return k ? k.className.replace('dx-dm-kband ', '') + ':' + k.textContent : null; };
    var legend = Array.from(host.querySelectorAll('.dx-dm-legend span')).map(function (x) { return x.textContent; }).join('|');
    var out = { kinds: { draft: band('Draft'), note: band('Note'), legend: legend }, notes: { boxes: boxes(), lines: host.querySelectorAll('.dx-dm-edge').length, pills: host.querySelectorAll('.dx-dm-pill').length,
      paths: Array.from(host.querySelectorAll('.dx-dm-edge')).map(function (p) { return p.getAttribute('d'); }), titles: Array.from(host.querySelectorAll('.dx-dm-edge title')).map(function (p) { return p.textContent; }).sort(),
      feet: Array.from(host.querySelectorAll('.dx-dm-foot')).map(function (f) { return f.textContent; }), mult: Array.from(host.querySelectorAll('.dx-dm-mult')).map(function (x) { return x.textContent; }).sort().join('') } };
    // Ctrl and the wheel zoom the drawing; the wheel alone does not
    var zl = function () { return host.querySelector('.dx-dm-zl').textContent; };
    var wrap = host.querySelector('.dx-dm-wrap');
    out.zoom = [zl()];
    wrap.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
    out.zoom.push(zl());
    var ev = new WheelEvent('wheel', { deltaY: -200, ctrlKey: true, bubbles: true, cancelable: true });
    wrap.dispatchEvent(ev);
    out.zoom.push(zl(), ev.defaultPrevented);
    // read N of M: members are the attributes and the associations the entity owns
    var sales = data.modules.filter(function (m) { return m.name === 'Sales'; })[0];
    var withRule = sales.entities.filter(function (q) { return data.entities[q].access.length; })[0];
    v.go({ view: 'domain', entity: withRule, dmodule: 'Sales' });
    var e = data.entities[withRule], owned = data.associations.filter(function (a) { return a.from === withRule; }).length, members = e.attributes.length + owned;
    out.read = { chips: Array.from(host.querySelectorAll('.dx-dm-can')).map(function (c) { return c.textContent; }), rule: e.access[0], members: members, h2: host.querySelector('.dx-dm-insp h2').textContent };
    v.go({ view: 'domain', entity: 'Big', dmodule: 'Big' });
    out.big = { boxes: host.querySelectorAll('.dx-dm-box').length, part: (host.querySelector('.dx-dm-part') || {}).textContent, sel: host.querySelector('.dx-dm-insp h2').textContent };
    v.go({ view: 'domain', entity: 'Big.B07', dmodule: 'Big' });
    out.big2 = { boxes: boxes() };
    // a readable XPath, and a role's access member by member
    var e2 = data.entities[withRule];
    e2.access.push({ role: 'Sales.Viewer', userRoles: ['Viewer'], read: 1, write: 1, create: false, del: false,
      xpath: "[Sales.Owner_Team/Sales.Team/Sales.Team_Lead = '[%CurrentUser%]' or Status != 'Closed'][Sales.Order_Draft/Sales.Draft]",
      members: (function () { var o = {}; e2.attributes.forEach(function (a, i) { o[a.name] = i === 0 ? 'rw' : ''; }); return o; })() });
    v.go({ view: 'domain', entity: withRule, dmodule: 'Sales' });
    var xp = Array.from(host.querySelectorAll('.dx-xp')).pop();
    out.xpath = xp ? Array.from(xp.querySelectorAll('.dx-xp-row')).map(function (r) { return Array.from(r.children).map(function (c) { return c.textContent; }).join('|'); }) : null;
    var chipBtn = Array.from(host.querySelectorAll('button.dx-dm-can.link')).pop();
    if (chipBtn) chipBtn.click();
    var ac = host.querySelector('.dx-ac');
    out.access = ac ? { title: ac.querySelector('h2').textContent, rows: Array.from(ac.querySelectorAll('.dx-ac-row')).map(function (r) { return r.className.replace('dx-ac-row ', '') + ':' + r.querySelector('.dx-ac-n').textContent; }) } : null;
    if (ac) host.querySelector('.dx-ac-close').click();
    out.closed = !host.querySelector('.dx-ac');
    v.go({ view: 'domain', entity: 'Big', dmodule: 'Big', dview: 'list' });
    out.list = { rows: host.querySelectorAll('.dx-dm-lr:not(.head)').length, state: v.state().dview };
    host.remove();
    return JSON.stringify(out);
  })()`));
  const N = r.notes;
  t.ok(N.boxes.slice().sort().join() === ['Draft:np', 'Note'].sort().join(),
    'a non-persistable entity has a dashed outline, told apart without colour: ' + N.boxes.join());
  t.ok(N.lines === 2 && N.pills === 0 && N.paths[0] !== N.paths[1] && N.titles.length === 2 && N.titles[0] !== N.titles[1],
    'two associations between one pair are two lines side by side, each named: ' + JSON.stringify(N));
  t.ok(N.mult === '**11', 'each with * at its owner and 1 at the other end: ' + N.mult);
  t.ok(r.zoom[0] === r.zoom[1] && r.zoom[2] !== r.zoom[0] && parseInt(r.zoom[2], 10) > parseInt(r.zoom[0], 10) && r.zoom[3] === true,
    'Ctrl and the wheel zoom in, the wheel alone scrolls: ' + JSON.stringify(r.zoom));
  t.ok(N.feet.length === 1 && /^↗ /.test(N.feet[0]), 'an association to another module sits at the foot of its entity, not as a line: ' + JSON.stringify(N.feet));
  t.ok(r.kinds.draft === null && r.kinds.note === null,
    'no word under the name: the outline and the colour tell the kind, the legend names it: ' + JSON.stringify(r.kinds));
  t.ok(/Persistable\|Non-persistable\|View entity\|\* 1association\|↗other module$/.test(r.kinds.legend), 'the legend names all three kinds: ' + r.kinds.legend);
  const R2 = r.read, rule = R2.rule;
  const expectRead = rule.read ? 'read ' + (rule.read >= R2.members ? 'all ' + rule.read : rule.read + ' of ' + R2.members) : 'no read';
  t.ok(R2.chips[0] === expectRead, 'read N of M counts attributes and owned associations: ' + JSON.stringify(R2));
  // As MxScout's Entities screen (Karol, 2026-10-14: the report looks like MxScout): nothing picked on
  // arrival, every entity of the module drawn; a pick greys the rest; no List view.
  t.ok(r.big.boxes === 20 && !r.big.part && r.big.sel === 'Big',
    'a module of twenty is drawn whole with nothing picked — the panel tells about the module: ' + JSON.stringify(r.big));
  t.ok(r.big2.boxes.indexOf('B07:on') !== -1 && r.big2.boxes.length === 20, 'picking one keeps the whole module, that one marked: ' + r.big2.boxes.join());
  t.ok(r.list.rows === 0, 'there is no List view: the diagram only');
  t.ok(JSON.stringify(r.xpath) === JSON.stringify(['Owner_Team|›|Team|›|Team_Lead|is|the current user', 'or|Status|is not|“Closed”', 'and|Order_Draft|›|Draft|exists']),
    'an XPath reads as paths of steps, an operator word and a value, one condition a line: ' + JSON.stringify(r.xpath));
  t.ok(r.access && r.access.rows.length >= 1 && /^write:/.test(r.access.rows[0]) && r.access.rows.slice(1).every(function (x) { return /^none:/.test(x); }) && r.closed,
    'read / write open the role’s access member by member — write, read, none — and close again: ' + JSON.stringify(r.access));
};
