import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type Status = 'ok' | 'warning' | 'failed';

interface Finding {
    status: Status;
    area: string;
    message: string;
    details?: string[];
}

interface SecurityReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: 'OK' | 'WARNING' | 'FAILED';
    findings: Finding[];
    outputDir: string;
    securityExternalWorksheetPath: string;
}

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-security', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const findings: Finding[] = [
    reviewRlsSchema(),
    reviewSecurityDefinerFunctions(),
    reviewAdminEndpoints(),
    reviewCronAndInternalEndpoints(),
    reviewStripePaymentSecurity(),
    reviewTurnstileLeadSecurity(),
    reviewRuntimeSecretAccess(),
    reviewServiceRoleBoundary(),
    reviewSecurityRegressionTests(),
];

const failed = findings.filter((finding) => finding.status === 'failed');
const warnings = findings.filter((finding) => finding.status === 'warning');
const status = failed.length > 0 ? 'FAILED' : warnings.length > 0 ? 'WARNING' : 'OK';
const securityExternalWorksheetPath = path.join(outputDir, 'security-external-worksheet.md');

const report: SecurityReport = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status,
    findings,
    outputDir,
    securityExternalWorksheetPath,
};

writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(path.join(outputDir, 'summary.md'), renderMarkdown(report), 'utf8');
writeFileSync(securityExternalWorksheetPath, renderSecurityExternalWorksheet(report), 'utf8');

console.log(`[launch:security] Status: ${status}`);
console.log(`[launch:security] Failed: ${failed.length}`);
console.log(`[launch:security] Warnings: ${warnings.length}`);
console.log(`[launch:security] Summary: ${path.join(outputDir, 'summary.md')}`);
console.log(`[launch:security] Security worksheet: ${securityExternalWorksheetPath}`);

if (failed.length > 0) process.exit(1);

function reviewRlsSchema(): Finding {
    const schema = readIfExists(path.join('db', 'schema.sql'));
    const requiredRlsTables = [
        'profiles',
        'profiles_private',
        'packages',
        'subscriptions',
        'student_teachers',
        'sessions',
        'payments',
        'processed_webhook_events',
        'fulfillment_jobs',
        'admin_audit_log',
        'leads',
        'teacher_availability',
    ];

    const details: string[] = [];
    for (const table of requiredRlsTables) {
        if (!hasRegex(schema, String.raw`ALTER\s+TABLE\s+${table}\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY`)) {
            details.push(`db/schema.sql missing RLS enablement for ${table}.`);
        }
    }

    const requiredPolicies: Array<[string, RegExp]> = [
        ['profiles_private admin-only management', /ON\s+profiles_private\s+FOR\s+ALL\s+TO\s+authenticated\s+USING\s*\(\s*\(select\s+private\.is_admin\(\)\)\s*\)\s+WITH\s+CHECK\s*\(\s*\(select\s+private\.is_admin\(\)\)\s*\)/i],
        ['processed_webhook_events admin-only select', /ON\s+processed_webhook_events\s+FOR\s+SELECT\s+TO\s+authenticated\s+USING\s*\(\s*\(select\s+private\.is_admin\(\)\)\s*\)/i],
        ['fulfillment_jobs admin-only management', /ON\s+fulfillment_jobs\s+FOR\s+ALL\s+TO\s+authenticated\s+USING\s*\(\s*\(select\s+private\.is_admin\(\)\)\s*\)\s+WITH\s+CHECK\s*\(\s*\(select\s+private\.is_admin\(\)\)\s*\)/i],
        ['admin_audit_log admin-only select', /ON\s+admin_audit_log\s+FOR\s+SELECT\s+TO\s+authenticated\s+USING\s*\(\s*\(select\s+private\.is_admin\(\)\)\s*\)/i],
        ['payments student own select', /ON\s+payments\s+FOR\s+SELECT\s+USING\s*\(\s*student_id\s*=\s*auth\.uid\(\)\s*\)/i],
        ['sessions student own select', /ON\s+sessions\s+FOR\s+SELECT\s+USING\s*\(\s*student_id\s*=\s*auth\.uid\(\)\s*\)/i],
        ['student_teachers assignment visibility', /ON\s+student_teachers\s+FOR\s+SELECT\s+USING\s*\(\s*(student_id|teacher_id)\s*=\s*auth\.uid\(\)\s*\)/i],
    ];

    for (const [label, pattern] of requiredPolicies) {
        if (!pattern.test(schema)) {
            details.push(`db/schema.sql missing expected policy: ${label}.`);
        }
    }

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'Supabase RLS schema',
        message: details.length === 0
            ? 'Critical launch tables have RLS enabled and expected owner/admin policies in db/schema.sql.'
            : 'Critical RLS enablement or policies are missing from db/schema.sql.',
        details,
    };
}

