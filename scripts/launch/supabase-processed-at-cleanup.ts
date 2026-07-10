import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type CheckStatus = 'ok' | 'warning' | 'failed';

interface CleanupCheck {
    status: CheckStatus;
    name: string;
    message: string;
    details: string[];
}

interface TargetProject {
    environment: 'staging' | 'production';
    name: string;
    ref: string;
    region: string;
}

interface MigrationArtifact {
    version: string;
    file: string;
    sha256: string;
    bytes: number;
    why: string;
}

interface CleanupReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: 'OK' | 'WARNING' | 'FAILED';
    outputDir: string;
    targetProjects: TargetProject[];
    migration: MigrationArtifact;
    checks: CleanupCheck[];
    bundlePath: string;
    manifestPath: string;
    approvalRequestPath: string;
    preflightSqlPath: string;
    postApplyVerificationSqlPath: string;
    rollbackSqlPath: string;
    manualEvidenceDryRunPath: string;
    acceptedRiskPackagePath: string;
    strictQaAcceptedRiskDryRunPath: string;
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

const migration = {
    version: '20260703211451',
    file: 'supabase/migrations/20260703211451_drop_processed_webhook_processed_at_default.sql',
    why: 'Drops the production-only processed_webhook_events.processed_at DEFAULT now() drift so processing rows cannot receive a completed timestamp by omission.',
};

const expectedSql = 'ALTER TABLE public.processed_webhook_events ALTER COLUMN processed_at DROP DEFAULT;';

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-supabase-processed-at-cleanup', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const checks: CleanupCheck[] = [];
const artifact = collectMigration(checks);
checks.push(validateExactMigrationSql(artifact));
checks.push(validateCanonicalSchema());
checks.push(validateInvariantTests());
checks.push(validateWebhookClaimCodePath());
checks.push(validateApprovalPackage());

const bundle = renderMigrationBundle(artifact);
const preflightSql = renderPreflightSql();
const postApplyVerificationSql = renderPostApplyVerificationSql();
const rollbackSql = renderRollbackSql();
const latestReadonlyPreflightSummary = latestGeneratedPath('supabase-processed-at-readonly-preflight', 'summary.md');

const bundlePath = path.join(outputDir, 'supabase-processed-at-cleanup-bundle.sql');
const manifestPath = path.join(outputDir, 'supabase-processed-at-cleanup-manifest.json');
const approvalRequestPath = path.join(outputDir, 'approval-request.md');
const preflightSqlPath = path.join(outputDir, 'preflight.sql');
const postApplyVerificationSqlPath = path.join(outputDir, 'post-apply-verification.sql');
const rollbackSqlPath = path.join(outputDir, 'rollback.sql');
const manualEvidenceDryRunPath = path.join(outputDir, 'manual-evidence-dry-run.txt');
const acceptedRiskPackagePath = path.join(outputDir, 'accepted-risk-package.md');
const strictQaAcceptedRiskDryRunPath = path.join(outputDir, 'strict-qa-accepted-risk-dry-run.txt');

writeFileSync(bundlePath, bundle, 'utf8');
writeFileSync(preflightSqlPath, preflightSql, 'utf8');
writeFileSync(postApplyVerificationSqlPath, postApplyVerificationSql, 'utf8');
writeFileSync(rollbackSqlPath, rollbackSql, 'utf8');

const failed = checks.filter((check) => check.status === 'failed');
const warnings = checks.filter((check) => check.status === 'warning');
const status = failed.length > 0 ? 'FAILED' : warnings.length > 0 ? 'WARNING' : 'OK';

const report: CleanupReport = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status,
    outputDir,
    targetProjects,
    migration: artifact,
    checks,
    bundlePath,
    manifestPath,
    approvalRequestPath,
    preflightSqlPath,
    postApplyVerificationSqlPath,
    rollbackSqlPath,
    manualEvidenceDryRunPath,
    acceptedRiskPackagePath,
    strictQaAcceptedRiskDryRunPath,
};

const acceptedRiskPackage = renderAcceptedRiskPackage(report);
const strictQaAcceptedRiskDryRun = renderStrictQaAcceptedRiskDryRun(report);

