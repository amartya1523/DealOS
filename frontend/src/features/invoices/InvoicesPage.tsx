import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowLeft, CalendarClock, Check, ChevronRight, Download, FileText, History, IndianRupee, Plus, Receipt, RotateCcw, Search, ShieldCheck, Truck, X } from 'lucide-react';
import type { Audit, Invoice, InvoicePayment, Quote, Workspace } from '../../api';
import './invoices.css';

type Mutate = (path:string, body:unknown, method?:string, message?:string)=>Promise<void>;
type InvoiceFilter = 'all'|'open'|'partial'|'overdue'|'paid';
type InvoiceSort = 'due-asc'|'due-desc'|'balance-desc'|'newest';
type AgingFilter = 'any'|'due7'|'due30'|'overdue30'|'overdue60'|'overdue60plus';

const number = (value:number|string|undefined|null) => Number(value ?? 0);
const invoiceBalance = (invoice:Invoice) => Math.max(0, number(invoice.amount) - number(invoice.paidAmount));
const dateOnly = (value:string|undefined) => value ? new Intl.DateTimeFormat('en-IN',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(value)) : 'Not recorded';
const money = (value:number|string, currency='INR') => new Intl.NumberFormat('en-IN',{style:'currency',currency,maximumFractionDigits:2}).format(number(value));
const startOfToday = () => { const today=new Date(); today.setHours(0,0,0,0); return today; };
const daysFromToday = (value:string) => Math.round((new Date(value).getTime()-startOfToday().getTime())/86_400_000);

export function invoiceDisplayState(invoice:Invoice):Exclude<InvoiceFilter,'all'> {
  if(invoice.state==='PAID'||invoiceBalance(invoice)<=0)return 'paid';
  if(daysFromToday(invoice.dueAt)<0)return 'overdue';
  if(invoice.state==='PARTIAL'||number(invoice.paidAmount)>0)return 'partial';
  return 'open';
}

const stateLabel = (invoice:Invoice) => {
  const state=invoiceDisplayState(invoice);
  if(state==='overdue')return `Overdue · ${Math.abs(daysFromToday(invoice.dueAt))}d`;
  return state==='partial'?'Partially paid':state==='paid'?'Paid':'Unpaid';
};

const sourceLabel = (invoice:Invoice) => invoice.order?.number ?? invoice.quote?.number ?? 'Legacy invoice';

