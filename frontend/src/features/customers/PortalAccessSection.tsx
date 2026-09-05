import { useState } from 'react';
import { Check, Copy, Mail, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { request, type Customer } from '../../api';
import './portal-access.css';

type IssuedInvitation = {
  id: string;
  email: string;
  status: string;
  expiresAt: string;
  invitedAt: string;
  invitationLink: string;
};

const dateTime = (value: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));

export function PortalAccessSection({ customer, role, onChanged }: { customer: Customer; role: string; onChanged: () => Promise<void> }) {
  const [issued, setIssued] = useState<IssuedInvitation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const activeAccount = customer.users?.some((user) => user.status === 'ACTIVE') ?? false;
  const assigned = Boolean(customer.primaryTeam && customer.primaryRepresentative);
  const allowedRole = ['MANAGER', 'ADMIN'].includes(role);
  const disabledReason = !allowedRole
    ? 'Only a Manager or Administrator can create portal invitations.'
    : !assigned
      ? 'Assign a primary sales team and representative before sending an invitation.'
      : !customer.email
        ? 'Add a valid customer email before sending an invitation.'
        : activeAccount
          ? 'This customer already has active portal access.'
          : '';

  async function createInvitation() {
    setBusy(true);
    setError('');
    setIssued(null);
    setCopied(false);
    try {
      const invitation = await request<IssuedInvitation>(`/customers/${customer.id}/portal-invitations`, { method: 'POST', body: '{}' });
      setIssued(invitation);
      await onChanged();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not create the invitation link.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(invitationId: string) {
    setBusy(true);
    setError('');
    try {
      await request(`/customers/${customer.id}/portal-invitations/${invitationId}/revoke`, { method: 'POST', body: '{}' });
      if (issued?.id === invitationId) setIssued(null);
      await onChanged();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not revoke the invitation.');
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.invitationLink);
      setCopied(true);
    } catch {
      setError('Copy is unavailable in this browser. Select and copy the link manually.');
    }
  }

  return <section className="portal-access-section" aria-labelledby="portal-access-title">
    <div className="portal-access-head">
      <div><span>Customer identity</span><h3 id="portal-access-title">Portal access</h3></div>
      <button className="button primary" type="button" disabled={busy || Boolean(disabledReason)} onClick={createInvitation}><Mail/>{busy ? 'Creating…' : 'Send invitation'}</button>
    </div>
    {disabledReason&&<div className="portal-access-guidance"><ShieldCheck/><span><b>Invitation unavailable</b>{disabledReason}</span></div>}
    <p className="portal-access-note">DealOS does not send email in this release. Create the link, copy it, and share it through your approved channel.</p>
    {error&&<div className="error" role="alert">{error}</div>}
    {issued&&<div className="invitation-link-result" role="status">
      <div><Check/><span><b>Invitation link created</b>This link is shown only now. Copy and share it manually.</span></div>
      <label>Invitation link<input readOnly value={issued.invitationLink} onFocus={(event)=>event.currentTarget.select()}/></label>
      <button className="button ghost" type="button" onClick={copyLink}><Copy/>{copied?'Copied':'Copy invitation link'}</button>
    </div>}
    <div className="invitation-history">
      <h4>Invitation status</h4>
      {customer.invitations?.length ? <ul>{customer.invitations.map((invitation) => <li key={invitation.id}>
        <span className={`status ${invitation.status.toLowerCase()}`}>{invitation.status.toLowerCase()}</span>
        <span><b>{invitation.email}</b><small>Issued {dateTime(invitation.invitedAt ?? invitation.createdAt!)}</small></span>
        {invitation.status === 'PENDING'&&allowedRole&&<button type="button" aria-label={`Revoke invitation for ${invitation.email}`} disabled={busy} onClick={()=>revoke(invitation.id)}><X/>Revoke</button>}
      </li>)}</ul> : <div className="portal-access-empty"><RefreshCw/><span>No portal invitation has been issued.</span></div>}
    </div>
  </section>;
}
