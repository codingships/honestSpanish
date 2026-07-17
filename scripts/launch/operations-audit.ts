import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type Status = 'ok' | 'warning' | 'failed';

interface Finding {
    status: Status;
    area: string;
    message: string;
    details?: string[];
}

interface OperationsReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: 'OK' | 'WARNING' | 'FAILED';
    findings: Finding[];
    outputDir: string;
    operationsReadinessWorksheetPath: string;
    databaseReadinessWorksheetPath: string;
    hostedSchemaDriftWorksheetPath: string;
    hostedSchemaCheckSqlPath: string;
    hostedSchemaClosurePlanPath: string;
}

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-operations', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const findings: Finding[] = [
    reviewCloudflareFulfillmentWorker(),
    reviewCiDeployPipeline(),
    reviewFulfillmentWorkerRuntime(),
    reviewFulfillmentJobRecovery(),
    reviewRuntimeEnvironmentDocs(),
    reviewGoogleCalendarAccountRunbook(),
    reviewObservabilityPolicy(),
    reviewSupabaseBackupRunbook(),
    reviewOperationsRunbook(),
    reviewRcOperationalGate(),
];

const failed = findings.filter((finding) => finding.status === 'failed');
const warnings = findings.filter((finding) => finding.status === 'warning');
const status = failed.length > 0 ? 'FAILED' : warnings.length > 0 ? 'WARNING' : 'OK';
const operationsReadinessWorksheetPath = path.join(outputDir, 'operations-readiness-worksheet.md');
const databaseReadinessWorksheetPath = path.join(outputDir, 'database-readiness-worksheet.md');
const hostedSchemaDriftWorksheetPath = path.join(outputDir, 'hosted-schema-drift-worksheet.md');
const hostedSchemaCheckSqlPath = path.join(outputDir, 'hosted-schema-check.sql');
const hostedSchemaClosurePlanPath = path.join(outputDir, 'hosted-schema-closure-plan.md');

const report: OperationsReport = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status,
    findings,
    outputDir,
    operationsReadinessWorksheetPath,
    databaseReadinessWorksheetPath,
    hostedSchemaDriftWorksheetPath,
    hostedSchemaCheckSqlPath,
    hostedSchemaClosurePlanPath,
};

writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(path.join(outputDir, 'summary.md'), renderMarkdown(report), 'utf8');
writeFileSync(operationsReadinessWorksheetPath, renderOperationsReadinessWorksheet(report), 'utf8');
writeFileSync(databaseReadinessWorksheetPath, renderDatabaseReadinessWorksheet(report), 'utf8');
writeFileSync(hostedSchemaDriftWorksheetPath, renderHostedSchemaDriftWorksheet(report), 'utf8');
writeFileSync(hostedSchemaCheckSqlPath, renderHostedSchemaCheckSql(), 'utf8');
writeFileSync(hostedSchemaClosurePlanPath, renderHostedSchemaClosurePlan(report), 'utf8');

console.log(`[launch:operations] Status: ${status}`);
console.log(`[launch:operations] Failed: ${failed.length}`);
console.log(`[launch:operations] Warnings: ${warnings.length}`);
console.log(`[launch:operations] Summary: ${path.join(outputDir, 'summary.md')}`);
console.log(`[launch:operations] Operations worksheet: ${operationsReadinessWorksheetPath}`);
console.log(`[launch:operations] Database worksheet: ${databaseReadinessWorksheetPath}`);
console.log(`[launch:operations] Hosted schema drift worksheet: ${hostedSchemaDriftWorksheetPath}`);
console.log(`[launch:operations] Hosted schema check SQL: ${hostedSchemaCheckSqlPath}`);
console.log(`[launch:operations] Hosted schema closure plan: ${hostedSchemaClosurePlanPath}`);

if (failed.length > 0) process.exit(1);

function reviewCloudflareFulfillmentWorker(): Finding {
    const packageFile = path.join('workers', 'fulfillment', 'package.json');
    const wranglerFile = path.join('workers', 'fulfillment', 'wrangler.toml');
    const workerFile = path.join('workers', 'fulfillment', 'src', 'index.ts');
    const productionSecretsRunnerFile = path.join('scripts', 'launch', 'cloudflare-production-fulfillment-secrets.ts');
    const productionQueueRunnerFile = path.join('scripts', 'launch', 'cloudflare-production-queue-provision.ts');
    const productionRunbookFile = path.join('docs', 'launch', 'CLOUDFLARE_PRODUCTION.md');
    const packageJson = readIfExists(packageFile);
    const wrangler = readIfExists(wranglerFile);
    const worker = readIfExists(workerFile);
    const productionSecretsRunner = readIfExists(productionSecretsRunnerFile);
    const productionQueueRunner = readIfExists(productionQueueRunnerFile);
    const productionRunbook = readIfExists(productionRunbookFile);
    const details: string[] = [];

    details.push(...missingSnippets(packageFile, packageJson, [
        '"name": "@espanol-honesto/fulfillment-worker"',
        '"packageManager": "pnpm@10.33.0"',
        '"dev": "wrangler dev --config wrangler.toml --local --port 8788 --env staging"',
        '"deploy": "wrangler deploy --config wrangler.toml --env staging"',
        '"deploy:production": "wrangler deploy --config wrangler.toml --env production --dry-run"',
        '"typecheck": "tsc --noEmit"',
        '@googleapis/calendar',
        '@googleapis/drive',
        'resend',
    ]));

    details.push(...missingSnippets(wranglerFile, wrangler, [
        'name = "espanol-honesto-fulfillment-env-required"',
        'main = "src/index.ts"',
        'compatibility_flags = ["nodejs_compat"]',
        '[env.staging]',
        'name = "espanol-honesto-fulfillment-staging"',
        '[env.production]',
        'name = "espanol-honesto-fulfillment-production"',
        'PUBLIC_APP_ENV = "production"',
        'SUPABASE_EXPECTED_PROJECT_REF = "vkkahxsybhbutszerawz"',
        'WORKER_IDENTITY = "espanol-honesto-fulfillment-production"',
        'PUBLIC_SITE_URL = "https://espanolhonesto.com"',
        'EMAIL_DELIVERY_MODE = "live"',
        'EMAIL_DAILY_RECIPIENT_LIMIT = "80"',
        'EMAIL_MONTHLY_RECIPIENT_LIMIT = "2400"',
        '[triggers]',
        'crons = ["0 * * * *"]',
        'observability',
    ]));

    details.push(...missingSnippets(workerFile, worker, [
        '/health',
        'isAuthorized',
        'INTERNAL_JOB_SECRET',
        '/internal/jobs/process',
        '/internal/google/availability',
        '/internal/google/filter-available-slots',
        '/internal/drive/append-homework',
        '/internal/account/link-google-drive',
        '/internal/google/create-student-folder',
        '/internal/reminders/send',
        'processDueFulfillmentJobs',
        'sendClassReminder',
        'scheduled',
        'cloudflare-fulfillment-worker',
    ]));

    details.push(...missingSnippets(productionSecretsRunnerFile, productionSecretsRunner, [
        'CLOUDFLARE_FULFILLMENT_SECRETS_APPROVAL',
        'CLOUDFLARE_FULFILLMENT_DIRECT_URL',
        '--execute-approved',
        'remote_target_pre_write_gate',
        'direct_fulfillment_runtime_attestation',
        'supabaseExpectedProjectRef',
        'FULFILLMENT_RUNTIME_MODE=bootstrap',
        'EMAIL_DELIVERY_MODE = "disabled"',
        'bootstrap_operational_block_pre_write',
        'No email send',
        "config: 'workers/fulfillment/wrangler.toml'",
        "'--env', 'production_bootstrap'",
    ]));

    details.push(...missingSnippets(productionQueueRunnerFile, productionQueueRunner, [
        "supportedArguments = new Set(['--execute-approved', '--verify-existing'])",
        '--execute-approved and --verify-existing are mutually exclusive',
        'exact_existing_inventory_gate',
        'verify_existing_read_only',
        "closureStatus = 'VERIFIED_EXISTING'",
    ]));

    details.push(...missingSnippets(productionRunbookFile, productionRunbook, [
        'pnpm launch:cloudflare-production-queues -- --execute-approved',
        'pnpm launch:cloudflare-production-queues -- --verify-existing',
        'el runner de enable no crea, borra, adopta ni valida el inventario de Queues',
    ]));

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'Cloudflare fulfillment Worker',
        message: details.length === 0
            ? 'Cloudflare Worker defines isolated staging/production runtimes plus a separately gated production config/secrets/email route with direct attestation.'
            : 'Cloudflare fulfillment Worker is missing launch-critical runtime or environment configuration.',
        details,
    };
}

