/* MxScout — Developer tools: the per-project switch.
 *
 * Karol, 2026-10-16: MxScout and MxScout Dev are one app again (1.18.0). Every
 * project reads, reviews and documents the model; a project with Developer
 * tools on also shows what reaches beyond it — the Live app (its data,
 * running a flow), Performance, Logs, Comments with the review report,
 * deciding about risks, MxScaffold drawings, and the Security screen — and
 * their buttons in an entity's or a flow's window. Off by default.
 *
 * The switch is a flag on the project (project.devTools), kept with it like
 * showMarketplaceModules. Off hides; it deletes nothing: comments, decisions
 * about risks and recordings stay where they are, keep travelling with the
 * folder and the package, and are there again when it is turned on. It is not
 * a build option: the code and the server's endpoints are in every copy, as
 * About & security says.
 *
 * app.js asks on(project) wherever it draws one of these, and hands a
 * function that asks it to the modules that draw one (objects.js,
 * microflows.js, domain.js, palette.js).
 */
(function () {
  'use strict';

  // The sidebar's sections that are Developer tools (app.js PROJECT_SECTIONS marks them dev: true).
  var SECTIONS = { security: true, performance: true, comments: true, logs: true, live: true };

  var el, state, saveProjectMeta, render, setMessage, closeLogs;

  // api: { el, state, saveProjectMeta(project) → promise, render, setMessage, closeLogs } — app.js.
  function init(api) {
    el = api.el; state = api.state; saveProjectMeta = api.saveProjectMeta;
    render = api.render; setMessage = api.setMessage; closeLogs = api.closeLogs;
  }

  function on(project) { return !!(project && project.devTools); }
  // Whether any project has them on: the log reader, which works with no project open, is offered then.
  function any() { return (state.projects || []).some(on); }

  // Turned off on a screen of its own, the project goes to its Settings, where the switch is.
  function set(project, value) {
    project.devTools = !!value;
    return saveProjectMeta(project).then(function () {
      var d = state.detail;
      if (!value && d) {
        if (SECTIONS[d.view]) d.view = 'settings';
        d.selectedEntity = null; d.selectedFlow = null; d.entityDataOnly = false;
      }
      if (!value && state.logs) closeLogs();
      setMessage(value ? 'Developer tools are on for this project: Live app, Performance, Logs, Comments and Security are in the sidebar.'
        : 'Developer tools are off for this project. What they kept stays, and is there again when you turn them on.', 'ok');
      render();
    });
  }

  // The switch, on the project's Settings: what turning it on adds, and that turning it off deletes nothing.
  function card(project) {
    var box = el('input', { type: 'checkbox', class: 'dev-tools-box' });
    if (on(project)) box.setAttribute('checked', 'checked');
    box.addEventListener('change', function () { set(project, box.checked); });
    return el('div', { class: 'card dev-tools-card' }, [
      el('h3', { class: 'live-h', text: 'Developer tools' }),
      el('label', { class: 'ack-row' }, [box, el('span', { text: ' Show Developer tools for this project' })]),
      el('p', { class: 'hint', text: 'Adds what goes beyond reading the model: the Live app — its data, and running a microflow or nanoflow in your own signed-in app tab — Performance recordings, Logs, Comments with the review report, deciding about risks, MxScaffold drawings, and the Security screen. View as on Entities, Microflows, Nanoflows and Pages works without them. '
        + 'The Live app and Performance talk to a running Mendix app: through the app tab you connect, and to its admin port on this machine when you record performance (About & security says exactly what). '
        + 'Off, none of it is shown; nothing it kept is deleted.' })
    ]);
  }

  window.MxDevTools = { init: init, on: on, any: any, set: set, card: card, SECTIONS: SECTIONS };
})();
