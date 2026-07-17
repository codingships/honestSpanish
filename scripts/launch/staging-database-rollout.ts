import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type CheckStatus = 'ok' | 'warning' | 'failed';

interface RolloutCheck {
    status: CheckStatus;
    name: string;
    message: string;
    details?: string[];
}

interface MigrationArtifact {
    order: number;
    file: string;
    sha256: string;
    bytes: number;
    why: string;
}

interface TargetProject {
    name: string;
    ref: string;
    environment: 'staging';
}

interface RolloutReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: 'OK' | 'WARNING' | 'FAILED';
    outputDir: string;
    targetProject: TargetProject;
    migrationBundlePath: string;
    postVerifySqlPath: string | null;
    planPath: string;
    approvalRequestPath: string;
    manualEvidenceDryRunPath: string;
    manifestPath: string;
    migrationManifestPath: string;
    migrations: MigrationArtifact[];
    checks: RolloutCheck[];
}

interface MigrationManifest {
    schemaVersion: 1;
    generatedAt: string;
    targetProject: TargetProject;
    readyForStagingApproval: boolean;
    reportPath: string;
    planPath: string;
    approvalRequestPath: string;
    manualEvidenceDryRunPath: string;
    migrationBundle: {
        path: string;
        sha256: string;
        bytes: number;
    };
    postVerifySql: {
        path: string | null;
        sha256: string | null;
        bytes: number | null;
        required: true;
    };
    migrations: Array<MigrationArtifact & { exists: boolean }>;
    safetyChecks: Array<RolloutCheck & { details: string[] }>;
    requiredPreflight: string[];
    postWriteChecks: string[];
    evidenceRules: string[];
    forbiddenScope: string[];
}

const migrationPlan = [
    {
        file: 'supabase/migrations/018_enrich_leads_for_application.sql',
        why: 'Adds lead fit fields such as current_level, learning_goal, availability and source_path.',
    },
    {
        file: 'supabase/migrations/019_capture_preferred_package_on_leads.sql',
        why: 'Preserves the public package selected before application review.',
    },
    {
        file: 'supabase/migrations/020_enforce_profile_role_links.sql',
        why: 'Keeps student/teacher/profile relationship guards aligned with the current schema.',
    },
    {
        file: 'supabase/migrations/20260624163423_add_crm_core.sql',
        why: 'Creates CRM contacts, opportunities, tasks, activities, consents and lead-to-CRM links.',
    },
    {
        file: 'supabase/migrations/20260624185757_add_crm_task_related_entity.sql',
        why: 'Adds task related-entity fields used by follow-up cleanup and dashboards.',
    },
    {
        file: 'supabase/migrations/20260625213116_capture_lead_languages.sql',
        why: 'Adds language background and Russian-speaker flags for lead fit.',
    },
    {
        file: 'supabase/migrations/20260625215008_add_lightweight_level_check_to_leads.sql',
        why: 'Adds lightweight diagnostic status/context/summary/retention fields and indexes.',
    },
];

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-staging-database-rollout', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const checks: RolloutCheck[] = [];
const migrations = collectMigrations(checks);
const migrationBundlePath = path.join(outputDir, 'staging-migration-bundle.sql');
const manifestPath = path.join(outputDir, 'manifest.json');
const migrationManifestPath = path.join(outputDir, 'staging-migration-manifest.json');
const planPath = path.join(outputDir, 'rollout-plan.md');
const approvalRequestPath = path.join(outputDir, 'approval-request.md');
const manualEvidenceDryRunPath = path.join(outputDir, 'manual-evidence-dry-run.txt');
const latestHostedSchemaCheck = findLatestHostedSchemaCheck();
const postVerifySqlPath = latestHostedSchemaCheck
    ? path.join(outputDir, 'post-write-hosted-schema-check.sql')
    : null;

const migrationBundle = renderMigrationBundle(migrations);
writeFileSync(migrationBundlePath, migrationBundle, 'utf8');

