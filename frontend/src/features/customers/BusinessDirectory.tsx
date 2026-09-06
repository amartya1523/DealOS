import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Building2, CalendarDays, Check, CheckCircle2, ChevronRight, CircleX, Clock3, Copy, Globe2, Mail, RefreshCw, Send, ShieldAlert, ShieldCheck, UserRoundCheck, X } from 'lucide-react';
import { Brand } from '../../Brand';
import { request } from '../../api';
import './business-directory.css';
import './join-requests.css';

type Business = {
  id: string;
  displayName: string;
  shortDescription: string | null;
  category: string | null;
};

type JoinRequest = {
  id: string;
  email: string;
  companyName: string;
  message: string;
  contactName?: string|null;
  marketplaceInterest?: boolean;
  requestedProduct?: {id:string|null;name:string;sku:string|null}|null;
  requestedQuantity?: string|null;
  status: 'PENDING'|'APPROVED'|'DECLINED';
  decidedBy: { id: string; name: string } | null;
  decidedAt: string | null;
  decisionReason: string | null;
  resultingCustomer: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
};

type SalesTeam = {
  id: string;
  name: string;
  representatives: Array<{ id: string; name: string }>;
};

type DirectoryProfile = {
  organizationId: string;
  displayName: string;
  shortDescription: string | null;
  category: string | null;
  isDiscoverable: boolean;
  updatedAt: string | null;
};

const prettyDate = (value: string) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

export function BusinessDirectoryPage() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selected, setSelected] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    request<{ items: Business[] }>('/directory/businesses')
      .then((result) => setBusinesses(result.items))
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load the business directory.'))
      .finally(() => setLoading(false));
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await request(`/directory/businesses/${selected.id}/join-requests`, {
        method: 'POST',
        body: JSON.stringify({
          email: String(form.get('email')),
          companyName: String(form.get('companyName')),
          message: String(form.get('message')),
        }),
      });
      setSubmitted(selected.displayName);
      setSelected(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not submit this request.');
    } finally {
      setBusy(false);
    }
  };

  return <div className="business-directory-page">
    <header className="directory-header"><Brand href="/"/><nav><a href="/"><ArrowLeft/>DealOS</a><a className="directory-signin" href="/sign-in">Workspace sign in <ArrowRight/></a></nav></header>
    <main>
      <section className="directory-hero"><span className="eyebrow">PUBLIC BUSINESS DIRECTORY</span><h1>Find a business to work with.</h1><p>Browse organizations that have chosen to be discoverable, then request a customer relationship. Commercial access begins only after their team reviews and assigns your account.</p></section>
      {submitted&&<div className="directory-confirmation" role="status"><Check/><span><b>Request sent to {submitted}</b><small>The organization will review it. No customer account or login is created until approval.</small></span><button aria-label="Dismiss confirmation" onClick={()=>setSubmitted('')}><X/></button></div>}
      {error&&<div className="directory-error" role="alert">{error}</div>}
      {loading?<div className="directory-loading" role="status"><RefreshCw/>Loading discoverable businesses…</div>:businesses.length?<section className="business-card-grid" aria-label="Discoverable businesses">{businesses.map((business)=><article key={business.id}>
        <span className="business-mark"><Building2/></span>
        {business.category&&<em>{business.category}</em>}
        <h2>{business.displayName}</h2>
        <p>{business.shortDescription || 'This organization is accepting customer association requests.'}</p>
        <button className="button primary" onClick={()=>{setSelected(business);setError('')}}>Request to join <Send/></button>
      </article>)}</section>:<div className="directory-empty"><Globe2/><h2>No businesses are listed yet.</h2><p>Organizations appear here only after an Administrator enables public discovery.</p></div>}
    </main>
    {selected&&<div className="directory-modal-wrap" onMouseDown={(event)=>event.target===event.currentTarget&&setSelected(null)}><section className="directory-modal" role="dialog" aria-modal="true" aria-labelledby="directory-request-title">
      <header><div><span className="eyebrow">ASSOCIATION REQUEST</span><h2 id="directory-request-title">Request to join {selected.displayName}</h2></div><button aria-label="Close request form" onClick={()=>setSelected(null)}><X/></button></header>
      <p>Your details go only to this organization’s Manager and Administrator review queue.</p>
      <form onSubmit={submit}><label>Business email<input name="email" type="email" required autoFocus placeholder="you@company.com"/></label><label>Your company name<input name="companyName" required minLength={2} maxLength={160} placeholder="Acme Industries"/></label><label>How would you like to work together?<textarea name="message" required minLength={5} maxLength={2000} placeholder="Tell the organization what you need or why you want to become a customer."/></label><button className="button primary" disabled={busy}>{busy?<><RefreshCw/>Submitting…</>:<>Send request <ArrowRight/></>}</button></form>
    </section></div>}
  </div>;
}