function reviewSecurityDefinerFunctions(): Finding {
    const schemaPath = path.join('db', 'schema.sql');
    const schema = stripSqlComments(readIfExists(schemaPath));
    const details: string[] = [];

    const chunks = schema.split(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/i).slice(1);
    for (const [index, chunk] of chunks.entries()) {
        if (!/SECURITY\s+DEFINER/i.test(chunk)) continue;
        if (!/SET\s+search_path\s*=/i.test(chunk)) {
            details.push(`${schemaPath}: SECURITY DEFINER function #${index + 1} lacks SET search_path.`);
        }
    }

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'SECURITY DEFINER search_path',
        message: details.length === 0
            ? 'SECURITY DEFINER functions in the official schema set an explicit search_path.'
            : 'Some SECURITY DEFINER functions in the official schema do not set search_path explicitly.',
        details,
    };
}

function reviewAdminEndpoints(): Finding {
    const adminFiles = [
        ...filesUnder(path.join('src', 'pages', 'api', 'admin')).filter((file) => file.endsWith('.ts')),
        path.join('src', 'pages', 'api', 'email', 'send-test.ts'),
        path.join('src', 'pages', 'api', 'google', 'create-student-folder.ts'),
        path.join('src', 'pages', 'api', 'test', 'full-class-flow.ts'),
    ].filter((file) => existsSync(file));

    const details: string[] = [];
    for (const file of adminFiles) {
        const content = readIfExists(file);
        if (!content.includes('createSupabaseServerClient')) {
            details.push(`${file}: does not use server Supabase auth client.`);
        }
        if (!/role\s*!==\s*['"]admin['"]|profile\?\.role\s*!==\s*['"]admin['"]|profile\.role\s*!==\s*['"]admin['"]/.test(content)) {
            details.push(`${file}: does not contain an explicit admin role guard.`);
        }
        if (!content.includes('403')) {
            details.push(`${file}: does not return a 403 for non-admin access.`);
        }
    }

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'admin API authorization',
        message: details.length === 0
            ? 'Admin and admin-equivalent API endpoints have authenticated admin role guards.'
            : 'Some admin or admin-equivalent API endpoints lack expected authorization guards.',
        details,
    };
}

function reviewCronAndInternalEndpoints(): Finding {
    const checks: Array<[string, string[]]> = [
        [path.join('src', 'pages', 'api', 'cron', 'process-fulfillment.ts'), ['CRON_SECRET', 'Authorization', 'Bearer', '401']],
        [path.join('src', 'pages', 'api', 'cron', 'send-reminders.ts'), ['CRON_SECRET', 'Authorization', 'Bearer', '401']],
        [path.join('src', 'lib', 'internal-job-service.ts'), ['INTERNAL_JOB_SECRET', 'Authorization', 'Bearer']],
        [path.join('workers', 'fulfillment', 'src', 'index.ts'), ['INTERNAL_JOB_SECRET', 'isAuthorized', 'Bearer', '401']],
    ];

    const details = missingSnippets(checks);

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'cron and internal service authentication',
        message: details.length === 0
            ? 'Cron endpoints and the Cloudflare fulfillment Worker require bearer-token secrets.'
            : 'Cron or internal service authentication snippets are missing.',
        details,
    };
}

function reviewStripePaymentSecurity(): Finding {
    const checks: Array<[string, string[]]> = [
        [path.join('src', 'pages', 'api', 'stripe-webhook.ts'), [
            'STRIPE_WEBHOOK_SECRET',
            'stripe-signature',
            'constructEvent',
            'processed_webhook_events',
            'markWebhookEventProcessed',
            "error.code === '23505'",
            "markProcessed === 'failed'",
        ]],
        [path.join('src', 'pages', 'api', 'create-checkout.ts'), [
            'createSupabaseServerClient',
            'auth.getUser',
            'is_active',
            'stripe.prices.retrieve',
            '!stripePrice.active',
            '!stripePrice.recurring',
            'getPrivateProfile',
        ]],
        [path.join('src', 'pages', 'api', 'account', 'create-portal-session.ts'), [
            'createSupabaseServerClient',
            'auth.getUser',
            'getPrivateProfile',
            'getSiteUrl',
        ]],
    ];

    const details = missingSnippets(checks);
    const portalSource = readIfExists(path.join('src', 'pages', 'api', 'account', 'create-portal-session.ts'));
    if (/headers\.get\(['"]Origin['"]\)/i.test(portalSource)) {
        details.push('create-portal-session.ts reads Origin for return_url.');
    }

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'Stripe payment security',
        message: details.length === 0
            ? 'Stripe checkout, portal and webhook security invariants are present.'
            : 'Stripe payment security invariants are missing.',
        details,
    };
}

function reviewTurnstileLeadSecurity(): Finding {
    const details = missingSnippets([
        [path.join('src', 'pages', 'api', 'subscribe.ts'), [
            'cf-turnstile-response',
            'TURNSTILE_SECRET_KEY',
            'siteverify',
            'turnstileData.success',
            'consent',
            'escapeHtml',
        ]],
        [path.join('src', 'components', 'LeadCaptureForm.tsx'), [
            'Turnstile',
            'PUBLIC_TURNSTILE_SITE_KEY',
            'cf-turnstile-response',
            '/legal/privacidad',
        ]],
    ]);

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'lead form bot and consent controls',
        message: details.length === 0
            ? 'Lead capture requires consent, Turnstile verification and privacy-link evidence.'
            : 'Lead capture bot, consent or privacy-link controls are missing.',
        details,
    };
}

