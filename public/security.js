/* MxScout — the Security section: how this app is secured, as the project
 * itself records it.
 *
 * Every other browsing view answers "what can this role reach". This one
 * answers the question underneath that: whether the running app enforces any
 * of it, and who the roles are in the first place. Both come out of one
 * document in the .mpr — the project's Security screen — plus the per-module
 * role lists, and MxScout read neither until this existed: it showed a
 * role-by-role access picture without ever saying whether the app checks it.
 *
 * A project whose SecurityLevel is CheckNothing has an access matrix that is
 * real in the model and inert at run time. Saying that out loud, at the top,
 * is the difference between a true picture and a plausible one.
 *
 * SECRETS: this renders what MxScout CONCLUDED about a password, never the
 * password. The model carries the admin password and every demo user's
 * password in plain text; the reader opens them in the Worker, judges them
 * against this project's own password policy and a short list of passwords
 * that need no cracking, then keeps the verdict and drops the value (see
 * judgePassword in mpr.js). So there is nothing here to leak into a .mxscout
 * package and nothing to print into a report — and the finding survives at
 * full strength, because "set" is hygiene while "set, and shorter than the
 * twelve characters this app demands of its own users" is the thing somebody
 * needs to act on.
 *
 * Model shape read here, all of it optional — a model exported from MxSonar,
 * or imported before this existed, simply has none of it and says so rather
 * than claiming the app is unsecured:
 *   model.security     = { level, checkSecurity, strictMode, strictPageUrlCheck,
 *                          guestAccess, guestUserRole, demoUsersEnabled,
 *                          demoUsers[], adminUserName, adminUserRole,
 *                          adminPassword, passwordPolicy }
 *   a password         = { set, length|null, failsPolicy[], common, sameAsUserName }
 *                          — what MxScout concluded, never the password
 *   model.userRoles[]  = { name, moduleRoles[], manageAllRoles, manageableRoles[] }
 *   model.moduleRoles[]= { module, name, qualifiedName, description }
 *   model.publishedServices[] = { kind, module, name, qualifiedName, path,
 *                          version, allowedModuleRoles[]|null, authentication[],
 *                          authenticationMicroflow, exposes[] }
 *   model.automation[] = { kind, module, name, qualifiedName, enabled,
 *                          microflow, schedule, timeZone, parallelism }
 */
