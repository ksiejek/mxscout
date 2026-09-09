/* The bridge protocol, without a browser: token gating, long-poll delivery,
 * the data round-trip, and the superseded-session case that once made MxScout
 * claim it was connected to a bridge whose every request was being refused. */
'use strict';

module.exports = async function (t) {
  const B = t.MX;
  const json = async (url, opts) => (await fetch(url, opts)).json();

  const s1 = await json(B + '/api/session/start', { method: 'POST' });
  t.ok(typeof s1.token === 'string' && s1.token.length >= 32, 'starting a session mints a token');

  t.ok((await fetch(B + '/api/session/ping?token=nope')).status === 403, 'ping refuses a wrong token');
  t.ok((await fetch(B + '/api/session/ping?token=' + s1.token)).status === 200, 'ping accepts the current token');

  // A parked poll must be woken by arming, not by a timer.
  const started = Date.now();
  const parked = json(B + '/api/session/exec/poll?wait=1&token=' + s1.token);
  await new Promise((r) => setTimeout(r, 200));
  t.ok((await json(B + '/api/session/exec')).listenerConnected === true, 'a parked poll reads as connected');

  const armed = await json(B + '/api/session/exec', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'query', qualifiedName: 'Sales.Order', search: 'ala', offset: 20, amount: 10 })
  });
  const delivered = await parked;
  const took = Date.now() - started;
  t.ok(delivered.command && delivered.command.id === armed.commandId, 'arming a query wakes the parked poll');
  t.ok(took < 3000, 'it is delivered on arming, not on a timer (' + took + 'ms)');
  t.ok(delivered.command.search === 'ala' && delivered.command.offset === 20, 'the search term and page window travel with it');

  // Dispatched exactly once.
  const second = await json(B + '/api/session/exec/poll?token=' + s1.token);
  t.ok(second.command === null, 'a second poll does not re-deliver the same command');

  await fetch(B + '/api/session/data', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: s1.token, commandId: armed.commandId, ok: true,
      data: { rows: [
        // Row one carries what the app said about writing each value: the
        // server rebuilds every row from a whitelist, so this has to be part
        // of it or the Data tab can never mark anything green.
        { id: '17', cells: { Name: 'x'.repeat(900), Total: '5' }, writable: { Name: true, Total: false, Sneaky: true, Name2: 'yes' } },
        { id: '18', cells: { Name: 'b', Total: '6' } }
      ], total: 253, offset: 20, amount: 10, more: true }
    })
  });
  const back = await json(B + '/api/session/data');
  t.ok(back.id === armed.commandId && back.data.total === 253, 'the page of rows comes back to the UI');
  t.ok(back.data.rows[0].cells.Name.length === 500, 'oversized values are bounded server-side');
  const w = back.data.rows[0].writable;
  t.ok(w && w.Name === true && w.Total === false, 'write access survives the server, per row and per column: ' + JSON.stringify(w));
  t.ok(!('Sneaky' in w), 'a key for a column that did not come back is dropped');
  t.ok(!('Name2' in w), 'and anything that is not a plain true/false is dropped, not coerced');
  t.ok(back.data.rows[1].writable === null, 'a row the runtime said nothing about comes back as null, so nothing is marked');

  // Query results and run results live in separate slots.
  const run = await json(B + '/api/session/exec', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'microflow', qualifiedName: 'Sales.CancelOrder', objectParams: [{ name: 'Order', guids: ['17'] }] })
  });
  t.ok(typeof run.commandId === 'string', 'a flow can be armed on the same channel');
  t.ok((await json(B + '/api/session/data')).data.total === 253, 'arming a run does not wipe the data the user was reading');

  const bad = await fetch(B + '/api/session/exec', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'microflow', qualifiedName: 'Sales.CancelOrder', objectParams: [{ name: 'Order', guids: ['not-a-number'] }] })
  });
  t.ok(bad.status === 400, 'an object id that is not a plain number is refused');

  // Opening a page was removed: mx.ui.openForm cannot be driven from outside
  // the client dependably, so the kind is gone from the UI AND from the gate.
  const page = await fetch(B + '/api/session/exec', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'page', qualifiedName: 'Sales.Order_Overview' })
  });
  t.ok(page.status === 400, 'arming a page is refused — MxScout does not open pages');

  // A bridge that is BUSY answering has no request parked and has not polled
  // for a while. It must still count as connected: deciding otherwise put the
  // "paste this code" instructions over the top of a table the user was
  // reading, on a bridge that was working perfectly.
  await new Promise((r) => setTimeout(r, 6000));
  t.ok((await json(B + '/api/session/exec')).listenerConnected === true,
    'a bridge that is busy answering still counts as connected six seconds later');

  // Superseding the session must release the old bridge, not inherit it.
  const stillParked = json(B + '/api/session/exec/poll?wait=1&token=' + s1.token);
  await new Promise((r) => setTimeout(r, 150));
  const s2 = await json(B + '/api/session/start', { method: 'POST' });
  await stillParked;
  await new Promise((r) => setTimeout(r, 100));
  t.ok(s2.token !== s1.token, 'a new session mints a different token');
  t.ok((await json(B + '/api/session/exec')).listenerConnected === false,
    'a new session does not inherit the previous bridge as connected');
  t.ok((await fetch(B + '/api/session/exec/poll?wait=1&token=' + s1.token)).status === 403,
    'the superseded token is refused, so the old bridge stops instead of looping');
};