function reviewRuntimeSecretAccess(): Finding {
    const details: string[] = [];
    const runtimeEnvPath = path.join('src', 'lib', 'runtime-env.ts');
    const runtimeEnv = readIfExists(runtimeEnvPath);
    const privateKeys = [
        'CRON_SECRET',
        'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
        'INTERNAL_JOB_SECRET',
        'LEVEL_CHECK_TOKEN_SECRET',
        'RESEND_API_KEY',
        'SENTRY_AUTH_TOKEN',
        'STRIPE_SECRET_KEY',
        'STRIPE_WEBHOOK_SECRET',
        'SUPABASE_SERVICE_ROLE_KEY',
        'TURNSTILE_SECRET_KEY',
    ];

    if (!runtimeEnv.includes("from 'astro:env/server'") || !runtimeEnv.includes('getSecret(key)')) {
        details.push(`${runtimeEnvPath}: server values must use the adapter-provided astro:env/server getSecret() runtime.`);
    }
    if (runtimeEnv.includes('astro/env/runtime') || runtimeEnv.includes('import.meta.env')) {
        details.push(`${runtimeEnvPath}: deprecated/internal or build-time environment access can bake secrets into the Worker bundle.`);
    }

    const runtimeSourceFiles = [
        ...filesUnder('src'),
        ...filesUnder('workers'),
    ].filter((candidate) => /\.(ts|tsx|astro|js|jsx|cjs|mjs)$/.test(candidate));

    for (const file of runtimeSourceFiles) {
        const content = readIfExists(file);
        for (const key of privateKeys) {
            const directAccess = new RegExp(`import\\.meta\\.env\\.${key}\\b`);
            const bracketAccess = new RegExp(`import\\.meta\\.env\\[['\"]${key}['\"]\\]`);
            if (directAccess.test(content) || bracketAccess.test(content)) {
                details.push(`${file}: accesses private runtime key ${key} through import.meta.env.`);
            }
        }
    }

    if (existsSync('dist')) {
        const buildFiles = filesUnder('dist')
            .filter((candidate) => /\.(js|mjs|cjs|json|html|map)$/.test(candidate));
        const envFiles = ['.env', '.env.staging', '.dev.vars'];

        for (const key of privateKeys) {
            const values = new Set<string>();
            for (const envFile of envFiles) {
                const value = readEnvFileValue(envFile, key);
                if (value && value.length >= 12 && !/placeholder|example|changeme|test-secret/i.test(value)) {
                    values.add(value);
                    values.add(JSON.stringify(value).slice(1, -1));
                }
            }

            let leakedIn: string | null = null;
            for (const file of buildFiles) {
                const content = readIfExists(file);
                if ([...values].some((value) => value.length >= 12 && content.includes(value))) {
                    leakedIn = file;
                    break;
                }
            }
            if (leakedIn) {
                details.push(`${leakedIn}: contains the configured value for private runtime key ${key}; value intentionally omitted.`);
            }
        }
    }

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'runtime secret binding and bundle boundary',
        message: details.length === 0
            ? 'Private server values use Astro adapter runtime secrets and no configured private value is present in the current dist bundle.'
            : 'Private server values can be or are embedded in the built Worker bundle instead of runtime secret bindings.',
        details,
    };
}

