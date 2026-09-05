import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { AlertTriangle, ChevronRight, Columns3, List, Plus, RefreshCw, Search, ShieldAlert, X } from 'lucide-react';
import { ApiError, request, type CustomerOption, type QuotationStage, type QuotationSummary, type QuotationsResponse, type Workspace } from '../../api';

type Layout = 'board'|'table';
type Sort = 'activity_desc'|'activity_asc'|'amount_desc'|'amount_asc'|'quotation_asc'|'quotation_desc';
type ActivityPeriod = 'all'|'7d'|'30d'|'90d';

const primaryStages:QuotationStage[] = ['DRAFT','PENDING_APPROVAL','APPROVED','NEGOTIATION','CONFIRMED'];
const stageLabel:Record<QuotationStage,string> = {
  DRAFT:'Draft', PENDING_APPROVAL:'Pending Approval', APPROVED:'Approved', NEGOTIATION:'Negotiation', CONFIRMED:'Confirmed', REJECTED:'Rejected',
};
const queryKey = {
  search:'quoteSearch', stage:'quoteStage', customer:'quoteCustomer', owner:'quoteOwner', activity:'quoteActivity', sort:'quoteSort', layout:'quoteLayout', create:'newQuotation',
} as const;

function initialParam(name:string) { return new URLSearchParams(window.location.search).get(name) ?? ''; }
function validLayout(value:string|null):Layout { return value === 'table' ? 'table' : 'board'; }
function money(value:string,currency:string) { return new Intl.NumberFormat('en-IN',{style:'currency',currency:currency || 'INR',maximumFractionDigits:0}).format(Number(value)); }
function shortDate(value:string) { return new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric'}).format(new Date(value)); }
function toIsoDate(value:string) { return value ? new Date(`${value}T12:00:00.000Z`).toISOString() : undefined; }

export function QuotationsPage({user,openQuote,onCreated}:{
  user:Workspace['user'];
  openQuote:(quoteId:string,revisionId:string|null)=>void;
  onCreated:(quoteId:string,revisionId:string|null)=>Promise<void>;
}) {
  const storedLayout = (()=>{try{return localStorage.getItem('dealos.quotationLayout')}catch{return null}})();
  const [layout,setLayoutState] = useState<Layout>(()=>validLayout(initialParam(queryKey.layout)||storedLayout));
  const [search,setSearch] = useState(()=>initialParam(queryKey.search));
  const [debouncedSearch,setDebouncedSearch] = useState(search);
  const [stage,setStage] = useState(()=>initialParam(queryKey.stage) as QuotationStage|'' );
  const [customerId,setCustomerId] = useState(()=>initialParam(queryKey.customer));
  const [ownerId,setOwnerId] = useState(()=>initialParam(queryKey.owner));
  const [activityPeriod,setActivityPeriod] = useState<ActivityPeriod>(()=>(initialParam(queryKey.activity) as ActivityPeriod)||'all');
  const [sort,setSort] = useState<Sort>(()=>(initialParam(queryKey.sort) as Sort)||'activity_desc');
  const [result,setResult] = useState<QuotationsResponse|null>(null);
  const [customers,setCustomers] = useState<CustomerOption[]>([]);
  const [loading,setLoading] = useState(true);
  const [loadingMore,setLoadingMore] = useState(false);
  const [error,setError] = useState('');
  const [retryKey,setRetryKey] = useState(0);
  const [newOpen,setNewOpen] = useState(()=>initialParam(queryKey.create)==='1');

  const canCreate = ['REP','ADMIN'].includes(user.role);
  const readOnly = Boolean(user.viewContext?.readOnly);

  useEffect(()=>{const timer=window.setTimeout(()=>setDebouncedSearch(search.trim()),250);return()=>window.clearTimeout(timer)},[search]);

  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const assign=(key:string,value:string,defaultValue='')=>value&&value!==defaultValue?params.set(key,value):params.delete(key);
    assign(queryKey.search,search); assign(queryKey.stage,stage); assign(queryKey.customer,customerId); assign(queryKey.owner,ownerId);
    assign(queryKey.activity,activityPeriod,'all'); assign(queryKey.sort,sort,'activity_desc'); assign(queryKey.layout,layout,'board');
    assign(queryKey.create,newOpen?'1':'');
    const suffix=params.toString(); window.history.replaceState({},'',`${window.location.pathname}${suffix?`?${suffix}`:''}`);
  },[search,stage,customerId,ownerId,activityPeriod,sort,layout,newOpen]);

  useEffect(()=>{
    const controller=new AbortController();
    request<{items:CustomerOption[]}>('/customers?limit=200',{signal:controller.signal}).then(data=>setCustomers(data.items)).catch(error=>{if((error as Error).name!=='AbortError')setError(error instanceof Error?error.message:'Unable to load customers.')});
    return()=>controller.abort();
  },[retryKey]);

  const query=useMemo(()=>{
    const params=new URLSearchParams({limit:'100',activityPeriod,sort});
    if(debouncedSearch)params.set('search',debouncedSearch);
    if(stage)params.set('stage',stage);
    if(customerId)params.set('customerId',customerId);
    if(ownerId)params.set('ownerId',ownerId);
    return params;
  },[debouncedSearch,stage,customerId,ownerId,activityPeriod,sort]);

  useEffect(()=>{
    const controller=new AbortController(); setLoading(true); setError('');
    request<QuotationsResponse>(`/quotations?${query}`,{signal:controller.signal}).then(setResult).catch(error=>{if((error as Error).name!=='AbortError')setError(error instanceof Error?error.message:'Unable to load quotations.')}).finally(()=>setLoading(false));
    return()=>controller.abort();
  },[query,retryKey]);

  const setLayout=(next:Layout)=>{setLayoutState(next);try{localStorage.setItem('dealos.quotationLayout',next)}catch{ /* Device preference is optional. */ }};
  const clearFilters=()=>{setSearch('');setStage('');setCustomerId('');setOwnerId('');setActivityPeriod('all');setSort('activity_desc')};
  const hasFilters=Boolean(search||stage||customerId||ownerId||activityPeriod!=='all'||sort!=='activity_desc');
  const changeStage=(next:string)=>{const value=next as QuotationStage|'';setStage(value);if(value==='REJECTED')setLayout('table')};
  const loadMore=async()=>{
    if(!result?.pagination.nextCursor)return; setLoadingMore(true); setError('');
    try{const next=await request<QuotationsResponse>(`/quotations?${query}&cursor=${encodeURIComponent(result.pagination.nextCursor)}`);setResult({...next,items:[...result.items,...next.items]})}
    catch(error){setError(error instanceof Error?error.message:'Unable to load more quotations.')}finally{setLoadingMore(false)}
  };

  return <section className="quotations-page" aria-labelledby="quotation-list-title">
    <div className="module-intro"><div><h2 id="quotation-list-title">Quotations</h2><p>Track every authorized quotation from draft through confirmation.</p></div>{canCreate&&<button className="button primary" onClick={()=>setNewOpen(true)} disabled={readOnly} title={readOnly?'View As mode is read-only.':undefined}><Plus/>New quotation</button>}</div>
    {readOnly&&<div className="read-only-note"><ShieldAlert/>You are viewing this organization in read-only mode.</div>}
    <div className="quotation-toolbar">
      <label className="quotation-search"><span className="sr-only">Search quotations</span><Search/><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search number, customer or owner"/></label>
      <div className="view-switch" role="group" aria-label="Quotation layout">
        <button type="button" aria-pressed={layout==='board'} onClick={()=>setLayout('board')}><Columns3/>Board</button>
        <button type="button" aria-pressed={layout==='table'} onClick={()=>setLayout('table')}><List/>Table</button>
      </div>
    </div>
    <div className="quotation-filters" aria-label="Quotation filters">
      <label>Stage<select value={stage} onChange={event=>changeStage(event.target.value)}><option value="">All stages</option>{primaryStages.map(value=><option key={value} value={value}>{stageLabel[value]}</option>)}<option value="REJECTED">Rejected</option></select></label>
      <label>Customer<select value={customerId} onChange={event=>setCustomerId(event.target.value)}><option value="">All customers</option>{customers.map(customer=><option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
      <label>Owner<select value={ownerId} onChange={event=>setOwnerId(event.target.value)} disabled={user.role==='REP'}><option value="">{user.role==='REP'?'My quotations':'All owners'}</option>{result?.owners.map(owner=><option key={owner.id} value={owner.id}>{owner.name}</option>)}</select></label>
      <label>Activity<select value={activityPeriod} onChange={event=>setActivityPeriod(event.target.value as ActivityPeriod)}><option value="all">Any time</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="90d">Last 90 days</option></select></label>
      <label>Sort<select value={sort} onChange={event=>setSort(event.target.value as Sort)}><option value="activity_desc">Recent activity</option><option value="activity_asc">Oldest activity</option><option value="amount_desc">Amount: high to low</option><option value="amount_asc">Amount: low to high</option><option value="quotation_asc">Quotation: A–Z</option><option value="quotation_desc">Quotation: Z–A</option></select></label>
      <button className="clear-filters" onClick={clearFilters} disabled={!hasFilters}><X/>Clear filters</button>
    </div>
    <div className="result-summary" aria-live="polite">{loading?'Loading quotations…':`${result?.pagination.total??0} quotation${result?.pagination.total===1?'':'s'}`}</div>
    {layout==='board'&&Boolean(result?.stageCounts.REJECTED)&&<div className="rejected-note"><span>{result!.stageCounts.REJECTED} rejected quotation{result!.stageCounts.REJECTED===1?' is':'s are'} available in Table view.</span><button onClick={()=>{setStage('REJECTED');setLayout('table')}}>View rejected</button></div>}
    {error&&<div className="quotation-error" role="alert"><AlertTriangle/><span>{error}</span><button onClick={()=>setRetryKey(value=>value+1)}><RefreshCw/>Retry</button></div>}
    {loading?<QuotationSkeleton layout={layout}/>:result?.items.length===0?<div className="quotation-empty"><Columns3/><h3>{hasFilters?'No quotations match these filters.':'No quotations yet.'}</h3><p>{hasFilters?'Clear or adjust the filters to see more results.':'Create the first quotation for an active customer.'}</p>{hasFilters&&<button className="button ghost" onClick={clearFilters}>Clear filters</button>}</div>:layout==='board'?<QuotationBoard items={result?.items??[]} counts={result?.stageCounts} openQuote={openQuote}/>:<QuotationTable items={result?.items??[]} openQuote={openQuote}/>} 
    {result?.pagination.nextCursor&&<div className="load-more"><button className="button ghost" onClick={loadMore} disabled={loadingMore}>{loadingMore?<><RefreshCw className="spin"/>Loading…</>:`Load more (${result.items.length} of ${result.pagination.total})`}</button></div>}
    {newOpen&&<NewQuotationDialog customers={customers} close={()=>setNewOpen(false)} onCreated={onCreated}/>} 
  </section>;
}

function QuotationBoard({items,counts,openQuote}:{items:QuotationSummary[];counts?:Record<QuotationStage,number>;openQuote:(id:string,revisionId:string|null)=>void}) {
  return <div className="quotation-board" aria-label="Quotation pipeline">{primaryStages.map(stage=><section className="quotation-lane" key={stage} aria-labelledby={`stage-${stage}`}><div className="quotation-lane-title"><h3 id={`stage-${stage}`}>{stageLabel[stage]}</h3><span aria-label={`${counts?.[stage]??0} quotations`}>{counts?.[stage]??0}</span></div><div className="quotation-cards">{items.filter(item=>item.stage===stage).map(item=><QuotationCard key={item.id} item={item} openQuote={openQuote}/>)}{!items.some(item=>item.stage===stage)&&<p className="lane-empty">No quotations</p>}</div></section>)}</div>;
}

function QuotationCard({item,openQuote}:{item:QuotationSummary;openQuote:(id:string,revisionId:string|null)=>void}) {
  return <button className="quotation-card" onClick={()=>openQuote(item.id,item.currentRevisionId)} aria-label={`Open ${item.number} for ${item.customer.name}`}><span className="quotation-card-top"><b>{item.number}</b><span className={`status ${item.stage.toLowerCase()}`}>{stageLabel[item.stage]}</span></span><strong>{item.customer.name}</strong><span className="quotation-amount">{money(item.total,item.currency)}</span><span className="quotation-card-meta"><span>Owner<b>{item.owner.name}</b></span><span>Last activity<b>{shortDate(item.lastActivityAt)}</b></span></span>{(Number(item.riskScore)>0||item.currentApprovalStep)&&<span className="quotation-signal">{item.currentApprovalStep??`${item.riskScore} risk points`}</span>}</button>;
}

function QuotationTable({items,openQuote}:{items:QuotationSummary[];openQuote:(id:string,revisionId:string|null)=>void}) {
  return <div className="quotation-table panel"><div className="table-wrap"><table><caption className="sr-only">Quotation list</caption><thead><tr><th>Quotation</th><th>Customer</th><th>Amount</th><th>Owner</th><th>Stage</th><th>Current approval</th><th>Last activity</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{items.map(item=><tr key={item.id}><td><b>{item.number}</b><small>Revision {item.version}</small></td><td><b>{item.customer.name}</b><small>{item.customer.tier}</small></td><td>{money(item.total,item.currency)}</td><td>{item.owner.name}</td><td><span className={`status ${item.stage.toLowerCase()}`}>{stageLabel[item.stage]}</span></td><td>{item.currentApprovalStep??'—'}</td><td>{shortDate(item.lastActivityAt)}</td><td><button className="open-quotation" onClick={()=>openQuote(item.id,item.currentRevisionId)}>Open<ChevronRight/></button></td></tr>)}</tbody></table></div></div>;
}

function QuotationSkeleton({layout}:{layout:Layout}) { return <div className={`quotation-skeleton ${layout}`} role="status" aria-label="Loading quotation list">{Array.from({length:layout==='board'?5:6},(_,index)=><span key={index}/>)}</div>; }

function NewQuotationDialog({customers,close,onCreated}:{customers:CustomerOption[];close:()=>void;onCreated:(id:string,revisionId:string|null)=>Promise<void>}) {
  const dialogRef=useRef<HTMLDivElement>(null); const customerRef=useRef<HTMLSelectElement>(null);
  const [submitting,setSubmitting]=useState(false); const [formError,setFormError]=useState('');
  const [customerId,setCustomerId]=useState(''); const selected=customers.find(customer=>customer.id===customerId);
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;customerRef.current?.focus();const handle=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!submitting)close();if(event.key==='Tab'){const focusable=dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled),textarea:not(:disabled)');if(!focusable?.length)return;const first=focusable[0],last=focusable[focusable.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}}};document.addEventListener('keydown',handle);return()=>{document.removeEventListener('keydown',handle);previous?.focus()}},[close,submitting]);
  const submit=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();setFormError('');if(!customerId){setFormError('Select an active customer.');customerRef.current?.focus();return}const form=new FormData(event.currentTarget);setSubmitting(true);try{const quotation=await request<QuotationSummary>('/quotations',{method:'POST',body:JSON.stringify({customerId,validUntil:toIsoDate(String(form.get('validUntil')??'')),promisedDeliveryAt:toIsoDate(String(form.get('promisedDeliveryAt')??'')),terms:String(form.get('terms')??'').trim()||undefined})});close();await onCreated(quotation.id,quotation.currentRevisionId)}catch(error){setFormError(error instanceof ApiError?error.message:error instanceof Error?error.message:'Unable to create quotation.')}finally{setSubmitting(false)}};
  const backdropKey=(event:ReactKeyboardEvent<HTMLDivElement>)=>{if(event.key==='Escape'&&!submitting)close()};
  return <div className="quotation-dialog-backdrop" onMouseDown={event=>event.target===event.currentTarget&&!submitting&&close()} onKeyDown={backdropKey}><div className="quotation-dialog" role="dialog" aria-modal="true" aria-labelledby="new-quotation-title" aria-describedby="new-quotation-help" ref={dialogRef}><div className="quotation-dialog-head"><div><h2 id="new-quotation-title">New quotation</h2><p id="new-quotation-help">Start a draft using an active customer’s configured tier and currency.</p></div><button type="button" onClick={close} disabled={submitting} aria-label="Close new quotation dialog"><X/></button></div><form onSubmit={submit} noValidate><label>Customer<select ref={customerRef} value={customerId} onChange={event=>setCustomerId(event.target.value)} required aria-invalid={Boolean(formError&&!customerId)}><option value="">Select an active customer</option>{customers.map(customer=><option key={customer.id} value={customer.id}>{customer.name} · {customer.tier}</option>)}</select></label>{selected&&<div className="customer-context"><span>Tier <b>{selected.tier}</b></span><span>Currency <b>{selected.currency}</b></span></div>}<div className="quotation-date-grid"><label>Valid until <span>Optional</span><input type="date" name="validUntil" min={new Date(Date.now()+86400000).toISOString().slice(0,10)}/></label><label>Promised delivery <span>Optional</span><input type="date" name="promisedDeliveryAt"/></label></div><label>Commercial terms <span>Optional</span><textarea name="terms" maxLength={5000} placeholder="Payment, delivery or validity notes"/></label>{!customers.length&&<p className="dialog-hint">No active customers are available. Configure a customer before creating a quotation.</p>}{formError&&<p className="dialog-error" role="alert">{formError}</p>}<div className="quotation-dialog-actions"><button type="button" className="button ghost" onClick={close} disabled={submitting}>Cancel</button><button type="submit" className="button primary" disabled={submitting||!customers.length}>{submitting?<><RefreshCw className="spin"/>Creating…</>:<>Create draft<ChevronRight/></>}</button></div></form></div></div>;
}
