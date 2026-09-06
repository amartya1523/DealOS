import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, Check, FileText, RefreshCw, UserRoundCog, UsersRound, X } from 'lucide-react';
import { ApiError, request, type Customer } from '../../api';
import './customer-assignment-dialog.css';

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

  return <div className="quotation-dialog-backdrop assignment-dialog-backdrop" onMouseDown={event=>event.target===event.currentTarget&&!saving&&close()}>
    <div className="quotation-dialog customer-assignment-dialog" role="dialog" aria-modal="true" aria-labelledby="customer-assignment-title">
      <div className="quotation-dialog-head assignment-dialog-head">
        <span className="assignment-dialog-icon"><UserRoundCog/></span>
        <div><span className="eyebrow">Account ownership</span><h2 id="customer-assignment-title">Change account assignment</h2><p>{customer.name} <i/> Assignment version {customer.assignmentVersion??1}</p></div>
        <button type="button" onClick={close} disabled={saving} aria-label="Close assignment dialog"><X/></button>
      </div>

      {loading?<div className="assignment-loading"><RefreshCw className="spin"/><span><b>Loading assignment options</b><small>Fetching eligible teams and representatives…</small></span></div>:<form className="assignment-dialog-form" onSubmit={submit} noValidate>
        <div className="assignment-dialog-body">
          <div className="assignment-impact-note"><AlertTriangle/><span><b>Existing quotations keep their current owner.</b><small>You can explicitly move eligible drafts below. Approved, sent, accepted, and confirmed deals remain unchanged.</small></span></div>

          <section className="assignment-section">
            <div className="assignment-section-title"><span>1</span><div><h3>Primary ownership</h3><p>Choose the team responsible for this account and its primary sales representative.</p></div></div>
            <div className="assignment-primary-grid">
              <label>Primary sales team<select ref={firstRef} value={teamId} onChange={event=>changeTeam(event.target.value)} required><option value="">Select a team</option>{teams.map(team=><option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
              <label>Primary representative<select value={primaryRepId} onChange={event=>{setPrimaryRepId(event.target.value);setCollaboratorIds(current=>current.filter(id=>id!==event.target.value))}} required disabled={!activeTeam}><option value="">Select a representative</option>{representatives.map(rep=><option key={rep.id} value={rep.id}>{rep.name}</option>)}</select></label>
            </div>
          </section>

          <section className="assignment-section">
            <div className="assignment-section-title"><span>2</span><div><h3>Collaborators <em>Optional</em></h3><p>Add other representatives from the selected team who should share customer context.</p></div></div>
            <div className="collaborator-options">
              {representatives.filter(rep=>rep.id!==primaryRepId).map(rep=>{
                const selected=collaboratorIds.includes(rep.id);
                return <label className={selected?'selected':''} key={rep.id}>
                  <span className="collaborator-avatar">{rep.name.split(' ').map(part=>part[0]).join('').slice(0,2)}</span>
                  <span className="collaborator-copy"><b>{rep.name}</b><small>{selected?'Added as collaborator':'Click to add collaborator'}</small></span>
                  <input type="checkbox" checked={selected} onChange={()=>toggleCollaborator(rep.id)}/>
                </label>;
              })}
              {!activeTeam&&<div className="assignment-empty-state"><UsersRound/><span><b>Select a sales team first</b><small>Eligible representatives will appear here.</small></span></div>}
              {activeTeam&&!representatives.length&&<div className="assignment-empty-state"><UsersRound/><span><b>No active representatives</b><small>Add an active Sales Rep to this team before assigning the account.</small></span></div>}
            </div>
          </section>

          <section className="assignment-section">
            <div className="assignment-section-title"><span>3</span><div><h3>Reason for reassignment</h3><p>This explanation is retained in the account audit history.</p></div></div>
            <label className="assignment-reason"><span>Reason for reassignment</span><textarea aria-label="Reason for reassignment" value={reason} onChange={event=>setReason(event.target.value)} minLength={5} maxLength={500} required placeholder="For example: Territory ownership changed for the new quarter"/><small>{reason.trim().length}/500 characters · minimum 5</small></label>
          </section>

          <section className="assignment-section">
            <div className="assignment-section-title"><span>4</span><div><h3>Open quotations <em>Explicit opt-in</em></h3><p>Choose only eligible drafts whose deal ownership should move with the account.</p></div></div>
            <div className="open-quote-options">
              {openQuotes.map(quote=>{const eligible=['DRAFT','PENDING_APPROVAL'].includes(quote.stage);return <label key={quote.id} className={`${selectedQuotes.includes(quote.id)?'selected ':''}${!eligible?'frozen':''}`}><input type="checkbox" disabled={!eligible} checked={selectedQuotes.includes(quote.id)} onChange={()=>toggleQuote(quote.id)}/><span><b>{quote.number}</b><small>{eligible?'Eligible to reassign':'Frozen at this stage'} · {quote.stage.replaceAll('_',' ')}</small></span></label>})}
              {!openQuotes.length&&<div className="assignment-empty-state compact"><FileText/><span><b>No open quotations</b><small>This customer has no linked quotations requiring review.</small></span></div>}
            </div>
          </section>

          {error&&<p className="dialog-error" role="alert"><AlertTriangle/>{error}</p>}
        </div>

        <div className="assignment-dialog-footer">
          <div className="assignment-summary"><span>New primary owner</span><b>{representatives.find(rep=>rep.id===primaryRepId)?.name??'Not selected'}</b><small>{activeTeam?.name??'Select a sales team'} · {collaboratorIds.length} collaborator{collaboratorIds.length===1?'':'s'}</small></div>
          <div className="quotation-dialog-actions"><button type="button" className="button ghost" onClick={close} disabled={saving}>Cancel</button><button className="button primary" disabled={saving||!teamId||!primaryRepId||reason.trim().length<5}>{saving?<><RefreshCw className="spin"/>Saving…</>:<><Check/>Save assignment</>}</button></div>
        </div>
      </form>}
    </div>
  </div>;
}
