import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Sparkles } from 'lucide-react';
import { request, type Product, type Quote, type QuoteCalculation } from '../../api';

type LineDraft = { productId:string; quantity:number; discount:number };

type QuoteDetailProps = {
  quote?:Quote;
  products:Product[];
  readOnly?:boolean;
  mutate:(path:string, body:unknown, method?:string, message?:string)=>Promise<void>;
};

const money = (value:number|string) => new Intl.NumberFormat('en-IN', {
  style:'currency', currency:'INR', maximumFractionDigits:0,
}).format(Number(value));
const label = (value:string) => value.replaceAll('_',' ').toLowerCase().replace(/\b\w/g,(character)=>character.toUpperCase());
const serializedLines = (lines:LineDraft[]) => JSON.stringify(lines.map((line)=>({
  productId:line.productId,
  quantity:Number(line.quantity),
  discount:Number(line.discount),
})));

export function QuoteDetail({ quote, products, readOnly = false, mutate }:QuoteDetailProps) {
  const [lines, setLines] = useState<LineDraft[]>(()=>quote?.lines.map((line)=>({
    productId:line.productId, quantity:line.quantity, discount:Number(line.discount),
  })) ?? []);
  const [preview, setPreview] = useState<QuoteCalculation|null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState('');

  useEffect(()=>{
    setLines(quote?.lines.map((line)=>({
      productId:line.productId, quantity:line.quantity, discount:Number(line.discount),
    })) ?? []);
    setPreview(null);
    setPreviewError('');
  }, [quote?.id]);

  const validLines = lines.length > 0 && lines.every((line)=>
    Number.isInteger(line.quantity) && line.quantity > 0 && Number.isFinite(line.discount) && line.discount >= 0 && line.discount <= 100,
  );
  const dirty = useMemo(()=>serializedLines(lines) !== serializedLines(quote?.lines.map((line)=>({
    productId:line.productId, quantity:line.quantity, discount:Number(line.discount),
  })) ?? []), [lines, quote?.lines]);
  const editable = Boolean(quote && quote.stage === 'DRAFT' && !readOnly);

  useEffect(()=>{
    let current = true;
    let timer:ReturnType<typeof setTimeout>|undefined;
    if (!quote || !editable || !quote.currentRevisionId || !validLines) {
      setPreviewing(false);
      setPreview(null);
      if (lines.length) setPreviewError(validLines ? '' : 'Enter a positive whole-number quantity and a discount from 0% to 100%.');
      else setPreviewError('');
      return ()=>{ current = false; };
    }

    setPreviewing(true);
    setPreviewError('');
    timer = setTimeout(async()=>{
      try {
        const calculation = await request<QuoteCalculation>(`/quotations/${quote.id}/preview`, {
          method:'POST',
          body:JSON.stringify({
            revisionId:quote.currentRevisionId,
            expectedVersion:quote.version,
            orderDiscount:Number(quote.orderDiscount),
            lines:lines.map((line)=>({ variantId:line.productId, quantity:line.quantity, lineDiscount:line.discount })),
          }),
        });
        if (current) setPreview(calculation);
      } catch (error) {
        if (current) {
          setPreview(null);
          setPreviewError(error instanceof Error ? error.message : 'Pricing preview is unavailable.');
        }
      } finally {
        if (current) setPreviewing(false);
      }
    }, 300);
    return ()=>{ current = false; if (timer) clearTimeout(timer); };
  }, [lines, quote?.id, quote?.stage, quote?.version, quote?.currentRevisionId, quote?.orderDiscount, editable, validLines]);

  if (!quote) return <div className="empty"><p>Create a quotation to begin.</p></div>;

  const add = (product:Product) => setLines((current)=>current.some((line)=>line.productId === product.id)
    ? current
    : [...current, { productId:product.id, quantity:1, discount:0 }]);
  const save = () => mutate(`/quotations/${quote.id}/draft`, {
    version:quote.version,
    orderDiscount:Number(quote.orderDiscount),
    lines,
  }, 'PUT', 'Draft saved');
  const total = preview?.total ?? quote.total;
  const margin = preview?.margin ?? quote.margin;
  const riskScore = preview?.riskScore ?? quote.riskScore;

  return <>
    <div className="detail-head">
      <div>
        <span className="status">{label(quote.stage)}</span>
        <h2>{quote.number} · {quote.customer}</h2>
        <p>{quote.customerTier} customer · Version {quote.version}</p>
      </div>
      <div className="actions">
        <button className="button ghost" onClick={save} disabled={!editable || !validLines || previewing}>Save draft</button>
        <button
          className="button primary"
          onClick={()=>mutate(`/quotations/${quote.id}/submit`, {}, 'POST', 'Submitted for approval')}
          disabled={!editable || dirty || !quote.lines.length}
          title={dirty ? 'Save the current changes before submitting.' : undefined}
        >Submit for approval</button>
        {quote.stage === 'APPROVED' && <button className="button primary" onClick={()=>mutate(`/quotations/${quote.id}/send`, {}, 'POST', 'Sent to customer portal')}>Send to customer</button>}
      </div>
    </div>
    <div className="quote-layout">
      <div className="panel">
        <div className="panel-title"><h3>Commercial lines</h3>{previewing && <span className="quote-preview-status" role="status">Recalculating…</span>}</div>
        {previewError && <div className="quote-preview-error" role="alert"><AlertTriangle/>{previewError}</div>}
        <div className="table-wrap">
          <table>
            <thead><tr><th>Product</th><th>Qty</th><th>List price</th><th>Discount</th><th>Limit</th><th>Net</th></tr></thead>
            <tbody>{lines.map((line, index)=>{
              const product = products.find((item)=>item.id === line.productId) ?? quote.lines.find((item)=>item.productId === line.productId)?.product;
              const calculated = preview?.lines.find((item)=>item.productId === line.productId);
              const persisted = quote.lines.find((item)=>item.productId === line.productId);
              const allowedDiscount = calculated?.allowedDiscount ?? persisted?.allowedDiscount;
              const net = calculated?.net ?? Number(product?.price ?? persisted?.unitPrice ?? 0) * line.quantity * (1 - line.discount / 100);
              return <tr key={line.productId}>
                <td><b>{product?.name}</b><small>{product?.category}{product?.cadence ? ` · ${product.cadence}` : ''}</small></td>
                <td><input aria-label={`${product?.name ?? 'Product'} quantity`} className="cell-input" type="number" min="1" step="1" value={line.quantity} disabled={!editable} onChange={(event)=>setLines((current)=>current.map((item, itemIndex)=>itemIndex === index ? {...item, quantity:Number(event.target.value)} : item))}/></td>
                <td>{money(product?.price ?? persisted?.unitPrice ?? 0)}</td>
                <td><span className="discount-input"><input aria-label={`${product?.name ?? 'Product'} discount`} className="cell-input" type="number" min="0" max="100" value={line.discount} disabled={!editable} onChange={(event)=>setLines((current)=>current.map((item, itemIndex)=>itemIndex === index ? {...item, discount:Number(event.target.value)} : item))}/><span>%</span></span></td>
                <td>{allowedDiscount === undefined ? '—' : `${Number(allowedDiscount)}%`}</td>
                <td>{money(net)}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        <div className="totals">
          <span>Deal total <b>{money(total)}</b></span>
          <span>Margin <b>{money(margin)}</b></span>
          <span className={Number(riskScore) > 0 ? 'risk' : ''}>Risk excess <b>{riskScore} pts</b></span>
        </div>
      </div>
      <div className="panel">
        <div className="panel-title"><h3>Upsell &amp; cross-sell</h3></div>
        <p className="muted">Ranked by fit, promotion and healthy margin.</p>
        <div className="suggestions">{products.filter((product)=>product.active && !lines.some((line)=>line.productId === product.id)).slice(0, 3).map((product)=><div key={product.id}>
          <span className="product-icon"><Sparkles/></span>
          <span><b>{product.name}</b><small>+{money(Number(product.price) - Number(product.cost))} margin · {product.category}</small></span>
          <button onClick={()=>add(product)} disabled={!editable}>Add</button>
        </div>)}</div>
      </div>
    </div>
  </>;
}
