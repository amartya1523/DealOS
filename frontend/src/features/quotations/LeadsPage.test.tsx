import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeadsPage } from './LeadsPage';

const lead={id:'lead-1',status:'NEW' as const,requirementsSummary:'Need an unavailable catalog model',dismissReason:null,customer:{id:'customer-1',name:'Buyer Ltd'},team:{id:'team-1',name:'Enterprise'},assignedRep:{id:'rep-1',name:'Priya'},request:{id:'request-1',requirementsText:'Need an unavailable catalog model',preferredDeliveryDate:null,status:'NEW',createdAt:'2026-09-06T00:00:00.000Z',lines:[{id:'line-1',product:null,freeTextDescription:'Legacy model',quantity:'2',degraded:true,degradedReason:'PRODUCT_UNAVAILABLE'}]},convertedQuotation:null,createdAt:'2026-09-06T00:00:00.000Z',updatedAt:'2026-09-06T00:00:00.000Z'};
const fetchMock=vi.fn();
const response=(data:unknown,status=200)=>Promise.resolve({ok:status<400,status,json:async()=>({success:status<400,data,error:status>=400?data:undefined})});

beforeEach(()=>{
  fetchMock.mockReset();vi.stubGlobal('fetch',fetchMock);
  fetchMock.mockImplementation((url:string,options?:RequestInit)=>{
    if(url.startsWith('/api/v1/leads?'))return response({items:[lead]});
    if(url==='/api/v1/leads/lead-1/dismiss'&&options?.method==='POST')return response({id:'lead-1',status:'DISMISSED'});
    return response({message:'Not found'},404);
  });
});
afterEach(()=>{cleanup();vi.unstubAllGlobals()});

describe('portal Lead inbox',()=>{
  it('shows unresolved catalog context and keeps conversion Rep-only',async()=>{
    render(<LeadsPage role="MANAGER" openQuote={vi.fn()}/>);
    fireEvent.click(await screen.findByRole('button',{name:/Buyer Ltd/}));
    expect(screen.getByText(/Catalog match unavailable/i)).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:/Convert to quotation/i})).not.toBeInTheDocument();
  });

  it('requires and sends an internal dismissal reason',async()=>{
    render(<LeadsPage role="REP" openQuote={vi.fn()}/>);
    fireEvent.click(await screen.findByRole('button',{name:/Buyer Ltd/}));fireEvent.click(screen.getByRole('button',{name:/Dismiss/}));
    const dialog=screen.getByRole('dialog',{name:'Dismiss Lead'});
    const submit=within(dialog).getByRole('button',{name:'Dismiss Lead'});expect(submit).toBeEnabled();
    fireEvent.change(within(dialog).getByLabelText('Internal reason'),{target:{value:'Requested model is no longer supported.'}});fireEvent.click(submit);
    await waitFor(()=>expect(fetchMock).toHaveBeenCalledWith('/api/v1/leads/lead-1/dismiss',expect.objectContaining({method:'POST',body:JSON.stringify({reason:'Requested model is no longer supported.'})})));
  });
});
