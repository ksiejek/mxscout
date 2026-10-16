/* The language of written content, chosen on Documentation → Folder, stays chosen (Karol, 2026-10-15: "it
 * often resets").
 *
 * What it was: inside the Mendix project the folder is read every two seconds (store.js refreshFolder). When
 * a shared file had moved — an agent writing descriptions/, a pull — the person's new language was held, not
 * written, while mxscout.json was read first; mxscout.json still held the OLD language, and the app took it as
 * "the folder wins", in memory, in the database and back into the file. And the Folder card was drawn again on
 * every tick, closing an open list before the choice landed.
 *
 * What has to hold, for a project kept in a folder of its own (project.json) and one inside the Mendix project
 * (mxscout.json): every choice the person makes is kept and written, also when an agent writes descriptions in
 * the same moment; a teammate's change to the file that arrives later is still taken; and the card is not drawn
 * again while the list has the focus. */
'use strict';
const fs = require('fs');
const path = require('path');
const { goToDocsTab, goToSection } = require('./helpers');

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore && !!window.MxRepoUI', 15000, 'MxScout loaded');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const mprB64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  // Small OPFS helpers, put on the page again after each navigation.
  const HELP = `(function () {
    window.__dirOf = async function (p, create) { var d = await navigator.storage.getDirectory(); var parts = p.split('/').filter(Boolean); for (var j = 0; j < parts.length; j++) d = await d.getDirectoryHandle(parts[j], { create: !!create }); return d; };
    window.__read = async function (p) { try { var parts = p.split('/'), name = parts.pop(); var d = await window.__dirOf(parts.join('/')); return await (await (await d.getFileHandle(name)).getFile()).text(); } catch (e) { return null; } };
    window.__write = async function (p, data) { var parts = p.split('/'), name = parts.pop(); var d = await window.__dirOf(parts.join('/'), true); var w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close(); return true; };
    return true; })()`;
  await mx.evaluate(HELP);
  await mx.evaluate(`(async function () {
    var root = await navigator.storage.getDirectory();
    var names = [];
    for (var it = root.keys(), r = await it.next(); !r.done; r = await it.next()) names.push(r.value);
    for (var i = 0; i < names.length; i++) await root.removeEntry(names[i], { recursive: true });
    var b64 = ${JSON.stringify(mprB64)}, bin = atob(b64), u8 = new Uint8Array(bin.length);
    for (var k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k);
    await window.__write('LangRepo/LangRepo.mpr', u8);
    await window.__write('LangRepo/.git/HEAD', 'ref: refs/heads/main\\n');
    await window.__write('LangRepo/.git/refs/heads/main', '${'a'.repeat(40)}\\n');
    var read = await MxMprImport.readModel(await window.__dirOf('LangRepo'));
    var now = new Date().toISOString();
    await MxStore.saveProjectWithModel({ id: 'lang1', name: 'LangOwnFolder', createdAt: now, updatedAt: now, source: { kind: 'mpr' }, bytes: 1, summary: null }, read.model);
    await MxStore.saveProjectWithModel({ id: 'lang2', name: 'LangInRepo', createdAt: now, updatedAt: now, source: { kind: 'mpr-folder', fileName: 'LangRepo.mpr' }, bytes: 1, summary: null }, read.model);
    await MxStore.linkFolder('lang1', await window.__dirOf('LangOwn', true));
    await MxStore.linkFolder('lang2', await window.__dirOf('LangRepo/mxscout', true), { repo: await window.__dirOf('LangRepo'), mpr: read.mpr });
    return true;
  })()`);

  const SW = "(function(q){var s=document.querySelector('.switcher[aria-expanded=\"false\"]'); if (s) s.click(); return document.querySelectorAll(q);})";
  async function open(name) {
    await mx.navigate(t.MX);
    await mx.waitFor(`!!Array.from(${SW}('button,a')).find(n => n.textContent.trim() === ${JSON.stringify(name)})`, 10000, name + ' in the list');
    await mx.evaluate(`(function(){ var e = Array.from(${SW}('button,a')).filter(n => n.textContent.trim() === ${JSON.stringify(name)}); e[e.length-1].click(); return true; })()`);
    await mx.waitFor(`!!document.querySelector('.tree-section')`, 10000, name + ' open');
    await mx.evaluate(HELP);
  }
  const choose = (lang) => mx.evaluate(`(function(){ var s = document.querySelector('.lang-select'); s.value = ${JSON.stringify(lang)}; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  // The language as the database holds it, and as the project's file does.
  const where = (id, file) => mx.evaluate(`(async function(){ var f = await window.__read(${JSON.stringify(file)}); return [(await MxStore.get('projects', ${JSON.stringify(id)})).contentLanguage, f ? JSON.parse(f).contentLanguage : null].join('/'); })()`);
  async function settled(id, file, lang, ms) {
    const until = Date.now() + (ms || 6000);
    let last = '';
    while (Date.now() < until) { last = await where(id, file); if (last === lang + '/' + lang) return last; await sleep(250); }
    return last;
  }
  // Whether it stays so through a few ticks of the folder (two seconds each).
  async function stays(id, file, lang) {
    const seen = [];
    for (let k = 0; k < 6; k++) { await sleep(700); seen.push(await where(id, file)); }
    return seen.every((x) => x === lang + '/' + lang) ? 'kept' : seen.join(' ');
  }
  // An agent writing descriptions straight into mxscout/descriptions/ — the moment the old code lost the choice.
  const agentWrites = (n) => mx.evaluate(`(async function(){
    var v = MxDescribe.parse(JSON.stringify({ format: MxDescribe.FORMAT, version: 1, project: 'Sales', language: 'en', by: 'agent', written: '2026-10-15', microflows: { 'Sales.CreateOrder': { text: 'Written by the agent, round ${n}.' } } })).value;
    var parts = MxRepoDocs.split(MxDescribe.toFile(v));
    for (var i = 0; i < parts.length; i++) await window.__write('LangRepo/mxscout/' + parts[i].path, parts[i].text);
    return true; })()`);

  for (const [id, name, file, repo] of [['lang1', 'LangOwnFolder', 'LangOwn/project.json', false], ['lang2', 'LangInRepo', 'LangRepo/mxscout/mxscout.json', true]]) {
    const kind = repo ? 'inside the Mendix project' : 'in a folder of its own';
    await open(name);
    await goToSection(mx, 'Settings', '.lang-select'); // in Settings since 2026-10-16 (settings.js)
    await sleep(2500);

    // ---- a choice, kept and written ----
    await choose('pl');
    t.ok(await settled(id, file, 'pl') === 'pl/pl' && await stays(id, file, 'pl') === 'kept', kind + ': the language chosen is kept and written, through the folder’s ticks');
    await choose('de');
    await choose('fr');
    t.ok(await settled(id, file, 'fr') === 'fr/fr' && await stays(id, file, 'fr') === 'kept', kind + ': two choices in a row — the last one stays');

    if (repo) {
      // ---- the race: an agent writes descriptions in the same moment ----
      const lost = [];
      for (const lang of ['de', 'it', 'nl']) {
        await agentWrites(lang);
        await choose(lang);
        const got = await settled(id, file, lang);
        const kept = got === lang + '/' + lang ? await stays(id, file, lang) : got;
        if (kept !== 'kept') lost.push(lang + ': ' + kept);
      }
      t.ok(!lost.length, kind + ': a choice made while an agent writes descriptions/ is kept and written — not undone by the older mxscout.json read meanwhile' + (lost.length ? ': ' + lost.join('; ') : ''));
      t.ok(await mx.evaluate(`MxStore.get('descriptions', 'lang2').then(function (r) { return !!r && /round nl/.test(JSON.stringify(r.value)); })`), 'and what the agent wrote is taken in too');

      // ---- a teammate's change arriving later is still taken ----
      await sleep(1200);
      const mj = JSON.parse(await mx.evaluate(`window.__read(${JSON.stringify(file)})`));
      mj.contentLanguage = 'es';
      await mx.evaluate(`window.__write(${JSON.stringify(file)}, ${JSON.stringify(JSON.stringify(mj, null, 2) + '\n')})`);
      t.ok(await settled(id, file, 'es', 8000) === 'es/es', kind + ': a teammate’s language in mxscout.json, pulled later, is taken — the file changed it');
      t.ok(await mx.waitFor(`document.querySelector('.lang-select') && document.querySelector('.lang-select').value === 'es'`, 6000, 'the list shows it'), 'and the list shows it');

      // ---- not drawn again from under the person's hands ----
      await mx.evaluate(`(function(){ window.__sel = document.querySelector('.lang-select'); window.__sel.focus(); return document.activeElement === window.__sel; })()`);
      await sleep(5000);
      t.ok(await mx.evaluate(`document.querySelector('.lang-select') === window.__sel`), kind + ': while the list has the focus Settings is not drawn again, though the folder ticks every two seconds');
      await mx.evaluate(`window.__sel.blur(), true`);
      await choose('pl');
      t.ok(await settled(id, file, 'pl') === 'pl/pl', 'and a choice after it lands as ever');
    } else {
      // ---- a teammate's (or a person's) change to project.json is taken when the folder is read again ----
      await sleep(1200);
      const pj = JSON.parse(await mx.evaluate(`window.__read(${JSON.stringify(file)})`));
      pj.contentLanguage = 'es';
      await mx.evaluate(`window.__write(${JSON.stringify(file)}, ${JSON.stringify(JSON.stringify(pj, null, 2) + '\n')})`);
      await mx.evaluate(`MxStore.syncFolder('lang1', false).then(function () { return true; })`);
      t.ok(await settled(id, file, 'es', 8000) === 'es/es', kind + ': a language changed in project.json since is taken when the folder is read');
    }
  }
};
