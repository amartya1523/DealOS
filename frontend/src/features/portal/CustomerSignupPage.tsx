import { useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Eye, EyeOff, LockKeyhole, ShieldCheck, Store, UserRound } from 'lucide-react';
import { Brand } from '../../Brand';
import { request } from '../../api';
import './customer-signup.css';

export function CustomerSignupPage(){
  const[contactName,setContactName]=useState('');
  const[companyName,setCompanyName]=useState('');
  const[email,setEmail]=useState('');
  const[password,setPassword]=useState('');
  const[confirmation,setConfirmation]=useState('');
  const[visible,setVisible]=useState(false);
  const[accepted,setAccepted]=useState(false);
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState('');
  const[submitted,setSubmitted]=useState(false);
  const passwordChecks=useMemo(()=>[
    {label:'12+ characters',valid:password.length>=12},
    {label:'Upper & lowercase',valid:/[A-Z]/.test(password)&&/[a-z]/.test(password)},
    {label:'Number or symbol',valid:/[^A-Za-z]/.test(password)},
  ],[password]);
  const valid=passwordChecks.every(item=>item.valid)&&password===confirmation&&accepted;

  const submit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    if(!valid){setError(password!==confirmation?'Passwords do not match.':'Complete the password and consent requirements.');return}
    setBusy(true);setError('');
    try{
      await request('/auth/customer/signup',{method:'POST',body:JSON.stringify({contactName:contactName.trim(),companyName:companyName.trim(),email:email.trim().toLowerCase(),password})});
      setSubmitted(true);
    }catch(cause){setError(cause instanceof Error?cause.message:'Could not create your customer account.')}finally{setBusy(false)}
  };

  if(submitted)return <main className="customer-signup-page"><header><Brand/><a href="/customer/sign-in">Customer sign in <ArrowRight/></a></header><section className="signup-complete"><span className="signup-complete-icon"><CheckCircle2/></span><span className="eyebrow">ACCOUNT CREATED</span><h1>Your marketplace is ready.</h1><p>Your customer login is active. Browse verified organizations now, compare their public products and services, and send an interest request when you find the right fit.</p><div className="signup-complete-flow"><span><Store/><b>Browse freely</b><small>No seller approval is needed to explore.</small></span><span><ShieldCheck/><b>Connect safely</b><small>A seller approves and assigns a representative after you show interest.</small></span></div><button className="button primary" onClick={()=>window.location.assign('/customer')}>Open organization marketplace <ArrowRight/></button></section></main>;

  return <main className="customer-signup-page">
    <header><Brand/><a href="/customer/sign-in"><ArrowLeft/>Already have an account? Sign in</a></header>
    <div className="customer-signup-layout">
      <section className="customer-signup-story">
        <span className="eyebrow">CUSTOMER PORTAL / CREATE ACCOUNT</span>
        <h1>One login.<br/><em>Every opportunity.</em></h1>
        <p>Create your independent customer account first. You can then explore every discoverable organization without waiting for approval.</p>
        <div className="signup-journey" aria-label="Customer onboarding journey">
          <article className="active"><i>01</i><span><b>Create your login</b><small>Secure access starts immediately.</small></span></article>
          <article><i>02</i><span><b>Browse organizations</b><small>Compare public products and services.</small></span></article>
          <article><i>03</i><span><b>Show interest</b><small>The seller reviews, assigns a representative, and starts the quotation workflow.</small></span></article>
        </div>
        <div className="signup-trust"><ShieldCheck/><span><b>Commercial controls stay protected</b><small>Pricing, quotations, negotiation, approvals, and invoices only become available inside an approved seller relationship.</small></span></div>
      </section>
      <section className="customer-signup-card" aria-labelledby="signup-title">
        <div className="signup-card-heading"><span><UserRound/></span><div><small>NEW CUSTOMER</small><h2 id="signup-title">Create your account</h2></div></div>
        <p className="signup-card-copy">No organization selection is required. You will choose who to contact after signing in.</p>
        {error&&<div className="auth-error" role="alert">{error}</div>}
        <form onSubmit={submit}>
          <div className="signup-pair"><label>Full name<input aria-label="Full name" value={contactName} onChange={event=>setContactName(event.target.value)} autoComplete="name" required minLength={2} maxLength={120} placeholder="Asha Rao"/></label><label>Company name<input aria-label="Company name" value={companyName} onChange={event=>setCompanyName(event.target.value)} autoComplete="organization" required minLength={2} maxLength={160} placeholder="Northstar Labs"/></label></div>
          <label>Business email<input aria-label="Business email" value={email} onChange={event=>setEmail(event.target.value)} type="email" autoComplete="email" required placeholder="asha@company.com"/></label>
          <label>Password<span className="signup-password"><input aria-label="Password" value={password} onChange={event=>setPassword(event.target.value)} type={visible?'text':'password'} autoComplete="new-password" minLength={12} maxLength={128} required placeholder="Create a strong password"/><button type="button" aria-label={visible?'Hide password':'Show password'} onClick={()=>setVisible(!visible)}>{visible?<EyeOff/>:<Eye/>}</button></span></label>
          <div className="password-requirements" aria-live="polite">{passwordChecks.map(item=><span className={item.valid?'valid':''} key={item.label}><Check/>{item.label}</span>)}</div>
          <label>Confirm password<input aria-label="Confirm password" value={confirmation} onChange={event=>setConfirmation(event.target.value)} type={visible?'text':'password'} autoComplete="new-password" required placeholder="Repeat your password"/></label>
          {confirmation&&password!==confirmation&&<p className="field-error">Passwords do not match.</p>}
          <label className="signup-consent"><input type="checkbox" checked={accepted} onChange={event=>setAccepted(event.target.checked)} required/><span>I agree to use DealOS for legitimate business enquiries and understand that each seller controls access to its private deal room.</span></label>
          <button className="customer-email-submit" disabled={busy||!valid}>{busy?'Creating secure account…':'Create customer account'}<ArrowRight/></button>
          <p className="signup-security"><LockKeyhole/>Credentials are encrypted in transit and your password is stored only as a secure hash.</p>
        </form>
      </section>
    </div>
  </main>;
}
