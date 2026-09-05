import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalDetailPage, ApprovalsPage } from './ApprovalsPage';

const step=(name:string,state:string)=>({id:`step-${name}`,name,sequence:name==='Finance'?2:1,state,reviewer:null,reason:null,decidedAt:null,createdAt:'2026-09-06T00:00:00.000Z'});
const approvalCase={id:'case-1',version:3,state:'PENDING',route:'MANAGER_FINANCE',revisionId:'revision-123456',policyId:'policy-1',createdAt:'2026-09-06T00:00:00.000Z',completedAt:null,quotation:{id:'quote-1',number:'Q-1001',customer:'Acme Corp',customerTier:'Gold',total:'1180',currency:'INR',owner:{id:'rep-1',name:'Aarav'},team:{id:'team-1',name:'Enterprise'}},submittedBy:{id:'rep-1',name:'Aarav'},currentStep:step('Sales Manager','PENDING'),managerStep:step('Sales Manager','PENDING'),financeStep:step('Finance','WAITING'),risk:{components:{worstExcess:8,weightedExcess:2,aggregateDiscount:18,marginPercent:10},flags:[{scope:'LINE',code:'LINE_DISCOUNT_EXCESS',message:'Service exceeds its ceiling.',productId:'product-1',actual:8,threshold:0}],reasons:['Any customer discount requires Sales Manager review.','Finance review follows Sales Manager approval.'],policy:{version:4}},lines:[{id:'line-1',productId:'product-1',product:'Setup service',category:'Services',quantity:1,discount:'18',allowedDiscount:'10'}],steps:[step('Sales Manager','PENDING'),step('Finance','WAITING')],audit:[{id:'audit-1',action:'QUOTE_SUBMITTED',reason:'Ready for review',actor:{id:'rep-1',name:'Aarav'},createdAt:'2026-09-06T00:00:00.000Z'}]};
const fetchMock=vi.fn();
const json=(data:unknown,status=200)=>Promise.resolve({ok:status<400,status,json:async()=>({success:status<400,data,error:status>=400?data:undefined})});

beforeEach(()=>{fetchMock.mockReset();vi.stubGlobal('fetch',fetchMock)});
afterEach(()=>{cleanup();vi.unstubAllGlobals()});

describe('approval governance screens',()=>{
  it('loads each scoped queue tab from the approval API',async()=>{
    fetchMock.mockImplementation(()=>json({items:[approvalCase]}));const open=vi.fn();render(<ApprovalsPage onOpenCase={open}/>);
    expect(await screen.findByText('Q-1001')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Returned'}));
    await waitFor(()=>expect(fetchMock).toHaveBeenCalledWith('/api/v1/approvals?state=RETURNED',expect.anything()));
    fireEvent.click(screen.getByRole('button',{name:/Open/}));expect(open).toHaveBeenCalledWith('case-1');
  });

  it('shows ordered Manager/Finance steps and requires a reason for a versioned decision',async()=>{
    fetchMock.mockImplementation((url:string,options?:RequestInit)=>url==='/api/v1/approvals/case-1'&&(!options?.method||options.method==='GET')?json(approvalCase):json({...approvalCase,version:4}));
    render(<ApprovalDetailPage caseId="case-1" role="MANAGER" onBack={vi.fn()} onChanged={vi.fn(async()=>undefined)}/>);
    expect(await screen.findByText('Ordered review')).toBeInTheDocument();expect(screen.getAllByText('Sales Manager').length).toBeGreaterThan(0);expect(screen.getAllByText('Finance').length).toBeGreaterThan(0);
    const returnButton=screen.getByRole('button',{name:/Return for revision/});expect(returnButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Required reason'),{target:{value:'Please revise the service discount.'}});fireEvent.click(returnButton);
    await waitFor(()=>expect(fetchMock).toHaveBeenCalledWith('/api/v1/approvals/case-1/decision',expect.objectContaining({method:'POST'})));
    const body=JSON.parse(String(fetchMock.mock.calls.find((call)=>call[0].endsWith('/decision'))?.[1]?.body));expect(body).toMatchObject({expectedVersion:3,decision:'RETURN'});
  });

  it('does not render an empty Finance step for a Manager-only route',async()=>{
    fetchMock.mockImplementation(()=>json({...approvalCase,route:'MANAGER',financeStep:undefined,steps:[step('Sales Manager','PENDING')]}));render(<ApprovalDetailPage caseId="case-1" role="MANAGER" onBack={vi.fn()} onChanged={vi.fn()}/>);
    expect(await screen.findByText('Ordered review')).toBeInTheDocument();expect(screen.queryByText('Finance')).not.toBeInTheDocument();
  });
});
