import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Customer } from '../../api';
import { CustomerAssignmentDialog } from './CustomerAssignmentDialog';
import { CustomerRelationshipCard } from './CustomerRelationshipCard';

const customer:Customer={id:'customer-1',name:'Acme Corp',tier:'Gold',currency:'INR',customerType:'Business / Company',region:'India',countryCode:'+91',paymentTerms:30,active:true,createdAt:'2026-09-01T00:00:00.000Z',updatedAt:'2026-09-05T00:00:00.000Z',primaryTeam:{id:'team-1',name:'Enterprise'},primaryRepresentative:{id:'rep-1',name:'Priya',assignedAt:'2026-09-01T00:00:00.000Z'},collaborators:[],assignmentVersion:3,openQuotationCount:2,quotes:[{id:'quote-1',number:'Q-1',stage:'DRAFT',total:'0',version:2,ownerId:'rep-1',updatedAt:'2026-09-05T00:00:00.000Z'},{id:'quote-2',number:'Q-2',stage:'APPROVED',total:'10',version:4,ownerId:'rep-1',updatedAt:'2026-09-04T00:00:00.000Z'}]};
const teams={items:[{id:'team-1',name:'Enterprise',managerId:'manager-1',representatives:[{id:'rep-1',name:'Priya'}]},{id:'team-2',name:'Growth',managerId:'manager-1',representatives:[{id:'rep-2',name:'Arun'},{id:'rep-3',name:'Mina'}]}]};
const fetchMock=vi.fn();
const json=(data:unknown)=>Promise.resolve({ok:true,status:200,json:async()=>({success:true,data})});

beforeEach(()=>{fetchMock.mockReset();fetchMock.mockImplementation((url:string)=>url.endsWith('/sales-teams')?json(teams):json({}));vi.stubGlobal('fetch',fetchMock)});
afterEach(()=>{cleanup();vi.unstubAllGlobals()});

describe('customer assignment interface',()=>{
  it('filters representative choices when the team changes and requires a reason',async()=>{
    render(<CustomerAssignmentDialog customer={customer} close={vi.fn()} onChanged={vi.fn(async()=>undefined)}/>);
    const dialog=await screen.findByRole('dialog',{name:'Change account assignment'});
    fireEvent.change(within(dialog).getByLabelText('Primary sales team'),{target:{value:'team-2'}});
    const representative=within(dialog).getByLabelText('Primary representative');
    expect(within(representative).queryByRole('option',{name:'Priya'})).not.toBeInTheDocument();
    expect(within(representative).getByRole('option',{name:'Arun'})).toBeInTheDocument();
    fireEvent.change(representative,{target:{value:'rep-2'}});const save=within(dialog).getByRole('button',{name:/Save assignment/});
    expect(save).toBeDisabled();fireEvent.change(within(dialog).getByLabelText('Reason for reassignment'),{target:{value:'Territory ownership changed'}});expect(save).toBeEnabled();
  });

  it('shows open quotations as explicit opt-ins and freezes approved deals',async()=>{
    render(<CustomerAssignmentDialog customer={customer} close={vi.fn()} onChanged={vi.fn(async()=>undefined)}/>);
    const dialog=await screen.findByRole('dialog',{name:'Change account assignment'});
    expect(within(dialog).getByText('Q-1')).toBeInTheDocument();
    const frozen=within(dialog).getByText('Q-2').closest('label')!;
    expect(within(frozen).getByRole('checkbox')).toBeDisabled();
  });

  it('warns when a customer has no primary assignment',()=>{
    render(<CustomerRelationshipCard customer={{...customer,primaryTeam:null,primaryRepresentative:null}} canChange onChanged={vi.fn(async()=>undefined)}/>);
    expect(screen.getByText('Assignment required')).toBeInTheDocument();
    expect(screen.getByText(/cannot be selected by a representative/)).toBeInTheDocument();
  });
});
