/* Marketplace modules — hidden by default, not just dimmed.
 *
 * A real app's model is dominated by modules nobody browsing it actually
 * came to look at (CommunityCommons, Encryption, Atlas_Core, ...) — Studio
 * Pro's own App Explorer already buckets these under a "Marketplace
 * modules" folder, using the module's own FromAppStore flag (public/mpr.js
 * reads it into model.modules[].fromAppStore). This proves the browsing
 * side: off by default, a flagged module and everything in it disappears
 * from the chip row, the list, and the sidebar entirely — not greyed out,
 * not a chip left to toggle — and a per-project setting in Settings brings
 * it back, surviving a reload. The redesigned screens carry no quick chip for
 * it in their header (Karol, 2026-10-13); the Domain model has its own
 * Own | Marketplace switch. */
'use strict';
const { goToSection } = require('./helpers');

const MODEL = {
  modules: [{ name: 'Sales' }, { name: 'CommunityCommons', fromAppStore: true }],
  userRoles: [],
  entities: [
    { qualifiedName: 'Sales.Order', name: 'Order', module: 'Sales', attributes: [], accessRules: [] },
    { qualifiedName: 'CommunityCommons.LogMessage', name: 'LogMessage', module: 'CommunityCommons', attributes: [], accessRules: [] }
  ],
  associations: [],
  microflows: [
    // Takes an object of a Marketplace module's entity — the ordinary case of
    // a project flow that logs through CommunityCommons.
    { qualifiedName: 'Sales.CancelOrder', name: 'CancelOrder', module: 'Sales', allowedModuleRoles: [],
      parameters: [{ name: 'Log', entityQualifiedName: 'CommunityCommons.LogMessage', isList: false }] },
    { qualifiedName: 'CommunityCommons.StringUtils', name: 'StringUtils', module: 'CommunityCommons', allowedModuleRoles: [], parameters: [] }
  ],
  nanoflows: [], pages: [],
  // The tree draws from `modules`, so a hidden module's documents never showed
  // — but they were still being COUNTED, and a count that disagrees with what
  // is on screen is the one thing a tree must not do.
  folders: [
    { module: 'Sales', name: 'Orders', path: [] },
    { module: 'CommunityCommons', name: 'Utils', path: [] }
  ],
  documents: [
    { module: 'Sales', name: 'CancelOrder', qualifiedName: 'Sales.CancelOrder', type: 'Microflows$Microflow', kind: 'microflow', path: ['Orders'] },
    { module: 'CommunityCommons', name: 'StringUtils', qualifiedName: 'CommunityCommons.StringUtils', type: 'Microflows$Microflow', kind: 'microflow', path: ['Utils'] }
  ]
};

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore', 15000, 'MxScout loaded');
  await mx.evaluate(`(async () => {
    await MxStore.saveProjectWithModel(
      { id: 'p1', name: 'Demo', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        source: { kind: 'test' }, bytes: 100, summary: null, appUrl: null, devTools: true },
      ${JSON.stringify(MODEL)});
    return true;
  })()`);
  await mx.navigate(t.MX);
  await mx.waitFor(`!!Array.from((function(q){var s=document.querySelector('.switcher[aria-expanded="false"]'); if (s) s.click(); return document.querySelectorAll(q);})('button,a')).find(n => n.textContent.trim() === 'Demo')`, 10000, 'project in sidebar');
  await mx.evaluate(`(function(){ var e = Array.from((function(q){var s=document.querySelector('.switcher[aria-expanded="false"]'); if (s) s.click(); return document.querySelectorAll(q);})('button,a')).filter(n => n.textContent.trim() === 'Demo'); e[e.length-1].click(); return true; })()`);
  await mx.waitFor(`!!document.querySelector('.chip, .flow-card, .entity-card, .dx-dm-box, .dm-screen')`, 8000, 'project open');

  // ---- entities (the Domain model): Own first, Marketplace behind its own switch, ----
  await goToSection(mx, 'Entities', '.dx-dm-mrow');
  const mods = () => mx.evaluate(`Array.from(document.querySelectorAll('.dx-dm-mrow')).map(function (o) { return o.firstChild.textContent; }).join(',')`);
  const m0 = await mods();
  t.ok(/(^|,)Sales(,|$)/.test(m0) && !/CommunityCommons/.test(m0), 'the domain model starts on the project’s own modules: ' + m0);
  const scope = await mx.evaluate(`Array.from(document.querySelectorAll('.dx-dm-scope button')).map(function (b) { return b.textContent + (b.classList.contains('on') ? '*' : ''); }).join('|')`);
  t.ok(/^Own\d+\*\|Marketplace1$/.test(scope), 'with an Own | Marketplace switch, Own on: ' + scope);
  await mx.evaluate(`Array.from(document.querySelectorAll('.dx-dm-scope button')).find(function (b) { return /^Marketplace/.test(b.textContent); }).click()`);
  t.ok(await mx.waitFor(`(function(){ var s = document.querySelector('.dx-dm-mrow.on'); return s && s.firstChild.textContent === 'CommunityCommons' && !!Array.from(document.querySelectorAll('.dx-dm-box b')).find(function (b) { return b.textContent === 'LogMessage'; }); })()`, 8000, 'marketplace'),
    'Marketplace shows that module and its entity, whatever the project setting hides elsewhere');
  await mx.evaluate(`Array.from(document.querySelectorAll('.dx-dm-scope button')).find(function (b) { return /^Own/.test(b.textContent); }).click()`);

  // ---- no chip in the header of a list screen (Karol, 2026-10-13: "remove it") — Settings has the switch ----
  await goToSection(mx, 'Microflows', '.mf .xe-head');
  t.ok(!/CommunityCommons/.test(await mx.evaluate(`document.body.textContent`)), 'elsewhere the marketplace module is entirely absent, not just dimmed');
  t.ok(await mx.evaluate(`!Array.from(document.querySelectorAll('.xe-head .chip')).find(c => /from Marketplace/.test(c.textContent))`), 'and the header carries no Marketplace chip');

  // Revert via Settings so the "off by default" checks below still hold —
  // this only proves the chip and the checkbox are the same underlying flag.
  await goToSection(mx, 'Settings');
  await mx.waitFor(`/Marketplace modules/.test(document.body.textContent)`, 8000, 'settings shows the card');
  await mx.evaluate(`(function(){ var card = document.querySelector('.set-market'); var cb = card.querySelector('input[type=checkbox]'); cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await new Promise((r) => setTimeout(r, 300));

  // ---- microflows view: same story ----
  await goToSection(mx, 'Microflows', '.mf-mod-card');
  t.ok(await mx.evaluate(`!Array.from(document.querySelectorAll('.mf-mod-card')).some(function (c) { return /CommunityCommons/.test(c.textContent); })`), 'the modules listed first leave the marketplace module out');
  await mx.evaluate(`document.querySelector('.mf-mod-card').click()`);
  await mx.waitFor(`document.body.textContent.indexOf('CancelOrder') !== -1`, 8000, 'microflows shown');
  let bodyText = await mx.evaluate(`document.body.textContent`);
  t.ok(/CancelOrder/.test(bodyText), 'the project’s own microflow is shown');
  // Absent from the lists; a type a flow takes may still name it (an own flow's $Log is a CommunityCommons.LogMessage).
  const listed = await mx.evaluate(`Array.from(document.querySelectorAll('.mf-row, .mf-mod-card, .mf-module select option')).map(function (r) { return r.textContent; }).join('|')`);
  t.ok(!/StringUtils/.test(bodyText) && !/CommunityCommons/.test(listed),
    'the marketplace module’s microflow is entirely absent from the lists too: ' + listed);

  // ---- Settings: the toggle, off by default ----
  await goToSection(mx, 'Settings');
  await mx.waitFor(`/Marketplace modules/.test(document.body.textContent)`, 8000, 'settings shows the card');
  const settingsText = await mx.evaluate(`document.body.textContent`);
  t.ok(/CommunityCommons/.test(settingsText), 'Settings names the hidden module, so it is discoverable: ' + settingsText.slice(0, 50));
  t.ok(await mx.evaluate(`(function(){ var rows = Array.from(document.querySelectorAll('.card')); var card = document.querySelector('.set-market'); var cb = card && card.querySelector('input[type=checkbox]'); return !!cb && !cb.checked; })()`),
    'the checkbox starts unchecked — hidden is the default');

  // ---- turning it on reveals everything, live, no reload needed ----
  await mx.evaluate(`(function(){ var card = document.querySelector('.set-market'); var cb = card.querySelector('input[type=checkbox]'); cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await new Promise((r) => setTimeout(r, 300));

  // (the Domain model has its own switch and is not ruled by this setting; the lists are)
  await goToSection(mx, 'Microflows', '.mf .xe-head');
  await mx.waitFor(`/CommunityCommons/.test(document.body.textContent)`, 8000, 'now shown');
  t.ok(await mx.evaluate(`!!Array.from(document.querySelectorAll('.mf-mod-card, .mf-module-select option')).find(function (c) { return /^CommunityCommons/.test(c.textContent); })`), 'the marketplace module now shows, without reopening the project');

  // ---- the setting is persisted: a reload keeps it on ----
  await mx.navigate(t.MX);
  await mx.waitFor(`!!Array.from((function(q){var s=document.querySelector('.switcher[aria-expanded="false"]'); if (s) s.click(); return document.querySelectorAll(q);})('button,a')).find(n => n.textContent.trim() === 'Demo')`, 10000, 'reloaded');
  await mx.evaluate(`(function(){ var e = Array.from((function(q){var s=document.querySelector('.switcher[aria-expanded="false"]'); if (s) s.click(); return document.querySelectorAll(q);})('button,a')).filter(n => n.textContent.trim() === 'Demo'); e[e.length-1].click(); return true; })()`);
  await goToSection(mx, 'Microflows', '.mf .xe-head');
  t.ok(await mx.waitFor(`/CommunityCommons/.test(document.body.textContent)`, 8000, 'still shown after reload'),
    'the choice survives a reload — it is a project setting, not view-session state');

  // ---- hidden is not gone ----
  // Something in a hidden Marketplace module is still in the model. Telling a
  // reader it was "renamed or removed" sent them looking for a change nobody
  // made: a comment on it was flagged as orphaned, and a flow taking one of
  // its entities said the type was "not in this model".
  await mx.evaluate(`(async () => {
    const now = new Date().toISOString();
    const base = { projectId: 'p1', role: null, severity: 'medium', change: '', status: 'open', author: 'Karol', history: [], createdAt: now, updatedAt: now };
    await MxStore.put('findings', Object.assign({ id: 'mk-hidden', problem: 'On a hidden entity',
      target: { kind: 'entity', qualifiedName: 'CommunityCommons.LogMessage', module: 'CommunityCommons', name: 'LogMessage', attributes: [] } }, base));
    await MxStore.put('findings', Object.assign({ id: 'mk-gone', problem: 'On a removed entity',
      target: { kind: 'entity', qualifiedName: 'Sales.Invoice', module: 'Sales', name: 'Invoice', attributes: [] } }, base));
    return true;
  })()`);
  await goToSection(mx, 'Settings');
  await mx.waitFor(`/Marketplace modules/.test(document.body.textContent)`, 8000, 'settings again');
  await mx.evaluate(`(function(){ var card = document.querySelector('.set-market'); var cb = card.querySelector('input[type=checkbox]'); cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  // Reopened so the comments are read from storage, not from before they were written.
  await mx.navigate(t.MX);
  await mx.waitFor(`!!Array.from((function(q){var s=document.querySelector('.switcher[aria-expanded="false"]'); if (s) s.click(); return document.querySelectorAll(q);})('button,a')).find(n => n.textContent.trim() === 'Demo')`, 10000, 'reloaded for comments');
  await mx.evaluate(`(function(){ var e = Array.from((function(q){var s=document.querySelector('.switcher[aria-expanded="false"]'); if (s) s.click(); return document.querySelectorAll(q);})('button,a')).filter(n => n.textContent.trim() === 'Demo'); e[e.length-1].click(); return true; })()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('button,a')).find(n => /^Comments/.test(n.textContent.trim()))`, 8000, 'project reopened');
  await mx.evaluate(`Array.from(document.querySelectorAll('button,a')).filter(n => /^Comments/.test(n.textContent.trim()))[0].click()`);
  await mx.waitFor(`document.querySelectorAll('.comment-row').length === 2`, 8000, 'both comments listed');

  const rowMarks = await mx.evaluate(`JSON.stringify(Array.from(document.querySelectorAll('.comment-row')).map(function (r) {
    return r.querySelector('.comment-target').textContent + ': ' + Array.from(r.querySelectorAll('.comment-mark')).map(function (m) { return m.textContent; }).join(',');
  }))`);
  t.ok(/"CommunityCommons\.LogMessage: [^"]*hidden Marketplace module/.test(rowMarks) && !/"CommunityCommons\.LogMessage: [^"]*not in this model/.test(rowMarks),
    'a comment on a hidden module’s object says it is hidden, not that it is gone: ' + rowMarks);
  t.ok(/"Sales\.Invoice: [^"]*not in this model/.test(rowMarks),
    'while a comment on something really removed is still marked as missing');
  const banners = await mx.evaluate(`Array.from(document.querySelectorAll('.orphan-banner, .hidden-banner')).map(b => b.textContent).join(' | ')`);
  t.ok(/One comment points at an object that is no longer in this model/.test(banners),
    'the orphan count is only the one that is really gone: ' + banners);
  t.ok(/One comment is on an object in a Marketplace module, which this project hides/.test(banners),
    'and the hidden one is announced on its own line: ' + banners);

  // Its target is still a way to the object, by showing what was hidden.
  await mx.evaluate(`Array.from(document.querySelectorAll('.comment-target')).find(b => b.textContent === 'CommunityCommons.LogMessage').click()`);
  const jumpMsg = await mx.waitFor(`document.querySelector('.msg') && document.querySelector('.msg').textContent`, 5000, 'jump message');
  t.ok(/Marketplace module/.test(jumpMsg) && !/renamed or removed/.test(jumpMsg),
    'following it explains the module is hidden rather than claiming a rename: ' + jumpMsg);
  t.ok(await mx.evaluate(`!!Array.from(document.querySelectorAll('.msg-action')).find(b => /Show Marketplace modules/.test(b.textContent))`),
    'and offers to show Marketplace modules on the spot');

  await mx.evaluate(`Array.from(document.querySelectorAll('.hidden-banner button')).find(b => /Show Marketplace modules/.test(b.textContent)).click()`);
  await mx.waitFor(`!document.querySelector('.hidden-banner')`, 5000, 'banner gone once shown');
  t.ok(await mx.evaluate(`!/hidden Marketplace module/.test(document.body.textContent)`),
    'the banner’s button shows them, and the comment is no longer marked hidden');

  // ---- a flow input of a hidden module's entity ----
  await goToSection(mx, 'Settings');
  await mx.waitFor(`/Marketplace modules/.test(document.body.textContent)`, 8000, 'settings a third time');
  await mx.evaluate(`(function(){ var card = document.querySelector('.set-market'); var cb = card.querySelector('input[type=checkbox]'); cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await new Promise((r) => setTimeout(r, 300));
  await mx.evaluate(`Array.from(document.querySelectorAll('button,a')).filter(n => /^Microflows/i.test(n.textContent.trim()))[0].click()`);
  await mx.waitFor(`(function(){ var c = document.querySelector('.mf-mod-card'); if (c) c.click(); return !!document.querySelector('.mf-row'); })()`, 8000, 'flow list');
  await mx.evaluate(`(function(){ var re = /CancelOrder/; function find(){ return Array.from(document.querySelectorAll('.mf-row')).find(function (n) { return re.test(n.textContent); }); } var r = find(); if (!r) { var s = document.querySelector('.mf-module-select'); for (var i = 0; s && i < s.options.length && !r; i++) { if (!s.options[i].value) continue; s.value = s.options[i].value; s.dispatchEvent(new Event('change')); s = document.querySelector('.mf-module-select'); r = find(); } } r.click(); Array.from(document.querySelectorAll('.mf-btn')).find(function (b) { return b.textContent === 'Run…'; }).click(); return true; })()`);
  const paramText = await mx.waitFor(`document.querySelector('.param-row') && document.querySelector('.param-row').textContent`, 8000, 'param row');
  t.ok(/hidden Marketplace module/.test(paramText) && !/not in this model/.test(paramText),
    'a flow input whose entity is in a hidden module says so, instead of "not in this model": ' + paramText);

  await mx.close();
};
