import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PricingSection from '../../src/components/PricingSection';
import type { WebMcpToolDefinition } from '../../src/lib/academy-webmcp';
import { ui } from '../../src/i18n/translations';

vi.mock('../../src/components/ResponsiveTurnstile', async () => {
    const ReactModule = await import('react');
    const MockResponsiveTurnstile = ReactModule.forwardRef(function MockResponsiveTurnstile(_props, ref) {
        ReactModule.useImperativeHandle(ref, () => ({ reset: vi.fn() }));
        return ReactModule.createElement('div', { 'data-testid': 'turnstile-awaiting-human' });
    });
    return { default: MockResponsiveTurnstile };
});

type PricingSectionProps = React.ComponentProps<typeof PricingSection>;
const translations = ui.es.pricing as unknown as PricingSectionProps['translations'];
const slot = {
    publicId: '11111111-1111-4111-8111-111111111111',
    teacherName: 'Álex',
    weekday: 1,
    localStartTime: '18:00:00',
    timezoneName: 'Europe/Madrid',
    firstClassAt: '2035-01-08T17:00:00.000Z',
    renewalAt: '2035-02-05T17:00:00.000Z',
    occurrences: [
        { index: 1, startsAt: '2035-01-08T17:00:00.000Z', durationMinutes: 50 },
        { index: 2, startsAt: '2035-01-15T17:00:00.000Z', durationMinutes: 50 },
        { index: 3, startsAt: '2035-01-22T17:00:00.000Z', durationMinutes: 50 },
        { index: 4, startsAt: '2035-01-29T17:00:00.000Z', durationMinutes: 50 },
    ],
};
const targetPackage = {
    name: 'individual_4x50_28d',
    display_name: { es: '4 clases individuales', en: '4 individual classes', ru: '4 classes' },
    price_monthly: 25900,
    sessions_per_month: 4,
    has_group_session: false,
    has_dual_teacher: false,
};