writeFileSync(manifestPath, JSON.stringify(renderManifest(report, bundle, preflightSql, postApplyVerificationSql, rollbackSql, acceptedRiskPackage, strictQaAcceptedRiskDryRun), null, 2), 'utf8');
writeFileSync(approvalRequestPath, renderApprovalRequest(report), 'utf8');
writeFileSync(manualEvidenceDryRunPath, renderManualEvidenceDryRun(report), 'utf8');
writeFileSync(acceptedRiskPackagePath, acceptedRiskPackage, 'utf8');
writeFileSync(strictQaAcceptedRiskDryRunPath, strictQaAcceptedRiskDryRun, 'utf8');
writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(path.join(outputDir, 'summary.md'), renderSummary(report), 'utf8');

console.log(`[launch:supabase-processed-at-cleanup] Status: ${status}`);
console.log(`[launch:supabase-processed-at-cleanup] Failed: ${failed.length}`);
console.log(`[launch:supabase-processed-at-cleanup] Warnings: ${warnings.length}`);
console.log(`[launch:supabase-processed-at-cleanup] Summary: ${path.join(outputDir, 'summary.md')}`);
console.log(`[launch:supabase-processed-at-cleanup] Manifest: ${manifestPath}`);
console.log(`[launch:supabase-processed-at-cleanup] Approval request: ${approvalRequestPath}`);
console.log(`[launch:supabase-processed-at-cleanup] Preflight SQL: ${preflightSqlPath}`);
console.log(`[launch:supabase-processed-at-cleanup] Post-apply verification SQL: ${postApplyVerificationSqlPath}`);
console.log(`[launch:supabase-processed-at-cleanup] Rollback SQL: ${rollbackSqlPath}`);
console.log(`[launch:supabase-processed-at-cleanup] Accepted risk package: ${acceptedRiskPackagePath}`);
console.log(`[launch:supabase-processed-at-cleanup] Strict-QA accepted-risk dry run: ${strictQaAcceptedRiskDryRunPath}`);

if (failed.length > 0) process.exit(1);

function collectMigration(checksOut: CleanupCheck[]): MigrationArtifact {
    if (!existsSync(migration.file)) {
        checksOut.push({
            status: 'failed',
            name: 'migration_exists',
            message: 'The required processed_at cleanup migration is missing.',
            details: [`file=${migration.file}`],
        });

        return {
            ...migration,
            sha256: 'missing',
            bytes: 0,
        };
    }

    const content = readFileSync(migration.file, 'utf8');
    checksOut.push({
        status: 'ok',
        name: 'migration_exists',
        message: 'The required processed_at cleanup migration exists.',
        details: [`file=${migration.file}`],
    });

    return {
        ...migration,
        sha256: sha256(content),
        bytes: Buffer.byteLength(content, 'utf8'),
    };
}

function validateExactMigrationSql(artifactToValidate: MigrationArtifact): CleanupCheck {
    if (artifactToValidate.sha256 === 'missing') {
        return {
            status: 'failed',
            name: 'migration_exact_scope',
            message: 'Cannot validate migration SQL because the file is missing.',
            details: [`expected=${expectedSql}`],
        };
    }

    const content = readFileSync(artifactToValidate.file, 'utf8');
    const normalized = normalizeSql(content);
    const matches = normalized === expectedSql;
    const forbidden = /\b(DROP\s+(TABLE|COLUMN|SCHEMA|DATABASE)|TRUNCATE|DELETE\s+FROM|INSERT\s+INTO|UPDATE\s+|CREATE\s+)\b/i.test(normalized);

    return {
        status: matches && !forbidden ? 'ok' : 'failed',
        name: 'migration_exact_scope',
        message: matches && !forbidden
            ? 'Cleanup migration is exactly the approved DROP DEFAULT statement and contains no broad destructive/write SQL.'
            : 'Cleanup migration SQL is broader than the approved DROP DEFAULT statement.',
        details: matches && !forbidden
            ? [`sql=${expectedSql}`, 'no DROP TABLE/COLUMN/SCHEMA/DATABASE', 'no TRUNCATE/DELETE/INSERT/UPDATE/CREATE']
            : [`expected=${expectedSql}`, `actual=${normalized}`, `forbiddenBroadWrite=${forbidden}`],
    };
}

