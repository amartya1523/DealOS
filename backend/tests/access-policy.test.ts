import { describe, expect, it } from 'vitest';
import { hasModuleAccess, roleModulePresets, workspaceDataAccess } from '../src/access-policy.js';

describe('workspace module isolation',()=>{
  it('uses least-privilege defaults for each provisioned business role',()=>{
    expect(roleModulePresets.REP).toEqual(['dashboard','quotations','health']);
    expect(roleModulePresets.MANAGER).toEqual(['dashboard','quotations','approvals','health','reports','customers','policies']);
    expect(roleModulePresets.FINANCE).toEqual(['dashboard','approvals','fulfillment','invoices','reports']);
  });

  it('does not treat an unassigned module as accessible',()=>{
    const rep={role:'REP',moduleAccess:['dashboard','quotations','health']};
    expect(hasModuleAccess(rep,'quotations')).toBe(true);
    expect(hasModuleAccess(rep,'invoices')).toBe(false);
    expect(hasModuleAccess(rep,'products')).toBe(false);
  });

  it('omits unrelated workspace datasets for a representative',()=>{
    expect(workspaceDataAccess({role:'REP',moduleAccess:['dashboard','quotations','health']})).toEqual({
      quotes:true,
      customers:false,
      products:false,
      policies:false,
      warehouses:false,
      subscriptions:false,
      invoices:false,
      alerts:true,
      audits:true,
    });
  });

  it('returns no business datasets when a member has no modules',()=>{
    expect(workspaceDataAccess({role:'REP',moduleAccess:[]})).toEqual({
      quotes:false,
      customers:false,
      products:false,
      policies:false,
      warehouses:false,
      subscriptions:false,
      invoices:false,
      alerts:false,
      audits:false,
    });
  });
});