export function InvoicesPage({data,openInvoice,mutate}:{data:Workspace;openInvoice:(id:string)=>void;mutate:Mutate}) {
  const [filter,setFilter]=useState<InvoiceFilter>('all');
  const [query,setQuery]=useState('');
  const [sort,setSort]=useState<InvoiceSort>('due-asc');
  const [aging,setAging]=useState<AgingFilter>('any');
  const [page,setPage]=useState(1);
  const [issuing,setIssuing]=useState(false);
  const invoices=data.invoices;
  const canIssue=['FINANCE','ADMIN'].includes(data.user.role)&&!data.user.viewContext;
  const totals=useMemo(()=>{
    const outstanding=invoices.reduce((sum,item)=>sum+invoiceBalance(item),0);
    const overdue=invoices.filter(item=>invoiceDisplayState(item)==='overdue');
    const dueSoon=invoices.filter(item=>{const days=daysFromToday(item.dueAt);return invoiceBalance(item)>0&&days>=0&&days<=7});
    const now=new Date();
    const paidThisMonth=invoices.flatMap(item=>item.payments??[]).reduce((sum,payment)=>{
      const paidAt=new Date(payment.paidAt);
      if(paidAt.getMonth()!==now.getMonth()||paidAt.getFullYear()!==now.getFullYear())return sum;
      return sum+(payment.reversalOfId?-number(payment.amount):number(payment.amount));
    },0);
    return {outstanding,overdueAmount:overdue.reduce((sum,item)=>sum+invoiceBalance(item),0),overdueCount:overdue.length,dueSoon:dueSoon.length,paidThisMonth};
  },[invoices]);
  const counts=useMemo(()=>({
    all:invoices.length,
    open:invoices.filter(item=>invoiceDisplayState(item)==='open').length,
    partial:invoices.filter(item=>invoiceDisplayState(item)==='partial').length,
    overdue:invoices.filter(item=>invoiceDisplayState(item)==='overdue').length,
    paid:invoices.filter(item=>invoiceDisplayState(item)==='paid').length,
  }),[invoices]);
  const filtered=useMemo(()=>invoices
    .filter(item=>filter==='all'||invoiceDisplayState(item)===filter)
    .filter(item=>`${item.number} ${item.customer} ${sourceLabel(item)}`.toLowerCase().includes(query.trim().toLowerCase()))
    .filter(item=>{const days=daysFromToday(item.dueAt);return aging==='any'||aging==='due7'&&days>=0&&days<=7||aging==='due30'&&days>=0&&days<=30||aging==='overdue30'&&days<0&&days>=-30||aging==='overdue60'&&days<-30&&days>=-60||aging==='overdue60plus'&&days<-60})
    .sort((left,right)=>sort==='due-asc'?new Date(left.dueAt).getTime()-new Date(right.dueAt).getTime():sort==='due-desc'?new Date(right.dueAt).getTime()-new Date(left.dueAt).getTime():sort==='balance-desc'?invoiceBalance(right)-invoiceBalance(left):new Date(right.createdAt??0).getTime()-new Date(left.createdAt??0).getTime()),
  [aging,filter,invoices,query,sort]);
  const pageSize=10;
  const pages=Math.max(1,Math.ceil(filtered.length/pageSize));
  const visible=filtered.slice((page-1)*pageSize,page*pageSize);
  useEffect(()=>setPage(1),[aging,filter,query,sort]);
  useEffect(()=>setPage(current=>Math.min(current,pages)),[pages]);
  const openRow=(event:KeyboardEvent<HTMLTableRowElement>,id:string)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openInvoice(id)}};
  return <div className="invoice-module">
    <div className="invoice-intro"><div><span className="eyebrow">Receivables control</span><h2>Invoices <span>({invoices.length})</span></h2><p>Track every issued charge from order through delivery and recorded settlement.</p></div>{canIssue&&<button className="button primary" onClick={()=>setIssuing(true)}><Plus/>Issue invoice</button>}</div>
    <div className="invoice-metrics">
      <article><span>Total outstanding</span><strong>{money(totals.outstanding)}</strong><small>Across {counts.all-counts.paid} open receivables</small></article>
      <article className={totals.overdueCount?'attention-metric':''}><span>Overdue</span><strong>{money(totals.overdueAmount)}</strong><small>{totals.overdueCount} invoice{totals.overdueCount===1?'':'s'} past due</small></article>
      <article><span>Due in 7 days</span><strong>{totals.dueSoon}</strong><small>Upcoming finance actions</small></article>
      <article><span>Paid this month</span><strong>{money(totals.paidThisMonth)}</strong><small>Net recorded settlements</small></article>
    </div>
    <section className="invoice-list-panel">
      <div className="invoice-list-toolbar">
        <div className="invoice-tabs" aria-label="Invoice status filters">{([['all','All invoices'],['open','Unpaid'],['partial','Partially paid'],['overdue','Overdue'],['paid','Paid']] as Array<[InvoiceFilter,string]>).map(([id,text])=><button key={id} aria-pressed={filter===id} className={filter===id?'active':''} onClick={()=>setFilter(id)}>{text}<em>{counts[id]}</em></button>)}</div>
        <div className="invoice-list-controls"><label className="search"><Search/><span className="sr-only">Search invoices</span><input aria-label="Search invoices" placeholder="Invoice, customer, or order" value={query} onChange={event=>setQuery(event.target.value)}/></label><label><span className="sr-only">Invoice aging</span><select aria-label="Invoice aging" value={aging} onChange={event=>setAging(event.target.value as AgingFilter)}><option value="any">Any due date</option><option value="due7">Due in 7 days</option><option value="due30">Due in 30 days</option><option value="overdue30">1–30 days overdue</option><option value="overdue60">31–60 days overdue</option><option value="overdue60plus">60+ days overdue</option></select></label><label><span className="sr-only">Sort invoices</span><select aria-label="Sort invoices" value={sort} onChange={event=>setSort(event.target.value as InvoiceSort)}><option value="due-asc">Due date · earliest</option><option value="due-desc">Due date · latest</option><option value="balance-desc">Balance · highest</option><option value="newest">Newest issued</option></select></label></div>
      </div>
      <div className="table-wrap"><table><thead><tr><th>Invoice</th><th>Customer</th><th>Source</th><th>Total</th><th>Paid</th><th>Balance</th><th>Due date</th><th>Status</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>{visible.map(invoice=>{const currency=invoice.currency??invoice.order?.currency??invoice.customerRecord?.currency??'INR';return <tr key={invoice.id} className="invoice-row" tabIndex={0} onClick={()=>openInvoice(invoice.id)} onKeyDown={event=>openRow(event,invoice.id)} aria-label={`Open ${invoice.number} for ${invoice.customer}`}><td><b>{invoice.number}</b><small>Issued {dateOnly(invoice.createdAt)}</small></td><td>{invoice.customer}</td><td><b>{sourceLabel(invoice)}</b><small>{invoice.order?'Confirmed order':invoice.quote?'Quotation':'Imported record'}</small></td><td>{money(invoice.amount,currency)}</td><td>{money(invoice.paidAmount,currency)}</td><td><b>{money(invoiceBalance(invoice),currency)}</b></td><td><span className={invoiceDisplayState(invoice)==='overdue'?'invoice-due-late':''}>{dateOnly(invoice.dueAt)}</span></td><td><span className={`status ${invoiceDisplayState(invoice)}`}>{stateLabel(invoice)}</span></td><td><button type="button" aria-label={`Open ${invoice.number}`} onClick={event=>{event.stopPropagation();openInvoice(invoice.id)}}><ChevronRight/></button></td></tr>})}</tbody></table>{!visible.length&&<div className="invoice-empty"><Receipt/><h3>No invoices found</h3><p>{query?'Try a different invoice, customer, or order search.':'There are no invoices in this status.'}</p></div>}</div>
      <div className="invoice-list-hint"><ShieldCheck/><span>Open an invoice to reconcile its order, delivery, payments, and remaining balance.</span><b>{filtered.length} result{filtered.length===1?'':'s'}</b></div>
      {pages>1&&<div className="invoice-pagination"><button disabled={page===1} onClick={()=>setPage(value=>value-1)}>Previous</button><span>Page {page} of {pages}</span><button disabled={page===pages} onClick={()=>setPage(value=>value+1)}>Next</button></div>}
    </section>
    {issuing&&<IssueInvoiceDialog quotes={data.quotes} mutate={mutate} close={()=>setIssuing(false)}/>} 
  </div>;
}

