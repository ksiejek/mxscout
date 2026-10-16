/* MxScout — light, dark, or the system's.
 *
 * The same choice the exported documentation offers, with the same two palettes. Light is the default
 * (Karol, 2026-10-13 — it was dark, what MxScout had always looked like); the choice is kept with the
 * other settings in this browser's own database. <html> carries the theme in effect, never "auto"
 * (data-theme, which tokens.css keys on; data-mode says the same for the code that asks), and the
 * accent (data-accent, cobalt). Moved out of app.js on 2026-10-16, a topic of its own.
 */
(function () {
  'use strict';

  var ACCENT = 'cobalt';
  var SETTING = 'theme';
  var systemLight = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  var el, state, render, store, navIcon;

  // api: { el, state, render, store, navIcon } — app.js.
  function init(api) {
    el = api.el; state = api.state; render = api.render; store = api.store; navIcon = api.navIcon;
    if (systemLight && systemLight.addEventListener) {
      systemLight.addEventListener('change', function () {
        if (state.settings.theme === 'auto') { apply(); render(); }
      });
    }
  }
  function inEffect() {
    var pref = state.settings.theme || 'light';
    return pref === 'auto' ? (systemLight && systemLight.matches ? 'light' : 'dark') : pref;
  }
  function apply() {
    var root = document.documentElement;
    root.setAttribute('data-theme', inEffect());
    root.setAttribute('data-mode', inEffect());
    root.setAttribute('data-accent', ACCENT);
  }
  function set(pref) {
    state.settings.theme = pref;
    apply();
    render();
    // A lost preference is cosmetic, so a failed write raises no banner.
    store.put('settings', { key: SETTING, value: pref }).catch(function () { return null; });
  }
  // The three buttons at the foot of the sidebar.
  function switcher() {
    var pref = state.settings.theme || 'light';
    return el('div', { class: 'theme-switch', role: 'group', 'aria-label': 'Theme' }, [
      ['light', 'sun', 'Light theme'], ['dark', 'moon', 'Dark theme'], ['auto', 'monitor', 'Follow the system']
    ].map(function (t) {
      return el('button', {
        class: pref === t[0] ? 'on' : null, 'aria-label': t[2], title: t[2], 'aria-pressed': pref === t[0] ? 'true' : 'false',
        onclick: function () { set(t[0]); }
      }, [navIcon(t[1], 15)]);
    }));
  }

  window.MxTheme = { init: init, inEffect: inEffect, apply: apply, set: set, switcher: switcher, SETTING: SETTING };
})();
