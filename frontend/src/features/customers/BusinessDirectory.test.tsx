import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BusinessDirectoryPage, DirectoryProfileSettings, JoinRequestsPage } from './BusinessDirectory';

const fetchMock=vi.fn();
beforeEach(()=>{fetchMock.mockReset();vi.stubGlobal('fetch',fetchMock)});
afterEach(()=>{cleanup();vi.unstubAllGlobals()});

const response=(data:unknown,status=200)=>Promise.resolve({ok:status>=200&&status<300,status,json:async()=>({success:status<300,data,error:status>=300?{message:'Request failed'}:undefined})});

describe('business directory',()=>{
  it('shows only the public profile fields and submits a request without creating access',async()=>{
    fetchMock.mockImplementation((url:string,options?:RequestInit)=>{
      if(url==='/api/v1/directory/businesses')return response({items:[{id:'11111111-1111-4111-8111-111111111111',displayName:'Visible Business',shortDescription:'Public description',category:'Services'}]});
      if(url.includes('/join-requests')&&options?.method==='POST')return response({id:'request-1',status:'PENDING',createdAt:'2026-09-06T00:00:00.000Z'},201);
      return response({},404);
    });
    render(<BusinessDirectoryPage/>);
    expect(await screen.findByRole('heading',{name:'Visible Business'})).toBeInTheDocument();
    expect(screen.getByText('Services')).toBeInTheDocument();
    expect(screen.queryByText(/price|cost|stock/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:/Request to join/i}));
    fireEvent.change(screen.getByLabelText('Business email'),{target:{value:'buyer@example.com'}});
    fireEvent.change(screen.getByLabelText('Your company name'),{target:{value:'Buyer Co'}});
    fireEvent.change(screen.getByLabelText('How would you like to work together?'),{target:{value:'Please configure a buying relationship.'}});
    fireEvent.click(screen.getByRole('button',{name:/Send request/i}));
    expect(await screen.findByText(/No customer account or login is created until approval/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/directory/businesses/11111111-1111-4111-8111-111111111111/join-requests',expect.objectContaining({method:'POST',body:JSON.stringify({email:'buyer@example.com',companyName:'Buyer Co',message:'Please configure a buying relationship.'})}));
  });

  it('lets an approver choose the real team and shows returned credentials once',async()=>{
    fetchMock.mockImplementation((url:string,options?:RequestInit)=>{
      if(url.startsWith('/api/v1/directory/join-requests?'))return response({items:[{id:'22222222-2222-4222-8222-222222222222',email:'buyer@example.com',companyName:'Buyer Co',message:'Please configure our account.',status:'PENDING',decidedBy:null,decidedAt:null,decisionReason:null,resultingCustomer:null,createdAt:'2026-09-06T00:00:00.000Z',updatedAt:'2026-09-06T00:00:00.000Z'}]});
      if(url==='/api/v1/sales-teams')return response({items:[{id:'33333333-3333-4333-8333-333333333333',name:'Enterprise',representatives:[{id:'44444444-4444-4444-8444-444444444444',name:'Representative'}]}]});
      if(url.endsWith('/approve')&&options?.method==='POST')return response({credentials:{email:'buyer@example.com',password:'Deal-generated-12!',signInPath:'/customer/sign-in'}});
      return response({},404);
    });
    render(<JoinRequestsPage/>);
    expect(await screen.findByRole('heading',{name:'Buyer Co'})).toBeInTheDocument();
    const approveButton=screen.getByRole('button',{name:'Approve & create customer'});
    await waitFor(()=>expect(approveButton).toBeEnabled());
    fireEvent.click(approveButton);
    expect(await screen.findByText('Deal-generated-12!')).toBeInTheDocument();
    expect(screen.getByText(/returned only by this approval response/i)).toBeInTheDocument();
    await waitFor(()=>expect(fetchMock).toHaveBeenCalledWith('/api/v1/directory/join-requests/22222222-2222-4222-8222-222222222222/approve',expect.objectContaining({method:'POST'})));
  });

  it('allows an Admin to publish an allowlisted directory profile',async()=>{
    fetchMock.mockImplementation((url:string,options?:RequestInit)=>{
      const profile={organizationId:'org-1',displayName:'Visible Business',shortDescription:null,category:null,isDiscoverable:false,updatedAt:null};
      if(url==='/api/v1/settings/directory-profile'&&options?.method==='PUT')return response({...profile,isDiscoverable:true,updatedAt:'2026-09-06T00:00:00.000Z'});
      if(url==='/api/v1/settings/directory-profile')return response(profile);
      return response({},404);
    });
    render(<DirectoryProfileSettings/>);
    const checkbox=await screen.findByRole('checkbox',{name:/Show in public directory/i});
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button',{name:'Save directory profile'}));
    expect(await screen.findByText(/now visible in the public business directory/i)).toBeInTheDocument();
  });
});
