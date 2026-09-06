import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  ShieldCheck,
  Eye,
  EyeOff,
  LockKeyhole,
  Building2,
} from "lucide-react";
import { request } from "./api";
import "./public.css";
import { Brand } from "./Brand";
const stages = ["Quote", "Approve", "Fulfill", "Bill"];
export { Landing } from "./MotionLanding";

type GoogleAccounts = {
  id: {
    initialize: (options: { client_id: string; callback: (response: { credential: string }) => void }) => void;
    renderButton: (element: HTMLElement, options: Record<string, string | number>) => void;
  };
};

declare global {
  interface Window {
    google?: { accounts: GoogleAccounts };
  }
}

function GoogleAuth({ mode, organizationName = "", email = "", hideDivider = false, onComplete, onError }: { mode: "signup" | "login" | "customer"; organizationName?: string; email?: string; hideDivider?: boolean; onComplete: () => void | Promise<void>; onError: (message: string) => void }) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [configurationLoaded, setConfigurationLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    request<{ enabled: boolean; clientId: string | null }>("/auth/google/config")
      .then((config) => {
        if (active && config.enabled && config.clientId) setClientId(config.clientId);
      })
      .catch(() => undefined)
      .finally(() => { if (active) setConfigurationLoaded(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!clientId || !buttonRef.current) return;
    let active = true;
    const render = () => {
      if (!active || !buttonRef.current || !window.google) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async ({ credential }) => {
          onError("");
          try {
            await request(`/auth/google/${mode}`, {
              method: "POST",
              body: JSON.stringify(mode === "signup" ? { credential, organizationName } : mode === "customer" ? { credential, ...(email ? { email } : {}) } : { credential }),
            });
            await onComplete();
          } catch (error) {
            onError(error instanceof Error ? error.message : "Google signup could not be completed.");
          }
        },
      });
      buttonRef.current.replaceChildren();
      window.google.accounts.id.renderButton(buttonRef.current, {
        type: "standard",
        theme: "outline",
        size: "large",
        text: mode === "signup" ? "signup_with" : "signin_with",
        shape: "rectangular",
        logo_alignment: "left",
        width: buttonRef.current.clientWidth || 400,
      });
    };
    const existing = document.querySelector<HTMLScriptElement>('script[data-dealos-google-identity]');
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", render);
    if (!existing) {
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.dataset.dealosGoogleIdentity = "true";
      document.head.appendChild(script);
    }
    if (window.google) {
      render();
    }
    return () => {
      active = false;
      script.removeEventListener("load", render);
      buttonRef.current?.replaceChildren();
    };
  }, [clientId, email, mode, onComplete, onError, organizationName]);

  if (!clientId) return (
    <>
      <button
        type="button"
        className="google-signup-fallback"
        aria-label={mode === "signup" ? "Sign up with Google" : mode === "customer" ? "Continue with Google Sign-In ID" : "Sign in with Google"}
        onClick={() => onError(configurationLoaded
          ? "Google authentication is not configured yet. Add GOOGLE_CLIENT_ID to backend/.env and restart the backend."
          : "Google authentication is still loading. Please try again in a moment.")}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.55h3.24c1.9-1.75 2.98-4.33 2.98-7.42Z" />
          <path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.35l-3.24-2.55c-.9.6-2.05.96-3.38.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.63A10 10 0 0 0 12 22Z" />
          <path fill="#FBBC05" d="M6.39 13.93A6.01 6.01 0 0 1 6.08 12c0-.67.12-1.32.31-1.93V7.44H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.56l3.35-2.63Z" />
          <path fill="#EA4335" d="M12 5.94c1.47 0 2.79.5 3.83 1.5l2.87-2.88A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.96 5.44l3.35 2.63C7.18 7.7 9.39 5.94 12 5.94Z" />
        </svg>
        {mode === "signup" ? "Sign up with Google" : mode === "customer" ? "Continue with Google Sign-In ID" : "Sign in with Google"}
      </button>
      {!hideDivider&&<div className="auth-divider"><span>or continue with work email</span></div>}
    </>
  );
  return (
    <>
      <div className="google-signup" ref={buttonRef} aria-label={`Google ${mode}`}>
        <span className="google-loading">Loading Google…</span>
      </div>
      {!hideDivider&&<div className="auth-divider"><span>or continue with work email</span></div>}
    </>
  );
}

