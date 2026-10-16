/* The Entities screen fits the window (public/docs.css .dx-dm): a project of many modules scrolls its
 * module list inside the screen, and the drawing and the panel keep the window's height — Karol,
 * 2026-10-14: the list ran past the screen and the drawing stopped halfway, grey under it. */
'use strict';
const { goToSection } = require('./helpers');
const fs = require('fs');
const path = require('path');
module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore && !!window.MxDomain', 15000, 'loaded');
  await mx.viewport(1440, 700);
  const model = { modules: [], entities: [], microflows: [], nanoflows: [], pages: [], associations: [] };
  for (let i = 0; i < 40; i++) { model.modules.push({ name: 'Mod' + i }); model.entities.push({ qualifiedName: 'Mod' + i + '.E', name: 'E', module: 'Mod' + i, attributes: [], accessRules: [] }); }
  await mx.evaluate(`(async function () { await MxStore.saveProjectWithModel({ id: 'ptall', name: 'Tall', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), source: { kind: 'test' }, bytes: 1, summary: null, appUrl: null }, ${JSON.stringify(model)}); })()`);
  const SW = "(function(q){var s=document.querySelector('.switcher[aria-expanded=\"false\"]'); if (s) s.click(); return document.querySelectorAll(q);})";
  await mx.navigate(t.MX);
  await mx.waitFor(`!!Array.from(${SW}('.tree-project')).find(b => b.textContent.indexOf('Tall') !== -1)`, 10000, 'project');
  await mx.evaluate(`Array.from(${SW}('.tree-project')).find(b => b.textContent.indexOf('Tall') !== -1).click()`);
  await goToSection(mx, 'Entities', '.dx-dm-mods');
  const r = await mx.evaluate(`JSON.stringify({ mods: document.querySelector('.dx-dm-mods').getBoundingClientRect().bottom, scroll: document.querySelector('.dx-dm-mods').scrollHeight > document.querySelector('.dx-dm-mods').clientHeight, main: document.querySelector('main.main').scrollHeight <= document.querySelector('main.main').clientHeight + 1, vh: innerHeight })`);
  const o = JSON.parse(r);
  t.ok(o.mods <= o.vh && o.scroll && o.main, 'forty modules: the list scrolls inside the screen, which keeps the window’s height: ' + r);
};