if (latestHostedSchemaCheck && postVerifySqlPath) {
    writeFileSync(postVerifySqlPath, readFileSync(latestHostedSchemaCheck, 'utf8'), 'utf8');
    checks.push({
        status: 'ok',
        name: 'post_verify_sql',
        message: 'Copied the latest hosted schema check SQL into the rollout pack.',
        details: [
            `source=${toPosix(path.relative(process.cwd(), latestHostedSchemaCheck))}`,
            `copy=${toPosix(path.relative(process.cwd(), postVerifySqlPath))}`,
        ],
    });
} else {
    checks.push({
        status: 'warning',
        name: 'post_verify_sql',
        message: 'No hosted schema check SQL was found in outputs; run corepack pnpm launch:operations before remote verification.',
    });
}

checks.push(validateBundleScope(migrations));
checks.push(validateDeprecatedSupabaseAuthPatterns(migrations));
checks.push(validateSecurityDefinerScope(migrations));
checks.push(validateDataApiRlsAndGrants(migrations));
checks.push(validatePostVerifySqlCoverage(postVerifySqlPath));

const failed = checks.filter((check) => check.status === 'failed');
const warnings = checks.filter((check) => check.status === 'warning');
const status = failed.length > 0 ? 'FAILED' : warnings.length > 0 ? 'WARNING' : 'OK';

const report: RolloutReport = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status,
    outputDir,
    targetProject: {
        name: 'espanol-staging',
        ref: 'mzjyvmlxfpzdfdjzxxyj',
        environment: 'staging',
    },
    migrationBundlePath,
    postVerifySqlPath,
    planPath,
    approvalRequestPath,
    manualEvidenceDryRunPath,
    manifestPath,
    migrationManifestPath,
    migrations,
    checks,
};

writeFileSync(manifestPath, JSON.stringify(report, null, 2), 'utf8');
writeFileSync(migrationManifestPath, JSON.stringify(renderMigrationManifest(report, migrationBundle), null, 2), 'utf8');
writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(planPath, renderRolloutPlan(report), 'utf8');
writeFileSync(approvalRequestPath, renderApprovalRequest(report), 'utf8');
writeFileSync(manualEvidenceDryRunPath, renderManualEvidenceDryRun(report), 'utf8');
writeFileSync(path.join(outputDir, 'summary.md'), renderSummary(report), 'utf8');

console.log(`[launch:staging-db-rollout] Status: ${status}`);
console.log(`[launch:staging-db-rollout] Failed: ${failed.length}`);
console.log(`[launch:staging-db-rollout] Warnings: ${warnings.length}`);
console.log(`[launch:staging-db-rollout] Plan: ${planPath}`);
console.log(`[launch:staging-db-rollout] Bundle: ${migrationBundlePath}`);
console.log(`[launch:staging-db-rollout] Migration manifest: ${migrationManifestPath}`);
console.log(`[launch:staging-db-rollout] Approval request: ${approvalRequestPath}`);
console.log(`[launch:staging-db-rollout] Manual evidence dry run: ${manualEvidenceDryRunPath}`);
if (postVerifySqlPath) {
    console.log(`[launch:staging-db-rollout] Post-verify SQL: ${postVerifySqlPath}`);
}

if (failed.length > 0) process.exit(1);

