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
 * it back, surviving a reload. Also covers the quick "N from Marketplace"
 * chip in the module row itself (renderMarketplaceChip in app.js): the same
 * flag as the Settings checkbox, but reachable right where you notice
 * something is missing instead of only from a separate screen — and once
 * they're shown, the same chip flips to "Hide N from Marketplace" so hiding
 * them again doesn't require a trip to Settings either. */
'use strict';

const MODEL = {
  modules: [{ name: 'Sales' }, { name: 'CommunityCommons', fromAppStore: true }],
  userRoles: [],
  entities: [
    { qualifiedName: 'Sales.Order', name: 'Order', module: 'Sales', attributes: [], accessRules: [] },
    { qualifiedName: 'CommunityCommons.LogMessage', name: 'LogMessage', module: 'CommunityCommons', attributes: [], accessRules: [] }
  ],
  associations: [],
  microflows: [
    { qualifiedName: 'Sales.CancelOrder', name: 'CancelOrder', module: 'Sales', allowedModuleRoles: [], parameters: [] },
    { qualifiedName: 'CommunityCommons.StringUtils', name: 'StringUtils', module: 'CommunityCommons', allowedModuleRoles: [], parameters: [] }
  ],
  nanoflows: [], pages: []
};

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore', 15000, 'MxScout loaded');
  await mx.evaluate(`(async () => {
    await MxStore.saveProjectWithModel(
      { id: 'p1', name: 'Demo', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        source: { kind: 'test' }, bytes: 100, summary: null, appUrl: null },
      ${JSON.stringify(MODEL)});
    return true;
  })()`);
  await mx.navigate(t.MX);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('button,a')).find(n => n.textContent.trim() === 'Demo')`, 10000, 'project in sidebar');
  await mx.evaluate(`(function(){ var e = Array.from(document.querySelectorAll('button,a')).filter(n => n.textContent.trim() === 'Demo'); e[e.length-1].click(); return true; })()`);
  await mx.waitFor(`!!document.querySelector('.chip, .flow-card, .entity-card')`, 8000, 'project open');

  // ---- entities view: hidden by default ----
  await mx.evaluate(`Array.from(document.querySelectorAll('button,a')).filter(n => /^Entities/i.test(n.textContent.trim()))[0].click()`);
  await mx.waitFor(`document.body.textContent.indexOf('Order') !== -1`, 8000, 'entities shown');
  let bodyText = await mx.evaluate(`document.body.textContent`);
  t.ok(/Order/.test(bodyText), 'the project’s own entity is shown');
  t.ok(!/CommunityCommons/.test(bodyText), 'the marketplace module and its entity are entirely absent, not just dimmed');

  // ---- the quick chip: reveal them without a trip to Settings ----
  t.ok(await mx.evaluate(`!!Array.from(document.querySelectorAll('.chip')).find(c => /from Marketplace/.test(c.textContent))`),
    'a chip in the module row itself says how many are hidden');
  await mx.evaluate(`Array.from(document.querySelectorAll('.chip')).find(c => /from Marketplace/.test(c.textContent)).click()`);
  await mx.waitFor(`/CommunityCommons/.test(document.body.textContent)`, 8000, 'chip revealed it');
  t.ok(/LogMessage/.test(await mx.evaluate(`document.body.textContent`)), 'clicking the chip reveals the marketplace entity right there, no Settings visit needed');
  const hideChip = await mx.evaluate(`(function(){ var c = Array.from(document.querySelectorAll('.chip')).find(c => /from Marketplace/.test(c.textContent)); return c && c.textContent; })()`);
  t.ok(/^Hide \d+ from Marketplace/.test(hideChip || ''),
    'the chip flips to "Hide" rather than disappearing, so it can be hidden again from right here too: ' + hideChip);
  await mx.evaluate(`Array.from(document.querySelectorAll('.chip')).find(c => /from Marketplace/.test(c.textContent)).click()`);
  t.ok(await mx.waitFor(`!/CommunityCommons/.test(document.body.textContent)`, 8000, 'chip hid it again'),
    'clicking it again hides the marketplace module right there too, no Settings visit needed');
  t.ok(await mx.evaluate(`!!Array.from(document.querySelectorAll('.chip')).find(c => /^\\d+ from Marketplace$/.test(c.textContent.trim()))`),
    'and it is back to the "reveal" wording now that they are hidden again');

  // Revert via Settings so the "off by default" checks below still hold —
  // this only proves the chip and the checkbox are the same underlying flag.
  await mx.evaluate(`Array.from(document.querySelectorAll('button,a')).filter(n => n.textContent.trim() === 'Settings')[0].click()`);
  await mx.waitFor(`/Marketplace modules/.test(document.body.textContent)`, 8000, 'settings shows the card');
  await mx.evaluate(`(function(){ var card = Array.from(document.querySelectorAll('.card')).find(c => /Marketplace modules/.test(c.textContent)); var cb = card.querySelector('input[type=checkbox]'); cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await new Promise((r) => setTimeout(r, 300));

  // ---- microflows view: same story ----
  await mx.evaluate(`Array.from(document.querySelectorAll('button,a')).filter(n => /^Microflows/i.test(n.textContent.trim()))[0].click()`);
  await mx.waitFor(`document.body.textContent.indexOf('CancelOrder') !== -1`, 8000, 'microflows shown');
  bodyText = await mx.evaluate(`document.body.textContent`);
  t.ok(/CancelOrder/.test(bodyText), 'the project’s own microflow is shown');
  t.ok(!/StringUtils/.test(bodyText) && !/CommunityCommons/.test(bodyText),
    'the marketplace module’s microflow is entirely absent too');

  // ---- Settings: the toggle, off by default ----
  await mx.evaluate(`Array.from(document.querySelectorAll('button,a')).filter(n => n.textContent.trim() === 'Settings')[0].click()`);
  await mx.waitFor(`/Marketplace modules/.test(document.body.textContent)`, 8000, 'settings shows the card');
  const settingsText = await mx.evaluate(`document.body.textContent`);
  t.ok(/CommunityCommons/.test(settingsText), 'Settings names the hidden module, so it is discoverable: ' + settingsText.slice(0, 50));
  t.ok(await mx.evaluate(`(function(){ var rows = Array.from(document.querySelectorAll('.card')); var card = rows.find(c => /Marketplace modules/.test(c.textContent)); var cb = card && card.querySelector('input[type=checkbox]'); return !!cb && !cb.checked; })()`),
    'the checkbox starts unchecked — hidden is the default');

  // ---- turning it on reveals everything, live, no reload needed ----
  await mx.evaluate(`(function(){ var card = Array.from(document.querySelectorAll('.card')).find(c => /Marketplace modules/.test(c.textContent)); var cb = card.querySelector('input[type=checkbox]'); cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await new Promise((r) => setTimeout(r, 300));

  await mx.evaluate(`Array.from(document.querySelectorAll('button,a')).filter(n => /^Entities/i.test(n.textContent.trim()))[0].click()`);
  await mx.waitFor(`/CommunityCommons/.test(document.body.textContent)`, 8000, 'now shown');
  t.ok(/LogMessage/.test(await mx.evaluate(`document.body.textContent`)), 'the marketplace entity now shows, without reopening the project');

  // ---- the setting is persisted: a reload keeps it on ----
  await mx.navigate(t.MX);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('button,a')).find(n => n.textContent.trim() === 'Demo')`, 10000, 'reloaded');
  await mx.evaluate(`(function(){ var e = Array.from(document.querySelectorAll('button,a')).filter(n => n.textContent.trim() === 'Demo'); e[e.length-1].click(); return true; })()`);
  await mx.evaluate(`Array.from(document.querySelectorAll('button,a')).filter(n => /^Entities/i.test(n.textContent.trim()))[0].click()`);
  t.ok(await mx.waitFor(`/CommunityCommons/.test(document.body.textContent)`, 8000, 'still shown after reload'),
    'the choice survives a reload — it is a project setting, not view-session state');

  await mx.close();
};
