import { useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  ChevronDown,
  ShieldCheck,
  Eye,
  EyeOff,
  LockKeyhole,
} from "lucide-react";
import { request } from "./api";
import "./public.css";
import { Brand } from "./Brand";
const stages = ["Quote", "Approve", "Fulfill", "Bill"];
export { Landing } from "./MotionLanding";

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
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await request(signup ? "/auth/signup" : "/auth/login", {
        method: "POST",
        body: JSON.stringify(
          signup ? { email, password, displayName: name } : { email, password },
        ),
      });
      if (signup) setDone(true);
      else await onSuccess();
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
          {done ? (
            <div className="signup-success" role="status">
              <span className="success-icon">
                <Check />
              </span>
              <span className="section-label">YOU’VE MADE THE FIRST MOVE</span>
              <h2>Request received.</h2>
              <p>
                If this email is new, your account is now pending administrator
                activation. You’ll need your administrator to enable access
                before signing in.
              </p>
              <a href="/sign-in" className="cta">
                Back to sign in <ArrowRight />
              </a>
            </div>
          ) : (
            <form className="auth-form" onSubmit={submit}>
              <span className="section-label">
                {signup ? "A CLEARER WAY FORWARD" : "YOUR WORKSPACE AWAITS"}
              </span>
              <h2>{signup ? "Make your next move." : "Welcome back."}</h2>
              <p>
                {signup
                  ? "Request access and bring every deal into focus."
                  : "A little less friction. A lot more momentum."}
              </p>
              {(error || externalError) && (
                <div className="auth-error" role="alert">
                  {error || externalError}
                </div>
              )}
              {signup && (
                <label>
                  Full name
                  <input
                    autoComplete="name"
                    required
                    maxLength={120}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jordan Davis"
                  />
                </label>
              )}
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
              {signup && (
                <small>
                  Accounts require administrator activation before workspace
                  access.
                </small>
              )}
              <button className="cta" disabled={busy}>
                {busy
                  ? "Just a moment…"
                  : signup
                    ? "Request workspace access"
                    : "Sign in to your workspace"}
                <ArrowUpRight />
              </button>
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
          )}
        </div>
        <div className="auth-security">
          <LockKeyhole /> Protected by secure, server-managed sessions.
        </div>
      </main>
    </div>
  );
}
