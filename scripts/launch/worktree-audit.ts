import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type AuditStatus = 'OK' | 'WARNING' | 'FAILED';

interface WorktreeItem {
    statusCode: string;
    path: string;
    packageId: string;
    packageTitle: string;
    risk: 'ok' | 'warning' | 'failed';
    riskReason?: string;
}

interface PackageSummary {
    id: string;
    title: string;
    description: string;
    validation: string[];
    items: WorktreeItem[];
}

interface WorktreeReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: AuditStatus;
    totalItems: number;
    outputDir: string;
    inventoryPath: string;
    commitPackagePlanPath: string;
    packageFileListsDir: string;
    rcStagingPackagePath: string;
    rcStagingPackageFilesPath: string;
    rcStagingRuntimeDiffPath: string;
    rcStagingRuntimeManifestPath: string;
    failedRisks: string[];
    warnings: string[];
    packages: Array<{
        id: string;
        title: string;
        itemCount: number;
        validation: string[];
        fileListPath: string;
    }>;
}

const packageDefinitions = [
    {
        id: 'base_launch_cleanup',
        title: 'Base de launch y limpieza historica',
        description: 'Documentacion estable, scripts de launch, limpieza de auditorias historicas y fuentes de verdad operativas.',
        validation: ['corepack pnpm launch:cleanup', 'corepack pnpm launch:sequence', 'corepack pnpm launch:status'],
    },
    {
        id: 'database_security_external',
        title: 'Supabase seguridad externa y migraciones',
        description: 'Parches SQL, migraciones Supabase y pruebas de invariantes que preparan los fixes externos SEC-* sin aplicarlos automaticamente.',
        validation: [
            'corepack pnpm exec vitest run --coverage=false tests/unit/database-schema-invariants.test.ts tests/api/sessions-create.test.ts tests/api/stripe-webhook.test.ts',
            'corepack pnpm launch:security',
            'corepack pnpm launch:staging-db-rollout',
        ],
    },
    {
        id: 'public_seo_conversion',
        title: 'Superficie publica, SEO y conversion',
        description: 'Landing pages, blog, SEO, i18n publico, captacion y contenido de conversion.',
        validation: [
            'corepack pnpm launch:seo',
            'corepack pnpm launch:content',
            'corepack pnpm exec vitest run --coverage=false tests/unit/landing-public-content.test.ts tests/unit/seo-surface.test.ts tests/unit/landing-schema.test.ts',
        ],
    },
    {
        id: 'crm_requests_diagnostic',
        title: 'CRM, solicitudes y diagnostico de nivel',
        description: 'Solicitud de plaza, leads, contactos, tareas, oportunidades, diagnostico ligero y migraciones CRM.',
        validation: [
            'corepack pnpm exec vitest run --coverage=false tests/api/subscribe.test.ts tests/api/level-check.test.ts tests/api/admin-leads.test.ts tests/unit/crm-lead-capture.test.ts tests/unit/crm-contact-detail.test.ts tests/unit/crm-task-list.test.tsx tests/unit/crm-opportunity-list.test.tsx',
            'corepack pnpm typecheck',
        ],
    },
    {
        id: 'emails_support_onboarding',
        title: 'Emails, soporte y onboarding',
        description: 'Plantillas transaccionales, test-send, soporte, onboarding postpago, materiales y trazabilidad CRM.',
        validation: [
            'corepack pnpm exec vitest run --coverage=false tests/unit/email-templates.test.ts tests/api/email-send-test.test.ts tests/api/support-alert.test.ts tests/api/admin-support-tickets.test.ts tests/unit/crm-onboarding.test.ts tests/unit/crm-class-email.test.ts tests/unit/session-fulfillment.test.ts',
            'corepack pnpm fulfillment:typecheck',
        ],
    },
    {
        id: 'payments_worker_no_real_payments',
        title: 'Pagos bloqueados y Worker fulfillment',
        description: 'Stripe test/live boundary, checkout fail-closed, recovery de pagos, jobs y Cloudflare Fulfillment Worker.',
        validation: [
            'corepack pnpm launch:no-real-payments',
            'corepack pnpm launch:payments',
            'corepack pnpm fulfillment:typecheck',
        ],
    },
    {
        id: 'calendar_teachers_campus',
        title: 'Calendario, profesores y campus',
        description: 'Disponibilidad, sesiones, duraciones 30/40/50, campus estudiante/profesor/admin y reglas de acceso.',
        validation: [
            'corepack pnpm exec vitest run --coverage=false tests/api/sessions-create.test.ts tests/api/session-action.test.ts tests/api/available-slots.test.ts tests/api/bulk-sessions.test.ts tests/api/recurring-sessions.test.ts tests/api/teacher-availability.test.ts tests/unit/StudentClassList.test.tsx tests/unit/TeacherCalendar.test.tsx',
        ],
    },
    {
        id: 'deps_config_ci',
        title: 'Dependencias, configuracion y CI',
        description: 'pnpm, lockfile, CI, configuracion Astro/Tailwind/Vitest/Playwright, env examples y scripts transversales.',
        validation: ['corepack pnpm test:run', 'corepack pnpm typecheck', 'corepack pnpm lint', 'corepack pnpm build', 'git diff --check'],
    },
    {
        id: 'agent_tooling',
        title: 'Herramientas de agente',
        description: 'Skills y workflows locales versionados. Decision humana separada: mantener, mover o retirar.',
        validation: ['corepack pnpm launch:cleanup'],
    },
    {
        id: 'unpackaged_review',
        title: 'Revision manual sin paquete',
        description: 'Archivos no clasificados por el audit. Revisar antes de staging para evitar mezclas accidentales.',
        validation: ['git status --short', 'git diff --check'],
    },
] as const;

