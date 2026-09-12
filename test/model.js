/* One small model, shared by the browser tests. Small on purpose: every field
 * here exists because some assertion reads it. */
module.exports = {
  // Says this model was built by a reader that worked out what calls what.
  // Without it an empty calledBy means "nobody looked", and the UI has to say
  // that instead of "nothing reaches this".
  meta: { source: 'mpr', knowsCallSites: true },
  modules: [{ name: 'Sales' }, { name: 'Admin' }],
  // Production security, no anonymous access: the case that needs no banner,
  // so every other test's screen text stays what it was. The Prototype and
  // Off cases — and the anonymous role — get their own model inside
  // test/29-security.test.js rather than being forced on every other test.
  security: {
    level: 'CheckEverything',
    checkSecurity: true,
    strictMode: false,
    strictPageUrlCheck: true,
    guestAccess: false,
    guestUserRole: null,
    demoUsersEnabled: true,
    demoUsers: [{ userName: 'demo_agent', userRoles: ['Agent'], passwordSet: true }],
    adminUserName: 'MxAdmin',
    adminUserRole: 'Agent',
    adminPasswordSet: true,
    passwordPolicy: { minimumLength: 8, requireDigit: true, requireMixedCase: false, requireSymbol: false }
  },
  userRoles: [
    { name: 'Agent', moduleRoles: ['Sales.Agent'], manageAllRoles: true, manageableRoles: [] },
    { name: 'Viewer', moduleRoles: ['Sales.Viewer'], manageAllRoles: false, manageableRoles: [] }
  ],
  // Sales.Archivist is declared by the module and held by nobody — the case
  // only a module's own role list can show, since no rule mentions it.
  moduleRoles: [
    { module: 'Sales', name: 'Agent', qualifiedName: 'Sales.Agent', description: 'Handles orders.' },
    { module: 'Sales', name: 'Viewer', qualifiedName: 'Sales.Viewer', description: null },
    { module: 'Sales', name: 'Archivist', qualifiedName: 'Sales.Archivist', description: 'Left over from the old archive screen.' }
  ],
  // Read from the enumeration document, so an enumeration attribute can show
  // what it may hold instead of only which enumeration it is.
  enumerations: [{
    module: 'Sales', name: 'Priority', qualifiedName: 'Sales.Priority',
    values: [{ name: 'low', caption: 'Low' }, { name: 'high', caption: 'Rather urgent' }]
  }, {
    // Deliberately does NOT declare wf_archived, which the fake app returns:
    // a key the model has never heard of must show as itself.
    module: 'Sales', name: 'Status', qualifiedName: 'Sales.Status',
    values: [
      { name: 'wf_in_progress', caption: 'In progress' },
      { name: 'wf_done', caption: 'Done' }
    ]
  }],
  // Two things no role filter can answer: what the app publishes, and what
  // runs on a timer with nobody signed in.
  publishedServices: [
    {
      kind: 'REST', module: 'Sales', name: 'orders', qualifiedName: 'Sales.orders',
      path: 'orders/', version: '1.0.0',
      allowedModuleRoles: ['Sales.Agent'], authentication: ['Basic'],
      authenticationMicroflow: null, exposes: ['POST order → Sales.CancelOrder']
    },
    {
      // Nothing gates it — a real shape, and a deliberate one for an OIDC
      // callback, which is why it is shown rather than flagged as a fault.
      kind: 'REST', module: 'Sales', name: 'discovery', qualifiedName: 'Sales.discovery',
      path: 'sso/', version: null,
      allowedModuleRoles: [], authentication: [], authenticationMicroflow: null, exposes: []
    }
  ],
  automation: [
    {
      kind: 'scheduled event', module: 'Sales', name: 'NightlyTotals',
      qualifiedName: 'Sales.NightlyTotals', enabled: true,
      microflow: 'Sales.RecalculateTotals', schedule: 'every day', timeZone: 'UTC', parallelism: null
    },
    {
      kind: 'queue', module: 'Sales', name: 'Task', qualifiedName: 'Sales.Task',
      enabled: false, microflow: null, schedule: null, timeZone: null, parallelism: '5'
    }
  ],
  entities: [{
    qualifiedName: 'Admin.Setting', name: 'Setting', module: 'Admin',
    attributes: [{ name: 'Key', type: 'String', length: 50 }, { name: 'Value', type: 'String', length: 200 }],
    accessRules: []
  }, {
    qualifiedName: 'Sales.Order', name: 'Order', module: 'Sales',
    attributes: [
      { name: 'Number', type: 'String', length: 20 },
      { name: 'Customer', type: 'String', length: 100 },
      { name: 'Total', type: 'Decimal' },
      // An enumeration attribute: the app answers with the stored key, and
      // the Data tab has to show the caption while keeping the key reachable.
      { name: 'Status', type: 'Enumeration', enumerationQualifiedName: 'Sales.Status' }
    ],
    // An association is a member of the entity exactly as an attribute is, and
    // the rule grants access on it the same way — so Order_Setting is written,
    // Order_Note is explicitly denied, and the popup's matrix has to show both
    // as rows of its own.
    // Two rules for ONE role, which is normal — a role gets one rule per
    // constraint. Here they are also the two cases the "check against the
    // app" button exists to tell apart: the first is the ordinary "their own
    // rows" idiom and the fake app matches a real subset for it; the second
    // reaches a user role through System, which MxScout cannot follow, and
    // the fake app matches nothing.
    accessRules: [{
      moduleRole: 'Sales.Agent',
      attrAccess: { Number: 'r', Customer: 'rw' },
      assocAccess: { Order_Setting: 'rw', Order_Note: 'none' },
      allowCreate: true, allowDelete: false,
      xpathConstraint: "[System.owner = '[%CurrentUser%]']"
    }, {
      moduleRole: 'Sales.Agent',
      attrAccess: { Number: 'r' }, assocAccess: {},
      allowCreate: false, allowDelete: false,
      xpathConstraint: "[System.owner/System.UserRoles/System.UserRole/Name = 'Administrator']"
    }]
  }, {
    // Three row-level rules, one per case the constraint checker has to tell
    // apart. The FIRST is the important one: [System.owner='[%CurrentUser%]']
    // is the standard Mendix idiom for "their own rows" and was 28 of the 28
    // System-touching rules measured across three real projects, so it must
    // stay silent. The second goes through System and keeps going, which
    // nothing here can follow. The third names an association that does not
    // exist in the model at all.
    qualifiedName: 'Sales.AuditEntry', name: 'AuditEntry', module: 'Sales',
    attributes: [{ name: 'What', type: 'String', length: 100 }],
    accessRules: [
      {
        moduleRole: 'Sales.Agent', attrAccess: { What: 'r' }, assocAccess: {},
        allowCreate: false, allowDelete: false,
        xpathConstraint: "[System.owner='[%CurrentUser%]']"
      },
      {
        moduleRole: 'Sales.Viewer', attrAccess: { What: 'r' }, assocAccess: {},
        allowCreate: false, allowDelete: false,
        xpathConstraint: "[System.owner/System.UserRoles/System.UserRole/Name = 'Administrator']"
      },
      {
        moduleRole: 'Sales.Archivist', attrAccess: { What: 'r' }, assocAccess: {},
        allowCreate: false, allowDelete: false,
        xpathConstraint: "[Sales.AuditEntry_Gone/Sales.Nowhere/Id = '1']"
      }
    ]
  }, {
    // Non-persistable: the Data tab has to offer lookup-by-id and create,
    // not the xpath-query table Sales.Order gets. One settable attribute of
    // each kind the create form actually supports, plus one it does not
    // (Enum), to check the "not settable here yet" path too.
    qualifiedName: 'Sales.TempNote', name: 'TempNote', module: 'Sales', persistable: false,
    attributes: [
      { name: 'Text', type: 'String', length: 200 },
      { name: 'Urgent', type: 'Boolean' },
      { name: 'Priority', type: 'Enum', enumerationQualifiedName: 'Sales.Priority' }
    ],
    accessRules: [{
      moduleRole: 'Sales.Agent',
      attrAccess: { Text: 'rw', Urgent: 'rw' }, assocAccess: {},
      allowCreate: true, allowDelete: false,
      xpathConstraint: null
    }]
  }],
  // Two owned by Sales.Order (one written, one denied) and one owned by the
  // OTHER end — the incoming one must stay out of Sales.Order's member matrix,
  // since this entity's rules say nothing about it.
  associations: [
    { name: 'Order_Setting', module: 'Sales', owner: 'Sales.Order', other: 'Admin.Setting', type: 'Reference' },
    { name: 'Order_Note', module: 'Sales', owner: 'Sales.Order', other: 'Sales.TempNote', type: 'Reference' },
    { name: 'Setting_Order', module: 'Admin', owner: 'Admin.Setting', other: 'Sales.Order', type: 'Reference' }
  ],
  microflows: [
    {
      qualifiedName: 'Sales.CancelOrder', name: 'CancelOrder', module: 'Sales',
      allowedModuleRoles: ['Sales.Agent'],
      parameters: [{ name: 'Order', type: 'Object', entityQualifiedName: 'Sales.Order' }],
      // What it does, read from its body — the flow the Run tab has to warn
      // about before the button, since this one deletes and calls out.
      activity: {
        count: 6, loops: 1,
        reads: ['Sales.Order'], creates: [], changes: ['Sales.Order'],
        deletes: ['Sales.TempNote'], commits: ['Sales.Order'],
        commitCount: 1, deleteCount: 1, rollbackCount: 0,
        calls: ['Sales.RecalculateTotals'], javaActions: ['Sales.SendMail'], jsActions: [],
        restCalls: 1, opensPages: [], messages: 1, validations: 0, logs: 0,
        inLoop: { reads: 1, creates: 0, changes: 0, deletes: 0, commits: 1 }
      }
    },
    // No role AND nothing in the model naming it: the genuinely unreachable
    // case, which the card has to tell apart from "nobody has looked".
    {
      qualifiedName: 'Sales.OrphanSweep', name: 'OrphanSweep', module: 'Sales',
      allowedModuleRoles: [], parameters: [], calledBy: []
    },
    // No allowedModuleRoles and no parameters: the "called from other logic"
    // case, which the Run tab has to warn about rather than pretend about —
    // and now name the two things that actually reach it.
    {
      qualifiedName: 'Sales.RecalculateTotals', name: 'RecalculateTotals', module: 'Sales',
      allowedModuleRoles: [], parameters: [],
      // No role can set it off, but two things in the model do: one of them
      // is a flow MxScout can open, the other a scheduled event it cannot.
      calledBy: [
        { kind: 'microflow', name: 'Sales.CancelOrder' },
        { kind: 'scheduled event', name: 'Sales.NightlyTotals' }
      ],
      // A read-only flow: the case that must NOT be marked on the card, so
      // that a marked card means something.
      activity: {
        count: 2, loops: 0,
        reads: ['Sales.Order'], creates: [], changes: [], deletes: [], commits: [],
        commitCount: 0, deleteCount: 0, rollbackCount: 0,
        calls: [], javaActions: [], jsActions: [],
        restCalls: 0, opensPages: [], messages: 0, validations: 0, logs: 0,
        inLoop: { reads: 0, creates: 0, changes: 0, deletes: 0, commits: 0 }
      }
    },
    // A List-typed parameter: the multi-select picker, not the single-pick one.
    {
      qualifiedName: 'Sales.BulkCancel', name: 'BulkCancel', module: 'Sales',
      allowedModuleRoles: ['Sales.Agent'],
      parameters: [{ name: 'Orders', type: 'List', entityQualifiedName: 'Sales.Order', isList: true }]
    },
    // Plain-value inputs only — one of each shape the Run tab renders
    // differently (text box, number box, true/false select).
    {
      qualifiedName: 'Sales.SendNotice', name: 'SendNotice', module: 'Sales',
      allowedModuleRoles: ['Sales.Agent'],
      parameters: [
        { name: 'Subject', type: 'String', entityQualifiedName: null },
        { name: 'Copies', type: 'Integer', entityQualifiedName: null },
        { name: 'Urgent', type: 'Boolean', entityQualifiedName: null }
      ]
    },
    // Two OBJECT parameters of different entities — the case a flat guids
    // selection cannot carry (Mendix maps at most one guid per entity type and
    // discards the rest). Drives the MxContext path, and the regression test
    // that both objects actually reach the flow instead of arriving empty.
    {
      qualifiedName: 'Sales.MoveSetting', name: 'MoveSetting', module: 'Sales',
      allowedModuleRoles: ['Sales.Agent'],
      parameters: [
        { name: 'Order', type: 'Object', entityQualifiedName: 'Sales.Order' },
        { name: 'Config', type: 'Object', entityQualifiedName: 'Admin.Setting' }
      ]
    }
  ],
  nanoflows: [],
  // A page is browsable but never runnable: MxScout does not open pages in the
  // app tab, so its popup must show the signature and nothing that sets it off.
  pages: [
    {
      qualifiedName: 'Sales.Order_Overview', name: 'Order_Overview', module: 'Sales',
      allowedModuleRoles: ['Sales.Agent'],
      parameters: [{ name: 'Order', type: 'Object', entityQualifiedName: 'Sales.Order' }]
    }
  ]
};
