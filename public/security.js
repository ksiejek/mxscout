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
 * SECRETS: this renders that a password is set, never what it is. The model
 * carries the admin password and every demo user's password in plain text;
 * MxScout's reader deliberately drops the values before they reach a model
 * (see readProjectSecurity in mpr.js), so there is nothing here to leak into
 * a .mxscout package, and nothing to print into a report. The fact that a
 * password lives in the model in plain text is itself the finding worth
 * having, and that survives.
 *
 * Model shape read here, all of it optional — a model exported from MxSonar,
 * or imported before this existed, simply has none of it and says so rather
 * than claiming the app is unsecured:
 *   model.security     = { level, checkSecurity, strictMode, strictPageUrlCheck,
 *                          guestAccess, guestUserRole, demoUsersEnabled,
 *                          demoUsers[], adminUserName, adminUserRole,
 *                          adminPasswordSet, passwordPolicy }
 *   model.userRoles[]  = { name, moduleRoles[], manageAllRoles, manageableRoles[] }
 *   model.moduleRoles[]= { module, name, qualifiedName, description }
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
    rows.push(row('Administrator',
      adminBits.length ? el('span', { text: adminBits.join(' · ') }) : el('span', { class: 'muted', text: 'not recorded' }),
      s.adminPasswordSet ? 'Its password is stored in the project file in plain text. MxScout does not read the value.' : null));

    var demo = s.demoUsers || [];
    rows.push(row('Demo users',
      onOff(s.demoUsersEnabled, 'On', 'Off'),
      demo.length
        ? demo.length + ' account' + (demo.length === 1 ? '' : 's') + ' in the model' +
          (demo.some(function (u) { return u.passwordSet; }) ? ', with passwords in plain text.' : '.')
        : (s.demoUsersEnabled ? 'Switched on, but no accounts are defined.' : null)));

    var kids = [el('div', { class: 'kv' }, rows)];
    if (demo.length) {
      kids.push(el('div', { class: 'sec-sub' }, [
        el('h4', { text: 'Demo accounts' }),
        el('p', { class: 'hint', text: 'Names and roles as the project records them. MxScout does not carry their passwords — not into this browser, not into a package, not into a report.' }),
        el('table', { class: 'sec-table' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { text: 'User name' }), el('th', { text: 'Roles' }), el('th', { text: 'Password' })
          ])]),
          el('tbody', {}, demo.map(function (u) {
            return el('tr', {}, [
              el('td', { text: u.userName }),
              el('td', { text: (u.userRoles || []).join(', ') || '—' }),
              el('td', {}, [u.passwordSet
                ? el('span', { class: 'sec-off', text: 'set, in plain text' })
                : el('span', { class: 'muted', text: 'none' })])
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

  // ---------- the section ----------
  function renderPanel(model) {
    if (!model.security && !(model.moduleRoles || []).length) {
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
      moduleRolesBlock(model)
    ].filter(Boolean));
  }

  window.MxSecurity = { init: init, renderPanel: renderPanel, renderLevelWarning: renderLevelWarning };
})();
