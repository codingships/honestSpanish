import type { APIRoute } from 'astro';
import { z } from 'zod';
import { createSupabaseAdminClient } from '../../../lib/supabase-admin';
import { createSupabaseServerClient } from '../../../lib/supabase-server';

const querySchema = z.object({ settlementId: z.string().uuid() });

function csvCell(value: string | number | null | undefined): string {
    let normalized = value === null || value === undefined ? '' : String(value);
    const firstSignificantCharacter = [...normalized].find(
        (character) => (character.codePointAt(0) ?? 0) > 0x20,
    );
    if (firstSignificantCharacter && '=+-@'.includes(firstSignificantCharacter)) {
        normalized = `'${normalized}`;
    }
    return `"${normalized.replaceAll('"', '""')}"`;
}

function csvRow(values: Array<string | number | null | undefined>): string {
    return values.map(csvCell).join(',');
}

export const GET: APIRoute = async (context) => {
    const supabase = createSupabaseServerClient(context);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return new Response('Unauthorized', { status: 401 });

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
    if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
        return new Response('Forbidden', { status: 403 });
    }

    const parsed = querySchema.safeParse({
        settlementId: new URL(context.request.url).searchParams.get('settlementId'),
    });
    if (!parsed.success) return new Response('Invalid settlement', { status: 400 });

    const admin = createSupabaseAdminClient();
    const { data: settlement, error: settlementError } = await admin
        .from('teacher_compensation_settlement_balances')
        .select(`
            id, teacher_id, period_month, period_start_at, period_end_at,
            currency, class_amount_cents, mandatory_work_amount_cents,
            adjustment_amount_cents, total_amount_cents, line_count,
            status, paid_at, payment_reference, invoice_reference
        `)
        .eq('id', parsed.data.settlementId)
        .single();
    if (settlementError || !settlement?.id || !settlement.teacher_id) {
        return new Response('Not found', { status: 404 });
    }
    if (profile.role === 'teacher' && settlement.teacher_id !== user.id) {
        return new Response('Forbidden', { status: 403 });
    }

    const { data: lines, error: linesError } = await admin
        .from('teacher_compensation_settlement_lines')
        .select(`
            source_kind, source_occurred_at, quantity_minutes,
            description, amount_cents, currency
        `)
        .eq('settlement_id', settlement.id)
        .order('source_occurred_at', { ascending: true })
        .order('source_kind', { ascending: true })
        .order('source_id', { ascending: true });
    if (linesError) return new Response('Could not export settlement', { status: 500 });

    const rows = [
        csvRow(['period_month', 'status', 'paid_at', 'payment_reference', 'invoice_reference']),
        csvRow([
            settlement.period_month,
            settlement.status,
            settlement.paid_at,
            settlement.payment_reference,
            settlement.invoice_reference,
        ]),
        '',
        csvRow(['source_kind', 'occurred_at', 'minutes', 'description', 'amount_cents', 'currency']),
        ...(lines || []).map((line) => csvRow([
            line.source_kind,
            line.source_occurred_at,
            line.quantity_minutes,
            line.description,
            line.amount_cents,
            line.currency,
        ])),
        '',
        csvRow(['class_total_cents', settlement.class_amount_cents]),
        csvRow(['mandatory_work_total_cents', settlement.mandatory_work_amount_cents]),
        csvRow(['adjustment_total_cents', settlement.adjustment_amount_cents]),
        csvRow(['total_cents', settlement.total_amount_cents]),
    ];
    const fileMonth = settlement.period_month || 'period';
    return new Response(`\uFEFF${rows.join('\r\n')}\r\n`, {
        status: 200,
        headers: {
            'Cache-Control': 'private, no-store',
            'Content-Disposition': `attachment; filename="teacher-settlement-${fileMonth}.csv"`,
            'Content-Type': 'text/csv; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
        },
    });
};
