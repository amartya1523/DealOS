import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Customer } from '../../api';
import { PortalAccessSection } from './PortalAccessSection';

const customer: Customer = {
  id: 'customer-1', name: 'Acme Buyer', tier: 'Gold', currency: 'INR', customerType: 'Business / Company', region: 'India', countryCode: '+91', paymentTerms: 30, active: true,
  email: 'buyer@example.com', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z',
  primaryTeam: { id: 'team-1', name: 'Enterprise' }, primaryRepresentative: { id: 'rep-1', name: 'Priya', assignedAt: '2026-09-01T00:00:00.000Z' },
  invitations: [
    { id: 'invite-1', email: 'buyer@example.com', status: 'PENDING', invitedAt: '2026-09-05T00:00:00.000Z', expiresAt: '2026-09-12T00:00:00.000Z' },
    { id: 'invite-2', email: 'buyer@example.com', status: 'ACCEPTED', invitedAt: '2026-09-04T00:00:00.000Z', expiresAt: '2026-09-11T00:00:00.000Z' },
    { id: 'invite-3', email: 'buyer@example.com', status: 'EXPIRED', invitedAt: '2026-08-01T00:00:00.000Z', expiresAt: '2026-08-08T00:00:00.000Z' },
    { id: 'invite-4', email: 'buyer@example.com', status: 'REVOKED', invitedAt: '2026-07-01T00:00:00.000Z', expiresAt: '2026-07-08T00:00:00.000Z' },
  ],
};

afterEach(cleanup);

describe('portal access section', () => {
  it('disables invitation creation with a clear assignment reason', () => {
    render(<PortalAccessSection customer={{ ...customer, primaryTeam: null, primaryRepresentative: null }} role="ADMIN" onChanged={vi.fn(async()=>undefined)}/>);
    expect(screen.getByRole('button', { name: 'Send invitation' })).toBeDisabled();
    expect(screen.getByText(/Assign a primary sales team and representative/)).toBeInTheDocument();
  });

  it('shows pending, accepted, expired, and revoked invitation history', () => {
    render(<PortalAccessSection customer={customer} role="ADMIN" onChanged={vi.fn(async()=>undefined)}/>);
    for (const status of ['Pending', 'Accepted', 'Expired', 'Revoked']) expect(screen.getByText(new RegExp(`^${status}$`, 'i'))).toBeInTheDocument();
    expect(screen.getByText(/does not send email/i)).toBeInTheDocument();
  });
});
