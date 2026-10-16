/* The default language (docs.js; Karol, 2026-10-16: "Default Language Polish in Settings, and every
 * project is Polish — I can still change one"). What this holds:
 *  - the projects list has the default, English (no default) at first;
 *  - choosing Polish gives it to every project with no language of its own, and leaves one that chose its
 *    own as it is; it is kept, and a reload keeps it;
 *  - a project's Settings still chooses its own;
 *  - English (no default) takes the default away again, and changes no project's language. */
'use strict';
const MODEL = require('./model');

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore && !!window.MxDocs', 15000, 'MxScout loaded');
  await mx.evaluate(`(async function () {
    var now = new Date().toISOString();
    await MxStore.delete('settings', 'contentLanguage');
    await MxStore.saveProjectWithModel({ id: 'dl1', name: 'Lang None', createdAt: now, updatedAt: now, source: { kind: 'test' }, bytes: 1, summary: null, appUrl: null }, ${JSON.stringify(MODEL)});
    await MxStore.saveProjectWithModel({ id: 'dl2', name: 'Lang German', createdAt: now, updatedAt: now, source: { kind: 'test' }, bytes: 1, summary: null, appUrl: null, contentLanguage: 'de' }, ${JSON.stringify(MODEL)});
    return true;
  })()`);
  await mx.navigate(t.MX);
  await mx.waitFor('!!window.MxDocs', 15000, 'MxScout loaded again');
  const SW = "(function(q){var s=document.querySelector('.switcher[aria-expanded=\"false\"]'); if (s) s.click(); return document.querySelectorAll(q);})";
  await mx.evaluate(`(Array.from(${SW}('button')).find(function (b) { return b.textContent.trim() === 'All projects'; }) || { click: function () {} }).click()`);
  // In Settings (settings.js) since 2026-10-16: with no project open, from the sidebar's foot.
  await mx.waitFor(`(function(){ var b = document.querySelector('.foot-settings, .home-settings'); if (b && !document.querySelector('.lang-default-select')) b.click(); return !!document.querySelector('.lang-default-select'); })()`, 8000, 'Settings');
  const first = await mx.waitFor(`(function(){ var s = document.querySelector('.lang-default-select'); return s && s.options[s.selectedIndex].textContent; })()`, 8000, 'the default language');
  t.ok(first === 'English (no default)', 'Settings has the default language, none at first: ' + first);
  const langs = () => mx.evaluate(`MxStore.getAll('projects').then(function (all) { return all.filter(function (p) { return p.id === 'dl1' || p.id === 'dl2'; }).map(function (p) { return p.id + ':' + (p.contentLanguage || '-'); }).sort().join(','); })`);
  t.ok(await langs() === 'dl1:-,dl2:de', 'one project with no language, one that chose German');

  await mx.evaluate(`(function(){ var s = document.querySelector('.lang-default-select'); s.value = 'pl'; s.dispatchEvent(new Event('change')); return true; })()`);
  await mx.waitFor(`MxStore.get('projects', 'dl1').then(function (p) { return p.contentLanguage === 'pl'; })`, 8000, 'the default given');
  t.ok(await langs() === 'dl1:pl,dl2:de', 'Polish as the default goes to the project with none, and the one that chose German keeps it');
  t.ok(await mx.evaluate(`MxStore.get('settings', 'contentLanguage').then(function (r) { return r && r.value; })`) === 'pl', 'and the default is kept');

  await mx.navigate(t.MX);
  await mx.waitFor('!!window.MxDocs', 15000, 'MxScout loaded again');
  await mx.evaluate(`(Array.from(${SW}('button')).find(function (b) { return b.textContent.trim() === 'All projects'; }) || { click: function () {} }).click()`);
  // In Settings (settings.js) since 2026-10-16: with no project open, from the sidebar's foot.
  await mx.waitFor(`(function(){ var b = document.querySelector('.foot-settings, .home-settings'); if (b && !document.querySelector('.lang-default-select')) b.click(); return !!document.querySelector('.lang-default-select'); })()`, 8000, 'Settings');
  const kept = await mx.waitFor(`(function(){ var s = document.querySelector('.lang-default-select'); return s && s.value; })()`, 8000, 'after a reload');
  t.ok(kept === 'pl' && await mx.evaluate(`MxDocs.defaultLanguage()`) === 'pl', 'a reload keeps it: ' + kept);

  await mx.evaluate(`(function(){ var s = document.querySelector('.lang-default-select'); s.value = ''; s.dispatchEvent(new Event('change')); return true; })()`);
  await mx.waitFor(`MxStore.get('settings', 'contentLanguage').then(function (r) { return !r; })`, 8000, 'the default taken away');
  t.ok(await langs() === 'dl1:pl,dl2:de', 'English (no default) takes the default away, and changes no project’s language');
  await mx.close();
};
