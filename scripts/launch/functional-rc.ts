import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type GroupStatus = 'ok' | 'failed';

interface FunctionalGroup {
    id: string;
    title: string;
    purpose: string;
    tests: string[];
}

interface GroupResult extends FunctionalGroup {
    status: GroupStatus;
    exitCode: number | null;
    logPath: string;
    missingTests: string[];
}

interface FunctionalRcContract {
    scope: string[];
    commercialIntakeContract: string[];
    postPaymentActivationContract: string[];
    excludedExternalDependencies: string[];
    finalOnlyExclusions: string[];
    evidenceRules: string[];
}

interface FunctionalRcReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: 'OK' | 'FAILED';
    outputDir: string;
    contract: FunctionalRcContract;
    groups: GroupResult[];
}

const groups: FunctionalGroup[] = [
    {
        id: 'commercial_intake_crm',
        title: 'Commercial Intake And CRM',
        purpose: 'Solicitud de plaza, tareas SLA, lead admin, CRM sync, opportunity/task surfaces and dashboard pulse.',
        tests: [
            'tests/api/subscribe.test.ts',
            'tests/api/admin-leads.test.ts',
            'tests/unit/crm-lead-capture.test.ts',
            'tests/unit/lead-manager-source.test.ts',
            'tests/unit/crm-activity-sync.test.ts',
            'tests/unit/crm-admin-dashboard.test.ts',
            'tests/unit/crm-task-list.test.tsx',
            'tests/unit/crm-opportunity-list.test.tsx',
        ],
    },
    {
        id: 'transactional_emails',
        title: 'Transactional Emails',
        purpose: 'Email templates, admin test-send safety and CRM email activity semantics.',
        tests: [
            'tests/unit/email-templates.test.ts',
            'tests/api/email-send-test.test.ts',
            'tests/unit/crm-class-email.test.ts',
        ],
    },
    {
        id: 'level_check',
        title: 'Lightweight Level Check',
        purpose: 'Formulario diagnostico, temporary raw context, CRM-safe summary, review work and retention boundaries.',
        tests: [
            'tests/api/level-check.test.ts',
            'tests/unit/crm-level-check.test.ts',
        ],
    },
    {
        id: 'post_payment_onboarding',
        title: 'Post-Payment Onboarding Without Live Payments',
        purpose: 'Welcome fulfillment, first-class tasks, materials-before-class, job recovery and internal Worker client boundaries.',
        tests: [
            'tests/unit/crm-onboarding.test.ts',
            'tests/unit/student-onboarding-source.test.ts',
            'tests/unit/session-fulfillment.test.ts',
            'tests/unit/fulfillment-jobs.test.ts',
            'tests/unit/internal-job-service.test.ts',
            'tests/api/admin-fulfillment-jobs.test.ts',
        ],
    },
    {
        id: 'scheduling_availability',
        title: 'Scheduling, Availability And Class Duration',
        purpose: 'Manual scheduling consistency, teacher availability, Madrid time, supported class durations and join-window behavior for 50-minute classes.',
        tests: [
            'tests/unit/runtime-helpers.test.ts',
            'tests/unit/calendar-availability.test.ts',
            'tests/unit/madrid-time.test.ts',
            'tests/api/available-slots.test.ts',
            'tests/api/teacher-availability.test.ts',
            'tests/api/sessions-create.test.ts',
            'tests/api/recurring-sessions.test.ts',
            'tests/api/bulk-sessions.test.ts',
            'tests/api/session-action.test.ts',
            'tests/unit/StudentClassList.test.tsx',
            'tests/unit/TeacherCalendar.test.tsx',
        ],
    },
    {
        id: 'no_real_payments_safety',
        title: 'No-Real-Payments Safety',
        purpose: 'Checkout fails closed unless explicitly enabled, and payment recovery UI remains admin/manual.',
        tests: [
            'tests/api/create-checkout.test.ts',
            'tests/unit/payment-recovery-actions.test.tsx',
            'tests/unit/subscription-renewal-actions.test.tsx',
        ],
    },
    {
        id: 'support_and_recovery',
        title: 'Support And Recovery',
        purpose: 'Support tickets, support alert fallback, admin support surfaces and quick actions.',
        tests: [
            'tests/api/admin-support-tickets.test.ts',
            'tests/api/support-alert.test.ts',
            'tests/unit/support-page-accessibility.test.ts',
            'tests/unit/support-ticket-quick-actions.test.tsx',
        ],
    },
];

