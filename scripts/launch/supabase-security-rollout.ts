import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type CheckStatus = 'ok' | 'warning' | 'failed';

interface RolloutCheck {
    status: CheckStatus;
    name: string;
    message: string;
    details: string[];
}

interface MigrationArtifact {
    order: number;
    file: string;
    sha256: string;
    bytes: number;
    why: string;
}

interface TargetProject {
    environment: 'staging' | 'production';
    name: string;
    ref: string;
    region: string;
}

interface SecurityRolloutReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: 'OK' | 'WARNING' | 'FAILED';
    outputDir: string;
    targetProjects: TargetProject[];
    migrations: MigrationArtifact[];
    checks: RolloutCheck[];
    bundlePath: string;
    manifestPath: string;
    approvalRequestPath: string;
    postApplyVerificationSqlPath: string;
    rollbackSqlPath: string;
    manualEvidenceDryRunPath: string;
}

const targetProjects: TargetProject[] = [
    {
        environment: 'staging',
        name: 'espanol-staging',
        ref: 'mzjyvmlxfpzdfdjzxxyj',
        region: 'eu-central-1',
    },
    {
        environment: 'production',
        name: 'espanol-honesto',
        ref: 'vkkahxsybhbutszerawz',
        region: 'eu-west-1',
    },
];

const migrationPlan = [
    {
        file: 'supabase/migrations/021_harden_session_write_policies.sql',
        why: 'Closes direct student/teacher Data API session write policies so scheduling and cancellation writes pass through server-side business rules.',
    },
    {
        file: 'supabase/migrations/022_track_stripe_webhook_processing_state.sql',
        why: 'Adds webhook processing state needed by the local Stripe idempotency hardening before deploying that code against live databases.',
    },
    {
        file: 'supabase/migrations/20260702124757_harden_profile_role_trigger.sql',
        why: 'Creates the private profile role/email trigger helper, removes the legacy public helper and blocks direct role/email profile mutation.',
    },
];

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-supabase-security-rollout', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const checks: RolloutCheck[] = [];
const migrations = collectMigrations(checks);
const bundlePath = path.join(outputDir, 'supabase-security-migration-bundle.sql');
const manifestPath = path.join(outputDir, 'supabase-security-rollout-manifest.json');
const approvalRequestPath = path.join(outputDir, 'approval-request.md');
const postApplyVerificationSqlPath = path.join(outputDir, 'post-apply-verification.sql');
const rollbackSqlPath = path.join(outputDir, 'rollback.sql');
const manualEvidenceDryRunPath = path.join(outputDir, 'manual-evidence-dry-run.txt');

checks.push(validateForbiddenScope(migrations));
checks.push(validateDeprecatedAuthPatterns(migrations));
checks.push(validateSessionPolicyMigration());
checks.push(validateWebhookProcessingMigration());
checks.push(validateProfileTriggerMigration());

const bundle = renderMigrationBundle(migrations);
const postApplyVerificationSql = renderPostApplyVerificationSql();
const rollbackSql = renderRollbackSql();

writeFileSync(bundlePath, bundle, 'utf8');
writeFileSync(postApplyVerificationSqlPath, postApplyVerificationSql, 'utf8');
writeFileSync(rollbackSqlPath, rollbackSql, 'utf8');

const failed = checks.filter((check) => check.status === 'failed');
const warnings = checks.filter((check) => check.status === 'warning');
const status = failed.length > 0 ? 'FAILED' : warnings.length > 0 ? 'WARNING' : 'OK';

const report: SecurityRolloutReport = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status,
    outputDir,
    targetProjects,
    migrations,
    checks,
    bundlePath,
    manifestPath,
    approvalRequestPath,
    postApplyVerificationSqlPath,
    rollbackSqlPath,
    manualEvidenceDryRunPath,
};

writeFileSync(manifestPath, JSON.stringify(renderManifest(report, bundle, postApplyVerificationSql, rollbackSql), null, 2), 'utf8');
writeFileSync(approvalRequestPath, renderApprovalRequest(report), 'utf8');
writeFileSync(manualEvidenceDryRunPath, renderManualEvidenceDryRun(report), 'utf8');
writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(path.join(outputDir, 'summary.md'), renderSummary(report), 'utf8');

