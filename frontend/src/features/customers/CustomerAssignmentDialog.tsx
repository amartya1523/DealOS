import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, Check, RefreshCw, X } from 'lucide-react';
import { ApiError, request, type Customer } from '../../api';

type Team = { id:string; name:string; managerId:string|null; representatives:Array<{id:string;name:string}> };

export function CustomerAssignmentDialog({customer,close,onChanged}:{customer:Customer;close:()=>void;onChanged:()=>Promise<void>}) {
  const [teams,setTeams]=useState<Team[]>([]);
  const [teamId,setTeamId]=useState(customer.primaryTeam?.id??'');
  const [primaryRepId,setPrimaryRepId]=useState(customer.primaryRepresentative?.id??'');
  const [collaboratorIds,setCollaboratorIds]=useState<string[]>(customer.collaborators?.map(person=>person.id)??[]);
  const [reason,setReason]=useState('');
  const [selectedQuotes,setSelectedQuotes]=useState<string[]>([]);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const firstRef=useRef<HTMLSelectElement>(null);
  const activeTeam=useMemo(()=>teams.find(team=>team.id===teamId),[teams,teamId]);
  const representatives=activeTeam?.representatives??[];
  const openQuotes=(customer.quotes??[]).filter(quote=>!['CONFIRMED','REJECTED'].includes(quote.stage));

  useEffect(()=>{request<{items:Team[]}>('/sales-teams').then(result=>setTeams(result.items)).catch(problem=>setError(problem instanceof Error?problem.message:'Unable to load sales teams.')).finally(()=>setLoading(false))},[]);
  useEffect(()=>{if(!loading)firstRef.current?.focus()},[loading]);
  const changeTeam=(next:string)=>{setTeamId(next);setPrimaryRepId('');setCollaboratorIds([])};
  const toggleCollaborator=(id:string)=>setCollaboratorIds(current=>current.includes(id)?current.filter(value=>value!==id):[...current,id]);
  const toggleQuote=(id:string)=>setSelectedQuotes(current=>current.includes(id)?current.filter(value=>value!==id):[...current,id]);

  const submit=async(event:FormEvent)=>{
    event.preventDefault();setError('');
    if(!reason.trim()){setError('A reassignment reason is required.');return}
    if(!teamId||!primaryRepId){setError('Select a primary team and representative.');return}
    setSaving(true);
    try{
      await request(`/customers/${customer.id}/relationships`,{method:'PUT',body:JSON.stringify({expectedVersion:customer.assignmentVersion??1,primarySalesTeamId:teamId,primaryRepId,collaboratorIds,reason:reason.trim()})});
      for(const quotationId of selectedQuotes){const quote=openQuotes.find(item=>item.id===quotationId);if(!quote?.version)continue;await request(`/quotations/${quote.id}/assignment`,{method:'PATCH',body:JSON.stringify({version:quote.version,ownerId:primaryRepId,teamId,reason:`Account reassignment: ${reason.trim()}`})})}
      await onChanged();close();
    }catch(problem){setError(problem instanceof ApiError&&problem.code==='STALE_VERSION'?'This assignment changed while the dialog was open. Refresh and review the latest owners before trying again.':problem instanceof Error?problem.message:'Unable to change this assignment.')}
    finally{setSaving(false)}
  };

  return <div className="quotation-dialog-backdrop" onMouseDown={event=>event.target===event.currentTarget&&!saving&&close()}><div className="quotation-dialog customer-assignment-dialog" role="dialog" aria-modal="true" aria-labelledby="customer-assignment-title"><div className="quotation-dialog-head"><div><h2 id="customer-assignment-title">Change account assignment</h2><p>{customer.name} · version {customer.assignmentVersion??1}</p></div><button onClick={close} disabled={saving} aria-label="Close assignment dialog"><X/></button></div>
    {loading?<div className="assignment-loading"><RefreshCw className="spin"/>Loading teams…</div>:<form onSubmit={submit} noValidate>
      <div className="relationship-warning"><AlertTriangle/><span><b>Open quotations are not changed automatically.</b>Choose individual eligible drafts below only if their deal ownership should also move. Approved, sent, accepted, and confirmed deals stay frozen.</span></div>
      <label>Primary sales team<select ref={firstRef} value={teamId} onChange={event=>changeTeam(event.target.value)} required><option value="">Select a team</option>{teams.map(team=><option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
      <label>Primary representative<select value={primaryRepId} onChange={event=>{setPrimaryRepId(event.target.value);setCollaboratorIds(current=>current.filter(id=>id!==event.target.value))}} required disabled={!activeTeam}><option value="">Select a representative</option>{representatives.map(rep=><option key={rep.id} value={rep.id}>{rep.name}</option>)}</select></label>
      <fieldset><legend>Collaborators <span>Optional</span></legend><div className="collaborator-options">{representatives.filter(rep=>rep.id!==primaryRepId).map(rep=><label key={rep.id}><input type="checkbox" checked={collaboratorIds.includes(rep.id)} onChange={()=>toggleCollaborator(rep.id)}/>{rep.name}</label>)}{activeTeam&&!representatives.length&&<p>No active representatives belong to this team.</p>}</div></fieldset>
      <label>Reason for reassignment<textarea value={reason} onChange={event=>setReason(event.target.value)} minLength={5} maxLength={500} required placeholder="Explain why ownership is changing"/></label>
      <fieldset><legend>Open quotations <span>Explicit opt-in only</span></legend><div className="open-quote-options">{openQuotes.map(quote=>{const eligible=['DRAFT','PENDING_APPROVAL'].includes(quote.stage);return <label key={quote.id} className={!eligible?'frozen':''}><input type="checkbox" disabled={!eligible} checked={selectedQuotes.includes(quote.id)} onChange={()=>toggleQuote(quote.id)}/><span><b>{quote.number}</b><small>{eligible?'Reassign this open quotation':'Frozen at this stage'} · {quote.stage.replaceAll('_',' ')}</small></span></label>})}{!openQuotes.length&&<p>No open quotations are linked to this customer.</p>}</div></fieldset>
      {error&&<p className="dialog-error" role="alert">{error}</p>}
      <div className="quotation-dialog-actions"><button type="button" className="button ghost" onClick={close} disabled={saving}>Cancel</button><button className="button primary" disabled={saving||!teamId||!primaryRepId||reason.trim().length<5}>{saving?<><RefreshCw className="spin"/>Saving…</>:<><Check/>Save assignment</>}</button></div>
    </form>}
  </div></div>;
}
