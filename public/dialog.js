/* MxScout — every window over the screen is a modal dialog, for the keyboard and for a screen reader.
 *
 * The audit of 2026-10-15 (B13): an entity's window had no role and no name, focus stayed behind it, and
 * Tab walked out of it into the screen underneath. The W3C pattern for a modal dialog
 * (https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) asks for five things, and they are kept here,
 * in one place, for every window:
 *
 *   - role="dialog" and aria-modal="true", and a name — aria-labelledby its title (its first heading),
 *     unless the window already says aria-label;
 *   - focus moves inside when it opens: to the first control, or to the window itself;
 *   - Tab and Shift+Tab go round inside it and never leave it while it is open;
 *   - Escape closes it, when the window says how (MxDialog.modal(box, close)) — a window that is half
 *     way through something that cannot be redone (the access code of a package being made) says nothing,
 *     and stays;
 *   - when it closes, focus goes back to what opened it.
 *
 * What counts as a window: anything with the class .modal (the app's windows) or aria-modal="true" (the
 * Microflows screen's step and page windows, the Studio Pro view, the documentation's search and access
 * windows). A window drawn by a module that never calls MxDialog.modal still gets the role, the name, the
 * focus and the Tab loop; MxDialog.modal adds what Escape does.
 *
 * Why it watches the page instead of being told: MxScout draws the whole app again on every click
 * (app.js render()), so the window on screen after a click inside it is a NEW element with the same
 * title — the same window. It is told apart from a window that really closed by its title, and focus is
 * put back on the same control in the new copy. The opener is found again the same way when the screen
 * under it was drawn again too: the same kind of element, with the same text, at the same place among
 * its likes. Nothing here stores anything or reaches anything; it moves focus and sets three attributes.
 */
