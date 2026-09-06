import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SalesTeamManagement } from './SalesTeamManagement';

const fetchMock=vi.fn();
const users=[
  {id:'11111111-1111-4111-8111-111111111111',name:'Maya Manager',role:'MANAGER',status:'ACTIVE'},
  {id:'22222222-2222-4222-8222-222222222222',name:'Aarav Rep',role:'REP',status:'ACTIVE'},
  {id:'33333333-3333-4333-8333-333333333333',name:'Leena Rep',role:'REP',status:'ACTIVE'},
];
const response=(data:unknown)=>Promise.resolve({ok:true,json:async()=>({success:true,data})});

beforeEach(()=>{
  fetchMock.mockReset();
  fetchMock.mockImplementation((url:string)=>url.endsWith('/sales-teams')?response({
    items:[{id:'team-1',name:'Enterprise Sales',managerId:users[0]!.id,manager:{id:users[0]!.id,name:users[0]!.name},representatives:[{id:users[1]!.id,name:users[1]!.name}]}],
    canManage:true,
    options:{representatives:users.slice(1),managers:users.slice(0,1)},
  }):response({}));
  vi.stubGlobal('fetch',fetchMock);
});
afterEach(cleanup);

describe('simple sales team management',()=>{
  it('creates a new team with multiple selected sales representatives',async()=>{
    render(<SalesTeamManagement/>);
    expect(await screen.findByText('Enterprise Sales')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'New team'}));
    fireEvent.change(screen.getByLabelText('Team name'),{target:{value:'West Region Sales'}});
    fireEvent.change(screen.getByLabelText('Team manager'),{target:{value:users[0]!.id}});
    fireEvent.change(screen.getByLabelText('Sales representative'),{target:{value:users[1]!.id}});
    fireEvent.click(screen.getByRole('button',{name:'Add representative'}));
    fireEvent.change(screen.getByLabelText('Sales representative'),{target:{value:users[2]!.id}});
    fireEvent.click(screen.getByRole('button',{name:'Add representative'}));
    fireEvent.click(screen.getByRole('button',{name:'Create team'}));
    await waitFor(()=>expect(fetchMock).toHaveBeenCalledWith('/api/v1/sales-teams',expect.objectContaining({method:'POST'})));
    const call=fetchMock.mock.calls.find(([url,options])=>url==='/api/v1/sales-teams'&&options?.method==='POST');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({name:'West Region Sales',managerId:users[0]!.id,memberIds:[users[1]!.id,users[2]!.id]});
  });

  it('adds another representative to an existing team',async()=>{
    render(<SalesTeamManagement/>);
    expect(await screen.findByText('Enterprise Sales')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Edit team'}));
    fireEvent.change(screen.getByLabelText('Sales representative'),{target:{value:users[2]!.id}});
    fireEvent.click(screen.getByRole('button',{name:'Add representative'}));
    fireEvent.click(screen.getByRole('button',{name:'Save team'}));
    await waitFor(()=>expect(fetchMock).toHaveBeenCalledWith('/api/v1/sales-teams/team-1',expect.objectContaining({method:'PATCH'})));
    const call=fetchMock.mock.calls.find(([url,options])=>url==='/api/v1/sales-teams/team-1'&&options?.method==='PATCH');
    expect(JSON.parse(String(call?.[1]?.body)).memberIds).toEqual([users[1]!.id,users[2]!.id]);
  });
});