(function () {
  'use strict';

  var el, state, moduleColor, withMod;

  function init(deps) {
    el = deps.el;
    state = deps.state;
    moduleColor = deps.moduleColor;
    withMod = deps.withMod;
  }

  // ---------- the three security levels, in the words Studio Pro uses ----
  // The enum value in the file, the Security screen's own label, and what it
  // actually means for everything else MxScout shows.
  var LEVELS = {
    CheckNothing: {
      label: 'Off',
      tone: 'bad',
      means: 'The running app enforces none of this. Every role reaches everything, whatever the rules below say.'
    },
    CheckFormsAndMicroflows: {
      label: 'Prototype',
      tone: 'warn',
      means: 'The running app checks pages and microflows, but not entity access. Who can open what is enforced; which rows and fields they then see is not.'
    },
    CheckEverything: {
      label: 'Production',
      tone: 'ok',
      means: 'The running app checks pages, microflows and entity access — the picture in the other views is the one it enforces.'
    }
  };
  function levelOf(security) {
    return (security && LEVELS[security.level]) || null;
  }

  // The banner that belongs at the top of every role-filtered view, not only
  // on this page: if the app does not enforce the access rules, a role filter
  // showing "Manager can read Order" is describing an intention, not a
  // behaviour. Returns null for the Production case, which is the one that
  // needs no caveat, and for a model that has no security document to read.
  function renderLevelWarning(model) {
    var security = model && model.security;
    var level = levelOf(security);
    if (!level || level.tone === 'ok') return null;
    return el('div', { class: 'sec-banner sec-' + level.tone }, [
      el('strong', { text: 'Security is ' + level.label + ' in this project.' }),
      el('span', { text: ' ' + level.means })
    ]);
  }

  // ---------- small display helpers ----------
  function onOff(value, onText, offText) {
    if (value === null || value === undefined) return el('span', { class: 'muted', text: 'not recorded' });
    return el('span', { class: value ? 'sec-on' : 'sec-off', text: value ? onText : offText });
  }
  function row(key, valueNode, note) {
    return el('div', { class: 'kv-row' }, [
      el('span', { class: 'kv-key', text: key }),
      el('span', { class: 'kv-val' }, [valueNode, note ? el('span', { class: 'muted sec-note', text: note }) : null].filter(Boolean))
    ]);
  }

  // ---------- what was concluded about a password ----------
  // MxScout reads a password once, in the Worker, to judge it, and keeps only
  // the judgement (see judgePassword in mpr.js). So there is never a value to
  // show here — and the verdict is the more useful half anyway: "set" is
  // hygiene, "set, and shorter than the twelve characters this project
  // demands of its own users" is a finding.
  //
  // A model from before this was read carries the old boolean instead, so
  // that is normalised rather than rendered as "no password".
  function passwordVerdict(judgement, legacyBoolean) {
    if (!judgement) {
      if (legacyBoolean) return { tone: 'sec-off', text: 'set, in plain text', note: null };
      return { tone: 'muted', text: 'none', note: null };
    }
    var reasons = (judgement.failsPolicy || []).slice();
    if (judgement.common) reasons.unshift('one of the most common passwords there are');
    if (judgement.sameAsUserName) reasons.unshift('the same as the user name');
    if (!reasons.length) {
      return { tone: 'sec-off', text: 'set, in plain text',
        note: 'It meets this project’s own password policy. MxScout read it to check that and kept only the answer.' };
    }
    var length = typeof judgement.length === 'number' ? judgement.length + ' character' + (judgement.length === 1 ? '' : 's') + ', ' : '';
    return { tone: 'sec-weak', text: 'set, in plain text — weak',
      note: length + reasons.join('; ') + '. MxScout read it to work that out and kept only the answer, never the password.' };
  }

  function passwordPolicyText(policy) {
    if (!policy) return null;
    var parts = [];
    if (typeof policy.minimumLength === 'number') parts.push(policy.minimumLength + ' characters minimum');
    if (policy.requireDigit) parts.push('a digit');
    if (policy.requireMixedCase) parts.push('mixed case');
    if (policy.requireSymbol) parts.push('a symbol');
    return parts.length ? parts.join(', ') : 'nothing required';
  }

  // ---------- how the app is secured ----------
  function settingsBlock(model) {
    var s = model.security;
    var level = levelOf(s);
    var rows = [];

    rows.push(row('Security level',
      level ? el('span', { class: 'sec-level sec-' + level.tone, text: level.label })
            : el('span', { class: 'muted', text: s && s.level ? s.level : 'not recorded' }),
      level ? level.means : null));

    // Guest access is the prerequisite for the whole class of "anonymous
    // visitor can read something" problems, so it says which role a
    // signed-out visitor is given, not just that the switch is on.
    rows.push(row('Anonymous access',
      onOff(s.guestAccess, 'On', 'Off'),
      s.guestAccess
        ? (s.guestUserRole ? 'Someone who has not signed in gets the "' + s.guestUserRole + '" role.' : 'On, but no role is named for it.')
        : 'Everything requires a sign-in.'));

    rows.push(row('Strict mode',
      onOff(s.strictMode, 'On', 'Off'),
      s.strictMode === false ? 'Off — access rights are resolved the older, more permissive way.' : null));

    rows.push(row('Page URL check',
      onOff(s.strictPageUrlCheck, 'On', 'Off'),
      s.strictPageUrlCheck === false ? 'Off — page URLs are not checked strictly.' : null));

    var policy = passwordPolicyText(s.passwordPolicy);
    rows.push(row('Password policy',
      policy ? el('span', { text: policy }) : el('span', { class: 'muted', text: 'not recorded' })));

    // The administrator account, and — as a fact, never as a value — whether
    // its password is sitting in the project file in plain text.
    var adminBits = [];
    if (s.adminUserName) adminBits.push(s.adminUserName);
    if (s.adminUserRole) adminBits.push('role ' + s.adminUserRole);
    var adminPassword = passwordVerdict(s.adminPassword, s.adminPasswordSet);
    rows.push(row('Administrator',
      adminBits.length ? el('span', { text: adminBits.join(' · ') }) : el('span', { class: 'muted', text: 'not recorded' }),
      adminPassword.note));
    if (adminPassword.note && s.adminPassword && adminPassword.tone === 'sec-weak') {
      // A weak administrator password is the strongest single thing this
      // page can say, so it is said as a verdict of its own rather than as a
      // note hanging off a row about a user name.
      rows.push(row('Administrator password',
        el('span', { class: 'sec-weak', text: adminPassword.text })));
    }

    var demo = s.demoUsers || [];
    var weakDemo = demo.filter(function (u) { return passwordVerdict(u.password, u.passwordSet).tone === 'sec-weak'; });
    rows.push(row('Demo users',
      onOff(s.demoUsersEnabled, 'On', 'Off'),
      demo.length
        ? demo.length + ' account' + (demo.length === 1 ? '' : 's') + ' in the model, with passwords in plain text' +
          (weakDemo.length ? ' — ' + weakDemo.length + ' of them weak.' : '.')
        : (s.demoUsersEnabled ? 'Switched on, but no accounts are defined.' : null)));

    var kids = [el('div', { class: 'kv' }, rows)];
    if (demo.length) {
      kids.push(el('div', { class: 'sec-sub' }, [
        el('h4', { text: 'Demo accounts' }),
        el('p', { class: 'hint', text: 'Names, roles, and what MxScout concluded about each password. It read them here in the browser to work that out and kept only the conclusion — no password reaches this browser’s database, a package, or a report.' }),
        el('table', { class: 'sec-table' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { text: 'User name' }), el('th', { text: 'Roles' }), el('th', { text: 'Password' })
          ])]),
          el('tbody', {}, demo.map(function (u) {
            var verdict = passwordVerdict(u.password, u.passwordSet);
            return el('tr', {}, [
              el('td', { text: u.userName }),
              el('td', { text: (u.userRoles || []).join(', ') || '—' }),
              el('td', {}, [
                el('span', { class: verdict.tone, text: verdict.text }),
                verdict.note ? el('span', { class: 'muted sec-note', text: verdict.note }) : null
              ].filter(Boolean))
            ]);
          }))
        ])
      ]));
    }

    return el('div', { class: 'card' }, [el('h3', { text: 'How this app is secured' })].concat(kids));
  }

  // ---------- user roles ----------
  // The role a person is given, and what it actually unlocks. Two things the
  // list makes visible that no other view does: a role that maps to nothing
  // (it can sign in and reach nothing), and a role that can hand out roles.
  function userRolesBlock(model) {
    var roles = model.userRoles || [];
    if (!roles.length) {
      return el('div', { class: 'card' }, [
        el('h3', { text: 'User roles' }),
        el('p', { class: 'muted', text: 'This model has no user roles.' })
      ]);
    }
    var guestRole = model.security && model.security.guestAccess ? model.security.guestUserRole : null;
    var rows = roles.map(function (r) {
      var mrs = r.moduleRoles || [];
      var flags = [];
      if (guestRole && r.name === guestRole) {
        flags.push(el('span', { class: 'badge badge-none', title: 'Someone who has not signed in is given this role', text: 'anonymous' }));
      }
      if (r.manageAllRoles) {
        flags.push(el('span', { class: 'badge badge-cd', title: 'This role can assign every other role, including roles above its own', text: 'manages all roles' }));
      } else if ((r.manageableRoles || []).length) {
        flags.push(el('span', { class: 'badge badge-cd', title: 'Can assign: ' + r.manageableRoles.join(', '), text: 'manages ' + r.manageableRoles.length + ' role' + (r.manageableRoles.length === 1 ? '' : 's') }));
      }
      return el('tr', {}, [
        el('td', {}, [el('strong', { text: r.name })].concat(flags)),
        el('td', {}, mrs.length
          ? mrs.map(function (mr) {
              var chip = el('span', { class: 'chip on', text: mr });
              chip.style.setProperty('--mod', moduleColor(String(mr).split('.')[0]));
              return chip;
            })
          : [el('span', { class: 'sec-off', text: 'nothing — this role unlocks no module' })])
      ]);
    });
    return el('div', { class: 'card' }, [
      el('h3', { text: 'User roles' }),
      el('p', { class: 'hint', text: 'A user role is what a person is given. What it unlocks is the module roles it carries — those are what access rules, microflows and pages are actually written against.' }),
      el('table', { class: 'sec-table' }, [
        el('thead', {}, [el('tr', {}, [el('th', { text: 'User role' }), el('th', { text: 'Carries these module roles' })])]),
        el('tbody', {}, rows)
      ])
    ]);
  }

  // ---------- module roles ----------
  // Read from each module's own security unit, which is the only place a
  // role that no access rule happens to mention is written down. Two hygiene
  // facts fall out of having the full list: a role nobody holds (no user role
  // carries it, so nothing can ever have it) and a role that grants nothing
  // (no rule, no microflow and no page names it).
  function moduleRolesBlock(model) {
    var roles = model.moduleRoles || [];
    if (!roles.length) return null;

    var held = {};
    (model.userRoles || []).forEach(function (r) {
      (r.moduleRoles || []).forEach(function (mr) { held[mr] = true; });
    });

    var granted = {};
    (model.entities || []).forEach(function (e) {
      (e.accessRules || []).forEach(function (rule) { if (rule && rule.moduleRole) granted[rule.moduleRole] = true; });
    });
    ['microflows', 'nanoflows', 'pages'].forEach(function (key) {
      (model[key] || []).forEach(function (f) {
        (f.allowedModuleRoles || []).forEach(function (mr) { granted[mr] = true; });
      });
    });

    var byModule = {};
    roles.forEach(function (r) { (byModule[r.module] = byModule[r.module] || []).push(r); });

    var groups = Object.keys(byModule).sort().map(function (mod) {
      var rows = byModule[mod].map(function (r) {
        var notes = [];
        if (!held[r.qualifiedName]) {
          notes.push(el('span', { class: 'badge badge-none', title: 'No user role carries this module role, so nobody can ever have it', text: 'held by nobody' }));
        }
        if (!granted[r.qualifiedName]) {
          notes.push(el('span', { class: 'badge badge-none', title: 'No access rule, microflow or page names this role', text: 'grants nothing' }));
        }
        return el('tr', {}, [
          el('td', {}, [el('strong', { text: r.name })].concat(notes)),
          el('td', {}, [r.description
            ? el('span', { text: r.description })
            : el('span', { class: 'muted', text: 'no description' })])
        ]);
      });
      return withMod(el('div', { class: 'module-group' }, [
        el('div', { class: 'module-group-head' }, [
          el('span', { class: 'module-group-name', text: mod }),
          el('span', { class: 'module-group-count', text: rows.length + ' role' + (rows.length === 1 ? '' : 's') })
        ]),
        el('table', { class: 'sec-table' }, [
          el('thead', {}, [el('tr', {}, [el('th', { text: 'Module role' }), el('th', { text: 'What it is for' })])]),
          el('tbody', {}, rows)
        ])
      ]), mod);
    });

    return el('div', { class: 'card' }, [
      el('h3', { text: 'Module roles' }),
      el('p', { class: 'hint', text: 'Every role each module declares — including the ones no rule happens to mention, which is exactly why they are read from the module rather than inferred from the rules.' })
    ].concat(groups));
  }

  // ---------- open to the outside ----------
  // The role filter cannot answer this one: a published REST or OData service
  // is reachable by anything that can reach the app, gated by its own role
  // list and its own authentication rather than by the access rules every
  // other view shows. A service with neither is worth seeing plainly — it
  // may be entirely deliberate (an OIDC callback has to be reachable before
  // anybody is signed in), which is exactly why it is shown rather than
  // flagged.
  function publishedBlock(model) {
    var services = model.publishedServices || [];
    if (!services.length) return null;
    var rows = services.map(function (s) {
      var open = Array.isArray(s.allowedModuleRoles) && !s.allowedModuleRoles.length &&
        !(s.authentication || []).length && !s.authenticationMicroflow;
      var access;
      if (s.allowedModuleRoles === null) {
        // A SOAP service is not gated by roles at all, and printing "no
        // roles" for it would read as "open to everyone".
        access = [el('span', { class: 'muted', text: 'not gated by roles' })];
      } else if (s.allowedModuleRoles.length) {
        access = s.allowedModuleRoles.map(function (mr) {
          var chip = el('span', { class: 'chip on', text: mr });
          chip.style.setProperty('--mod', moduleColor(String(mr).split('.')[0]));
          return chip;
        });
      } else {
        access = [el('span', { class: 'sec-off', text: 'no roles listed' })];
      }
      var auth = (s.authentication || []).slice();
      if (s.authenticationMicroflow) auth.push('microflow ' + s.authenticationMicroflow);
      return el('tr', {}, [
        el('td', {}, [
          el('strong', { text: s.name }),
          el('span', { class: 'muted sec-note', text: s.kind + (s.path ? ' · ' + s.path : '') + (s.version ? ' · v' + s.version : '') }),
          open ? el('span', { class: 'badge badge-none', title: 'No role list and no authentication: anything that can reach the app can call this', text: 'nothing gates it' }) : null
        ].filter(Boolean)),
        el('td', {}, access),
        el('td', {}, [auth.length
          ? el('span', { text: auth.join(', ') })
          : el('span', { class: 'sec-off', text: 'none' })]),
        el('td', {}, [(s.exposes || []).length
          ? el('span', { text: s.exposes.length + ' · ' + s.exposes.slice(0, 3).join(', ') + (s.exposes.length > 3 ? ' …' : ''), title: s.exposes.join('\n') })
          : el('span', { class: 'muted', text: '—' })])
      ]);
    });
    return el('div', { class: 'card' }, [
      el('h3', { text: 'Open to the outside' }),
      el('p', { class: 'hint', text: 'What this app publishes, and what stands between it and a caller. None of it goes through the access rules the other views show — a published service is gated by its own role list and its own authentication.' }),
      el('table', { class: 'sec-table' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'Service' }), el('th', { text: 'Roles' }),
          el('th', { text: 'Authentication' }), el('th', { text: 'Exposes' })
        ])]),
        el('tbody', {}, rows)
      ])
    ]);
  }

  // ---------- runs without a user ----------
  // A scheduled event executes a microflow on a timer, in no session, as
  // nobody — outside every role in the model and therefore outside every
  // other view in MxScout.
  function automationBlock(model) {
    var items = model.automation || [];
    if (!items.length) return null;
    var rows = items.map(function (a) {
      var what = [];
      if (a.schedule) what.push(a.schedule);
      if (a.timeZone) what.push(a.timeZone);
      if (a.parallelism) what.push(a.parallelism + ' at a time');
      return el('tr', {}, [
        el('td', {}, [
          el('strong', { text: a.name }),
          el('span', { class: 'muted sec-note', text: a.kind }),
          a.enabled === false ? el('span', { class: 'badge badge-none', title: 'Defined, but switched off', text: 'off' }) : null
        ].filter(Boolean)),
        el('td', {}, [a.microflow
          ? el('span', { class: 'trig-name', text: a.microflow })
          : el('span', { class: 'muted', text: '—' })]),
        el('td', {}, [what.length
          ? el('span', { text: what.join(' · ') })
          : el('span', { class: 'muted', text: '—' })])
      ]);
    });
    return el('div', { class: 'card' }, [
      el('h3', { text: 'Runs without a user' }),
      el('p', { class: 'hint', text: 'A scheduled event runs a microflow on a timer, in no session and as nobody — outside every role in this model, and so outside every other view here. A queue runs work the same way, handed to it by whatever put it there.' }),
      el('table', { class: 'sec-table' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'Name' }), el('th', { text: 'Runs' }), el('th', { text: 'When' })
        ])]),
        el('tbody', {}, rows)
      ])
    ]);
  }

  // ---------- the section ----------
  function renderPanel(model) {
    if (!model.security && !(model.moduleRoles || []).length &&
        !(model.publishedServices || []).length && !(model.automation || []).length) {
      return el('div', { class: 'empty' }, [
        el('p', { text: 'This model does not carry the project’s security settings.' }),
        el('p', { class: 'muted', text: 'It was imported from a JSON export, or from a project folder before MxScout read them. Replace the model from the Mendix project folder to fill this in — the user roles below come from the model either way.' }),
        userRolesBlock(model)
      ]);
    }
    return el('div', { class: 'sec-panel' }, [
      model.security ? renderLevelWarning(model) : null,
      model.security ? settingsBlock(model) : null,
      userRolesBlock(model),
      moduleRolesBlock(model),
      publishedBlock(model),
      automationBlock(model)
    ].filter(Boolean));
  }

  window.MxSecurity = { init: init, renderPanel: renderPanel, renderLevelWarning: renderLevelWarning };
})();