const functionalRcContract: FunctionalRcContract = {
    scope: [
        'commercial intake',
        'CRM synchronization',
        'transactional emails',
        'lightweight level check',
        'post-payment onboarding logic without live payments',
        'scheduling, availability and class duration',
        'no-real-payments checkout safety',
        'support and recovery',
    ],
    commercialIntakeContract: [
        'Application creates or updates a CRM contact, opportunity, consent, timeline activity and review task.',
        'Initial review task has a 24h first-human-response SLA.',
        'Initial review task stays in a shared founder queue until one admin claims it manually.',
        'CRM opportunity stage is the source for proposal, nurture, lost and won decisions.',
        'Manual sales emails are traced in CRM and separated from marketing consent.',
    ],
    postPaymentActivationContract: [
        'Welcome email accepted by Resend or an equivalent mocked sender.',
        'Student can open campus and see a clear next action before the first class.',
        'Materials folder is created or reused before the first class.',
        'First class is coordinated manually against real availability, not auto-booked blindly.',
        'CRM keeps a shared 24h owner task until the first class is scheduled or rescheduled.',
        'First class completion closes onboarding activation in the CRM timeline.',
        'Supported class durations remain 30, 40 and 50 minutes; Google Meet is not cut automatically at the minute mark.',
    ],
    excludedExternalDependencies: [
        'Stripe live',
        'Resend live',
        'Google APIs',
        'Supabase hosted projects',
        'Cloudflare services',
    ],
    finalOnlyExclusions: [
        'Hosted Supabase schema parity and migrations.',
        'External operations evidence: Cloudflare Workers Logs/observability, Resend staging and Admin Jobs staging UI/runtime; cron config/deployment/secret-name evidence is covered by staging preflight.',
        'Real legal text, Stripe live, premium Russian font, production secrets/services, domain/Search Console and production smoke.',
    ],
    evidenceRules: [
        'Use this command as local mocked functional RC evidence only.',
        'Do not use this command to close external service evidence.',
        'Do not use this command to close final-only legal, live payment, production secret, production service, SEO/domain or production smoke evidence.',
    ],
};

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-functional-rc', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const results = groups.map(runGroup);
const failed = results.filter((result) => result.status === 'failed');
const status = failed.length > 0 ? 'FAILED' : 'OK';

const report: FunctionalRcReport = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status,
    outputDir,
    contract: functionalRcContract,
    groups: results,
};

writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(path.join(outputDir, 'summary.md'), renderSummary(report), 'utf8');

console.log(`[launch:functional-rc] Status: ${status}`);
console.log(`[launch:functional-rc] Failed groups: ${failed.length}`);
console.log(`[launch:functional-rc] Summary: ${path.join(outputDir, 'summary.md')}`);

if (failed.length > 0) process.exit(1);

function runGroup(group: FunctionalGroup): GroupResult {
    const missingTests = group.tests.filter((testFile) => !existsSync(testFile));
    const logPath = path.join(outputDir, `${group.id}.log`);

    if (missingTests.length > 0) {
        writeFileSync(logPath, [
            `Missing tests for ${group.id}:`,
            ...missingTests,
            '',
        ].join('\n'), 'utf8');

        return {
            ...group,
            status: 'failed',
            exitCode: null,
            logPath,
            missingTests,
        };
    }

    const args = [
        'pnpm',
        'exec',
        'vitest',
        'run',
        '--coverage=false',
        '--reporter=dot',
        ...group.tests,
    ];

    const result = spawnSync(corepackCommand(), args, {
        cwd: process.cwd(),
        encoding: 'utf8',
        shell: process.platform === 'win32',
        maxBuffer: 20 * 1024 * 1024,
    });

    writeFileSync(logPath, [
        `$ ${corepackCommand()} ${args.join(' ')}`,
        `exitCode=${result.status ?? 'null'}`,
        '',
        result.stdout ?? '',
        result.stderr ?? '',
        result.error ? `\nerror=${result.error.message}` : '',
    ].join('\n'), 'utf8');

    return {
        ...group,
        status: result.status === 0 ? 'ok' : 'failed',
        exitCode: result.status,
        logPath,
        missingTests,
    };
}

function renderSummary(report: FunctionalRcReport): string {
    const lines = [
        '# Functional RC Verification',
        '',
        `- Status: ${report.status}`,
        `- Started: ${report.startedAt}`,
        `- Ended: ${report.endedAt}`,
        `- Output: ${report.outputDir}`,
        '',
        '## Scope',
        '',
        'This command verifies the no-real-payments functional RC using local mocked tests. It does not contact Stripe live, Resend live, Google, Supabase hosted projects or Cloudflare services.',
        '',
        'It covers the operational product path that should be ready before final-only work: commercial intake, CRM, transactional emails, lightweight level check, post-payment onboarding logic, scheduling and availability, no-real-payments checkout safety and support recovery.',
        '',
        'The same contract is written to `summary.json` under `contract` so release evidence can be audited without parsing Markdown prose.',
        '',
        '## Commercial Intake Contract',
        '',
        ...report.contract.commercialIntakeContract.map((item) => `- ${item}`),
        '',
        '## Post-Payment Activation Contract',
        '',
        ...report.contract.postPaymentActivationContract.map((item) => `- ${item}`),
        '',
        '## Groups',
        '',
        '| Status | Group | Purpose | Tests | Log |',
        '| --- | --- | --- | ---: | --- |',
    ];

    for (const group of report.groups) {
        lines.push(`| ${group.status} | ${group.title} | ${escapeCell(group.purpose)} | ${group.tests.length} | ${toPosix(path.relative(process.cwd(), group.logPath))} |`);
        if (group.missingTests.length > 0) {
            lines.push(`|  |  | Missing tests: ${escapeCell(group.missingTests.join(', '))} |  |  |`);
        }
    }

    lines.push('');
    lines.push('## Still Not Proven By This Command');
    lines.push('');
    lines.push(...report.contract.finalOnlyExclusions.map((item) => `- ${item}`));
    lines.push('');
    lines.push('## Evidence Rules');
    lines.push('');
    lines.push(...report.contract.evidenceRules.map((item) => `- ${item}`));
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function corepackCommand(): string {
    return process.platform === 'win32' ? 'corepack.cmd' : 'corepack';
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}

function toPosix(filePath: string): string {
    return filePath.split(path.sep).join('/');
}

function escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