function reviewCiDeployPipeline(): Finding {
    const ciFile = path.join('.github', 'workflows', 'ci.yml');
    const deployFile = path.join('.github', 'workflows', 'deploy-staging.yml');
    const ci = readIfExists(ciFile);
    const deploy = readIfExists(deployFile);
    const details = [
        ...missingSnippets(ciFile, ci, [
            'branches: [ main ]',
            'version: 10.33.0',
            "node-version: '22.12.0'",
            'pnpm install --frozen-lockfile',
            'pnpm run typecheck',
            'pnpm run lint',
            'pnpm run test:run',
            'pnpm run fulfillment:typecheck',
            'pnpm run secrets:check',
            'pnpm run launch:no-real-payments',
            'CHECKOUT_ENABLED: "false"',
            'pnpm exec playwright test --project=public',
        ]),
        ...missingSnippets(deployFile, deploy, [
            'workflow_dispatch:',
            'commit_sha:',
            'checks: read',
            'contents: read',
            'group: cloudflare-staging-deploy',
            'cancel-in-progress: false',
            'environment: staging',
            'This privileged workflow must be dispatched from refs/heads/main.',
            'ref: ${{ inputs.commit_sha }}',
            'commit_sha must be a full lowercase 40-character Git commit SHA.',
            'Require successful CI for the exact commit',
            'check-runs?per_page=100',
            'run.name === "build-and-test"',
            'run.conclusion === "success"',
            'CLOUDFLARE_API_TOKEN',
            'EXPECTED_CLOUDFLARE_ACCOUNT_ID: d1a22bcf6477ff2ff31d2bfb83084e44',
            'Verify exact staging provider identities',
            'scripts/ci/verify-staging-deploy-environment.ts',
            'SUPABASE_SERVICE_ROLE_KEY: "build-only-placeholder-service-role"',
            'STRIPE_SECRET_KEY: "sk_test_build_only_placeholder"',
            'pnpm run build:staging:release',
            'deploy-built-worker.ts --environment staging --dry-run',
            'pnpm run deploy',
            'Verify staging checkout is disabled',
            'STAGING_WORKER_URL: https://staging.espanolhonesto.com',
            '--deployed-url "$STAGING_WORKER_URL"',
            'Deploy staging Fulfillment Worker',
            'Deploy staging web Worker',
            'Record partial-deploy recovery requirement',
            'Verify staging Fulfillment runtime and bindings',
            'pnpm run launch:staging-operations -- --include-wrangler',
            'pnpm exec wrangler deploy --config workers/fulfillment/wrangler.toml --env staging --keep-vars',
        ]),
    ];
    if (/\b(?:push|pull_request):/u.test(deploy)) {
        details.push(`${deployFile}: staging deploy must be workflow_dispatch-only.`);
    }
    if (ci.includes('deploy-cloudflare:') || ci.includes('CLOUDFLARE_API_TOKEN') || ci.includes('run: pnpm run deploy')) {
        details.push(`${ciFile}: CI must validate only; Cloudflare writes belong to the manual exact-SHA staging workflow.`);
    }
    if (deploy.includes('environment: Production') || deploy.includes('--env production') || deploy.includes('--environment production')) {
        details.push(`${deployFile}: the staging workflow must not contain a production target or write path.`);
    }
    if (deploy.includes('run deploy -- --env')) {
        details.push(`${deployFile}: fulfillment deploy must not append a second --env to a package script that already selects staging.`);
    }
    const buildStep = deploy.slice(
        deploy.indexOf('      - name: Build exact staging package'),
        deploy.indexOf('      - name: Validate staging Fulfillment package'),
    );
    for (const secretName of [
        'SUPABASE_SERVICE_ROLE_KEY',
        'STRIPE_SECRET_KEY',
        'STRIPE_WEBHOOK_SECRET',
        'TURNSTILE_SECRET_KEY',
        'CRON_SECRET',
        'INTERNAL_JOB_SECRET',
    ]) {
        if (buildStep.includes(`${secretName}: \${{ secrets.${secretName} }}`)) {
            details.push(`${deployFile}: ${secretName} must not be exposed to the staging build process.`);
        }
    }
    const fulfillmentDryRunIndex = deploy.indexOf('name: Validate staging Fulfillment package');
    const webDryRunIndex = deploy.indexOf('name: Validate staging web package');
    const fulfillmentDeployIndex = deploy.indexOf('name: Deploy staging Fulfillment Worker');
    const webDeployIndex = deploy.indexOf('name: Deploy staging web Worker');
    if (fulfillmentDeployIndex < 0 || webDeployIndex < 0 || fulfillmentDeployIndex >= webDeployIndex) {
        details.push(`${deployFile}: fulfillment Worker must deploy before the bound Astro Worker.`);
    }
    if (
        fulfillmentDryRunIndex < 0
        || webDryRunIndex < 0
        || fulfillmentDeployIndex < 0
        || fulfillmentDryRunIndex >= fulfillmentDeployIndex
        || webDryRunIndex >= fulfillmentDeployIndex
    ) {
        details.push(`${deployFile}: both staging packages must pass dry-run before the first deploy.`);
    }

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'GitHub CI and deploy pipeline',
        message: details.length === 0
            ? 'CI is validation-only; staging deploys manually from one exact CI-green SHA in dependency order, and production remains on explicit lifecycle gates.'
            : 'CI/deploy pipeline is missing launch-critical steps.',
        details,
    };
}

function reviewFulfillmentWorkerRuntime(): Finding {
    const packageJson = readIfExists(path.join('workers', 'fulfillment', 'package.json'));
    const worker = readIfExists(path.join('workers', 'fulfillment', 'src', 'index.ts'));
    const internalClient = readIfExists(path.join('src', 'lib', 'internal-job-service.ts'));
    const webWranglerFile = 'wrangler.toml';
    const webWrangler = readIfExists(webWranglerFile);
    const cronRoute = readIfExists(path.join('src', 'pages', 'api', 'cron', 'send-reminders.ts'));
    const details = [
        ...missingSnippets(path.join('workers', 'fulfillment', 'package.json'), packageJson, [
            '"packageManager": "pnpm@10.33.0"',
            '"deploy": "wrangler deploy --config wrangler.toml --env staging"',
            '"deploy:production": "wrangler deploy --config wrangler.toml --env production --dry-run"',
            '"typecheck": "tsc --noEmit"',
            '@googleapis/calendar',
            '@googleapis/drive',
            'resend',
        ]),
        ...missingSnippets(path.join('workers', 'fulfillment', 'src', 'index.ts'), worker, [
            '/health',
            'isAuthorized',
            'INTERNAL_JOB_SECRET',
            '/internal/jobs/process',
            '/internal/google/availability',
            '/internal/google/filter-available-slots',
            '/internal/drive/append-homework',
            '/internal/account/link-google-drive',
            '/internal/google/create-student-folder',
            '/internal/reminders/send',
            'processDueFulfillmentJobs',
            'sendClassReminder',
        ]),
        ...missingSnippets(path.join('src', 'lib', 'internal-job-service.ts'), internalClient, [
            'cloudflare:workers',
            'FULFILLMENT_SERVICE',
            'FULFILLMENT_WORKER_URL',
            'INTERNAL_JOB_SERVICE_URL',
            'INTERNAL_JOB_SECRET',
            'Authorization',
            'runAfterResponse',
            'processFulfillmentJobs',
            'sendDueReminders',
            'checkTeacherAvailabilityViaInternalService',
            'filterSlotsAgainstGoogleViaInternalService',
        ]),
        ...missingSnippets(webWranglerFile, webWrangler, [
            '[[env.staging.services]]',
            'service = "espanol-honesto-fulfillment-staging"',
            '[[env.production.services]]',
            'service = "espanol-honesto-fulfillment-production"',
            'binding = "FULFILLMENT_SERVICE"',
        ]),
        ...(webWrangler.includes('global_fetch_strictly_public')
            ? [`${webWranglerFile}: public same-zone fetch compatibility flag must not replace the private service binding.`]
            : []),
        ...missingSnippets(path.join('src', 'pages', 'api', 'cron', 'send-reminders.ts'), cronRoute, [
            'CRON_SECRET',
            'Authorization',
            'sendDueReminders',
        ]),
    ];

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'fulfillment Worker runtime boundary',
        message: details.length === 0
            ? 'Fulfillment Worker exposes INTERNAL_JOB_SECRET-authenticated internal endpoints, the Astro Worker delegates jobs through the internal client, and the app cron route gates reminder triggers with CRON_SECRET.'
            : 'Fulfillment Worker or internal client is missing launch-critical runtime hooks.',
        details,
    };
}

