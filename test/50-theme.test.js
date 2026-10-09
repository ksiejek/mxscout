/* Light, dark, or the system's.
 *
 * MxScout has a light palette now, the same one the exported documentation's
 * light theme uses. Dark stays the default, the choice is made at the foot of
 * the sidebar, and it is kept with the other settings in the browser's own
 * database, so it survives a reload. */
'use strict';
const { openSeededProject } = require('./helpers');

module.exports = async function (t) {
  const mx = await openSeededProject(t, t.APP);
  const bg = `getComputedStyle(document.body).backgroundColor`;

  t.ok(await mx.evaluate(`document.documentElement.getAttribute('data-theme') === 'dark' && document.documentElement.getAttribute('data-mode') === 'dark'`),
    'dark is the default — what MxScout has always looked like');
  const dark = await mx.evaluate(bg);
  t.ok(dark === 'rgb(18, 18, 18)', 'and the page is MxScout’s near-black: ' + dark);

  const labels = await mx.evaluate(`Array.from(document.querySelectorAll('.theme-switch button')).map(function (b) { return b.textContent; }).join('|')`);
  t.ok(labels === '☀ Light|☾ Dark|Auto', 'the sidebar offers light, dark and the system’s: ' + labels);

  await mx.evaluate(`Array.from(document.querySelectorAll('.theme-switch button')).find(function (b) { return /Light/.test(b.textContent); }).click()`);
  await mx.waitFor(`document.documentElement.getAttribute('data-mode') === 'light'`, 3000, 'light');
  const light = await mx.evaluate(bg);
  t.ok(light === 'rgb(246, 245, 242)', 'light is the documentation’s warm paper, not plain white: ' + light);
  t.ok(await mx.evaluate(`getComputedStyle(document.documentElement).colorScheme === 'light'`),
    'and the browser is told, so its own controls follow');

  // Kept with the other settings, so it survives a reload.
  t.ok(await mx.waitFor(`MxStore.get('settings', 'theme').then(function (r) { return !!r && r.value === 'light'; })`, 3000, 'saved'),
    'the choice is kept in the browser’s own database, with the other settings');
  await mx.navigate(t.MX);
  t.ok(await mx.waitFor(`document.documentElement.getAttribute('data-mode') === 'light'`, 8000, 'after reload'),
    'and is still light after a reload');

  await mx.evaluate(`Array.from(document.querySelectorAll('.theme-switch button')).find(function (b) { return /Dark/.test(b.textContent); }).click()`);
  t.ok(await mx.waitFor(`document.documentElement.getAttribute('data-mode') === 'dark'`, 3000, 'dark again'), 'and back to dark');
  await mx.close();
};