export function JoinRequestsPage({ onCustomerCreated }: { onCustomerCreated?: () => Promise<void> }) {
  const [items, setItems] = useState<JoinRequest[]>([]);
  const [teams, setTeams] = useState<SalesTeam[]>([]);
  const [status, setStatus] = useState<'PENDING'|'APPROVED'|'DECLINED'>('PENDING');
  const [selectedId, setSelectedId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [repId, setRepId] = useState('');
  const [tier, setTier] = useState('Gold');
  const [currency, setCurrency] = useState('INR');
  const [declineReason, setDeclineReason] = useState('');
  const [decisionMode, setDecisionMode] = useState<'APPROVE'|'DECLINE'>('APPROVE');
  const [credentials, setCredentials] = useState<{ email:string; password:string; signInPath:string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [requests, teamResult] = await Promise.all([
        request<{ items: JoinRequest[] }>(`/directory/join-requests?status=${status}`),
        request<{ items: SalesTeam[] }>('/sales-teams'),
      ]);
      setItems(requests.items);
      setTeams(teamResult.items);
      setSelectedId((current) => requests.items.some((item)=>item.id===current) ? current : requests.items[0]?.id ?? '');
      setTeamId((current) => teamResult.items.some((team)=>team.id===current) ? current : teamResult.items[0]?.id ?? '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load join requests.');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(()=>{void load()}, [load]);
  const selected = items.find((item)=>item.id===selectedId) ?? items[0];
  const selectedTeam = teams.find((team)=>team.id===teamId);
  useEffect(()=>{setRepId((current)=>selectedTeam?.representatives.some((rep)=>rep.id===current)?current:selectedTeam?.representatives[0]?.id??'')},[selectedTeam]);
  useEffect(()=>{setDecisionMode('APPROVE');setDeclineReason('');setError('')},[selectedId,status]);

  const approve = async () => {
    if (!selected || !teamId || !repId) return;
    setBusy(true);setError('');setCredentials(null);
    try {
      const result = await request<{ credentials:{email:string;password:string;signInPath:string}|null; accountReady?:boolean }>(`/directory/join-requests/${selected.id}/approve`, { method:'POST', body:JSON.stringify({primarySalesTeamId:teamId,primaryRepId:repId,collaboratorIds:[],customerTier:tier,currency}) });
      setCredentials(result.credentials?.password ? result.credentials : null);
      await onCustomerCreated?.();
      await load();
    } catch (cause) { setError(cause instanceof Error?cause.message:'Could not approve this request.'); }
    finally { setBusy(false); }
  };
  const decline = async () => {
    if (!selected) return;
    setBusy(true);setError('');
    try {
      await request(`/directory/join-requests/${selected.id}/decline`, {method:'POST',body:JSON.stringify({reason:declineReason})});
      setDeclineReason('');
      await load();
    } catch (cause) { setError(cause instanceof Error?cause.message:'Could not decline this request.'); }
    finally { setBusy(false); }
  };

  return <div className="join-requests-page">
    <div className="join-requests-intro">
      <div><span className="eyebrow">CUSTOMER DISCOVERY</span><h2>Join requests</h2><p>Review customer interest, assign the account team, and send the selected offering into the governed lead or quotation flow.</p></div>
      <button className="button ghost join-refresh" onClick={()=>void load()} disabled={loading}><RefreshCw className={loading?'spin':''}/>Refresh</button>
    </div>

    <div className="join-status-tabs" role="tablist" aria-label="Request status">
      {(['PENDING','APPROVED','DECLINED'] as const).map((value)=><button role="tab" aria-selected={status===value} className={status===value?'active':''} onClick={()=>{setStatus(value);setCredentials(null)}} key={value}>
        {value==='PENDING'?<Clock3/>:value==='APPROVED'?<CheckCircle2/>:<CircleX/>}<span>{value.toLowerCase()}</span>{status===value&&!loading&&<em>{items.length}</em>}
      </button>)}
    </div>

    {error&&<div className="directory-error join-request-error" role="alert"><ShieldAlert/>{error}</div>}
    {credentials&&<OneTimeCredentials credentials={credentials} onClose={()=>setCredentials(null)}/>}

    {loading?<div className="directory-loading join-request-loading"><RefreshCw/>Loading requests…</div>:items.length?<div className="join-request-layout">
      <aside aria-label={`${status.toLowerCase()} requests`}>
        <div className="request-list-head"><span>{status.toLowerCase()} requests</span><b>{items.length}</b></div>
        <div className="request-list-items">{items.map((item)=>{
          const active=item.id===selected?.id;
          const initials=item.companyName.split(' ').map((part)=>part[0]).join('').slice(0,2).toUpperCase();
          return <button aria-pressed={active} className={active?'active':''} onClick={()=>setSelectedId(item.id)} key={item.id}>
            <span className="request-company-mark">{initials}</span>
            <span className="request-list-copy"><b>{item.companyName}</b><small>{item.email}</small><em>{prettyDate(item.createdAt)}</em></span>
            <ChevronRight/>
          </button>;
        })}</div>
      </aside>

      {selected&&<section className="join-request-detail" aria-labelledby="selected-request-title">
        <header className="request-detail-head">
          <span className="request-detail-icon"><Building2/></span>
          <div><span className={`status ${selected.status.toLowerCase()}`}>{selected.status.toLowerCase()}</span><h3 id="selected-request-title">{selected.companyName}</h3><div className="request-meta"><a href={`mailto:${selected.email}`}><Mail/>{selected.email}</a><span><CalendarDays/>Received {prettyDate(selected.createdAt)}</span></div></div>
        </header>

        <section className="request-message" aria-labelledby="request-message-title"><span className="eyebrow" id="request-message-title">CUSTOMER MESSAGE</span><blockquote>{selected.message}</blockquote>{selected.marketplaceInterest&&selected.requestedProduct&&<p><b>Selected offering:</b> {selected.requestedProduct.name}{selected.requestedQuantity?` · Quantity ${selected.requestedQuantity}`:''}{selected.contactName?` · Contact ${selected.contactName}`:''}</p>}</section>

        {selected.status==='PENDING'?<section className="request-decision" aria-labelledby="request-decision-title">
          <div className="request-decision-head"><div><span className="eyebrow">DECISION</span><h4 id="request-decision-title">Review this request</h4><p>Choose one action. Nothing is created until you approve.</p></div><div className="decision-mode-switch" role="tablist" aria-label="Decision action"><button type="button" role="tab" aria-selected={decisionMode==='APPROVE'} className={decisionMode==='APPROVE'?'active approve':''} onClick={()=>setDecisionMode('APPROVE')}><Check/>Approve</button><button type="button" role="tab" aria-selected={decisionMode==='DECLINE'} className={decisionMode==='DECLINE'?'active decline':''} onClick={()=>setDecisionMode('DECLINE')}><X/>Decline</button></div></div>

          {decisionMode==='APPROVE'?<div className="approval-workspace">
            <div className="decision-explainer approve"><UserRoundCheck/><span><b>Approve and configure customer access</b><small>{selected.marketplaceInterest?'This connects the existing customer login, assigns ownership, and starts the governed sales intake.':'This creates the customer profile, assigns ownership, and generates one-time portal credentials.'}</small></span></div>
            <div className="approval-fields">
              <fieldset><legend>Account ownership</legend><div className="join-pair"><label>Primary sales team<select value={teamId} onChange={(event)=>setTeamId(event.target.value)}>{teams.map((team)=><option value={team.id} key={team.id}>{team.name}</option>)}</select></label><label>Primary representative<select value={repId} onChange={(event)=>setRepId(event.target.value)} disabled={!selectedTeam?.representatives.length}>{selectedTeam?.representatives.map((rep)=><option value={rep.id} key={rep.id}>{rep.name}</option>)}</select></label></div></fieldset>
              <fieldset><legend>Commercial profile</legend><div className="join-pair"><label>Customer tier<select value={tier} onChange={(event)=>setTier(event.target.value)}><option>Bronze</option><option>Silver</option><option>Gold</option><option>Enterprise</option></select></label><label>Currency<input value={currency} maxLength={3} onChange={(event)=>setCurrency(event.target.value.toUpperCase())}/></label></div></fieldset>
            </div>
            <div className="decision-action-row"><p><ShieldCheck/>The customer will be active immediately after approval.</p><button className="button primary" onClick={approve} disabled={busy||!teamId||!repId}>{busy?<><RefreshCw className="spin"/>Creating customer…</>:'Approve & create customer'}</button></div>
          </div>:<div className="decline-workspace">
            <div className="decision-explainer decline"><ShieldAlert/><span><b>Decline this association request</b><small>No customer account or portal access will be created. The reason is retained in request history.</small></span></div>
            <label>Decision reason<textarea aria-label="Decision reason" value={declineReason} minLength={5} maxLength={1000} onChange={(event)=>setDeclineReason(event.target.value)} placeholder="Explain why this request is not being accepted."/><small>{declineReason.trim().length}/1000 characters · minimum 5</small></label>
            <div className="decision-action-row decline"><button type="button" className="button ghost" onClick={()=>{setDecisionMode('APPROVE');setDeclineReason('')}}>Back to approval</button><button className="button danger" onClick={decline} disabled={busy||declineReason.trim().length<5}>{busy?<><RefreshCw className="spin"/>Declining…</>:'Decline request'}</button></div>
          </div>}
        </section>:<section className={`request-outcome ${selected.status.toLowerCase()}`}>
          <div className="request-outcome-title">{selected.status==='APPROVED'?<CheckCircle2/>:<CircleX/>}<span><b>Request {selected.status.toLowerCase()}</b><small>This decision is complete and retained in request history.</small></span></div>
          <dl><div><dt>Decided by</dt><dd>{selected.decidedBy?.name??'—'}</dd></div><div><dt>Decision time</dt><dd>{selected.decidedAt?prettyDate(selected.decidedAt):'—'}</dd></div><div><dt>{selected.status==='APPROVED'?'Customer created':'Decision reason'}</dt><dd>{selected.resultingCustomer?.name??selected.decisionReason??'No customer created'}</dd></div></dl>
        </section>}
      </section>}
    </div>:<div className="directory-empty join-request-empty"><ShieldCheck/><h3>No {status.toLowerCase()} requests</h3><p>{status==='PENDING'?'New public association requests will appear here for review.':'Completed requests will appear here as an audit-friendly history.'}</p></div>}
  </div>;
}

function OneTimeCredentials({credentials,onClose}:{credentials:{email:string;password:string;signInPath:string};onClose:()=>void}) {
  const copy = () => navigator.clipboard.writeText(`Email: ${credentials.email}\nTemporary password: ${credentials.password}\nSign in: ${window.location.origin}${credentials.signInPath}`);
  return <section className="directory-credentials" role="status"><header><span><Check/>Customer access created</span><button aria-label="Dismiss credentials" onClick={onClose}><X/></button></header><p>Copy these credentials now. The password is returned only by this approval response and is not available from request history.</p><dl><div><dt>Email</dt><dd><code>{credentials.email}</code></dd></div><div><dt>Temporary password</dt><dd><code>{credentials.password}</code></dd></div><div><dt>Sign-in page</dt><dd><code>{credentials.signInPath}</code></dd></div></dl><button className="button primary" onClick={copy}><Copy/>Copy credentials</button></section>;
}

export function DirectoryProfileSettings() {
  const [profile,setProfile]=useState<DirectoryProfile|null>(null);
  const [saved,setSaved]=useState<DirectoryProfile|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [success,setSuccess]=useState('');
  useEffect(()=>{request<DirectoryProfile>('/settings/directory-profile').then((result)=>{setProfile(result);setSaved(result)}).catch((cause)=>setError(cause instanceof Error?cause.message:'Could not load directory settings.'))},[]);
  const dirty=useMemo(()=>JSON.stringify(profile)!==JSON.stringify(saved),[profile,saved]);
  const save=async()=>{
    if(!profile)return;setBusy(true);setError('');setSuccess('');
    try{const result=await request<DirectoryProfile>('/settings/directory-profile',{method:'PUT',body:JSON.stringify({displayName:profile.displayName,shortDescription:profile.shortDescription||null,category:profile.category||null,isDiscoverable:profile.isDiscoverable})});setProfile(result);setSaved(result);setSuccess(result.isDiscoverable?'Your organization is now visible in the public business directory.':'Your organization is hidden from the public business directory.')}catch(cause){setError(cause instanceof Error?cause.message:'Could not save directory settings.')}finally{setBusy(false)}
  };
  if(!profile)return <section className="directory-profile-settings"><RefreshCw/>Loading directory settings…{error&&<p role="alert">{error}</p>}</section>;
  return <section className="directory-profile-settings" aria-labelledby="directory-profile-title"><div><span className="eyebrow">PUBLIC DISCOVERY</span><h3 id="directory-profile-title">Business directory profile</h3><p>Only the fields below are public. Catalog prices, costs, stock, users, customers, and internal organization data are never included.</p></div><label>Public display name<input value={profile.displayName} minLength={2} maxLength={120} onChange={(event)=>setProfile({...profile,displayName:event.target.value})}/></label><label>Category<input value={profile.category??''} maxLength={80} onChange={(event)=>setProfile({...profile,category:event.target.value})} placeholder="Technology services"/></label><label>Short description<textarea value={profile.shortDescription??''} maxLength={500} onChange={(event)=>setProfile({...profile,shortDescription:event.target.value})} placeholder="Describe what your business offers without sharing pricing or internal details."/></label><label className="directory-discoverable"><span><b>Show in public directory</b><small>Visitors can view this profile and submit a request to join.</small></span><input type="checkbox" checked={profile.isDiscoverable} onChange={(event)=>setProfile({...profile,isDiscoverable:event.target.checked})}/></label>{error&&<p className="directory-setting-error" role="alert">{error}</p>}{success&&<p className="directory-setting-success" role="status">{success}</p>}<button className="button primary" disabled={busy||!dirty||profile.displayName.trim().length<2} onClick={save}>{busy?'Saving…':'Save directory profile'}</button></section>;
}