const rcNoRealPaymentsSlice = [
    {
        path: 'src/pages/api/create-checkout.ts',
        role: 'Runtime checkout guard: returns 403 before body parsing, Supabase or Stripe unless CHECKOUT_ENABLED=true.',
        requiredForStagingDeploy: true,
    },
    {
        path: 'src/lib/checkout-enabled.ts',
        role: 'Single checkout feature gate: CHECKOUT_ENABLED_OVERRIDE takes precedence over the fail-closed CHECKOUT_ENABLED default.',
        requiredForStagingDeploy: true,
    },
    {
        path: 'src/lib/runtime-env.ts',
        role: 'Cloudflare/Astro runtime env reader used by the checkout guard.',
        requiredForStagingDeploy: true,
    },
    {
        path: 'wrangler.toml',
        role: 'Non-secret Worker default CHECKOUT_ENABLED=false for no-real-payments deployments.',
        requiredForStagingDeploy: true,
    },
    {
        path: '.env.example',
        role: 'Documented local/default posture for no-real-payments mode.',
        requiredForStagingDeploy: false,
    },
    {
        path: 'tests/api/create-checkout.test.ts',
        role: 'Regression proof that checkout fails closed before Supabase or Stripe.',
        requiredForStagingDeploy: false,
    },
    {
        path: 'tests/unit/no-real-payments-runbook.test.ts',
        role: 'Runbook regression proof for the no-real-payments launch checks.',
        requiredForStagingDeploy: false,
    },
    {
        path: 'scripts/launch/no-real-payments.ts',
        role: 'Local and deployed probe for public application-first pricing and checkout fail-closed behavior.',
        requiredForStagingDeploy: false,
    },
    {
        path: 'scripts/launch/staging-no-real-payments-remediation.ts',
        role: 'Read-only Cloudflare staging diagnostic, including local deployment-gap detection.',
        requiredForStagingDeploy: false,
    },
    {
        path: 'docs/launch/NO_REAL_PAYMENTS.md',
        role: 'Operator runbook for interpreting 403 vs 400 and requesting staging-only remediation.',
        requiredForStagingDeploy: false,
    },
] as const;

const packages = new Map<string, PackageSummary>(
    packageDefinitions.map((definition) => [definition.id, { ...definition, items: [] }]),
);

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-worktree', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const items = parseGitStatus()
    .map((entry) => {
        const packageId = classifyPath(entry.path);
        const targetPackage = packages.get(packageId) ?? packages.get('unpackaged_review');
        if (!targetPackage) throw new Error('Missing fallback worktree package.');
        const risk = assessRisk(entry.path, entry.statusCode);
        const item: WorktreeItem = {
            ...entry,
            packageId: targetPackage.id,
            packageTitle: targetPackage.title,
            risk: risk.risk,
            riskReason: risk.reason,
        };
        targetPackage.items.push(item);
        return item;
    });

for (const summary of packages.values()) {
    summary.items.sort((a, b) => a.path.localeCompare(b.path));
}

const failedRisks = items
    .filter((item) => item.risk === 'failed')
    .map((item) => `${item.path}: ${item.riskReason}`);
const warnings = [
    ...items
        .filter((item) => item.risk === 'warning')
        .map((item) => `${item.path}: ${item.riskReason}`),
    ...packages.get('unpackaged_review')?.items.map((item) => `${item.path}: no package rule matched`) ?? [],
];
const status: AuditStatus = failedRisks.length > 0 ? 'FAILED' : warnings.length > 0 || items.length > 0 ? 'WARNING' : 'OK';
const inventoryPath = path.join(outputDir, 'worktree-inventory.md');
const commitPackagePlanPath = path.join(outputDir, 'commit-package-plan.md');
const packageFileListsDir = path.join(outputDir, 'package-file-lists');
const rcStagingPackagePath = path.join(outputDir, 'rc-staging-package.md');
const rcStagingPackageFilesPath = path.join(outputDir, 'rc-staging-package-files.txt');
const rcStagingRuntimeDiffPath = path.join(outputDir, 'rc-staging-runtime-diff.patch');
const rcStagingRuntimeManifestPath = path.join(outputDir, 'rc-staging-runtime-manifest.json');
mkdirSync(packageFileListsDir, { recursive: true });
const report: WorktreeReport = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status,
    totalItems: items.length,
    outputDir,
    inventoryPath,
    commitPackagePlanPath,
    packageFileListsDir,
    rcStagingPackagePath,
    rcStagingPackageFilesPath,
    rcStagingRuntimeDiffPath,
    rcStagingRuntimeManifestPath,
    failedRisks,
    warnings,
    packages: Array.from(packages.values()).map((summary) => ({
        id: summary.id,
        title: summary.title,
        itemCount: summary.items.length,
        validation: summary.validation,
        fileListPath: packageFileListPath(summary.id),
    })),
};

writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(path.join(outputDir, 'summary.md'), renderSummary(report), 'utf8');
writeFileSync(inventoryPath, renderInventory(), 'utf8');
writeFileSync(commitPackagePlanPath, renderCommitPackagePlan(), 'utf8');
writePackageFileLists();
writeFileSync(rcStagingPackagePath, renderRcStagingPackage(), 'utf8');
writeFileSync(rcStagingPackageFilesPath, renderRcStagingPackageFiles(), 'utf8');
writeFileSync(rcStagingRuntimeDiffPath, renderRcStagingRuntimeDiff(), 'utf8');
writeFileSync(rcStagingRuntimeManifestPath, JSON.stringify(buildRcStagingRuntimeManifest(), null, 2), 'utf8');

