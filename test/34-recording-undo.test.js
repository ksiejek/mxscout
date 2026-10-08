/* Deleting a performance recording, and taking it back (ROADMAP step 61).
 *
 * The behaviour under test is the one that keeps a promise: MxScout offers an
 * undo, and it does that WITHOUT holding the row back from the database. The
 * row really is deleted; the undo writes back the copy the card was already
 * rendering from, which lives in the page's memory. So every sentence about
 * deleting — on the About page and in README.md — stays as true as it was.
 * That is why the assertions below read IndexedDB directly at each step
 * instead of trusting what the list shows.
 *
 * It also stands guard over what was removed: the browser's own confirm().
 * A confirm() here would block the page, so these steps would time out rather
 * than pass quietly. */
'use strict';
const MODEL = require('./model');

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore', 15000, 'MxScout loaded');

  // Straight into IndexedDB, as the bridge tests do: this file is about what
  // Delete and Undo do, and driving a real recording would need a real
  // runtime to record.
  await mx.evaluate(`(async () => {
    await MxStore.saveProjectWithModel(
      { id: 'undo-p', name: 'UndoProj', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        source: { kind: 'test' }, bytes: 100, summary: null, appUrl: null },
      ${JSON.stringify(MODEL)});
    const db = await new Promise((res, rej) => { const q = indexedDB.open('mxscout'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    const rec = { id: 'undo-r', projectId: 'undo-p', tool: 'mxscout-perf-recording', version: 1, intervalMs: 50,
      adminUrl: 'http://127.0.0.1:1', started: new Date(Date.now() - 60000).toISOString(),
      stopped: new Date().toISOString(), samples: [{ at: 0, requests: {} }, { at: 50, requests: {} }] };
    await new Promise((res, rej) => { const tx = db.transaction(['recordings'], 'readwrite'); tx.objectStore('recordings').put(rec); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    return true;
  })()`);
  await mx.navigate(t.MX);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('button,a')).find(n => n.textContent.trim() === 'UndoProj')`, 10000, 'project in sidebar');
  await mx.evaluate(`(function(){ var e = Array.from(document.querySelectorAll('button,a')).filter(n => n.textContent.trim() === 'UndoProj'); e[e.length - 1].click(); return true; })()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('button,a')).find(n => n.textContent.trim() === 'Performance')`, 8000, 'project open');
  await mx.evaluate(`Array.from(document.querySelectorAll('button,a')).filter(n => n.textContent.trim() === 'Performance')[0].click()`);
  await mx.waitFor(`!!document.querySelector('.rec-actions')`, 10000, 'the recording card is on screen');

  const inDb = `(async () => {
    const db = await new Promise((res) => { const q = indexedDB.open('mxscout'); q.onsuccess = () => res(q.result); });
    return await new Promise((res) => { const g = db.transaction(['recordings'], 'readonly').objectStore('recordings').get('undo-r'); g.onsuccess = () => res(!!g.result); g.onerror = () => res(false); });
  })()`;

  t.ok(await mx.evaluate(inDb) === true, 'the seeded recording is in the database before anything is clicked');

  // Distance, not only colour: the irreversible action is pushed off the row
  // of reversible ones. Phase 3 audit, finding 14.
  const gaps = await mx.evaluate(`(function(){
    var row = document.querySelector('.rec-actions');
    var b = Array.from(row.querySelectorAll('button'));
    var out = [];
    for (var i = 1; i < b.length; i++) out.push(Math.round(b[i].getBoundingClientRect().left - b[i-1].getBoundingClientRect().right));
    return out.join(',');
  })()`);
  const gapList = String(gaps).split(',').map(Number);
  t.ok(gapList.length >= 2 && gapList[gapList.length - 1] > gapList[0] * 2,
    'Delete sits further from its neighbour than the reversible buttons sit from each other: ' + gaps);

  await mx.evaluate(`(function(){ Array.from(document.querySelectorAll('.rec-actions button')).filter(b => b.textContent.trim() === 'Delete')[0].click(); return true; })()`);
  await mx.waitFor(`!!document.querySelector('.msg .msg-action')`, 8000, 'the message offering undo');

  t.ok(await mx.evaluate(inDb) === false,
    'Delete really deletes: the row is gone from IndexedDB, not merely hidden, so nothing MxScout says about deleting becomes less true');
  const offer = await mx.evaluate(`document.querySelector('.msg').textContent`);
  t.ok(/Recording deleted/.test(offer) && /Undo/.test(offer),
    'deleting says so and offers to take it back, instead of succeeding in silence: ' + offer);
  t.ok(await mx.evaluate(`!document.querySelector('.rec-actions')`) === true,
    'and the card is gone from the list');

  await mx.evaluate(`(function(){ document.querySelector('.msg .msg-action').click(); return true; })()`);
  await mx.waitFor(`!!document.querySelector('.rec-actions')`, 8000, 'the card is back');

  t.ok(await mx.evaluate(inDb) === true,
    'Undo writes the recording back into the database, from the copy the page still held');
  const restored = await mx.evaluate(`(document.querySelector('.msg') || {}).textContent || ''`);
  t.ok(/restored/i.test(restored), 'and it says so: ' + restored);
};