function validateCanonicalSchema(): CleanupCheck {
    const schemaPath = 'db/schema.sql';
    if (!existsSync(schemaPath)) {
        return {
            status: 'failed',
            name: 'canonical_schema_shape',
            message: 'Canonical schema file is missing.',
            details: [schemaPath],
        };
    }

    const schema = readFileSync(schemaPath, 'utf8');
    const hasProcessedAt = schema.includes('processed_at TIMESTAMPTZ,');
    const hasDefault = schema.includes('processed_at TIMESTAMPTZ DEFAULT');

    return {
        status: hasProcessedAt && !hasDefault ? 'ok' : 'failed',
        name: 'canonical_schema_shape',
        message: hasProcessedAt && !hasDefault
            ? 'Canonical schema already defines processed_at without a default.'
            : 'Canonical schema does not match the intended processed_at no-default shape.',
        details: [`hasProcessedAt=${hasProcessedAt}`, `hasDefault=${hasDefault}`],
    };
}

function validateInvariantTests(): CleanupCheck {
    const testPath = 'tests/unit/database-schema-invariants.test.ts';
    if (!existsSync(testPath)) {
        return {
            status: 'failed',
            name: 'invariant_test_coverage',
            message: 'Database schema invariant test file is missing.',
            details: [testPath],
        };
    }

    const test = readFileSync(testPath, 'utf8');
    const required = [
        '20260703211451_drop_processed_webhook_processed_at_default.sql',
        'processed_at TIMESTAMPTZ,',
        'processed_at TIMESTAMPTZ DEFAULT',
        'ALTER COLUMN processed_at DROP DEFAULT',
    ];
    const missing = required.filter((snippet) => !test.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'invariant_test_coverage',
        message: missing.length === 0
            ? 'Focused invariant tests cover the processed_at no-default shape and cleanup migration.'
            : 'Focused invariant tests do not cover the processed_at cleanup migration.',
        details: missing.length === 0 ? [`required=${required.length}`] : missing.map((snippet) => `missing=${snippet}`),
    };
}

function validateWebhookClaimCodePath(): CleanupCheck {
    const webhookPath = 'src/pages/api/stripe-webhook.ts';
    if (!existsSync(webhookPath)) {
        return {
            status: 'failed',
            name: 'webhook_claim_code_path',
            message: 'Stripe webhook route is missing, so the accepted-risk mitigation claim cannot be verified.',
            details: [webhookPath],
        };
    }

    const webhook = readFileSync(webhookPath, 'utf8');
    const required = [
        "processing_status: 'processing'",
        'processing_error: null',
        'processed_at: null',
        'markWebhookEventSucceeded',
        'processed_at: new Date().toISOString()',
        'markWebhookEventFailed',
    ];
    const missing = required.filter((snippet) => !webhook.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'webhook_claim_code_path',
        message: missing.length === 0
            ? 'Current Stripe webhook claim path explicitly stores processing rows with processed_at null and only timestamps succeeded rows.'
            : 'Current Stripe webhook claim path does not prove the accepted-risk mitigation claim.',
        details: missing.length === 0
            ? [`route=${webhookPath}`, 'claim_processed_at_null=true', 'success_sets_processed_at=true', 'failure_clears_processed_at=true']
            : missing.map((snippet) => `missing=${snippet}`),
    };
}

function validateApprovalPackage(): CleanupCheck {
    const packagePath = 'outputs/019f1a5e-2745-7c43-870d-544e6ba4e0b1/strict-qa-v2/supabase-processed-at-default-approval-package.md';
    if (!existsSync(packagePath)) {
        return {
            status: 'warning',
            name: 'approval_package_exists',
            message: 'Legacy strict-QA approval package is missing; generated package still contains the needed approval request.',
            details: [packagePath],
        };
    }

    const approvalPackage = readFileSync(packagePath, 'utf8');
    const required = [
        '20260703211451_drop_processed_webhook_processed_at_default',
        'mzjyvmlxfpzdfdjzxxyj',
        'vkkahxsybhbutszerawz',
        'ALTER COLUMN processed_at DROP DEFAULT',
        'No autorizo ningun otro cambio',
    ];
    const missing = required.filter((snippet) => !approvalPackage.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'approval_package_exists',
        message: missing.length === 0
            ? 'Existing strict-QA approval package names the exact migration, targets, SQL and forbidden scope.'
            : 'Existing strict-QA approval package is missing required approval details.',
        details: missing.length === 0 ? [`package=${packagePath}`] : missing.map((snippet) => `missing=${snippet}`),
    };
}