(function () {
  'use strict';

  var closers = typeof WeakMap === 'function' ? new WeakMap() : null;
  var open = [];            // [{ node, key, opener, inside }] — bottom first, the top one last
  var trail = [];           // [{ el, loc }] — the last few controls focused, the newest last: a window's opener
  var seq = 0, queued = false, started = false;

  var WINDOWS = '.modal, [aria-modal="true"]';
  var FOCUSABLE = 'a[href], button, input, select, textarea, summary, iframe, [contenteditable="true"], [tabindex]';

  // A window, made one: its role, its name, and — when given — what Escape does. Returns the box.
  function modal(box, close) {
    if (!box) return box;
    decorate(box);
    if (typeof close === 'function' && closers) closers.set(box, close);
    return box;
  }

  function decorate(box) {
    if (box.getAttribute('data-dialog') === '1') return;
    box.setAttribute('data-dialog', '1');
    box.setAttribute('role', box.getAttribute('role') === 'alertdialog' ? 'alertdialog' : 'dialog');
    box.setAttribute('aria-modal', 'true');
    if (!box.hasAttribute('tabindex')) box.setAttribute('tabindex', '-1');
    if (!box.getAttribute('aria-label') && !box.getAttribute('aria-labelledby')) {
      var title = box.querySelector('h1, h2, h3, h4');
      if (title) {
        if (!title.id) title.id = 'mx-dialog-title-' + (++seq);
        box.setAttribute('aria-labelledby', title.id);
      }
    }
  }

  function nameOf(box) {
    var by = box.getAttribute('aria-labelledby'), t = by && document.getElementById(by);
    return box.getAttribute('aria-label') || (t ? t.textContent : '') || '';
  }
  // The same window drawn again has the same kind and the same name.
  function keyOf(box) { return String(box.className && box.className.baseVal !== undefined ? box.className.baseVal : box.className) + '|' + nameOf(box); }

  function visible(n) {
    if (!n.getClientRects().length) return false;
    var cs = window.getComputedStyle(n);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }
  function tabbable(box) {
    return Array.prototype.filter.call(box.querySelectorAll(FOCUSABLE), function (n) {
      if (n.disabled || n.getAttribute('tabindex') === '-1' || n.getAttribute('aria-hidden') === 'true') return false;
      if (n.tagName === 'INPUT' && n.type === 'hidden') return false;
      // Inside a closed <details> only its <summary> can be reached.
      var d = n.parentElement && n.parentElement.closest('details:not([open])');
      if (d && !(n.tagName === 'SUMMARY' && n.parentElement === d)) return false;
      return visible(n);
    });
  }

  // ---------- finding a control again, after the screen was drawn again ----------
  function textOf(n) { return (n.getAttribute('aria-label') || n.textContent || n.value || '').replace(/\s+/g, ' ').trim().slice(0, 80); }
  function sameKind(a, loc) { return a.tagName === loc.tag && textOf(a) === loc.text && (a.getAttribute('class') || '') === loc.cls; }
  function locate(n, scope) {
    var loc = { tag: n.tagName, text: textOf(n), cls: n.getAttribute('class') || '', at: 0 };
    var like = Array.prototype.filter.call((scope || document).querySelectorAll(n.tagName), function (x) { return sameKind(x, loc); });
    loc.at = Math.max(0, like.indexOf(n));
    return loc;
  }
  function find(loc, scope) {
    if (!loc) return null;
    var like = Array.prototype.filter.call((scope || document).querySelectorAll(loc.tag), function (x) { return sameKind(x, loc); });
    return like[Math.min(loc.at, like.length - 1)] || null;
  }
  function focusOn(n) { if (!n) return false; try { n.focus({ preventScroll: true }); } catch (e) { return false; } return document.activeElement === n; }

  // What opened a window, as it is on the page now. The control itself when it is still there or drawn
  // again; when it went with what it was in — an item of a menu that closed, the search's box — the
  // control focused before it that is still there: the menu's button. A text box is never that second
  // choice: focusing the search's box opens the search again.
  var TRAIL = 6;
  function openerOf(r, scope) {
    var list = r.opener || [];
    for (var i = list.length - 1; i >= 0; i--) {
      var f = list[i], o = f.el && f.el.isConnected ? f.el : find(f.loc);
      if (!o || !scope.contains(o)) continue;
      if (i < list.length - 1 && /^(INPUT|TEXTAREA|SELECT)$/.test(o.tagName)) continue;
      return o;
    }
    return null;
  }

  function lost() {
    var a = document.activeElement;
    return !a || a === document.body || a === document.documentElement || !a.isConnected;
  }
  function owner(n) { for (var i = open.length - 1; i >= 0; i--) if (open[i].node.contains(n)) return open[i]; return null; }

  // ---------- after every change to the page ----------
  function sync() {
    queued = false;
    var nodes = Array.prototype.filter.call(document.querySelectorAll(WINDOWS), function (n) { return n.isConnected; });
    nodes.forEach(decorate);
    var was = open, next = [], used = [];
    nodes.forEach(function (n, i) {
      var key = keyOf(n), prev = null;
      for (var j = 0; j < was.length && !prev; j++) if (used.indexOf(was[j]) === -1 && (was[j].node === n || was[j].key === key)) prev = was[j];
      // A window that took the place of another (the next entity, opened from inside the window of the
      // last) keeps the first one's opener: closing it goes back to where the reader started.
      var replaced = !prev && was[i] && used.indexOf(was[i]) === -1 && nodes.indexOf(was[i].node) === -1 && !nodes.some(function (m) { return keyOf(m) === was[i].key; }) ? was[i] : null;
      if (prev) { used.push(prev); prev.node = n; prev.key = key; next.push(prev); return; }
      if (replaced) used.push(replaced);
      next.push({ node: n, key: key, opener: replaced ? replaced.opener : trail.filter(function (f) { return !n.contains(f.el); }), inside: null, fresh: true });
    });
    var closed = was.filter(function (r) { return used.indexOf(r) === -1; });
    open = next;

    var top = open[open.length - 1];
    if (top) {
      var a = document.activeElement;
      if (a && a !== top.node && top.node.contains(a)) { top.fresh = false; return; }
      if (!top.fresh && !lost() && !closed.some(function (r) { return r.node.contains(a); })) return;
      // A window over this one closed: back to what opened it, in this one. A new window: its first
      // control. The same window drawn again: the control that had focus in it.
      var back = null;
      if (!top.fresh) closed.forEach(function (r) { var o = openerOf(r, top.node); if (o) back = o; });
      var target = back || (!top.fresh && top.inside && find(top.inside, top.node)) || tabbable(top.node)[0] || top.node;
      top.fresh = false;
      focusOn(target) || focusOn(top.node);
      return;
    }
    // Every window closed: back to what opened the last one, when focus has nowhere better to be.
    var gone = closed[closed.length - 1];
    if (gone && (lost() || gone.node.contains(document.activeElement))) focusOn(openerOf(gone, document));
  }
  function later() { if (!queued) { queued = true; Promise.resolve().then(sync); } }

  function onFocusIn(e) {
    var n = e.target;
    if (!n || n === document || n === window || !n.tagName) return;
    var r = owner(n);
    if (r && n === r.node) return;
    if (r) r.inside = locate(n, r.node);
    trail.push({ el: n, loc: locate(n) });
    if (trail.length > TRAIL) trail.shift();
  }

  function onKey(e) {
    var top = open[open.length - 1];
    // A key something else already took — the search's Tab, a text box's Escape — is left to it.
    if (!top || !top.node.isConnected || e.defaultPrevented) return;
    if (e.key === 'Tab' && !e.altKey && !e.ctrlKey && !e.metaKey) {
      var list = tabbable(top.node), a = document.activeElement;
      if (!list.length) { e.preventDefault(); focusOn(top.node); return; }
      var first = list[0], last = list[list.length - 1];
      if (!top.node.contains(a)) { e.preventDefault(); focusOn(e.shiftKey ? last : first); return; }
      if (e.shiftKey && (a === first || a === top.node)) { e.preventDefault(); focusOn(last); return; }
      if (!e.shiftKey && a === last) { e.preventDefault(); focusOn(first); return; }
      return;
    }
    if (e.key === 'Escape' || e.key === 'Esc') {
      // Only for the window the key was pressed in.
      if (!(top.node.contains(e.target) || e.target === document.body)) return;
      var close = closers && closers.get(top.node);
      if (!close) return;
      e.preventDefault();
      close();
    }
  }

  // Installed once, by app.js. Watches the whole page: a window may be drawn by app.js, by a screen's own
  // module, or by the documentation's viewer inside a screen.
  function init() {
    if (started) return;
    started = true;
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('keydown', onKey);
    new MutationObserver(later).observe(document.body, { childList: true, subtree: true });
    later();
  }

  window.MxDialog = { init: init, modal: modal };
})();
