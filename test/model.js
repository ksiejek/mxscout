/* One small model, shared by the browser tests. Small on purpose: every field
 * here exists because some assertion reads it. */
module.exports = {
  modules: [{ name: 'Sales' }, { name: 'Admin' }],
  userRoles: [{ name: 'Agent', moduleRoles: ['Sales.Agent'] }, { name: 'Viewer', moduleRoles: ['Sales.Viewer'] }],
  entities: [{
    qualifiedName: 'Admin.Setting', name: 'Setting', module: 'Admin',
    attributes: [{ name: 'Key', type: 'String', length: 50 }, { name: 'Value', type: 'String', length: 200 }],
    accessRules: []
  }, {
    qualifiedName: 'Sales.Order', name: 'Order', module: 'Sales',
    attributes: [
      { name: 'Number', type: 'String', length: 20 },
      { name: 'Customer', type: 'String', length: 100 },
      { name: 'Total', type: 'Decimal' }
    ],
    // An association is a member of the entity exactly as an attribute is, and
    // the rule grants access on it the same way — so Order_Setting is written,
    // Order_Note is explicitly denied, and the popup's matrix has to show both
    // as rows of its own.
    accessRules: [{
      moduleRole: 'Sales.Agent',
      attrAccess: { Number: 'r', Customer: 'rw' },
      assocAccess: { Order_Setting: 'rw', Order_Note: 'none' },
      allowCreate: true, allowDelete: false,
      xpathConstraint: "[Owner = '[%CurrentUser%]']"
    }]
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
      parameters: [{ name: 'Order', type: 'Object', entityQualifiedName: 'Sales.Order' }]
    },
    // No allowedModuleRoles and no parameters: the "called from other logic"
    // case, which the Run tab has to warn about rather than pretend about.
    {
      qualifiedName: 'Sales.RecalculateTotals', name: 'RecalculateTotals', module: 'Sales',
      allowedModuleRoles: [], parameters: []
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