function collectMigrations(checksOut: RolloutCheck[]): MigrationArtifact[] {
    return migrationPlan.map((migration, index) => {
        if (!existsSync(migration.file)) {
            checksOut.push({
                status: 'failed',
                name: 'migration_exists',
                message: 'A required staging rollout migration is missing.',
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
            message: 'Required staging rollout migration exists.',
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

function validateBundleScope(migrationsToValidate: MigrationArtifact[]): RolloutCheck {
    const destructivePatterns: string[] = [];

    for (const migration of migrationsToValidate) {
        if (migration.sha256 === 'missing') continue;
        const content = readFileSync(migration.file, 'utf8');
        const matches = content.match(/\bDROP\s+(TABLE|COLUMN|SCHEMA|DATABASE)\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/gi);
        if (matches) {
            destructivePatterns.push(`${migration.file}: ${Array.from(new Set(matches)).join(', ')}`);
        }
    }

    return {
        status: destructivePatterns.length === 0 ? 'ok' : 'failed',
        name: 'destructive_sql_scan',
        message: destructivePatterns.length === 0
            ? 'The staging rollout bundle does not contain broad destructive SQL patterns.'
            : 'The staging rollout bundle contains broad destructive SQL patterns and needs manual review before any remote write.',
        details: destructivePatterns,
    };
}

function validateDataApiRlsAndGrants(migrationsToValidate: MigrationArtifact[]): RolloutCheck {
    const bundle = readMigrationBundleSource(migrationsToValidate);
    const createdPublicTables = Array.from(bundle.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.([a-z_]+)/gi))
        .map((match) => match[1])
        .filter(Boolean)
        .sort();
    const missing: string[] = [];
    const requiredPrivileges = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];

    for (const table of createdPublicTables) {
        if (!new RegExp(`ALTER\\s+TABLE\\s+public\\.${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i').test(bundle)) {
            missing.push(`public.${table}: missing ENABLE ROW LEVEL SECURITY`);
        }
        if (!new RegExp(`CREATE\\s+POLICY[\\s\\S]+?ON\\s+public\\.${table}`, 'i').test(bundle)) {
            missing.push(`public.${table}: missing policy`);
        }
        const authenticatedMissing = missingTableGrantPrivileges(bundle, table, 'authenticated', requiredPrivileges);
        if (authenticatedMissing.length > 0) {
            missing.push(`public.${table}: missing authenticated grant privileges ${authenticatedMissing.join(', ')}`);
        }
        const serviceRoleMissing = missingTableGrantPrivileges(bundle, table, 'service_role', requiredPrivileges);
        if (serviceRoleMissing.length > 0) {
            missing.push(`public.${table}: missing service_role grant privileges ${serviceRoleMissing.join(', ')}`);
        }
    }

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'data_api_rls_grants_scan',
        message: missing.length === 0
            ? 'New public tables in the staging rollout have explicit RLS, policies and concrete Data API grant privileges.'
            : 'New public tables in the staging rollout are missing RLS, policies or Data API grants.',
        details: missing.length > 0
            ? missing
            : createdPublicTables.map((table) => `public.${table}`),
    };
}

function validateDeprecatedSupabaseAuthPatterns(migrationsToValidate: MigrationArtifact[]): RolloutCheck {
    const bundle = readMigrationBundleSource(migrationsToValidate);
    const forbidden = [
        { label: 'auth.role()', pattern: /\bauth\.role\s*\(/i },
        { label: 'raw_user_meta_data', pattern: /\braw_user_meta_data\b/i },
        { label: 'user_metadata', pattern: /\buser_metadata\b/i },
    ];
    const findings = forbidden
        .filter((item) => item.pattern.test(bundle))
        .map((item) => `forbidden=${item.label}`);

    return {
        status: findings.length === 0 ? 'ok' : 'failed',
        name: 'deprecated_supabase_auth_pattern_scan',
        message: findings.length === 0
            ? 'The staging rollout bundle avoids deprecated or user-editable Supabase auth patterns in RLS/authorization SQL.'
            : 'The staging rollout bundle contains deprecated or user-editable Supabase auth patterns that need review before any remote write.',
        details: findings.length > 0
            ? findings
            : ['no auth.role()', 'no raw_user_meta_data', 'no user_metadata'],
    };
}

function validateSecurityDefinerScope(migrationsToValidate: MigrationArtifact[]): RolloutCheck {
    const bundle = readMigrationBundleSource(migrationsToValidate);
    const definitions = Array.from(bundle.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+((?:[a-z_][a-z0-9_]*\.)?[a-z_][a-z0-9_]*)\s*\([^]*?\$\$;/gi));
    const securityDefiners = definitions.filter((definition) => /SECURITY\s+DEFINER/i.test(definition[0]));
    const issues: string[] = [];

    for (const definition of securityDefiners) {
        const functionName = definition[1];
        const functionSql = definition[0];
        const escapedName = escapeRegExp(functionName);

        if (!functionName.toLowerCase().startsWith('private.')) {
            issues.push(`${functionName}: SECURITY DEFINER function must live outside public/exposed schemas`);
        }
        if (!/SET\s+search_path\s*=/i.test(functionSql)) {
            issues.push(`${functionName}: missing fixed search_path`);
        }

        for (const role of ['public', 'anon', 'authenticated']) {
            const revokePattern = new RegExp(`REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+${escapedName}\\s*\\([^;]*\\)\\s+FROM\\s+${role}\\b`, 'i');
            if (!revokePattern.test(bundle)) {
                issues.push(`${functionName}: missing REVOKE ALL FROM ${role}`);
            }
        }

        const serviceRoleGrantPattern = new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+${escapedName}\\s*\\([^;]*\\)\\s+TO\\s+service_role\\b`, 'i');
        if (!serviceRoleGrantPattern.test(bundle)) {
            issues.push(`${functionName}: missing explicit service_role EXECUTE grant`);
        }
    }

    return {
        status: issues.length === 0 ? 'ok' : 'failed',
        name: 'security_definer_scope_scan',
        message: issues.length === 0
            ? 'Security definer functions in the staging rollout are scoped to private schemas with fixed search_path and explicit grants.'
            : 'Security definer functions in the staging rollout are missing required private-schema, search_path or grant guardrails.',
        details: issues.length > 0
            ? issues
            : securityDefiners.length > 0
                ? securityDefiners.map((definition) => `function=${definition[1]}`)
                : ['no SECURITY DEFINER functions'],
    };
}

function validatePostVerifySqlCoverage(sqlPath: string | null): RolloutCheck {
    if (!sqlPath || !existsSync(sqlPath)) {
        return {
            status: 'warning',
            name: 'post_verify_sql_coverage',
            message: 'Post-write hosted schema check SQL is not available to inspect for coverage.',
            details: ['Run corepack pnpm launch:operations before generating the staging rollout pack.'],
        };
    }

    const source = readFileSync(sqlPath, 'utf8');
    const requiredSnippets = [
        'critical_missing_count',
        'information_schema.columns',
        'pg_indexes',
        'pg_policies',
        'relrowsecurity',
        'has_table_privilege',
        "('public', 'leads', 'current_level'",
        "('public', 'leads', 'preferred_package'",
        "('public', 'leads', 'spoken_languages'",
        "('public', 'leads', 'level_check_status'",
        "('public', 'leads', 'level_check_context'",
        "('public', 'crm_contacts'",
        "('public', 'crm_opportunities'",
        "('public', 'crm_tasks', 'related_entity_type'",
        "('public', 'crm_tasks', 'related_entity_id'",
        "('public', 'crm_tasks_related_entity_idx'",
        'expected_privileges',
        "'authenticated', 'SELECT'",
        "'authenticated', 'DELETE'",
        "'service_role', 'UPDATE'",
        "'service_role', 'DELETE'",
    ];
    const missing = requiredSnippets.filter((snippet) => !source.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'post_verify_sql_coverage',
        message: missing.length === 0
            ? 'Post-write hosted schema check covers lead, CRM, language, diagnostic, RLS, policy and Data API grant drift.'
            : 'Post-write hosted schema check is missing launch-critical drift coverage.',
        details: missing.length > 0
            ? missing.map((snippet) => `missing=${snippet}`)
            : [
                'coverage=critical_missing_count',
                'coverage=lead_enrichment_and_language_fields',
                'coverage=lightweight_level_check_fields',
                'coverage=crm_tables_and_task_related_entity_fields',
                'coverage=rls_policies_privileges',
            ],
    };
}

function missingTableGrantPrivileges(
    bundle: string,
    table: string,
    role: 'authenticated' | 'service_role',
    requiredPrivileges: string[],
): string[] {
    const escapedTable = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const granted = new Set<string>();

    for (const statement of bundle.split(';')) {
        const match = statement.match(new RegExp(`GRANT\\s+([\\s\\S]+?)\\s+ON\\s+TABLE\\s+([\\s\\S]+?)\\s+TO\\s+${role}\\b`, 'i'));
        if (!match) continue;

        const privileges = match[1]
            .split(',')
            .map((privilege) => privilege.trim().toUpperCase())
            .filter(Boolean);
        const tables = match[2]
            .split(',')
            .map((tableName) => tableName.trim().replace(/\s+/g, ' '))
            .filter(Boolean);

        if (!tables.some((tableName) => new RegExp(`^public\\.${escapedTable}\\b`, 'i').test(tableName))) {
            continue;
        }

        if (privileges.includes('ALL') || privileges.includes('ALL PRIVILEGES')) {
            requiredPrivileges.forEach((privilege) => granted.add(privilege));
            continue;
        }

        privileges.forEach((privilege) => granted.add(privilege));
    }

    return requiredPrivileges.filter((privilege) => !granted.has(privilege));
}

function renderMigrationBundle(migrationsToRender: MigrationArtifact[]): string {
    const lines = [
        '-- Espanol Honesto staging database rollout bundle.',
        '-- Generated locally for review. This file does not apply itself and does not authorize a remote write.',
        '-- Preferred path: apply committed migrations in order with migration tooling against the explicit staging project.',
        '-- Fallback path: use this bundle only after confirming migration history impact and staging target.',
        '-- Target staging project: espanol-staging (mzjyvmlxfpzdfdjzxxyj).',
        '-- Do not run against production without a separate explicit production approval and backup posture decision.',
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

function renderRolloutPlan(report: RolloutReport): string {
    const bundlePath = toPosix(path.relative(process.cwd(), report.migrationBundlePath));
    const migrationManifestPathRelative = toPosix(path.relative(process.cwd(), report.migrationManifestPath));
    const verifyPath = report.postVerifySqlPath
        ? toPosix(path.relative(process.cwd(), report.postVerifySqlPath))
        : 'run `corepack pnpm launch:operations` to generate hosted schema check SQL';

    const lines = [
        '# Staging Database Rollout Pack',
        '',
        `- Status: ${report.status}`,
        `- Generated: ${report.endedAt}`,
        `- Target: ${report.targetProject.name} (${report.targetProject.ref})`,
        `- Bundle: ${bundlePath}`,
        `- Migration manifest: ${migrationManifestPathRelative}`,
        `- Post-write verification SQL: ${verifyPath}`,
        `- Manual evidence dry run: ${toPosix(path.relative(process.cwd(), report.manualEvidenceDryRunPath))}`,
        '',
        '## Scope',
        '',
        'This pack prepares the database side of the no-real-payments RC. It is local-only: it does not connect to Supabase, does not apply SQL and does not authorize a remote write.',
        '',
        '## Guardrails',
        '',
        '- Staging first: only `espanol-staging` (`mzjyvmlxfpzdfdjzxxyj`) is in scope for the first write window.',
        '- Production remains later and needs separate explicit approval plus backup/export, Pro upgrade or accepted risk.',
        '- Do not paste database URLs, passwords, service role keys, JWTs, private rows, dumps or screenshots with personal data into the repo, outputs or manual evidence.',
        '- Prefer complete committed migrations in order so schema history and actual objects stay explainable.',
        '- Use the SQL bundle only as a fallback when migration tooling is unavailable and the migration-history impact is explicitly accepted.',
        '- For Supabase Data API compatibility, new public tables must have explicit grants plus RLS and policies; this pack scans the bundle for that before any write.',
        '- Any `SECURITY DEFINER` function must stay outside exposed schemas, pin `search_path`, revoke public/anon/authenticated execution and grant only the intended internal role.',
        '- RLS/authorization SQL must avoid deprecated `auth.role()` checks and user-editable metadata such as `raw_user_meta_data` / `user_metadata`.',
        '',
        '## Preferred Staging Route',
        '',
        '1. Run `corepack pnpm launch:operations` and use its hosted schema SQL for a read-only preflight against staging.',
        '2. Confirm the target project in the dashboard before any write: `espanol-staging` / `mzjyvmlxfpzdfdjzxxyj`.',
        '3. Run `supabase migration list --db-url <STAGING_DATABASE_URL>` or inspect dashboard migration history without storing the connection URL. Stop if the remote history is not explainable.',
        '4. If using CLI deployment, run `supabase db push --dry-run --db-url <STAGING_DATABASE_URL>` first. Stop unless the dry run matches exactly the intended staging migration set.',
        '5. Apply or verify the committed migrations below in order with Supabase migration tooling or a controlled SQL editor session using credentials managed outside this repo.',
        '6. Rerun the hosted schema check SQL and confirm missing critical metadata is `0`.',
        '7. Exercise staging flows that depend on the schema: lead application, CRM admin, level diagnostic, commercial email mock/staging and onboarding post-payment mock/staging.',
        '8. Record only aggregate, non-secret evidence in `docs/launch/MANUAL_EVIDENCE.local.json`.',
        '',
        '## Stop Conditions',
        '',
        '- Stop if the dashboard target is not `espanol-staging` / `mzjyvmlxfpzdfdjzxxyj`.',
        '- Stop if `supabase db push --dry-run` wants to apply migrations outside the ordered list in this pack.',
        '- Stop if the hosted schema check still reports missing critical metadata after staging write.',
        '- Stop if RLS, policies or grants are missing for the CRM tables after write.',
        '- Stop if a `SECURITY DEFINER` function is exposed from `public`, lacks a fixed `search_path`, or has broad execute grants.',
        '- Stop if any command output contains secrets or private rows; rerun with redaction and do not store that output.',
        '',
        '## Migration Order',
        '',
        '| Order | Migration | sha256 | Why |',
        '| ---: | --- | --- | --- |',
    ];

    for (const migration of report.migrations) {
        lines.push(`| ${migration.order} | \`${migration.file}\` | \`${migration.sha256}\` | ${escapeCell(migration.why)} |`);
    }

    lines.push(
        '',
        '## Fallback SQL Bundle',
        '',
        `The generated fallback bundle is \`${bundlePath}\`. It concatenates the migrations above without changing their SQL. Use it only if applying migrations through proper migration tooling is not feasible for staging.`,
        '',
        '## Structured Migration Manifest',
        '',
        `Review \`${migrationManifestPathRelative}\` before asking for approval. It contains the target project, migration hashes, bundle hash, required preflight, forbidden scope, post-write checks and evidence rules in machine-readable form.`,
        '',
        '## Post-Write Evidence Shape',
        '',
        `Use \`${toPosix(path.relative(process.cwd(), report.manualEvidenceDryRunPath))}\` as the concrete dry-run command. It is not proof by itself: replace the placeholder note with real non-secret staging results before adding \`--write\`.`,
        '',
        '## Checks',
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
    );

    for (const check of report.checks) {
        lines.push(`| ${check.status} | ${check.name} | ${escapeCell(check.message)} | ${escapeCell((check.details ?? []).join(' / '))} |`);
    }

    lines.push('');
    return `${lines.join('\n')}\n`;
}

function renderApprovalRequest(report: RolloutReport): string {
    const planPathRelative = toPosix(path.relative(process.cwd(), report.planPath));
    const bundlePathRelative = toPosix(path.relative(process.cwd(), report.migrationBundlePath));
    const migrationManifestPathRelative = toPosix(path.relative(process.cwd(), report.migrationManifestPath));
    const verifyPath = report.postVerifySqlPath
        ? toPosix(path.relative(process.cwd(), report.postVerifySqlPath))
        : 'run corepack pnpm launch:operations first';
    const migrationList = report.migrations.map((migration) => `  - ${migration.file}`).join('\n');

    return `${[
        '# Supabase Staging Write Approval Request',
        '',
        'Use this text when asking for explicit permission to touch Supabase staging. This file is not permission by itself.',
        '',
        'Requested scope:',
        '',
        '- Target: Supabase project `espanol-staging` (`mzjyvmlxfpzdfdjzxxyj`).',
        '- Environment: staging only.',
        '- Production Supabase is excluded and needs separate explicit approval plus backup/export, Pro upgrade or accepted risk.',
        '- Secrets, database URLs, service role keys, JWTs, private rows, dumps and screenshots with personal data must not be stored in this repo, outputs or manual evidence.',
        '',
        'Preflight before any write:',
        '',
        '- Confirm the dashboard target is exactly `espanol-staging` / `mzjyvmlxfpzdfdjzxxyj`.',
        `- Review \`${planPathRelative}\`, \`${migrationManifestPathRelative}\` and \`${bundlePathRelative}\`.`,
        '- Run or inspect migration history with `supabase migration list --db-url <STAGING_DATABASE_URL>` or the Supabase dashboard, keeping the URL outside the repo.',
        '- If using CLI deployment, run `supabase db push --dry-run --db-url <STAGING_DATABASE_URL>` first and stop unless the dry run matches exactly this migration set:',
        migrationList,
        `- Run the hosted metadata check from \`${verifyPath}\` before write and record only aggregate missing counts.`,
        '',
        'Allowed staging action after explicit approval:',
        '',
        '- Apply or verify the listed committed migrations in order against `espanol-staging`.',
        '- Prefer migration tooling when migration history is explainable.',
        '- Use the generated SQL bundle only as fallback if migration tooling is unavailable and the migration-history impact is explicitly accepted.',
        '',
        'Post-checks:',
        '',
        '- Rerun the hosted metadata check and require critical missing metadata count `0`.',
        '- Confirm CRM tables have RLS enabled, admin policies present and explicit `authenticated`/`service_role` grants where needed for the Data API/client usage.',
        '- Exercise staging lead application, CRM admin, level diagnostic, transactional email mock/staging and onboarding mock/staging paths.',
        '- Record only non-secret evidence: target project/ref, timestamp, migration versions applied/verified, hosted schema check output path, critical_missing_count and staging flow result.',
        '',
        'Forbidden from this approval:',
        '',
        '- Production migrations or Supabase writes.',
        '- Backup/export changes beyond documenting final-only posture.',
        '- Stripe live, real checkout enablement, legal real data, final secrets, domain/Search Console changes or production smoke.',
        '',
    ].join('\n')}\n`;
}

function renderSummary(report: RolloutReport): string {
    const lines = [
        '# Staging Database Rollout Summary',
        '',
        `- Status: ${report.status}`,
        `- Target: ${report.targetProject.name} (${report.targetProject.ref})`,
        `- Plan: ${toPosix(path.relative(process.cwd(), report.planPath))}`,
        `- Approval request: ${toPosix(path.relative(process.cwd(), report.approvalRequestPath))}`,
        `- Bundle: ${toPosix(path.relative(process.cwd(), report.migrationBundlePath))}`,
        `- Migration manifest: ${toPosix(path.relative(process.cwd(), report.migrationManifestPath))}`,
        `- Post-write verification SQL: ${report.postVerifySqlPath ? toPosix(path.relative(process.cwd(), report.postVerifySqlPath)) : 'not copied; run launch:operations first'}`,
        `- Manual evidence dry run: ${toPosix(path.relative(process.cwd(), report.manualEvidenceDryRunPath))}`,
        '',
        'This is a local preparation artifact. It does not write to Supabase.',
        '',
        '## Checks',
        '',
        '| Status | Check | Message |',
        '| --- | --- | --- |',
    ];

    for (const check of report.checks) {
        lines.push(`| ${check.status} | ${check.name} | ${escapeCell(check.message)} |`);
    }

    lines.push('');
    return `${lines.join('\n')}\n`;
}

function renderManualEvidenceDryRun(report: RolloutReport): string {
    const plan = `../../${toPosix(path.relative(process.cwd(), report.planPath))}`;
    const postVerify = report.postVerifySqlPath
        ? `../../${toPosix(path.relative(process.cwd(), report.postVerifySqlPath))}`
        : '../../outputs/launch-operations/<timestamp>/hosted-schema-check.sql';
    const manifest = `../../${toPosix(path.relative(process.cwd(), report.manifestPath))}`;
    const migrationManifest = `../../${toPosix(path.relative(process.cwd(), report.migrationManifestPath))}`;

    const commandLines = [
        'corepack pnpm launch:manual-evidence:record --',
        '  --id database_readiness',
        '  --status pass',
        '  --summary "Supabase staging schema drift closed for RC; hosted schema check passed with critical missing metadata count 0; staging lead/CRM/level-check data flow verified; production remains separate until explicit production approval and backup posture decision."',
        '  --environment "staging database, production final/separate"',
        '  --owner Alin',
        `  --evidence "command_output=${plan}::staging database rollout pack reviewed"`,
        `  --evidence "command_output=${postVerify}::hosted schema check rerun after staging migration"`,
        `  --evidence "command_output=${migrationManifest}::structured migration manifest with sha256/order/forbidden scope"`,
        `  --evidence "command_output=${manifest}::rollout summary manifest"`,
        '  --evidence "manual_note=Replace with concrete non-secret result: target espanol-staging/mzjyvmlxfpzdfdjzxxyj confirmed; migration versions applied or already present; critical_missing_count=0; RLS/policies/grants reviewed; safe staging lead/CRM/level-check flow verified; no private rows or secrets recorded."',
    ];

    return `${commandLines.join(' \\\n')}\n\n# Add --write only after reviewing the dry run output and replacing the placeholder manual_note.\n`;
}

function findLatestHostedSchemaCheck(): string | null {
    const root = path.join(process.cwd(), 'outputs', 'launch-operations');
    if (!existsSync(root)) return null;

    const directories = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, entry.name))
        .sort((a, b) => b.localeCompare(a));

    for (const directory of directories) {
        const candidate = path.join(directory, 'hosted-schema-check.sql');
        if (existsSync(candidate)) return candidate;
    }

    return null;
}

function renderMigrationManifest(report: RolloutReport, migrationBundleContent: string): MigrationManifest {
    const postVerifyContent = report.postVerifySqlPath
        ? readFileSync(report.postVerifySqlPath, 'utf8')
        : null;

    return {
        schemaVersion: 1,
        generatedAt: report.endedAt,
        targetProject: report.targetProject,
        readyForStagingApproval: report.status !== 'FAILED',
        reportPath: toPosix(path.relative(process.cwd(), report.manifestPath)),
        planPath: toPosix(path.relative(process.cwd(), report.planPath)),
        approvalRequestPath: toPosix(path.relative(process.cwd(), report.approvalRequestPath)),
        manualEvidenceDryRunPath: toPosix(path.relative(process.cwd(), report.manualEvidenceDryRunPath)),
        migrationBundle: {
            path: toPosix(path.relative(process.cwd(), report.migrationBundlePath)),
            sha256: sha256(migrationBundleContent),
            bytes: Buffer.byteLength(migrationBundleContent, 'utf8'),
        },
        postVerifySql: {
            path: report.postVerifySqlPath ? toPosix(path.relative(process.cwd(), report.postVerifySqlPath)) : null,
            sha256: postVerifyContent ? sha256(postVerifyContent) : null,
            bytes: postVerifyContent ? Buffer.byteLength(postVerifyContent, 'utf8') : null,
            required: true,
        },
        migrations: report.migrations.map((migration) => ({
            ...migration,
            exists: migration.sha256 !== 'missing',
        })),
        safetyChecks: report.checks.map((check) => ({
            ...check,
            details: check.details ?? [],
        })),
        requiredPreflight: [
            'Confirm the dashboard target is exactly espanol-staging / mzjyvmlxfpzdfdjzxxyj.',
            'Run or inspect migration history without storing database URLs or secret values in the repo.',
            'Run supabase db push --dry-run --db-url <STAGING_DATABASE_URL> if using CLI deployment, then stop unless the dry run matches this manifest exactly.',
            'Confirm the hosted schema check SQL is available and contains only metadata reads before recording evidence.',
            'Confirm the bundle has no deprecated auth.role() checks, user-editable metadata authorization, or unsafe SECURITY DEFINER exposure.',
        ],
        postWriteChecks: [
            'Rerun the hosted schema check SQL against staging and require critical_missing_count=0.',
            'Confirm public CRM/lead diagnostic tables have RLS, policies and explicit Data API grants where needed.',
            'Confirm any SECURITY DEFINER function remains in a private schema with fixed search_path and restricted execution grants.',
            'Exercise staging lead application, CRM admin, lightweight level diagnostic, email mock/staging and onboarding mock/staging flows.',
            'Rerun corepack pnpm launch:operations, corepack pnpm launch:phase1 and corepack pnpm launch:status.',
        ],
        evidenceRules: [
            'Record only target project/ref, timestamp, migration versions applied or already present, aggregate metadata counts and local output paths.',
            'Do not store database URLs, passwords, service role keys, JWTs, private rows, dumps, screenshots with personal data or email payloads.',
            'Replace placeholder manual notes before adding --write to manual evidence.',
        ],
        forbiddenScope: [
            'Production Supabase writes or migrations.',
            'Backup/export changes beyond documenting final-only posture.',
            'Stripe live mode, real checkout enablement or payment acceptance.',
            'Real legal data, final secrets, domain/Search Console changes or production smoke.',
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

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