function reviewFulfillmentJobRecovery(): Finding {
    const schema = readIfExists(path.join('db', 'schema.sql'));
    const adminEndpoint = readIfExists(path.join('src', 'pages', 'api', 'admin', 'fulfillment-jobs.ts'));
    const manager = readIfExists(path.join('src', 'components', 'admin', 'FulfillmentJobsManager.tsx'));
    const adminPage = readIfExists(path.join('src', 'pages', '[lang]', 'campus', 'admin', 'jobs.astro'));
    const jobs = readIfExists(path.join('src', 'lib', 'fulfillment', 'jobs.ts'));
    const queue = readIfExists(path.join('src', 'lib', 'fulfillment', 'queue.ts'));

    const details = [
        ...missingSnippets(path.join('db', 'schema.sql'), schema, [
            'CREATE TABLE fulfillment_jobs',
            'status TEXT NOT NULL DEFAULT',
            'attempts INTEGER NOT NULL DEFAULT 0',
            'max_attempts INTEGER NOT NULL DEFAULT 5',
            'run_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
            'locked_at TIMESTAMPTZ',
            'last_error TEXT',
            'idx_fulfillment_jobs_due',
            'CREATE TABLE admin_audit_log',
        ]),
        ...missingSnippets(path.join('src', 'lib', 'fulfillment', 'jobs.ts'), jobs, [
            'nextRunAt',
            'processDueFulfillmentJobs',
            'attempts >= job.max_attempts',
            'status: manualReview || exhausted ?',
            'MANUAL_RECONCILIATION_RUN_AT',
            'attempts: job.attempts',
            'last_error',
        ]),
        ...missingSnippets(path.join('src', 'lib', 'fulfillment', 'queue.ts'), queue, [
            'enqueueFulfillmentJob',
            'enqueueWelcomeFulfillment',
            'enqueueSessionFulfillment',
            'enqueueSessionCancellation',
        ]),
        ...missingSnippets(path.join('src', 'pages', 'api', 'admin', 'fulfillment-jobs.ts'), adminEndpoint, [
            'requireAdmin',
            'z.discriminatedUnion',
            "z.literal('retry')",
            "z.literal('cancel')",
            "z.literal('process_due')",
            'admin_audit_log',
            'fulfillment_jobs.process_due',
            'fulfillment_job.retry',
            'fulfillment_job.cancel',
        ]),
        ...missingSnippets(path.join('src', 'components', 'admin', 'FulfillmentJobsManager.tsx'), manager, [
            'process_due',
            'retry',
            'cancel',
            '/api/admin/fulfillment-jobs',
        ]),
        ...missingSnippets(path.join('src', 'pages', '[lang]', 'campus', 'admin', 'jobs.astro'), adminPage, [
            'FulfillmentJobsManager',
            "profile.role !== 'admin'",
        ]),
    ];

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'fulfillment job recovery',
        message: details.length === 0
            ? 'Fulfillment jobs have retry/backoff state, admin recovery actions and audit logging hooks.'
            : 'Fulfillment job recovery or auditability is missing launch-critical pieces.',
        details,
    };
}

function reviewRuntimeEnvironmentDocs(): Finding {
    const environmentDoc = readIfExists(path.join('docs', 'launch', 'ENVIRONMENT.md'));
    const envExample = readIfExists('.env.example');
    const details = [
        ...missingSnippets(path.join('docs', 'launch', 'ENVIRONMENT.md'), environmentDoc, [
            'Cloudflare Astro Worker',
            'Cloudflare Fulfillment Worker',
            'GitHub Environments',
            'debe ser igual en Cloudflare Astro Worker y Cloudflare Fulfillment Worker',
            'Cloudflare Astro Worker no necesita claves Google',
            'pnpm google:setup-staging',
            'KeePassXC',
        ]),
        ...missingSnippets('.env.example', envExample, [
            'PUBLIC_APP_ENV',
            'PUBLIC_SITE_URL',
            'FULFILLMENT_WORKER_URL',
            'INTERNAL_JOB_SECRET',
            'CRON_SECRET',
            'GOOGLE_SERVICE_ACCOUNT_EMAIL',
            'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
            'GOOGLE_ADMIN_EMAIL',
            'GOOGLE_DRIVE_ROOT_FOLDER_ID',
            'GOOGLE_TEMPLATE_DOC_ID',
            'RESEND_API_KEY',
            'EMAIL_FROM',
            'PUBLIC_SENTRY_DSN',
            'TURNSTILE_SECRET_KEY',
        ]),
    ];

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'runtime environment documentation',
        message: details.length === 0
            ? 'Environment documentation and .env.example cover Cloudflare Astro Worker, fulfillment Worker, GitHub, Google, Resend, Sentry and Turnstile.'
            : 'Environment documentation is missing launch-critical runtime variables or setup notes.',
        details,
    };
}

function reviewObservabilityPolicy(): Finding {
    const file = path.join('docs', 'launch', 'OBSERVABILITY.md');
    const content = readIfExists(file);
    const astroConfig = readIfExists('astro.config.mjs');
    const envExample = readIfExists('.env.example');
    const details = [
        ...missingSnippets(file, content, [
            'Observability And Alerts',
            'Sentry es para excepciones tecnicas',
            'telemetria de producto',
            'Alertas Minimas Sentry',
            'New production issue',
            'Regressed issue',
            'Spike de errores',
            'Stripe/webhook',
            'Fulfillment/cron',
            'Support alert failure',
            'SENTRY_UPLOAD_SOURCEMAPS',
            'SENTRY_CAPTURE_LOCAL=false',
            'SENTRY_ENVIRONMENT',
            'local-<NODE_ENV>',
            'Privacy/scrubbing',
            'Fallback Sin Sentry Completo',
            'riskAcceptedBy',
            'pnpm launch:operations',
            'pnpm launch:security',
        ]),
        ...missingSnippets('astro.config.mjs', astroConfig, [
            'SENTRY_UPLOAD_SOURCEMAPS',
            'PUBLIC_SENTRY_DSN',
            'SENTRY_AUTH_TOKEN',
            'sentrySourcemapsEnabled',
            'SENTRY_CAPTURE_LOCAL',
            'sentryCaptureAllowed',
            'sentryEnvironment',
            '__SENTRY_ENVIRONMENT__',
        ]),
        ...missingSnippets('sentry.client.config.ts', readIfExists('sentry.client.config.ts'), [
            '__SENTRY_ENVIRONMENT__',
            'environment: environment || undefined',
        ]),
        ...missingSnippets('sentry.server.config.ts', readIfExists('sentry.server.config.ts'), [
            '__SENTRY_ENVIRONMENT__',
            'environment: environment || undefined',
        ]),
        ...missingSnippets('.env.example', envExample, [
            'SENTRY_AUTH_TOKEN',
            'PUBLIC_SENTRY_DSN',
            'SENTRY_CAPTURE_LOCAL=false',
            'SENTRY_ENVIRONMENT=',
        ]),
    ];

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'observability and alert policy',
        message: details.length === 0
            ? 'Observability policy defines Sentry alert coverage, privacy boundaries, fallback visibility and manual evidence rules.'
            : 'Observability or Sentry alert policy is missing launch-critical details.',
        details,
    };
}

