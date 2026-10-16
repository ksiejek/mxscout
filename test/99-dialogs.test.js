/* Every window over the screen is a modal dialog, used with the keyboard alone (public/dialog.js).
 *
 * The audit of 2026-10-15 (B13): an entity's window had no role and no name, focus stayed behind it, and
 * Tab from its last button left it. What is checked here, with keys pressed through the browser (no
 * click, no .focus() but the one that puts the reader somewhere to start from):
 *   - an entity's window, opened from the search with / and Shift+Enter: role="dialog", aria-modal,
 *     named by its title; focus inside it; Tab and Shift+Tab go round inside it and never leave it,
 *     with the app drawn again under them; Escape closes it;
 *   - the changelog, opened from the sidebar's version: focus inside, Escape closes, and focus is back
 *     on the version it was opened from — the sidebar drawn again in between;
 *   - Rename, opened from the project menu: when the menu's item went with the menu, focus goes back to
 *     the menu's button;
 *   - Delete this project?: named, focus on its first button, and Escape cancels it.
 */
'use strict';
const MODEL = require('./model');

const CODES = { Tab: 9, Enter: 13, Escape: 27 };

module.exports = async function (t) {
  // A project seeded straight into this browser's database and opened (as helpers.js does — written out
  // here because the helper goes on to the Live app, which this test does not need).
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore', 15000, 'MxScout loaded');
  await mx.evaluate(`MxStore.saveProjectWithModel({ id: 'p1', name: 'Demo', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    source: { kind: 'test' }, bytes: 100, summary: null }, ${JSON.stringify(MODEL)}).then(function () { return true; })`);
  await mx.navigate(t.MX);
  const SW = `(function(q){var s=document.querySelector('.switcher[aria-expanded="false"]'); if (s) s.click(); return document.querySelectorAll(q);})`;
  await mx.waitFor(`!!Array.from(${SW}('button,a')).find(n => n.textContent.trim() === 'Demo')`, 10000, 'project in sidebar');
  await mx.evaluate(`(function(){ var e = Array.from(${SW}('button,a')).filter(n => n.textContent.trim() === 'Demo'); e[e.length-1].click(); return true; })()`);
  await mx.waitFor(`!!document.querySelector('.xe-head .xe-icon-btn')`, 10000, 'project open');
  await mx.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  // Opening a project draws the app a few more times as what it reads arrives (Overview, the Assist items,
  // the solved cases); a key pressed before that is drawn over. Wait until the app has stopped changing.
  await mx.evaluate(`new Promise(function (done) {
    var t = null, quiet = function () { clearTimeout(t); t = setTimeout(function () { mo.disconnect(); done(true); }, 600); };
    var mo = new MutationObserver(quiet); mo.observe(document.getElementById('app'), { childList: true, subtree: true }); quiet();
  })`);
  async function key(name, shift) {
    const base = { key: name, code: name, windowsVirtualKeyCode: CODES[name], nativeVirtualKeyCode: CODES[name], modifiers: shift ? 8 : 0 };
    await mx.send('Input.dispatchKeyEvent', Object.assign({ type: 'rawKeyDown' }, base));
    if (name === 'Enter') await mx.send('Input.dispatchKeyEvent', Object.assign({ type: 'char', text: '\r', unmodifiedText: '\r' }, base));
    await mx.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
    // A key draws the app again, and dialog.js puts focus back after it: one frame for both.
    await mx.evaluate('new Promise(function (r) { requestAnimationFrame(function () { setTimeout(function () { r(true); }, 0); }); })');
  }
  // Where focus is: inside the window (and which control), or where else.
  const where = (sel) => mx.evaluate(`(function(){
    var w = document.querySelector(${JSON.stringify(sel)}), a = document.activeElement;
    if (!w) return 'no window';
    if (!w.contains(a)) return 'OUTSIDE: ' + (a ? a.tagName + ' ' + (a.className || '') + ' ' + (a.textContent || '').trim().slice(0, 30) : 'nothing');
    return a === w ? '(the window)' : a.tagName + ':' + ((a.getAttribute('aria-label') || a.textContent || a.value || '').trim().slice(0, 30));
  })()`);

  // ---- an entity's window, from the search, keys only ----
  // The key alone, without the character it types: the search opens on keydown, and a character that
  // followed would land in its box as the first thing searched for.
  await mx.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: '/', code: 'Slash', windowsVirtualKeyCode: 191 });
  await mx.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '/', code: 'Slash', windowsVirtualKeyCode: 191 });
  await mx.waitFor(`!!document.querySelector('.palette input') && document.activeElement === document.querySelector('.palette input')`, 5000, 'the search, open and focused');
  await mx.send('Input.insertText', { text: 'Order' });
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.palette-row')).find(function (r) { return r.querySelector('.palette-kind').textContent === 'Entity' && r.querySelector('.palette-label').textContent === 'Order'; })`, 5000, 'Order in the search');
  // The highlighted row is the first; move to the entity's row with the arrow keys.
  for (let i = 0; i < 20; i++) {
    const on = await mx.evaluate(`(function(){ var r = document.querySelector('.palette-row.on, .palette-row.active, .palette-row[aria-selected="true"]'); return r ? r.querySelector('.palette-kind').textContent + ':' + r.querySelector('.palette-label').textContent : ''; })()`);
    if (on === 'Entity:Order') break;
    await mx.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
    await mx.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  }
  await key('Enter', true);
  await mx.waitFor(`!!document.querySelector('.modal-detail')`, 8000, 'the entity window');
  const sem = JSON.parse(await mx.evaluate(`(function(){
    var w = document.querySelector('.modal-detail'), by = w.getAttribute('aria-labelledby'), t = by && document.getElementById(by);
    return JSON.stringify({ role: w.getAttribute('role'), modal: w.getAttribute('aria-modal'), name: t ? t.textContent : w.getAttribute('aria-label') });
  })()`));
  t.ok(sem.role === 'dialog' && sem.modal === 'true' && sem.name === 'Order', 'the entity’s window is a modal dialog named by its title: ' + JSON.stringify(sem));
  const first = await where('.modal-detail');
  t.ok(!/^OUTSIDE|^no window/.test(first), 'focus is inside it as it opens: ' + first);

  // Tab, round and round: never out of the window, and back to where it started.
  const n = await mx.evaluate(`document.querySelectorAll('.modal-detail button, .modal-detail select, .modal-detail a[href], .modal-detail input').length`);
  const seen = [first];
  let out = null;
  for (let i = 0; i < n + 3; i++) {
    await key('Tab');
    const w = await where('.modal-detail');
    if (/^OUTSIDE|^no window/.test(w)) { out = w; break; }
    seen.push(w);
  }
  t.ok(!out && seen.slice(1).indexOf(first) !== -1, 'Tab goes round inside it and comes back to the first control, never leaving it: ' + (out || seen.join(' → ')));
  let back = null;
  for (let i = 0; i < n + 3; i++) {
    await key('Tab', true);
    const w = await where('.modal-detail');
    if (/^OUTSIDE|^no window/.test(w)) { back = w; break; }
  }
  t.ok(!back, 'and so does Shift+Tab' + (back ? ': ' + back : ''));
  await key('Escape');
  await mx.waitFor(`!document.querySelector('.modal-detail')`, 5000, 'Escape closes the window');
  t.ok(true, 'Escape closes it');

  // ---- the changelog, from the sidebar: focus goes back to what opened it ----
  await mx.evaluate(`document.querySelector('.sidebar-version').focus(); document.activeElement === document.querySelector('.sidebar-version')`);
  const opener = await mx.evaluate(`document.activeElement.textContent.trim()`);
  await key('Enter');
  await mx.waitFor(`!!document.querySelector('.modal-changelog')`, 8000, 'the changelog');
  const inLog = await where('.modal-changelog');
  t.ok(!/^OUTSIDE|^no window/.test(inLog) && await mx.evaluate(`document.querySelector('.modal-changelog').getAttribute('role') === 'dialog'`), 'Enter on the version opens the changelog as a dialog, focus inside: ' + inLog);
  await key('Escape');
  await mx.waitFor(`!document.querySelector('.modal-changelog')`, 5000, 'the changelog closed');
  const after = await mx.evaluate(`(function(){ var a = document.activeElement; return a && a.classList.contains('sidebar-version') ? 'the version: ' + a.textContent.trim() : (a ? a.tagName + ' ' + a.className : 'nothing'); })()`);
  t.ok(after === 'the version: ' + opener, 'Escape closes it, and focus is back on the version it was opened from — drawn again, found again: ' + after);

  // ---- Rename, from the project menu: the menu's item is gone, so its button ----
  await mx.evaluate(`document.querySelector('.xe-head .xe-icon-btn').click()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.xe-menu button')).find(function (b) { return b.textContent === 'Rename…'; })`, 5000, 'the project menu');
  await mx.evaluate(`document.querySelector('.xe-head .xe-icon-btn').focus(); Array.from(document.querySelectorAll('.xe-menu button')).find(function (b) { return b.textContent === 'Rename…'; }).focus(); true`);
  await key('Enter');
  await mx.waitFor(`!!document.querySelector('.modal input[aria-label="Project name"]') && document.activeElement === document.querySelector('.modal input[aria-label="Project name"]')`, 5000, 'Rename, its name box focused');
  const rn = JSON.parse(await mx.evaluate(`(function(){ var w = document.querySelector('.modal'), t = document.getElementById(w.getAttribute('aria-labelledby')); return JSON.stringify([w.getAttribute('role'), w.getAttribute('aria-modal'), t && t.textContent]); })()`));
  t.ok(JSON.stringify(rn) === JSON.stringify(['dialog', 'true', 'Rename project']), 'Rename is a modal dialog named by its title: ' + JSON.stringify(rn));
  await key('Escape');
  await mx.waitFor(`!document.querySelector('.modal')`, 5000, 'Rename closed');
  const menuBtn = await mx.evaluate(`(function(){ var a = document.activeElement; return a && a.classList.contains('xe-icon-btn') ? 'the project menu’s button' : (a ? a.tagName + ' ' + a.className + ' ' + a.textContent.trim().slice(0, 20) : 'nothing'); })()`);
  t.ok(menuBtn === 'the project menu’s button', 'Escape closes it, and focus goes to the menu’s button — its item went with the menu: ' + menuBtn);

  // ---- Delete this project?: Escape is Cancel ----
  await mx.evaluate(`document.querySelector('.xe-head .xe-icon-btn').click()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.xe-menu button')).find(function (b) { return b.textContent === 'Delete project'; })`, 5000, 'the project menu');
  await mx.evaluate(`Array.from(document.querySelectorAll('.xe-menu button')).find(function (b) { return b.textContent === 'Delete project'; }).click()`);
  await mx.waitFor(`!!document.querySelector('.modal') && document.querySelector('.modal').getAttribute('role') === 'dialog'`, 5000, 'Delete this project?');
  const del = JSON.parse(await mx.evaluate(`(function(){ var w = document.querySelector('.modal'), t = document.getElementById(w.getAttribute('aria-labelledby')); return JSON.stringify([w.getAttribute('aria-modal'), t && t.textContent, w.contains(document.activeElement) && document.activeElement.textContent]); })()`));
  t.ok(del[0] === 'true' && del[1] === 'Delete this project?' && del[2] === 'Cancel', 'Delete this project? is one too — named, focus on its first button, Cancel: ' + JSON.stringify(del));
  await key('Escape');
  await mx.waitFor(`!document.querySelector('.modal')`, 5000, 'closed');
  t.ok(await mx.evaluate(`MxStore.getAll('projects').then(function (l) { return l.length === 1; })`), 'and Escape there cancels — the project is still here');
  await mx.close();
};