function renderMigrationBundle(artifactToRender: MigrationArtifact): string {
    const lines = [
        '-- Espanol Honesto Supabase processed_at cleanup bundle.',
        '-- Generated locally for review. This file does not apply itself and does not authorize a remote write.',
        '-- Scope: migration 20260703211451 only.',
        '-- Target sequence: staging first, verify, then production only after staging passes.',
        '-- Staging: espanol-staging (mzjyvmlxfpzdfdjzxxyj).',
        '-- Production: espanol-honesto (vkkahxsybhbutszerawz).',
        '',
        '-- ============================================================================',
        `-- Version: ${artifactToRender.version}`,
        `-- File: ${artifactToRender.file}`,
        `-- Why: ${artifactToRender.why}`,
        `-- sha256: ${artifactToRender.sha256}`,
        '-- ============================================================================',
        '',
    ];

    if (artifactToRender.sha256 === 'missing') {
        lines.push(`-- MISSING FILE: ${artifactToRender.file}`, '');
    } else {
        lines.push(readFileSync(artifactToRender.file, 'utf8').trimEnd(), '');
    }

    return `${lines.join('\n')}\n`;
}

function renderPreflightSql(): string {
    return `${[
        '-- Supabase processed_at cleanup preflight.',
        '-- Read-only metadata/aggregate queries. Run against staging first, then production only after staging is understood.',
        '',
        'select version',
        'from supabase_migrations.schema_migrations',
        "where version in ('021', '022', '20260702124757', '20260703211451')",
        'order by version;',
        '',
        'select column_default',
        'from information_schema.columns',
        "where table_schema = 'public'",
        "  and table_name = 'processed_webhook_events'",
        "  and column_name = 'processed_at';",
        '',
        'select count(*)::int as total,',
        "       count(*) filter (where processing_status not in ('processing','succeeded','failed'))::int as invalid_status,",
        '       count(*) filter (where processing_status is null)::int as null_status,',
        "       count(*) filter (where processing_status = 'processing' and processed_at is not null)::int as processing_with_processed_at",
        'from public.processed_webhook_events;',
        '',
    ].join('\n')}\n`;
}

function renderPostApplyVerificationSql(): string {
    return `${[
        '-- Supabase processed_at cleanup post-apply verification.',
        '-- Read-only metadata/aggregate queries. Expected: cleanup migration present and processed_at column_default is null.',
        '',
        'select version',
        'from supabase_migrations.schema_migrations',
        "where version = '20260703211451';",
        '',
        'select column_default',
        'from information_schema.columns',
        "where table_schema = 'public'",
        "  and table_name = 'processed_webhook_events'",
        "  and column_name = 'processed_at';",
        '',
        'select count(*)::int as total,',
        "       count(*) filter (where processing_status not in ('processing','succeeded','failed'))::int as invalid_status,",
        '       count(*) filter (where processing_status is null)::int as null_status,',
        "       count(*) filter (where processing_status = 'processing' and processed_at is not null)::int as processing_with_processed_at",
        'from public.processed_webhook_events;',
        '',
    ].join('\n')}\n`;
}

function renderRollbackSql(): string {
    return `${[
        '-- Supabase processed_at cleanup rollback helper.',
        '-- Use only if the cleanup creates a verified incident; this restores the prior production drift.',
        '',
        'ALTER TABLE public.processed_webhook_events',
        '    ALTER COLUMN processed_at SET DEFAULT now();',
        '',
    ].join('\n')}\n`;
}