function reviewGoogleCalendarAccountRunbook(): Finding {
    const file = path.join('docs', 'launch', 'GOOGLE_CALENDAR_ACCOUNT.md');
    const content = readIfExists(file);
    const environment = readIfExists(path.join('docs', 'launch', 'ENVIRONMENT.md'));
    const finalClosure = readIfExists(path.join('docs', 'launch', 'FINAL_CLOSURE.md'));
    const calendarClient = readIfExists(path.join('src', 'lib', 'google', 'calendar.ts'));
    const googleConfig = readIfExists(path.join('src', 'lib', 'google', 'config.ts'));
    const details = [
        ...missingSnippets(file, content, [
            'Google Calendar Account Decision',
            'GOOGLE_ADMIN_EMAIL',
            'profiles.email',
            'calendar_email',
            'fernandialejandro@gmail.com',
            'FreeBusy',
            'sessions.calendar_event_id',
            'sessions.meet_link',
            'Smoke Final',
            'No guardar en el repo',
        ]),
        ...missingSnippets(path.join('docs', 'launch', 'ENVIRONMENT.md'), environment, [
            'docs/launch/GOOGLE_CALENDAR_ACCOUNT.md',
            'profiles.email',
        ]),
        ...missingSnippets(path.join('docs', 'launch', 'FINAL_CLOSURE.md'), finalClosure, [
            'docs/launch/GOOGLE_CALENDAR_ACCOUNT.md',
        ]),
        ...missingSnippets(path.join('src', 'lib', 'google', 'config.ts'), googleConfig, [
            'GOOGLE_ADMIN_EMAIL',
            'adminEmail',
        ]),
        ...missingSnippets(path.join('src', 'lib', 'google', 'calendar.ts'), calendarClient, [
            "calendarId: 'primary'",
            'teacherEmail',
            'checkTeacherAvailability',
            'createClassEvent',
            'cancelClassEvent',
        ]),
    ];

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'Google Calendar account decision',
        message: details.length === 0
            ? 'Google Calendar account behavior is documented: events use GOOGLE_ADMIN_EMAIL primary calendar, teacher availability uses profiles.email, and separate calendar_email is a deliberate model change.'
            : 'Google Calendar account behavior or final smoke requirements are missing from launch operations guidance.',
        details,
    };
}

function reviewSupabaseBackupRunbook(): Finding {
    const file = path.join('docs', 'launch', 'SUPABASE_BACKUP_RUNBOOK.md');
    const content = readIfExists(file);
    const finalClosure = readIfExists(path.join('docs', 'launch', 'FINAL_CLOSURE.md'));
    const backlog = readIfExists(path.join('docs', 'launch', 'POST_LAUNCH_BACKLOG.md'));
    const details = [
        ...missingSnippets(file, content, [
            'Supabase Backup Runbook',
            'Supabase Free',
            'launch:supabase-production-post-closure-backup',
            'launch:supabase-production-post-closure-backup:verify',
            'production-inert-final-receipt.json',
            'RC_BASE_SHA',
            'HEAD = origin/main =',
            'último intento real',
            'al menos 5 minutos',
            "apertura exclusiva `wx`",
            '22 tablas públicas',
            'Windows EFS',
            'Upgrade Pro',
            'Riesgo aceptado',
            'Nunca guardar dumps',
            'pg_dump',
            'pg_dump --no-owner --no-privileges',
            'segundo GET Auth',
            'lecturas SQL exactas',
            'ownership/privilegios',
            'networkAccessPerformed=false',
            'credentialEnvironmentRead=false',
            'databaseReadPerformed=false',
            'pg_restore --list',
            'tabletop',
            'database_readiness',
            'pnpm launch:operations',
        ]),
        ...missingSnippets(path.join('docs', 'launch', 'FINAL_CLOSURE.md'), finalClosure, [
            'docs/launch/SUPABASE_BACKUP_RUNBOOK.md',
        ]),
        ...missingSnippets(path.join('docs', 'launch', 'POST_LAUNCH_BACKLOG.md'), backlog, [
            'docs/launch/SUPABASE_BACKUP_RUNBOOK.md',
        ]),
    ];

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'Supabase Free backup/export runbook',
        message: details.length === 0
            ? 'Supabase Free has a SHA-bound post-closure backup runner with fresh inert evidence, exclusive EFS output, exact inventory/TOC checks and a documented fallback.'
            : 'Supabase Free backup/export runbook is missing the current post-closure safety contract.',
        details,
    };
}

function reviewOperationsRunbook(): Finding {
    const file = path.join('docs', 'launch', 'RUNBOOK.md');
    const content = readIfExists(file);
    const details = missingSnippets(file, content, [
        'Pago completado sin suscripcion',
        'Suscripcion sin Drive/email',
        'Clase sin Meet/Doc/email',
        'Recordatorio no enviado',
        'Paquete activo sin checkout',
        'Deploy',
        'Rollback',
        'Cloudflare',
        'Cloudflare Fulfillment Worker',
        'Base de datos',
        'Simulacro De Incidente Y Rollback',
        'Escenario Minimo RC',
        'Escenario De Rollback Tabletop',
        'Criterio De Cierre Del Simulacro',
        'Admin > Tickets soporte',
        'riskAcceptedBy',
        'pnpm launch:operations',
        'Go/No-Go Tecnico',
        'Fulfillment Worker `/health` responde 200',
        'Admin > Jobs ve y procesa jobs',
        'Compra test completa crea Drive/email',
        'Reserva test crea Doc/Meet/email',
    ]);

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'operations runbook',
        message: details.length === 0
            ? 'Runbook covers critical incidents, deploy, rollback and final technical Go/No-Go smoke.'
            : 'Runbook is missing launch-critical operational procedures.',
        details,
    };
}

function reviewRcOperationalGate(): Finding {
    const helperFile = path.join('scripts', 'launch', 'rc-operational-checklist.ts');
    const statusFile = path.join('scripts', 'launch', 'status.ts');
    const secondaryFile = path.join('scripts', 'launch', 'secondary-review.ts');
    const checklistFile = path.join('docs', 'launch', 'CHECKLIST.md');
    const details = [
        ...missingSnippets(helperFile, readIfExists(helperFile), [
            'incident_simulation',
            'sentry_alerts',
            'rollback_proof',
            'collectOpenRcOperationalBlockers',
            'hasExplicitRcOperationalClosureEvidence',
            'missing from ## Operacion',
            'incomplete_evidence',
            'Riesgo aceptado por',
        ]),
        ...missingSnippets(statusFile, readIfExists(statusFile), [
            'collectOpenRcOperationalBlockers',
            'rcOperationalOpenChecks',
            'RC_BLOCKED_BY_RELEASE_CANDIDATE_CHECKS',
        ]),
        ...missingSnippets(secondaryFile, readIfExists(secondaryFile), [
            'collectOpenRcOperationalBlockers',
            'release candidate operational blockers',
        ]),
        ...missingSnippets(checklistFile, readIfExists(checklistFile), [
            'Las filas de simulacro de incidente, alertas Sentry y rollback son bloqueadores del Release Candidate',
        ]),
    ];

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'release candidate operational gate',
        message: details.length === 0
            ? 'Release Candidate and secondary-review gates fail closed on incident simulation, Sentry alerts and rollback proof.'
            : 'Release Candidate operational blockers are not wired fail-closed into launch status and secondary review.',
        details,
    };
}

function missingSnippets(file: string, content: string, snippets: string[]): string[] {
    return snippets
        .filter((snippet) => !content.includes(snippet))
        .map((snippet) => `${file}: missing ${snippet}.`);
}

