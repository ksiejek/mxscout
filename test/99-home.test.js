/* The projects page (public/home.js — Karol, 2026-10-16): where MxScout opens and where its logo leads, in
 * the redesigned screens' frame, and the one place that says where each project is kept.
 *
 * What has to hold:
 *  - the logo and the name in the sidebar lead to it from any project;
 *  - one card per project, each saying where it is kept — this browser only, a folder of its own, your
 *    MxScout folder, its Mendix project (mxscout/) — and what that means for Claude;
 *  - a project's actions are behind its ⋯, the page's behind the header's; a search when there are many;
 *  - "Set up MxScout once" while the MxScout folder or the default language is not chosen: the language is
 *    chosen right there, and Not now hides it for good;
 *  - a project's Settings: its own settings first, starting with where it is kept; the global ones under them. */
'use strict';
const MODEL = require('./model');

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.viewport(1440, 900);
  await mx.waitFor('!!window.MxStore && !!window.MxHome', 15000, 'MxScout loaded');
  await mx.evaluate(`(async function () {
    var now = new Date().toISOString();
    await MxStore.delete('settings', 'contentLanguage');
    await MxStore.delete('settings', 'homeSetupHidden');
    var names = ['Harbour', 'Billing Hub', 'Clinic', 'Warehouse'];
    for (var i = 0; i < names.length; i++) {
      await MxStore.saveProjectWithModel({ id: 'h' + i, name: names[i], createdAt: now, updatedAt: now, source: { kind: 'test' }, bytes: 1,
        summary: { modules: 3 + i, microflows: 10 * (i + 1), nanoflows: i, pages: 4, entities: 7, mendixVersion: '10.18.3' }, appUrl: null }, ${JSON.stringify(MODEL)});
    }
    return true;
  })()`);
  await mx.navigate(t.MX);
  await mx.waitFor('!!window.MxHome && !!document.querySelector(".home .home-card")', 15000, 'the projects page');

  // ---- the page ----
  const page = JSON.parse(await mx.evaluate(`JSON.stringify({ h1: document.querySelector('.xe-head h1').textContent, sub: document.querySelector('.xe-head .xe-sub').textContent,
    cards: document.querySelectorAll('.home-grid .project-card').length, tile: !!document.querySelector('.home-tile-new'),
    kept: Array.from(document.querySelectorAll('.home-card .home-kept')).map(function (k) { return k.getAttribute('data-kind'); }).join(','),
    text: document.querySelector('.home-card .home-kept').textContent, stats: document.querySelector('.home-card .home-stats').textContent,
    flush: !!document.querySelector('.content-wrap.flush .home'), global: document.querySelector('.home-global').textContent })`));
  t.ok(page.h1 === 'Projects' && /^4 Mendix applications/.test(page.sub) && page.cards === 4 && page.tile && page.flush,
    'the projects page is drawn in the screens’ frame: its title, how many, a card each and a tile for a new one: ' + page.sub);
  t.ok(page.kept === 'browser,browser,browser,browser' && /This browser only/.test(page.text) && /Claude:/.test(page.text) && /Share with an agent/.test(page.text),
    'every card says where the project is kept, and what that means for Claude: ' + page.text.slice(0, 90));
  t.ok(/modules/.test(page.stats) && /flows/.test(page.stats) && /entities/.test(page.stats), 'with its numbers: ' + page.stats);
  t.ok(/Global settings/.test(page.global) && /English \(not chosen\)/.test(page.global), 'the global settings in one line at the foot: ' + page.global);

  // ---- where kept, every way ----
  const kinds = JSON.parse(await mx.evaluate(`(async function () {
    var real = { folderInfo: MxStore.folderInfo, homeInfo: MxStore.homeInfo, inHome: MxStore.inHome };
    MxStore.folderInfo = function (id) { return id === 'h1' ? { name: 'Billing Hub', layout: 1, status: 'connected' } : id === 'h2' ? { name: 'Clinic', layout: 1, status: 'connected', path: 'D:/Work/Clinic' }
      : id === 'h3' ? { name: 'mxscout', layout: 2, repoName: 'Warehouse-main', localName: 'Warehouse', status: 'connected' } : null; };
    MxStore.homeInfo = function () { return { name: 'MxScout' }; };
    MxStore.inHome = function (id) { return Promise.resolve(id === 'h1'); };
    var p = function (id) { return MxStore.getAll('projects').then(function (all) { return all.filter(function (x) { return x.id === id; })[0]; }); };
    MxHome.keptIn(await p('h1')); MxHome.keptIn(await p('h2'));
    await new Promise(function (r) { setTimeout(r, 50); });
    var out = {};
    for (var id of ['h0', 'h1', 'h2', 'h3']) { var k = MxHome.keptIn(await p(id)); out[id] = k.kind + '|' + k.title + '|' + (k.place || '') + '|' + k.claude; }
    Object.assign(MxStore, real);
    return JSON.stringify(out);
  })()`));
  t.ok(/^home\|In your MxScout folder\|MxScout\/Billing Hub\|Ask Claude: \/mxscout-project Billing Hub/.test(kinds.h1), 'in the MxScout folder: where, and the one line to give Claude: ' + kinds.h1);
  t.ok(/^folder\|In a folder of its own\|D:\/Work\/Clinic\|/.test(kinds.h2), 'in a folder of its own, by its path: ' + kinds.h2);
  t.ok(/^repo\|In its Mendix project\|Warehouse-main\/mxscout\|Start Claude in the Mendix project folder/.test(kinds.h3), 'in its Mendix project: mxscout/, and where Claude starts: ' + kinds.h3);
  t.ok(/^browser\|This browser only\|\|/.test(kinds.h0), 'in this browser only: ' + kinds.h0.split('|').slice(0, 2).join(' · '));

  // ---- menus ----
  await mx.evaluate(`document.querySelector('.home-card[data-id="h0"] .xe-more .xe-icon-btn').click()`);
  const cardMenu = await mx.waitFor(`(function(){ var m = document.querySelector('.home-card[data-id="h0"] .xe-menu'); return m && Array.from(m.querySelectorAll('button')).map(function (b) { return b.textContent; }).join('|'); })()`, 4000, 'the card menu');
  t.ok(/^Open\|Rename…\|Replace model…\|Package…\|.*Delete project$/.test(cardMenu), 'a project’s actions are behind its ⋯: ' + cardMenu);
  await mx.evaluate(`document.querySelector('.home-body').click()`);
  await mx.waitFor(`!document.querySelector('.home-card .xe-menu')`, 4000, 'closed by a click beside it');
  await mx.evaluate(`document.querySelector('.home-head .xe-more .xe-icon-btn').click()`);
  const pageMenu = await mx.waitFor(`(function(){ var m = document.querySelector('.home-head .xe-menu'); return m && Array.from(m.querySelectorAll('button')).map(function (b) { return b.textContent; }).join('|'); })()`, 4000, 'the page menu');
  t.ok(/Export documentation…/.test(pageMenu) && /Settings/.test(pageMenu) && /Getting started/.test(pageMenu) && /About & security/.test(pageMenu), 'the page’s own actions behind the header’s ⋯: ' + pageMenu);
  await mx.evaluate(`document.querySelector('.home-head .xe-more .xe-icon-btn').click()`);

  // ---- search ----
  await mx.evaluate(`(function(){ var s = document.querySelector('.home-search'); s.value = 'bill'; s.dispatchEvent(new Event('input')); return true; })()`);
  const shown = await mx.evaluate(`Array.from(document.querySelectorAll('.home-grid .project-card')).filter(function (c) { return !c.hidden; }).map(function (c) { return c.querySelector('.project-name').textContent; }).join(',')`);
  t.ok(shown === 'Billing Hub', 'the search keeps the projects whose name matches: ' + shown);
  await mx.evaluate(`(function(){ var s = document.querySelector('.home-search'); s.value = ''; s.dispatchEvent(new Event('input')); return true; })()`);

  // ---- set up once ----
  const setup = await mx.evaluate(`(function(){ var s = document.querySelector('.home-setup'); return s ? s.textContent : ''; })()`);
  t.ok(/Set up MxScout once/.test(setup) && /The language Claude writes in/.test(setup) && /English until you choose/.test(setup) && !!(await mx.evaluate(`!!document.querySelector('.home-setup .lang-default-select')`)),
    'with no default language, the page asks for it, right there: ' + setup.slice(0, 80));
  await mx.evaluate(`(function(){ var s = document.querySelector('.home-setup .lang-default-select'); s.value = 'pl'; s.dispatchEvent(new Event('change')); return true; })()`);
  await mx.waitFor(`MxStore.get('settings', 'contentLanguage').then(function (r) { return r && r.value === 'pl'; })`, 8000, 'the default chosen on the page');
  t.ok(/Polish/.test(await mx.waitFor(`(function(){ var g = document.querySelector('.home-global'); return g && /Polish/.test(g.textContent) && g.textContent; })()`, 5000, 'the line at the foot')),
    'chosen there, it is the global default — the line at the foot says so');
  if (await mx.evaluate(`!!document.querySelector('.home-setup .home-setup-hide')`)) {
    await mx.evaluate(`document.querySelector('.home-setup .home-setup-hide').click()`);
    await mx.waitFor(`!document.querySelector('.home-setup')`, 4000, 'hidden');
    await mx.navigate(t.MX);
    await mx.waitFor('!!document.querySelector(".home .home-card")', 15000, 'the projects page again');
    t.ok(await mx.evaluate(`!document.querySelector('.home-setup')`), 'Not now hides it, and it stays hidden after a reload');
  } else t.ok(true, 'with the language chosen and no folder support, nothing is left to set up');

  // ---- the logo leads home ----
  await mx.evaluate(`document.querySelector('.home-card[data-id="h2"] .home-card-open').click()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.tree-section')).find(function (b) { return /^Overview/.test(b.textContent); })`, 10000, 'the project open');
  await mx.evaluate(`document.querySelector('.sidebar-home').click()`);
  await mx.waitFor(`!!document.querySelector('.home .home-card') && !Array.from(document.querySelectorAll('.tree-section')).find(function (b) { return /^Overview/.test(b.textContent); })`, 6000, 'home again');
  t.ok(true, 'the logo leads from an open project back to the projects page');

  // ---- a project's Settings ----
  await mx.evaluate(`document.querySelector('.home-card[data-id="h2"] .home-card-open').click()`);
  const settingsBtn = `(document.querySelector('.foot-settings') || Array.from(document.querySelectorAll('.tree-section')).find(function (b) { return b.textContent.trim() === 'Settings'; }))`;
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.tree-section')).find(function (b) { return /^Overview/.test(b.textContent); }) && !!${settingsBtn}`, 10000, 'the project open again');
  await mx.evaluate(`${settingsBtn}.click()`);
  const set = JSON.parse(await mx.waitFor(`(function(){ var h = Array.from(document.querySelectorAll('.set-sec-head h3')).map(function (x) { return x.textContent; }); var first = document.querySelector('.set-sec .set-row'); return h.length === 2 && JSON.stringify({ h: h.join('|'), first: first.className, kept: first.textContent, lang: (document.querySelector('.set-lang') || {}).textContent || '' }); })()`, 8000, 'Settings'));
  t.ok(set.h === 'Project settings|Global settings', 'a project’s Settings: its own first, the global ones under them: ' + set.h);
  t.ok(/set-kept/.test(set.first) && /This browser only/.test(set.kept) && /Keep in the Mendix project/.test(set.kept), 'and it starts with where it is kept, with the other places it can go: ' + set.kept.slice(0, 80));
  t.ok(/the global default is Polish/.test(set.lang), 'its language says what the global default is: ' + set.lang.slice(0, 120));
  await mx.close();
};