function IssueInvoiceDialog({quotes,mutate,close}:{quotes:Quote[];mutate:Mutate;close:()=>void}) {
  const eligible=quotes.filter(quote=>quote.stage==='CONFIRMED'&&quote.order&&quote.invoices.length===0);
  const [quoteId,setQuoteId]=useState(eligible[0]?.id??'');
  const [dueAt,setDueAt]=useState(()=>new Date(Date.now()+14*86_400_000).toISOString().slice(0,10));
  const selected=eligible.find(quote=>quote.id===quoteId);
  const submit=async(event:FormEvent)=>{event.preventDefault();if(!selected?.order)return;await mutate(`/orders/${selected.order.id}/invoices`,{kind:'ONE_TIME',dueAt},'POST','Invoice issued from confirmed order');close()};
  return <div className="modal-wrap" onMouseDown={event=>event.target===event.currentTarget&&close()}><div className="modal issue-invoice-dialog" role="dialog" aria-modal="true" aria-labelledby="issue-invoice-title"><div className="panel-title"><div><h3 id="issue-invoice-title">Issue invoice</h3><p>Create a receivable only from an eligible confirmed order.</p></div><button aria-label="Close issue invoice" onClick={close}><X/></button></div>{eligible.length?<form className="form" onSubmit={submit}><label>Confirmed order<select value={quoteId} onChange={event=>setQuoteId(event.target.value)}>{eligible.map(quote=><option key={quote.id} value={quote.id}>{quote.order?.number} · {quote.customer}</option>)}</select></label><label>Due date<input type="date" min={new Date().toISOString().slice(0,10)} value={dueAt} onChange={event=>setDueAt(event.target.value)} required/></label><div className="issue-order-summary"><FileText/><span><b>{selected?.number}</b><small>{selected?.lines.length} snapshotted line{selected?.lines.length===1?'':'s'} · {money(selected?.total??0)}</small></span></div><p className="muted">This uses the accepted order snapshot. It does not consume stock or create a second receivable on retry.</p><div className="actions"><button type="button" className="button ghost" onClick={close}>Cancel</button><button className="button primary"><Receipt/>Issue invoice</button></div></form>:<div className="invoice-empty"><Check/><h3>No orders waiting for an invoice</h3><p>Confirmed orders in this workspace have already been billed. Recurring charges are issued from their billing schedule.</p><button className="button ghost" onClick={close}>Close</button></div>}</div></div>;
}