function renderApprovalRequest(report: CleanupReport): string {
    return `${[
        '# Supabase Processed At Cleanup Approval Request',
        '',
        'This local file is not permission. It prepares the exact external-write request for ERR-QA-SUPABASE-PROCESSED-AT-DEFAULT-149.',
        '',
        '## Target Resources',
        '',
        '- Staging first: Supabase project `espanol-staging` (`mzjyvmlxfpzdfdjzxxyj`, eu-central-1).',
        '- Production second, only after staging passes: Supabase project `espanol-honesto` (`vkkahxsybhbutszerawz`, eu-west-1).',
        '',
        '## Migration',
        '',
        `- ${report.migration.file}`,
        '',
        '## Required Preflight',
        '',
        '- Confirm the database URL or connector target is exactly the project named above before every write.',
        '- Run `preflight.sql` against staging before any apply.',
        '- Stop if migration tooling wants to apply anything except `20260703211451`.',
        '- Do not use `supabase db push` while older local/remote migration-history drift remains explainable but unresolved.',
        '- Keep database URLs, service role keys, JWTs, private rows, dumps and screenshots with personal data out of the repo and outputs.',
        '',
        '## Exact Approval Sentence',
        '',
        'Apruebo aplicar la migracion `20260703211451_drop_processed_webhook_processed_at_default` a Supabase staging `mzjyvmlxfpzdfdjzxxyj` primero, verificar read-only que `processed_webhook_events.processed_at` no tiene default y que los estados webhook siguen limpios, y si staging pasa, aplicarla a produccion `vkkahxsybhbutszerawz` y verificar read-only. No autorizo ningun otro cambio de Supabase ni servicios externos.',
        '',
        '## Stop Gates',
        '',
        '- Stop before production if staging verification does not show `processed_at` column_default null and clean webhook aggregate counts.',
        '- Stop if the target project is not the expected staging or production project.',
        '- Stop if output would expose secrets, database URLs, JWTs, private rows or screenshots with personal data.',
        '',
        '## Explicitly Not Approved',
        '',
        '- Applying migrations 021, 022, 20260702124757 or any migration other than 20260703211451.',
        '- Deleting projects, schemas, tables, rows, users, auth identities or storage objects.',
        '- Rotating or printing keys.',
        '- Modifying Edge Functions, Storage, Auth settings, API settings, billing, Cloudflare, Stripe, Google, Resend, Sentry, DNS, Pages or Workers.',
        '- Sending email, creating Google events, creating Stripe sessions or running final product smoke.',
        '',
    ].join('\n')}\n`;
}

function renderManualEvidenceDryRun(report: CleanupReport): string {
    const approval = `../../${toPosix(path.relative(process.cwd(), report.approvalRequestPath))}`;
    const manifest = `../../${toPosix(path.relative(process.cwd(), report.manifestPath))}`;
    const verify = `../../${toPosix(path.relative(process.cwd(), report.postApplyVerificationSqlPath))}`;

    return `${[
        'corepack pnpm launch:manual-evidence:record --',
        '  --id database_readiness',
        '  --status pass',
        '  --summary "Supabase processed_at cleanup applied staging-first and production second after staging passed; read-only verification confirms processed_webhook_events.processed_at has no default and webhook aggregate checks remain clean."',
        '  --environment "Supabase staging mzjyvmlxfpzdfdjzxxyj and production vkkahxsybhbutszerawz"',
        '  --owner Alin',
        `  --evidence "command_output=${approval}::approved processed_at cleanup scope"`,
        `  --evidence "command_output=${manifest}::migration hash, target projects and forbidden scope reviewed"`,
        `  --evidence "command_output=${verify}::post-apply read-only verification used"`,
        '  --evidence "manual_note=Replace with concrete non-secret result: staging target confirmed; staging verification passed; production target confirmed; production verification passed; strict-QA tracker updated."',
        '',
        '# Add --write only after replacing the placeholder note with real non-secret post-apply evidence.',
        '',
    ].join(' \\\n')}`;
}