console.log(`[launch:supabase-security-rollout] Status: ${status}`);
console.log(`[launch:supabase-security-rollout] Failed: ${failed.length}`);
console.log(`[launch:supabase-security-rollout] Warnings: ${warnings.length}`);
console.log(`[launch:supabase-security-rollout] Summary: ${path.join(outputDir, 'summary.md')}`);
console.log(`[launch:supabase-security-rollout] Bundle: ${bundlePath}`);
console.log(`[launch:supabase-security-rollout] Manifest: ${manifestPath}`);
console.log(`[launch:supabase-security-rollout] Approval request: ${approvalRequestPath}`);
console.log(`[launch:supabase-security-rollout] Post-apply verification SQL: ${postApplyVerificationSqlPath}`);
console.log(`[launch:supabase-security-rollout] Rollback SQL: ${rollbackSqlPath}`);

if (failed.length > 0) process.exit(1);

function collectMigrations(checksOut: RolloutCheck[]): MigrationArtifact[] {
    return migrationPlan.map((migration, index) => {
        if (!existsSync(migration.file)) {
            checksOut.push({
                status: 'failed',
                name: 'migration_exists',
                message: 'A required Supabase security migration is missing.',
                details: [`file=${migration.file}`],
            });

            return {
                order: index + 1,
                file: migration.file,
                sha256: 'missing',
                bytes: 0,
                why: migration.why,
            };
        }

        const content = readFileSync(migration.file, 'utf8');
        checksOut.push({
            status: 'ok',
            name: 'migration_exists',
            message: 'Required Supabase security migration exists.',
            details: [`file=${migration.file}`],
        });

        return {
            order: index + 1,
            file: migration.file,
            sha256: sha256(content),
            bytes: Buffer.byteLength(content, 'utf8'),
            why: migration.why,
        };
    });
}

function validateForbiddenScope(migrationsToValidate: MigrationArtifact[]): RolloutCheck {
    const issues: string[] = [];

    for (const migration of migrationsToValidate) {
        if (migration.sha256 === 'missing') continue;
        const content = readFileSync(migration.file, 'utf8');
        const matches = content.match(/\bDROP\s+(TABLE|COLUMN|SCHEMA|DATABASE)\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/gi);
        if (matches) {
            issues.push(`${migration.file}: ${Array.from(new Set(matches)).join(', ')}`);
        }
    }

    return {
        status: issues.length === 0 ? 'ok' : 'failed',
        name: 'forbidden_scope_scan',
        message: issues.length === 0
            ? 'The security rollout avoids broad destructive SQL patterns outside the approved policy/function/trigger scope.'
            : 'The security rollout includes broad destructive SQL patterns that require a separate approval.',
        details: issues.length > 0 ? issues : ['no DROP TABLE/COLUMN/SCHEMA/DATABASE', 'no TRUNCATE', 'no DELETE FROM'],
    };
}