describe('academy WebMCP shared page UI', () => {
    const definitions = new Map<string, WebMcpToolDefinition>();
    let fetchMock: ReturnType<typeof vi.fn>;
    let checkoutEnabled: boolean;

    beforeEach(() => {
        window.history.pushState(null, '', '/es');
        definitions.clear();
        Object.defineProperty(document, 'modelContext', {
            configurable: true,
            value: {
                registerTool: vi.fn((definition: WebMcpToolDefinition, options: { signal: AbortSignal }) => {
                    definitions.set(definition.name, definition);
                    options.signal.addEventListener('abort', () => {
                        definitions.delete(definition.name);
                    }, { once: true });
                }),
            },
        });
        checkoutEnabled = false;
        fetchMock = vi.fn().mockImplementation((input: string | URL | Request) => {
            const url = typeof input === 'string'
                ? input
                : input instanceof URL
                    ? input.toString()
                    : input.url;
            if (url === '/api/bookable-slots') {
                return Promise.resolve(Response.json({ slots: [slot], checkoutEnabled }));
            }
            if (url === '/api/auth/checkout-readiness') {
                return Promise.resolve(new Response(null, { status: 204 }));
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        Reflect.deleteProperty(document, 'modelContext');
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        document.body.classList.remove('overflow-hidden');
    });

    it('keeps the ordinary learning-brief UI usable when document.modelContext is unavailable', () => {
        Reflect.deleteProperty(document, 'modelContext');

        render(
            <PricingSection
                packages={[targetPackage]}
                lang="es"
                translations={translations}
            />,
        );

        const goal = screen.getByLabelText('Objetivo de aprendizaje');
        fireEvent.change(goal, { target: { value: 'Conversar con más soltura' } });
        expect(goal).toHaveValue('Conversar con más soltura');

        fireEvent.click(screen.getByRole('button', { name: 'Limpiar preparación' }));
        expect(goal).toHaveValue('');
        expect(screen.getByRole('status')).toHaveTextContent('La selección y el borrador se han limpiado.');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('keeps agent-drafted context editable and clears it through the same visible bridge', async () => {
        render(
            <PricingSection
                packages={[targetPackage]}
                lang="es"
                translations={translations}
            />,
        );
        await waitFor(() => expect(definitions.size).toBe(6));

        await act(async () => {
            await definitions.get('draft_learning_brief')!.execute({
                currentLevel: 'b1',
                goal: 'Participar en reuniones de trabajo',
                context: 'Practicar interrupciones y resúmenes breves',
                timezone: 'Europe/Madrid',
            });
        });

        expect(screen.getByLabelText('Nivel actual aproximado')).toHaveValue('b1');
        expect(screen.getByLabelText('Objetivo de aprendizaje')).toHaveValue('Participar en reuniones de trabajo');
        expect(screen.getByLabelText('Contexto útil para el profesor')).toHaveValue('Practicar interrupciones y resúmenes breves');
        expect(screen.getByLabelText('Tu zona horaria')).toHaveValue('Europe/Madrid');

        fireEvent.change(screen.getByLabelText('Objetivo de aprendizaje'), {
            target: { value: 'Objetivo editado por la persona' },
        });
        expect(screen.getByLabelText('Objetivo de aprendizaje')).toHaveValue('Objetivo editado por la persona');

        await act(async () => {
            await definitions.get('clear_booking_draft')!.execute({});
        });
        expect(screen.getByLabelText('Nivel actual aproximado')).toHaveValue('not_sure');
        expect(screen.getByLabelText('Objetivo de aprendizaje')).toHaveValue('');
        expect(screen.getByLabelText('Contexto útil para el profesor')).toHaveValue('');
    });

    it('revalidates and selects a real slot in the existing modal without any checkout POST', async () => {
        render(
            <PricingSection
                packages={[targetPackage]}
                lang="es"
                translations={translations}
            />,
        );
        await waitFor(() => expect(definitions.size).toBe(6));

        await act(async () => {
            await definitions.get('prepare_booking_review')!.execute({ publicSlotId: slot.publicId });
        });

        const selected = await screen.findByRole('radio', { name: /Álex/i });
        await waitFor(() => expect(selected).toBeChecked());
        expect(screen.getByRole('dialog', { name: '4 clases individuales' })).toBeInTheDocument();
        expect(screen.getByText(translations.modal.checkoutClosed!)).toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        for (const [url, init] of fetchMock.mock.calls as Array<[string, RequestInit]>) {
            expect(url).toBe('/api/bookable-slots');
            expect(init.method).toBe('GET');
        }
        expect(fetchMock).not.toHaveBeenCalledWith('/api/create-checkout', expect.anything());

        await act(async () => {
            await definitions.get('clear_booking_draft')!.execute({});
        });
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('keeps checkout-open consent, security, and payment entirely human-controlled', async () => {
        checkoutEnabled = true;
        render(
            <PricingSection
                packages={[targetPackage]}
                lang="es"
                translations={translations}
            />,
        );
        await waitFor(() => expect(definitions.size).toBe(6));

        await act(async () => {
            await definitions.get('prepare_booking_review')!.execute({ publicSlotId: slot.publicId });
        });

        const acknowledgements = await screen.findAllByRole('checkbox');
        expect(acknowledgements).toHaveLength(4);
        for (const acknowledgement of acknowledgements) expect(acknowledgement).not.toBeChecked();
        expect(screen.getByTestId('turnstile-awaiting-human')).toBeInTheDocument();
        expect(fetchMock.mock.calls.map(([input]) => input)).not.toContain('/api/create-checkout');

        fireEvent.click(screen.getByRole('button', { name: translations.modal.continue! }));
        expect(await screen.findByRole('alert')).toHaveTextContent(translations.modal.policyError!);
        expect(fetchMock.mock.calls.map(([input]) => input)).not.toContain('/api/create-checkout');
    });
});