function readIfExists(file: string): string {
    return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

function renderMarkdown(report: OperationsReport): string {
    const lines = [
        '# Launch Operations Audit',
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
    lines.push('This automated audit checks launch-critical operational configuration, recovery hooks and documentation. It does not replace the already closed live staging evidence, the SHA-bound post-closure backup, or the final production smoke of Cloudflare, Stripe, Google Workspace, Resend and cron execution.');
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function renderOperationsReadinessWorksheet(report: OperationsReport): string {
    const lines = [
        '# Operations Readiness Worksheet',
        '',
        `- Status: ${report.status}`,
        `- Generated: ${report.endedAt}`,
        `- Output: ${report.outputDir}`,
        '',
        '## Rule',
        '',
        'Use this worksheet while filling `operations_external` in `docs/launch/MANUAL_EVIDENCE.local.json`. Do not paste secrets, private keys, full tokens, customer private data or unredacted dashboard URLs with embedded credentials.',
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
    lines.push('| Cloudflare fulfillment Worker | Staging and production bootstrap are already closed. For a fresh pre-write readback, use `pnpm launch:cloudflare-production-runtime-readonly`; verify the exact account, both production Worker names, current versions, HMAC-only posture, zero Cron/providers and inactive Queue wiring. Do not replay C-D-E because a GET receipt expired. | `dashboard` plus `manual_note` with service names, environments and result; secret names are OK, secret values are not. |');
    lines.push('| fulfillment_jobs | Inspect a due or test job, run process_due, retry and cancel from Admin > Jobs, and confirm `admin_audit_log` records the action. | `dashboard`, `path` to runbook, or `manual_note`; no private user data. |');
    lines.push('| Google Workspace | For RC, confirm only the staging/read-only checks already in scope. If Google Drive/templates are unclear or risky, keep them in final-only closure and do not block RC on them. | `dashboard` or `manual_note` with IDs shortened/redacted. |');
    lines.push('| Resend email | Verify sender/domain, test delivery, event visibility, bounce/suppression handling and reply/support route. | `dashboard`, `screenshot` redacted or `manual_note`. |');
    lines.push('| cron and reminders | Verify Cloudflare cron/API path, `CRON_SECRET`, `INTERNAL_JOB_SECRET`, `FULFILLMENT_WORKER_URL`, site URL alignment and reminder logs. | `dashboard` or `manual_note` with environment and timestamp. |');
    lines.push('| backups and rollback | Confirm Supabase Free backup posture, Cloudflare Worker rollback route, and the rollback section in `docs/launch/RUNBOOK.md`. After merging the RC, follow `docs/launch/SUPABASE_BACKUP_RUNBOOK.md`: fresh inert receipt, SHA-bound post-closure logical backup to a new EFS destination, exact TOC/inventory verification, Pro upgrade, or an explicit accepted risk. | `command_output` receipt without path, `path` to `docs/launch/RUNBOOK.md`, `path` to `docs/launch/SUPABASE_BACKUP_RUNBOOK.md`, or `manual_note`; never the dump or connection string. |');
    lines.push('| incident and rollback drill | Confirm the `Simulacro De Incidente Y Rollback` in `docs/launch/RUNBOOK.md` has been walked through: staging job/ticket incident, owner decision, recovery action, rollback tabletop or real rollback, and post-checks. | `manual_note`, redacted screenshots, or accepted risk with rollback plan; no secrets or private data. |');
    lines.push('| incidents and monitoring | Confirm Sentry alerts, support process, owner escalation and where launch incidents are tracked. Use `docs/launch/OBSERVABILITY.md` for minimum alert coverage and fallback rules. | `dashboard` or `manual_note`. |');
    lines.push('');
    lines.push('## Completion');
    lines.push('');
    lines.push('Mark `operations_external` as `pass` only when the RC operations baseline above has been checked. Command output from `pnpm launch:operations` is support evidence, not a replacement for external verification. Production bootstrap is closed; the post-closure backup belongs to the technical RC goal, while active providers, domains, checkout and final Drive smoke remain final-only.');
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function renderDatabaseReadinessWorksheet(report: OperationsReport): string {
    const lines = [
        '# Database Readiness Worksheet',
        '',
        `- Status: ${report.status}`,
        `- Generated: ${report.endedAt}`,
        `- Output: ${report.outputDir}`,
        '',
        '## Rule',
        '',
        'Use this worksheet while filling `database_readiness` in `docs/launch/MANUAL_EVIDENCE.local.json`. Do not paste service role keys, auth tokens, full user records, payment data, private student data or screenshots that reveal private rows.',
        '',
        '## Automated References',
        '',
        '| File | Why It Matters |',
        '| --- | --- |',
        '| `db/schema.sql` | Official schema source for launch review. |',
        '| `supabase/migrations/` | Deployment SQL that must match the applied environment state. |',
        '| `supabase/migrations/010_node_fulfillment_runtime.sql` | Adds runtime support for fulfillment job processing. |',
        '| `supabase/migrations/011_fix_auth_user_trigger_search_path.sql` | Fixes auth user trigger search path hardening. |',
        `| \`${toPosix(path.relative(process.cwd(), report.hostedSchemaDriftWorksheetPath))}\` | Generated worksheet for hosted schema drift review without reading private rows. |`,
        `| \`${toPosix(path.relative(process.cwd(), report.hostedSchemaCheckSqlPath))}\` | Read-only SQL for Supabase SQL editor or psql; checks metadata only. |`,
        `| \`${toPosix(path.relative(process.cwd(), report.hostedSchemaClosurePlanPath))}\` | Safe closure plan for deciding, applying and verifying hosted schema drift without storing secrets. |`,
        '',
        '## Manual Checks',
        '',
        '| Check | How To Verify | Evidence To Record |',
        '| --- | --- | --- |',
        '| migrations | Confirm staging and production have applied expected migrations and match `db/schema.sql`. | `dashboard` or `manual_note` with environment and latest migration. |',
        '| RLS | Review policies for `profiles`, `profiles_private`, `payments`, `subscriptions`, `sessions`, `student_teachers`, `fulfillment_jobs` and `admin_audit_log`. | `dashboard` or `manual_note` with tables reviewed and result. |',
        '| staging assignments | Confirm a staging teacher-student assignment exists and works without production data. | `manual_note` with test account aliases, not private data. |',
        '| subscriptions | Confirm staging active subscription/payment state is coherent for a test student. | `dashboard` or `manual_note`; no card/customer private data. |',
        '| backups | On Supabase Free, follow `docs/launch/SUPABASE_BACKUP_RUNBOOK.md`: bind a fresh inert receipt and canonical SHA to a new EFS destination, then record only the post-closure receipt/hash/TOC result, a Pro-upgrade action or explicit accepted risk. | `command_output` receipt without path, `path` to `docs/launch/SUPABASE_BACKUP_RUNBOOK.md` or `manual_note`; never the dump or credentials. |',
        '| auditability | Confirm `admin_audit_log` and `fulfillment_jobs` are visible to admins and useful for recovery. | `dashboard`, `path` or `manual_note`. |',
        '| service role exposure | Confirm service role is server-only and dashboard/API keys are scoped to the intended environments. | `manual_note` or `dashboard`; never paste key values. |',
        '| monitoring | Confirm slow/error query visibility, database logs and escalation owner. | `dashboard` or `manual_note`. |',
        '| Supabase Advisor | Review security advisor findings before Go/No-Go: leaked password protection, extension `btree_gist` in `public`, legacy tables such as production `public.jobs`, and whether staging migration history intentionally differs from production. | `dashboard` or `manual_note` with decisions: fixed, accepted risk, or post-launch backlog. |',
        '',
        '## Supabase/Postgres Focus',
        '',
        'Treat RLS, migrations, documented backup posture, privileged-key containment, indexes for critical flows and monitoring as launch-critical. Performance tuning can continue after launch, but security and recoverability cannot be hand-waved.',
        '',
        '## Completion',
        '',
        'Mark `database_readiness` as `pass` only when the live/staging Supabase state has been checked directly. Local schema files are references; they do not prove that the hosted database is ready.',
        '',
    ];

    lines.push('## Related Operations Findings');
    lines.push('');
    lines.push('| Status | Area | Message |');
    lines.push('| --- | --- | --- |');
    appendFindingsTable(lines, report.findings);
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function renderHostedSchemaClosurePlan(report: OperationsReport): string {
    const checkSqlPath = toPosix(path.relative(process.cwd(), report.hostedSchemaCheckSqlPath));
    const driftWorksheetPath = toPosix(path.relative(process.cwd(), report.hostedSchemaDriftWorksheetPath));
    const lines = [
        '# Hosted Supabase Schema Closure Record (Read-Only)',
        '',
        `- Status: ${report.status}`,
        `- Generated: ${report.endedAt}`,
        `- Output: ${report.outputDir}`,
        `- Read-only check SQL: ${checkSqlPath}`,
        `- Drift worksheet: ${driftWorksheetPath}`,
        '',
        '## Scope',
        '',
        'This record summarizes the hosted Supabase schema closure already completed for the no-real-payments RC. It is diagnostic and read-only: it must not be used to apply or replay migrations, Auth reduction, availability or any other remote write.',
        '',
        '## Current Known Drift',
        '',
        '- Staging records the full RC plus its two staging-only migrations. Production completed the 25-migration allowlist on 2026-07-17 and now has 49 historical entries, with both staging-only migrations absent by design.',
        '- Production contains the current lead enrichment, CRM, billing and fulfillment schema, but its transactional/CRM/billing/fulfillment rows are empty while the environment remains inert.',
        '- Production retains exactly the minimal admin and teacher identities/profiles, four canonical packages and five teacher availability rows; signup and checkout remain disabled.',
        '- The remaining database task for this technical RC is the fresh SHA-bound post-closure `public + auth` backup. Do not reopen rollout, Auth reduction or availability because a read-only receipt expired.',
        '',
        '## Guardrails',
        '',
        '- Do not paste database URLs, passwords, service role keys, JWTs or private screenshots into repo files, outputs or manual evidence.',
        '- Do not replay the completed 25-migration production rollout, Auth reduction or five availability rows merely because renewable evidence expired.',
        '- Use `docs/launch/SUPABASE_BACKUP_RUNBOOK.md` only for the SHA-bound post-closure logical backup and its offline revalidation; it does not authorize database writes.',
        '- If a new read-only mismatch is proven, stop and prepare a new narrowly scoped incident/repair proposal with its own target, backup, approval, verification and rollback. This record is not that proposal.',
        '',
        '## Read-Only Preflight',
        '',
        '1. Confirm the exact target before reading: staging `espanol-staging` and production `espanol-honesto` remain separate projects with separate histories.',
        `2. Run \`${checkSqlPath}\` under a read-only transaction in the Supabase SQL editor or via ` + '`psql` with credentials managed outside this repo.',
        '3. Record only non-secret aggregate evidence: target project/ref, timestamp, missing count and missing metadata names.',
        '4. If either project has missing critical metadata, keep `database_readiness` pending and stop; do not apply migrations from this generated record.',
        '',
        '## Completed Migration History (Non-Executable)',
        '',
        'The 2026-07-17 production receipt proves the completed 25-migration allowlist and the required lead, CRM, billing and fulfillment objects. The committed files remain the source history, not an execution queue. Do not replay any migration from this worksheet.',
        '',
        '- Production: 49 history entries, including the 25 RC migrations, with both staging-only migrations absent by design.',
        '- Staging: full RC history plus its two staging-only migrations.',
        '- Current production row posture: minimal admin/teacher identities, four packages, five availability rows and empty transactional/CRM/billing/fulfillment tables while inert.',
        '',
        '## Read-Only Follow-Up',
        '',
        '1. Rerun the hosted schema check SQL independently in staging and production and confirm missing critical metadata is `0` without writes.',
        '2. Review Supabase Advisors for security and performance. Security issues must be fixed, explicitly accepted or moved to a dated final-only/post-launch decision.',
        '3. Check recent Postgres/API logs for absence of missing-column or missing-relation errors involving `leads.current_level`, `leads.level_check_status`, CRM tables or task related-entity fields.',
        '4. Rerun local support gates: `pnpm launch:operations`, `pnpm launch:manual-evidence`, `pnpm launch:phase1`, `pnpm launch:status`.',
        '5. Record only non-secret evidence in `docs/launch/MANUAL_EVIDENCE.local.json`.',
        '',
        '## Evidence Template',
        '',
        'Use this as a shape, not as a command:',
        '',
        '```json',
        '{',
        '  "id": "database_readiness",',
        '  "status": "pass",',
        '  "owner": "Alin",',
        '  "environment": "staging-first-then-production-if-in-scope",',
        '  "summary": "Hosted schema closed for RC: staging and production verified in their separate migration histories; production rollout/Auth/availability remain closed and the SHA-bound post-closure backup is tracked separately.",',
        '  "evidence": [',
        '    {',
        '      "type": "manual_note",',
        '      "value": "Hosted schema check run on <project/ref> at <timestamp>; missing critical metadata count: 0. No private rows or secrets recorded."',
        '    },',
        '    {',
        '      "type": "command_output",',
        `      "value": "../../${driftWorksheetPath}",`,
        '      "note": "Generated worksheet followed."',
        '    }',
        '  ]',
        '}',
        '```',
        '',
    ];

    return `${lines.join('\n')}\n`;
}

function renderHostedSchemaDriftWorksheet(report: OperationsReport): string {
    const sqlPath = toPosix(path.relative(process.cwd(), report.hostedSchemaCheckSqlPath));
    const lines = [
        '# Hosted Supabase Schema Drift Worksheet',
        '',
        `- Status: ${report.status}`,
        `- Generated: ${report.endedAt}`,
        `- Output: ${report.outputDir}`,
        `- Read-only SQL: ${sqlPath}`,
        '',
        '## Rule',
        '',
        'Use this worksheet only for read-only hosted schema checks. Do not paste service role keys, database URLs, passwords, JWTs, full user records, lead answers, payment data or screenshots that reveal private rows.',
        '',
        '## What This Checks',
        '',
        'The SQL checks metadata in `information_schema`, `pg_indexes`, `pg_class`, `pg_policies` and table privileges; it does not select from application tables. It is designed to catch the exact class of drift where the current code expects launch columns, CRM tables, RLS policies or role access that the hosted Supabase project has not yet applied.',
        '',
        'Critical areas covered:',
        '',
        '- Lead application enrichment: `leads.current_level`, `learning_goal`, `availability`, `source_path`, `preferred_package`.',
        '- CRM links and core tables: `crm_contacts`, `crm_opportunities`, `crm_tasks`, `crm_activities`, `crm_consents`, plus `leads.crm_contact_id` and `leads.crm_opportunity_id`.',
        '- CRM task targeting: `crm_tasks.related_entity_type`, `crm_tasks.related_entity_id`, `crm_tasks.metadata`.',
        '- Language fit: `leads.spoken_languages`, `leads.is_russian_speaker`.',
        '- Lightweight diagnostic: `leads.level_check_status`, `level_check_context`, `level_check_summary`, `level_check_received_at`, `level_check_reviewed_at`, `level_check_raw_cleared_at`.',
        '- Supabase access posture: RLS enabled for launch-critical tables, admin policies present for lead/CRM tables, and explicit `authenticated`/`service_role` table privileges visible for Data API access.',
        '',
        '## How To Run Safely',
        '',
        '1. Confirm the target project before running: staging `espanol-staging` first; production `espanol-honesto` only after staging passes and Alin confirms the production window.',
        '2. Run the SQL from the generated file in the Supabase SQL editor or with `psql` using credentials managed outside this repo.',
        '3. Record only aggregate results: project name/ref, timestamp, `missing_count`, and a short list of missing table/column/index/RLS/policy/privilege names.',
        '4. If anything is missing in staging, fix or scope it before production. If anything is missing in production, do not mark `database_readiness` as pass. Apply or verify production migrations only after explicit production-write confirmation and backup posture review.',
        '5. After applying/verifying migrations, rerun this SQL and confirm every expected table/column/index/RLS/policy/privilege is present.',
        '',
        '## Evidence To Record',
        '',
        '- `manual_note`: target project, timestamp, result, missing_count, and whether the migration drift is closed.',
        '- `command_output`: this worksheet path and the generated operations summary path.',
        '- `dashboard`: optional dashboard note, redacted and without private rows.',
        '',
        '## Related Local Migrations',
        '',
        '- `supabase/migrations/018_enrich_leads_for_application.sql`',
        '- `supabase/migrations/019_capture_preferred_package_on_leads.sql`',
        '- `supabase/migrations/020_enforce_profile_role_links.sql`',
        '- `supabase/migrations/20260624163423_add_crm_core.sql`',
        '- `supabase/migrations/20260624185757_add_crm_task_related_entity.sql`',
        '- `supabase/migrations/20260625213116_capture_lead_languages.sql`',
        '- `supabase/migrations/20260625215008_add_lightweight_level_check_to_leads.sql`',
        '',
    ];

    return `${lines.join('\n')}\n`;
}

function renderHostedSchemaCheckSql(): string {
    return `-- Read-only hosted Supabase schema drift check for Espanol Honesto RC.
-- Safe scope: metadata only. This does not read application table rows.
-- Run against the explicitly selected Supabase project, then record only aggregate/non-secret evidence.

with expected_tables(schema_name, table_name, why) as (
    values
        ('public', 'leads', 'lead application and diagnostic state'),
        ('public', 'crm_contacts', 'custom CRM contact source of truth'),
        ('public', 'crm_opportunities', 'custom CRM opportunity pipeline'),
        ('public', 'crm_tasks', 'human follow-up and SLA queue'),
        ('public', 'crm_activities', 'CRM event traceability'),
        ('public', 'crm_consents', 'sales/marketing consent separation'),
        ('public', 'fulfillment_jobs', 'post-payment and class fulfillment recovery'),
        ('public', 'admin_audit_log', 'admin recovery/audit traceability')
),
expected_columns(schema_name, table_name, column_name, why) as (
    values
        ('public', 'leads', 'current_level', 'lead application level and admin filtering'),
        ('public', 'leads', 'learning_goal', 'lead fit and proposal context'),
        ('public', 'leads', 'availability', 'manual scheduling fit'),
        ('public', 'leads', 'source_path', 'conversion/source traceability'),
        ('public', 'leads', 'preferred_package', 'selected public plan before application'),
        ('public', 'leads', 'crm_contact_id', 'legacy lead to CRM contact link'),
        ('public', 'leads', 'crm_opportunity_id', 'legacy lead to CRM opportunity link'),
        ('public', 'leads', 'spoken_languages', 'language background and Russian-speaker fit'),
        ('public', 'leads', 'is_russian_speaker', 'Russian-speaker segmentation'),
        ('public', 'leads', 'level_check_status', 'lightweight diagnostic workflow state'),
        ('public', 'leads', 'level_check_context', 'temporary raw diagnostic context'),
        ('public', 'leads', 'level_check_summary', 'CRM-safe diagnostic summary'),
        ('public', 'leads', 'level_check_estimated_level', 'manual diagnostic level estimate'),
        ('public', 'leads', 'level_check_confidence', 'manual diagnostic confidence'),
        ('public', 'leads', 'level_check_plan_recommendation', 'plan recommendation after diagnostic'),
        ('public', 'leads', 'level_check_fit_flags', 'fit flags after diagnostic'),
        ('public', 'leads', 'level_check_received_at', 'diagnostic received timestamp'),
        ('public', 'leads', 'level_check_reviewed_at', 'diagnostic reviewed timestamp'),
        ('public', 'leads', 'level_check_raw_cleared_at', 'raw diagnostic retention proof'),
        ('public', 'crm_contacts', 'primary_email', 'CRM contact identity'),
        ('public', 'crm_contacts', 'lifecycle_stage', 'CRM lifecycle state'),
        ('public', 'crm_opportunities', 'stage', 'sales pipeline stage'),
        ('public', 'crm_opportunities', 'legacy_lead_id', 'lead/opportunity synchronization'),
        ('public', 'crm_tasks', 'status', 'open/snoozed/done task queue'),
        ('public', 'crm_tasks', 'related_entity_type', 'task source linking'),
        ('public', 'crm_tasks', 'related_entity_id', 'task source linking'),
        ('public', 'crm_tasks', 'metadata', 'task operational context'),
        ('public', 'crm_activities', 'activity_type', 'CRM event type'),
        ('public', 'crm_activities', 'related_entity_type', 'activity source linking'),
        ('public', 'crm_activities', 'related_entity_id', 'activity source linking'),
        ('public', 'crm_consents', 'purpose', 'transactional/marketing/sales separation'),
        ('public', 'crm_consents', 'legal_basis', 'email consent enforcement'),
        ('public', 'fulfillment_jobs', 'status', 'job recovery status'),
        ('public', 'admin_audit_log', 'action', 'admin audit event')
),
expected_indexes(schema_name, index_name, why) as (
    values
        ('public', 'leads_level_check_status_idx', 'diagnostic admin queue'),
        ('public', 'leads_spoken_languages_idx', 'language fit filtering'),
        ('public', 'leads_is_russian_speaker_idx', 'Russian-speaker filtering'),
        ('public', 'crm_tasks_related_entity_idx', 'CRM task cleanup and dashboard pulse'),
        ('public', 'crm_contacts_primary_email_lower_unique', 'CRM duplicate prevention')
),
expected_rls(schema_name, table_name, why) as (
    values
        ('public', 'leads', 'lead forms contain personal contact and diagnostic data'),
        ('public', 'crm_contacts', 'CRM contact personal data'),
        ('public', 'crm_opportunities', 'sales pipeline personal data'),
        ('public', 'crm_tasks', 'human follow-up queue'),
        ('public', 'crm_activities', 'CRM activity timeline'),
        ('public', 'crm_consents', 'consent records'),
        ('public', 'fulfillment_jobs', 'internal job recovery state'),
        ('public', 'admin_audit_log', 'admin audit trail')
),
expected_policies(schema_name, table_name, policy_name, command_name, role_name, why) as (
    values
        ('public', 'leads', 'Admins can manage leads', 'ALL', 'authenticated', 'admin-only lead management'),
        ('public', 'leads', 'Admins can view leads', 'SELECT', 'authenticated', 'admin-only lead review'),
        ('public', 'crm_contacts', 'Admins can manage crm contacts', 'ALL', 'authenticated', 'admin-only CRM contacts'),
        ('public', 'crm_opportunities', 'Admins can manage crm opportunities', 'ALL', 'authenticated', 'admin-only CRM opportunities'),
        ('public', 'crm_tasks', 'Admins can manage crm tasks', 'ALL', 'authenticated', 'admin-only CRM task queue'),
        ('public', 'crm_activities', 'Admins can manage crm activities', 'ALL', 'authenticated', 'admin-only CRM timeline'),
        ('public', 'crm_consents', 'Admins can manage crm consents', 'ALL', 'authenticated', 'admin-only consent operations')
),
expected_privileges(schema_name, table_name, grantee, privilege_type, why) as (
    values
        ('public', 'leads', 'authenticated', 'SELECT', 'admin RLS lead review through authenticated role'),
        ('public', 'leads', 'authenticated', 'INSERT', 'admin RLS lead creation if needed through authenticated role'),
        ('public', 'leads', 'authenticated', 'UPDATE', 'admin RLS lead status and diagnostic updates'),
        ('public', 'leads', 'authenticated', 'DELETE', 'admin RLS lead cleanup when explicitly needed'),
        ('public', 'leads', 'service_role', 'SELECT', 'server-side lead review and CRM sync'),
        ('public', 'leads', 'service_role', 'INSERT', 'server-side lead capture'),
        ('public', 'leads', 'service_role', 'UPDATE', 'server-side lead status and diagnostic updates'),
        ('public', 'leads', 'service_role', 'DELETE', 'server-side lead cleanup when explicitly needed'),
        ('public', 'crm_contacts', 'authenticated', 'SELECT', 'admin RLS CRM contact reads'),
        ('public', 'crm_contacts', 'authenticated', 'INSERT', 'admin RLS CRM contact creation'),
        ('public', 'crm_contacts', 'authenticated', 'UPDATE', 'admin RLS CRM contact updates'),
        ('public', 'crm_contacts', 'authenticated', 'DELETE', 'admin RLS CRM contact cleanup'),
        ('public', 'crm_contacts', 'service_role', 'SELECT', 'server-side CRM reads'),
        ('public', 'crm_contacts', 'service_role', 'INSERT', 'server-side CRM contact creation'),
        ('public', 'crm_contacts', 'service_role', 'UPDATE', 'server-side CRM contact updates'),
        ('public', 'crm_contacts', 'service_role', 'DELETE', 'server-side CRM contact cleanup'),
        ('public', 'crm_opportunities', 'authenticated', 'SELECT', 'admin RLS CRM pipeline reads'),
        ('public', 'crm_opportunities', 'authenticated', 'INSERT', 'admin RLS CRM opportunity creation'),
        ('public', 'crm_opportunities', 'authenticated', 'UPDATE', 'admin RLS CRM opportunity updates'),
        ('public', 'crm_opportunities', 'authenticated', 'DELETE', 'admin RLS CRM opportunity cleanup'),
        ('public', 'crm_opportunities', 'service_role', 'SELECT', 'server-side CRM pipeline reads'),
        ('public', 'crm_opportunities', 'service_role', 'INSERT', 'server-side CRM opportunity creation'),
        ('public', 'crm_opportunities', 'service_role', 'UPDATE', 'server-side CRM opportunity updates'),
        ('public', 'crm_opportunities', 'service_role', 'DELETE', 'server-side CRM opportunity cleanup'),
        ('public', 'crm_tasks', 'authenticated', 'SELECT', 'admin RLS CRM task reads'),
        ('public', 'crm_tasks', 'authenticated', 'INSERT', 'admin RLS CRM task creation'),
        ('public', 'crm_tasks', 'authenticated', 'UPDATE', 'admin RLS CRM task completion/snooze'),
        ('public', 'crm_tasks', 'authenticated', 'DELETE', 'admin RLS CRM task cleanup'),
        ('public', 'crm_tasks', 'service_role', 'SELECT', 'server-side CRM task reads'),
        ('public', 'crm_tasks', 'service_role', 'INSERT', 'server-side CRM task creation'),
        ('public', 'crm_tasks', 'service_role', 'UPDATE', 'server-side CRM task completion/snooze'),
        ('public', 'crm_tasks', 'service_role', 'DELETE', 'server-side CRM task cleanup'),
        ('public', 'crm_activities', 'authenticated', 'SELECT', 'admin RLS CRM activity reads'),
        ('public', 'crm_activities', 'authenticated', 'INSERT', 'admin RLS CRM activity creation'),
        ('public', 'crm_activities', 'authenticated', 'UPDATE', 'admin RLS CRM activity correction'),
        ('public', 'crm_activities', 'authenticated', 'DELETE', 'admin RLS CRM activity cleanup'),
        ('public', 'crm_activities', 'service_role', 'SELECT', 'server-side CRM activity reads'),
        ('public', 'crm_activities', 'service_role', 'INSERT', 'server-side CRM activity creation'),
        ('public', 'crm_activities', 'service_role', 'UPDATE', 'server-side CRM activity correction'),
        ('public', 'crm_activities', 'service_role', 'DELETE', 'server-side CRM activity cleanup'),
        ('public', 'crm_consents', 'authenticated', 'SELECT', 'admin RLS consent reads'),
        ('public', 'crm_consents', 'authenticated', 'INSERT', 'admin RLS consent capture'),
        ('public', 'crm_consents', 'authenticated', 'UPDATE', 'admin RLS consent opt-out/update'),
        ('public', 'crm_consents', 'authenticated', 'DELETE', 'admin RLS consent cleanup'),
        ('public', 'crm_consents', 'service_role', 'SELECT', 'server-side consent enforcement'),
        ('public', 'crm_consents', 'service_role', 'INSERT', 'server-side consent capture'),
        ('public', 'crm_consents', 'service_role', 'UPDATE', 'server-side consent opt-out/update'),
        ('public', 'crm_consents', 'service_role', 'DELETE', 'server-side consent cleanup'),
        ('public', 'fulfillment_jobs', 'service_role', 'SELECT', 'server-side job recovery reads'),
        ('public', 'fulfillment_jobs', 'service_role', 'INSERT', 'server-side job enqueue'),
        ('public', 'fulfillment_jobs', 'service_role', 'UPDATE', 'server-side job processing'),
        ('public', 'admin_audit_log', 'service_role', 'INSERT', 'server-side admin audit logging')
),
table_status as (
    select
        'table' as object_type,
        e.schema_name,
        e.table_name as object_name,
        null::text as column_name,
        case when t.table_name is null then 'missing' else 'present' end as status,
        e.why
    from expected_tables e
    left join information_schema.tables t
        on t.table_schema = e.schema_name
       and t.table_name = e.table_name
),
column_status as (
    select
        'column' as object_type,
        e.schema_name,
        e.table_name as object_name,
        e.column_name,
        case when c.column_name is null then 'missing' else 'present' end as status,
        e.why
    from expected_columns e
    left join information_schema.columns c
        on c.table_schema = e.schema_name
       and c.table_name = e.table_name
       and c.column_name = e.column_name
),
index_status as (
    select
        'index' as object_type,
        e.schema_name,
        e.index_name as object_name,
        null::text as column_name,
        case when i.indexname is null then 'missing' else 'present' end as status,
        e.why
    from expected_indexes e
    left join pg_indexes i
        on i.schemaname = e.schema_name
       and i.indexname = e.index_name
),
rls_status as (
    select
        'rls' as object_type,
        e.schema_name,
        e.table_name as object_name,
        null::text as column_name,
        case when coalesce(c.relrowsecurity, false) then 'present' else 'missing' end as status,
        e.why
    from expected_rls e
    left join pg_namespace n
        on n.nspname = e.schema_name
    left join pg_class c
        on c.relnamespace = n.oid
       and c.relname = e.table_name
       and c.relkind in ('r', 'p')
),
policy_status as (
    select
        'policy' as object_type,
        e.schema_name,
        e.table_name as object_name,
        e.policy_name as column_name,
        case when p.policyname is null then 'missing' else 'present' end as status,
        e.why
    from expected_policies e
    left join pg_policies p
        on p.schemaname = e.schema_name
       and p.tablename = e.table_name
       and p.policyname = e.policy_name
       and p.cmd = e.command_name
       and e.role_name = any(p.roles)
),
privilege_status as (
    select
        'privilege' as object_type,
        e.schema_name,
        e.table_name as object_name,
        e.grantee || ':' || e.privilege_type as column_name,
        case
            when to_regclass(format('%I.%I', e.schema_name, e.table_name)) is null then 'missing'
            when has_table_privilege(e.grantee, format('%I.%I', e.schema_name, e.table_name), e.privilege_type) then 'present'
            else 'missing'
        end as status,
        e.why
    from expected_privileges e
),
combined as (
    select * from table_status
    union all
    select * from column_status
    union all
    select * from index_status
    union all
    select * from rls_status
    union all
    select * from policy_status
    union all
    select * from privilege_status
)
select
    object_type,
    schema_name,
    object_name,
    column_name,
    status,
    why
from combined
order by
    case status when 'missing' then 0 else 1 end,
    object_type,
    object_name,
    column_name nulls first;

-- Aggregate summary for manual evidence. Record counts only, not private data.
with expected(schema_name, table_name, column_name) as (
    values
        ('public', 'leads', 'current_level'),
        ('public', 'leads', 'level_check_status'),
        ('public', 'leads', 'level_check_context'),
        ('public', 'crm_tasks', 'related_entity_type'),
        ('public', 'crm_tasks', 'related_entity_id')
),
missing as (
    select e.*
    from expected e
    left join information_schema.columns c
        on c.table_schema = e.schema_name
       and c.table_name = e.table_name
       and c.column_name = e.column_name
    where c.column_name is null
)
select count(*) as critical_missing_count from missing;
`;
}

function appendFindingsTable(lines: string[], findings: Finding[]): void {
    for (const finding of findings) {
        lines.push(`| ${finding.status} | ${escapeCell(finding.area)} | ${escapeCell(finding.message)} |`);
        if (finding.details?.length) {
            lines.push(`|  |  | ${escapeCell(finding.details.join(' / '))} |`);
        }
    }
}

function toPosix(filePath: string): string {
    return filePath.split(path.sep).join('/');
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}

function escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
