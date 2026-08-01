import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { getCrmAdminDashboardSummary } from '../../src/lib/crm/admin-dashboard';

const adminDashboardSource = readFileSync('src/pages/[lang]/campus/admin/index.astro', 'utf8');

function createQuery(result: { data?: unknown; error?: unknown; count?: number | null }) {
    const chain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        then: (resolve: (value: typeof result) => unknown, reject: (reason: unknown) => unknown) =>
            Promise.resolve({
                data: result.data ?? null,
                error: result.error ?? null,
                count: result.count ?? null,
            }).then(resolve, reject),
    };
    return chain;
}

function createClient(tableQueries: Record<string, any[]>) {
    const queues = new Map(Object.entries(tableQueries).map(([table, queries]) => [table, [...queries]]));

    return {
        from: vi.fn((table: string) => {
            const queue = queues.get(table);
            if (!queue || queue.length === 0) {
                throw new Error(`Unexpected table ${table}`);
            }
            return queue.shift();
        }),
    };
}

describe('getCrmAdminDashboardSummary', () => {
    it('keeps the operational pulse visible in the admin command center', () => {
        expect(adminDashboardSource).toContain('Pulso operativo');
        expect(adminDashboardSource).toContain('Leads >24h');
        expect(adminDashboardSource).toContain('Diagnosticos enviados');
        expect(adminDashboardSource).toContain('Diagnosticos recibidos');
        expect(adminDashboardSource).toContain('Propuestas');
        expect(adminDashboardSource).toContain('Pospuestos');
        expect(adminDashboardSource).toContain('Seguimientos ventas');
        expect(adminDashboardSource).toContain('Revisiones diagnostico');
        expect(adminDashboardSource).toContain('Primera clase pendiente');
        expect(adminDashboardSource).toContain('No-shows pendientes');
        expect(adminDashboardSource).toContain('crmSummary.newLeadCount');
        expect(adminDashboardSource).toContain('crmSummary.openSupportTicketCount');
        expect(adminDashboardSource).toContain('crmSummary.failedPaymentCount');
        expect(adminDashboardSource).toContain('crmSummary.todaySessionCount');
        expect(adminDashboardSource).toContain('crmSummary.commercialPulse');
    });

    it('loads CRM and operational daily queues with the expected filters', async () => {
        const priorityTask = {
            id: 'task-1',
            contact_id: 'contact-1',
            title: 'Follow up',
            task_type: 'email',
            priority: 'high',
            due_at: '2026-06-24T08:00:00.000Z',
            status: 'open',
            crm_contacts: {
                id: 'contact-1',
                profile_id: 'student-1',
                full_name: 'Ana Alumna',
                primary_email: 'ana@example.com',
            },
        };
        const lead = {
            id: 'lead-1',
            name: 'Lead One',
            email: 'lead@example.com',
            interest: 'general',
            current_level: 'b1',
            availability: 'Mornings',
            status: 'new',
            created_at: '2026-06-24T08:00:00.000Z',
            crm_contact_id: null,
            crm_opportunity_id: null,
        };
        const ticket = {
            id: 'ticket-1',
            issue_title: 'No Meet link',
            issue_type: 'calendar',
            status: 'open',
            created_at: '2026-06-24T08:00:00.000Z',
            user_id: 'student-1',
            user: { id: 'student-1', full_name: 'Ana Alumna', email: 'ana@example.com', role: 'student' },
        };
        const failedPayment = {
            id: 'payment-1',
            amount: 9900,
            currency: 'eur',
            status: 'failed',
            created_at: '2026-06-24T08:00:00.000Z',
            student_id: 'student-1',
            profiles: { id: 'student-1', full_name: 'Ana Alumna', email: 'ana@example.com' },
        };
        const endingSubscription = {
            id: 'sub-1',
            student_id: 'student-1',
            ends_at: '2026-06-30T00:00:00.000Z',
            status: 'active',
            profiles: { id: 'student-1', full_name: 'Ana Alumna', email: 'ana@example.com' },
            packages: { name: 'starter', display_name: { es: 'Inicial' }, price_monthly: 4900 },
        };
        const todaySession = {
            id: 'session-1',
            scheduled_at: '2026-06-24T10:00:00.000Z',
            status: 'scheduled',
            duration_minutes: 50,
            student_id: 'student-1',
            teacher_id: 'teacher-1',
            student: { id: 'student-1', full_name: 'Ana Alumna', email: 'ana@example.com' },
            teacher: { id: 'teacher-1', full_name: 'Teacher One', email: 'teacher@example.com' },
        };

        const dueTasks = createQuery({ count: 2 });
        const todayTasks = createQuery({ count: 3 });
        const salesFollowUpPending = createQuery({ count: 2 });
        const levelCheckReviewPending = createQuery({ count: 1 });
        const firstClassPending = createQuery({ count: 1 });
        const noShowFollowUpPending = createQuery({ count: 2 });
        const staleNewLeads = createQuery({ count: 1 });
        const levelChecksSent = createQuery({ count: 2 });
        const levelChecksReceived = createQuery({ count: 1 });
        const newLeads = createQuery({ data: [lead], count: 7 });
        const openSupportTickets = createQuery({ data: [ticket], count: 4 });
        const failedPayments = createQuery({ data: [failedPayment], count: 3 });
        const endingSubscriptions = createQuery({ data: [endingSubscription] });
        const todaySessions = createQuery({ data: [todaySession], count: 6 });
        const client = createClient({
            crm_opportunities: [
                createQuery({ count: 1 }),
                createQuery({ count: 4 }),
                createQuery({ count: 2 }),
                createQuery({ count: 1 }),
                createQuery({ data: [] }),
            ],
            crm_tasks: [
                dueTasks,
                todayTasks,
                salesFollowUpPending,
                levelCheckReviewPending,
                firstClassPending,
                noShowFollowUpPending,
                createQuery({ data: [priorityTask] }),
            ],
            crm_activities: [
                createQuery({ data: [] }),
            ],
            leads: [
                newLeads,
                staleNewLeads,
                levelChecksSent,
                levelChecksReceived,
            ],
            support_tickets: [
                openSupportTickets,
            ],
            payments: [
                failedPayments,
            ],
            subscriptions: [
                endingSubscriptions,
            ],
            sessions: [
                todaySessions,
            ],
        });

        const summary = await getCrmAdminDashboardSummary(client as any);

        expect(summary.isReady).toBe(true);
        expect(summary.newOpportunities).toBe(1);
        expect(summary.openOpportunities).toBe(4);
        expect(summary.dueTasks).toBe(2);
        expect(summary.todayTasks).toBe(3);
        expect(summary.newLeadCount).toBe(7);
        expect(summary.openSupportTicketCount).toBe(4);
        expect(summary.failedPaymentCount).toBe(3);
        expect(summary.todaySessionCount).toBe(6);
        expect(summary.commercialPulse).toEqual({
            staleNewLeads: 1,
            levelChecksSent: 2,
            levelChecksReceived: 1,
            proposalOpportunities: 2,
            postponedOpportunities: 1,
            salesFollowUpPending: 2,
            levelCheckReviewPending: 1,
            firstClassPending: 1,
            noShowFollowUpPending: 2,
        });
        expect(summary.priorityTasks).toEqual([priorityTask]);
        expect(summary.newLeads).toEqual([lead]);
        expect(summary.openSupportTickets).toEqual([ticket]);
        expect(summary.failedPayments).toEqual([failedPayment]);
        expect(summary.endingSubscriptions).toEqual([endingSubscription]);
        expect(summary.todaySessions).toEqual([todaySession]);
        expect(summary.urgentQueueCount).toBe(16);
        expect(summary.retentionRiskSummary).toEqual({
            atRiskContacts: 1,
            highRiskContacts: 1,
            revenueAtRiskCents: 14800,
        });
        expect(summary.retentionRisks).toHaveLength(1);
        expect(summary.retentionRisks[0]).toEqual(expect.objectContaining({
            studentId: 'student-1',
            profile: failedPayment.profiles,
            level: 'urgent',
            revenueAtRiskCents: 14800,
            failedPaymentCount: 1,
            openSupportTicketCount: 1,
            endingSubscriptionCount: 1,
            nearestSubscriptionEndsAt: endingSubscription.ends_at,
        }));
        expect(summary.retentionRisks[0].reasons).toEqual(expect.arrayContaining([
            'Pago fallido',
            'Soporte abierto',
        ]));

        expect(dueTasks.lte).toHaveBeenCalledWith('due_at', expect.any(String));
        expect(todayTasks.lt).toHaveBeenCalledWith('due_at', expect.any(String));
        expect(salesFollowUpPending.in).toHaveBeenCalledWith('status', ['open', 'snoozed']);
        expect(salesFollowUpPending.eq).toHaveBeenCalledWith('related_entity_type', 'lead_sales_follow_up');
        expect(levelCheckReviewPending.in).toHaveBeenCalledWith('status', ['open', 'snoozed']);
        expect(levelCheckReviewPending.eq).toHaveBeenCalledWith('related_entity_type', 'level_check');
        expect(firstClassPending.in).toHaveBeenCalledWith('status', ['open', 'snoozed']);
        expect(firstClassPending.in).toHaveBeenCalledWith('related_entity_type', ['subscription_onboarding', 'profile_onboarding']);
        expect(noShowFollowUpPending.in).toHaveBeenCalledWith('status', ['open', 'snoozed']);
        expect(noShowFollowUpPending.eq).toHaveBeenCalledWith('related_entity_type', 'session_no_show');
        expect(staleNewLeads.eq).toHaveBeenCalledWith('status', 'new');
        expect(staleNewLeads.lte).toHaveBeenCalledWith('created_at', expect.any(String));
        expect(newLeads.select).toHaveBeenCalledWith(expect.any(String), { count: 'exact' });
        expect(levelChecksSent.eq).toHaveBeenCalledWith('level_check_status', 'sent');
        expect(levelChecksReceived.eq).toHaveBeenCalledWith('level_check_status', 'received');
        expect(openSupportTickets.select).toHaveBeenCalledWith(expect.any(String), { count: 'exact' });
        expect(openSupportTickets.in).toHaveBeenCalledWith('status', ['open', 'triaged']);
        expect(failedPayments.select).toHaveBeenCalledWith(expect.any(String), { count: 'exact' });
        expect(failedPayments.eq).toHaveBeenCalledWith('status', 'failed');
        expect(endingSubscriptions.eq).toHaveBeenCalledWith('status', 'active');
        expect(endingSubscriptions.gte).toHaveBeenCalledWith('ends_at', expect.any(String));
        expect(endingSubscriptions.lte).toHaveBeenCalledWith('ends_at', expect.any(String));
        expect(todaySessions.select).toHaveBeenCalledWith(expect.any(String), { count: 'exact' });
        expect(todaySessions.eq).toHaveBeenCalledWith('status', 'scheduled');
        expect(todaySessions.gte).toHaveBeenCalledWith('scheduled_at', expect.any(String));
        expect(todaySessions.lt).toHaveBeenCalledWith('scheduled_at', expect.any(String));
    });

    it('keeps operational queues available when CRM tables are not migrated yet', async () => {
        const missingCrm = { code: '42P01', message: 'relation "crm_tasks" does not exist' };
        const lead = {
            id: 'lead-1',
            name: 'Lead One',
            email: 'lead@example.com',
            interest: null,
            current_level: null,
            availability: null,
            status: 'new',
            created_at: '2026-06-24T08:00:00.000Z',
            crm_contact_id: null,
            crm_opportunity_id: null,
        };
        const client = createClient({
            crm_opportunities: [
                createQuery({ error: missingCrm }),
                createQuery({ error: missingCrm }),
                createQuery({ error: missingCrm }),
                createQuery({ error: missingCrm }),
                createQuery({ error: missingCrm }),
                createQuery({ error: missingCrm }),
            ],
            crm_tasks: [
                createQuery({ error: missingCrm }),
                createQuery({ error: missingCrm }),
                createQuery({ error: missingCrm }),
                createQuery({ error: missingCrm }),
                createQuery({ error: missingCrm }),
                createQuery({ error: missingCrm }),
                createQuery({ error: missingCrm }),
            ],
            crm_activities: [
                createQuery({ error: missingCrm }),
            ],
            leads: [
                createQuery({ data: [lead] }),
                createQuery({ count: 1 }),
                createQuery({ count: 2 }),
                createQuery({ count: 1 }),
            ],
            support_tickets: [
                createQuery({ data: [] }),
            ],
            payments: [
                createQuery({ data: [] }),
            ],
            subscriptions: [
                createQuery({ data: [] }),
            ],
            sessions: [
                createQuery({ data: [] }),
            ],
        });

        const summary = await getCrmAdminDashboardSummary(client as any);

        expect(summary.isReady).toBe(false);
        expect(summary.priorityTasks).toEqual([]);
        expect(summary.newestOpportunities).toEqual([]);
        expect(summary.recentActivities).toEqual([]);
        expect(summary.newLeads).toEqual([lead]);
        expect(summary.commercialPulse).toEqual({
            staleNewLeads: 1,
            levelChecksSent: 2,
            levelChecksReceived: 1,
            proposalOpportunities: 0,
            postponedOpportunities: 0,
            salesFollowUpPending: 0,
            levelCheckReviewPending: 0,
            firstClassPending: 0,
            noShowFollowUpPending: 0,
        });
        expect(summary.urgentQueueCount).toBe(1);
        expect(summary.retentionRiskSummary).toEqual({
            atRiskContacts: 0,
            highRiskContacts: 0,
            revenueAtRiskCents: 0,
        });
        expect(summary.retentionRisks).toEqual([]);
    });
});