function reviewServiceRoleBoundary(): Finding {
    const details: string[] = [];
    const allowedSecretFiles = new Set<string>([
        path.join('src', 'lib', 'supabase-admin.ts'),
        // Central server-side runtime env helper. It may name secrets, but
        // must not cross into component/client boundaries.
        path.join('src', 'lib', 'runtime-env.ts'),
        // Runtime attestation hashes server configuration and its internal API
        // exposes only the opaque proof. Both files are server-only boundaries;
        // the component/client scan below remains deliberately unchanged.
        path.join('src', 'lib', 'runtime-attestation.ts'),
        path.join('src', 'pages', 'api', 'internal', 'runtime-attestation.ts'),
        path.join('src', 'env.d.ts'),
    ].map(normalizePath));

    const runtimeSourceFiles = [
        ...filesUnder('src'),
        ...filesUnder('apps'),
        ...filesUnder('workers'),
    ].filter((candidate) => /\.(ts|tsx|astro|js|cjs|mjs)$/.test(candidate));

    for (const file of runtimeSourceFiles) {
        const normalized = normalizePath(file);
        const content = readIfExists(file);
        if (content.includes('SUPABASE_SERVICE_ROLE_KEY') && !allowedSecretFiles.has(normalized)) {
            details.push(`${file}: references SUPABASE_SERVICE_ROLE_KEY outside the server-only allowlist.`);
        }
    }

    const runtimeEnvImportPattern = /(?:from\s+['"][^'"]*runtime-env['"]|import\(['"][^'"]*runtime-env['"]\)|require\(['"][^'"]*runtime-env['"]\))/;
    const componentSourceFiles = filesUnder(path.join('src', 'components'))
        .filter((candidate) => /\.(ts|tsx|astro|js|jsx)$/.test(candidate));
    for (const file of componentSourceFiles) {
        const content = readIfExists(file);
        if (runtimeEnvImportPattern.test(content)) {
            details.push(`${file}: imports runtime-env from the component/client boundary.`);
        }
    }

    const supabaseAdmin = readIfExists(path.join('src', 'lib', 'supabase-admin.ts'));
    if (!supabaseAdmin.includes("requireRuntimeEnv('SUPABASE_SERVICE_ROLE_KEY')")) {
        details.push('src/lib/supabase-admin.ts does not require SUPABASE_SERVICE_ROLE_KEY through runtime env validation.');
    }

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'service role boundary',
        message: details.length === 0
            ? 'Supabase service-role secret references stay inside the server-only runtime boundary.'
            : 'Supabase service-role boundary issues were detected.',
        details,
    };
}

function reviewSecurityRegressionTests(): Finding {
    const source = readIfExists(path.join('tests', 'api', 'security-regression.test.ts'));
    const requiredSnippets = [
        'sessions GET teacherId restricted to admin',
        'available-slots student IDOR protection',
        'bulk-sessions DoS protection',
        'create-portal-session open redirect prevention',
        'Calendar availability check fail-closed',
        'Error message sanitization',
        'append-homework doc ownership',
        'No module-level supabaseAdmin',
        'Cloudflare runtime boundaries',
    ];
    const details = requiredSnippets
        .filter((snippet) => !source.includes(snippet))
        .map((snippet) => `tests/api/security-regression.test.ts missing regression: ${snippet}.`);

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'security regression coverage',
        message: details.length === 0
            ? 'Security regression tests cover known launch-critical findings.'
            : 'Some known security regression tests are missing.',
        details,
    };
}

function missingSnippets(checks: Array<[string, string[]]>): string[] {
    const details: string[] = [];
    for (const [file, snippets] of checks) {
        const content = readIfExists(file);
        for (const snippet of snippets) {
            if (!content.includes(snippet)) {
                details.push(`${file}: missing ${snippet}.`);
            }
        }
    }
    return details;
}

function readIfExists(file: string): string {
    return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

function readEnvFileValue(file: string, key: string): string | undefined {
    const line = readIfExists(file)
        .split(/\r?\n/)
        .map((candidate) => candidate.trim())
        .find((candidate) => candidate.startsWith(`${key}=`));
    if (!line) return undefined;

    let value = line.slice(key.length + 1).trim();
    if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
        value = value.slice(1, -1);
    }
    return value || undefined;
}

function filesUnder(root: string): string[] {
    if (!existsSync(root)) return [];
    const entries = readdirSync(root, { withFileTypes: true });
    return entries.flatMap((entry) => {
        const file = path.join(root, entry.name);
        if (entry.isDirectory()) return filesUnder(file);
        return file;
    });
}

function hasRegex(value: string, pattern: string): boolean {
    return new RegExp(pattern, 'i').test(value);
}

