import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const teacherDashboard = readFileSync(
    'src/pages/[lang]/campus/teacher/index.astro',
    'utf8',
);
const teacherStudent = readFileSync(
    'src/pages/[lang]/campus/teacher/student/[id].astro',
    'utf8',
);

describe('teacher academic progress source contract', () => {
    it('never presents the operational sessions_used counter as academic progress', () => {
        expect(teacherDashboard).not.toContain('sessions_used');
        expect(teacherStudent).not.toContain('sessions_used');
    });

    it('loads canonical Checkout V2 progress once for the complete teacher list', () => {
        expect(teacherDashboard).toContain('loadLatestCheckoutV2Progress');
        expect(teacherDashboard).toContain('checkoutV2SubscriptionIds');
        expect(teacherDashboard.match(/await loadLatestCheckoutV2Progress\(/g)).toHaveLength(1);
        expect(teacherDashboard).toContain('createSupabaseAdminClient()');
        expect(teacherDashboard).toContain('progressBySubscription.get(subscription.id)');
    });

    it('loads active subscriptions in bounded roster batches instead of one request per student', () => {
        expect(teacherDashboard).toContain('assignedStudentIdBatches');
        expect(teacherDashboard).toContain(".in('student_id', studentIds)");
        expect(teacherDashboard).toContain('Math.ceil(assignedStudentIds.length / 100)');
        expect(teacherDashboard).toContain('getPrivateProfiles(studentIds, supabaseAdmin)');
        expect(teacherDashboard).toContain('privateProfilesFailed');
        expect(teacherDashboard).toContain('activeSubscriptionByStudent');
        expect(teacherDashboard).toContain('subscriptionBatchFailed');
        expect(teacherDashboard).not.toContain('(students || []).map(async');
    });

    it('uses only ready canonical totals and keeps pending and legacy states explicit', () => {
        for (const source of [teacherDashboard, teacherStudent]) {
            expect(source).toContain('resolveCheckoutV2AcademicProgress');
            expect(source).toContain("progress.status === 'ready'");
            expect(source).toContain("progress.status === 'pending'");
            expect(source).toContain("progress.status === 'legacy'");
            expect(source).toContain("t('campus.dashboard.progressPending')");
            expect(source).toContain("t('campus.dashboard.progressUnavailable')");
        }
    });

    it('fails closed and reports sanitized diagnostics for missing, inconsistent or failed progress', () => {
        for (const source of [teacherDashboard, teacherStudent]) {
            expect(source).toContain('CHECKOUT_V2_PROGRESS_MISSING');
            expect(source).toContain('CHECKOUT_V2_PROGRESS_INCONSISTENT');
            expect(source).toContain('reportCampusReadError');
            expect(source).toContain('Astro.response.status = 503');
            expect(source).toContain('<CampusLoadError');
        }
        expect(teacherDashboard).toContain('completedSessionsError');
        expect(teacherDashboard).toContain("reportCampusReadError('teacher_dashboard.completed_sessions'");
        expect(teacherDashboard).toContain("completedSessionsError ? '—'");
        expect(teacherDashboard).toContain('progressBatchFailed && (');
        expect(teacherDashboard).toContain("student.progress.status === 'error' && !progressBatchFailed");
    });

    it('loads one active subscription and its canonical progress in teacher detail', () => {
        expect(teacherStudent).toContain(".eq('status', 'active')");
        expect(teacherStudent).toContain('.maybeSingle()');
        expect(teacherStudent).toContain('loadCheckoutV2ProgressForSubscription');
        expect(teacherStudent).toContain('subscription.id');
    });
});
