import { useEffect, useState } from 'react';
import { Check, FileCheck, Send } from 'lucide-react';
import type { Quote } from '../../api';

const money=(value:string|number,currency='INR')=>new Intl.NumberFormat('en-IN',{style:'currency',currency,maximumFractionDigits:0}).format(Number(value));
const label=(value:string)=>value.replaceAll('_',' ').toLowerCase().replace(/\b\w/g,character=>character.toUpperCase());
const date=(value:string)=>new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric'}).format(new Date(value));
const apiDate=(value:string)=>value?new Date(`${value}T12:00:00.000Z`).toISOString():null;

export function CustomerQuotationRoom({quotes,mutate}:{quotes:Quote[];mutate:Function}) {
  const[selectedId,setSelectedId]=useState(quotes[0]?.id??'');
  const[message,setMessage]=useState('');
  const[counter,setCounter]=useState(0);
  const[delivery,setDelivery]=useState('');
  useEffect(()=>{if(!quotes.some(quote=>quote.id===selectedId))setSelectedId(quotes[0]?.id??'')},[quotes,selectedId]);
  const quote=quotes.find(item=>item.id===selectedId);
  if(!quote)return <div className="deal-room-empty"><FileCheck/><h2>No quotations yet</h2><p>Approved quotations sent to your invited email will appear here.</p></div>;
  const revisionId=quote.revisionId??quote.currentRevisionId;
  const submit=async()=>{
    if(!revisionId)return;
    if(counter>0) await mutate(`/portal/quotations/${quote.id}/proposals`,{revisionId,expectedVersion:quote.version,counterDiscount:counter,message:message.trim()||`Counter discount of ${counter}% requested.`,requestedDeliveryAt:apiDate(delivery)},'POST','Counter proposal sent');
    else await mutate(`/portal/quotations/${quote.id}/comment`,{revisionId,message:message.trim()||(delivery?'Requested delivery date update.':''),type:delivery?'QUESTION':'COMMENT',requestedDeliveryAt:apiDate(delivery)},'POST','Comment sent');
    setMessage('');setCounter(0);setDelivery('');
  };
  const accept=()=>revisionId&&quote.termsHash&&mutate(`/portal/quotations/${quote.id}/accept`,{revisionId,expectedVersion:quote.version,termsHash:quote.termsHash},'POST','Quotation accepted and order confirmed');
  return <div className="quote-room-layout">
    <aside className="document-list">{quotes.map(item=><button key={item.id} className={item.id===quote.id?'active':''} onClick={()=>setSelectedId(item.id)}><span><small>{item.number}</small><b>{item.customer}</b></span><strong>{money(item.total,item.currency)}</strong><em>{label(item.stage)}</em></button>)}</aside>
    <section className="quotation-sheet">
      <div className="quotation-sheet-head"><div><span className={`status ${quote.stage.toLowerCase()}`}>{label(quote.stage)}</span><h2>{quote.number}</h2><p>Revision {quote.revisionNumber??quote.version} · frozen customer copy</p></div><strong>{money(quote.total,quote.currency)}</strong></div>
      <div className="quotation-lines"><table><thead><tr><th>Line</th><th>Qty</th><th>Unit price</th><th>Discount</th><th>Amount</th></tr></thead><tbody>{quote.lines.map(line=><tr key={line.id}><td><b>{line.product.name}</b><small>{line.product.description}</small></td><td>{line.quantity}</td><td>{money(line.unitPrice,quote.currency)}</td><td>{line.discount}%</td><td>{money(line.net??Number(line.unitPrice)*line.quantity*(1-Number(line.discount)/100),quote.currency)}</td></tr>)}</tbody></table></div>
      {quote.stage!=='ACCEPTED'&&<><div className="negotiation-grid"><label>Your comment<textarea value={message} onChange={event=>setMessage(event.target.value)} placeholder="Ask a question or explain the requested change"/></label><label>Counter discount %<input type="number" min="0" max="100" value={counter} disabled={!quote.capabilities?.propose} onChange={event=>setCounter(Number(event.target.value))}/></label><label>Requested delivery date<input type="date" value={delivery} onChange={event=>setDelivery(event.target.value)}/></label></div><div className="quotation-actions"><button className="button ghost" disabled={!revisionId||(!message.trim()&&!delivery&&counter<=0)||(!quote.capabilities?.comment&&counter<=0)||(!quote.capabilities?.propose&&counter>0)} onClick={submit}><Send/>{counter>0?'Send counter proposal':'Send comment'}</button><button className="button primary accept-button" disabled={!quote.capabilities?.accept||!quote.termsHash} onClick={accept}><Check/>Accept quotation</button></div></>}
      {quote.stage==='NEGOTIATION'&&<div className="approval-note"><FileCheck/><span><b>Counter proposal awaiting your representative</b>The original sent revision is locked until the proposal is resolved.</span></div>}
      {quote.stage==='ACCEPTED'&&<div className="approval-note"><Check/><span><b>Accepted and closed</b>{quote.order?`Order ${quote.order.number} was created from this exact revision.`:'Your order has been confirmed.'}</span></div>}
      {quote.negotiation.length>0&&<div className="conversation-strip"><h3>Conversation</h3>{quote.negotiation.map(item=><div key={item.id}><span>{item.author.slice(0,1)}</span><p><b>{item.author}</b>{item.message}<small>{date(item.createdAt)}{item.counterDiscount!==null&&item.counterDiscount!==undefined?` · ${item.counterDiscount}% proposed`:''}</small>{item.state==='DECLINED'&&<em>Declined by your representative: {item.responseReason}</em>}{item.state==='ADOPTED'&&<em>Adopted into a new draft for fresh approval.</em>}</p></div>)}</div>}
    </section>
  </div>;
}
