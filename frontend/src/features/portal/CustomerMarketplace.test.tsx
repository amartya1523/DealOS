import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomerMarketplace } from './CustomerMarketplace';
import { CustomerSignupPage } from './CustomerSignupPage';

const fetchMock=vi.fn();
const response=(data:unknown,status=200)=>Promise.resolve({ok:status>=200&&status<300,status,json:async()=>({success:status<300,data,error:status>=300?{message:'Request failed'}:undefined})});
const organization={id:'11111111-1111-4111-8111-111111111111',displayName:'Northstar Systems',shortDescription:'Infrastructure and managed services.',category:'Technology'};
const product={id:'22222222-2222-4222-8222-222222222222',name:'Managed rollout',sku:'MR-1',category:'Services',description:'Regional implementation and support.',unit:'Project',recurring:false,cadence:null,featured:true};

beforeEach(()=>{fetchMock.mockReset();vi.stubGlobal('fetch',fetchMock)});
afterEach(()=>{cleanup();vi.unstubAllGlobals()});

describe('customer marketplace',()=>{
  it('shows an organization catalog and sends structured interest to the assigned workflow',async()=>{
    fetchMock.mockImplementation((url:string,options?:RequestInit)=>{
      if(url==='/api/v1/portal/organizations')return response({items:[{...organization,relationship:'ACTIVE'}]});
      if(url===`/api/v1/portal/organizations/${organization.id}`)return response({...organization,products:[product]});
      if(url.endsWith('/interest')&&options?.method==='POST')return response({kind:'QUOTE_REQUEST',id:'request-1',status:'RECEIVED'},201);
      return response({},404);
    });
    render(<CustomerMarketplace companyName="Buyer Co" currentOrganizationId={organization.id} onWorkspaceChanged={vi.fn()}/>);
    expect(await screen.findByRole('heading',{name:'Managed rollout'})).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Requirements'),{target:{value:'Roll this service out across three regions.'}});
    fireEvent.click(screen.getByRole('button',{name:/Request quotation/}));
    expect(await screen.findByText(/assigned representative has been notified/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/portal/organizations/${organization.id}/interest`,expect.objectContaining({method:'POST',body:JSON.stringify({companyName:'Buyer Co',message:'Roll this service out across three regions.',productId:product.id,quantity:1})}));
  });

  it('creates an independent customer account before organization selection',async()=>{
    fetchMock.mockImplementation((url:string,options?:RequestInit)=>{
      if(url==='/api/v1/auth/customer/signup'&&options?.method==='POST')return response({role:'CUSTOMER',destination:'/customer',csrfToken:'csrf'},201);
      return response({},404);
    });
    render(<CustomerSignupPage/>);
    fireEvent.change(screen.getByLabelText('Full name'),{target:{value:'Asha Rao'}});
    fireEvent.change(screen.getByLabelText('Company name'),{target:{value:'Buyer Co'}});
    fireEvent.change(screen.getByLabelText('Business email'),{target:{value:'asha@buyer.example'}});
    fireEvent.change(screen.getByLabelText('Password'),{target:{value:'CustomerPass12!'}});
    fireEvent.change(screen.getByLabelText('Confirm password'),{target:{value:'CustomerPass12!'}});
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button',{name:/Create customer account/}));
    expect(await screen.findByRole('heading',{name:'Your marketplace is ready.'})).toBeInTheDocument();
    await waitFor(()=>expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/customer/signup',expect.objectContaining({method:'POST',body:JSON.stringify({contactName:'Asha Rao',companyName:'Buyer Co',email:'asha@buyer.example',password:'CustomerPass12!'})})));
  });
});