export function InvoiceDetailPage({invoice,quotes,audits,role,readOnly,mutate,onBack,onOpenQuote}:{invoice?:Invoice;quotes:Quote[];audits:Audit[];role:string;readOnly:boolean;mutate:Mutate;onBack:()=>void;onOpenQuote:(id:string)=>void}) {
  const outstanding=invoice?invoiceBalance(invoice):0;
  const [amount,setAmount]=useState(outstanding);
  const [reference,setReference]=useState('');
  const [paidAt,setPaidAt]=useState(()=>new Date().toISOString().slice(0,10));
  const [reversing,setReversing]=useState<InvoicePayment|null>(null);
  useEffect(()=>{setAmount(outstanding);setReference('');setPaidAt(new Date().toISOString().slice(0,10))},[invoice?.id,outstanding]);
  if(!invoice)return <div className="invoice-empty"><Receipt/><h3>No invoice selected</h3><button className="button ghost" onClick={onBack}>Return to invoices</button></div>;
  const currency=invoice.currency??invoice.order?.currency??invoice.customerRecord?.currency??'INR';
  const quote=invoice.quote??quotes.find(item=>item.id===invoice.quoteId);
  const canReconcile=['FINANCE','ADMIN'].includes(role)&&!readOnly;
  const payments=invoice.payments??[];
  const invoiceAudits=audits.filter(item=>item.resourceId===invoice.id);
  const submitPayment=async(event:FormEvent)=>{event.preventDefault();await mutate(`/invoices/${invoice.id}/payments`,{amount,reference:reference.trim(),paidAt,currency},'POST','Payment recorded and balance reconciled')};
  const reversedIds=new Set(payments.filter(payment=>payment.reversalOfId).map(payment=>payment.reversalOfId));
  const net=invoice.lines.reduce((sum,line)=>sum+number(line.net??line.amount),0);
  const tax=invoice.lines.reduce((sum,line)=>sum+number(line.tax),0);
  return <div className="invoice-detail-module">
    <button className="invoice-back" onClick={onBack}><ArrowLeft/>Invoices</button>
    <div className="invoice-detail-head"><div><span className={`status ${invoiceDisplayState(invoice)}`}>{stateLabel(invoice)}</span><h2>{invoice.number}</h2><p>{invoice.customer} · Issued {dateOnly(invoice.createdAt)} · Due {dateOnly(invoice.dueAt)}</p></div><div className="actions"><a className="button ghost" href={`/api/v1/invoices/${invoice.id}/pdf`} download><Download/>Download PDF</a>{quote&&<button className="button ghost" onClick={()=>onOpenQuote(quote.id)}><FileText/>Open source deal</button>}</div></div>
    <div className="invoice-metrics detail"><article><span>Invoice total</span><strong>{money(invoice.amount,currency)}</strong><small>{invoice.lines.length} financial line{invoice.lines.length===1?'':'s'}</small></article><article><span>Paid</span><strong>{money(invoice.paidAmount,currency)}</strong><small>Verified ledger postings</small></article><article className={outstanding?'attention-metric':''}><span>Outstanding</span><strong>{money(outstanding,currency)}</strong><small>{stateLabel(invoice)}</small></article><article><span>Due date</span><strong>{dateOnly(invoice.dueAt)}</strong><small>{invoiceDisplayState(invoice)==='overdue'?`${Math.abs(daysFromToday(invoice.dueAt))} days overdue`:invoiceDisplayState(invoice)==='paid'?'Settled':`${Math.max(0,daysFromToday(invoice.dueAt))} days remaining`}</small></article></div>
    <div className="invoice-detail-grid"><section className="invoice-card invoice-lines-card"><div className="invoice-card-title"><div><h3>Invoice lines</h3><p>Immutable commercial charges from the accepted record.</p></div><Receipt/></div><div className="table-wrap"><table><thead><tr><th>Description</th><th>Cadence</th><th>Qty</th><th>Net</th><th>GST</th><th>Amount</th></tr></thead><tbody>{invoice.lines.map((line,index)=><tr key={`${line.description}-${index}`}><td><b>{line.description}</b></td><td>{line.cadence??'One-time'}</td><td>{line.quantity??1}</td><td>{money(line.net??line.amount,currency)}</td><td>{money(line.tax??0,currency)}</td><td><b>{money(line.amount,currency)}</b></td></tr>)}</tbody><tfoot><tr><th colSpan={3}>Totals</th><th>{money(net,currency)}</th><th>{money(tax,currency)}</th><th>{money(invoice.amount,currency)}</th></tr></tfoot></table></div></section>
      <section className="invoice-card"><div className="invoice-card-title"><div><h3>Source and delivery</h3><p>Commercial and operational provenance.</p></div><Truck/></div><dl className="invoice-facts"><div><dt>Quotation</dt><dd>{quote?.number??'Legacy record'}</dd></div><div><dt>Order</dt><dd>{invoice.order?.number??'Not linked'}</dd></div><div><dt>Order state</dt><dd>{invoice.order?.state?.replaceAll('_',' ')??'Not available'}</dd></div><div><dt>Delivery</dt><dd>{invoice.order?.fulfillment?.state?.replaceAll('_',' ')??'Not allocated'}</dd></div><div><dt>Shipments</dt><dd>{invoice.order?.fulfillment?.shipmentCount??0}</dd></div><div><dt>Currency</dt><dd>{currency}</dd></div></dl>{invoice.notes?.length?<div className="payment-ledger"><h4>Customer due-date requests</h4>{invoice.notes.map(note=><article key={note.id}><span><CalendarClock/></span><div><b>{note.requestedDueAt?`Requested ${dateOnly(note.requestedDueAt)}`:'Billing note'}</b><small>{note.message} · submitted {dateOnly(note.createdAt)}</small></div></article>)}</div>:null}</section>
    </div>
    <div className="invoice-detail-grid lower"><section className="invoice-card"><div className="invoice-card-title"><div><h3>Payment and credit ledger</h3><p>Append-only settlement history.</p></div><History/></div>{payments.length?<div className="payment-ledger">{payments.slice().sort((a,b)=>new Date(b.paidAt).getTime()-new Date(a.paidAt).getTime()).map(payment=>{const reversal=Boolean(payment.reversalOfId);const reversed=reversedIds.has(payment.id);return <article key={payment.id} className={reversal?'reversal':''}><span className="ledger-icon">{reversal?<RotateCcw/>:<IndianRupee/>}</span><div><b>{reversal?'Payment reversal':'Recorded payment'}</b><small>{payment.reference??'Reference hidden'} · {dateOnly(payment.paidAt)}</small>{payment.reason&&<p>{payment.reason}</p>}</div><strong>{reversal?'-':''}{money(payment.amount,currency)}</strong>{canReconcile&&!reversal&&!reversed&&<button className="button ghost" onClick={()=>setReversing(payment)}><RotateCcw/>Reverse</button>}{reversed&&<span className="status reversed">Reversed</span>}</article>})}</div>:<div className="invoice-empty compact"><History/><h3>No payments recorded</h3><p>The full invoice balance remains outstanding.</p></div>}{invoice.credits?.length?<div className="credit-list">{invoice.credits.map(credit=><article key={credit.id}><b>{credit.number}</b><span>{credit.reason}</span><strong>-{money(credit.amount,currency)}</strong></article>)}</div>:<p className="invoice-ledger-note">No credit notes are applied to this invoice.</p>}</section>
      <section className="invoice-card"><div className="invoice-card-title"><div><h3>Record payment</h3><p>Capture verified settlement evidence.</p></div><IndianRupee/></div>{canReconcile&&outstanding>0?<form className="form payment-form" onSubmit={submitPayment}><label>Amount<input type="number" min="0.01" step="0.01" max={outstanding} value={amount} onChange={event=>setAmount(number(event.target.value))} required/></label><div className="payment-fields"><label>Payment date<input type="date" max={new Date().toISOString().slice(0,10)} value={paidAt} onChange={event=>setPaidAt(event.target.value)} required/></label><label>Currency<input value={currency} readOnly/></label></div><label>Bank or settlement reference<input value={reference} maxLength={128} onChange={event=>setReference(event.target.value)} placeholder="UTR, cheque, or transfer reference" required minLength={2}/></label><div className="payment-preview"><span>Balance after payment</span><strong>{money(Math.max(0,outstanding-amount),currency)}</strong></div><button className="button primary" disabled={amount<=0||amount>outstanding||reference.trim().length<2}><Check/>Record verified payment</button><p className="muted">This records evidence only. DealOS does not initiate a bank transfer.</p></form>:<div className="invoice-empty compact"><Check/><h3>{outstanding<=0?'Invoice settled':'Read-only access'}</h3><p>{outstanding<=0?'The recorded ledger fully covers this invoice.':'Finance or an organization admin records payments.'}</p></div>}</section>
    </div>
    <section className="invoice-card invoice-timeline"><div className="invoice-card-title"><div><h3>Reconciliation timeline</h3><p>Invoice, delivery, payment, and audit events in one view.</p></div><CalendarClock/></div><div className="timeline-list"><article><i/><span><b>Invoice issued</b><small>{dateOnly(invoice.createdAt)} · {invoice.number}</small></span></article>{invoice.order?.fulfillment&&<article><i/><span><b>Delivery state: {invoice.order.fulfillment.state.replaceAll('_',' ')}</b><small>{dateOnly(invoice.order.fulfillment.updatedAt)} · {invoice.order.fulfillment.shipmentCount} shipment(s)</small></span></article>}{invoiceAudits.map(item=><article key={item.id}><i/><span><b>{item.action.replaceAll('_',' ')}</b><small>{dateOnly(item.createdAt)}{item.reason?` · ${item.reason}`:''}</small></span></article>)}</div></section>
    {reversing&&<PaymentReversalDialog invoice={invoice} payment={reversing} mutate={mutate} close={()=>setReversing(null)}/>} 
  </div>;
}

