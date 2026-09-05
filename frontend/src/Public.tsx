import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  ChevronDown,
  ShieldCheck,
  Eye,
  EyeOff,
  LockKeyhole,
  Building2,
  UserPlus,
  Trash2,
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

function GoogleSignup({ onComplete, onError }: { onComplete: (complete: boolean) => void; onError: (message: string) => void }) {
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
            await request("/auth/google/signup", {
              method: "POST",
              body: JSON.stringify({ credential }),
            });
            onComplete(true);
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
        text: "signup_with",
        shape: "rectangular",
        logo_alignment: "left",
        width: Math.min(400, buttonRef.current.clientWidth || 400),
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
  }, [clientId, onComplete, onError]);

  if (!clientId) return (
    <>
      <button
        type="button"
        className="google-signup-fallback"
        aria-label="Continue with Google"
        onClick={() => onError(configurationLoaded
          ? "Google signup is not configured yet. Add GOOGLE_CLIENT_ID to backend/.env and restart the backend."
          : "Google signup is still loading. Please try again in a moment.")}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.55h3.24c1.9-1.75 2.98-4.33 2.98-7.42Z" />
          <path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.35l-3.24-2.55c-.9.6-2.05.96-3.38.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.63A10 10 0 0 0 12 22Z" />
          <path fill="#FBBC05" d="M6.39 13.93A6.01 6.01 0 0 1 6.08 12c0-.67.12-1.32.31-1.93V7.44H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.56l3.35-2.63Z" />
          <path fill="#EA4335" d="M12 5.94c1.47 0 2.79.5 3.83 1.5l2.87-2.88A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.96 5.44l3.35 2.63C7.18 7.7 9.39 5.94 12 5.94Z" />
        </svg>
        Continue with Google
      </button>
      <div className="auth-divider"><span>or continue with work email</span></div>
    </>
  );
  return (
    <>
      <div className="google-signup" ref={buttonRef} aria-label="Google signup" />
      <div className="auth-divider"><span>or continue with work email</span></div>
    </>
  );
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
  const [users, setUsers] = useState([{ email: "", role: "REP" }]);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const setupComplete = !signup && new URLSearchParams(window.location.search).get("setup") === "complete";
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (signup && step < 3) {
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
            users: users.filter(user => user.email.trim()),
          } : { email, password },
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
                <div className="onboarding-progress" aria-label={`Onboarding step ${step} of 3`}>
                  {["Organization", "User access", "Credentials"].map((label, index) => (
                    <span className={step >= index + 1 ? "active" : ""} key={label}>
                      <i>{step > index + 1 ? <Check /> : index + 1}</i>{label}
                    </span>
                  ))}
                </div>
              )}
              <span className="section-label">
                {signup ? `SETUP ${step} OF 3` : "YOUR WORKSPACE AWAITS"}
              </span>
              <h2>{signup ? ["Create your organization.", "Set user access.", "Create admin credentials."][step - 1] : "Welcome back."}</h2>
              <p>
                {signup
                  ? [
                    "The first account becomes this organization’s administrator.",
                    "Add the people who should receive role-based workspace access.",
                    "Use these credentials to sign in as the organization admin.",
                  ][step - 1]
                  : "A little less friction. A lot more momentum."}
              </p>
              {setupComplete && (
                <div className="auth-success" role="status">
                  <Check /> Organization created. Sign in with your new admin credentials.
                </div>
              )}
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
                <div className="access-list">
                  {users.map((user, index) => (
                    <div className="access-row" key={index}>
                      <label>
                        User email
                        <input
                          type="email"
                          value={user.email}
                          onChange={(e) => setUsers(users.map((item, itemIndex) => itemIndex === index ? {...item, email: e.target.value} : item))}
                          placeholder="teammate@company.com"
                        />
                      </label>
                      <label>
                        Access
                        <select value={user.role} onChange={(e) => setUsers(users.map((item, itemIndex) => itemIndex === index ? {...item, role: e.target.value} : item))}>
                          <option value="REP">Sales rep</option>
                          <option value="MANAGER">Manager</option>
                          <option value="FINANCE">Finance</option>
                          <option value="CUSTOMER">Customer</option>
                        </select>
                      </label>
                      {users.length > 1 && <button type="button" className="remove-access" aria-label={`Remove user ${index + 1}`} onClick={() => setUsers(users.filter((_, itemIndex) => itemIndex !== index))}><Trash2 /></button>}
                    </div>
                  ))}
                  <button type="button" className="add-access" onClick={() => setUsers([...users, {email: "", role: "REP"}])}><UserPlus /> Add another user</button>
                  <small>You can also add or change access later from the admin workspace.</small>
                </div>
              )}
              {signup && step === 3 && (
                <>
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
                Work email
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
                  This first account will have organization administrator access.
                </small>
                </>
              )}
              {!signup && <>
                <label>
                  Work email
                  <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
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
                    ? step < 3 ? "Continue" : "Create admin account"
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
              {!signup && (
                <details className="demo-roles">
                  <summary>
                    Just exploring? Choose a demo role <ChevronDown />
                  </summary>
                  <div>
                    {[
                      ["rep", "Sales rep"],
                      ["manager", "Manager"],
                      ["finance", "Finance"],
                      ["admin", "Admin"],
                      ["customer", "Customer"],
                    ].map(([v, t]) => (
                      <button
                        type="button"
                        key={v}
                        onClick={() => {
                          setEmail(`${v}@dealos.demo`);
                          setPassword("DealOS2026!");
                        }}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                  <small>
                    Local development accounts. Select a role, then sign in.
                  </small>
                </details>
              )}
            </form>
        </div>
        <div className="auth-security">
          <LockKeyhole /> Protected by secure, server-managed sessions.
        </div>
      </main>
    </div>
  );
}
