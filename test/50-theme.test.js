/* Light, dark, or the system's — in the redesign's tokens.
 *
 * Every colour comes from public/tokens.css, keyed on data-theme, which holds
 * the theme in effect (never "auto": the system's choice is resolved first),
 * with the cobalt accent in data-accent. Light is the default (Karol, 2026-10-13), the choice is
 * made at the foot of the sidebar, and it is kept with the other settings in
 * the browser's own database, so it survives a reload. The two fonts ship
 * with MxScout and load from its own server. */
'use strict';
const fs = require('fs');
const path = require('path');
const { openSeededProject, readText } = require('./helpers');

module.exports = async function (t) {
  const mx = await openSeededProject(t, t.APP);
  const bg = `getComputedStyle(document.body).backgroundColor`;
  const attrs = `['data-theme','data-mode','data-accent'].map(function (a) { return document.documentElement.getAttribute(a); }).join('|')`;

  t.ok(await mx.evaluate(attrs) === 'light|light|cobalt',
    'light is the default, with the cobalt accent: ' + await mx.evaluate(attrs));
  const first = await mx.evaluate(bg);
  t.ok(first === 'rgb(236, 237, 240)', 'and the page is the tokens’ light chrome: ' + first);
  t.ok(await mx.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--acc').trim().toLowerCase() === '#2a57f0'`),
    'the accent is cobalt, read from tokens.css');

  const labels = await mx.evaluate(`Array.from(document.querySelectorAll('.theme-switch button')).map(function (b) { return b.getAttribute('aria-label') + (b.getAttribute('aria-pressed') === 'true' ? '*' : ''); }).join('|')`);
  t.ok(labels === 'Light theme*|Dark theme|Follow the system', 'the sidebar offers light, dark and the system’s, as icons with their names, light pressed: ' + labels);

  await mx.evaluate(`Array.from(document.querySelectorAll('.theme-switch button')).find(function (b) { return b.getAttribute('aria-label') === 'Dark theme'; }).click()`);
  await mx.waitFor(`document.documentElement.getAttribute('data-mode') === 'dark'`, 3000, 'dark');
  t.ok(await mx.evaluate(`document.documentElement.getAttribute('data-theme')`) === 'dark', 'data-theme follows, so the tokens switch');
  const dark = await mx.evaluate(bg);
  t.ok(dark === 'rgb(10, 11, 13)', 'dark is the tokens’ dark chrome: ' + dark);
  t.ok(await mx.evaluate(`getComputedStyle(document.documentElement).colorScheme === 'dark'`),
    'and the browser is told, so its own controls follow');

  // Kept with the other settings, so it survives a reload.
  t.ok(await mx.waitFor(`MxStore.get('settings', 'theme').then(function (r) { return !!r && r.value === 'dark'; })`, 3000, 'saved'),
    'the choice is kept in the browser’s own database, with the other settings');
  await mx.navigate(t.MX);
  t.ok(await mx.waitFor(`document.documentElement.getAttribute('data-mode') === 'dark'`, 8000, 'after reload'),
    'and is still dark after a reload');

  // "Auto" is a preference, never a theme: what lands on <html> is resolved.
  await mx.evaluate(`Array.from(document.querySelectorAll('.theme-switch button')).find(function (b) { return b.getAttribute('aria-label') === 'Follow the system'; }).click()`);
  await mx.waitFor(`MxStore.get('settings', 'theme').then(function (r) { return !!r && r.value === 'auto'; })`, 3000, 'auto saved');
  const auto = await mx.evaluate(`document.documentElement.getAttribute('data-theme')`);
  t.ok(auto === 'light' || auto === 'dark', 'Auto puts the system’s theme on <html>, not the word auto: ' + auto);

  await mx.evaluate(`Array.from(document.querySelectorAll('.theme-switch button')).find(function (b) { return b.getAttribute('aria-label') === 'Light theme'; }).click()`);
  t.ok(await mx.waitFor(`document.documentElement.getAttribute('data-mode') === 'light'`, 3000, 'light again'), 'and back to light');

  // The fonts: bundled, served from here, and in use.
  t.ok(await mx.evaluate(`Promise.all([document.fonts.load('14px "Instrument Sans"'), document.fonts.load('12px "JetBrains Mono"')]).then(function (a) {
    return a[0].length === 1 && a[1].length === 1 && document.fonts.check('14px "Instrument Sans"') && document.fonts.check('12px "JetBrains Mono"');
  })`), 'Instrument Sans and JetBrains Mono load');
  t.ok(await mx.evaluate(`/^"?Instrument Sans/.test(getComputedStyle(document.body).fontFamily)`), 'and the page is set in Instrument Sans');
  const served = await mx.evaluate(`Promise.all(['/fonts/InstrumentSans.woff2', '/fonts/JetBrainsMono.woff2'].map(function (u) {
    return fetch(u).then(function (r) { return r.status + ' ' + r.headers.get('content-type'); });
  })).then(function (a) { return a.join(', '); })`);
  t.ok(served === '200 font/woff2, 200 font/woff2', 'both come from MxScout’s own server, as fonts: ' + served);

  // No component writes a colour of its own: every one is a token. The print
  // sheet is the one exception — paper is black on white whatever the theme.
  const literals = [];
  ['styles.css', 'docs.css', 'logs/logs.css', 'explorer.css', 'flowgraph.css', 'microflows.css', 'studioview.css', 'pagepreview.css'].forEach(function (f) {
    let css = readText(path.join(__dirname, '..', 'public', f)).replace(/\/\*[\s\S]*?\*\//g, '');
    const p = css.indexOf('@media print');
    if (p !== -1) {
      let depth = 0, i = css.indexOf('{', p);
      for (; i < css.length; i++) { if (css[i] === '{') depth++; else if (css[i] === '}' && --depth === 0) break; }
      css = css.slice(0, p) + css.slice(i + 1);
    }
    (css.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g) || []).forEach(function (m) { literals.push(f + ' ' + m); });
  });
  t.ok(literals.length === 0, 'no colour literal outside tokens.css' + (literals.length ? ': ' + literals.join(', ') : ''));
  await mx.close();
};
