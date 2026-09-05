import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuotationsPage } from './QuotationsPage';
import type { QuotationSummary, QuotationsResponse, Workspace } from '../../api';

const draft:QuotationSummary={id:'quote-1',number:'Q-1001',customer:{id:'customer-1',name:'Acme Corp',tier:'Gold'},owner:{id:'rep-1',name:'Priya Shah'},stage:'DRAFT',total:'12400.00',currency:'INR',riskScore:'0',currentApprovalStep:null,currentRevisionId:'revision-1',version:1,lastActivityAt:'2026-09-05T10:00:00.000Z',origin:{type:'PORTAL_REQUEST',portalRequestId:'request-1'}};
const rejected:QuotationSummary={...draft,id:'quote-2',number:'Q-1002',stage:'REJECTED',currentRevisionId:'revision-2'};
const response:QuotationsResponse={items:[draft,rejected],pagination:{total:2,nextCursor:null},stageCounts:{DRAFT:1,PENDING_APPROVAL:0,APPROVED:0,NEGOTIATION:0,CONFIRMED:0,REJECTED:1},owners:[draft.owner],primaryStages:['DRAFT','PENDING_APPROVAL','APPROVED','NEGOTIATION','CONFIRMED']};
const customerResponse={items:[
  {id:'customer-1',name:'Acme Corp',tier:'Gold',currency:'INR',primaryTeam:{id:'team-1',name:'Enterprise Sales'},primaryRepresentative:{id:'rep-1',name:'Priya Shah',assignedAt:'2026-09-01T00:00:00.000Z'},collaborators:[{id:'rep-2',name:'Arun Rao',assignedAt:'2026-09-02T00:00:00.000Z'}],assignmentVersion:2,openQuotationCount:1,lastActivity:'2026-09-05T10:00:00.000Z',openQuotations:[]},
  {id:'customer-2',name:'Unassigned Ltd',tier:'Silver',currency:'INR',primaryTeam:null,primaryRepresentative:null,collaborators:[],assignmentVersion:1,openQuotationCount:0,lastActivity:'2026-09-04T10:00:00.000Z',openQuotations:[]},
]};
const fetchMock=vi.fn();

function json(data:unknown,status=200){return Promise.resolve({ok:status>=200&&status<300,status,json:async()=>({success:status<400,data,error:status>=400?data:undefined})})}
function user(role='REP',viewContext:Workspace['user']['viewContext']=null):Workspace['user']{return{id:'rep-1',name:'Priya Shah',email:'priya@example.com',role,moduleAccess:['quotations'],actorType:'USER',platformSuperAdmin:false,viewContext}}

beforeEach(()=>{
  localStorage.clear(); window.history.replaceState({},'','/app?screen=quotations'); fetchMock.mockReset(); vi.stubGlobal('fetch',fetchMock);
  fetchMock.mockImplementation((url:string,options?:RequestInit)=>{
    if(url.startsWith('/api/v1/customers'))return json(customerResponse);
    if(url==='/api/v1/quotations'&&options?.method==='POST')return json({...draft,id:'quote-new',number:'Q-NEW',currentRevisionId:'revision-new'},201);
    if(url.startsWith('/api/v1/quotations?'))return json(response);
    return json({message:'Not found'},404);
  });
});
afterEach(()=>{cleanup();vi.unstubAllGlobals()});

describe('quotation list',()=>{
  it('renders all five board lanes, counts and authoritative card details',async()=>{
    const openQuote=vi.fn();
    render(<QuotationsPage user={user()} openQuote={openQuote} onCreated={vi.fn()}/>);
    expect(await screen.findByRole('heading',{name:'Draft'})).toBeInTheDocument();
    for(const heading of ['Pending Approval','Approved','Negotiation','Confirmed'])expect(screen.getByRole('heading',{name:heading})).toBeInTheDocument();
    expect(screen.getByText('₹12,400')).toBeInTheDocument(); expect(screen.getAllByText('Priya Shah').length).toBeGreaterThan(0);expect(screen.getByText('Portal request')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Open Q-1001 for Acme Corp'}));
    expect(openQuote).toHaveBeenCalledWith('quote-1','revision-1');
  });

  it('switches to a semantic table and keeps rejected quotations discoverable',async()=>{
    render(<QuotationsPage user={user()} openQuote={vi.fn()} onCreated={vi.fn()}/>);
    await screen.findByRole('button',{name:'Open Q-1001 for Acme Corp'}); fireEvent.click(screen.getByRole('button',{name:/Table/}));
    const table=screen.getByRole('table',{name:'Quotation list'});
    expect(within(table).getByRole('columnheader',{name:'Owner'})).toBeInTheDocument();
    expect(within(table).getByText('Rejected')).toBeInTheDocument();
    expect(localStorage.getItem('dealos.quotationLayout')).toBe('table');
    expect(window.location.search).toContain('quoteLayout=table');
  });

  it('creates from a configured customer and opens the returned exact revision',async()=>{
    const onCreated=vi.fn(async()=>undefined);
    render(<QuotationsPage user={user()} openQuote={vi.fn()} onCreated={onCreated}/>);
    await waitFor(()=>expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/v1/customers'),expect.anything()));
    fireEvent.click(screen.getByRole('button',{name:'New quotation'}));
    const dialog=screen.getByRole('dialog',{name:'New quotation'});
    fireEvent.change(within(dialog).getByLabelText('Customer'),{target:{value:'customer-1'}});
    fireEvent.change(within(dialog).getByLabelText(/Commercial terms/),{target:{value:'Net 30'}});
    fireEvent.click(within(dialog).getByRole('button',{name:/Create draft/}));
    await waitFor(()=>expect(onCreated).toHaveBeenCalledWith('quote-new','revision-new'));
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/quotations',expect.objectContaining({method:'POST',body:expect.stringContaining('"customerId":"customer-1"')}));
  });

  it('marks an unassigned customer unavailable in the quotation dialog',async()=>{
    render(<QuotationsPage user={user()} openQuote={vi.fn()} onCreated={vi.fn()}/>);
    await screen.findByRole('button',{name:'Open Q-1001 for Acme Corp'});fireEvent.click(screen.getByRole('button',{name:'New quotation'}));
    const option=within(screen.getByRole('dialog',{name:'New quotation'})).getByRole('option',{name:/Unassigned Ltd/});
    expect(option).toBeDisabled();
  });

  it('requires managers to explicitly select an assigned owner and disables writes in View As mode',async()=>{
    const {unmount}=render(<QuotationsPage user={user('MANAGER')} openQuote={vi.fn()} onCreated={vi.fn()}/>);
    await screen.findByRole('button',{name:'Open Q-1001 for Acme Corp'}); fireEvent.click(screen.getByRole('button',{name:'New quotation'}));
    const dialog=screen.getByRole('dialog',{name:'New quotation'});fireEvent.change(within(dialog).getByLabelText('Customer'),{target:{value:'customer-1'}});
    expect(within(dialog).getByLabelText('Deal owner')).toHaveValue('rep-1');unmount();
    render(<QuotationsPage user={user('ADMIN',{readOnly:true,organizationId:'org-1',organizationName:'Acme',simulatedUserId:null,realActor:{id:'owner',name:'Platform Owner'}})} openQuote={vi.fn()} onCreated={vi.fn()}/>);
    expect(await screen.findByRole('button',{name:'New quotation'})).toBeDisabled();
    expect(screen.getByText(/read-only mode/)).toBeInTheDocument();
  });
});
