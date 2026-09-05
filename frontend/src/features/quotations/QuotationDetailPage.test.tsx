import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuotationDetailPage } from './QuotationDetailPage';
import type { QuotationDetail } from '../../api';

const detail:QuotationDetail={
  id:'quote-1',number:'Q-1001',customer:{id:'customer-1',name:'Acme Corp',tier:'Gold'},owner:{id:'rep-1',name:'Priya Shah'},team:{id:'team-1',name:'Enterprise Sales'},stage:'DRAFT',subtotal:'40',total:'40',currency:'INR',riskScore:'0',currentApprovalStep:null,currentRevisionId:'revision-1',version:1,lastActivityAt:'2026-09-05T10:00:00.000Z',sentAt:null,orderDiscount:'0',taxTotal:'0',margin:'28',totalsByCadence:{Monthly:{subtotal:40,tax:0,total:40,margin:28}},
  capabilities:{editDraft:true,saveDraft:true,submit:true,assign:false,approve:false,send:false,previewCustomer:true,downloadPdf:true,viewCost:false,viewMargin:true,viewActivity:true,reasons:{approve:'There is no active approval step.'}},
  currentRevision:{id:'revision-1',revisionNumber:1,state:'DRAFT',currency:'INR',validUntil:null,promisedDeliveryAt:null,terms:'Net 30',submittedBy:null},
  lines:[{id:'line-1',productId:'product-1',quantity:1,unitPrice:'40',discount:'5',allowedDiscount:'10',product:{id:'product-1',name:'Care Plan',sku:'SUB-CARE',category:'Subscriptions',description:'Support',unit:'Seat',price:'40',taxRate:'18',recurring:true,cadence:'Monthly',active:true}}],
  approval:{caseId:null,caseVersion:null,route:'NONE',state:null,explanation:'All persisted lines are within their line-level discount limits.',riskBreakdown:{worstExcess:0,weightedExcess:0,aggregateDiscount:0,riskByCadence:{},orderDiscount:0,marginPercent:70,financeThreshold:5,minimumMarginPercent:12,policyVersion:1,policyTier:'Gold',managerReason:'Manager approval was not required.',financeReason:'Finance approval was not required.',cards:[{key:'worst-line-excess',label:'Worst individual line excess',value:'0 pts',detail:'No individual line exceeds its policy limit.',tone:'ok'},{key:'weighted-excess',label:'Value-weighted excess',value:'0 pts',detail:'Weighted by each line gross value so larger lines influence routing more.',tone:'ok'},{key:'order-discount',label:'Order discount',value:'0%',detail:'Applied across the order after line discounts.',tone:'ok'},{key:'margin-percentage',label:'Margin percentage',value:'70%',detail:'Minimum margin floor is 12%.',tone:'ok'},{key:'approval-threshold',label:'Approval threshold and policy version',value:'5 pts / v1',detail:'Gold tier policy used for this revision.',tone:'neutral'},{key:'required-review',label:'Exact required review reason',value:'None',detail:'No manager or finance approval is required for this revision.',tone:'ok'}]},violations:[],currentStep:null,timeline:[]},revisions:[],activity:[],assignmentOptions:{teams:[],owners:[]},catalog:[{id:'product-1',name:'Care Plan',sku:'SUB-CARE',category:'Subscriptions',description:'Support',unit:'Seat',price:'40',taxRate:'18',recurring:true,cadence:'Monthly',active:true}],addOns:[],negotiation:[],order:null,invoices:[],
};
const fetchMock=vi.fn();
function json(data:unknown,status=200){return Promise.resolve({ok:status>=200&&status<300,status,json:async()=>({success:status<400,data,error:status>=400?data:undefined})})}