export function CustomerAuthPage({ onSuccess, signedInRole }: { onSuccess: () => void | Promise<void>; signedInRole?: string | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await request("/auth/customer/login", { method: "POST", body: JSON.stringify({ email: email.trim().toLowerCase(), password }) });
      await onSuccess();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Customer sign-in could not be completed.");
    } finally {
      setBusy(false);
    }
  }
  return <main className="customer-auth-page">
    <header className="customer-auth-header">
      <div className="customer-auth-brand"><Brand/><span>Customer portal</span></div>
      <a className="customer-workspace-link" href="/sign-in">Team workspace <ArrowUpRight/></a>
    </header>
    <div className="customer-auth-layout">
      <section className="customer-auth-story" aria-labelledby="customer-auth-title">
        <span className="customer-auth-index">CUSTOMER ACCESS / ONE SHARED RECORD</span>
        <h1 id="customer-auth-title">Your deal.<br/><em>Without the chase.</em></h1>
        <p>Review every approved quotation, invoice, and conversation from one private workspace.</p>
        <div className="customer-deal-preview" aria-hidden="true">
          <div className="customer-deal-preview-top"><span><img src="/images/dealos-logo.png" alt="DealOS" /></span><b><i/> Shared securely</b></div>
          <div className="customer-deal-preview-head"><span><small>QUOTATION Q-1048</small><strong>Your latest proposal</strong></span><b>₹1,28,64,000</b></div>
          <div className="customer-deal-preview-lines"><span>Commercial terms <b>Ready to review</b></span><span>Conversation <b>Attached to the deal</b></span></div>
          <div className="customer-deal-preview-foot"><ShieldCheck/><span><small>VERIFIED ACCESS</small><b>Only documents shared with your email</b></span></div>
        </div>
        <div className="customer-story-points"><span><Check/> Review terms</span><span><Check/> Request changes</span><span><Check/> Track invoices</span></div>
      </section>
      <section className="customer-auth-card" aria-label="Customer portal sign in">
        <div className="customer-auth-card-head">
          <div className="customer-auth-mark"><ShieldCheck/></div>
          <span><small>SECURE DEAL ROOM</small><b>Customer access</b></span>
        </div>
        <h2>Everything shared with you, in one place.</h2>
        <p>Sign in to browse organizations or continue an approved private deal room.</p>
        {signedInRole&&signedInRole!=="CUSTOMER"&&<div className="auth-error" role="status">Signing in below will switch this browser from the internal workspace to the customer portal.</div>}
        <form className="customer-login-form" onSubmit={submit}>
          <label className="customer-email-field">Customer Email ID<input required type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={event=>{setEmail(event.target.value);setError("")}}/></label>
          <label className="customer-email-field">Password<span className="customer-password-field"><input required minLength={8} type={visible?"text":"password"} autoComplete="current-password" placeholder="Enter your password" value={password} onChange={event=>{setPassword(event.target.value);setError("")}}/><button type="button" aria-label={visible?"Hide password":"Show password"} onClick={()=>setVisible(!visible)}>{visible?<EyeOff/>:<Eye/>}</button></span></label>
          <button className="customer-email-submit" disabled={busy}>{busy?"Signing in…":"Sign in with Email ID"}<ArrowUpRight/></button>
        </form>
        <div className="customer-auth-divider"><span>or continue with Google</span></div>
        <GoogleAuth mode="customer" email={email.trim().toLowerCase()} hideDivider onComplete={onSuccess} onError={setError}/>
        {error&&<div className="auth-error" role="alert">{error}</div>}
        <div className="customer-signup-link"><span>New to the customer portal?</span><a href="/customer/sign-up">Create an account request <ArrowRight/></a></div>
        <div className="customer-auth-trust"><span><Check/>Verified email matching</span><span><LockKeyhole/>Customer-scoped access</span></div>
      </section>
    </div>
    <footer className="customer-auth-footer"><span>Marketplace access starts immediately. Private deal access begins after seller approval and assignment.</span><b>Made with <i>♥</i> by Amartya, Sanket, Hitesh &amp; Aryan.</b></footer>
  </main>;
}