function PaymentReversalDialog({invoice,payment,mutate,close}:{invoice:Invoice;payment:InvoicePayment;mutate:Mutate;close:()=>void}) {
  const [reason,setReason]=useState('');
  const submit=async(event:FormEvent)=>{event.preventDefault();await mutate(`/invoices/${invoice.id}/payments/${payment.id}/reversals`,{reason:reason.trim()},'POST','Payment reversal recorded');close()};
  return <div className="modal-wrap" onMouseDown={event=>event.target===event.currentTarget&&close()}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="reverse-payment-title"><div className="panel-title"><div><h3 id="reverse-payment-title">Reverse recorded payment</h3><p className="muted">The original entry remains visible and a compensating entry is added.</p></div><button aria-label="Close payment reversal" onClick={close}><X/></button></div><form className="form" onSubmit={submit}><div className="issue-order-summary"><RotateCcw/><span><b>{payment.reference??payment.id}</b><small>{money(payment.amount,invoice.currency??'INR')} · {dateOnly(payment.paidAt)}</small></span></div><label>Correction reason<textarea value={reason} minLength={5} maxLength={240} onChange={event=>setReason(event.target.value)} placeholder="Explain why this settlement record must be reversed" required/></label><div className="actions"><button type="button" className="button ghost" onClick={close}>Cancel</button><button className="button danger" disabled={reason.trim().length<5}><RotateCcw/>Record reversal</button></div></form></div></div>;
}
