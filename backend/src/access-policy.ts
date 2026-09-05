export const workspaceModules = ['dashboard','quotations','approvals','fulfillment','subscriptions','invoices','health','reports','products','customers','policies'] as const;
export type WorkspaceModule = typeof workspaceModules[number];

export const provisionableRoles = ['REP','MANAGER','FINANCE'] as const;
export type ProvisionableRole = typeof provisionableRoles[number];

export const roleModulePresets:Record<ProvisionableRole,WorkspaceModule[]>={
  REP:['dashboard','quotations','health'],
  MANAGER:['dashboard','quotations','approvals','health','reports','customers','policies'],
  FINANCE:['dashboard','approvals','fulfillment','invoices','reports'],
};

type ModuleActor={role:string;moduleAccess:readonly string[]};

export const hasModuleAccess=(actor:ModuleActor|undefined,module:WorkspaceModule)=>Boolean(actor&&(actor.role==='ADMIN'||actor.moduleAccess.includes(module)));

export function workspaceDataAccess(actor:ModuleActor){
  const portal=actor.role==='CUSTOMER';
  const has=(module:WorkspaceModule)=>hasModuleAccess(actor,module);
  return {
    quotes:portal||(['quotations','approvals','fulfillment','invoices','health','reports'] as WorkspaceModule[]).some(has),
    customers:!portal&&(has('customers')||has('invoices')),
    products:!portal&&(has('products')||has('invoices')||has('fulfillment')),
    policies:!portal&&has('policies'),
    warehouses:!portal&&has('fulfillment'),
    subscriptions:!portal&&actor.role==='ADMIN',
    invoices:portal||has('invoices'),
    alerts:!portal&&has('health'),
    audits:!portal&&(has('reports')||has('health')),
  };
}
