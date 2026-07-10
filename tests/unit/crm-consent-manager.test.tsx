import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CrmConsentManager from '../../src/components/admin/CrmConsentManager';

// Component coverage for src/components/admin/CrmConsentManager.tsx.
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
        vi.useFakeTimers({ shouldAdvanceTime: true });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({ consent }),
        }));
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('renders empty and active consent states with accessible controls', () => {
        const { rerender } = render(
            <CrmConsentManager
                contactId="10000000-0000-4000-8000-000000000001"
                consents={[]}
            />
        );

        expect(screen.getByText('Sin base legal registrada.')).toBeInTheDocument();
        expect(screen.getByLabelText('Canal')).toHaveValue('email');
        expect(screen.getByLabelText('Finalidad')).toHaveValue('sales_follow_up');
        expect(screen.getByLabelText('Base legal')).toHaveValue('manual_review_required');
        expect(screen.getByRole('button', { name: 'Guardar base legal' })).toBeEnabled();

        rerender(
            <CrmConsentManager
                contactId="10000000-0000-4000-8000-000000000001"
                consents={[consent]}
            />
        );

        expect(screen.getByText('Activo')).toBeInTheDocument();
        expect(screen.getByText('Accepted privacy policy in lead form.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Registrar opt-out' })).toBeEnabled();
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
        fireEvent.change(screen.getByLabelText('Fecha'), {
            target: { value: '2026-06-24T12:30' },
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
            capturedAt: '2026-06-24T12:30:00.000Z',
        });
        expect(await screen.findByRole('status')).toHaveTextContent('Base legal guardada.');
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
        expect(await screen.findByRole('status')).toHaveTextContent('Opt-out registrado.');
    });

    it('disables the save action while consent is being saved', async () => {
        let resolveFetch: (value: { ok: boolean; json: () => Promise<unknown> }) => void = () => {};
        const pendingResponse = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
            resolveFetch = resolve;
        });
        vi.stubGlobal('fetch', vi.fn().mockReturnValue(pendingResponse));

        render(
            <CrmConsentManager
                contactId="10000000-0000-4000-8000-000000000001"
                consents={[]}
            />
        );

        const saveButton = screen.getByRole('button', { name: 'Guardar base legal' });
        fireEvent.click(saveButton);

        expect(saveButton).toBeDisabled();
        expect(saveButton).toHaveTextContent('Guardando...');

        await act(async () => {
            resolveFetch({ ok: true, json: () => Promise.resolve({ consent }) });
            await pendingResponse;
        });

        expect(saveButton).toBeEnabled();
    });

    it('shows an alert when the consent action fails', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            json: vi.fn().mockResolvedValue({ error: 'Consent requires manual review.' }),
        }));

        render(
            <CrmConsentManager
                contactId="10000000-0000-4000-8000-000000000001"
                consents={[]}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Guardar base legal' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Consent requires manual review.');
    });
});
