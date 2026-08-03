import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdminCapability } from '../../../lib/admin-access';
import { createSupabaseAdminClient } from '../../../lib/supabase-admin';

export const config = {
    runtime: 'nodejs',
};

const querySchema = z.object({
    before: z.string().datetime({ offset: true }).optional(),
    beforeId: z.string().uuid().optional(),
    entityType: z.string().trim().regex(/^[a-z0-9_.:-]{1,80}$/).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
}).refine(
    ({ before, beforeId }) => Boolean(before) === Boolean(beforeId),
    { message: 'Audit cursor requires timestamp and id' },
);

function jsonResponse(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export const GET: APIRoute = async (context) => {
    const auth = await requireAdminCapability(context, 'access.read');
    if (auth.error) return auth.error;

    const url = new URL(context.request.url);
    const parsed = querySchema.safeParse({
        before: url.searchParams.get('before') || undefined,
        beforeId: url.searchParams.get('beforeId') || undefined,
        entityType: url.searchParams.get('entityType') || undefined,
        limit: url.searchParams.get('limit') || undefined,
    });
    if (!parsed.success) {
        return jsonResponse({ error: 'Invalid audit query' }, 400);
    }

    const supabaseAdmin = createSupabaseAdminClient();
    let query = supabaseAdmin
        .from('admin_audit_log')
        .select('id, admin_id, action, entity_type, entity_id, created_at, before, after')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(parsed.data.limit);

    if (parsed.data.before && parsed.data.beforeId) {
        query = query.or([
            `created_at.lt.${parsed.data.before}`,
            `and(created_at.eq.${parsed.data.before},id.lt.${parsed.data.beforeId})`,
        ].join(','));
    }
    if (parsed.data.entityType) query = query.eq('entity_type', parsed.data.entityType);

    const { data: rows, error } = await query;
    if (error) return jsonResponse({ error: 'Could not load audit history' }, 500);

    const actorIds = [...new Set((rows ?? []).flatMap((row) => row.admin_id ? [row.admin_id] : []))];
    const actorNames = new Map<string, string>();
    if (actorIds.length > 0) {
        const { data: actors, error: actorsError } = await supabaseAdmin
            .from('profiles')
            .select('id, full_name, email')
            .in('id', actorIds);
        if (actorsError) return jsonResponse({ error: 'Could not resolve audit actors' }, 500);
        for (const actor of actors ?? []) {
            actorNames.set(actor.id, actor.full_name || actor.email);
        }
    }

    const lastRow = rows?.length === parsed.data.limit ? rows.at(-1) : null;

    return jsonResponse({
        events: (rows ?? []).map((row) => ({
            id: row.id,
            actorId: row.admin_id,
            actorLabel: row.admin_id ? actorNames.get(row.admin_id) ?? 'Administrador eliminado' : 'Administrador eliminado',
            action: row.action,
            entityType: row.entity_type,
            entityId: row.entity_id,
            createdAt: row.created_at,
            hasBefore: row.before !== null,
            hasAfter: row.after !== null,
        })),
        nextCursor: lastRow?.created_at
            ? { createdAt: lastRow.created_at, id: lastRow.id }
            : null,
    });
};
