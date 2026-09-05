import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PortalRequests } from './PortalRequests';

const fetchMock=vi.fn();
const response=(data:unknown,status=200)=>Promise.resolve({ok:status<400,status,json:async()=>({success:status<400,data,error:status>=400?data:undefined})});

beforeEach(()=>{
  fetchMock.mockReset();vi.stubGlobal('fetch',fetchMock);
  fetchMock.mockImplementation((url:string,options?:RequestInit)=>{
    if(url==='/api/v1/portal/requests/catalog')return response({items:[{id:'product-1',name:'Safe product',sku:'SAFE-1',category:'Hardware',description:'Catalog item',unit:'unit'}]});
    if(url==='/api/v1/portal/requests'&&options?.method==='POST')return response({id:'request-2',status:'RECEIVED'},201);
    if(url==='/api/v1/portal/requests')return response({
      items:[{
        id:'request-1',requirementsText:'Need secure equipment',preferredDeliveryDate:null,status:'DECLINED',createdAt:'2026-09-06T00:00:00.000Z',
        lines:[{id:'line-1',product:null,description:'Unmatched model',quantity:'2',catalogMatch:false}],
      }],
      rateLimit:{maximum:5,windowMinutes:60},
    });
    return response({message:'Not found'},404);
  });
});
afterEach(()=>{cleanup();vi.unstubAllGlobals()});

describe('portal quote requests',()=>{
  it('renders only customer-safe progress and keeps internal dismissal context absent',async()=>{
    render(<PortalRequests/>);
    expect(await screen.findByText('Need secure equipment')).toBeInTheDocument();
    expect(screen.getByText('Declined')).toBeInTheDocument();
    expect(screen.getByText(/not being progressed/i)).toBeInTheDocument();
    expect(screen.queryByText(/dismiss reason|owner id|draft price/i)).not.toBeInTheDocument();
  });

  it('submits the customer requirement without any ownership or pricing fields',async()=>{
    render(<PortalRequests/>);await screen.findByText('Need secure equipment');
    fireEvent.change(screen.getByLabelText('Requirements'),{target:{value:'Quote a secure workstation bundle'}});
    fireEvent.click(screen.getByRole('button',{name:'Submit request'}));
    await screen.findByText(/request was received/i);
    const call=fetchMock.mock.calls.find(([url,options])=>url==='/api/v1/portal/requests'&&options?.method==='POST');
    expect(call).toBeTruthy();
    expect(JSON.parse(call![1].body)).toEqual({requirementsText:'Quote a secure workstation bundle',preferredDeliveryDate:null,lines:[]});
  });
});