console.log(`[launch:worktree] Status: ${status}`);
console.log(`[launch:worktree] Items: ${items.length}`);
console.log(`[launch:worktree] Failed risks: ${failedRisks.length}`);
console.log(`[launch:worktree] Warnings: ${warnings.length}`);
console.log(`[launch:worktree] Summary: ${path.join(outputDir, 'summary.md')}`);
console.log(`[launch:worktree] Inventory: ${inventoryPath}`);
console.log(`[launch:worktree] Commit package plan: ${commitPackagePlanPath}`);
console.log(`[launch:worktree] Package file lists: ${packageFileListsDir}`);
console.log(`[launch:worktree] RC staging package: ${rcStagingPackagePath}`);
console.log(`[launch:worktree] RC staging package files: ${rcStagingPackageFilesPath}`);
console.log(`[launch:worktree] RC staging runtime diff: ${rcStagingRuntimeDiffPath}`);
console.log(`[launch:worktree] RC staging runtime manifest: ${rcStagingRuntimeManifestPath}`);

if (failedRisks.length > 0) process.exit(1);

function parseGitStatus(): Array<{ statusCode: string; path: string }> {
    const output = execFileSync('git', ['status', '--short', '--untracked-files=all'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    return output
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .map((line) => {
            const statusCode = line.slice(0, 2);
            const rawPath = line.slice(3);
            const normalizedPath = normalizePath(rawPath.includes(' -> ') ? rawPath.split(' -> ').at(-1) ?? rawPath : rawPath);
            return { statusCode, path: normalizedPath };
        })
        .filter((entry) => !entry.path.startsWith('outputs/'));
}

function classifyPath(filePath: string): string {
    if (matchesAny(filePath, [/^\.agent\//, /^\.agents\//])) return 'agent_tooling';

    if (matchesAny(filePath, [
        /^supabase\/migrations\/(?:021_harden_session_write_policies|022_track_stripe_webhook_processing_state|20260702124757_harden_profile_role_trigger)\.sql$/,
        /^tests\/unit\/database-schema-invariants\.test\.ts$/,
    ])) return 'database_security_external';

    if (matchesAny(filePath, [
        /^AGENTS\.md$/,
        /^README\.md$/,
        /^ARCHITECTURE\.md$/,
        /^CLAUDE\.md$/,
        /^PRODUCTION_AUDIT_STATUS\.md$/,
        /^audit_handover\.md$/,
        /^uat_test_plan\.md\.resolved$/,
        /^db\/audit_fixes\.sql$/,
        /^docs\/auditoria(?:\/|$)/,
        /^docs\/crm(?:\/|$)/,
        /^docs\/launch\/(?:CHECKLIST|CLEANUP|DECISIONS|ENVIRONMENT|FINAL_CLOSURE|FUNCTIONAL_GAP_ROADMAP|FUNCTIONAL_RC|GIT_WORKTREE_PLAN|LAUNCH_SEQUENCE|LEGAL_INPUTS_REQUIRED|MANUAL_EVIDENCE(?:_RUNBOOK)?|MANUAL_EVIDENCE\.example|OBSERVABILITY|POST_LAUNCH_BACKLOG|PRODUCTS|RC_EVIDENCE_REFRESH|RUNBOOK|SUPABASE_BACKUP_RUNBOOK)\.md$/,
        /^docs\/launch\/MANUAL_EVIDENCE\.example\.json$/,
        /^db\/schema\.sql$/,
        /^scripts\/launch\//,
        /^tmp\//,
        /^supabase\/\.temp\//,
        /^supabase\/migrations\/(?:011|014|015|016|017)_/,
        /^src\/pages\/\[lang\]\/legal(?:\/|\.astro$)/,
        /^tests\/unit\/(?:database-schema-invariants|functional-rc-runbook|operations-runbook|no-real-payments-runbook|sentry-astro-config|sentry-readonly-evidence)\.test\.ts$/,
    ])) return 'base_launch_cleanup';

    if (matchesAny(filePath, [
        /^docs\/launch\/(?:CONVERSION_ARCHITECTURE|LAUNCH_MARKETING_PLAN|SEO_INTENT_MAP|SEO_LLM_FINAL)\.md$/,
        /^public\/(?:robots\.txt|llms\.txt)$/,
        /^src\/components\/(?:LandingPage|LeadCaptureForm|PricingModal|PricingSection)\./,
        /^src\/components\/(?:AuthForm|CookieBanner|ResetPasswordForm)\./,
        /^src\/components\/landing\//,
        /^src\/content(?:\/|\.config\.ts$)/,
        /^src\/i18n\//,
        /^src\/layouts\/(?:BaseLayout|BlogLayout|LegalLayout)\./,
        /^src\/lib\/(?:blog-routes|landing-data|landing-schema|site-url)\.ts$/,
        /^src\/pages\/(?:\[lang\]\/blog|en\/index|es\/index|es\/espanol-para-profesionales|es\/clases-de-conversacion-en-espanol|es\/espanol-para-vivir-en-espana|ru\/index|sitemap-public|og\/)/,
        /^src\/pages\/404\.astro$/,
        /^src\/styles\/global\.css$/,
        /^tests\/(?:e2e\/(?:auth|checkout|cookie-banner|demo-guide|environment-banner|landing-page|lead-magnet|legal-and-system|onboarding|public-residual)\.public\.spec|unit\/(?:auth-form|i18n|i18n-encoding|landing-public-content|landing-schema|pricing-modal|pricing-section|reset-password-form|seo-surface)\.test)/,
    ])) return 'public_seo_conversion';

    if (matchesAny(filePath, [
        /^docs\/launch\/LEVEL_CHECK\.md$/,
        /^src\/components\/LevelCheckForm\.tsx$/,
        /^src\/components\/admin\/(?:Crm|LeadManager)/,
        /^src\/lib\/lead-email-token\.ts$/,
        /^src\/lib\/crm\//,
        /^src\/pages\/\[lang\]\/campus\/admin\/(?:crm|leads)/,
        /^src\/pages\/\[lang\]\/diagnostico\.astro$/,
        /^src\/pages\/api\/(?:subscribe|level-check)\.ts$/,
        /^src\/pages\/api\/admin\/(?:crm|leads)\//,
        /^src\/pages\/api\/admin\/leads\.ts$/,
        /^supabase\/migrations\/(?:018|019|020|20260624163423|20260624185757|20260625213116|20260625215008)/,
        /^tests\/(?:api\/(?:subscribe|level-check|admin-leads|admin-crm-contact-actions)|e2e\/diagnostico\.public\.spec|unit\/(?:crm-|lead-capture-form|lead-manager|lead-manager-source|level-check-form))/
    ])) return 'crm_requests_diagnostic';

    if (matchesAny(filePath, [
        /^docs\/launch\/EMAIL_MATRIX\.md$/,
        /^src\/components\/admin\/(?:EmailTemplateManager|Support)/,
        /^src\/lib\/email\//,
        /^src\/lib\/fulfillment\/session-fulfillment\.ts$/,
        /^supabase\/migrations\/(?:012|013)_/,
        /^src\/pages\/\[lang\]\/campus\/(?:admin\/emails|admin\/support|support)\.astro$/,
        /^src\/pages\/api\/(?:email|support)\//,
        /^src\/pages\/api\/admin\/support-tickets\.ts$/,
        /^tests\/(?:api\/(?:email-send-test|support-alert|admin-support-tickets)|unit\/(?:email-google-config|email-template-manager|email-templates|crm-class-email|crm-onboarding|student-onboarding-source|session-fulfillment|support-))/
    ])) return 'emails_support_onboarding';

    if (matchesAny(filePath, [
        /^docs\/launch\/NO_REAL_PAYMENTS\.md$/,
        /^src\/components\/admin\/(?:FulfillmentJobsManager|PaymentRecoveryActions|ProductCatalogManager|SubscriptionRenewalActions)/,
        /^src\/lib\/(?:checkout-enabled|stripe-webhook-events)\.ts$/,
        /^src\/lib\/fulfillment\/(?:jobs|queue)\.ts$/,
        /^src\/lib\/internal-job-service\.ts$/,
        /^src\/pages\/\[lang\]\/campus\/admin\/(?:jobs|packages|payments)\.astro$/,
        /^src\/pages\/api\/(?:create-checkout|stripe-webhook|cron\/)/,
        /^src\/pages\/api\/admin\/(?:fulfillment-jobs|packages)\.ts$/,
        /^supabase\/migrations\/010_/,
        /^workers\/fulfillment\//,
        /^workers\/reminder-cron\//,
        /^tests\/(?:api\/(?:create-checkout|create-portal-session|cron-routes|stripe-webhook|admin-packages|admin-fulfillment-jobs)|unit\/(?:fulfillment-jobs|fulfillment-worker-auth|internal-job-service|payment-recovery-actions|product-catalog-manager|real-env-smoke-safety|stripe-readonly-evidence|subscription-renewal-actions))/
    ])) return 'payments_worker_no_real_payments';

    if (matchesAny(filePath, [
        /^src\/components\/account\//,
        /^src\/components\/calendar\//,
        /^src\/components\/(?:TeacherNotes)\./,
        /^src\/components\/admin\/(?:AssignTeacherModal|StudentFilters|UserManager)\.tsx$/,
        /^docs\/launch\/GOOGLE_CALENDAR_ACCOUNT\.md$/,
        /^src\/layouts\/CampusLayout\.astro$/,
        /^src\/lib\/calendar\//,
        /^src\/lib\/(?:class-access|class-duration)\.ts$/,
        /^src\/pages\/\[lang\]\/campus\/(?:index|classes|admin\/index|admin\/calendar|admin\/student\/|admin\/students|teacher\/calendar)/,
        /^src\/pages\/api\/(?:account|admin\/assign-teacher|admin\/remove-teacher|calendar|drive|google|teacher|test|update-student-notes)/,
        /^tests\/(?:api\/(?:admin-users|assign-teacher|available-slots|bulk-sessions|create-student-folder|full-class-flow|link-google-drive|post-login|recurring-sessions|remove-teacher|session-action|sessions-create|teacher-availability|update-profile|update-student-notes|append-homework)|e2e\/(?:campus-residual\.(?:admin|student|teacher)|scheduling\.admin)\.spec|unit\/(?:admin-calendar|admin-schedule-modal|admin-students-page|assign-teacher-modal|AvailabilityManager|bulk-schedule-modal|meeting-link|next-class-card|post-class-report|profile-form|schedule-session-modal|session-detail-modal|StudentClassList|student-cancel-modal|student-filters|TeacherCalendar|teacher-notes|user-manager|calendar-availability|class-access|madrid-time))/
    ])) return 'calendar_teachers_campus';

    if (matchesAny(filePath, [
        /^\.env\..*\.example$/,
        /^\.env\.example$/,
        /^\.gitattributes$/,
        /^\.github\//,
        /^\.gitignore$/,
        /^astro\.config\.mjs$/,
        /^package\.json$/,
        /^patches\//,
        /^playwright\.config\.ts$/,
        /^pnpm-lock\.yaml$/,
        /^pnpm-workspace\.yaml$/,
        /^wrangler\.toml$/,
        /^scripts\/demo\//,
        /^src\/components\/(?:AuthForm|DemoGuide|EnvironmentBanner)\./,
        /^tailwind\.config\.js$/,
        /^src\/lib\/runtime-env\.ts$/,
        /^src\/env\.d\.ts$/,
        /^src\/types\/database\.types\.ts$/,
        /^src\/content\/config\.ts$/,
        /^src\/pages\/(?:\[lang\]\/demo|demo)\.astro$/,
        /^src\/pages\/api\/demo\//,
        /^scripts\/(?:check-secrets|prepare-e2e-data|seed|setup-google|setup-google-staging|smoke|style)\//,
        /^scripts\/(?:check-secrets|prepare-e2e-data|setup-google-test|setup-google-staging)\./,
        /^tests\/types\//,
        /^tests\/(?:api\/(?:demo-login|security-regression)|e2e\/(?:admin|admin-visual|fixtures|student\.setup|teacher\.setup)|unit\/(?:api-query-construction|runtime-env|runtime-helpers))/
    ])) return 'deps_config_ci';

    return 'unpackaged_review';
}

function assessRisk(filePath: string, statusCode: string): { risk: WorktreeItem['risk']; reason?: string } {
    const isDeletion = statusCode.includes('D') && statusCode !== '??';

    if (isDeletion) {
        return { risk: 'ok' };
    }

    if (matchesAny(filePath, [
        /^\.env(?:$|\.)/,
        /^\.dev\.vars$/,
        /^outputs\//,
        /^tmp\//,
        /^supabase\/\.temp\//,
        /^node_modules\//,
        /^dist\//,
        /^coverage\//,
        /^playwright-report\//,
        /^test-results\//,
        /^\.codex-ops\//,
        /(?:^|\/)(?:package-lock\.json|yarn\.lock|bun\.lock|bun\.lockb)$/,
        /\.log$/,
    ]) && !matchesAny(filePath, [/^\.env\.example$/, /^\.env\..*\.example$/])) {
        return { risk: 'failed', reason: 'local/generated/secret-prone path should not be staged' };
    }

    if (matchesAny(filePath, [/\.(?:backup|bak|tmp|old)$/i, /~$/])) {
        return { risk: 'warning', reason: 'backup/temp-like file requires explicit cleanup decision' };
    }

    return { risk: 'ok' };
}

function renderSummary(report: WorktreeReport): string {
    const lines = [
        '# Git Worktree Audit',
        '',
        `- Status: ${report.status}`,
        `- Started: ${report.startedAt}`,
        `- Ended: ${report.endedAt}`,
        `- Changed items: ${report.totalItems}`,
        `- Output: ${report.outputDir}`,
        `- Inventory: ${report.inventoryPath}`,
        `- Commit package plan: ${report.commitPackagePlanPath}`,
        `- Package file lists: ${report.packageFileListsDir}`,
        `- RC staging package: ${report.rcStagingPackagePath}`,
        `- RC staging package files: ${report.rcStagingPackageFilesPath}`,
        `- RC staging runtime diff: ${report.rcStagingRuntimeDiffPath}`,
        `- RC staging runtime manifest: ${report.rcStagingRuntimeManifestPath}`,
        '',
        '## Scope',
        '',
        'This command reads `git status` and groups current changes into review packages. It does not stage, commit, delete, move, format or write outside `outputs/launch-worktree/`.',
        '',
        '## Packages',
        '',
        '| Items | Package | File list | Validation |',
        '| ---: | --- | --- | --- |',
        ...report.packages.map((summary) => `| ${summary.itemCount} | ${summary.title} | \`${toPosix(path.relative(process.cwd(), summary.fileListPath))}\` | ${summary.validation.map((command) => `\`${command}\``).join('<br>')} |`),
        '',
        '## Guardrails',
        '',
    ];

    if (report.failedRisks.length === 0) {
        lines.push('- No non-versionable tracked/untracked paths were detected by this audit.');
    } else {
        lines.push(...report.failedRisks.map((risk) => `- FAILED: ${risk}`));
    }

    if (report.warnings.length === 0) {
        lines.push('- No warnings.');
    } else {
        lines.push(...report.warnings.slice(0, 40).map((warning) => `- WARNING: ${warning}`));
    }

    if (report.warnings.length > 40) {
        lines.push(`- WARNING: ${report.warnings.length - 40} more warnings are listed in the JSON summary.`);
    }

    lines.push(
        '',
        '## Next Step',
        '',
        'Review `commit-package-plan.md` before staging. Use its RC no-real-payments slice before redeploying Cloudflare Worker staging, and keep agent tooling in a separate decision from product runtime changes.',
        'Use `package-file-lists/` for plain per-package file lists when reviewing or preparing separate commits.',
        'Use `rc-staging-package.md` as the smallest local package manifest before asking for Cloudflare Worker staging approval.',
        'Use `rc-staging-package-files.txt` as the plain file list for reviewing the exact no-real-payments staging slice.',
        'Use `rc-staging-runtime-diff.patch` as a review-only diff of the runtime files that must be represented in the staging deploy source.',
        'Use `rc-staging-runtime-manifest.json` for machine-readable hashes and guard-snippet status of the runtime slice.',
        '',
    );

    return lines.join('\n');
}

function renderInventory(): string {
    const lines = [
        '# Worktree Inventory',
        '',
        'Generated from `git status --short --untracked-files=all`.',
        '',
    ];

    for (const summary of packages.values()) {
        lines.push(`## ${summary.title}`, '', summary.description, '');

        if (summary.items.length === 0) {
            lines.push('- No current changes.', '');
            continue;
        }

        lines.push('| Status | Risk | Path |');
        lines.push('| --- | --- | --- |');
        for (const item of summary.items) {
            const risk = item.riskReason ? `${item.risk}: ${item.riskReason}` : item.risk;
            lines.push(`| \`${item.statusCode.trim() || 'M'}\` | ${risk} | \`${item.path}\` |`);
        }
        lines.push('');
    }

    return lines.join('\n');
}

function renderCommitPackagePlan(): string {
    const lines = [
        '# Commit Package Plan',
        '',
        'Use this as a review order only. The script intentionally does not generate staging commands because the tree may contain user-owned changes.',
        '',
        '## RC Freeze Preconditions',
        '',
        'Do not freeze or redeploy the release candidate while `database_readiness` or `operations_external` remain open. If `no_real_payments_staging` reopens after a runtime/config change, close it again with fresh non-secret evidence before freeze.',
        '',
        'The staging deployment package must include the runtime files required by the RC no-real-payments slice below. A local-only guard is not enough evidence: Cloudflare Worker staging must prove checkout is blocked with `403 Checkout is disabled`, not `400 priceId is required`.',
        '',
        'Keep `.agent/` and `.agents/` tooling in a separate review decision from product runtime commits. Do not use this plan as approval for Cloudflare writes, Supabase writes, Stripe live mode, production Pages changes, real checkout enablement, final secrets, legal real data, Search Console/domain work or production smoke.',
        '',
        '## RC No-Real-Payments Staging Slice',
        '',
        'This is the smallest cross-package slice to review before redeploying or revalidating `no_real_payments_staging`. If the runtime files below are only present in the local working tree and not in the deployment package, source control is not enough evidence for future staging deploys, even when the current deployed probe is already blocked.',
        '',
        'Deploy/redeploy staging only after explicit Cloudflare staging approval. This slice does not authorize Supabase writes, production Pages changes, Stripe live mode or real checkout enablement.',
        '',
        'Plain file lists for all packages are generated in `package-file-lists/`; use them for review only, not as automatic staging commands.',
        'The generated `rc-staging-runtime-diff.patch` is review-only. It limits the diff to the runtime files required by Cloudflare Worker staging; do not apply it blindly or treat it as approval to deploy.',
        '',
        'Validation:',
        '- `corepack pnpm exec vitest run --coverage=false tests/api/create-checkout.test.ts tests/unit/no-real-payments-runbook.test.ts`',
        '- `corepack pnpm launch:no-real-payments`',
        '- After staging deploy/config fix: `corepack pnpm launch:no-real-payments -- --deployed-url https://staging.espanolhonesto.com`',
        '- If staging still fails: `corepack pnpm launch:staging-no-real-payments-remediation`',
        '',
        '| Required for staging deploy | Status | Package | Path | Role |',
        '| --- | --- | --- | --- | --- |',
        ...renderRcNoRealPaymentsSliceRows(),
        '',
    ];

    for (const summary of packages.values()) {
        if (summary.items.length === 0) continue;

        lines.push(`## ${summary.title}`, '', summary.description, '', 'Validation:');
        for (const command of summary.validation) {
            lines.push(`- \`${command}\``);
        }
        lines.push('', 'Files:');
        for (const item of summary.items) {
            lines.push(`- \`${item.statusCode}\` \`${item.path}\``);
        }
        lines.push('');
    }

    return lines.join('\n');
}

function writePackageFileLists(): void {
    for (const summary of packages.values()) {
        const filePath = packageFileListPath(summary.id);
        writeFileSync(filePath, renderPackageFileList(summary), 'utf8');
    }
}

function packageFileListPath(packageId: string): string {
    return path.join(packageFileListsDir, `${packageId}.txt`);
}

function renderPackageFileList(summary: PackageSummary): string {
    const lines = [
        `# ${summary.title}`,
        `# Package id: ${summary.id}`,
        '# Generated by corepack pnpm launch:worktree. Review manifest only; it does not stage, commit, move, delete or deploy.',
        '',
        '# Validation',
        ...summary.validation.map((command) => `# - ${command}`),
        '',
        '# Files',
        ...summary.items.map((item) => `${item.statusCode.trim() || 'M'} ${item.path}`),
        '',
    ];

    return lines.join('\n');
}

function renderRcStagingPackage(): string {
    const guardSnippets = rcGuardSnippets();
    const workingMissing = guardSnippets.filter((check) => !readWorkingSource(check.path).includes(check.snippet));
    const headMissing = guardSnippets.filter((check) => !readHeadSource(check.path).includes(check.snippet));
    const requiredRows = rcNoRealPaymentsSlice.filter((entry) => entry.requiredForStagingDeploy);
    const missingRequiredFiles = requiredRows.filter((entry) => !existsSync(entry.path));
    const localReady = workingMissing.length === 0 && missingRequiredFiles.length === 0;
    const headReady = headMissing.length === 0;

    const lines = [
        '# RC Staging Package',
        '',
        'Local-only manifest for the smallest package needed before Cloudflare Worker staging can prove no-real-payments mode. This file is generated by `corepack pnpm launch:worktree`; it does not stage, commit, deploy or authorize external writes.',
        '',
        '## Current Result',
        '',
        `- Working tree guard ready: ${localReady ? 'yes' : 'no'}`,
        `- Current HEAD guard ready: ${headReady ? 'yes' : 'no'}`,
        `- Required runtime files present: ${missingRequiredFiles.length === 0 ? 'yes' : 'no'}`,
        '',
    ];

    if (localReady && !headReady) {
        lines.push(
            'The working tree contains the required no-real-payments guard, but current HEAD does not. Current staging may already be verified separately; future redeploys or source-based RC review still need this slice packaged into the exact deployment source before relying on `CHECKOUT_ENABLED=false`.',
            '',
        );
    }

    if (!localReady) {
        lines.push(
            'The local runtime guard is incomplete. Do not request a staging redeploy until the missing snippets/files below are fixed.',
            '',
        );
    }

    lines.push(
        '## Required Runtime Slice',
        '',
        '| Required | Status | Working tree guard | HEAD guard | Path | Role |',
        '| --- | --- | --- | --- | --- | --- |',
    );

    for (const entry of rcNoRealPaymentsSlice) {
        const item = items.find((candidate) => candidate.path === entry.path);
        const status = item?.statusCode.trim() || 'clean';
        const workingForPath = guardSnippets
            .filter((check) => check.path === entry.path)
            .filter((check) => !readWorkingSource(check.path).includes(check.snippet))
            .map((check) => check.label);
        const headForPath = guardSnippets
            .filter((check) => check.path === entry.path)
            .filter((check) => !readHeadSource(check.path).includes(check.snippet))
            .map((check) => check.label);
        lines.push([
            entry.requiredForStagingDeploy ? 'yes' : 'support',
            `\`${status}\``,
            workingForPath.length === 0 ? 'ok' : `missing ${escapeCell(workingForPath.join(', '))}`,
            headForPath.length === 0 ? 'ok' : `missing ${escapeCell(headForPath.join(', '))}`,
            `\`${entry.path}\``,
            escapeCell(entry.role),
        ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }

    lines.push(
        '',
        '## Required Before Cloudflare Staging Write',
        '',
        '- Review this manifest and `commit-package-plan.md`.',
        '- Use `rc-staging-package-files.txt` as the plain file list for the runtime slice and supporting evidence.',
        '- Use `rc-staging-runtime-diff.patch` to review the exact runtime diff that must be included in the staging deploy source.',
        '- Use `rc-staging-runtime-manifest.json` to compare hashes/guard status if a deployment package needs source verification.',
        '- If `Current HEAD guard ready` is `no`, package these runtime files into the staging deploy source before relying on `CHECKOUT_ENABLED=false`.',
        '- Get explicit approval for Cloudflare Worker `espanolhonesto-staging` before redeploying or changing variables.',
        '- Do not touch production Worker, Stripe live, real checkout enablement, Supabase, legal real data, final secrets, domain/Search Console or production smoke.',
        '',
        '## Validation',
        '',
        '- `corepack pnpm exec vitest run --coverage=false tests/api/create-checkout.test.ts tests/unit/no-real-payments-runbook.test.ts`',
        '- `corepack pnpm launch:no-real-payments`',
        '- After approved staging redeploy/config fix: `corepack pnpm launch:no-real-payments -- --deployed-url https://staging.espanolhonesto.com`',
        '- If staging still returns `400 priceId is required`: `corepack pnpm launch:staging-no-real-payments-remediation`',
        '',
    );

    return lines.join('\n');
}

function renderRcStagingRuntimeDiff(): string {
    const requiredRuntimePaths = rcNoRealPaymentsSlice
        .filter((entry) => entry.requiredForStagingDeploy)
        .map((entry) => entry.path);
    const diff = execFileSync('git', ['diff', '--', ...requiredRuntimePaths], {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
    });
    const lines = [
        '# RC staging runtime diff for no-real-payments mode',
        '# Generated by corepack pnpm launch:worktree. Review-only; it does not stage, commit, deploy, apply, move or delete anything.',
        '# Scope: required runtime files for Cloudflare Worker staging checkout blocking.',
        '# This file may contain environment variable names from source code, but must not contain secret values.',
        '# Required post-deploy proof: /api/create-checkout returns 403 with Checkout is disabled on the staging URL.',
        '# Forbidden scope: production Worker, Stripe live, CHECKOUT_ENABLED=true, real checkout, Supabase writes, legal real data, final secrets, domain/Search Console and production smoke.',
        '',
    ];

    if (!diff.trim()) {
        lines.push('# No working-tree runtime diff against HEAD for the required no-real-payments staging files.', '');
        return lines.join('\n');
    }

    lines.push(diff.trimEnd(), '');
    return lines.join('\n');
}

function buildRcStagingRuntimeManifest(): unknown {
    const requiredRuntimeEntries = rcNoRealPaymentsSlice.filter((entry) => entry.requiredForStagingDeploy);
    const guardSnippets = rcGuardSnippets();
    const runtimeFiles = requiredRuntimeEntries.map((entry) => {
        const workingSource = readWorkingSource(entry.path);
        const headSource = readHeadSource(entry.path);
        const guardChecks = guardSnippets
            .filter((check) => check.path === entry.path)
            .map((check) => ({
                label: check.label,
                snippet: check.snippet,
                workingTree: workingSource.includes(check.snippet) ? 'present' : 'missing',
                head: headSource.includes(check.snippet) ? 'present' : 'missing',
            }));

        return {
            path: entry.path,
            requiredForStagingDeploy: entry.requiredForStagingDeploy,
            role: entry.role,
            gitStatus: items.find((candidate) => candidate.path === entry.path)?.statusCode.trim() || 'clean',
            workingTree: {
                exists: existsSync(entry.path),
                sha256: workingSource ? sha256(workingSource) : null,
                guardReady: guardChecks.every((check) => check.workingTree === 'present'),
            },
            head: {
                exists: headSource !== '',
                sha256: headSource ? sha256(headSource) : null,
                guardReady: guardChecks.every((check) => check.head === 'present'),
            },
            guardChecks,
        };
    });

    return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        purpose: 'Review-only manifest for the required Cloudflare Worker staging no-real-payments runtime slice.',
        scope: {
            target: 'Cloudflare Worker espanolhonesto-staging',
            requiredPostDeployProof: '/api/create-checkout returns 403 with Checkout is disabled on the staging URL.',
            forbidden: [
                'production Worker',
                'Stripe live',
                'CHECKOUT_ENABLED=true',
                'real checkout',
                'Supabase writes',
                'legal real data',
                'final secrets',
                'domain/Search Console',
                'production smoke',
            ],
        },
        generatedArtifacts: {
            rcStagingPackagePath,
            rcStagingPackageFilesPath,
            rcStagingRuntimeDiffPath,
        },
        summary: {
            workingTreeGuardReady: runtimeFiles.every((file) => file.workingTree.guardReady),
            headGuardReady: runtimeFiles.every((file) => file.head.guardReady),
            requiredRuntimeFilesPresent: requiredRuntimeEntries.every((entry) => existsSync(entry.path)),
        },
        runtimeFiles,
    };
}

function renderRcStagingPackageFiles(): string {
    const lines = [
        '# RC staging no-real-payments package files',
        '# Generated by corepack pnpm launch:worktree. This is a review manifest only; it does not stage, commit, deploy or authorize external writes.',
        '',
        '# Required runtime files for Cloudflare Worker staging deploy/source',
        ...rcNoRealPaymentsSlice
            .filter((entry) => entry.requiredForStagingDeploy)
            .map((entry) => entry.path),
        '',
        '# Supporting evidence and runbook files to review with the runtime slice',
        ...rcNoRealPaymentsSlice
            .filter((entry) => !entry.requiredForStagingDeploy)
            .map((entry) => entry.path),
        '',
    ];

    return lines.join('\n');
}

function rcGuardSnippets(): Array<{ path: string; snippet: string; label: string }> {
    return [
        { path: 'src/pages/api/create-checkout.ts', snippet: "import { isCheckoutEnabled } from '../../lib/checkout-enabled'", label: 'checkout imports the shared feature gate' },
        { path: 'src/pages/api/create-checkout.ts', snippet: 'if (!isCheckoutEnabled(context))', label: 'checkout applies the shared feature gate before request parsing' },
        { path: 'src/pages/api/create-checkout.ts', snippet: 'Checkout is disabled', label: 'checkout disabled response' },
        { path: 'src/pages/api/create-checkout.ts', snippet: 'status: 403', label: 'checkout disabled status 403' },
        { path: 'src/lib/checkout-enabled.ts', snippet: "readRuntimeEnv('CHECKOUT_ENABLED_OVERRIDE'", label: 'feature gate reads CHECKOUT_ENABLED_OVERRIDE first' },
        { path: 'src/lib/checkout-enabled.ts', snippet: "readRuntimeEnv('CHECKOUT_ENABLED'", label: 'feature gate reads CHECKOUT_ENABLED default' },
        { path: 'wrangler.toml', snippet: 'CHECKOUT_ENABLED = "false"', label: 'Worker default CHECKOUT_ENABLED=false' },
    ];
}

function renderRcNoRealPaymentsSliceRows(): string[] {
    return rcNoRealPaymentsSlice.map((entry) => {
        const item = items.find((candidate) => candidate.path === entry.path);
        const packageTitle = item?.packageTitle ?? packages.get(classifyPath(entry.path))?.title ?? 'Unknown package';
        const status = item?.statusCode.trim() || 'clean';
        return [
            entry.requiredForStagingDeploy ? 'yes' : 'supporting evidence',
            `\`${status}\``,
            escapeCell(packageTitle),
            `\`${entry.path}\``,
            escapeCell(entry.role),
        ].join(' | ').replace(/^/, '| ').replace(/$/, ' |');
    });
}

function sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}

function readWorkingSource(filePath: string): string {
    if (!existsSync(filePath)) return '';
    return readFileSync(filePath, 'utf8');
}

function readHeadSource(filePath: string): string {
    try {
        return execFileSync('git', ['show', `HEAD:${filePath}`], {
            cwd: process.cwd(),
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });
    } catch {
        return '';
    }
}

function escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function matchesAny(value: string, patterns: RegExp[]): boolean {
    return patterns.some((pattern) => pattern.test(value));
}

function normalizePath(value: string): string {
    return value.replace(/^"|"$/g, '').replace(/\\/g, '/');
}

function toPosix(filePath: string): string {
    return filePath.split(path.sep).join('/');
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}
