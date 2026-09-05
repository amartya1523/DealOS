import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RfqHandlingSettings } from './RfqHandlingSettings';

const fetchMock=vi.fn();
beforeEach(()=>{fetchMock.mockReset();vi.stubGlobal('fetch',fetchMock);fetchMock.mockResolvedValue({ok:true,status:200,json:async()=>({success:true,data:{mode:'DIRECT_DRAFT',changed:true}})})});
afterEach(()=>{cleanup();vi.unstubAllGlobals()});

describe('RFQ handling setting',()=>{
  it('labels the proposed default and sends an audited Admin policy change',async()=>{
    render(<RfqHandlingSettings initialMode="LEAD_FIRST"/>);
    expect(screen.getByText('Proposed default')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio',{name:/Direct draft/}));
    fireEvent.change(screen.getByLabelText('Reason for change'),{target:{value:'Use direct drafts for catalog customers.'}});
    fireEvent.click(screen.getByRole('button',{name:'Save request policy'}));
    await waitFor(()=>expect(fetchMock).toHaveBeenCalledWith('/api/v1/settings/rfq-handling',expect.objectContaining({method:'PUT',body:JSON.stringify({mode:'DIRECT_DRAFT',reason:'Use direct drafts for catalog customers.'})})));
    expect(await screen.findByText(/recorded in the audit trail/i)).toBeInTheDocument();
  });
});
