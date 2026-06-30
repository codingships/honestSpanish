import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(file, 'utf8');

describe('operations runbook launch readiness', () => {
    it('keeps CI runtime aligned with package engines and pnpm policy', () => {
        const packageJson = read('package.json');
        const ci = read('.github/workflows/ci.yml');
        const audit = read('scripts/launch/operations-audit.ts');

        for (const snippet of [
            '"node": ">=22.12.0"',
            '"packageManager": "pnpm@10.33.0"',
        ]) {
            expect(packageJson).toContain(snippet);
        }

        expect(ci).toContain("node-version: '22.12.0'");
        expect(ci).not.toContain("node-version: '20.x'");
        expect(ci).toContain('version: 10.33.0');
        expect(ci).toContain('pnpm run launch:no-real-payments');
        expect(ci).toContain('CHECKOUT_ENABLED: "false"');
        expect(ci).toContain('Verify staging checkout is disabled');
        expect(ci).toContain('CLOUDFLARE_PAGES_STAGING_URL');
        expect(ci).toContain('--deployed-url "$STAGING_PAGES_URL"');
        expect(audit).toContain("node-version: '22.12.0'");
        expect(audit).toContain('pnpm run launch:no-real-payments');
        expect(audit).toContain('Verify staging checkout is disabled');
    });

    it('keeps the Git worktree audit wired to cleanup guidance and commit packages', () => {
        const packageJson = read('package.json');
        const script = read('scripts/launch/worktree-audit.ts');
        const phaseOne = read('scripts/launch/phase-one.ts');
        const cleanup = read('docs/launch/CLEANUP.md');
        const worktreePlan = read('docs/launch/GIT_WORKTREE_PLAN.md');

        expect(packageJson).toContain('launch:worktree');
        expect(packageJson).toContain('scripts/launch/worktree-audit.ts');

        for (const snippet of [
            'git status',
            'outputs/launch-worktree',
            'worktree-inventory.md',
            'commit-package-plan.md',
            'package-file-lists',
            'rc-staging-package.md',
            'rc-staging-package-files.txt',
            'rc-staging-runtime-diff.patch',
            'rc-staging-runtime-manifest.json',
            'does not stage, commit, delete, move',
            'local/generated/secret-prone path should not be staged',
            'Base de launch y limpieza historica',
            'Superficie publica, SEO y conversion',
            'CRM, solicitudes y diagnostico de nivel',
            'Emails, soporte y onboarding',
            'Pagos bloqueados y Worker fulfillment',
            'Calendario, profesores y campus',
            'Dependencias, configuracion y CI',
            'Herramientas de agente',
            'RC Freeze Preconditions',
            'database_readiness',
            'operations_external',
            'no_real_payments_staging',
            'A local-only guard is not enough evidence',
            '403 Checkout is disabled',
            'RC No-Real-Payments Staging Slice',
            'RC Staging Package',
            'rcStagingPackagePath',
            'rcStagingPackageFilesPath',
            'rcStagingRuntimeDiffPath',
            'rcStagingRuntimeManifestPath',
            'packageFileListsDir',
            'fileListPath',
            'writePackageFileLists',
            'renderPackageFileList',
            '| Items | Package | File list | Validation |',
            'renderRcStagingPackage',
            'renderRcStagingPackageFiles',
            'renderRcStagingRuntimeDiff',
            'buildRcStagingRuntimeManifest',
            'sha256',
            'Working tree guard ready',
            'Current HEAD guard ready',
            'rcNoRealPaymentsSlice',
            'requiredForStagingDeploy',
            'src/pages/api/create-checkout.ts',
            'src/lib/runtime-env.ts',
            'wrangler.toml',
            'source control is not enough evidence for future staging deploys',
            'Current staging may already be verified separately',
            'Review-only; it does not stage, commit, deploy, apply, move or delete anything.',
            'machine-readable hashes and guard-snippet status',
            'workingTreeGuardReady',
            'headGuardReady',
            'do not apply it blindly or treat it as approval to deploy',
        ]) {
            expect(script).toContain(snippet);
        }

        for (const snippet of [
            'corepack pnpm launch:worktree',
            'outputs/launch-worktree/<timestamp>/',
            'summary.json',
            'summary.md',
            'worktree-inventory.md',
            'commit-package-plan.md',
            'package-file-lists/',
            'rc-staging-package.md',
            'rc-staging-package-files.txt',
            'rc-staging-runtime-diff.patch',
            'rc-staging-runtime-manifest.json',
            'Precondiciones Para Congelar RC',
            'database_readiness',
            'operations_external',
            'Slice Minimo RC Sin Cobros Reales',
            'src/pages/api/create-checkout.ts',
            'src/lib/runtime-env.ts',
            'wrangler.toml',
            'local_deployment_gap',
            'no tratar `CHECKOUT_ENABLED=false` como arreglo suficiente por si solo',
            'empaquetar/commitear o desplegar exactamente los archivos',
            'compara working tree contra `HEAD`',
            'lista plana',
            'diff review-only',
            'hashes',
            'no_real_payments_staging',
            '403 Checkout is disabled',
            '400 priceId is required',
            'Este plan no autoriza writes externos ni final-only',
            'No mezclar herramientas de agente con commits de runtime/producto',
            'Estado `WARNING` es normal si hay cambios pendientes',
            'listas planas de revision por paquete',
            '`fileListPath` por paquete',
        ]) {
            expect(worktreePlan).toContain(snippet);
        }

        expect(cleanup).toContain('corepack pnpm launch:worktree');
        expect(cleanup).toContain('sin hacer staging ni borrar nada');
        expect(phaseOne).toContain("script: 'launch:worktree'");
        expect(phaseOne).toContain("script: 'launch:staging-db-rollout'");
        expect(phaseOne).toContain('Git worktree hygiene');
    });

    it('keeps local Pages build artifacts from becoming normalized deploy evidence', () => {
        const audit = read('scripts/launch/cleanup-audit.ts');
        const cleanup = read('docs/launch/CLEANUP.md');
        const noRealPayments = read('docs/launch/NO_REAL_PAYMENTS.md');
        const gitignore = read('.gitignore');

        for (const snippet of [
            'reviewBuildArtifactSafety',
            'local Pages build artifact safety',
            'buildOutputPresent',
            'localEnvFiles',
            '.dev.vars',
            'delete `dist/`',
            'sanitized env',
            'launch:staging-no-real-payments-remediation',
        ]) {
            expect(audit).toContain(snippet);
        }

        for (const snippet of [
            '.dev.vars',
            'dist/',
            'sanitized env',
            'delete `dist/`',
            'readyForStagingDeployPackage=true',
            'corepack pnpm secrets:check',
            'pnpm launch:cleanup',
        ]) {
            expect(cleanup).toContain(snippet);
            expect(noRealPayments).toContain(snippet);
        }

        expect(gitignore).toContain('.dev.vars');
        expect(gitignore).toContain('dist');
    });

    it('keeps operations external closure tied to read-only staging evidence and manual gaps', () => {
        const packageJson = read('package.json');
        const closure = read('scripts/launch/operations-external-closure.ts');
        const refreshGuide = read('docs/launch/RC_EVIDENCE_REFRESH.md');
        const manualRunbook = read('docs/launch/MANUAL_EVIDENCE_RUNBOOK.md');
        const manualAudit = read('scripts/launch/manual-evidence-audit.ts');
        const manualEvidenceDoc = read('docs/launch/MANUAL_EVIDENCE.md');

        expect(packageJson).toContain('launch:operations-external-closure');
        expect(packageJson).toContain('scripts/launch/operations-external-closure.ts');
        expect(packageJson).toContain('launch:resend-readonly');
        expect(packageJson).toContain('scripts/launch/resend-readonly-evidence.ts');
        expect(read('scripts/launch/status.ts')).toContain('launch-operations-external-closure');
        expect(read('scripts/launch/status.ts')).toContain('Operations External Closure');
        expect(read('scripts/launch/status.ts')).toContain('operations external evidence manifest');
        expect(read('scripts/launch/status.ts')).toContain('Operations External Evidence Manifest');

        for (const snippet of [
            'launch-staging-operations-preflight',
            'worker_health',
            'internal_route_auth',
            'worker_cron_config',
            'wrangler_whoami',
            'wrangler_deployments_status',
            'wrangler_version_view',
            'wrangler_deployments_list',
            'wrangler_secret_list',
            'Workers Logs/observability is visible for staging',
            'cron config, staging deployment and secret-name evidence are already covered by the staging preflight',
            'Resend staging delivery/suppression',
            'resend_readonly_evidence',
            'launch:resend-readonly',
            'resend-readonly-evidence',
            'Resend read-only domain/log/email visibility without private payloads',
            'Admin Jobs recovery evidence against staging UI/runtime',
            '`database_readiness` is an upstream dependency for Admin Jobs staging UI/runtime',
            'after the staging DB is ready',
            'explicitly accepted RC substitute',
            'closureDependencies',
            'admin_jobs_recovery_source_evidence',
            'Admin Jobs recovery UI/API/tests cover read, process_due, retry, cancel and audit evidence before staging review.',
            'staging_note=This proves local wiring only; staging UI/runtime visibility still needs non-secret external evidence or an explicit RC substitute.',
            'fulfillment-jobs-manager.test.tsx',
            'loads the recovery table without mutating jobs',
            'posts process_due with the expected safe admin payload',
            'posts retry and cancel with the selected job id',
            'fulfillment_jobs.process_due',
            'fulfillment_job.retry',
            'fulfillment_job.cancel',
            'operations-external-evidence-manifest.json',
            'evidenceManifestPath',
            'renderEvidenceManifest',
            'readyForManualEvidenceReview',
            'sideEffectsRequiringSeparateApproval',
            'structured operations evidence manifest with read-only targets and side-effect gates',
            'approval-request.md',
            'manual-evidence-dry-run.txt',
            'Operations External Evidence Approval Request',
            'Separate approval is required before any side effect',
            'sending a staging test email needs separate explicit approval',
            'any job mutation needs separate explicit approval',
            'Stop if the dashboard/resource is not clearly staging',
            'does not write to Cloudflare, Resend, Supabase, Google',
        ]) {
            expect(closure).toContain(snippet);
        }

        const resendReadonly = read('scripts/launch/resend-readonly-evidence.ts');
        for (const snippet of [
            'new Resend(key)',
            'resend.domains.list',
            'resend.logs.list',
            'resend.emails.list',
            'outputs',
            'resend-readonly-evidence',
            'No API key values are written',
            'No recipient addresses',
            'Domain names are not written by default',
            'does not send email',
            'summary.json',
            'summary.md',
        ]) {
            expect(resendReadonly).toContain(snippet);
        }

        for (const snippet of [
            'launch:operations-external-closure',
            'outputs/launch-operations-external-closure/<timestamp>/operations-external-closure-pack.md',
            'outputs/launch-operations-external-closure/<timestamp>/operations-external-evidence-manifest.json',
            'outputs/launch-operations-external-closure/<timestamp>/approval-request.md',
            'outputs/launch-operations-external-closure/<timestamp>/manual-evidence-dry-run.txt',
            'outputs/resend-readonly-evidence/<timestamp>/summary.md',
            'Usar el `manual-evidence-dry-run.txt` generado por `launch:operations-external-closure`',
        ]) {
            expect(refreshGuide).toContain(snippet);
        }

        expect(manualRunbook).toContain('pnpm launch:operations-external-closure');
        expect(manualRunbook).toContain('pnpm launch:resend-readonly');
        expect(manualRunbook).toContain('outputs/launch-operations-external-closure/<timestamp>/operations-external-evidence-manifest.json');
        expect(manualRunbook).toContain('outputs/resend-readonly-evidence/<timestamp>/summary.md');
        expect(manualAudit).toContain('pnpm launch:operations-external-closure');
        for (const snippet of [
            'Latest manual evidence dry run',
            'latestManualEvidenceDryRunFor',
            'manualEvidenceDryRunOutputTypeFor',
            'launch-operations-external-closure',
            'launch-staging-database-rollout',
            'launch-no-real-payments',
            'manual-evidence-dry-run.txt',
        ]) {
            expect(manualAudit).toContain(snippet);
        }
        expect(manualEvidenceDoc).toContain('Latest manual evidence dry run');
        expect(manualEvidenceDoc).toContain('manual-evidence-dry-run.txt');
        expect(manualEvidenceDoc).toContain('outputs/resend-readonly-evidence/<timestamp>/summary.md');
    });

    it('keeps the RC external closure pack tied to exact staging-only targets', () => {
        const packageJson = read('package.json');
        const rcExternalClosure = read('scripts/launch/rc-external-closure.ts');
        const releaseCandidate = read('scripts/launch/release-candidate.ts');
        const statusScript = read('scripts/launch/status.ts');

        expect(packageJson).toContain('launch:rc-external-closure');
        expect(packageJson).toContain('scripts/launch/rc-external-closure.ts');
        expect(releaseCandidate).toContain("runStep('launch:rc-external-closure')");

        for (const snippet of [
            'launch-rc-external-closure',
            'rc-external-closure-pack.md',
            'approval-request.md',
            'next-approval.md',
            'Next approval',
            'Next Recommended External Approval',
            'firstOpenAction',
            'Execution Checklist After Approval',
            'Stop Conditions',
            'nextApprovalExecutionChecklist',
            'nextApprovalStopConditions',
            'specificApproval',
            'Support pack',
            'Specific approval request',
            'RC Freeze Preconditions',
            'database_readiness',
            'operations_external',
            'no_real_payments_staging',
            '403 Checkout is disabled',
            '400 priceId is required',
            'A local-only guard or uncommitted working-tree change is not enough evidence.',
            'cloudflare_pages_no_real_payments',
            'Cloudflare Pages project espanol-honesto-staging',
            'CHECKOUT_ENABLED=false',
            "latestEvidenceFile('launch-worktree', 'rc-staging-package.md')",
            "latestEvidenceFile('launch-worktree', 'rc-staging-package-files.txt')",
            "latestEvidenceFile('launch-worktree', 'rc-staging-runtime-diff.patch')",
            "latestEvidenceFile('launch-worktree', 'rc-staging-runtime-manifest.json')",
            "latestEvidenceFile('launch-staging-no-real-payments-remediation', 'pages-staging-build-manifest.json')",
            'rc-staging-package-files.txt',
            'rc-staging-runtime-diff.patch',
            'rc-staging-runtime-manifest.json',
            'pages-staging-build-manifest.json',
            'readyForStagingDeployPackage=true',
            'before relying on CHECKOUT_ENABLED=false',
            'If the deployed source lacks the checkout guard',
            'package and redeploy the current Pages code/config first',
            'Confirm the Cloudflare account, Pages project and environment serving the staging URL before any write.',
            'Stop if the deployment source does not contain the checkout guard and you are only changing `CHECKOUT_ENABLED`',
            'Stop if the post-check still returns `400 priceId is required`',
            'Staging write approval required before changing Cloudflare Pages config or redeploying staging.',
            "latestEvidenceFile('launch-staging-no-real-payments-remediation', 'approval-request.md')",
            'supabase_staging_schema_rollout',
            'Supabase project espanol-staging (mzjyvmlxfpzdfdjzxxyj)',
            'Supabase staging write approval required; production Supabase is explicitly excluded from this RC pack.',
            "latestEvidenceFile('launch-staging-database-rollout', 'approval-request.md')",
            'operations_external_evidence',
            'Cloudflare fulfillment Worker staging, Resend staging, Admin Jobs staging UI/runtime',
            'Read-only evidence is preferred; staging write approval is required only before sending a test email, triggering a job or changing config.',
            "latestEvidenceFile('launch-operations-external-closure', 'approval-request.md')",
            "latestEvidenceFile('launch-operations-external-closure', 'operations-external-evidence-manifest.json')",
            'One approval must not be treated as approval for the other scopes.',
            'Forbidden From This Pack',
            'if (failed.length > 0) process.exit(1)',
            'does not deploy, change Cloudflare variables, apply Supabase migrations, send email, call Stripe',
            'This approval does not freeze RC.',
            'This file is not permission by itself. It narrows the consolidated RC external closure pack to one next approval so scopes do not blur together.',
            'After this action is verified, rerun `corepack pnpm launch:rc-external-closure`',
            'Forbidden from this approval: production Supabase writes, production Cloudflare changes, Stripe live mode',
        ]) {
            expect(rcExternalClosure).toContain(snippet);
        }

        for (const snippet of [
            'launch-rc-external-closure',
            'rc external closure pack',
            'RC External Closure',
            'rc external next approval',
            'RC External Next Approval',
            'One-resource approval prompt for the next recommended staging-only external action.',
            'summarizeRcExternalClosureSource',
            'rcExternalClosureFreshnessInputs',
            'STALE:',
            'newer evidence',
            'single RC external closure sheet',
            'next single-resource external approval',
            'Cloudflare checkout blocking, Supabase staging rollout and operations evidence',
            'ultimo rc-staging-package.md',
            'rc-staging-package-files.txt',
            'rc-staging-package.md/rc-staging-package-files.txt',
            'rc-staging-runtime-diff.patch',
            'rc-staging-runtime-manifest.json',
            'pages-staging-build-manifest.json antes de confiar en CHECKOUT_ENABLED=false',
            'empaquetar/redeployar la slice minima antes de confiar en CHECKOUT_ENABLED=false',
            'readyForStagingDeployPackage=true',
        ]) {
            expect(statusScript).toContain(snippet);
        }
    });

    it('keeps the staging database rollout pack tied to current Supabase drift', () => {
        const packageJson = read('package.json');
        const rollout = read('scripts/launch/staging-database-rollout.ts');
        const operationsAudit = read('scripts/launch/operations-audit.ts');
        const refreshGuide = read('docs/launch/RC_EVIDENCE_REFRESH.md');
        const manualRunbook = read('docs/launch/MANUAL_EVIDENCE_RUNBOOK.md');

        expect(packageJson).toContain('launch:staging-db-rollout');
        expect(packageJson).toContain('scripts/launch/staging-database-rollout.ts');
        expect(read('scripts/launch/status.ts')).toContain('launch-staging-database-rollout');
        expect(read('scripts/launch/status.ts')).toContain('Staging Database Rollout');
        expect(read('scripts/launch/phase-one.ts')).toContain("script: 'launch:operations-external-closure'");
        expect(read('scripts/launch/rc-external-closure.ts')).toContain('staging-migration-manifest.json');

        for (const snippet of [
            'espanol-staging',
            'mzjyvmlxfpzdfdjzxxyj',
            'staging-migration-bundle.sql',
            'staging-migration-manifest.json',
            'post-write-hosted-schema-check.sql',
            'approval-request.md',
            'manual-evidence-dry-run.txt',
            'migrationManifestPath',
            'renderMigrationManifest',
            'readyForStagingApproval',
            'forbiddenScope',
            'postWriteChecks',
            'structured migration manifest with sha256/order/forbidden scope',
            'post_verify_sql_coverage',
            'Post-write hosted schema check covers lead, CRM, language, diagnostic, RLS, policy and Data API grant drift.',
            'coverage=critical_missing_count',
            'coverage=rls_policies_privileges',
            'deprecated_supabase_auth_pattern_scan',
            'security_definer_scope_scan',
            'auth.role()',
            'raw_user_meta_data',
            'SECURITY DEFINER',
            'fixed search_path',
            'missing REVOKE ALL FROM',
            'readMigrationBundleSource',
            'escapeRegExp',
            'critical_missing_count',
            'This pack prepares the database side of the no-real-payments RC',
            'It is local-only: it does not connect to Supabase',
            'Do not run against production without a separate explicit production approval',
            'data_api_rls_grants_scan',
            'concrete Data API grant privileges',
            'missingTableGrantPrivileges',
            "'SELECT', 'INSERT', 'UPDATE', 'DELETE'",
            'supabase migration list --db-url <STAGING_DATABASE_URL>',
            'supabase db push --dry-run --db-url <STAGING_DATABASE_URL>',
            'Supabase Staging Write Approval Request',
            'renderManualEvidenceDryRun',
            '--id database_readiness',
            'critical_missing_count=0',
            'Production Supabase is excluded',
            'Stop if `supabase db push --dry-run` wants to apply migrations outside the ordered list',
            'supabase/migrations/018_enrich_leads_for_application.sql',
            'supabase/migrations/019_capture_preferred_package_on_leads.sql',
            'supabase/migrations/020_enforce_profile_role_links.sql',
            'supabase/migrations/20260624163423_add_crm_core.sql',
            'supabase/migrations/20260624185757_add_crm_task_related_entity.sql',
            'supabase/migrations/20260625213116_capture_lead_languages.sql',
            'supabase/migrations/20260625215008_add_lightweight_level_check_to_leads.sql',
        ]) {
            expect(rollout).toContain(snippet);
        }

        for (const snippet of [
            'espanol-staging',
            'mzjyvmlxfpzdfdjzxxyj',
            'launch:staging-db-rollout',
            'outputs/launch-staging-database-rollout/<timestamp>/rollout-plan.md',
            'outputs/launch-staging-database-rollout/<timestamp>/approval-request.md',
            'outputs/launch-staging-database-rollout/<timestamp>/staging-migration-bundle.sql',
            'outputs/launch-staging-database-rollout/<timestamp>/staging-migration-manifest.json',
            'outputs/launch-staging-database-rollout/<timestamp>/manual-evidence-dry-run.txt',
            'supabase db push --dry-run --db-url <STAGING_DATABASE_URL>',
            'Data API',
            'supabase/migrations/018_enrich_leads_for_application.sql',
            'supabase/migrations/019_capture_preferred_package_on_leads.sql',
            'supabase/migrations/020_enforce_profile_role_links.sql',
            'supabase/migrations/20260624163423_add_crm_core.sql',
            'supabase/migrations/20260624185757_add_crm_task_related_entity.sql',
            'supabase/migrations/20260625213116_capture_lead_languages.sql',
            'supabase/migrations/20260625215008_add_lightweight_level_check_to_leads.sql',
        ]) {
            expect(refreshGuide).toContain(snippet);
        }

        expect(operationsAudit).toContain('020_enforce_profile_role_links.sql');
        expect(manualRunbook).toContain('pnpm launch:staging-db-rollout');
        expect(manualRunbook).toContain('outputs/launch-staging-database-rollout/<timestamp>/rollout-plan.md');
        expect(manualRunbook).toContain('outputs/launch-staging-database-rollout/<timestamp>/staging-migration-manifest.json');
    });

    it('keeps the staging operations preflight reproducible and read-only', () => {
        const packageJson = read('package.json');
        const preflight = read('scripts/launch/staging-operations-preflight.ts');
        const refreshGuide = read('docs/launch/RC_EVIDENCE_REFRESH.md');
        const manualRunbook = read('docs/launch/MANUAL_EVIDENCE_RUNBOOK.md');

        for (const snippet of [
            'launch:staging-operations',
            'scripts/launch/staging-operations-preflight.ts',
        ]) {
            expect(packageJson).toContain(snippet);
        }

        for (const snippet of [
            '/health',
            '/internal/jobs/process',
            '--include-wrangler',
            'wrangler deployments status',
            'wrangler versions view',
            'wrangler deployments list',
            'wrangler secret list',
            'extractActiveVersionId',
            'summarizeVersionView',
            'local Worker cron/observability config',
            'does not deploy, rollback, write secrets, tail logs, send email, process jobs or touch Supabase data',
            'outputs/launch-staging-operations-preflight',
        ]) {
            expect(preflight).toContain(snippet);
        }

        for (const snippet of [
            '/health',
            '/internal/jobs/process',
            '--include-wrangler',
            'wrangler deployments status',
            'wrangler versions view',
            'wrangler deployments list',
            'wrangler secret list',
            'version activa y bindings por nombre/tipo',
            'No se leyeron valores de secretos',
            'outputs/launch-staging-operations-preflight',
        ]) {
            expect(refreshGuide).toContain(snippet);
        }

        expect(manualRunbook).toContain('pnpm launch:staging-operations');
        expect(manualRunbook).toContain('outputs/launch-staging-operations-preflight/<timestamp>/summary.md');
    });

    it('keeps an incident and rollback drill in the runbook and operations audit', () => {
        const runbook = read('docs/launch/RUNBOOK.md');
        const audit = read('scripts/launch/operations-audit.ts');

        for (const snippet of [
            'Simulacro De Incidente Y Rollback',
            'Escenario Minimo RC',
            'Escenario De Rollback Tabletop',
            'Criterio De Cierre Del Simulacro',
            'fulfillment_job',
            'Admin > Jobs',
            'Admin > Tickets soporte',
            'riskAcceptedBy',
            'pnpm launch:operations',
        ]) {
            expect(runbook).toContain(snippet);
            expect(audit).toContain(snippet);
        }

        for (const snippet of [
            'wrangler deployments status --env staging --json',
            'wrangler secret list --env staging',
        ]) {
            expect(audit).toContain(snippet);
        }

        expect(audit).toContain('incident and rollback drill');
        expect(audit).toContain('no secrets or private data');
    });

    it('keeps a Sentry and observability alert policy wired into operations audit', () => {
        const observability = read('docs/launch/OBSERVABILITY.md');
        const audit = read('scripts/launch/operations-audit.ts');
        const checklist = read('docs/launch/CHECKLIST.md');

        for (const snippet of [
            'Observability And Alerts',
            'Sentry es para excepciones tecnicas',
            'Alertas Minimas Sentry',
            'New production issue',
            'Regressed issue',
            'Spike de errores',
            'Stripe/webhook',
            'Fulfillment/cron',
            'Support alert failure',
            'Privacy/scrubbing',
            'Fallback Sin Sentry Completo',
            'riskAcceptedBy',
            'pnpm launch:operations',
        ]) {
            expect(observability).toContain(snippet);
            expect(audit).toContain(snippet);
        }

        expect(checklist).toContain('docs/launch/OBSERVABILITY.md');
        expect(checklist).toContain('dashboard real');
    });

    it('keeps Supabase Free backup and restore guidance wired into operations audit', () => {
        const backupRunbook = read('docs/launch/SUPABASE_BACKUP_RUNBOOK.md');
        const audit = read('scripts/launch/operations-audit.ts');
        const statusScript = read('scripts/launch/status.ts');
        const finalClosure = read('docs/launch/FINAL_CLOSURE.md');
        const backlog = read('docs/launch/POST_LAUNCH_BACKLOG.md');

        for (const snippet of [
            'Supabase Backup Runbook',
            'Supabase Free',
            'Backup logico/manual',
            'Upgrade Pro',
            'accepted_risk',
            'No guardar dumps',
            'pg_dump',
            'pg_restore --list',
            'Restore Drill O Tabletop',
            'database_readiness',
            'pnpm launch:operations',
        ]) {
            expect(backupRunbook).toContain(snippet);
            expect(audit).toContain(snippet);
        }

        for (const snippet of [
            'hosted-schema-drift-worksheet.md',
            'hosted-schema-check.sql',
            'hosted-schema-closure-plan.md',
            'information_schema.columns',
            'pg_policies',
            'relrowsecurity',
            'has_table_privilege',
            'authenticated',
            'service_role',
            'Data API access',
            "'authenticated', 'DELETE'",
            "'service_role', 'DELETE'",
            'leads.current_level',
            'leads.level_check_status',
            'crm_tasks.related_entity_type',
        ]) {
            expect(audit).toContain(snippet);
        }

        expect(finalClosure).toContain('docs/launch/SUPABASE_BACKUP_RUNBOOK.md');
        expect(backlog).toContain('docs/launch/SUPABASE_BACKUP_RUNBOOK.md');
        expect(statusScript).toContain('docs/launch/SUPABASE_BACKUP_RUNBOOK.md');

        const backupStepIndex = statusScript.indexOf('6. Run Supabase backup/export outside the repo');
        const keyRotationStepIndex = statusScript.indexOf('7. Rotate keys only in the final deployment window');

        expect(backupStepIndex).toBeGreaterThan(-1);
        expect(keyRotationStepIndex).toBeGreaterThan(-1);
        expect(backupStepIndex).toBeLessThan(keyRotationStepIndex);
    });

    it('keeps the RC evidence refresh guide focused on current manual evidence instead of stale copied paths', () => {
        const refreshGuide = read('docs/launch/RC_EVIDENCE_REFRESH.md');
        const statusScript = read('scripts/launch/status.ts');

        for (const snippet of [
            'database_readiness',
            'operations_external',
            'no_real_payments_staging',
            '403 Checkout is disabled',
            '400 priceId is required',
            'un guard local o un cambio sin desplegar no basta',
            'Quedan dos checks inmediatos antes de congelar RC',
            'Esta hoja no congela RC por si sola',
            'dejar estas tareas como trabajo inmediato',
            'drift de schema',
            'leads.current_level',
            'leads.level_check_status',
            'outputs/launch-staging-database-rollout/<timestamp>/manual-evidence-dry-run.txt',
            'outputs/launch-staging-database-rollout/<timestamp>/staging-migration-manifest.json',
            'Usar el `manual-evidence-dry-run.txt` generado por `launch:staging-db-rollout`',
            'Usar el `manual-evidence-dry-run.txt` generado por `launch:operations-external-closure`',
            'outputs/launch-operations/<timestamp>/summary.md',
            'outputs/launch-operations/<timestamp>/hosted-schema-drift-worksheet.md',
            'outputs/launch-operations/<timestamp>/hosted-schema-check.sql',
            'outputs/launch-operations/<timestamp>/hosted-schema-closure-plan.md',
            'staging `espanol-staging`',
            'outputs/launch-manual-evidence/<timestamp>/phase-1-closure-pack.md',
            'No marcar `pass`',
            'no se ha hecho',
            'Usar siempre el ultimo `<timestamp>` impreso por cada comando',
        ]) {
            expect(refreshGuide).toContain(snippet);
        }

        expect(statusScript).toContain('database_readiness sigue abierto hasta resolver o verificar migraciones/RLS/backup posture');
        expect(statusScript).toContain('la verificacion externa fresca sigue en operations_external');
        expect(statusScript).toContain('Open the latest staging rollout pack');
        expect(statusScript).toContain('pnpm launch:operations + pnpm launch:staging-db-rollout');
        expect(statusScript).toContain('pnpm launch:operations + pnpm launch:operations-external-closure');
        expect(statusScript).toContain('tables/columns/indexes/RLS/policies/privileges');
        expect(refreshGuide).not.toMatch(/outputs\/launch-(operations|manual-evidence|status)\/20\d{2}-/);
    });

    it('keeps generated final closure pack aligned with the level-check decision', () => {
        const statusScript = read('scripts/launch/status.ts');
        const finalClosure = read('docs/launch/FINAL_CLOSURE.md');

        for (const snippet of [
            'Confirm reviews, Telegram, rich telemetry and definitive level check remain out of launch',
            'Confirm the definitive level check is still postponed',
            'docs/launch/LEVEL_CHECK.md',
            'consent, purpose, retention, access/deletion, rubric',
            'legal review and accessibility/legal reruns',
            'submitted documents, audio, video, private Drive links or level-test personal data',
            'repository, outputs or `.codex-ops`',
        ]) {
            expect(statusScript).toContain(snippet);
        }

        expect(finalClosure).toContain('Decision De Prueba De Nivel');
        expect(finalClosure).toContain('privacidad/consentimiento/retencion/canal de envio');
    });

    it('keeps the final closure pack aligned with the launch marketing plan', () => {
        const statusScript = read('scripts/launch/status.ts');
        const finalClosure = read('docs/launch/FINAL_CLOSURE.md');

        for (const snippet of [
            'docs/launch/LAUNCH_MARKETING_PLAN.md',
            'Launch Marketing Plan',
            'marketing plan parity',
            'Freeze final public copy, prices, legal pages, domain, checkout mode and docs/launch/LAUNCH_MARKETING_PLAN.md',
        ]) {
            expect(statusScript).toContain(snippet);
        }

        for (const snippet of [
            'docs/launch/LAUNCH_MARKETING_PLAN.md',
            'adulto/profesional +30',
            'solicitud de plaza/prueba como accion principal',
            'marketing plan parity',
        ]) {
            expect(finalClosure).toContain(snippet);
        }
    });

    it('keeps the premium Russian font decision final-only and tied to SEO/visual closure', () => {
        const finalClosure = read('docs/launch/FINAL_CLOSURE.md');
        const seoRunbook = read('docs/launch/SEO_LLM_FINAL.md');
        const statusScript = read('scripts/launch/status.ts');
        const manualAudit = read('scripts/launch/manual-evidence-audit.ts');
        const seoAudit = read('scripts/launch/seo-audit.ts');
        const checklist = read('docs/launch/CHECKLIST.md');
        const backlog = read('docs/launch/POST_LAUNCH_BACKLOG.md');

        for (const snippet of [
            'fuente rusa premium',
            'familia oficial con soporte cirilico',
            'mantener el fallback actual',
            'No guardar fuentes comerciales sin licencia',
            '`seo_llm_final`',
            '`final_smoke`',
        ]) {
            expect(finalClosure).toContain(snippet);
        }

        for (const snippet of [
            'Tipografia Rusa Premium',
            'comprar/licenciar la familia oficial con soporte cirilico',
            'mantener el fallback actual',
            'No usar una fuente "parecida"',
            'tipografia rusa premium/fallback',
        ]) {
            expect(seoRunbook).toContain(snippet);
        }

        for (const snippet of [
            'premium Russian font',
            'official Cyrillic-capable family',
            'current fallback',
            'premium Russian font/Cyrillic rendering',
        ]) {
            expect(statusScript).toContain(snippet);
        }

        for (const snippet of [
            'Cyrillic typography final-only coverage',
            'premium Russian typography',
            'official Cyrillic-capable family',
            'current fallback',
            'unlicensed font files',
            'invoices or fiscal data',
        ]) {
            expect(seoAudit).toContain(snippet);
        }

        for (const snippet of [
            'premium Russian/Cyrillic typography',
            'premium Russian font/Cyrillic rendering',
            '`/ru` Cyrillic typography decision recorded',
        ]) {
            expect(manualAudit).toContain(snippet);
        }

        expect(checklist).toContain('fuente rusa premium');
        expect(checklist).toContain('fallback aceptado explicitamente');
        expect(backlog).toContain('Fuente rusa premium');
        expect(backlog).toContain('Final-only');
    });

    it('keeps the Google Calendar account decision explicit before final smoke', () => {
        const calendarRunbook = read('docs/launch/GOOGLE_CALENDAR_ACCOUNT.md');
        const environment = read('docs/launch/ENVIRONMENT.md');
        const finalClosure = read('docs/launch/FINAL_CLOSURE.md');
        const backlog = read('docs/launch/POST_LAUNCH_BACKLOG.md');
        const audit = read('scripts/launch/operations-audit.ts');

        for (const snippet of [
            'Google Calendar Account Decision',
            'GOOGLE_ADMIN_EMAIL',
            'profiles.email',
            'calendar_email',
            'fernandialejandro@gmail.com',
            'sessions.calendar_event_id',
            'sessions.meet_link',
            'Smoke Final',
            'No guardar en el repo',
        ]) {
            expect(calendarRunbook).toContain(snippet);
            expect(audit).toContain(snippet);
        }

        expect(environment).toContain('docs/launch/GOOGLE_CALENDAR_ACCOUNT.md');
        expect(finalClosure).toContain('docs/launch/GOOGLE_CALENDAR_ACCOUNT.md');
        expect(backlog).toContain('docs/launch/GOOGLE_CALENDAR_ACCOUNT.md');
        expect(backlog).toContain('crear `calendar_email`');
    });
});
