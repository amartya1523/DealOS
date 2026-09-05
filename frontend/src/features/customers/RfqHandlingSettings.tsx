import { useEffect, useState } from 'react';
import { Check, FileInput, GitBranch, RefreshCw } from 'lucide-react';
import { request } from '../../api';
import './rfq-handling-settings.css';

type RfqHandlingMode = 'LEAD_FIRST'|'DIRECT_DRAFT';

export function RfqHandlingSettings({initialMode,onChanged}:{initialMode:RfqHandlingMode;onChanged?:(mode:RfqHandlingMode)=>void}) {
  const [mode,setMode]=useState<RfqHandlingMode>(initialMode);
  const [saved,setSaved]=useState<RfqHandlingMode>(initialMode);
  const [reason,setReason]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [success,setSuccess]=useState('');
  useEffect(()=>{setMode(initialMode);setSaved(initialMode)},[initialMode]);
  const save=async()=>{
    setBusy(true);setError('');setSuccess('');
    try{
      const result=await request<{mode:RfqHandlingMode}>('/settings/rfq-handling',{method:'PUT',body:JSON.stringify({mode,reason:reason.trim()})});
      setSaved(result.mode);setMode(result.mode);setReason('');setSuccess('Portal request handling updated and recorded in the audit trail.');onChanged?.(result.mode);
    }catch(cause){setError(cause instanceof Error?cause.message:'Could not update portal request handling.')}finally{setBusy(false)}
  };
  return <section className="rfq-handling-settings" aria-labelledby="rfq-mode-title">
    <div><span className="eyebrow">PORTAL INTAKE</span><h3 id="rfq-mode-title">Customer request handling</h3><p>Choose what DealOS creates after an invited customer submits a request. The original request is retained in either mode.</p></div>
    <div className="rfq-mode-options" role="radiogroup" aria-label="Customer request handling mode">
      <button type="button" role="radio" aria-checked={mode==='LEAD_FIRST'} className={mode==='LEAD_FIRST'?'selected':''} onClick={()=>setMode('LEAD_FIRST')}><GitBranch/><span><b>Lead first</b><small>Creates a Lead for the assigned representative to review and convert.</small><em>Proposed default</em></span>{mode==='LEAD_FIRST'&&<Check/>}</button>
      <button type="button" role="radio" aria-checked={mode==='DIRECT_DRAFT'} className={mode==='DIRECT_DRAFT'?'selected':''} onClick={()=>setMode('DIRECT_DRAFT')}><FileInput/><span><b>Direct draft</b><small>Creates a private quotation Draft immediately from valid catalog lines.</small><em>Requires complete pricing setup</em></span>{mode==='DIRECT_DRAFT'&&<Check/>}</button>
    </div>
    <label>Reason for change<textarea minLength={5} maxLength={500} value={reason} onChange={event=>setReason(event.target.value)} placeholder="Record why this intake policy is changing"/></label>
    {error&&<p className="rfq-setting-error" role="alert">{error}</p>}{success&&<p className="rfq-setting-success" role="status">{success}</p>}
    <button className="button primary" type="button" disabled={busy||mode===saved||reason.trim().length<5} onClick={save}>{busy?<><RefreshCw className="spin"/>Saving…</>:<>Save request policy</>}</button>
  </section>;
}
