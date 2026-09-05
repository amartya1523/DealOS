import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, Check, KeyRound, ShieldCheck } from 'lucide-react';
import { request } from '../../api';
import { Brand } from '../../Brand';
import './portal-invitation.css';

type InvitationPreview = { customerName: string; email: string; expiresAt: string };

export function PortalInvitationPage({ token, onAccepted }: { token: string; onAccepted: () => Promise<void> }) {
  const [invitation, setInvitation] = useState<InvitationPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    let active = true;
    request<InvitationPreview>(`/portal/invitations/${encodeURIComponent(token)}`)
      .then((value) => { if (active) setInvitation(value); })
      .catch((problem) => { if (active) setError(problem instanceof Error ? problem.message : 'This invitation is not available.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const displayName = String(form.get('displayName') ?? '').trim();
    const password = String(form.get('password') ?? '');
    const confirmation = String(form.get('confirmation') ?? '');
    if (password !== confirmation) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await request(`/portal/invitations/${encodeURIComponent(token)}/accept`, { method: 'POST', body: JSON.stringify({ displayName, password }) });
      setComplete(true);
      await onAccepted();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Portal activation could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  return <main className="portal-invitation-page">
    <div className="portal-invitation-brand"><Brand/><span>Customer portal</span></div>
    <section className="portal-invitation-card">
      {loading ? <div className="portal-invitation-state" role="status"><KeyRound/><h1>Checking your invitation…</h1></div>
        : error && !invitation ? <div className="portal-invitation-state invalid" role="alert"><ShieldCheck/><h1>This invitation cannot be used.</h1><p>{error}</p><a href="/customer/sign-in">Return to customer sign in <ArrowRight/></a></div>
          : complete ? <div className="portal-invitation-state"><Check/><h1>Portal access is ready.</h1><p>Opening your secure customer workspace…</p></div>
            : invitation&&<>
              <span className="section-label">SECURE CUSTOMER ACTIVATION</span>
              <h1>Welcome to {invitation.customerName}’s deal room.</h1>
              <p>This invitation is for <b>{invitation.email}</b>. Choose a password to activate an account scoped only to this customer.</p>
              <form onSubmit={accept}>
                <label>Full name<input name="displayName" autoComplete="name" required minLength={1} maxLength={120}/></label>
                <label>Password<input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128}/><small>Use at least 12 characters.</small></label>
                <label>Confirm password<input name="confirmation" type="password" autoComplete="new-password" required minLength={12} maxLength={128}/></label>
                {error&&<div className="auth-error" role="alert">{error}</div>}
                <button className="button primary" disabled={busy}>{busy?'Activating…':'Activate portal account'}<ArrowRight/></button>
              </form>
            </>}
    </section>
  </main>;
}
