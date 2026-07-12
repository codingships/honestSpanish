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
        expect(ci).toContain('CLOUDFLARE_ENV');
        expect(ci).toContain('deploy-built-worker.ts --environment "$CLOUDFLARE_ENV" --dry-run');
        expect(ci).toContain('run: pnpm run deploy');
        expect(ci).not.toContain('pnpm run deploy -- --dry-run');
        expect(ci).toContain('pnpm run build:production:release');
        expect(ci).toContain('Validate inert production Fulfillment bootstrap package');
        expect(ci).toContain('pnpm exec wrangler deploy --config workers/fulfillment/wrangler.toml --env production_bootstrap --dry-run');
        expect(ci).toContain('pnpm exec wrangler deploy --config workers/fulfillment/wrangler.toml --env production --dry-run');
        expect(ci).toContain('pnpm exec wrangler deploy --config workers/fulfillment/wrangler.toml --env staging --keep-vars');
        expect(ci).not.toContain('pnpm exec wrangler deploy --config workers/fulfillment/wrangler.toml --env production --keep-vars');
        expect(ci).toContain('Production CI completed build and dry-runs only.');
        expect(ci).not.toContain('run deploy -- --env');
        expect(ci).toContain('CLOUDFLARE_STAGING_URL');
        expect(ci).toContain('--deployed-url "$STAGING_WORKER_URL"');
        expect(ci).not.toContain('wrangler pages deploy');
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
            'src/lib/checkout-enabled.ts',
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
            'src/lib/checkout-enabled.ts',
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
        const gate = read('scripts/launch/gate.ts');
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
            'capturePagesBuildOutputSnapshot',
            'removePagesBuildOutputGeneratedByVerify',
            'existedBeforeGate',
            'Keeping pre-existing Pages build output',
            'Removed Pages build output generated by launch:verify before phase1 cleanup',
            'rmSync',
        ]) {
            expect(gate).toContain(snippet);
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
        const adminJobsRuntime = read('scripts/launch/admin-jobs-staging-runtime.ts');
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
        expect(adminJobsRuntime).toContain('DEFAULT_WORKER_STAGING_URL');
        expect(adminJobsRuntime).toContain('CLOUDFLARE_WORKERS_STAGING_URL');
        expect(adminJobsRuntime).toContain('https://espanolhonesto-staging.alindev95.workers.dev');
        expect(closure).toContain('defaults to the direct Worker staging URL');
        expect(closure).toContain('only when closing custom-domain staging evidence deliberately');

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
            "readArgValue('--env-file') ?? defaultEnvFile()",
            "return existsSync(path.resolve(process.cwd(), '.env')) ? '.env' : null",
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
            'launch-supabase-security-rollout',
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
        const verify = read('scripts/launch/verify.ts');

        expect(packageJson).toContain('launch:rc-external-closure');
        expect(packageJson).toContain('scripts/launch/rc-external-closure.ts');
        expect(releaseCandidate).toContain("runStep('launch:rc-external-closure')");
        expect(releaseCandidate).toContain('strictQaOpenChecks');
        expect(releaseCandidate).toContain('Strict-QA Open');
        expect(releaseCandidate).toContain('DEFAULT_WORKER_STAGING_URL');
        expect(releaseCandidate).toContain('CLOUDFLARE_WORKERS_STAGING_URL');
        expect(releaseCandidate).toContain('stagingUrl');
        expect(releaseCandidate).toContain('launch:status-post-rc');
        expect(releaseCandidate).toContain('before this RC summary exists');
        expect(releaseCandidate).toContain("step.name.startsWith('launch:status')");
        expect(verify).toContain('release-candidate.ts must render standalone strict-QA blockers');

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
            'cloudflare_worker_no_real_payments',
            'DEFAULT_WORKER_STAGING_URL',
            'noRealPaymentsProbeCommand',
            'CLOUDFLARE_WORKERS_STAGING_URL',
            'Cloudflare Worker espanolhonesto-staging',
            'CHECKOUT_ENABLED=false',
            "latestEvidenceFile('launch-worktree', 'rc-staging-package.md')",
            "latestEvidenceFile('launch-worktree', 'rc-staging-package-files.txt')",
            "latestEvidenceFile('launch-worktree', 'rc-staging-runtime-diff.patch')",
            "latestEvidenceFile('launch-worktree', 'rc-staging-runtime-manifest.json')",
            "latestEvidenceFile('launch-staging-no-real-payments-remediation', 'worker-staging-build-manifest.json')",
            'rc-staging-package-files.txt',
            'rc-staging-runtime-diff.patch',
            'rc-staging-runtime-manifest.json',
            'worker-staging-build-manifest.json',
            'readyForStagingDeployPackage=true',
            'before relying on CHECKOUT_ENABLED=false',
            'If the deployed source lacks the checkout guard',
            'package and redeploy the current Worker code/config first',
            'Confirm the Cloudflare account, Worker and environment serving the staging URL before any write.',
            'Stop if the deployment source does not contain the checkout guard and you are only changing `CHECKOUT_ENABLED`',
            'Stop if the post-check still returns `400 priceId is required`',
            'Staging write approval required before changing Cloudflare Worker config or redeploying staging.',
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
            'CURRENT_FOR_RC_SCOPE',
            'isReleaseCandidateCurrentForScope',
            'newer final-only evidence',
            'newer evidence',
            'single RC external closure sheet',
            'next single-resource external approval',
            'Cloudflare checkout blocking, Supabase staging rollout and operations evidence',
            'ultimo rc-staging-package.md',
            'rc-staging-package-files.txt',
            'rc-staging-package.md/rc-staging-package-files.txt',
            'rc-staging-runtime-diff.patch',
            'rc-staging-runtime-manifest.json',
            'worker-staging-build-manifest.json antes de confiar en CHECKOUT_ENABLED=false',
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
        const statusScript = read('scripts/launch/status.ts');

        expect(packageJson).toContain('launch:staging-db-rollout');
        expect(packageJson).toContain('scripts/launch/staging-database-rollout.ts');
        expect(statusScript).toContain('launch-staging-database-rollout');
        expect(statusScript).toContain('Staging Database Rollout');
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
        expect(statusScript).toContain('pnpm launch:operations + pnpm launch:staging-db-rollout + pnpm launch:supabase-security-rollout');
        expect(statusScript).toContain('Open the latest staging schema rollout pack for CRM/schema drift');
    });

    it('keeps the Supabase security rollout pack narrow and approval-gated', () => {
        const packageJson = read('package.json');
        const rollout = read('scripts/launch/supabase-security-rollout.ts');
        const refreshGuide = read('docs/launch/RC_EVIDENCE_REFRESH.md');
        const manualRunbook = read('docs/launch/MANUAL_EVIDENCE_RUNBOOK.md');
        const manualAudit = read('scripts/launch/manual-evidence-audit.ts');
        const statusScript = read('scripts/launch/status.ts');
        const phaseOne = read('scripts/launch/phase-one.ts');
        const secondaryReview = read('scripts/launch/secondary-review.ts');
        const verify = read('scripts/launch/verify.ts');

        expect(packageJson).toContain('launch:supabase-security-rollout');
        expect(packageJson).toContain('scripts/launch/supabase-security-rollout.ts');

        for (const snippet of [
            'outputs',
            'launch-supabase-security-rollout',
            'espanol-staging',
            'mzjyvmlxfpzdfdjzxxyj',
            'espanol-honesto',
            'vkkahxsybhbutszerawz',
            'supabase/migrations/021_harden_session_write_policies.sql',
            'supabase/migrations/022_track_stripe_webhook_processing_state.sql',
            'supabase/migrations/20260702124757_harden_profile_role_trigger.sql',
            'supabase-security-migration-bundle.sql',
            'supabase-security-rollout-manifest.json',
            'post-apply-verification.sql',
            'rollback.sql',
            'approval-request.md',
            'Exact Approval Sentence',
            'staging first',
            'production only after staging passes',
            'This is local-only. It does not connect to Supabase, does not apply SQL and does not authorize an external write.',
            'No project/table/row/user/storage deletion.',
            'No key rotation or secret printing.',
            'No Cloudflare, Stripe, Google, Resend, Sentry, DNS, Pages or Worker writes.',
        ]) {
            expect(rollout).toContain(snippet);
        }

        for (const snippet of [
            'pnpm launch:supabase-security-rollout',
            'outputs/launch-supabase-security-rollout/<timestamp>/summary.md',
            'outputs/launch-supabase-security-rollout/<timestamp>/supabase-security-rollout-manifest.json',
            'outputs/launch-supabase-security-rollout/<timestamp>/approval-request.md',
            'outputs/launch-supabase-security-rollout/<timestamp>/post-apply-verification.sql',
            'outputs/launch-supabase-security-rollout/<timestamp>/rollback.sql',
            'SEC-014',
            'SEC-015',
        ]) {
            expect(refreshGuide).toContain(snippet);
            expect(manualRunbook).toContain(snippet);
        }

        expect(manualAudit).toContain("case 'security_external':");
        expect(manualAudit).toContain("return 'launch-supabase-security-rollout';");
        expect(statusScript).toContain('SEC-014/SEC-015 security migrations');
        expect(statusScript).toContain('the latest Supabase security rollout pack for migrations 021/022/20260702124757');
        expect(statusScript).toContain('readLatestStrictQaResults');
        expect(statusScript).toContain('strict-qa-results.json');
        expect(statusScript).toContain('collectStrictQaOpenFindings');
        expect(statusScript).toContain('isStrictQaFindingRepresentedByManualEvidence');
        expect(statusScript).toContain('strictQaFindingToBlocker');
        expect(statusScript).toContain('Strict QA Tracker');
        expect(statusScript).toContain('open strict-QA findings block final launch');
        expect(statusScript).toContain('open SEC-* findings block Phase 1 and RC readiness');
        expect(statusScript).toContain('manualEvidenceCoverage');
        expect(statusScript).toContain('Manual Evidence Coverage');
        expect(statusScript).toContain('## Strict-QA Tracker Blockers');
        expect(statusScript).toContain('Strict-QA Open');
        expect(statusScript).toContain('Strict-QA tracker blockers');
        expect(statusScript).toContain('strictQaBlockerClosureRow');
        expect(statusScript).toContain('supabase-processed-at-default-approval-package.md');
        expect(statusScript).toContain('do not treat RC security/database as clear');
        expect(statusScript).toContain('Do not use the strict-QA tracker as a launch-gate freshness input.');
        expect(statusScript).toContain('creating a freshness loop that cannot converge');
        expect(statusScript).toContain('gate-vs-RC stale loop where neither dashboard source can converge');
        expect(statusScript).not.toContain("{ label: 'strict QA tracker', endedAt: strictQaTracker?.endedAt },");
        const gateFreshnessInputs = statusScript.slice(
            statusScript.indexOf('const gateFreshnessInputs'),
            statusScript.indexOf('// Do not use the strict-QA tracker as a launch-gate freshness input.')
        );
        expect(gateFreshnessInputs).toContain("{ label: 'primary verification', endedAt: primary?.data.endedAt }");
        expect(gateFreshnessInputs).toContain("{ label: 'secondary review', endedAt: secondary?.data.endedAt }");
        expect(gateFreshnessInputs).not.toContain("{ label: 'phase 1 gate'");
        expect(gateFreshnessInputs).not.toContain("{ label: 'functional rc'");
        expect(gateFreshnessInputs).not.toContain("{ label: 'operations external closure'");
        expect(gateFreshnessInputs).not.toContain("{ label: 'manual evidence'");
        expect(statusScript).not.toContain('no reabrir checks ya claros como security_external');
        expect(phaseOne).toContain("script: 'launch:supabase-security-rollout'");
        expect(phaseOne).toContain('readLatestStrictQaResults');
        expect(phaseOne).toContain('strict-qa-results.json');
        expect(phaseOne).toContain('collectStrictQaOpenSecurityFindings');
        expect(phaseOne).toContain('canonical strict-QA tracker has open SEC-* findings');
        expect(phaseOne).toContain('exact staging-first external approval');
        expect(secondaryReview).toContain('releaseCandidateReadiness.strictQaOpenChecks');
        expect(secondaryReview).toContain('manualEvidenceCoverage');
        expect(secondaryReview).toContain('summary.md missing Manual Evidence Coverage section');
        expect(secondaryReview).toContain('statusSummaryStrictQaBlockers');
        expect(secondaryReview).toContain('final closure pack missing strict-QA blocker');
        expect(secondaryReview).toContain('supabase-processed-at-default-approval-package.md');
        expect(secondaryReview).toContain('final-only and strict-QA blockers');
        expect(verify).toContain('manualEvidenceCoverage');
        expect(verify).toContain('releaseCandidateReadiness.strictQaOpenChecks');
        expect(verify).toContain('Strict-QA Open');
    });

    it('keeps the Supabase processed_at audit single-migration and retires the legacy write runner', () => {
        const packageJson = read('package.json');
        const cleanup = read('scripts/launch/supabase-processed-at-cleanup.ts');
        const cleanupRunner = read('scripts/launch/supabase-processed-at-cleanup-runner.ts');
        const statusScript = read('scripts/launch/status.ts');

        expect(packageJson).toContain('launch:supabase-processed-at-cleanup');
        expect(packageJson).toContain('scripts/launch/supabase-processed-at-cleanup.ts');
        expect(packageJson).toContain('launch:supabase-processed-at-readonly-preflight');
        expect(packageJson).toContain('scripts/launch/supabase-processed-at-readonly-preflight.ts');
        expect(packageJson).toContain('launch:supabase-processed-at-cleanup-runner');
        expect(packageJson).toContain('scripts/launch/supabase-processed-at-cleanup-runner.ts');

        for (const snippet of [
            'launch-supabase-processed-at-cleanup',
            '20260703211451_drop_processed_webhook_processed_at_default.sql',
            'ALTER TABLE public.processed_webhook_events ALTER COLUMN processed_at DROP DEFAULT;',
            'supabase-processed-at-cleanup-bundle.sql',
            'supabase-processed-at-cleanup-manifest.json',
            'preflight.sql',
            'post-apply-verification.sql',
            'rollback.sql',
            'approval-request.md',
            'accepted-risk-package.md',
            'strict-qa-accepted-risk-dry-run.txt',
            'validateWebhookClaimCodePath',
            'webhook_claim_code_path',
            'src/pages/api/stripe-webhook.ts',
            'claim_processed_at_null=true',
            'success_sets_processed_at=true',
            'failure_clears_processed_at=true',
            'processed_at_small_fix',
            'legacy staging-first approval is retired',
            'source-bound production',
            'Exact Accepted-Risk Sentence',
            'This local file is not acceptance.',
            'status: Accepted Risk',
            'closureOptions',
            'This is local-only. It does not connect to Supabase, does not apply SQL and does not authorize an external write.',
            'Do not use `supabase db push` while older local/remote migration-history drift remains explainable but unresolved.',
            'No supabase db push while older local/remote migration drift remains outside this scope.',
            'No Cloudflare, Stripe, Google, Resend, Sentry, DNS, Pages or Worker writes.',
            'No email sending, Google event creation, Stripe session creation or final smoke.',
            'mzjyvmlxfpzdfdjzxxyj',
            'vkkahxsybhbutszerawz',
        ]) {
            expect(cleanup).toContain(snippet);
        }

        for (const snippet of [
            "latestGeneratedPath('launch-supabase-processed-at-cleanup', 'accepted-risk-package.md')",
            "latestGeneratedPath('launch-supabase-processed-at-cleanup', 'strict-qa-accepted-risk-dry-run.txt')",
            "latestGeneratedPath('supabase-processed-at-readonly-preflight', 'summary.md')",
            'outputs/launch-supabase-production-rollout-runner/<timestamp>/summary.json',
            'outputs/launch-supabase-production-rollout-runner/<timestamp>/wave-processed_at_small_fix-verify-readonly.sql',
            'Supabase Processed At Accepted Risk Package',
            'Supabase Processed At Accepted Risk Dry Run',
            'Supabase Processed At Read-Only Preflight',
            "sourceLabel: 'supabase processed_at read-only preflight'",
            'supabaseProcessedAtReadonlyPreflight',
            'outputs/launch-supabase-processed-at-cleanup/<timestamp>/accepted-risk-package.md',
            'outputs/launch-supabase-processed-at-cleanup/<timestamp>/strict-qa-accepted-risk-dry-run.txt',
            'outputs/supabase-processed-at-readonly-preflight/<timestamp>/summary.md',
            'supabase-processed-at-default-approval-package.md',
            '20260703211451_drop_processed_webhook_processed_at_default.sql',
            'pnpm launch:supabase-production-readonly-preflight',
            'pnpm launch:supabase-production-rollout -- --through processed_at_small_fix',
            'Do not execute the retired legacy cleanup runner',
        ]) {
            expect(statusScript).toContain(snippet);
        }

        for (const snippet of [
            'SUPABASE_PROCESSED_AT_CLEANUP_APPROVAL',
            '--execute-approved',
            'externalWritePerformed=false',
            'PLAN_ONLY_RETIRED',
            'const legacyExecutionRetired = true',
            'if (executeRequested && legacyExecutionRetired)',
            'This legacy runner is permanently fail-closed for external writes.',
            'pnpm launch:supabase-production-rollout -- --through processed_at_small_fix',
            'staging already has migration 20260703211451',
            'SUPABASE_DB_URL',
            '20260703211451_drop_processed_webhook_processed_at_default.sql',
            'ALTER TABLE public.processed_webhook_events ALTER COLUMN processed_at DROP DEFAULT;',
            'No supabase db push',
            'No row/user/Auth/Storage/API-setting changes',
            'No service key or database URL evidence',
            'No Cloudflare, Stripe, Google, Resend, Sentry, Turnstile, DNS, Pages or Worker writes',
            'No email sending, Google event creation, Stripe session creation or final smoke',
            'processed-at-cleanup-command-manifest.json',
            'processed-at-cleanup-execution-plan.md',
            'approval-gate.md',
            'rollback-after-cleanup.md',
            'manual-evidence-after-cleanup.txt',
        ]) {
            expect(cleanupRunner).toContain(snippet);
        }
        expect(cleanupRunner.indexOf('if (executeRequested && legacyExecutionRetired)')).toBeLessThan(
            cleanupRunner.indexOf('checks.push(...runApprovedExecution(captures))'),
        );

        const readonlyPreflight = read('scripts/launch/supabase-processed-at-readonly-preflight.ts');
        for (const snippet of [
            'launch:supabase-processed-at-readonly-preflight',
            'default_transaction_read_only=on',
            'PGCONNECT_TIMEOUT',
            'psql -X -w',
            'processed_at_default',
            'webhook_counts',
            'no database URL or secret values stored',
        ]) {
            expect(readonlyPreflight).toContain(snippet);
        }
    });

    it('keeps the Stripe webhook cutover runner test-mode, URL-only and exact-gated', () => {
        const packageJson = read('package.json');
        const stripePack = read('scripts/launch/stripe-webhook-cutover-pack.ts');
        const stripeRunner = read('scripts/launch/stripe-webhook-cutover-runner.ts');
        const statusScript = read('scripts/launch/status.ts');
        const finalApprovalQueue = read('scripts/launch/final-approval-queue.ts');
        const integrationPackage = read('scripts/launch/integration-final-package.ts');
        const manualEvidenceDoc = read('docs/launch/MANUAL_EVIDENCE.md');
        const manualRunbook = read('docs/launch/MANUAL_EVIDENCE_RUNBOOK.md');

        expect(packageJson).toContain('launch:stripe-webhook-cutover-pack');
        expect(packageJson).toContain('scripts/launch/stripe-webhook-cutover-pack.ts');
        expect(packageJson).toContain('launch:stripe-webhook-cutover-runner');
        expect(packageJson).toContain('scripts/launch/stripe-webhook-cutover-runner.ts');

        for (const snippet of [
            'The exact approval scope is limited to one Stripe test-mode webhook endpoint host change.',
            'https://staging.espanolhonesto.com/api/stripe-webhook',
            'https://espanolhonesto.com/api/stripe-webhook',
            'does not call Stripe',
            'does not create, update, disable or delete Stripe webhook endpoints',
            'does not change products, prices, customers, subscriptions, checkout enablement or Stripe live mode',
            'webhook signing secret',
            'rollback',
        ]) {
            expect(stripePack).toContain(snippet);
        }

        for (const snippet of [
            'STRIPE_WEBHOOK_CUTOVER_APPROVAL',
            'STRIPE_WEBHOOK_ENDPOINT_ID',
            'STRIPE_WEBHOOK_TARGET_URL',
            '--execute-approved',
            'PLAN_ONLY_READY',
            'externalWritePerformed=false',
            'stripeSecretKey.startsWith(\'sk_test_\')',
            'stripeSecretKey.startsWith(\'sk_live_\')',
            'stripe.webhookEndpoints.retrieve',
            'stripe.webhookEndpoints.update',
            'buildExactApprovalSentence',
            'endpoint.livemode === false',
            'stripe-webhook-cutover-command-manifest.json',
            'stripe-webhook-cutover-execution-plan.md',
            'approval-gate.md',
            'rollback-after-webhook-cutover.md',
            'manual-evidence-after-webhook-cutover.txt',
            'No Stripe live mode',
            'No product, price, customer, subscription, invoice, tax, bank/payout or fraud-rule change',
            'No enabled_events change',
            'No webhook signing secret output or storage',
            'No raw Stripe event payload, customer data, payment method data or card data in evidence',
            'No Supabase, Cloudflare, Google, Resend, Sentry, Turnstile, DNS, Pages, Worker or GitHub writes',
        ]) {
            expect(stripeRunner).toContain(snippet);
        }

        for (const snippet of [
            "readLatestJson<CheckBackedSummary>('launch-stripe-webhook-cutover-runner', 'summary.json')",
            "sourceLabel: 'stripe webhook cutover runner'",
            'Stripe Webhook Cutover Runner',
            'stripeWebhookCutoverRunner',
            'stripeWebhookCutoverRunnerPlan',
            'stripeWebhookCutoverRunnerApprovalGate',
            'stripeWebhookCutoverRunnerRollback',
            "latestGeneratedPath('launch-stripe-webhook-cutover-runner', 'summary.md')",
            "latestGeneratedPath('launch-stripe-webhook-cutover-runner', 'stripe-webhook-cutover-execution-plan.md')",
            "latestGeneratedPath('launch-stripe-webhook-cutover-runner', 'approval-gate.md')",
            "latestGeneratedPath('launch-stripe-webhook-cutover-runner', 'rollback-after-webhook-cutover.md')",
        ]) {
            expect(statusScript).toContain(snippet);
        }

        for (const snippet of [
            "latestGeneratedPath('launch-stripe-webhook-cutover-runner', 'summary.md')",
            "latestGeneratedPath('launch-stripe-webhook-cutover-runner', 'stripe-webhook-cutover-command-manifest.json')",
            "latestGeneratedPath('launch-stripe-webhook-cutover-runner', 'stripe-webhook-cutover-execution-plan.md')",
            "latestGeneratedPath('launch-stripe-webhook-cutover-runner', 'approval-gate.md')",
            "latestGeneratedPath('launch-stripe-webhook-cutover-runner', 'rollback-after-webhook-cutover.md')",
            'No Stripe live mode',
            'No product/price/customer/subscription changes',
        ]) {
            expect(finalApprovalQueue).toContain(snippet);
        }

        for (const snippet of [
            'stripe_webhook_cutover_runner',
            'launch:stripe-webhook-cutover-runner',
            'outputs/launch-stripe-webhook-cutover-runner/<timestamp>/summary.md',
            'Plan-only runner that refuses Stripe webhook endpoint URL updates unless test mode',
        ]) {
            expect(integrationPackage).toContain(snippet);
        }

        expect(manualEvidenceDoc).toContain('pnpm launch:stripe-webhook-cutover-runner');
        expect(manualRunbook).toContain('pnpm launch:stripe-webhook-cutover-runner');
        expect(manualRunbook).toContain('outputs/launch-stripe-webhook-cutover-runner/<timestamp>/approval-gate.md');
    });

    it('keeps the Turnstile domain closure runner domains-only and exact-gated', () => {
        const packageJson = read('package.json');
        const turnstilePack = read('scripts/launch/turnstile-domain-closure-pack.ts');
        const turnstileRunner = read('scripts/launch/turnstile-domain-closure-runner.ts');
        const statusScript = read('scripts/launch/status.ts');
        const finalApprovalQueue = read('scripts/launch/final-approval-queue.ts');
        const integrationPackage = read('scripts/launch/integration-final-package.ts');
        const manualEvidenceDoc = read('docs/launch/MANUAL_EVIDENCE.md');
        const manualRunbook = read('docs/launch/MANUAL_EVIDENCE_RUNBOOK.md');

        expect(packageJson).toContain('launch:turnstile-domain-closure-pack');
        expect(packageJson).toContain('scripts/launch/turnstile-domain-closure-pack.ts');
        expect(packageJson).toContain('launch:turnstile-domain-closure-runner');
        expect(packageJson).toContain('scripts/launch/turnstile-domain-closure-runner.ts');

        for (const snippet of [
            'The exact approval scope is limited to the named Turnstile widget/domain review or correction.',
            'espanolhonesto.com',
            'staging.espanolhonesto.com',
            'www.espanolhonesto.com',
            'does not call Cloudflare',
            'does not create, update or delete Turnstile widgets',
            'does not change DNS, Workers, Pages, WAF, secrets or domains',
            'dashboard evidence',
            'rollback',
        ]) {
            expect(turnstilePack).toContain(snippet);
        }

        for (const snippet of [
            'TURNSTILE_DOMAIN_CLOSURE_APPROVAL',
            'TURNSTILE_EXPECTED_DOMAINS',
            'CLOUDFLARE_ACCOUNT_ID',
            'CLOUDFLARE_API_TOKEN',
            'PUBLIC_TURNSTILE_SITE_KEY',
            '--execute-approved',
            'PLAN_ONLY_READY',
            'externalWritePerformed=false',
            'cloudflareRequest',
            'GET',
            'PUT',
            '/challenges/widgets/',
            'buildExactApprovalSentence',
            'validateWidgetBeforeUpdate',
            'turnstile-domain-closure-command-manifest.json',
            'turnstile-domain-closure-execution-plan.md',
            'approval-gate.md',
            'rollback-after-turnstile-domain-closure.md',
            'manual-evidence-after-turnstile-domain-closure.txt',
            'No Turnstile secret key, site key, challenge mode or clearance level change',
            'No Turnstile widget create, delete or secret rotation',
            'No WAF, DNS, Pages, Workers, analytics, logs, API token, account setting or other Cloudflare write',
            'No Cloudflare dashboard screenshot or output containing API tokens, secret keys, private user data or logs',
        ]) {
            expect(turnstileRunner).toContain(snippet);
        }

        for (const snippet of [
            "readLatestJson<CheckBackedSummary>('launch-turnstile-domain-closure-runner', 'summary.json')",
            "sourceLabel: 'turnstile domain closure runner'",
            'Turnstile Domain Closure Runner',
            'turnstileDomainClosureRunner',
            'turnstileDomainClosureRunnerPlan',
            'turnstileDomainClosureRunnerApprovalGate',
            'turnstileDomainClosureRunnerRollback',
            "latestGeneratedPath('launch-turnstile-domain-closure-runner', 'summary.md')",
            "latestGeneratedPath('launch-turnstile-domain-closure-runner', 'turnstile-domain-closure-execution-plan.md')",
            "latestGeneratedPath('launch-turnstile-domain-closure-runner', 'approval-gate.md')",
            "latestGeneratedPath('launch-turnstile-domain-closure-runner', 'rollback-after-turnstile-domain-closure.md')",
        ]) {
            expect(statusScript).toContain(snippet);
        }

        for (const snippet of [
            "latestGeneratedPath('launch-turnstile-domain-closure-runner', 'summary.md')",
            "latestGeneratedPath('launch-turnstile-domain-closure-runner', 'turnstile-domain-closure-command-manifest.json')",
            "latestGeneratedPath('launch-turnstile-domain-closure-runner', 'turnstile-domain-closure-execution-plan.md')",
            "latestGeneratedPath('launch-turnstile-domain-closure-runner', 'approval-gate.md')",
            "latestGeneratedPath('launch-turnstile-domain-closure-runner', 'rollback-after-turnstile-domain-closure.md')",
            'No DNS/domain move',
            'No key rotation unless separately approved',
        ]) {
            expect(finalApprovalQueue).toContain(snippet);
        }

        for (const snippet of [
            'turnstile_domain_closure_runner',
            'launch:turnstile-domain-closure-runner',
            'outputs/launch-turnstile-domain-closure-runner/<timestamp>/summary.md',
            'Plan-only runner that refuses Cloudflare Turnstile widget domain updates unless account',
        ]) {
            expect(integrationPackage).toContain(snippet);
        }

        expect(manualEvidenceDoc).toContain('pnpm launch:turnstile-domain-closure-runner');
        expect(manualRunbook).toContain('pnpm launch:turnstile-domain-closure-runner');
        expect(manualRunbook).toContain('outputs/launch-turnstile-domain-closure-runner/<timestamp>/approval-gate.md');
    });

    it('keeps the Sentry issue triage runner issue-status-only and exact-gated', () => {
        const packageJson = read('package.json');
        const sentryPack = read('scripts/launch/sentry-triage-pack.ts');
        const sentryRunner = read('scripts/launch/sentry-issue-triage-runner.ts');
        const statusScript = read('scripts/launch/status.ts');
        const finalApprovalQueue = read('scripts/launch/final-approval-queue.ts');
        const integrationPackage = read('scripts/launch/integration-final-package.ts');
        const manualEvidenceDoc = read('docs/launch/MANUAL_EVIDENCE.md');
        const manualRunbook = read('docs/launch/MANUAL_EVIDENCE_RUNBOOK.md');

        expect(packageJson).toContain('launch:sentry-triage-pack');
        expect(packageJson).toContain('scripts/launch/sentry-triage-pack.ts');
        expect(packageJson).toContain('launch:sentry-issue-triage-runner');
        expect(packageJson).toContain('scripts/launch/sentry-issue-triage-runner.ts');

        for (const snippet of [
            'does not call Sentry',
            'does not resolve, ignore, archive or delete Sentry issues',
            'does not create or change alert rules',
            'does not fetch event details, stack traces or raw payloads',
            'accepted risk',
            'rollback',
        ]) {
            expect(sentryPack).toContain(snippet);
        }

        for (const snippet of [
            'SENTRY_TRIAGE_APPROVAL',
            'SENTRY_TRIAGE_ACTION',
            'SENTRY_TRIAGE_SHORT_IDS',
            'SENTRY_TRIAGE_ENVIRONMENT',
            '--execute-approved',
            'PLAN_ONLY_READY',
            'externalWritePerformed=false',
            'supportedActions',
            'resolved',
            'ignored',
            'sentryRequest',
            'GET',
            'PUT',
            '/issues/',
            'buildExactApprovalSentence',
            'validateIssueScopeBeforeUpdate',
            'sentry-issue-triage-command-manifest.json',
            'sentry-issue-triage-execution-plan.md',
            'approval-gate.md',
            'rollback-after-sentry-issue-triage.md',
            'manual-evidence-after-sentry-issue-triage.txt',
            'No event details, stack traces, request bodies, user data, raw payloads, attachments or issue titles',
            'No alert rule, project setting, DSN, token, sourcemap, release or integration change',
            'No issue delete, discard, merge, assignment, bookmark, public-share or priority change',
            'No Cloudflare, Supabase, Stripe, Google, Resend, Turnstile, legal value, application code, checkout or email write',
        ]) {
            expect(sentryRunner).toContain(snippet);
        }

        for (const snippet of [
            "readLatestJson<CheckBackedSummary>('launch-sentry-issue-triage-runner', 'summary.json')",
            "sourceLabel: 'sentry issue triage runner'",
            'Sentry Issue Triage Runner',
            'sentryIssueTriageRunner',
            'sentryIssueTriageRunnerPlan',
            'sentryIssueTriageRunnerApprovalGate',
            'sentryIssueTriageRunnerRollback',
            "latestGeneratedPath('launch-sentry-issue-triage-runner', 'summary.md')",
            "latestGeneratedPath('launch-sentry-issue-triage-runner', 'sentry-issue-triage-execution-plan.md')",
            "latestGeneratedPath('launch-sentry-issue-triage-runner', 'approval-gate.md')",
            "latestGeneratedPath('launch-sentry-issue-triage-runner', 'rollback-after-sentry-issue-triage.md')",
        ]) {
            expect(statusScript).toContain(snippet);
        }

        for (const snippet of [
            "latestGeneratedPath('launch-sentry-issue-triage-runner', 'summary.md')",
            "latestGeneratedPath('launch-sentry-issue-triage-runner', 'sentry-issue-triage-command-manifest.json')",
            "latestGeneratedPath('launch-sentry-issue-triage-runner', 'sentry-issue-triage-execution-plan.md')",
            "latestGeneratedPath('launch-sentry-issue-triage-runner', 'approval-gate.md')",
            "latestGeneratedPath('launch-sentry-issue-triage-runner', 'rollback-after-sentry-issue-triage.md')",
            'No alert-rule/project/DSN/token/sourcemap/release changes',
            'No event payload, stack trace, title or private user data in evidence',
        ]) {
            expect(finalApprovalQueue).toContain(snippet);
        }

        for (const snippet of [
            'sentry_issue_triage_runner',
            'launch:sentry-issue-triage-runner',
            'outputs/launch-sentry-issue-triage-runner/<timestamp>/summary.md',
            'Plan-only runner that refuses Sentry issue status changes unless org',
        ]) {
            expect(integrationPackage).toContain(snippet);
        }

        expect(manualEvidenceDoc).toContain('pnpm launch:sentry-issue-triage-runner');
        expect(manualRunbook).toContain('pnpm launch:sentry-issue-triage-runner');
        expect(manualRunbook).toContain('outputs/launch-sentry-issue-triage-runner/<timestamp>/approval-gate.md');
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

    it('keeps CRON_SECRET scoped to Pages cron instead of Worker internal auth', () => {
        const audit = read('scripts/launch/operations-audit.ts');
        const worker = read('workers/fulfillment/src/index.ts');
        const internalClient = read('src/lib/internal-job-service.ts');
        const cronRoute = read('src/pages/api/cron/send-reminders.ts');

        for (const snippet of [
            "path.join('src', 'pages', 'api', 'cron', 'send-reminders.ts')",
            'CRON_SECRET',
            'sendDueReminders',
            'app cron route gates reminder triggers with CRON_SECRET',
        ]) {
            expect(audit).toContain(snippet);
        }

        expect(worker).not.toContain('CRON_SECRET');
        expect(internalClient).not.toContain('CRON_SECRET');
        expect(cronRoute).toContain('CRON_SECRET');
        expect(cronRoute).toContain('sendDueReminders');
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
            'SENTRY_CAPTURE_LOCAL=false',
            'SENTRY_ENVIRONMENT',
            'local-<NODE_ENV>',
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
        const keyRotationStepIndex = statusScript.indexOf('Rotate keys only in the final deployment window');

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
        expect(statusScript).toContain('Open the latest staging schema rollout pack');
        expect(statusScript).toContain('pnpm launch:operations + pnpm launch:staging-db-rollout + pnpm launch:supabase-security-rollout');
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

    it('keeps final legal inputs generated from current code instead of a stale static package', () => {
        const packageJson = read('package.json');
        const legalFinalInputs = read('scripts/launch/legal-final-inputs.ts');
        const statusScript = read('scripts/launch/status.ts');
        const manualEvidenceDoc = read('docs/launch/MANUAL_EVIDENCE.md');
        const manualRunbook = read('docs/launch/MANUAL_EVIDENCE_RUNBOOK.md');
        const manualExample = read('docs/launch/MANUAL_EVIDENCE.example.json');

        expect(packageJson).toContain('launch:legal-final-inputs');
        expect(packageJson).toContain('scripts/launch/legal-final-inputs.ts');

        for (const snippet of [
            'launch-legal-final-inputs',
            'legal-final-inputs-package.md',
            'legal-final-inputs-manifest.json',
            'manual-evidence-dry-run-legal-owner-controller.txt',
            'manual-evidence-dry-run-legal-human-review.txt',
            'BLOCKED_BY_PLACEHOLDERS',
            'placeholderCount',
            'not legal advice',
            'No identity documents.',
            'No invented owner/controller values.',
            'changesLegalValues: false',
            'writesExternalServices: false',
            'terminos.astro',
        ]) {
            expect(legalFinalInputs).toContain(snippet);
        }

        for (const snippet of [
            "sourceLabel: 'legal final inputs package'",
            'Legal Final Inputs Package',
            'legalFinalInputsPackage',
            'legalFinalInputsManifest',
            'placeholder inventory is zero',
            'current legal inputs package reviewed',
        ]) {
            expect(statusScript).toContain(snippet);
        }

        for (const snippet of [
            'pnpm launch:legal-final-inputs',
            'outputs/launch-legal-final-inputs/<timestamp>/legal-final-inputs-package.md',
            'outputs/launch-legal-final-inputs/<timestamp>/legal-final-inputs-manifest.json',
            'placeholderCount: 0',
        ]) {
            expect(manualEvidenceDoc).toContain(snippet);
            expect(manualRunbook).toContain(snippet);
        }

        expect(manualExample).toContain('outputs/launch-legal-final-inputs/<timestamp>/legal-final-inputs-package.md');
        expect(manualExample).toContain('outputs/launch-legal-final-inputs/<timestamp>/legal-final-inputs-manifest.json');
    });

    it('keeps final integration readiness tied to day-one live payments and a closed rollback switch', () => {
        const manualAudit = read('scripts/launch/manual-evidence-audit.ts');
        const finalReadiness = read('scripts/launch/final-readiness-audit.ts');
        const manualEvidenceDoc = read('docs/launch/MANUAL_EVIDENCE.md');
        const manualRunbook = read('docs/launch/MANUAL_EVIDENCE_RUNBOOK.md');
        const environmentDoc = read('docs/launch/ENVIRONMENT.md');
        const checklist = read('docs/launch/CHECKLIST.md');
        const statusScript = read('scripts/launch/status.ts');

        expect(manualAudit).toContain('Stripe test rehearsal and Stripe live readiness for real payments from day one');
        expect(manualEvidenceDoc).toContain('Stripe test ensayado y Stripe live preparado para pagos reales desde el primer dia');
        expect(manualRunbook).toContain('Revisar la ruta ya decidida');
        expect(finalReadiness).toContain('| Payment posture | Confirm the selected posture');
        expect(finalReadiness).toContain('Production: live mode');
        expect(environmentDoc).toContain('`CHECKOUT_ENABLED_OVERRIDE=true` es el interruptor final');
        expect(checklist).toContain('Stripe live production en la ventana final');
        expect(statusScript).toContain('prepare Stripe live for real payments from day one');
        expect(statusScript).toContain('checkout rollback proven');

        expect(manualAudit).not.toContain('Stripe live, Google, Resend, Turnstile domains and fulfillment/reminder worker configuration are verified.');
        expect(finalReadiness).not.toContain('Stripe live, Google, Resend, dominios Turnstile y fulfillment/reminder worker revisados/configurados.');
        expect(finalReadiness).not.toContain('Production: selected payment posture.');
    });

    it('keeps final integration readiness tied to a generated service evidence package', () => {
        const packageJson = read('package.json');
        const integrationPackage = read('scripts/launch/integration-final-package.ts');
        const statusScript = read('scripts/launch/status.ts');
        const manualEvidenceDoc = read('docs/launch/MANUAL_EVIDENCE.md');
        const manualRunbook = read('docs/launch/MANUAL_EVIDENCE_RUNBOOK.md');
        const manualExample = read('docs/launch/MANUAL_EVIDENCE.example.json');

        expect(packageJson).toContain('launch:integration-final-package');
        expect(packageJson).toContain('scripts/launch/integration-final-package.ts');

        for (const snippet of [
            'launch-integration-final-package',
            'integration-final-package.md',
            'integration-final-manifest.json',
            'service-evidence-matrix.md',
            'BLOCKED_BY_FINAL_EVIDENCE',
            'does not deploy',
            'does not write external services',
            'secret names only',
            'Warning Evidence Synopsis',
            'warningEvidenceDetails',
            'warningDetailsForSource',
            'Blocking Warning Remediation Plan',
            'warningRemediationPlan',
            'remediationPlanForSource',
            'externalWriteGate',
            'launch:stripe-webhook-cutover-pack',
            'launch:stripe-webhook-cutover-runner',
            'launch:turnstile-domain-closure-runner',
            'launch:sentry-issue-triage-runner',
            'launch:sentry-triage-pack',
            'launch:turnstile-domain-closure-pack',
            'launch:final-smoke-execution-pack',
            'launch:staging-smoke-rehearsal-runner',
            'Stripe webhook endpoint',
            'stripe_webhook_cutover_runner',
            'turnstile_domain_closure_runner',
            'sentry_issue_triage_runner',
            'Sentry issue status',
            'Turnstile widget/domain change',
            'final_smoke_execution_pack',
            'staging_smoke_rehearsal_runner',
            'WAITING_ON_FINAL_PREREQUISITES',
            'finalPrerequisiteBlockers=[]',
            'SMOKE_EXTERNAL_WRITES_CONFIRMATION=writes-ok:<host>',
            'STAGING_SMOKE_REHEARSAL_APPROVAL',
            'No Cloudflare deploy, DNS or domain writes',
            'launch:live-domain-readonly',
            'Cloudflare Pages-vs-Worker',
            'cloudflare_runtime_cutover_preflight',
            'cloudflare_worker_variable_matrix',
            'cloudflare_worker_secrets_runner',
            'Cloudflare production runtime cutover preflight',
            'cloudflare-production-worker-variable-matrix.md',
            'Cloudflare production web Worker secret-name/direct-attestation gated runner',
            'wrangler_production_dry_run_passed',
            'Stripe evidence source',
            'Google',
            'Resend',
            'Turnstile',
            'Sentry',
            'Supabase processed_at',
        ]) {
            expect(integrationPackage).toContain(snippet);
        }

        for (const snippet of [
            'integrationFinalPackage',
            'integrationFinalManifest',
            'integrationServiceMatrix',
            'integration-final-manifest.json',
            'service-evidence-matrix.md',
            "readLatestJson<CheckBackedSummary>('launch-stripe-readonly-evidence', 'summary.json')",
            "readLatestJson<CheckBackedSummary>('launch-turnstile-readonly-evidence', 'summary.json')",
            "readLatestJson<CheckBackedSummary>('launch-sentry-readonly-evidence', 'summary.json')",
            "readLatestJson<CheckBackedSummary>('launch-google-readonly-evidence', 'summary.json')",
            "readLatestJson<CheckBackedSummary>('resend-readonly-evidence', 'summary.json')",
            "readLatestJson<CheckBackedSummary>('launch-stripe-webhook-cutover-pack', 'summary.json')",
            "readLatestJson<CheckBackedSummary>('launch-stripe-webhook-cutover-runner', 'summary.json')",
            "readLatestJson<CheckBackedSummary>('launch-turnstile-domain-closure-pack', 'summary.json')",
            "readLatestJson<CheckBackedSummary>('launch-turnstile-domain-closure-runner', 'summary.json')",
            "readLatestJson<CheckBackedSummary>('launch-sentry-triage-pack', 'summary.json')",
            "readLatestJson<CheckBackedSummary>('launch-sentry-issue-triage-runner', 'summary.json')",
            "readLatestJson<CheckBackedSummary>('launch-cloudflare-production-worker-secrets', 'summary.json')",
            'selectStagingSmokeEvidence',
            'readJsonEvidenceCandidates<CheckBackedSummary & StagingSmokeEvidenceSummary>',
            "'launch-staging-smoke-rehearsal-runner'",
            "'summary.json'",
            'stagingSmokeSelection.preferred',
            'stagingSmokeLatestPlan',
            "sourceLabel: 'stripe read-only evidence'",
            "sourceLabel: 'turnstile read-only evidence'",
            "sourceLabel: 'sentry read-only evidence'",
            "sourceLabel: 'google read-only evidence'",
            "sourceLabel: 'resend read-only evidence'",
            "sourceLabel: 'stripe webhook cutover pack'",
            "sourceLabel: 'stripe webhook cutover runner'",
            "sourceLabel: 'turnstile domain closure pack'",
            "sourceLabel: 'turnstile domain closure runner'",
            "sourceLabel: 'sentry triage pack'",
            "sourceLabel: 'sentry issue triage runner'",
            "sourceLabel: 'staging smoke rehearsal runner'",
            "sourceLabel: 'cloudflare production Worker phase 1 runner'",
            "sourceLabel: 'cloudflare production Worker secrets runner'",
            'Stripe Read-Only Evidence',
            'Turnstile Read-Only Evidence',
            'Sentry Read-Only Evidence',
            'Google Workspace Read-Only Evidence',
            'Resend Read-Only Evidence',
            'Stripe Webhook Cutover Pack',
            'Stripe Webhook Cutover Runner',
            'Turnstile Domain Closure Pack',
            'Turnstile Domain Closure Runner',
            'Sentry Triage Pack',
            'Sentry Issue Triage Runner',
            'Staging Smoke Rehearsal Runner',
            'Cloudflare Production Worker Phase 1 Runner',
            'Cloudflare Production Worker Secrets Runner',
            'stripeReadonlySummary',
            'turnstileReadonlySummary',
            'sentryReadonlySummary',
            'googleReadonlySummary',
            'resendReadonlySummary',
            'stripeWebhookCutoverPack',
            'stripeWebhookCutoverApproval',
            'stripeWebhookCutoverRunner',
            'stripeWebhookCutoverRunnerPlan',
            'stripeWebhookCutoverRunnerApprovalGate',
            'stripeWebhookCutoverRunnerRollback',
            'turnstileDomainClosurePack',
            'turnstileDomainDashboardChecklist',
            'turnstileDomainClosureRunner',
            'turnstileDomainClosureRunnerPlan',
            'turnstileDomainClosureRunnerApprovalGate',
            'turnstileDomainClosureRunnerRollback',
            'sentryTriagePack',
            'sentryTriageChecklist',
            'sentryAlertOwnershipChecklist',
            'sentryIssueTriageRunner',
            'sentryIssueTriageRunnerPlan',
            'sentryIssueTriageRunnerApprovalGate',
            'sentryIssueTriageRunnerRollback',
            'stagingSmokeRehearsalRunner',
            'stagingSmokeRehearsalRunnerPlan',
            'stagingSmokeRehearsalApprovalGate',
            'stagingSmokeRehearsalRollback',
            'cloudflareProductionRuntimeCutoverPreflight',
            'cloudflareProductionWorkerVariableMatrix',
            'cloudflareProductionWorkerSecretsRunner',
            'Run pnpm launch:integration-final-package',
        ]) {
            expect(statusScript).toContain(snippet);
        }

        for (const snippet of [
            'pnpm launch:integration-final-package',
            'pnpm launch:stripe-webhook-cutover-runner',
            'pnpm launch:turnstile-domain-closure-runner',
            'pnpm launch:sentry-issue-triage-runner',
            'pnpm launch:sentry-triage-pack',
            'pnpm launch:turnstile-domain-closure-pack',
            'pnpm launch:cloudflare-production-runtime-cutover-preflight',
            'pnpm launch:cloudflare-production-worker-secrets',
            'pnpm launch:staging-smoke-rehearsal-runner',
            'cloudflare-production-worker-variable-matrix.md',
            'outputs/launch-integration-final-package/<timestamp>/integration-final-manifest.json',
            'outputs/launch-integration-final-package/<timestamp>/service-evidence-matrix.md',
        ]) {
            expect(manualEvidenceDoc).toContain(snippet);
            expect(manualRunbook).toContain(snippet);
        }

        expect(manualExample).toContain('outputs/launch-integration-final-package/<timestamp>/integration-final-manifest.json');
        expect(manualExample).toContain('outputs/launch-integration-final-package/<timestamp>/service-evidence-matrix.md');
        expect(manualExample).toContain('outputs/launch-stripe-webhook-cutover-runner/<timestamp>/summary.md');
        expect(manualExample).toContain('outputs/launch-turnstile-domain-closure-runner/<timestamp>/summary.md');
        expect(manualExample).toContain('outputs/launch-sentry-issue-triage-runner/<timestamp>/summary.md');
        expect(manualExample).toContain('outputs/launch-cloudflare-production-worker-secrets/<timestamp>/summary.md');
    });

    it('keeps the final approval queue local-only and wired into launch status', () => {
        const packageJson = read('package.json');
        const finalApprovalQueue = read('scripts/launch/final-approval-queue.ts');
        const statusScript = read('scripts/launch/status.ts');

        expect(packageJson).toContain('launch:final-approval-queue');
        expect(packageJson).toContain('scripts/launch/final-approval-queue.ts');

        for (const snippet of [
            'Final Approval Queue',
            'launch-final-approval-queue',
            'final-approval-queue.md',
            'final-approval-queue-manifest.json',
            'final-approval-next-action.md',
            'final-window-execution-board.md',
            'nextActionPath',
            'executionBoardPath',
            'This queue is not approval.',
            'No external services are called or changed by this command.',
            'No secret values are stored here.',
            'Use the linked approval request for the exact scope.',
            'Final Approval Next Action Cursor',
            'First Non-Legal Operational Action',
            'Legal remains final-only by project decision',
            'The first non-legal blocker that can move before final smoke is the Supabase processed_at decision below.',
            'Final Window Execution Board',
            'Safe Now: Local Only',
            'Safe With Care: Read-Only Refresh',
            'launch:supabase-processed-at-readonly-preflight',
            'launch:cloudflare-production-runtime-readonly',
            'launch:cloudflare-production-runtime-cutover-preflight',
            'launch:cloudflare-production-worker-secrets',
            'cloudflare-production-worker-variable-matrix.md',
            'Final Execution Modes',
            'requires_exact_approval',
            'human_input_required',
            'must_wait',
            'ARTIFACTS_COMPLETE_WITH_MUST_WAIT',
            'waitReason',
            'prerequisiteItemIds',
            'Items marked `must_wait` are blocked by prerequisites even when all local artifacts exist.',
            'Items marked `requires_exact_approval` still need explicit resource/action approval before any write.',
            'Items marked `human_input_required` need human-owned final values or review.',
            'Critical Path',
            'criticalPath',
            'critical_path_dependency_coverage',
            'launch-stripe-webhook-cutover-runner',
            'stripe-webhook-cutover-execution-plan.md',
            'launch-turnstile-domain-closure-runner',
            'turnstile-domain-closure-execution-plan.md',
            'Create production Worker without domains',
            'Move production domains after direct proof',
            'Final write-capable lifecycle smoke',
            'supabase_processed_at_cleanup',
            'cloudflare_worker_create',
            'cloudflare_worker_secrets',
            'cloudflare-worker-secrets-execution-plan.md',
            'rollback-after-worker-secrets.md',
            'cloudflare_domain_move',
            'stripe_webhook_test_cutover',
            'turnstile_domain_closure',
            'sentry_issue_triage',
            'final_write_capable_smoke',
            'legal_final_inputs',
            'seo_llm_live_domain_review',
            'SMOKE_EXTERNAL_WRITES_CONFIRMATION=writes-ok:<host>',
            'No Stripe live mode',
            'No secret value output',
            'No invented legal values',
        ]) {
            expect(finalApprovalQueue).toContain(snippet);
        }

        for (const snippet of [
            "readLatestJson<CheckBackedSummary>('launch-final-approval-queue', 'summary.json')",
            "sourceLabel: 'final approval queue'",
            'Final Approval Queue',
            'finalApprovalQueue',
            'finalApprovalQueueManifest',
            'finalApprovalNextAction',
            'finalApprovalExecutionBoard',
            'final approval next action',
            'final approval execution board',
            "latestGeneratedPath('launch-final-approval-queue', 'final-approval-queue.md')",
            "latestGeneratedPath('launch-final-approval-queue', 'final-approval-queue-manifest.json')",
            "latestGeneratedPath('launch-final-approval-queue', 'final-approval-next-action.md')",
            "latestGeneratedPath('launch-final-approval-queue', 'final-window-execution-board.md')",
            "readLatestJson<FinalApprovalQueueManifest>('launch-final-approval-queue', 'final-approval-queue-manifest.json')",
            'Final Approval Critical Path',
            'Final Approval Item Posture',
            'Final Window Execution Board',
            'renderFinalApprovalCriticalPath',
            'renderFinalApprovalItemPosture',
            'FinalApprovalQueueItem',
            'approvalQueueStatus',
            'Items marked `requires_exact_approval` still need explicit resource/action approval before any write.',
            'Items marked `human_input_required` need human-owned final values or review.',
        ]) {
            expect(statusScript).toContain(snippet);
        }
    });

    it('keeps Cloudflare production domain cutover separate from Worker creation and secrets', () => {
        const packageJson = read('package.json');
        const cloudflareCutoverPreflight = read('scripts/launch/cloudflare-production-runtime-cutover-preflight.ts');
        const cloudflareCutover = read('scripts/launch/cloudflare-production-runtime-cutover.ts');
        const cloudflarePhase1 = read('scripts/launch/cloudflare-production-worker-phase1.ts');
        const cloudflareSecrets = read('scripts/launch/cloudflare-production-worker-secrets.ts');
        const finalReadiness = read('scripts/launch/final-readiness-audit.ts');
        const manualAudit = read('scripts/launch/manual-evidence-audit.ts');
        const manualEvidenceDoc = read('docs/launch/MANUAL_EVIDENCE.md');
        const manualRunbook = read('docs/launch/MANUAL_EVIDENCE_RUNBOOK.md');
        const manualExample = read('docs/launch/MANUAL_EVIDENCE.example.json');
        const statusScript = read('scripts/launch/status.ts');
        const cloudflarePackage = read('outputs/019f1a5e-2745-7c43-870d-544e6ba4e0b1/strict-qa-v2/cloudflare-domain-worker-preflight.md');

        for (const snippet of [
            'cloudflare-domain-worker-preflight.md',
            'Pages project `espanolhonesto`',
            'production Worker `espanolhonesto`',
            'required Worker secret names',
            'direct Worker URL',
            'separate explicit approval',
        ]) {
            expect(finalReadiness).toContain(snippet);
        }

        for (const snippet of [
            'Cloudflare Pages-vs-Worker/domain ownership',
            'production Worker secret-name posture',
            'cloudflare-domain-worker-preflight.md',
            'custom domains serve the intended final runtime',
            'direct Worker URL probes',
        ]) {
            expect(manualAudit).toContain(snippet);
        }

        for (const snippet of [
            'Cloudflare Pages-vs-Worker/domain ownership',
            'production Worker secret-name posture',
            'cloudflare-domain-worker-preflight.md',
            'pnpm launch:cloudflare-production-runtime-cutover-preflight',
            'cloudflare-production-worker-variable-matrix.md',
            'pnpm launch:cloudflare-production-runtime-cutover',
            'pnpm launch:cloudflare-production-worker-phase1',
            'pnpm launch:cloudflare-production-worker-secrets',
            'cloudflare-production-runtime-cutover-manifest.json',
        ]) {
            expect(manualEvidenceDoc).toContain(snippet);
            expect(manualRunbook).toContain(snippet);
            expect(manualExample).toContain(snippet);
        }

        for (const snippet of [
            'cloudflare-domain-worker-preflight.md',
            'Pages-vs-Worker domain ownership',
            'production Worker existence',
            'Worker secret setup',
            'direct Worker verification',
            'domain move',
            'old Pages project',
            'modern Worker build',
            'launch-cloudflare-production-runtime-cutover-preflight',
            'Cloudflare Production Runtime Cutover Preflight',
            'cloudflare-production-worker-variable-matrix.md',
            'launch-cloudflare-production-runtime-cutover',
            'Cloudflare Production Runtime Cutover',
            'approval-request-phase-1-worker.md',
            'launch-cloudflare-production-worker-phase1',
            'Cloudflare Worker Phase 1 Runner',
            'Cloudflare Production Worker Secrets Runner',
            'cloudflare-production-runtime-cutover-manifest.json',
        ]) {
            expect(statusScript).toContain(snippet);
        }

        expect(packageJson).toContain('launch:cloudflare-production-runtime-cutover');
        expect(packageJson).toContain('scripts/launch/cloudflare-production-runtime-cutover.ts');
        expect(packageJson).toContain('launch:cloudflare-production-runtime-cutover-preflight');
        expect(packageJson).toContain('scripts/launch/cloudflare-production-runtime-cutover-preflight.ts');
        expect(packageJson).toContain('launch:cloudflare-production-worker-phase1');
        expect(packageJson).toContain('scripts/launch/cloudflare-production-worker-phase1.ts');
        expect(packageJson).toContain('launch:cloudflare-production-worker-secrets');
        expect(packageJson).toContain('scripts/launch/cloudflare-production-worker-secrets.ts');
        expect(packageJson).toContain('launch:cloudflare-production-runtime-readonly');
        expect(packageJson).toContain('scripts/launch/cloudflare-production-runtime-readonly.ts');

        for (const snippet of [
            'Cloudflare Production Runtime Preflight Refresh',
            'launch-cloudflare-production-runtime-cutover-preflight',
            'cloudflare-production-worker-variable-matrix.md',
            'command_scope_no_external_write',
            'corepack pnpm --config.verify-deps-before-run=false exec wrangler deploy --config dist/server/wrangler.json --dry-run',
            'wrangler deploy --config dist/server/wrangler.json --dry-run',
            'wrangler\\s+secret\\s+put',
            'CHECKOUT_ENABLED=false in config: ${boolLabel(report.checkoutEnabledFalseInConfig)}',
            'Dry-run avoids custom domains',
            'distRemovedAfterDryRun',
            'LEVEL_CHECK_TOKEN_SECRET',
            'ADMIN_EMAIL',
            'Google service-account variables belong to the Fulfillment Worker',
            'Generated command artifacts contain no obvious secret values',
            'rmSync(distPath, { recursive: true, force: true })',
        ]) {
            expect(cloudflareCutoverPreflight).toContain(snippet);
        }

        for (const snippet of [
            'does not write to Cloudflare',
            'does not deploy',
            'secret names only',
            'separate explicit approval',
            'approval-request-fulfillment-bootstrap-hmac.md',
            'approval-request-phase-1-worker.md',
            'approval-request-worker-secrets.md',
            'approval-request-domain-move.md',
            'verification-checklist.md',
            'rollback-plan.md',
            'pnpm launch:cloudflare-production-fulfillment-bootstrap-secrets -- --execute-approved',
            'pnpm launch:cloudflare-production-worker-phase1 -- --execute-approved',
            'wrangler secret put SECRET_NAME --config wrangler.toml --env production',
            'Google service account keys belong on the fulfillment Worker',
            'CHECKOUT_ENABLED=false',
            'BASE-1074/RETEST-285',
            'BASE-1075/RETEST-286',
            'wranglerProductionDryRun',
            'commandizedWranglerProductionDryRun',
            'cloudflareRuntimeCutoverPreflight',
            'cloudflare-production-worker-variable-matrix.md',
            'launch:cloudflare-production-runtime-cutover-preflight',
            'cloudflare_runtime_cutover_preflight_exists',
            'Cloudflare Worker dry-run deploy proof',
            'local_build_parity_evidence_exists',
            '/es/espanol-para-vivir-en-espana',
            '/es/espanol-para-profesionales',
            '/es/clases-de-conversacion-en-espanol',
            '/llms.txt',
            'modernParityRoutes',
            'launch:cloudflare-production-worker-phase1',
        ]) {
            expect(cloudflareCutover).toContain(snippet);
        }

        for (const snippet of [
            'CLOUDFLARE_PHASE1_APPROVAL',
            '--execute-approved',
            'externalWritePerformed=false',
            'PLAN_ONLY_READY',
            'corepack pnpm --config.verify-deps-before-run=false exec wrangler deploy --config dist/server/wrangler.json --dry-run',
            'corepack pnpm --config.verify-deps-before-run=false exec wrangler deploy --config dist/server/wrangler.json --keep-vars',
            'corepack pnpm --config.verify-deps-before-run=false exec wrangler deployments list --name espanolhonesto --json',
            'corepack pnpm --config.verify-deps-before-run=false exec wrangler secret list --name espanolhonesto --format json',
            'executeRequested && !approvalMatched',
            'phase1_dry_run_guard_before_write',
            'No domain move',
            'No DNS change',
            'No Pages deletion',
            'No custom-domain attachment',
            'No `CHECKOUT_ENABLED=true`',
            'No secret value printing',
            'No Supabase, Google, Resend, Sentry, Turnstile or GitHub writes',
            'approval-gate.md',
            'rollback-after-phase1.md',
            'manual-evidence-after-phase1.txt',
        ]) {
            expect(cloudflarePhase1).toContain(snippet);
        }

        for (const snippet of [
            'CLOUDFLARE_WORKER_SECRETS_APPROVAL',
            'CLOUDFLARE_WORKER_DIRECT_URL',
            '--execute-approved',
            'externalWritePerformed=false',
            'PLAN_ONLY_READY',
            'corepack pnpm --config.verify-deps-before-run=false exec wrangler deployments list --name espanolhonesto --json',
            'corepack pnpm --config.verify-deps-before-run=false exec wrangler secret list --config wrangler.toml --env production --format json',
            'corepack pnpm --config.verify-deps-before-run=false exec wrangler secret put SECRET_NAME --config wrangler.toml --env production',
            'wrangler secret put',
            'requiredSecretNames',
            'PUBLIC_SUPABASE_URL',
            'STRIPE_WEBHOOK_SECRET',
            'INTERNAL_JOB_SECRET',
            'RESEND_API_KEY',
            'executeRequested',
            'secretValues',
            'sanitizeOutput',
            'No domain move',
            'No DNS change',
            'No Pages deletion',
            'No `CHECKOUT_ENABLED=true`',
            'No secret value printing',
            'No Supabase, Google, Resend, Sentry, Turnstile or GitHub writes',
            'cloudflare-worker-secrets-command-manifest.json',
            'cloudflare-worker-secrets-execution-plan.md',
            'approval-gate.md',
            'rollback-after-worker-secrets.md',
            'manual-evidence-after-worker-secrets.txt',
        ]) {
            expect(cloudflareSecrets).toContain(snippet);
        }

        for (const snippet of [
            'production Worker `espanolhonesto` does not exist',
            'Pages project `espanolhonesto` exists and owns project domains',
            'Do not move `espanolhonesto.com` in the same step',
            'Approval Sentence For Phase 1 Only',
            'Approval Sentence For Domain Move Later',
            'CHECKOUT_ENABLED=false',
        ]) {
            expect(cloudflarePackage).toContain(snippet);
        }
    });

    it('keeps final smoke execution behind an exact approval and rollback package', () => {
        const packageJson = read('package.json');
        const finalSmokePack = read('scripts/launch/final-smoke-execution-pack.ts');
        const stagingSmokeRunner = read('scripts/launch/staging-smoke-rehearsal-runner.ts');
        const finalReadiness = read('scripts/launch/final-readiness-audit.ts');
        const statusScript = read('scripts/launch/status.ts');
        const finalApprovalQueue = read('scripts/launch/final-approval-queue.ts');
        const manualEvidenceDoc = read('docs/launch/MANUAL_EVIDENCE.md');
        const manualRunbook = read('docs/launch/MANUAL_EVIDENCE_RUNBOOK.md');
        const manualExample = read('docs/launch/MANUAL_EVIDENCE.example.json');
        const launchRunbook = read('docs/launch/RUNBOOK.md');
        const environmentDoc = read('docs/launch/ENVIRONMENT.md');
        const launchChecklist = read('docs/launch/CHECKLIST.md');
        const smokeSafetyTest = read('tests/unit/real-env-smoke-safety.test.ts');

        expect(packageJson).toContain('launch:final-smoke-execution-pack');
        expect(packageJson).toContain('scripts/launch/final-smoke-execution-pack.ts');
        expect(packageJson).toContain('launch:staging-smoke-rehearsal-runner');
        expect(packageJson).toContain('scripts/launch/staging-smoke-rehearsal-runner.ts');
        expect(packageJson).toContain('launch:staging-billing-lifecycle:preflight');
        expect(packageJson).toContain('launch:staging-billing-lifecycle:resume');

        for (const snippet of [
            'launch-final-smoke-execution-pack',
            'final-smoke-execution-manifest.json',
            'approval-request-final-smoke.md',
            'preflight-checklist.md',
            'rollback-and-cleanup-plan.md',
            'READY_FOR_FINAL_SMOKE_APPROVAL',
            'WAITING_ON_FINAL_PREREQUISITES',
            'READY_FOR_STAGING_SMOKE_APPROVAL',
            'approval-request-staging-smoke.md',
            'staging-preflight-checklist.md',
            'production-minimal-smoke-checklist.md',
            'stagingRehearsalMayRunBeforeLegalFinal',
            'stagingRehearsalDoesNotCloseFinalSmoke',
            'finalPrerequisiteBlockers',
            'latestLaunchStatusSummary',
            'final prerequisites',
            'staging rehearsal',
            'does not run final smoke',
            'does not write external services',
            'staging-only',
            'minimal manual production smoke',
            'must never be pointed at production',
            'existing allowlisted role accounts',
            'creates zero Auth users',
            'CHECKOUT_ENABLED_OVERRIDE=false',
            'completed Checkout evidence',
            'SMOKE_BILLING_LIFECYCLE_EVIDENCE_PATH',
            'launch:staging-billing-lifecycle:preflight',
            'SMOKE_EXTERNAL_WRITES_CONFIRMATION',
            'writes-ok:<host>',
            'real-env-smoke.ts',
            '/internal/reminders/send-exact',
            'outputs/real-env-smoke/<timestamp>/summary.md',
            'No password reset for owner/admin/teacher accounts.',
            'No Cloudflare deploy/domain/DNS writes.',
        ]) {
            expect(finalSmokePack).toContain(snippet);
        }
        expect(finalSmokePack).not.toContain('/api/cron/send-reminders');

        for (const snippet of [
            'launch-staging-smoke-rehearsal-runner',
            'STAGING_SMOKE_REHEARSAL_APPROVAL',
            'PLAN_ONLY_READY',
            '--execute-approved',
            'externalWriteCommandStarted',
            'SMOKE_BASE_URL',
            'https://espanolhonesto-staging.alindev95.workers.dev',
            'SMOKE_EXTERNAL_WRITES_CONFIRMATION',
            'writes-ok:espanolhonesto-staging.alindev95.workers.dev',
            'STRIPE_SECRET_KEY',
            'sk_live_',
            'Stripe live',
            'staging-smoke-command-manifest.json',
            'staging-smoke-execution-plan.md',
            'approval-gate.md',
            'rollback-after-staging-smoke.md',
            'manual-evidence-after-staging-smoke.txt',
            'No Cloudflare write, code, route, domain or DNS change.',
            'No Supabase schema migration',
            '--preflight-only',
            'runSmokePreflightCommand',
            'all_preconditions_before_writes',
            'SMOKE_COMPLETED_CHECKOUT_SESSION_ID',
            'SMOKE_BILLING_LIFECYCLE_EVIDENCE_PATH',
            'SMOKE_STUDENT_EMAIL',
            'EMAIL_RECIPIENT_ALLOWLIST',
            "'--expect-checkout-override',",
            "'false'",
            'completedCheckoutEvidenceReused=true',
            'cloudflareWritesStarted=false',
            'runDirectNodeCommand',
            'node --import tsx --import ./scripts/smoke/astro-env-node-register.mjs scripts/smoke/real-env-smoke.ts',
        ]) {
            expect(stagingSmokeRunner).toContain(snippet);
        }

        for (const snippet of [
            'staging_write_capable_smoke_rehearsal',
            'launch-staging-smoke-rehearsal-runner',
            'staging-smoke-command-manifest.json',
            'rollback-after-staging-smoke.md',
            'SMOKE_EXTERNAL_WRITES_CONFIRMATION=writes-ok:espanolhonesto-staging.alindev95.workers.dev',
            'launch-staging-billing-lifecycle',
            'CHECKOUT_ENABLED_OVERRIDE remains false throughout',
        ]) {
            expect(finalApprovalQueue).toContain(snippet);
        }

        for (const snippet of [
            'pnpm launch:final-smoke-execution-pack',
            'local-only approval, preflight, rollback and evidence package',
        ]) {
            expect(finalReadiness).toContain(snippet);
        }

        for (const snippet of [
            'finalSmokeExecutionPack',
            'finalSmokeExecutionApproval',
            'finalSmokeExecutionManifest',
            'stagingSmokeRehearsalRunner',
            'stagingSmokeRehearsalApprovalGate',
            'approval-request-final-smoke.md',
            'final-smoke-execution-manifest.json',
            "sourceLabel: 'staging smoke rehearsal runner'",
            'exact write-capable smoke approval',
            'SMOKE_EXTERNAL_WRITES_CONFIRMATION=writes-ok:<host>',
        ]) {
            expect(statusScript).toContain(snippet);
        }

        for (const snippet of [
            'pnpm launch:final-smoke-execution-pack',
            'outputs/launch-final-smoke-execution-pack/<timestamp>/approval-request-final-smoke.md',
            'production-minimal-smoke-checklist.md',
            'outputs/launch-final-smoke-execution-pack/<timestamp>/final-smoke-execution-manifest.json',
            'outputs/launch-final-smoke-execution-pack/<timestamp>/rollback-and-cleanup-plan.md',
            'outputs/launch-staging-smoke-rehearsal-runner/<timestamp>/summary.md',
            'outputs/launch-staging-smoke-rehearsal-runner/<timestamp>/approval-gate.md',
            'outputs/launch-staging-billing-lifecycle/<timestamp>/summary.json',
            'pnpm launch:staging-billing-lifecycle:preflight',
        ]) {
            expect(manualEvidenceDoc).toContain(snippet);
            expect(manualRunbook).toContain(snippet);
        }

        expect(manualExample).toContain('outputs/launch-final-smoke-execution-pack/<timestamp>/approval-request-final-smoke.md');
        expect(manualExample).toContain('outputs/launch-final-smoke-execution-pack/<timestamp>/final-smoke-execution-manifest.json');
        expect(manualExample).toContain('outputs/launch-staging-smoke-rehearsal-runner/<timestamp>/summary.md');
        expect(manualExample).toContain('outputs/launch-staging-smoke-rehearsal-runner/<timestamp>/approval-gate.md');
        expect(manualExample).toContain('outputs/launch-staging-billing-lifecycle/<timestamp>/summary.json');
        for (const document of [launchRunbook, environmentDoc, launchChecklist, manualEvidenceDoc, manualRunbook]) {
            expect(document).toContain('SMOKE_BILLING_LIFECYCLE_EVIDENCE_PATH');
            expect(document).toContain('launch:staging-billing-lifecycle:preflight');
        }
        expect(launchRunbook).not.toContain('aprobacion Cloudflare del gate separada');
        expect(manualRunbook).not.toContain('Devolver el gate Cloudflare');
        expect(finalApprovalQueue).not.toContain('checkout gate uses the separate approval item');
        expect(smokeSafetyTest).toContain('requires an explicit external-write confirmation');
        expect(smokeSafetyTest).toContain('writes redacted final smoke evidence files');
    });

    it('keeps SEO/LLM final closure tied to live-domain parity and human search evidence', () => {
        const packageJson = read('package.json');
        const seoFinalPackage = read('scripts/launch/seo-llm-final-package.ts');
        const statusScript = read('scripts/launch/status.ts');
        const manualEvidenceDoc = read('docs/launch/MANUAL_EVIDENCE.md');
        const manualRunbook = read('docs/launch/MANUAL_EVIDENCE_RUNBOOK.md');
        const manualExample = read('docs/launch/MANUAL_EVIDENCE.example.json');
        const seoRunbook = read('docs/launch/SEO_LLM_FINAL.md');

        expect(packageJson).toContain('launch:seo-llm-final-package');
        expect(packageJson).toContain('scripts/launch/seo-llm-final-package.ts');

        for (const snippet of [
            'launch-seo-llm-final-package',
            'seo-llm-final-package.md',
            'seo-llm-final-manifest.json',
            'review-checklist.md',
            'domain-parity-gap.md',
            'BLOCKED_BY_LIVE_DOMAIN',
            'does not deploy',
            'does not write external services',
            'does not buy or store fonts',
            'Search Console',
            'Core Web Vitals',
            'llms.txt',
            'domain parity',
            'Russian typography',
        ]) {
            expect(seoFinalPackage).toContain(snippet);
        }

        for (const snippet of [
            'liveDomainReadonlySummary',
            "latestGeneratedPath('launch-live-domain-readonly-evidence', 'summary.md')",
            "sourceLabel: 'live-domain read-only evidence'",
            'Live Domain Read-Only Evidence',
            'SEO/LLM Local Audit',
            'SEO/LLM Final Package',
            'outputs/launch-live-domain-readonly-evidence/<timestamp>/summary.md',
            'seoLlmFinalPackage',
            'seoLlmFinalManifest',
            'seoLlmDomainParityGap',
            'seo-llm-final-manifest.json',
            'domain-parity-gap.md',
            'Run pnpm launch:seo-llm-final-package',
            'Do not close seo_llm_final if domain-parity-gap.md still shows old Pages/incomplete modern route evidence',
        ]) {
            expect(statusScript).toContain(snippet);
        }

        for (const snippet of [
            'pnpm launch:seo-llm-final-package',
            'outputs/launch-seo-llm-final-package/<timestamp>/seo-llm-final-manifest.json',
            'outputs/launch-seo-llm-final-package/<timestamp>/domain-parity-gap.md',
        ]) {
            expect(manualEvidenceDoc).toContain(snippet);
            expect(manualRunbook).toContain(snippet);
        }

        expect(manualExample).toContain('outputs/launch-seo-llm-final-package/<timestamp>/seo-llm-final-manifest.json');
        expect(manualExample).toContain('outputs/launch-seo-llm-final-package/<timestamp>/domain-parity-gap.md');
        expect(seoRunbook).toContain('Search Console');
        expect(seoRunbook).toContain('Core Web Vitals');
        expect(seoRunbook).toContain('Tipografia Rusa Premium');
        expect(seoRunbook).toContain('LLM Discoverability');
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