beforeEach(()=>{fetchMock.mockReset();vi.stubGlobal('fetch',fetchMock);fetchMock.mockImplementation((url:string,options?:RequestInit)=>{
  if(url==='/api/v1/quotations/quote-1'&&(!options?.method||options.method==='GET'))return json(detail);
  if(url==='/api/v1/quotations/quote-1/draft'&&options?.method==='PUT')return json({quote:{...detail,version:2}});
  if(url==='/api/v1/quotations/quote-1/submit'&&options?.method==='POST')return json({stage:'PENDING_APPROVAL'});
  if(url==='/api/v1/quotations/quote-1/preview')return json({total:38,subtotal:38,taxTotal:0,margin:26,riskScore:0,totalsByCadence:{Monthly:{subtotal:38,tax:0,total:38,margin:26}},lines:[{productId:'product-1',net:38,allowedDiscount:'10',excess:0}]});
  return json({message:'Not found'},404);
})});
afterEach(()=>{cleanup();vi.unstubAllGlobals()});

describe('quotation detail lifecycle',()=>{
  it('requires an explicit save before submitting the immutable draft snapshot',async()=>{
    const onChanged=vi.fn(async()=>undefined);render(<QuotationDetailPage quoteId="quote-1" onBack={vi.fn()} onChanged={onChanged}/>);
    fireEvent.change(await screen.findByLabelText('Care Plan discount'),{target:{value:'7'}});
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(screen.getByRole('button',{name:/Save before submitting/})).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:/Save draft/}));
    await waitFor(()=>expect(fetchMock).toHaveBeenCalledWith('/api/v1/quotations/quote-1/draft',expect.objectContaining({method:'PUT'})));
    fireEvent.click(await screen.findByRole('button',{name:/Submit for approval/}));
    await waitFor(()=>expect(fetchMock).toHaveBeenCalledWith('/api/v1/quotations/quote-1/submit',expect.objectContaining({method:'POST'})));
    const mutationUrls=fetchMock.mock.calls.filter((call)=>call[1]?.method&&call[1].method!=='GET').map((call)=>call[0]);
    expect(mutationUrls.filter((url)=>url.endsWith('/draft')||url.endsWith('/submit')).slice(0,2)).toEqual(['/api/v1/quotations/quote-1/draft','/api/v1/quotations/quote-1/submit']);
    expect(JSON.parse(String(fetchMock.mock.calls.find((call)=>call[0].endsWith('/draft'))?.[1]?.body))).toMatchObject({lines:[{discount:7}]});
  });

  it('renders server capabilities instead of inferring write access from the stage',async()=>{
    fetchMock.mockImplementation((url:string)=>url==='/api/v1/quotations/quote-1'?json({...detail,capabilities:{...detail.capabilities,editDraft:false,saveDraft:false,submit:false,reasons:{editDraft:'Only the owner can edit.'}}}):json({message:'Not found'},404));
    render(<QuotationDetailPage quoteId="quote-1" onBack={vi.fn()} onChanged={vi.fn()}/>);
    expect(await screen.findByLabelText('Care Plan discount')).toBeDisabled();
    expect(screen.queryByRole('button',{name:/Submit for approval/})).not.toBeInTheDocument();
    expect(screen.getByText('This submitted revision is read-only.')).toBeInTheDocument();
  });

  it('explains teammate read-only access and shows account ownership facts',async()=>{
    fetchMock.mockImplementation((url:string)=>url==='/api/v1/quotations/quote-1'?json({...detail,createdBy:{id:'manager-1',name:'Maya Manager'},viewerAccess:{accountRole:'COLLABORATOR',readOnlyTeamView:true},capabilities:{...detail.capabilities,editDraft:false,saveDraft:false,submit:false,reasons:{editDraft:'Only the deal owner can edit.'}}}):json({message:'Not found'},404));
    render(<QuotationDetailPage quoteId="quote-1" onBack={vi.fn()} onChanged={vi.fn()}/>);
    expect(await screen.findByText('You can inspect this team quotation. Only the deal owner can edit or submit it.')).toBeInTheDocument();
    expect(screen.getByText('Account team').closest('span')).toHaveTextContent('Enterprise Sales');
    expect(screen.getByText('Deal owner').closest('span')).toHaveTextContent('Priya Shah');
    expect(screen.getByText('Account role').closest('span')).toHaveTextContent('Collaborator');
    expect(screen.getByText('Created by').closest('span')).toHaveTextContent('Maya Manager');
    expect(screen.queryByRole('button',{name:/Submit for approval/})).not.toBeInTheDocument();
  });
});