function renderAcceptedRiskPackage(report: CleanupReport): string {
    const readonlyPath = latestReadonlyPreflightSummary
        ? toPosix(path.relative(process.cwd(), latestReadonlyPreflightSummary))
        : 'outputs/supabase-processed-at-readonly-preflight/<timestamp>/summary.md';

    return `${[
        '# Supabase Processed At Accepted Risk Package',
        '',
        'This local file is not acceptance. It prepares the exact non-write alternative for ERR-QA-SUPABASE-PROCESSED-AT-DEFAULT-149 if Alin decides not to apply the cleanup migration before launch.',
        '',
        '## Current Evidence Boundary',
        '',
        `- Cleanup package: ${toPosix(path.relative(process.cwd(), path.join(report.outputDir, 'summary.md')))}`,
        `- Read-only preflight: ${readonlyPath}`,
        `- Migration available: ${report.migration.file}`,
        `- Migration sha256: ${report.migration.sha256}`,
        '- Known current state: staging has no processed_at default; production retains processed_at DEFAULT now(); current production webhook aggregate rows are clean in the latest read-only preflight.',
        '',
        '## Accepted-Risk Decision',
        '',
        'Use this path only if the launch owner explicitly prefers to carry the P3 drift rather than apply migration 20260703211451 before final smoke. Do not use it for missing legal owner/controller values, failed webhook aggregate state, unknown target projects or broad Supabase migration drift.',
        '',
        '## Exact Accepted-Risk Sentence',
        '',
        'Acepto como riesgo de lanzamiento mantener temporalmente en Supabase produccion `vkkahxsybhbutszerawz` el DEFAULT `now()` en `public.processed_webhook_events.processed_at`, despues de revisar que staging `mzjyvmlxfpzdfdjzxxyj` no tiene default, que `db/schema.sql` no tiene default, que los agregados webhook actuales estan limpios, y que el codigo actual escribe `processed_at: null` al reclamar eventos en `processing`. No autorizo aplicar migraciones ni hacer cambios externos con esta aceptacion. El rollback/mitigacion es aplicar `20260703211451_drop_processed_webhook_processed_at_default` staging-first y production-second, verificar read-only, regenerar tracker/status y revisar webhooks.',
        '',
        '## Evidence Minimum Before Recording',
        '',
        '- Fresh `pnpm launch:supabase-processed-at-readonly-preflight` summary showing staging `<NULL>`, production `now()` and clean webhook aggregate counts.',
        '- Fresh `pnpm launch:supabase-processed-at-cleanup` summary showing exact migration scope and rollback SQL.',
        '- Explicit owner/date and rationale that the current code path mitigates the omission risk until the migration is applied.',
        '- Post-launch follow-up owner and date to apply or re-evaluate the migration.',
        '',
        '## Stop Conditions',
        '',
        '- Stop if production webhook aggregate state is not clean.',
        '- Stop if target project refs differ from `mzjyvmlxfpzdfdjzxxyj` and `vkkahxsybhbutszerawz`.',
        '- Stop if the acceptance would hide a real payment, Stripe webhook, data-loss, auth, RLS or legal blocker.',
        '- Stop if any evidence would print database URLs, service role keys, JWTs, private rows or screenshots with personal data.',
        '',
        '## Rollback Or Mitigation',
        '',
        '- Preferred mitigation remains applying `20260703211451_drop_processed_webhook_processed_at_default.sql` staging-first, verifying read-only, then applying production and verifying read-only.',
        '- If a future processing writer omits `processed_at: null`, pause webhook processing, inspect aggregate state, apply the cleanup migration, and rerun Stripe webhook idempotency tests plus launch status.',
        '',
    ].join('\n')}\n`;
}

