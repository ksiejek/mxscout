/* View as: where it is, what it does, and how wide it is (Karol, 2026-10-14: View as should behave the
 * same wherever it is; a control that does nothing is a lie).
 *
 *  - It is on the screens it narrows, and only there: Entities, Microflows, Nanoflows and Pages. The
 *    documentation's pages (Overview to For developers), Security (which shows every role at once),
 *    Settings, and what real sessions did — Live app, Performance, Logs, Comments — have none. The Live
 *    app carried one that changed nothing on it.
 *  - On each of the four, a role narrows the list to what that role reaches — the entities with an access
 *    rule for one of its module roles, the flows it may run, the pages it may open — and the line under
 *    the title says so, in the same words on every one: "N of M … that <role> …".
 *  - A long role name does not stretch the header: the select keeps between 150 and 260 px, and its
 *    title carries the name in full. */
'use strict';
const MODEL = require('./model');
const { goToSection } = require('./helpers');

const LONG = 'Regional_Order_Desk_Supervisor_For_The_Night_Shift';

module.exports = async function (t) {
  const model = JSON.parse(JSON.stringify(MODEL));
  model.userRoles.push({ name: LONG, moduleRoles: ['Sales.Agent'], manageAllRoles: false, manageableRoles: [] });
  const set = { 'Sales.Agent': true };
  const may = (list) => (list || []).filter((f) => (f.allowedModuleRoles || []).some((r) => set[r])).length;
  const expect = {
    Microflows: may(model.microflows), Nanoflows: may(model.nanoflows), Pages: may(model.pages),
    Entities: (model.entities || []).filter((e) => (e.accessRules || []).some((r) => set[r.moduleRole])).length
  };

  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore', 15000, 'MxScout loaded');
  await mx.evaluate(`(async () => {
    await MxStore.saveProjectWithModel({ id: 'pviewas', name: 'ViewAsDemo', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      source: { kind: 'test' }, bytes: 100, summary: null, appUrl: null }, ${JSON.stringify(model)});
    return true;
  })()`);
  await mx.viewport(1440, 900);
  await mx.navigate(t.MX);
  const SW = "(function(q){var s=document.querySelector('.switcher[aria-expanded=\"false\"]'); if (s) s.click(); return document.querySelectorAll(q);})";
  await mx.waitFor(`!!Array.from(${SW}('button')).find(n => n.textContent.trim() === 'ViewAsDemo')`, 10000, 'project');
  await mx.evaluate(`Array.from(${SW}('button')).find(n => n.textContent.trim() === 'ViewAsDemo').click()`);
  await mx.waitFor(`!!document.querySelector('.tree-section')`, 10000, 'project open');
  const labels = JSON.parse(await mx.evaluate(`JSON.stringify(Array.from(document.querySelectorAll('.tree-section .tree-section-label')).map(function (l) { return l.textContent.trim(); }))`));

  // ---- where it is ----
  const withIt = [];
  for (const name of labels) {
    await goToSection(mx, name, name === 'Documentation' ? '.docs-wrap, .dx, .docs-intro, .doc-screen, h1' : name === 'Logs' ? '.lg' : '.xe-head h1');
    await new Promise((r) => setTimeout(r, 250));
    if (await mx.evaluate(`!!document.querySelector('.xe-head .role-select, .main .role-select')`)) withIt.push(name);
  }
  t.ok(withIt.join('|') === 'Entities|Microflows|Nanoflows|Pages',
    'View as is on the four screens it narrows and on no other: ' + withIt.join('|') + ' (of ' + labels.join('|') + ')');

  // ---- what it does ----
  const pick = (v) => mx.evaluate(`(function(){ var s = document.querySelector('.xe-head .role-select'); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change')); return true; })()`);
  for (const name of ['Entities', 'Microflows', 'Nanoflows', 'Pages']) {
    await goToSection(mx, name, '.xe-head .role-select');
    await pick('all');
    await mx.waitFor(`document.querySelector('.xe-head .role-select').value === 'all' && !/ of /.test(document.querySelector('.xe-head .xe-sub').textContent)`, 5000, name + ' everything');
    const whole = await mx.evaluate(`document.querySelector('.xe-head .xe-sub').textContent`);
    await pick(LONG);
    const sub = await mx.waitFor(`(function(){ var s = document.querySelector('.xe-head .xe-sub'); return s && / of /.test(s.textContent) && s.textContent; })()`, 5000, name + ' narrowed');
    const m = /^(\d+) of (\d+)/.exec(sub) || [], n = Number(m[1]);
    if (name === 'Microflows' || name === 'Entities') t.ok(n > 0 && n < Number(m[2]), name + ': the role used here reaches some of them, not all, so the narrowing shows: ' + m[1] + ' of ' + m[2]);
    const verb = name === 'Entities' ? 'reaches' : name === 'Pages' ? 'may open' : 'may run';
    t.ok(n === expect[name] && sub.indexOf('that ' + LONG + ' ' + verb) !== -1,
      name + ': the role narrows the list to what it ' + verb.replace('may ', 'may ') + ' (' + expect[name] + '), and says so: "' + sub + '" (everything: "' + whole + '")');
  }

  // ---- how wide it is ----
  const sel = JSON.parse(await mx.evaluate(`(function(){ var s = document.querySelector('.xe-head .role-select'), r = s.getBoundingClientRect(), h = document.querySelector('.xe-head').getBoundingClientRect();
    return JSON.stringify({ w: Math.round(r.width), title: s.title, inHead: r.right <= h.right + 1, option: s.options[s.selectedIndex].textContent }); })()`));
  t.ok(sel.w >= 150 && sel.w <= 260 && sel.inHead, 'a long role name keeps View as between 150 and 260 px, inside the header: ' + sel.w + 'px');
  t.ok(sel.title.indexOf(LONG) !== -1 && sel.option === LONG, 'and the name in full is in its title and its list: ' + sel.title);
  await pick('all');
  const short = await mx.evaluate(`Math.round(document.querySelector('.xe-head .role-select').getBoundingClientRect().width)`);
  t.ok(short >= 150, 'Everything is not squeezed below the minimum either: ' + short + 'px');
  await mx.close();
};
