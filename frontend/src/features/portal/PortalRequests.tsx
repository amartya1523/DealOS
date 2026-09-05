import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardList, Plus, RefreshCw, Search, Send, Trash2 } from 'lucide-react';
import { request, type PortalRequest } from '../../api';
import './portal-requests.css';

type CatalogProduct = {id:string;name:string;sku:string;category:string;description:string;unit:string};
type DraftLine = {key:string;productId:string;freeTextDescription:string;quantity:string};

const newLine = ():DraftLine => ({key:crypto.randomUUID(),productId:'',freeTextDescription:'',quantity:'1'});
const statusLabel:Record<PortalRequest['status'],string> = {RECEIVED:'Received',IN_PROGRESS:'In progress',DECLINED:'Declined'};

export function PortalRequests() {
  const [requests,setRequests]=useState<PortalRequest[]>([]);
  const [catalog,setCatalog]=useState<CatalogProduct[]>([]);
  const [requirements,setRequirements]=useState('');
  const [preferredDate,setPreferredDate]=useState('');
  const [lines,setLines]=useState<DraftLine[]>([]);
  const [search,setSearch]=useState('');
  const [loading,setLoading]=useState(true);
  const [submitting,setSubmitting]=useState(false);
  const [error,setError]=useState('');
  const [success,setSuccess]=useState('');

  const load=async()=>{
    setLoading(true);setError('');
    try{
      const [history,products]=await Promise.all([
        request<{items:PortalRequest[]}>('/portal/requests'),
        request<{items:CatalogProduct[]}>('/portal/requests/catalog'),
      ]);
      setRequests(history.items);setCatalog(products.items);
    }catch(cause){setError(cause instanceof Error?cause.message:'Could not load quote requests.')}finally{setLoading(false)}
  };
  useEffect(()=>{void load()},[]);
  const visibleProducts=useMemo(()=>catalog.filter(product=>`${product.name} ${product.sku} ${product.category}`.toLowerCase().includes(search.toLowerCase())).slice(0,50),[catalog,search]);
  const updateLine=(key:string,patch:Partial<DraftLine>)=>setLines(current=>current.map(line=>line.key===key?{...line,...patch}:line));
  const submit=async(event:FormEvent)=>{
    event.preventDefault();setSubmitting(true);setError('');setSuccess('');
    try{
      await request('/portal/requests',{
        method:'POST',
        body:JSON.stringify({
          requirementsText:requirements.trim(),
          preferredDeliveryDate:preferredDate||null,
          lines:lines.filter(line=>line.productId||line.freeTextDescription.trim()).map(line=>({
            ...(line.productId?{productId:line.productId}:{}),
            ...(line.freeTextDescription.trim()?{freeTextDescription:line.freeTextDescription.trim()}:{}),
            ...(line.quantity?{quantity:Number(line.quantity)}:{}),
          })),
        }),
      });
      setRequirements('');setPreferredDate('');setLines([]);setSuccess('Your request was received. Your account representative has been notified.');await load();
    }catch(cause){setError(cause instanceof Error?cause.message:'Could not submit the request.')}finally{setSubmitting(false)}
  };

  return <section className="portal-requests" aria-labelledby="portal-request-title">
    <div className="portal-request-intro"><div><span className="eyebrow">REQUEST A QUOTE</span><h2 id="portal-request-title">Tell us what you need</h2><p>Choose catalog items when they match, or describe the requirement in your own words. Pricing is prepared privately by your account team.</p></div><ClipboardList/></div>
    {error&&<div className="portal-request-error" role="alert"><AlertTriangle/>{error}</div>}
    {success&&<div className="portal-request-success" role="status"><CheckCircle2/>{success}</div>}
    <form className="portal-request-form" onSubmit={submit}>
      <label>Requirements<textarea required minLength={5} maxLength={5000} value={requirements} onChange={event=>setRequirements(event.target.value)} placeholder="Describe the products, services, use case, timing, or constraints your representative should consider."/></label>
      <label>Preferred delivery date <span>Optional</span><input type="date" value={preferredDate} onChange={event=>setPreferredDate(event.target.value)}/></label>
      <div className="portal-request-lines-head"><div><b>Requested items</b><small>Optional structured lines</small></div><button className="button ghost" type="button" onClick={()=>setLines(current=>[...current,newLine()])}><Plus/>Add item</button></div>
      {lines.length>0&&<label className="portal-catalog-search"><span>Search the catalog</span><div><Search/><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Product name, SKU, or category"/></div></label>}
      <div className="portal-request-lines">{lines.map((line,index)=><fieldset key={line.key}><legend>Item {index+1}</legend><label>Catalog match <span>Optional</span><select value={line.productId} onChange={event=>updateLine(line.key,{productId:event.target.value})}><option value="">No exact match — use description</option>{visibleProducts.map(product=><option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}</select></label><label>Your description <span>{line.productId?'Optional context':'Required without a catalog match'}</span><input value={line.freeTextDescription} onChange={event=>updateLine(line.key,{freeTextDescription:event.target.value})} required={!line.productId} maxLength={1000} placeholder="Model, specification, or requested service"/></label><label>Quantity <span>Optional</span><input type="number" min="0.001" step="0.001" value={line.quantity} onChange={event=>updateLine(line.key,{quantity:event.target.value})}/></label><button type="button" className="icon-button" aria-label={`Remove item ${index+1}`} onClick={()=>setLines(current=>current.filter(item=>item.key!==line.key))}><Trash2/></button></fieldset>)}</div>
      <button className="button primary" disabled={submitting||requirements.trim().length<5}>{submitting?<><RefreshCw className="spin"/>Submitting…</>:<><Send/>Submit request</>}</button>
    </form>
    <div className="portal-request-history"><div><h3>Request status</h3><p>Only customer-safe progress is shown here. Draft quotation details remain private until your representative sends them.</p></div>{loading?<div className="portal-request-loading"><RefreshCw className="spin"/>Loading requests…</div>:requests.length?requests.map(item=><article key={item.id}><div><span className={`request-state ${item.status.toLowerCase()}`}>{statusLabel[item.status]}</span><small>{new Date(item.createdAt).toLocaleDateString()}</small></div><h4>{item.requirementsText}</h4>{item.preferredDeliveryDate&&<p>Preferred delivery: {new Date(item.preferredDeliveryDate).toLocaleDateString()}</p>}{item.lines.length>0&&<ul>{item.lines.map(line=><li key={line.id}>{line.product?.name??line.description??'Requested item'}{line.quantity?` · Qty ${line.quantity}`:''}{!line.catalogMatch&&<em>Saved as description</em>}</li>)}</ul>}{item.status==='IN_PROGRESS'&&<p className="customer-safe-note">Received — a quotation is being prepared.</p>}{item.status==='DECLINED'&&<p className="customer-safe-note">This request is not being progressed. Contact your account team if you would like to discuss alternatives.</p>}</article>):<div className="portal-request-empty"><ClipboardList/><p>No quote requests submitted yet.</p></div>}</div>
  </section>;
}