function validateDeprecatedAuthPatterns(migrationsToValidate: MigrationArtifact[]): RolloutCheck {
    const bundleSource = readMigrationBundleSource(migrationsToValidate);
    const forbidden = [
        { label: 'auth.role()', pattern: /\bauth\.role\s*\(/i },
        { label: 'raw_user_meta_data', pattern: /\braw_user_meta_data\b/i },
        { label: 'user_metadata', pattern: /\buser_metadata\b/i },
    ];
    const issues = forbidden
        .filter((item) => item.pattern.test(bundleSource))
        .map((item) => `forbidden=${item.label}`);

    return {
        status: issues.length === 0 ? 'ok' : 'failed',
        name: 'deprecated_supabase_auth_pattern_scan',
        message: issues.length === 0
            ? 'The security rollout avoids deprecated or user-editable Supabase auth patterns.'
            : 'The security rollout contains deprecated or user-editable Supabase auth patterns.',
        details: issues.length > 0 ? issues : ['no auth.role()', 'no raw_user_meta_data', 'no user_metadata'],
    };
}

function validateSessionPolicyMigration(): RolloutCheck {
    const content = readFileSync('supabase/migrations/021_harden_session_write_policies.sql', 'utf8');
    const required = [
        'DROP POLICY IF EXISTS "Students can cancel own sessions" ON sessions',
        'DROP POLICY IF EXISTS "Teachers can create assigned sessions" ON sessions',
        'DROP POLICY IF EXISTS "Teachers can update assigned sessions" ON sessions',
        'DROP POLICY IF EXISTS "Teachers can view and update assigned sessions" ON sessions',
        'CREATE POLICY "Teachers can view assigned sessions"',
        'ON sessions FOR SELECT',
        'USING (teacher_id = auth.uid())',
    ];
    const forbidden = [
        'CREATE POLICY "Teachers can view and update assigned sessions"',
        'ON sessions FOR ALL',
        'ON sessions FOR UPDATE',
        'ON sessions FOR INSERT',
    ];

    return snippetCheck(
        'session_policy_hardening',
        'Session policy migration drops direct write policies and recreates teacher visibility as SELECT-only.',
        content,
        required,
        forbidden,
    );
}

function validateWebhookProcessingMigration(): RolloutCheck {
    const content = readFileSync('supabase/migrations/022_track_stripe_webhook_processing_state.sql', 'utf8');
    const required = [
        'ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()',
        'ADD COLUMN IF NOT EXISTS processing_status TEXT',
        'ADD COLUMN IF NOT EXISTS processing_error TEXT',
        'ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ',
        "processing_status = COALESCE(processing_status, 'succeeded')",
        'ALTER COLUMN processing_status SET DEFAULT',
        'ALTER COLUMN processing_status SET NOT NULL',
        'processed_webhook_events_processing_status_check',
        "CHECK (processing_status IN ('processing', 'succeeded', 'failed'))",
    ];

    return snippetCheck(
        'webhook_processing_state',
        'Webhook processing migration handles both live timestamp shapes and adds processing-state guardrails.',
        content,
        required,
        [],
    );
}

function validateProfileTriggerMigration(): RolloutCheck {
    const content = readFileSync('supabase/migrations/20260702124757_harden_profile_role_trigger.sql', 'utf8');
    const required = [
        'CREATE SCHEMA IF NOT EXISTS private',
        'DROP TRIGGER IF EXISTS protect_profile_role_trigger ON public.profiles',
        'DROP FUNCTION IF EXISTS public.protect_profile_role()',
        'CREATE OR REPLACE FUNCTION private.protect_profile_role()',
        'SECURITY DEFINER',
        'SET search_path = public, private, pg_temp',
        'IF (select private.is_admin()) THEN',
        'NEW.role IS DISTINCT FROM OLD.role',
        'NEW.email IS DISTINCT FROM OLD.email',
        "RAISE EXCEPTION 'Cannot modify role'",
        "RAISE EXCEPTION 'Cannot modify profile email'",
        'REVOKE ALL ON FUNCTION private.protect_profile_role() FROM public',
        'REVOKE ALL ON FUNCTION private.protect_profile_role() FROM anon',
        'REVOKE ALL ON FUNCTION private.protect_profile_role() FROM authenticated',
        'GRANT EXECUTE ON FUNCTION private.protect_profile_role() TO service_role',
        'FOR EACH ROW EXECUTE FUNCTION private.protect_profile_role()',
    ];
    const forbidden = [
        'CREATE OR REPLACE FUNCTION public.protect_profile_role()',
        'FOR EACH ROW EXECUTE FUNCTION public.protect_profile_role()',
    ];

    return snippetCheck(
        'profile_trigger_hardening',
        'Profile trigger migration uses a private SECURITY DEFINER helper with fixed search_path and restricted grants.',
        content,
        required,
        forbidden,
    );
}

function snippetCheck(
    name: string,
    okMessage: string,
    content: string,
    required: string[],
    forbidden: string[],
): RolloutCheck {
    const missing = required.filter((snippet) => !content.includes(snippet));
    const presentForbidden = forbidden.filter((snippet) => content.includes(snippet));
    const issues = [
        ...missing.map((snippet) => `missing=${snippet}`),
        ...presentForbidden.map((snippet) => `forbidden_present=${snippet}`),
    ];

    return {
        status: issues.length === 0 ? 'ok' : 'failed',
        name,
        message: issues.length === 0 ? okMessage : `${name} failed required snippet checks.`,
        details: issues.length > 0 ? issues : [`required=${required.length}`, `forbidden_absent=${forbidden.length}`],
    };
}

function renderMigrationBundle(migrationsToRender: MigrationArtifact[]): string {
    const lines = [
        '-- Espanol Honesto Supabase security rollout bundle.',
        '-- Generated locally for review. This file does not apply itself and does not authorize a remote write.',
        '-- Scope: migrations 021, 022 and 20260702124757 only.',
        '-- Target sequence: staging first, verify, then production only after staging passes.',
        '-- Staging: espanol-staging (mzjyvmlxfpzdfdjzxxyj).',
        '-- Production: espanol-honesto (vkkahxsybhbutszerawz).',
        '',
    ];

    for (const migration of migrationsToRender) {
        lines.push(
            '-- ============================================================================',
            `-- Order ${migration.order}: ${migration.file}`,
            `-- Why: ${migration.why}`,
            `-- sha256: ${migration.sha256}`,
            '-- ============================================================================',
            '',
        );

        if (migration.sha256 === 'missing') {
            lines.push(`-- MISSING FILE: ${migration.file}`, '');
            continue;
        }

        lines.push(readFileSync(migration.file, 'utf8').trimEnd(), '');
    }

    return `${lines.join('\n')}\n`;
}

function renderPostApplyVerificationSql(): string {
    return `${[
        '-- Supabase security rollout post-apply verification.',
        '-- Read-only metadata queries. Run separately against staging and production after applying the approved migrations.',
        '',
        'select policyname, roles::text as roles, cmd, qual, with_check',
        'from pg_policies',
        "where schemaname='public'",
        "  and tablename='sessions'",
        'order by policyname;',
        '',
        'select event_object_table, trigger_name, event_manipulation, action_timing, action_statement',
        'from information_schema.triggers',
        "where event_object_schema='public'",
        "  and event_object_table='profiles'",
        'order by trigger_name, event_manipulation;',
        '',
        "select pg_get_functiondef('private.protect_profile_role()'::regprocedure) as definition;",
        '',
        'select',
        "    to_regprocedure('private.protect_profile_role()') as private_function,",
        "    to_regprocedure('public.protect_profile_role()') as public_legacy_function;",
        '',
        'select column_name, data_type, is_nullable, column_default',
        'from information_schema.columns',
        "where table_schema='public'",
        "  and table_name='processed_webhook_events'",
        'order by ordinal_position;',
        '',
        'select conname, pg_get_constraintdef(oid) as definition',
        'from pg_constraint',
        "where conrelid='public.processed_webhook_events'::regclass",
        "  and conname='processed_webhook_events_processing_status_check';",
        '',
    ].join('\n')}\n`;
}

function renderRollbackSql(): string {
    return `${[
        '-- Supabase security rollout rollback helper.',
        '-- Use only if immediate post-apply verification or smoke fails.',
        '',
        'DROP POLICY IF EXISTS "Teachers can view assigned sessions" ON sessions;',
        '',
        'CREATE POLICY "Students can cancel own sessions"',
        '    ON sessions FOR UPDATE',
        '    USING (student_id = auth.uid())',
        "    WITH CHECK (student_id = auth.uid() AND status = 'cancelled');",
        '',
        'CREATE POLICY "Teachers can view and update assigned sessions"',
        '    ON sessions FOR ALL',
        '    USING (teacher_id = auth.uid())',
        '    WITH CHECK (',
        '        teacher_id = auth.uid()',
        '        AND EXISTS (',
        '            SELECT 1',
        '            FROM student_teachers st',
        '            WHERE st.teacher_id = auth.uid()',
        '              AND st.student_id = sessions.student_id',
        '        )',
        '    );',
        '',
        'ALTER TABLE public.processed_webhook_events',
        '    DROP CONSTRAINT IF EXISTS processed_webhook_events_processing_status_check;',
        '',
        'ALTER TABLE public.processed_webhook_events',
        '    DROP COLUMN IF EXISTS processing_error,',
        '    DROP COLUMN IF EXISTS processing_status;',
        '',
        'DROP TRIGGER IF EXISTS protect_profile_role_trigger ON public.profiles;',
        'DROP FUNCTION IF EXISTS private.protect_profile_role();',
        '',
        'CREATE OR REPLACE FUNCTION public.protect_profile_role()',
        'RETURNS TRIGGER',
        'LANGUAGE plpgsql',
        'SECURITY DEFINER',
        "SET search_path TO 'public', 'pg_temp'",
        'AS $$',
        'BEGIN',
        '    IF auth.uid() IS NULL THEN',
        '        RETURN NEW;',
        '    END IF;',
        '',
        '    IF is_admin() THEN',
        '        RETURN NEW;',
        '    END IF;',
        '',
        '    IF NEW.role IS DISTINCT FROM OLD.role THEN',
        "        RAISE EXCEPTION 'Cannot modify role';",
        '    END IF;',
        '',
        '    RETURN NEW;',
        'END;',
        '$$;',
        '',
        'CREATE TRIGGER protect_profile_role_trigger',
        '    BEFORE UPDATE ON public.profiles',
        '    FOR EACH ROW EXECUTE FUNCTION public.protect_profile_role();',
        '',
        '-- For staging-only rollback to the observed preflight state, also run:',
        '-- DROP TRIGGER IF EXISTS protect_profile_role_trigger ON public.profiles;',
        '-- DROP FUNCTION IF EXISTS public.protect_profile_role();',
        '-- DROP FUNCTION IF EXISTS private.protect_profile_role();',
        '',
    ].join('\n')}\n`;
}

function renderApprovalRequest(report: SecurityRolloutReport): string {
    const migrationList = report.migrations.map((migration) => `- ${migration.file}`).join('\n');

    return `${[
        '# Supabase Security Rollout Approval Request',
        '',
        'This local file is not permission. It prepares the exact external-write request for SEC-014 and SEC-015.',
        '',
        '## Target Resources',
        '',
        '- Staging first: Supabase project `espanol-staging` (`mzjyvmlxfpzdfdjzxxyj`, eu-central-1).',
        '- Production second, only after staging passes: Supabase project `espanol-honesto` (`vkkahxsybhbutszerawz`, eu-west-1).',
        '',
        '## Migrations',
        '',
        migrationList,
        '',
        '## Required Preflight',
        '',
        '- Confirm the dashboard or connector target is exactly the project named above before every write.',
        '- Keep database URLs, service role keys, JWTs, private rows, dumps and screenshots with personal data out of the repo and outputs.',
        '- Prefer migration tooling if remote migration history is explainable; use the generated SQL bundle only as a reviewed fallback.',
        `- Review \`${toPosix(path.relative(process.cwd(), report.manifestPath))}\`, \`${toPosix(path.relative(process.cwd(), report.bundlePath))}\`, \`${toPosix(path.relative(process.cwd(), report.postApplyVerificationSqlPath))}\` and \`${toPosix(path.relative(process.cwd(), report.rollbackSqlPath))}\`.`,
        '',
        '## Exact Approval Sentence',
        '',
        'I approve applying migrations 021, 022 and 20260702124757 to Supabase staging project `mzjyvmlxfpzdfdjzxxyj` first, running the read-only verification queries, and only if staging passes, applying the same migrations to production project `vkkahxsybhbutszerawz`, then running the same read-only verification and updating the strict-QA tracker. I understand this changes Supabase RLS policies, the `processed_webhook_events` schema, and the `protect_profile_role` trigger/function.',
        '',
        '## Stop Gates',
        '',
        '- Stop before production if staging verification does not match the expected sessions policies, private profile trigger/function and webhook processing-state columns/constraint.',
        '- Stop if the target project is not the expected staging or production project.',
        '- Stop if migration tooling wants to apply migrations outside 021, 022 and 20260702124757.',
        '- Stop if output would expose secrets, database URLs, JWTs, private rows or screenshots with personal data.',
        '',
        '## Explicitly Not Approved',
        '',
        '- Deleting projects, schemas, tables, rows, users, auth identities or storage objects.',
        '- Rotating or printing keys.',
        '- Modifying Edge Functions, Storage, Auth settings, API settings, billing, Cloudflare, Stripe, Google, Resend, Sentry, DNS, Pages or Workers.',
        '- Sending email, creating Google events, creating Stripe sessions or running final product smoke.',
        '',
    ].join('\n')}\n`;
}

function renderManualEvidenceDryRun(report: SecurityRolloutReport): string {
    const approval = `../../${toPosix(path.relative(process.cwd(), report.approvalRequestPath))}`;
    const manifest = `../../${toPosix(path.relative(process.cwd(), report.manifestPath))}`;
    const verify = `../../${toPosix(path.relative(process.cwd(), report.postApplyVerificationSqlPath))}`;

    const commandLines = [
        'corepack pnpm launch:manual-evidence:record --',
        '  --id security_external',
        '  --status pass',
        '  --summary "Supabase SEC-014/SEC-015 applied staging-first and production second after staging passed; read-only verification confirms sessions direct write policies removed, private profile role/email trigger active, webhook processing state present, and no secrets/private rows stored."',
        '  --environment "Supabase staging mzjyvmlxfpzdfdjzxxyj and production vkkahxsybhbutszerawz"',
        '  --owner Alin',
        `  --evidence "command_output=${approval}::approved Supabase security rollout scope"`,
        `  --evidence "command_output=${manifest}::migration hashes, targets and forbidden scope reviewed"`,
        `  --evidence "command_output=${verify}::post-apply read-only metadata verification used"`,
        '  --evidence "manual_note=Replace with concrete non-secret result: staging target confirmed; staging verification passed; production target confirmed; production verification passed; focused local tests passed; strict-QA tracker updated."',
    ];

    return `${commandLines.join(' \\\n')}\n\n# Add --write only after replacing the placeholder note with real non-secret post-apply evidence.\n`;
}

