import type { SupabaseClient } from '@supabase/supabase-js';
import { recordCrmActivityForProfileSafe } from './activity-sync';
import type { Database, Json } from '../../types/database.types';

type AdminSupabaseClient = SupabaseClient<Database>;

export type ClassEmailTemplate =
    | 'class_confirmation'
    | 'class_reminder'
    | 'class_cancelled';

export interface ClassEmailOutInput {
    template: ClassEmailTemplate;
    sessionId: string;
    studentId: string;
    studentEmail?: string | null;
    studentName?: string | null;
    teacherId?: string | null;
    teacherEmail?: string | null;
    teacherName?: string | null;
    subscriptionId?: string | null;
    scheduledAt?: string | null;
    durationMinutes?: number | null;
    dateLabel?: string | null;
    timeLabel?: string | null;
    meetLink?: string | null;
    documentLink?: string | null;
    source?: string | null;
    extraMetadata?: Record<string, unknown>;
}

const templateSubjects: Record<ClassEmailTemplate, string> = {
    class_confirmation: 'Class confirmation email sent',
    class_reminder: 'Class reminder email sent',
    class_cancelled: 'Class cancellation email sent',
};

function relatedEntityType(template: ClassEmailTemplate) {
    return `session_${template}_email`;
}

export async function recordClassEmailOutInCrmSafe(
    supabaseAdmin: AdminSupabaseClient,
    input: ClassEmailOutInput
) {
    const metadata: Json = {
        automated: true,
        purpose: 'transactional',
        template: input.template,
        session_id: input.sessionId,
        subscription_id: input.subscriptionId ?? null,
        scheduled_at: input.scheduledAt ?? null,
        duration_minutes: input.durationMinutes ?? null,
        date_label: input.dateLabel ?? null,
        time_label: input.timeLabel ?? null,
        meet_link_ready: Boolean(input.meetLink),
        document_link_ready: Boolean(input.documentLink),
        recipients: {
            student: {
                id: input.studentId,
                email: input.studentEmail ?? null,
            },
            teacher: {
                id: input.teacherId ?? null,
                email: input.teacherEmail ?? null,
                name: input.teacherName ?? null,
            },
        },
        ...(input.extraMetadata ?? {}),
    };

    return recordCrmActivityForProfileSafe(supabaseAdmin, {
        profileId: input.studentId,
        email: input.studentEmail,
        fullName: input.studentName,
        lifecycleStage: 'customer',
        source: input.source ?? 'class_email',
        sourcePath: '/campus',
        activityType: 'email_out',
        subject: templateSubjects[input.template],
        body: input.template,
        relatedEntityType: relatedEntityType(input.template),
        relatedEntityId: input.sessionId,
        metadata,
    });
}
