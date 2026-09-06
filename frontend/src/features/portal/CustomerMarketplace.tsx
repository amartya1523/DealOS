import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowRight, Building2, Check, CheckCircle2, Clock3, PackageSearch, RefreshCw, Search, Send, ShieldCheck, Store } from 'lucide-react';
import { request } from '../../api';
import './customer-marketplace.css';

export type MarketplaceBusiness = {
  id:string;displayName:string;shortDescription:string|null;category:string|null;offeringCount?:number;
  relationship:'ACTIVE'|'CONNECTED'|'PENDING'|'AVAILABLE';
};
type Offering = {id:string;name:string;sku:string;category:string;description:string;unit:string;recurring:boolean;cadence:string|null;featured:boolean};
type BusinessDetail = Omit<MarketplaceBusiness,'relationship'|'offeringCount'>&{products:Offering[]};

const relationshipLabel=(relationship:MarketplaceBusiness['relationship'])=>relationship==='ACTIVE'?'Active deal room':relationship==='CONNECTED'?'Connected':relationship==='PENDING'?'Under review':'Available';

export function CustomerMarketplace({companyName,currentOrganizationId,onWorkspaceChanged}:{companyName:string;currentOrganizationId:string;onWorkspaceChanged:()=>Promise<void>}) {
  const[businesses,setBusinesses]=useState<MarketplaceBusiness[]>([]);
  const[selectedId,setSelectedId]=useState('');
  const[detail,setDetail]=useState<BusinessDetail|null>(null);
  const[productId,setProductId]=useState('');
  const[quantity,setQuantity]=useState(1);
  const[message,setMessage]=useState('');
  const[search,setSearch]=useState('');
  const[loading,setLoading]=useState(true);
  const[detailLoading,setDetailLoading]=useState(false);
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState('');
  const[notice,setNotice]=useState('');

  const load=async()=>{
    setLoading(true);setError('');
    try{
      const result=await request<{items:MarketplaceBusiness[]}>('/portal/organizations');
      const items=Array.isArray(result?.items)?result.items:[];
      setBusinesses(items);
      setSelectedId(current=>items.some(item=>item.id===current)?current:items.find(item=>item.id===currentOrganizationId)?.id||items[0]?.id||'');
    }catch(cause){setError(cause instanceof Error?cause.message:'Could not load organizations.')}finally{setLoading(false)}
  };
  useEffect(()=>{void load()},[]);
  useEffect(()=>{
    if(!selectedId){setDetail(null);setProductId('');return}
    let current=true;setDetailLoading(true);setDetail(null);setError('');setNotice('');setMessage('');setQuantity(1);
    request<BusinessDetail>(`/portal/organizations/${selectedId}`).then(result=>{if(current){setDetail(result);setProductId(result.products[0]?.id??'')}}).catch(cause=>{if(current)setError(cause instanceof Error?cause.message:'Could not load this organization.')}).finally(()=>{if(current)setDetailLoading(false)});
    return()=>{current=false};
  },[selectedId]);
  const visible=useMemo(()=>businesses.filter(item=>`${item.displayName} ${item.category??''} ${item.shortDescription??''}`.toLowerCase().includes(search.trim().toLowerCase())),[businesses,search]);
  const selected=businesses.find(item=>item.id===selectedId);
  const selectedProduct=detail?.products.find(item=>item.id===productId);
  const connected=selected&&['ACTIVE','CONNECTED'].includes(selected.relationship);

  const submit=async(event:FormEvent)=>{
    event.preventDefault();if(!selected||!productId)return;setBusy(true);setError('');setNotice('');
    try{
      const result=await request<{kind:'QUOTE_REQUEST'|'RELATIONSHIP_REQUEST'}>(`/portal/organizations/${selected.id}/interest`,{method:'POST',body:JSON.stringify({companyName,message:message.trim(),productId,quantity})});
      setMessage('');setQuantity(1);
      setNotice(result.kind==='QUOTE_REQUEST'?`Quotation request sent to ${selected.displayName}. Your assigned representative has been notified.`:`Interest sent to ${selected.displayName}. Their team will review the relationship and assign a representative before preparing a quotation.`);
      await load();
    }catch(cause){setError(cause instanceof Error?cause.message:'Could not send your request.')}finally{setBusy(false)}
  };
  const openWorkspace=async()=>{
    if(!selected)return;setBusy(true);setError('');
    try{await request(`/portal/organizations/${selected.id}/open`,{method:'POST',body:'{}'});await onWorkspaceChanged()}catch(cause){setError(cause instanceof Error?cause.message:'Could not open this deal room.')}finally{setBusy(false)}
  };

  return <section className="customer-marketplace" aria-labelledby="marketplace-title">
    <div className="marketplace-summary"><div><span className="eyebrow">VERIFIED BUSINESS DIRECTORY</span><h2 id="marketplace-title">Explore trusted sellers</h2><p>Choose an organization, compare its customer-visible catalog, then send a structured business enquiry.</p></div><div className="marketplace-guard"><ShieldCheck/><span><b>Governed from first contact</b><small>Seller review → representative assignment → quotation</small></span></div></div>
    {error&&<div className="marketplace-alert error" role="alert">{error}</div>}
    {notice&&<div className="marketplace-alert success" role="status"><CheckCircle2/>{notice}</div>}
    <div className="marketplace-layout">
      <aside className="marketplace-organizations" aria-label="Organizations">
        <div className="marketplace-directory-head"><span><Store/><b>Organizations</b></span><small>{businesses.length} available</small></div>
        <label className="marketplace-search"><Search/><input aria-label="Search organizations" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search by name or category"/></label>
        <div className="marketplace-organization-list">{loading?<div className="marketplace-loading"><RefreshCw className="spin"/>Loading organizations…</div>:visible.map(item=><button type="button" key={item.id} className={item.id===selectedId?'active':''} aria-pressed={item.id===selectedId} onClick={()=>setSelectedId(item.id)}><span className="marketplace-logo"><Building2/></span><span className="marketplace-org-copy"><b>{item.displayName}</b><small>{item.category??'Business services'}</small></span><em className={item.relationship.toLowerCase()}>{relationshipLabel(item.relationship)}</em><ArrowRight className="marketplace-org-arrow"/></button>)}{!loading&&!visible.length&&<div className="marketplace-loading"><Store/>No matching organizations.</div>}</div>
      </aside>
      <div className="marketplace-detail">
        {detailLoading?<div className="marketplace-empty"><RefreshCw className="spin"/><b>Opening organization catalog</b><p>Loading customer-visible products and services…</p></div>:detail&&selected?<>
          <header className="marketplace-business-head"><div><span className="eyebrow">{detail.category??'VERIFIED ORGANIZATION'}</span><h3>{detail.displayName}</h3><p>{detail.shortDescription||'Explore this organization’s customer-visible products and services.'}</p></div><div className="marketplace-business-actions"><span className={`relationship-pill ${selected.relationship.toLowerCase()}`}><Check/>{relationshipLabel(selected.relationship)}</span>{connected&&selected.id!==currentOrganizationId&&<button className="button ghost" onClick={openWorkspace} disabled={busy}>Open deal room <ArrowRight/></button>}</div></header>
          <div className="marketplace-section-title"><div><span>01</span><p><b>Select a product or service</b><small>Pricing is prepared after the seller understands your requirements.</small></p></div><em>{detail.products.length} offering{detail.products.length===1?'':'s'}</em></div>
          <div className="marketplace-offerings">{detail.products.map(product=><button type="button" key={product.id} className={product.id===productId?'selected':''} aria-pressed={product.id===productId} onClick={()=>setProductId(product.id)}><div className="offering-card-top"><span>{product.featured?'Featured':product.category}</span>{product.id===productId&&<i><Check/>Selected</i>}</div><PackageSearch/><h4>{product.name}</h4><p>{product.description}</p><small>{product.recurring?product.cadence||'Recurring service':`Per ${product.unit}`}<b>Pricing on request</b></small></button>)}{!detail.products.length&&<div className="marketplace-empty"><PackageSearch/><b>No public offerings yet</b><p>This organization has not published customer-visible catalog items.</p></div>}</div>
          {detail.products.length>0&&<form className="marketplace-interest" onSubmit={submit}><div className="marketplace-interest-heading"><span>02</span><div><small>{connected?'REQUEST QUOTATION':'START RELATIONSHIP'}</small><h4>Tell {detail.displayName} what you need</h4><p>{selected.relationship==='PENDING'?'Your earlier request is already under review. You will be notified when the seller assigns your account.':connected?'This goes directly to your assigned representative as a quotation request.':'The seller reviews this enquiry and assigns a representative before any quotation is prepared.'}</p></div></div><div className="marketplace-selected-product"><PackageSearch/><span><small>SELECTED OFFERING</small><b>{selectedProduct?.name}</b></span><label>Quantity<input aria-label="Quantity" type="number" min="0.001" step="0.001" value={quantity} onChange={event=>setQuantity(Number(event.target.value))}/></label></div><label className="marketplace-requirements">Requirements<textarea aria-label="Requirements" required minLength={5} maxLength={2000} value={message} onChange={event=>setMessage(event.target.value)} placeholder="Describe scope, timing, specifications, delivery location, and any constraints."/><small>{message.length}/2000</small></label><div className="marketplace-submit-row"><p><ShieldCheck/>No price or commitment is created by this enquiry.</p><button className="button primary" disabled={busy||selected.relationship==='PENDING'||message.trim().length<5}>{selected.relationship==='PENDING'?<><Clock3/>Awaiting seller review</>:busy?<><RefreshCw className="spin"/>Sending…</>:<><Send/>{connected?'Request quotation':'Send interest'}</>}</button></div></form>}
        </>:<div className="marketplace-empty"><Building2/><b>Select an organization</b><p>Its customer-visible products and services will appear here.</p></div>}
      </div>
    </div>
  </section>;
}