function renderSummary(report: SecurityRolloutReport): string {
    const lines = [
        '# Supabase Security Rollout Summary',
        '',
        `- Status: ${report.status}`,
        `- Started: ${report.startedAt}`,
        `- Ended: ${report.endedAt}`,
        `- Bundle: ${toPosix(path.relative(process.cwd(), report.bundlePath))}`,
        `- Manifest: ${toPosix(path.relative(process.cwd(), report.manifestPath))}`,
        `- Approval request: ${toPosix(path.relative(process.cwd(), report.approvalRequestPath))}`,
        `- Post-apply verification SQL: ${toPosix(path.relative(process.cwd(), report.postApplyVerificationSqlPath))}`,
        `- Rollback SQL: ${toPosix(path.relative(process.cwd(), report.rollbackSqlPath))}`,
        '',
        'This is local-only. It does not connect to Supabase, does not apply SQL and does not authorize an external write.',
        '',
        '## Target Projects',
        '',
        '| Environment | Project | Ref | Region |',
        '| --- | --- | --- | --- |',
    ];

    for (const target of report.targetProjects) {
        lines.push(`| ${target.environment} | ${target.name} | ${target.ref} | ${target.region} |`);
    }

    lines.push(
        '',
        '## Checks',
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
    );

    for (const check of report.checks) {
        lines.push(`| ${check.status} | ${check.name} | ${escapeCell(check.message)} | ${escapeCell(check.details.join(' / '))} |`);
    }

    lines.push('');
    return `${lines.join('\n')}\n`;
}

