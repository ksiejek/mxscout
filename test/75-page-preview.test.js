/* The Pages screen draws the page (public/pagepreview.js, placed by public/flowview.js): the
 * layout as a frame, every widget as what it is, and a click on one says what it is.
 *
 * On the synthetic fixture's model, read in the browser by mpr.js, with one page added whose
 * structure is written out by hand so that each case is there once: a pop-up layout, a data view
 * on the page parameter, a tab container whose second tab holds a list with an XPath and a
 * condition, a labelled text box, and a footer with a Primary Save and a button that calls a
 * microflow with an argument. What has to hold:
 *  - the page is drawn in the middle of the Pages screen, in a pop-up frame with its title;
 *  - an input is a label and a field with the attribute's name in it;
 *  - a click selects an element and the panel beside says what it is, in words, with the
 *    model's own names only under "For developers";
 *  - tabs switch; a list is its item and two faded repeats; a conditional one wears the eye;
 *  - nothing code-like is on the drawing: no XPath, no qualified name, no $parameter;
 *  - a button that runs a microflow offers a way to it, and it lands there;
 *  - Studio Pro's button style is used; "Show structure" outlines the layout. */
'use strict';
const { goToSection } = require('./helpers');
const fs = require('fs');
const path = require('path');

const ORDER_EDIT = {
  module: 'Sales', name: 'Order_Edit', qualifiedName: 'Sales.Order_Edit', path: [], allowedModuleRoles: ['Sales.User'],
  parameters: [{ name: 'Order', type: 'Object', entityQualifiedName: 'Sales.Order', enumerationQualifiedName: null, isList: false }],
  calledBy: [], dataSources: [], snippets: [], flowRefs: [], mentions: [], edits: [], creates: [], deletes: [],
  structure: {
    layout: 'Atlas_Core.PopupLayout', title: 'Edit order', popupWidth: 700, widgets: 9,
    regions: [{ kind: 'region', name: 'Main', widgets: [
      { kind: 'dataview', type: 'DataView', name: 'dvOrder', source: { kind: 'parameter', param: 'Order', entity: 'Sales.Order' },
        widgets: [{ kind: 'tabs', type: 'TabControl', name: 'tabs1', widgets: [
          { kind: 'tab', caption: 'General', widgets: [
            { kind: 'input', type: 'Text box', name: 'tbNumber', caption: 'Order number', attribute: 'Sales.Order.Number' }] },
          { kind: 'tab', caption: 'Customers', widgets: [
            { kind: 'listview', type: 'ListView', name: 'lvCustomers', visible: { expression: '$currentObject/Number != empty' },
              source: { kind: 'database', entity: 'Sales.Customer', xpath: '[Sales.Order_Customer = $currentObject]' },
              widgets: [{ kind: 'text', type: 'DynamicText', name: 'txtName', caption: '{Name}' }] }] }] }],
        footer: [
          { kind: 'button', type: 'ActionButton', name: 'btnSave', caption: 'Save', style: 'Primary', actions: [{ kind: 'save', closes: true, on: 'click' }] },
          { kind: 'button', type: 'ActionButton', name: 'btnRun', caption: 'Recalculate',
            actions: [{ kind: 'microflow', flow: 'Sales.CreateOrder', args: [{ name: 'Order', value: '$Order' }], on: 'click' }] }] }] }]
  }
};

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore && !!window.MxMicroflows && !!window.MxPagePreview', 15000, 'MxScout loaded');
  await mx.viewport(1440, 900);
  for (const src of ['/sqlite.js', '/bson.js', '/mpr.js']) {
    await mx.evaluate(`new Promise(function (res, rej) { var x = document.createElement('script'); x.src = '${src}'; x.onload = function () { res(true); }; x.onerror = rej; document.head.appendChild(x); })`);
  }
  const v1b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  await mx.evaluate(`(async function () {
    var bytes = Uint8Array.from(atob("${v1b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    var model = await window.MxMpr.buildModel({ mprBytes: bytes, appName: 'Sales', readContentsFile: function () { throw new Error('v1'); } });
    model.pages.push(${JSON.stringify(ORDER_EDIT)});
    await MxStore.saveProjectWithModel({ id: 'ppv', name: 'PageDemo', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      source: { kind: 'test' }, bytes: 1, summary: null, appUrl: null }, model);
  })()`);
  const SW = "(function(q){var s=document.querySelector('.switcher[aria-expanded=\"false\"]'); if (s) s.click(); return document.querySelectorAll(q);})";
  await mx.navigate(t.MX);
  await mx.waitFor(`!!Array.from(${SW}('.tree-project')).find(b => b.textContent.indexOf('PageDemo') !== -1)`, 10000, 'project');
  await mx.evaluate(`Array.from(${SW}('.tree-project')).find(b => b.textContent.indexOf('PageDemo') !== -1).click()`);
  await goToSection(mx, 'Pages', '.mf-mods, .mf-grid');
  await mx.evaluate(`(function(){ var s = document.querySelector('.xe-head .role-select'); if (s) { s.value = 'all'; s.dispatchEvent(new Event('change')); } return true; })()`);
  await mx.waitFor(`!!document.querySelector('.mf-mod-card, .mf-grid')`, 8000, 'modules');
  await mx.evaluate(`(function(){ var c = Array.from(document.querySelectorAll('.mf-mod-card')).find(function (x) { return /^Sales/.test(x.textContent); }); if (c) c.click(); return true; })()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.mf-row')).find(function (r) { return /Order_Edit/.test(r.textContent); })`, 8000, 'the page in the list');
  await mx.evaluate(`Array.from(document.querySelectorAll('.mf-row')).find(function (r) { return /Order_Edit/.test(r.textContent); }).click()`);
  await mx.waitFor(`!!document.querySelector('.pp-strip .pp')`, 8000, 'the drawing');

  // ---- the drawing is the middle of the screen, in its layout's frame ----
  const frame = JSON.parse(await mx.evaluate(`JSON.stringify({
    popup: !!document.querySelector('.pp-strip .pp-popup'), title: (document.querySelector('.pp-popup-title span') || {}).textContent,
    side: !!document.querySelector('.mf-detail .mf-side'), win: !!document.querySelector('.pp-win'),
    wide: document.querySelector('.pp-board').getBoundingClientRect().width / document.querySelector('.mf-detail').getBoundingClientRect().width,
    chip: (document.querySelector('.pp-dv > .pp-echip') || {}).textContent
  })`));
  t.ok(frame.popup && frame.title === 'Edit order' && !frame.side && !frame.win && frame.wide > 0.98 && frame.chip === 'Order',
    'the Pages screen draws the page across the whole middle, in a pop-up frame with its title and the data view wearing its entity, nothing beside it: ' + JSON.stringify(frame));

  // ---- About this page opens what the page is in a window over the drawing ----
  await mx.evaluate(`Array.from(document.querySelectorAll('.mf-detail .mf-btn')).find(function (b) { return b.textContent === 'About this page'; }).click()`);
  const about = await mx.evaluate(`(document.querySelector('.mf-step-scrim .pp-win') || {}).textContent || ''`);
  t.ok(/About this page/.test(about) && /Opened from/.test(about) && /Roles that may open it/.test(about), 'About this page opens the page’s facts in a window: ' + about.slice(0, 120));
  await mx.evaluate(`document.querySelector('.pp-win .mf-x').click()`);
  t.ok(await mx.waitFor(`!document.querySelector('.pp-win')`, 3000, 'closed'), 'and × closes it');

  // ---- zoom: −, +, Fit, as the Modeler's ----
  const z0 = await mx.evaluate(`document.querySelector('.pp-board .sv-zoom .sv-mono').textContent`);
  await mx.evaluate(`document.querySelector('.pp-board .sv-zoom button[aria-label="Zoom in"]').click()`);
  const z1 = JSON.parse(await mx.evaluate(`JSON.stringify({ label: document.querySelector('.pp-board .sv-zoom .sv-mono').textContent, zoom: document.querySelector('.pp-stage').style.zoom })`));
  const n0 = parseInt(z0, 10);
  t.ok(n0 > 0 && n0 <= 100 && z1.label === (n0 + 10) + '%' && Math.abs(parseFloat(z1.zoom) - (n0 + 10) / 100) < 0.001,
    'the drawing opens fitted to the width, never enlarged, and + zooms it: ' + z0 + ' → ' + JSON.stringify(z1));
  await mx.evaluate(`document.querySelector('.pp-board .sv-zoom button.fit').click()`);
  const zf = await mx.evaluate(`(function(){ var s = document.querySelector('.pp-strip'), g = document.querySelector('.pp-stage').getBoundingClientRect(), r = s.getBoundingClientRect(); return g.width <= r.width + 1 && g.height <= r.height + 1; })()`);
  t.ok(zf, 'Fit fits the whole page in the view');

  // ---- an input: its label, and the attribute's name in the empty field ----
  const fld = await mx.evaluate(`(function(){ var f = document.querySelector('.pp-fld'); return f.querySelector('.pp-lbl').textContent + '|' + f.querySelector('.pp-ph').textContent; })()`);
  t.ok(fld === 'Order number|Number', 'a text box is its label and a field showing the attribute it is bound to: ' + fld);

  // ---- a click selects it, and the panel says what it is ----
  await mx.evaluate(`(function(){ window.__ppRoot = document.querySelector('.pp-strip .pp'); return true; })()`);
  await mx.evaluate(`document.querySelector('.pp-fld').click()`);
  const picked = JSON.parse(await mx.evaluate(`JSON.stringify({
    sel: !!document.querySelector('.pp-fld.pp-sel'), kind: (document.querySelector('.pp-win .pp-kind') || {}).textContent,
    title: (document.querySelector('.pp-win .pp-title') || {}).textContent, text: (document.querySelector('.pp-win .pp-dl') || {}).textContent,
    dev: (document.querySelector('.pp-win .pp-dev') || {}).textContent
  })`));
  t.ok(picked.sel && picked.kind === 'Text box' && picked.title === 'Order number' && /Number of the order/.test(picked.text) && /Editable\s*Yes/.test(picked.text),
    'a click picks it and a window over the drawing says what it is, in words: ' + JSON.stringify(picked));
  t.ok(/Sales\.Order\.Number/.test(picked.dev) && !/Sales\.Order\.Number/.test(picked.text), 'the model’s own name only under For developers: ' + picked.dev);
  // A large page is thousands of nodes: a pick moves the outline on the drawing already there, it
  // does not draw the page again (on a large project a click took as long as opening the page).
  t.ok(await mx.evaluate(`document.querySelector('.pp-strip .pp') === window.__ppRoot && document.querySelectorAll('.pp-strip .pp-sel').length === 1`),
    'a pick keeps the drawing and moves the outline to what was clicked');

  await mx.evaluate(`document.querySelector('.pp-win').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  t.ok(await mx.waitFor(`!document.querySelector('.pp-win') && !document.querySelector('.pp-sel')`, 3000, 'closed'), 'Escape closes the window and lets go of the element');

  // ---- tabs switch; a list is its item and two faded repeats, the conditional one wearing the eye ----
  t.ok(await mx.evaluate(`!document.querySelector('.pp-lst')`), 'the second tab’s list is not drawn while the first tab is shown');
  await mx.evaluate(`Array.from(document.querySelectorAll('.pp-tab')).find(function (b) { return b.textContent === 'Customers'; }).click()`);
  const tab = JSON.parse(await mx.evaluate(`JSON.stringify({
    on: (document.querySelector('.pp-tab.on') || {}).textContent, list: !!document.querySelector('.pp-lst'),
    chip: (document.querySelector('.pp-lst > .pp-echip') || {}).textContent, ghosts: document.querySelectorAll('.pp-lst .pp-ghost').length,
    eye: !!document.querySelector('.pp-lst').parentNode.querySelector('.pp-cmark') || !!document.querySelector('.pp-lst > .pp-cmark'),
    token: (document.querySelector('.pp-lst .pp-tok') || {}).textContent, win: !!document.querySelector('.pp-win')
  })`));
  t.ok(await mx.evaluate(`document.querySelector('.pp-strip .pp') !== window.__ppRoot && !document.querySelector('.pp-strip .pp-sel')`),
    'another tab draws the page anew, with nothing picked on it');
  t.ok(tab.on === 'Customers' && tab.list && tab.chip === 'List · Customer' && tab.ghosts === 2 && tab.eye && tab.token === 'Name' && !tab.win,
    'a tab switches the pane without opening a window; its list is drawn as its item and two faded repeats, with the eye of its condition: ' + JSON.stringify(tab));

  // ---- nothing code-like on the drawing ----
  const canvasText = await mx.evaluate(`document.querySelector('.pp-strip .pp').textContent`);
  t.ok(!/\[|\$|Sales\.|currentObject/.test(canvasText), 'no XPath, no $parameter and no qualified name on the drawing: ' + canvasText.slice(0, 160));
  await mx.evaluate(`document.querySelector('.pp-lst').click()`);
  const listPanel = await mx.evaluate(`document.querySelector('.pp-win .pp-detail').textContent`);
  t.ok(/Customer records from the database, filtered/.test(listPanel) && /Only when a condition written by the developer holds/.test(listPanel) &&
    /\[Sales\.Order_Customer = \$currentObject\]/.test(listPanel),
    'the list’s panel says where its rows come from and when it shows, the XPath kept for developers: ' + listPanel.slice(0, 200));

  // ---- the buttons: Studio Pro's style, and a way to what they run ----
  t.ok(await mx.evaluate(`Array.from(document.querySelectorAll('.pp-dv-foot .pp-btn')).map(function (b) { return b.className.replace('pp-btn', '').replace(/pp-\\S+/g, '').trim() + ':' + b.textContent; }).join('|')`) === 'primary:Save|:Recalculate',
    'the footer’s buttons in their Studio Pro style: Save Primary, Recalculate Default');
  await mx.evaluate(`Array.from(document.querySelectorAll('.pp-dv-foot .pp-btn')).find(function (b) { return b.textContent === 'Recalculate'; }).click()`);
  const btn = await mx.evaluate(`document.querySelector('.pp-win .pp-detail').textContent`);
  t.ok(/Runs the microflow “Create Order”/.test(btn) && /Also hands over — Order: the page’s Order/.test(btn) && /Open Create Order →/.test(btn),
    'a button says what it runs and what it hands over, and offers the way there: ' + btn.slice(0, 200));

  // ---- Show structure outlines the layout ----
  await mx.evaluate(`(function(){ var c = document.querySelector('.pp-structure input[type=checkbox]'); c.click(); return true; })()`);
  t.ok(await mx.waitFor(`!!document.querySelector('.pp.pp-struct')`, 3000, 'structure'), 'Show structure outlines the containers and grids');

  await mx.evaluate(`Array.from(document.querySelectorAll('.pp-win .pp-go')).find(function (b) { return /Create Order/.test(b.textContent); }).click()`);
  const landed = await mx.waitFor(`(function(){ var d = document.querySelector('.mf-detail'); return d && /^Selected microflow: CreateOrder/.test(d.getAttribute('aria-label')) && d.getAttribute('aria-label'); })()`, 8000, 'the microflow');
  t.ok(!!landed, 'and Open lands on that microflow: ' + landed);
};