function renderStrictQaAcceptedRiskDryRun(report: CleanupReport): string {
    const packagePath = `../../${toPosix(path.relative(process.cwd(), report.acceptedRiskPackagePath))}`;
    const manifestPath = `../../${toPosix(path.relative(process.cwd(), report.manifestPath))}`;
    const readonlyPath = latestReadonlyPreflightSummary
        ? `../../${toPosix(path.relative(process.cwd(), latestReadonlyPreflightSummary))}`
        : '../../outputs/supabase-processed-at-readonly-preflight/<timestamp>/summary.md';

    return `${[
        '# Strict-QA accepted-risk dry run for ERR-QA-SUPABASE-PROCESSED-AT-DEFAULT-149',
        '',
        'This is not an executable command and does not modify strict-qa-results.json.',
        '',
        'If Alin gives the exact accepted-risk sentence and the evidence is still current, update the canonical strict-QA source by setting:',
        '',
        '- errorId: ERR-QA-SUPABASE-PROCESSED-AT-DEFAULT-149',
        '- status: Accepted Risk',
        '- severity remains: P3',
        '',
        'Append evidence text:',
        '',
        `Accepted risk recorded after reviewing ${packagePath}, ${manifestPath} and ${readonlyPath}: staging has no processed_at default, production retains DEFAULT now(), webhook aggregate state is clean, current code explicitly writes processed_at null while claiming processing rows, and Alin accepts the temporary P3 drift with rollback/mitigation to apply migration 20260703211451 staging-first then production-second.`,
        '',
        'Then run:',
        '',
        '```bash',
        'node outputs/019f1a5e-2745-7c43-870d-544e6ba4e0b1/strict-qa-v2/record-dss2-security-fixes.mjs',
        'node outputs/019f1a5e-2745-7c43-870d-544e6ba4e0b1/strict-qa-v2/build-strict-qa-tracker.mjs',
        'corepack pnpm --config.verify-deps-before-run=false launch:status',
        '```',
        '',
        'Do not use this path if the launch owner has not explicitly accepted the risk, or if fresh read-only evidence has changed.',
        '',
    ].join('\n')}`;
}

function renderSummary(report: CleanupReport): string {
    const lines = [
        '# Supabase Processed At Cleanup Summary',
        '',
        `- Status: ${report.status}`,
        `- Started: ${report.startedAt}`,
        `- Ended: ${report.endedAt}`,
        `- Bundle: ${toPosix(path.relative(process.cwd(), report.bundlePath))}`,
        `- Manifest: ${toPosix(path.relative(process.cwd(), report.manifestPath))}`,
        `- Approval request: ${toPosix(path.relative(process.cwd(), report.approvalRequestPath))}`,
        `- Preflight SQL: ${toPosix(path.relative(process.cwd(), report.preflightSqlPath))}`,
        `- Post-apply verification SQL: ${toPosix(path.relative(process.cwd(), report.postApplyVerificationSqlPath))}`,
        `- Rollback SQL: ${toPosix(path.relative(process.cwd(), report.rollbackSqlPath))}`,
        `- Accepted risk package: ${toPosix(path.relative(process.cwd(), report.acceptedRiskPackagePath))}`,
        `- Strict-QA accepted-risk dry run: ${toPosix(path.relative(process.cwd(), report.strictQaAcceptedRiskDryRunPath))}`,
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
    report: CleanupReport,
    bundle: string,
    preflightSql: string,
    postApplyVerificationSql: string,
    rollbackSql: string,
    acceptedRiskPackage: string,
    strictQaAcceptedRiskDryRun: string,
): Record<string, unknown> {
    return {
        schemaVersion: 1,
        generatedAt: report.endedAt,
        readyForApproval: report.status !== 'FAILED',
        targetProjects: report.targetProjects,
        migration: {
            ...report.migration,
            exists: report.migration.sha256 !== 'missing',
        },
        expectedSql,
        files: {
            summary: toPosix(path.relative(process.cwd(), path.join(report.outputDir, 'summary.md'))),
            approvalRequest: toPosix(path.relative(process.cwd(), report.approvalRequestPath)),
            bundle: {
                path: toPosix(path.relative(process.cwd(), report.bundlePath)),
                sha256: sha256(bundle),
                bytes: Buffer.byteLength(bundle, 'utf8'),
            },
            preflightSql: {
                path: toPosix(path.relative(process.cwd(), report.preflightSqlPath)),
                sha256: sha256(preflightSql),
                bytes: Buffer.byteLength(preflightSql, 'utf8'),
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
            acceptedRiskPackage: {
                path: toPosix(path.relative(process.cwd(), report.acceptedRiskPackagePath)),
                sha256: sha256(acceptedRiskPackage),
                bytes: Buffer.byteLength(acceptedRiskPackage, 'utf8'),
            },
            strictQaAcceptedRiskDryRun: {
                path: toPosix(path.relative(process.cwd(), report.strictQaAcceptedRiskDryRunPath)),
                sha256: sha256(strictQaAcceptedRiskDryRun),
                bytes: Buffer.byteLength(strictQaAcceptedRiskDryRun, 'utf8'),
            },
        },
        checks: report.checks,
        approvalRequired: true,
        closureOptions: [
            'preferred: apply migration 20260703211451 staging-first, verify, then production-second and verify',
            'alternative: explicit Alin accepted risk after fresh read-only evidence, with migration rollback/mitigation follow-up',
        ],
        allowedScope: [
            'Apply or verify migration 20260703211451 only.',
            'Run staging first against mzjyvmlxfpzdfdjzxxyj.',
            'Run production only after staging verification passes, against vkkahxsybhbutszerawz.',
            'Run read-only post-apply verification queries and strict-QA tracker/status refresh.',
        ],
        forbiddenScope: [
            'No supabase db push while older local/remote migration drift remains outside this scope.',
            'No project/table/row/user/storage deletion.',
            'No key rotation or secret printing.',
            'No Cloudflare, Stripe, Google, Resend, Sentry, DNS, Pages or Worker writes.',
            'No email sending, Google event creation, Stripe session creation or final smoke.',
        ],
    };
}

function latestGeneratedPath(folderName: string, fileName: string): string | null {
    const root = path.join(process.cwd(), 'outputs', folderName);
    if (!existsSync(root)) return null;

    const candidates = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, entry.name, fileName))
        .filter((candidate) => existsSync(candidate))
        .sort()
        .reverse();

    return candidates[0] ?? null;
}

function normalizeSql(sql: string): string {
    return sql
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line) => line.replace(/--.*$/u, '').trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
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