function renderManifest(
    report: SecurityRolloutReport,
    bundle: string,
    postApplyVerificationSql: string,
    rollbackSql: string,
): Record<string, unknown> {
    return {
        schemaVersion: 1,
        generatedAt: report.endedAt,
        readyForApproval: report.status !== 'FAILED',
        targetProjects: report.targetProjects,
        migrations: report.migrations.map((migration) => ({
            ...migration,
            exists: migration.sha256 !== 'missing',
        })),
        files: {
            summary: toPosix(path.relative(process.cwd(), path.join(report.outputDir, 'summary.md'))),
            approvalRequest: toPosix(path.relative(process.cwd(), report.approvalRequestPath)),
            bundle: {
                path: toPosix(path.relative(process.cwd(), report.bundlePath)),
                sha256: sha256(bundle),
                bytes: Buffer.byteLength(bundle, 'utf8'),
            },
            postApplyVerificationSql: {
                path: toPosix(path.relative(process.cwd(), report.postApplyVerificationSqlPath)),
                sha256: sha256(postApplyVerificationSql),
                bytes: Buffer.byteLength(postApplyVerificationSql, 'utf8'),
            },
            rollbackSql: {
                path: toPosix(path.relative(process.cwd(), report.rollbackSqlPath)),
                sha256: sha256(rollbackSql),
                bytes: Buffer.byteLength(rollbackSql, 'utf8'),
            },
            manualEvidenceDryRun: toPosix(path.relative(process.cwd(), report.manualEvidenceDryRunPath)),
        },
        checks: report.checks,
        approvalRequired: true,
        allowedScope: [
            'Apply or verify migrations 021, 022 and 20260702124757 only.',
            'Run staging first against mzjyvmlxfpzdfdjzxxyj.',
            'Run production only after staging verification passes, against vkkahxsybhbutszerawz.',
            'Run read-only post-apply verification queries and focused local regression tests.',
        ],
        forbiddenScope: [
            'No project/table/row/user/storage deletion.',
            'No key rotation or secret printing.',
            'No Cloudflare, Stripe, Google, Resend, Sentry, DNS, Pages or Worker writes.',
            'No email sending, Google event creation, Stripe session creation or final smoke.',
        ],
    };
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function readMigrationBundleSource(migrationsToRead: MigrationArtifact[]): string {
    return migrationsToRead
        .filter((migration) => migration.sha256 !== 'missing')
        .map((migration) => readFileSync(migration.file, 'utf8'))
        .join('\n');
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
