import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CrmConsentManager from '../../src/components/admin/CrmConsentManager';

const consent = {
    id: '40000000-0000-4000-8000-000000000001',
    channel: 'email',
    purpose: 'sales_follow_up',
    legal_basis: 'consent',
    source: 'lead_capture',
    proof: 'Accepted privacy policy in lead form.',
    notice_version: 'privacy-v1',
    captured_at: '2026-06-24T10:00:00.000Z',
    opted_out_at: null,
    created_at: '2026-06-24T10:00:00.000Z',
    updated_at: '2026-06-24T10:00:00.000Z',
};

describe('CrmConsentManager', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({ consent }),
        }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('sends an upsert_consent action from the form', async () => {
        render(
            <CrmConsentManager
                contactId="10000000-0000-4000-8000-000000000001"
                consents={[]}
            />
        );

        fireEvent.change(screen.getByLabelText('Base legal'), {
            target: { value: 'consent' },
        });
        fireEvent.change(screen.getByLabelText('Prueba'), {
            target: { value: 'Accepted privacy policy.' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Guardar base legal' }));

        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
        const [, request] = vi.mocked(fetch).mock.calls[0];
        expect(request).toMatchObject({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        expect(JSON.parse(request?.body as string)).toEqual({
            action: 'upsert_consent',
            contactId: '10000000-0000-4000-8000-000000000001',
            channel: 'email',
            purpose: 'sales_follow_up',
            legalBasis: 'consent',
            source: 'admin_review',
            proof: 'Accepted privacy policy.',
            noticeVersion: 'privacy-v1',
            capturedAt: null,
        });
    });

    it('sends an opt_out_consent action for active consent rows', async () => {
        render(
            <CrmConsentManager
                contactId="10000000-0000-4000-8000-000000000001"
                consents={[consent]}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Registrar opt-out' }));

        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
        const [, request] = vi.mocked(fetch).mock.calls[0];
        expect(JSON.parse(request?.body as string)).toEqual({
            action: 'opt_out_consent',
            consentId: consent.id,
            reason: 'Opt-out registrado desde ficha CRM',
        });
    });
});
