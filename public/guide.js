/* MxScout — the Getting started guide.
 *
 * Six steps, in the order the questions actually arrive the first time
 * someone opens MxScout: start a project, browse it as a role, open an
 * object, connect to a running app, run a flow, then write it up and send
 * it. Every mockup below is built from the exact classes the real screens
 * use (file-drop, entity-card, popup-tab, data-table, live-status, sev,
 * code-display, …) against a fictional app — Riverside Logistics — so what
 * this page shows is what the tool looks like, not an illustration of it.
 *
 * Like about.js, this file is DATA (see steps() below), rendered by one
 * function that only ever sets text — no innerHTML here either.
 */
(function () {
  'use strict';

  var el = null;

  function init(api) { el = api.el; }

  // Same hash as app.js's moduleHue(), so the demo module's colour is drawn
  // from the same formula the real entity/flow views use — not a colour
  // picked to look nice on this one page.
  function moduleHue(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    return h;
  }
  var MOD = 'hsl(' + moduleHue('Logistics') + ', 58%, 63%)';

  function popupTab(label, active) {
    return el('button', { class: 'popup-tab' + (active ? ' is-active' : ''), text: label });
  }

  function mock(children) {
    return el('div', { class: 'card guide-mock', style: '--mod: ' + MOD }, children);
  }

  // ---------- step mockups (fictional data only) ----------

  function mockStart() {
    return mock([
      el('div', { class: 'file-drop' }, [
        el('div', {}, [el('strong', { text: 'Choose a JSON file' })]),
        el('div', { class: 'muted', text: 'A model exported from MxSonar, or a .mxscout package — or drop it here' })
      ]),
      el('div', { class: 'folder-pick' }, [
        el('div', {}, [el('strong', { text: 'Choose the Mendix project folder' })]),
        el('div', { class: 'muted', text: 'One pick — MxScout finds the .mpr file by itself' })
      ])
    ]);
  }

  function mockBrowse() {
    var roleRow = el('div', { class: 'role-inline' }, [
      el('span', { class: 'role-select-label', text: 'View as' }),
      el('select', { class: 'role-select', disabled: 'disabled' }, [
        el('option', { text: 'Field Tester' })
      ])
    ]);
    var group = el('div', { class: 'module-group' }, [
      el('div', { class: 'module-group-head' }, [
        el('span', { class: 'module-group-name', text: 'Logistics' }),
        el('span', { class: 'module-group-count', text: '3 entities' })
      ]),
      el('div', { class: 'entity-grid' }, [
        el('div', { class: 'entity-card' }, [
          el('div', { class: 'entity-card-name', text: 'Shipment' }),
          el('div', { class: 'entity-card-badges' }, [
            el('span', { class: 'badge badge-read', text: 'Read + write' }),
            el('span', { class: 'badge badge-cd', text: 'Create' })
          ])
        ]),
        el('div', { class: 'entity-card' }, [
          el('div', { class: 'entity-card-name', text: 'Driver' }),
          el('div', { class: 'entity-card-badges' }, [
            el('span', { class: 'badge badge-read', text: 'Read only' })
          ])
        ]),
        el('div', { class: 'entity-card' }, [
          el('div', { class: 'entity-card-name', text: 'Depot' }),
          el('div', { class: 'entity-card-badges' }, [
            el('span', { class: 'badge badge-none', text: 'No access' })
          ])
        ])
      ])
    ]);
    return mock([roleRow, group]);
  }

  function mockObject() {
    var tabs = el('div', { class: 'popup-tabs' }, [
      popupTab('Attributes & access', false), popupTab('Data', true), popupTab('Comments', false)
    ]);
    var head = el('tr', {}, [
      el('th', { text: 'id' }), el('th', { text: 'reference' }), el('th', { text: 'status' })
    ]);
    // Green marks a value this session may write on THAT row — and only one of
    // these two rows has it, which is the point: the app's own access rule
    // decides per row, so the same column can be writable on one and not the
    // next. Real classes, same as the screen.
    var rows = [
      el('tr', {}, [el('td', { text: '8841' }), el('td', { text: 'RL-22091' }), el('td', { class: 'data-write', text: 'In transit' })]),
      el('tr', {}, [el('td', { text: '8842' }), el('td', { text: 'RL-22092' }), el('td', { text: 'Delayed' })])
    ];
    var table = el('table', { class: 'data-table' }, [el('thead', {}, [head]), el('tbody', {}, rows)]);
    return mock([
      tabs, table,
      el('div', { class: 'data-write-legend' }, [
        el('span', { class: 'data-write-swatch' }),
        el('span', { text: 'Green: this session may write that value on that row.' })
      ]),
      el('div', { class: 'muted', text: '1–10 of 253 — search narrows this as you type' })
    ]);
  }

  function mockConnect() {
    var addressCard = el('div', { class: 'card' }, [
      el('h3', { class: 'live-h', text: 'Connect to the running app' }),
      el('label', { class: 'field' }, [
        el('span', { text: 'App address' }),
        el('div', { class: 'live-url-row' }, [
          el('input', { type: 'text', class: 'live-url-input', readonly: 'readonly', value: 'https://riverside-test.mendixcloud.com' }),
          el('button', { class: 'btn btn-primary', text: 'Check' })
        ])
      ])
    ]);
    var okRow = el('div', { class: 'live-status live-status-ok' }, [
      el('span', { class: 'live-dot' }),
      el('span', { text: 'This looks like a development, test or acceptance environment.' })
    ]);
    return mock([
      addressCard, okRow,
      el('div', { class: 'scan-section' }, [
        el('h4', { class: 'scan-h', text: 'Connect your app tab' }),
        el('textarea', {
          class: 'scan-script', readonly: 'readonly', rows: '2',
          text: '(function(){ /* pasted into the app tab’s console, F12 → Console */ })();'
        }),
        el('div', { class: 'scan-copy-row' }, [
          el('button', { class: 'btn btn-primary', text: 'Copy the code' })
        ])
      ])
    ]);
  }

  function mockRun() {
    var tabs = el('div', { class: 'popup-tabs' }, [
      popupTab('Run', true), popupTab('Comments', false)
    ]);
    var paramRow = el('div', { class: 'param-row' }, [
      el('div', { class: 'param-id' }, [
        el('span', { class: 'param-name', text: 'Shipment' }),
        el('span', { class: 'param-type', text: 'Logistics.Shipment' })
      ]),
      el('div', { class: 'param-control' }, [
        el('div', { class: 'param-choice' }, [
          el('span', { class: 'param-chosen', text: 'RL-22091 (#8841)' }),
          el('button', { class: 'btn btn-sm', text: 'Change…' })
        ])
      ])
    ]);
    var runCol = el('div', { class: 'flow-col-run' }, [
      el('h4', { text: 'Inputs (1)' }),
      el('div', { class: 'param-table' }, [paramRow]),
      el('div', { class: 'flow-run-actions' }, [
        el('button', { class: 'btn btn-danger', text: 'Run Recalculate_Route…' })
      ])
    ]);
    var sideCol = el('div', { class: 'flow-col-side' }, [
      el('h4', { text: 'Can be triggered by' }),
      el('div', { class: 'rule-badges' }, [
        el('span', { class: 'badge badge-read', text: 'Field Tester' })
      ])
    ]);
    return mock([tabs, el('div', { class: 'flow-cols' }, [runCol, sideCol])]);
  }

  function mockWriteUp() {
    var finding1 = el('div', { class: 'guide-finding' }, [
      el('span', { class: 'sev sev-critical', text: 'critical' }),
      el('span', { class: 'muted', text: 'Shipment.SettlementRef' })
    ]);
    var finding2 = el('div', { class: 'guide-finding' }, [
      el('span', { class: 'sev sev-medium', text: 'medium' }),
      el('span', { class: 'muted', text: 'Recalculate_Route' })
    ]);
    var code = el('div', { class: 'code-display' }, [
      el('span', { class: 'code-value', text: '7F2K-9QRT-XM4L' })
    ]);
    return mock([
      finding1, finding2, code,
      el('div', { class: 'scan-copy-row' }, [
        el('button', { class: 'btn', text: 'Copy for Word' }),
        el('button', { class: 'btn btn-primary', text: 'Send encrypted report' })
      ])
    ]);
  }

  function steps() {
    return [
      { num: '01', title: 'Start a project', mockup: mockStart, body: [
        'Name it, then point MxScout at a model — a JSON export from MxSonar, or the Mendix project folder itself. Either way the file is read in this browser, in a Web Worker; the server never sees it.'
      ] },
      { num: '02', title: 'Browse it as a role', mockup: mockBrowse, body: [
        'Entities, Microflows, Nanoflows and Pages are grouped by module. Switch “View as” at the top and every list narrows to what that role can actually reach — the badges above say read, write, create or nothing at all.'
      ] },
      { num: '03', title: 'Open an object', mockup: mockObject, body: [
        'Click an entity and its popup opens on Attributes & access, Data and Comments. What it is and who may see which rows sit on one tab, together — the same question asked at the same time — attributes and the associations the entity owns, each with its access under every rule that applies — then what is in it right now, then what you have to say about it.',
        'In the rows that come back, a value shown in green is one this session may write. That is asked of the app per row, not per column: a rule’s XPath decides which rows it covers, so the same field can be writable on one row and read-only on the next.',
        'Data needs a running app to answer from — that is the next step.'
      ] },
      { num: '04', title: 'Connect to a running app', mockup: mockConnect, body: [
        'Type the app’s address. Production is refused outright, no override — only local, test and acceptance environments are accepted. Once approved, paste one snippet into that app tab’s console and MxScout can read what that session sees.'
      ] },
      { num: '05', title: 'Run a flow', mockup: mockRun, body: [
        'A microflow or nanoflow gets a Run tab — behind a one-time acknowledgment — with its inputs and who may trigger it side by side, plus its own Comments tab. Choose each object from a picker that opens over the panel, and the confirmation names the exact flow and the exact object before anything happens. A page gets the same popup without the running: its inputs and who may open it, read-only — MxScout does not open pages in the app.'
      ] },
      { num: '06', title: 'Write it up, then send it', mockup: mockWriteUp, body: [
        'Open any object and log what is wrong: severity, what to change, and a status you can come back to. Send a review out as an encrypted HTML report, or copy it for Word — or package the whole project as one encrypted ‘.mxscout’ file with a one-time access code.'
      ] }
    ];
  }

  function renderStep(step) {
    var text = [
      el('div', { class: 'guide-num', text: step.num }),
      el('h3', { class: 'guide-step-title', text: step.title })
    ].concat(step.body.map(function (p) { return el('p', { class: 'guide-p', text: p }); }));

    return el('div', { class: 'guide-step' }, [
      el('div', { class: 'guide-step-text' }, text),
      el('div', { class: 'guide-step-mockup' }, [step.mockup()])
    ]);
  }

  function render() {
    var head = el('div', { class: 'guide-head' }, [
      el('h2', { class: 'guide-title', text: 'Getting started' }),
      el('p', { class: 'muted', text: 'How a project moves through MxScout, start to finish. Every screen below shows a fictional app — Riverside Logistics — so nothing here is a real project.' })
    ]);
    return el('div', { class: 'guide' }, [head].concat(steps().map(renderStep)));
  }

  window.MxGuide = { init: init, steps: steps, render: render };
})();
