import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PortalInvitationPage } from './PortalInvitationPage';

const fetchMock = vi.fn();

beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('portal invitation acceptance', () => {
  it('handles an invalid or expired token without leaking account details', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 410, json: async () => ({ success: false, error: { code: 'INVITATION_UNAVAILABLE', message: 'This invitation is invalid, expired, or no longer available.' } }) });
    render(<PortalInvitationPage token="invalid" onAccepted={vi.fn(async()=>undefined)}/>);
    expect(await screen.findByRole('heading', { name: 'This invitation cannot be used.' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('invalid, expired, or no longer available');
  });
});