export function AuthPage({
  signup = false,
  onSuccess,
  error: externalError = "",
}: {
  signup?: boolean;
  onSuccess: () => void | Promise<void>;
  error?: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [step, setStep] = useState(1);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (signup) return;
    const generated = window.sessionStorage.getItem("dealos_generated_login");
    if (!generated) return;
    try {
      const credentials = JSON.parse(generated) as { email?: string; loginId?: string; password?: string };
      if (credentials.loginId) setEmail(credentials.loginId);
      if (credentials.password) setPassword(credentials.password);
    } catch {
      // Ignore malformed local handoff data and show the normal sign-in form.
    } finally {
      window.sessionStorage.removeItem("dealos_generated_login");
    }
  }, [signup]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (signup && step < 2) {
      setStep(step + 1);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await request(signup ? "/auth/signup" : "/auth/login", {
        method: "POST",
        body: JSON.stringify(
          signup ? {
            organizationName,
            email,
            password,
            displayName: name,
          } : { identifier: email, password },
        ),
      });
      await onSuccess();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to connect. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <div className="auth-story">
        <Brand />
        <div>
          <span className="section-label">ONE WORKSPACE. EVERY MOVE.</span>
          <h1>
            Great things <br />
            are moving <br />
            <span>your way.</span>
          </h1>
          <p>
            Every commercial decision
            <br />
            in one accountable flow.
          </p>
          <div className="auth-mini-flow">
            {stages.map((s, i) => (
              <span key={s}>
                <small>0{i + 1}</small>
                {s}
                {i < 3 && <ArrowRight />}
              </span>
            ))}
          </div>
        </div>
        <span className="auth-story-foot">
          <ShieldCheck /> Clarity at every step. Confidence in every deal.
        </span>
      </div>
      <main className="auth-main">
        <a className="auth-back" href="/">
          ← Back to DealOS
        </a>
        <div className="auth-form-wrap">
            <form className="auth-form" onSubmit={submit}>
              {signup && (
                <div className="onboarding-progress two" aria-label={`Onboarding step ${step} of 2`}>
                  {["Organization", "Admin account"].map((label, index) => (
                    <span className={step >= index + 1 ? "active" : ""} key={label}>
                      <i>{step > index + 1 ? <Check /> : index + 1}</i>{label}
                    </span>
                  ))}
                </div>
              )}
              <span className="section-label">
                {signup ? `SETUP ${step} OF 2` : "YOUR WORKSPACE AWAITS"}
              </span>
              <h2>{signup ? ["Create your organization.", "Create the admin account."][step - 1] : "Welcome back."}</h2>
              <p>
                {signup
                  ? [
                    "The first account becomes this organization’s administrator.",
                    "Continue with Google or create credentials for the first organization admin.",
                  ][step - 1]
                  : "A little less friction. A lot more momentum."}
              </p>
              {(error || externalError) && (
                <div className="auth-error" role="alert">
                  {error || externalError}
                </div>
              )}
              {signup && step === 1 && (
                <label>
                  Organization name
                  <div className="field-with-icon">
                    <Building2 />
                    <input
                      autoFocus
                      required
                      minLength={2}
                      maxLength={120}
                      value={organizationName}
                      onChange={(e) => setOrganizationName(e.target.value)}
                      placeholder="Acme, Inc."
                    />
                  </div>
                </label>
              )}
              {signup && step === 2 && (
                <>
                <GoogleAuth mode="signup" organizationName={organizationName} onComplete={onSuccess} onError={setError} />
                <label>
                  Admin full name
                  <input
                    autoComplete="name"
                    required
                    maxLength={120}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jordan Davis"
                  />
                </label>
              <label>
                Admin email
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                />
              </label>
              <label>
                Password
                <div className="password-field">
                  <input
                    type={visible ? "text" : "password"}
                    autoComplete={signup ? "new-password" : "current-password"}
                    required
                    minLength={signup ? 12 : 8}
                    maxLength={128}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={
                      signup ? "At least 12 characters" : "Enter your password"
                    }
                  />
                  <button
                    type="button"
                    aria-label={visible ? "Hide password" : "Show password"}
                    onClick={() => setVisible(!visible)}
                  >
                    {visible ? <EyeOff /> : <Eye />}
                  </button>
                </div>
              </label>
                <small>
                  User access is configured after setup from the admin workspace.
                </small>
                </>
              )}
              {!signup && <GoogleAuth mode="login" onComplete={onSuccess} onError={setError} />}
              {!signup && <>
                <label>
                  Email or user ID
                  <input autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com or DL-1234ABCD" />
                </label>
                <label>
                  Password
                  <div className="password-field">
                    <input type={visible ? "text" : "password"} autoComplete="current-password" required minLength={8} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" />
                    <button type="button" aria-label={visible ? "Hide password" : "Show password"} onClick={() => setVisible(!visible)}>{visible ? <EyeOff /> : <Eye />}</button>
                  </div>
                </label>
              </>}
              <div className="onboarding-actions">
                {signup && step > 1 && <button className="back-step" type="button" onClick={() => setStep(step - 1)}>Back</button>}
              <button className="cta" disabled={busy}>
                {busy
                  ? "Just a moment…"
                  : signup
                    ? step < 2 ? "Continue" : "Create organization"
                    : "Sign in to your workspace"}
                <ArrowUpRight />
              </button>
              </div>
              <div className="auth-switch">
                {signup ? "Already have an account?" : "New to DealOS?"}{" "}
                <a href={signup ? "/sign-in" : "/sign-up"}>
                  {signup ? "Sign in" : "Get started"} <ArrowUpRight />
                </a>
              </div>
            </form>
        </div>
        <div className="auth-security">
          <LockKeyhole /> Protected by secure, server-managed sessions.
        </div>
      </main>
    </div>
  );
}