function stripSqlComments(value: string): string {
    return value
        .replace(/--.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');
}

function renderMarkdown(report: SecurityReport): string {
    const lines = [
        '# Launch Security Audit',
        '',
        `- Status: ${report.status}`,
        `- Started: ${report.startedAt}`,
        `- Ended: ${report.endedAt}`,
        `- Output: ${report.outputDir}`,
        '',
        '| Status | Area | Message |',
        '| --- | --- | --- |',
    ];

    for (const finding of report.findings) {
        lines.push(`| ${finding.status} | ${escapeCell(finding.area)} | ${escapeCell(finding.message)} |`);
        if (finding.details?.length) {
            lines.push(`|  |  | ${escapeCell(finding.details.join(' / '))} |`);
        }
    }

    lines.push('');
    lines.push('## Scope');
    lines.push('');
    lines.push('This automated audit checks launch-critical static security invariants. It does not replace a live Supabase RLS review, external penetration test, Stripe/Google/Resend staging smoke where in scope, final secret rotation, or production incident drill.');
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function renderSecurityExternalWorksheet(report: SecurityReport): string {
    const lines = [
        '# Security External Worksheet',
        '',
        `- Status: ${report.status}`,
        `- Generated: ${report.endedAt}`,
        `- Output: ${report.outputDir}`,
        '',
        '## Rule',
        '',
        'Use this worksheet while filling `security_external` in `docs/launch/MANUAL_EVIDENCE.local.json`. Do not paste API keys, private keys, webhook secrets, service role keys, recovery codes, full tokens, database URLs with passwords, bearer headers, query-string tokens or unredacted screenshots.',
        '',
        '## Automated Coverage',
        '',
        '| Status | Area | Message |',
        '| --- | --- | --- |',
    ];

    appendFindingsTable(lines, report.findings);

    lines.push('');
    lines.push('## Manual Checks');
    lines.push('');
    lines.push('| Check | How To Verify | Evidence To Record |');
    lines.push('| --- | --- | --- |');
    lines.push('| Supabase RLS | Review real staging and production policies for sensitive tables, including `profiles_private`, `payments`, `subscriptions`, `sessions`, `student_teachers`, `fulfillment_jobs` and `admin_audit_log`. | `dashboard` or `manual_note` with tables reviewed and result; no row data. |');
    lines.push('| service role | Confirm service role keys exist only in server-side environments and are not present in Cloudflare public vars, browser bundles, logs or docs. | `manual_note` or redacted `dashboard`; never paste key values. |');
    lines.push('| key rotation | Confirm final key rotation is intentionally deferred and tracked for final closure. Do not rotate now unless Alin decides the release is otherwise ready. | `manual_note` with systems tracked and final-rotation owner/timing; never values. |');
    lines.push('| third-party permissions | For RC, review visible dashboard users/tokens/deploy hooks/OAuth/service-account permissions where practical. Carry deeper cleanup to final closure if it does not affect RC safety. | `dashboard` or `manual_note`; redact user emails if needed. |');
    lines.push('| Cloudflare Turnstile/WAF | Confirm current Turnstile/WAF/log posture for the configured staging/production-domain setup. If final-domain enforcement changes later, repeat in final closure. | `dashboard`, `screenshot` redacted or `manual_note`. |');
    lines.push('| Stripe security | Confirm test/live mode separation, webhook endpoint secrets, restricted keys if used and no live payments before final approval. | `dashboard` or `manual_note`; no secrets or card data. |');
    lines.push('| logs and alerts | Check Sentry, Cloudflare, Supabase, Stripe, Resend and fulfillment Worker logs for visibility and alert routing. | `dashboard` or `manual_note` with alert owner. |');
    lines.push('| incident response | Confirm support/escalation owner, rollback path and where security incidents are tracked. | `path` to `docs/launch/RUNBOOK.md` plus `manual_note`. |');
    lines.push('');
    lines.push('## Completion');
    lines.push('');
    lines.push('Mark `security_external` as `pass` only after the RC security baseline dashboards have been reviewed. `pnpm launch:security` proves static launch-critical safeguards; it does not prove hosted RLS, dashboard permissions, WAF, logs or alert routing. Final key rotation, live-domain security review and deeper permission cleanup remain final-only unless Alin decides otherwise.');
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function appendFindingsTable(lines: string[], findings: Finding[]): void {
    for (const finding of findings) {
        lines.push(`| ${finding.status} | ${escapeCell(finding.area)} | ${escapeCell(finding.message)} |`);
        if (finding.details?.length) {
            lines.push(`|  |  | ${escapeCell(finding.details.join(' / '))} |`);
        }
    }
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}

function normalizePath(file: string): string {
    return file.replace(/\\/g, '/');
}

function escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
