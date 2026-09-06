import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Check, Pencil, Plus, RefreshCw, UserPlus, UsersRound, X } from 'lucide-react';
import { request } from '../../api';
import './sales-team-management.css';

type PersonOption = { id:string; name:string };
type SalesTeam = {
  id:string;
  name:string;
  managerId:string|null;
  manager:PersonOption|null;
  representatives:PersonOption[];
};
type SalesTeamResponse = {
  items:SalesTeam[];
  canManage:boolean;
  options:{ representatives:PersonOption[]; managers:PersonOption[] };
};
type TeamDraft = { id:string|null; name:string; managerId:string; memberIds:string[] };

const emptyDraft = ():TeamDraft => ({ id:null, name:'', managerId:'', memberIds:[] });

export function SalesTeamManagement() {
  const [teams,setTeams]=useState<SalesTeam[]>([]);
  const [representatives,setRepresentatives]=useState<PersonOption[]>([]);
  const [managers,setManagers]=useState<PersonOption[]>([]);
  const [canManage,setCanManage]=useState(false);
  const [draft,setDraft]=useState<TeamDraft|null>(null);
  const [representativeToAdd,setRepresentativeToAdd]=useState('');
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');

  const load=async()=>{
    try {
      setLoading(true);
      setError('');
      const response=await request<SalesTeamResponse>('/sales-teams');
      const items=Array.isArray(response?.items)?response.items:[];
      const normalized=items.map(team=>({
        ...team,
        manager:team.manager??null,
        representatives:Array.isArray(team.representatives)?team.representatives:[],
      }));
      const optionReps=Array.isArray(response?.options?.representatives)?response.options.representatives:[];
      const knownReps=new Map(optionReps.map(rep=>[rep.id,rep]));
      normalized.flatMap(team=>team.representatives).forEach(rep=>knownReps.set(rep.id,rep));
      setTeams(normalized);
      setRepresentatives([...knownReps.values()].sort((a,b)=>a.name.localeCompare(b.name)));
      setManagers(Array.isArray(response?.options?.managers)?response.options.managers:[]);
      setCanManage(response?.canManage===true);
    } catch(problem) {
      setError(problem instanceof Error?problem.message:'Unable to load sales teams.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(()=>{ void load(); },[]);

  const availableRepresentatives=useMemo(
    ()=>representatives.filter(rep=>!draft?.memberIds.includes(rep.id)),
    [representatives,draft],
  );
  const selectedRepresentatives=useMemo(
    ()=>draft?.memberIds.map(id=>representatives.find(rep=>rep.id===id)).filter((rep):rep is PersonOption=>Boolean(rep))??[],
    [representatives,draft],
  );

  const startCreate=()=>{
    setError('');
    setRepresentativeToAdd('');
    setDraft(emptyDraft());
  };
  const edit=(team:SalesTeam)=>{
    setError('');
    setRepresentativeToAdd('');
    setDraft({ id:team.id, name:team.name, managerId:team.managerId??'', memberIds:team.representatives.map(rep=>rep.id) });
  };
  const closeEditor=()=>{
    setDraft(null);
    setRepresentativeToAdd('');
    setError('');
  };
  const addRepresentative=()=>{
    if(!representativeToAdd||!draft||draft.memberIds.includes(representativeToAdd))return;
    setDraft({...draft,memberIds:[...draft.memberIds,representativeToAdd]});
    setRepresentativeToAdd('');
  };
  const removeRepresentative=(id:string)=>{
    if(!draft)return;
    setDraft({...draft,memberIds:draft.memberIds.filter(memberId=>memberId!==id)});
  };
  const save=async(event:FormEvent)=>{
    event.preventDefault();
    if(!draft||!canManage)return;
    try {
      setSaving(true);
      setError('');
      await request(draft.id?`/sales-teams/${draft.id}`:'/sales-teams',{
        method:draft.id?'PATCH':'POST',
        body:JSON.stringify({ name:draft.name.trim(), managerId:draft.managerId||null, memberIds:draft.memberIds }),
      });
      setDraft(null);
      setRepresentativeToAdd('');
      await load();
    } catch(problem) {
      setError(problem instanceof Error?problem.message:'Unable to save the sales team.');
    } finally {
      setSaving(false);
    }
  };

  return <section className="sales-team-management">
    <header className="sales-team-header">
      <div>
        <span className="eyebrow">Sales organization</span>
        <h2>Sales teams</h2>
        <p>Create a team, then add one or more sales representatives from the list.</p>
      </div>
      {canManage&&<button className="button primary" type="button" onClick={startCreate} disabled={Boolean(draft)}><Plus/>New team</button>}
    </header>

    {error&&<div className="sales-team-error error" role="alert"><span>{error}</span><button type="button" aria-label="Dismiss team error" onClick={()=>setError('')}><X/></button></div>}

    {draft&&canManage&&<form className="sales-team-editor" onSubmit={save}>
      <div className="sales-team-editor-head">
        <div><b>{draft.id?'Edit sales team':'Create a sales team'}</b><span>Add representatives from the dropdown and save the final team.</span></div>
        <button type="button" aria-label="Close team editor" onClick={closeEditor} disabled={saving}><X/></button>
      </div>

      <div className="sales-team-fields">
        <label>Team name<input autoFocus required minLength={2} maxLength={120} value={draft.name} onChange={event=>setDraft({...draft,name:event.target.value})} placeholder="West Region Sales"/></label>
        <label>Team manager<select value={draft.managerId} onChange={event=>setDraft({...draft,managerId:event.target.value})}><option value="">No manager</option>{managers.map(manager=><option key={manager.id} value={manager.id}>{manager.name}</option>)}</select></label>
      </div>

      <fieldset disabled={saving}>
        <legend><span>Sales representatives</span><small>{draft.memberIds.length} added</small></legend>
        <div className="sales-rep-control">
          <label>
            <span>Add a sales representative</span>
            <select aria-label="Sales representative" value={representativeToAdd} onChange={event=>setRepresentativeToAdd(event.target.value)}>
              <option value="">Select a representative…</option>
              {availableRepresentatives.map(rep=><option key={rep.id} value={rep.id}>{rep.name}</option>)}
            </select>
          </label>
          <button className="button ghost" type="button" onClick={addRepresentative} disabled={!representativeToAdd}><UserPlus/>Add representative</button>
        </div>

        {selectedRepresentatives.length?<div className="selected-team-reps" aria-label="Representatives added to this team">
          {selectedRepresentatives.map(rep=><div className="selected-team-rep" key={rep.id}>
            <span className="avatar">{rep.name.split(' ').map(part=>part[0]).join('').slice(0,2)}</span>
            <b>{rep.name}</b>
            <button type="button" aria-label={`Remove ${rep.name} from team`} onClick={()=>removeRepresentative(rep.id)}><X/></button>
          </div>)}
        </div>:<div className="sales-rep-empty"><UsersRound/><span><b>No representatives added</b><small>Select a sales representative above, then click Add representative.</small></span></div>}

        {!representatives.length&&!loading&&<p className="sales-rep-unavailable">No active Sales representatives are available. Create or activate one in Organization users first.</p>}
      </fieldset>

      <div className="sales-team-actions">
        <button type="button" className="button ghost" onClick={closeEditor} disabled={saving}>Cancel</button>
        <button className="button primary" disabled={saving||draft.name.trim().length<2||draft.memberIds.length===0}>{saving?<><RefreshCw className="spin"/>Saving…</>:<><Check/>{draft.id?'Save team':'Create team'}</>}</button>
      </div>
    </form>}

    {loading?<div className="sales-team-loading"><RefreshCw className="spin"/>Loading sales teams…</div>:<div className="sales-team-list">
      {teams.map(team=><article key={team.id}>
        <div className="sales-team-title">
          <span><UsersRound/></span>
          <div><b>{team.name}</b><small>{team.manager?`Managed by ${team.manager.name}`:'No manager assigned'}</small></div>
          {canManage&&<button className="button ghost" type="button" onClick={()=>edit(team)} disabled={Boolean(draft)}><Pencil/>Edit team</button>}
        </div>
        <div className="sales-team-members">{team.representatives.map(rep=><span key={rep.id}>{rep.name}</span>)}{!team.representatives.length&&<em>No active sales representatives</em>}</div>
        <footer>{team.representatives.length} sales representative{team.representatives.length===1?'':'s'}</footer>
      </article>)}
      {!teams.length&&!draft&&<div className="sales-team-empty"><UsersRound/><b>No sales teams yet</b><p>Create a team and add the representatives who should share its customer work.</p></div>}
    </div>}
  </section>;
}
