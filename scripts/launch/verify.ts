import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type GateStatus = 'ok' | 'warning' | 'failed';

interface GateResult {
    name: string;
    status: GateStatus;
    message: string;
    evidence?: string;
    details?: string[];
}

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-verification', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const results: GateResult[] = [];

console.log(`[launch:verify] Output: ${outputDir}`);

results.push(...runStaticChecks());

const commandChecks: Array<{ name: string; command: string; args: string[] }> = [
    { name: 'git diff --check', command: 'git', args: ['diff', '--check'] },
    pnpmCheck('pnpm typecheck', ['typecheck']),
    pnpmCheck('pnpm fulfillment:typecheck', ['fulfillment:typecheck']),
    pnpmCheck('pnpm lint', ['lint']),
    pnpmCheck('pnpm test:run', ['test:run']),
    pnpmCheck('pnpm launch:sequence', ['launch:sequence']),
    pnpmCheck('pnpm launch:cleanup', ['launch:cleanup']),
    pnpmCheck('pnpm build', ['build']),
    pnpmCheck('pnpm launch:content', ['launch:content']),
    pnpmCheck('pnpm launch:seo', ['launch:seo']),
    pnpmCheck('pnpm launch:public-visual', ['launch:public-visual']),
    pnpmCheck('pnpm launch:legal', ['launch:legal']),
    pnpmCheck('pnpm launch:security', ['launch:security']),
    pnpmCheck('pnpm launch:operations', ['launch:operations']),
    pnpmCheck('pnpm launch:payments', ['launch:payments']),
    pnpmCheck('pnpm launch:final-readiness', ['launch:final-readiness']),
    pnpmCheck('pnpm launch:accessibility', ['launch:accessibility']),
    pnpmCheck('pnpm launch:manual-evidence:init -- --sync-missing --dry-run', ['launch:manual-evidence:init', '--', '--sync-missing', '--dry-run']),
    pnpmCheck('pnpm secrets:check', ['secrets:check']),
];

for (const check of commandChecks) {
    results.push(runCommandCheck(check.name, check.command, check.args));
}

const endedAt = new Date();
const failed = results.filter((result) => result.status === 'failed');
const warnings = results.filter((result) => result.status === 'warning');
const summary = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    status: failed.length > 0 ? 'BLOCKED' : warnings.length > 0 ? 'READY_WITH_WARNINGS_FOR_SECONDARY_REVIEW' : 'READY_CANDIDATE_REQUIRES_SECONDARY_REVIEW',
    outputDir,
    results,
};

writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
writeFileSync(path.join(outputDir, 'summary.md'), renderMarkdown(summary), 'utf8');

console.log(`[launch:verify] Status: ${summary.status}`);
console.log(`[launch:verify] Failed: ${failed.length}`);
console.log(`[launch:verify] Warnings: ${warnings.length}`);
console.log(`[launch:verify] Summary: ${path.join(outputDir, 'summary.md')}`);

if (failed.length > 0) {
    process.exit(1);
}

function runStaticChecks(): GateResult[] {
    const checks: GateResult[] = [];
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
        packageManager?: string;
        scripts?: Record<string, string>;
    };

    checks.push({
        name: 'pnpm package manager',
        status: packageJson.packageManager === 'pnpm@10.33.0' ? 'ok' : 'failed',
        message: packageJson.packageManager === 'pnpm@10.33.0'
            ? 'packageManager is pinned to pnpm@10.33.0.'
            : `packageManager is ${packageJson.packageManager || 'missing'}, expected pnpm@10.33.0.`,
        evidence: 'package.json',
    });

    const foreignLocks = ['package-lock.json', 'yarn.lock', 'bun.lock', 'bun.lockb'].filter((file) => existsSync(file));
    checks.push({
        name: 'no foreign Node lockfiles',
        status: foreignLocks.length === 0 ? 'ok' : 'failed',
        message: foreignLocks.length === 0
            ? 'No npm/yarn/bun lockfiles found.'
            : `Foreign lockfiles found: ${foreignLocks.join(', ')}.`,
        evidence: 'workspace root',
    });

    const apiBoundaryFindings = findForbiddenApiRuntimeImports(path.join('src', 'pages', 'api'));
    checks.push({
        name: 'Cloudflare API runtime boundary',
        status: apiBoundaryFindings.length === 0 ? 'ok' : 'failed',
        message: apiBoundaryFindings.length === 0
            ? 'src/pages/api does not import Google SDK helpers or fulfillment jobs directly.'
            : 'Cloudflare API files import forbidden fulfillment/Google modules.',
        evidence: 'src/pages/api',
        details: apiBoundaryFindings,
    });

    checks.push(checkDemoQuarantine());
    checks.push(checkSeoReadiness());
    checks.push(checkEnvironmentDocumentation());
    checks.push(checkEvidenceArtifactPrivacy());
    checks.push(checkCleanupReadiness());
    checks.push(checkLaunchGateAutomation(packageJson));

    return checks;
}

function checkEvidenceArtifactPrivacy(): GateResult {
    const gitignore = readIfExists('.gitignore');
    const manualEvidenceDoc = readIfExists(path.join('docs', 'launch', 'MANUAL_EVIDENCE.md'));
    const secretsCheck = readIfExists(path.join('scripts', 'check-secrets.cjs'));
    const findings: string[] = [];
    const ignoredEvidencePaths = [
        'outputs/',
        'docs/launch/MANUAL_EVIDENCE.local.json',
    ];

    for (const ignoredPath of ignoredEvidencePaths) {
        if (!gitignore.includes(ignoredPath)) {
            findings.push(`.gitignore must ignore ${ignoredPath}.`);
        }
    }

    const checkIgnoreTargets = [
        'outputs/launch-status/example/summary.md',
        'outputs/demo-runs/current.json',
        'docs/launch/MANUAL_EVIDENCE.local.json',
    ];
    for (const target of checkIgnoreTargets) {
        const ignored = runGitOutput(['check-ignore', target]);
        const ignoredPaths = new Set(ignored.stdout.trim().split(/\r?\n/).filter(Boolean).map(toPosixPath));
        if (ignored.exitCode !== 0 || !ignoredPaths.has(toPosixPath(target))) {
            findings.push(`git check-ignore must ignore ${target}: ${ignored.stderr || ignored.stdout || `exit ${ignored.exitCode}`}`.trim());
        }
    }

    const tracked = runGitOutput(['ls-files', '--', 'outputs', 'docs/launch/MANUAL_EVIDENCE.local.json']);
    if (tracked.exitCode !== 0) {
        findings.push(`git ls-files failed while checking launch evidence privacy: ${tracked.stderr || tracked.stdout || `exit ${tracked.exitCode}`}`.trim());
    } else if (tracked.stdout.trim()) {
        findings.push(`Launch evidence artifacts must not be tracked: ${tracked.stdout.trim().split(/\r?\n/).join(', ')}.`);
    }

    if (!manualEvidenceDoc.includes('Ese archivo esta ignorado por git') || !manualEvidenceDoc.includes('No debe contener secretos')) {
        findings.push('docs/launch/MANUAL_EVIDENCE.md must document that local evidence is git-ignored and must not contain secrets.');
    }
    if (!secretsCheck.includes('--exclude-standard')) {
        findings.push('scripts/check-secrets.cjs must use git ls-files --exclude-standard so ignored local evidence is not printed or scanned as repo content.');
    }

    return {
        name: 'launch evidence artifact privacy',
        status: findings.length === 0 ? 'ok' : 'failed',
        message: findings.length === 0
            ? 'Local launch evidence, manual evidence and demo run outputs are ignored, untracked and excluded from repo secret scans.'
            : 'Local launch evidence artifacts are not fully protected from versioning.',
        evidence: '.gitignore, git check-ignore, git ls-files, MANUAL_EVIDENCE.md, scripts/check-secrets.cjs',
        details: findings,
    };
}

function checkLaunchGateAutomation(packageJson: { scripts?: Record<string, string> }): GateResult {
    const gateScript = readIfExists(path.join('scripts', 'launch', 'gate.ts'));
    const phaseOneScript = readIfExists(path.join('scripts', 'launch', 'phase-one.ts'));
    const manualEvidenceAudit = readIfExists(path.join('scripts', 'launch', 'manual-evidence-audit.ts'));
    const manualEvidenceInit = readIfExists(path.join('scripts', 'launch', 'manual-evidence-init.ts'));
    const sequenceAudit = readIfExists(path.join('scripts', 'launch', 'sequence-audit.ts'));
    const legalAudit = readIfExists(path.join('scripts', 'launch', 'legal-audit.ts'));
    const releaseCandidate = readIfExists(path.join('scripts', 'launch', 'release-candidate.ts'));
    const secondaryReview = readIfExists(path.join('scripts', 'launch', 'secondary-review.ts'));
    const statusScript = readIfExists(path.join('scripts', 'launch', 'status.ts'));
    const operationsAudit = readIfExists(path.join('scripts', 'launch', 'operations-audit.ts'));
    const paymentsAudit = readIfExists(path.join('scripts', 'launch', 'payments-audit.ts'));
    const finalReadinessAudit = readIfExists(path.join('scripts', 'launch', 'final-readiness-audit.ts'));
    const publicVisualSmoke = readIfExists(path.join('scripts', 'launch', 'public-visual-smoke.ts'));
    const readme = readIfExists('README.md');
    const checklist = readIfExists(path.join('docs', 'launch', 'CHECKLIST.md'));
    const sequence = readIfExists(path.join('docs', 'launch', 'LAUNCH_SEQUENCE.md'));
    const legalInputs = readIfExists(path.join('docs', 'launch', 'LEGAL_INPUTS_REQUIRED.md'));
    const manualEvidence = readIfExists(path.join('docs', 'launch', 'MANUAL_EVIDENCE.md'));
    const manualEvidenceRunbook = readIfExists(path.join('docs', 'launch', 'MANUAL_EVIDENCE_RUNBOOK.md'));
    const findings: string[] = [];

    if (packageJson.scripts?.['launch:gate'] !== 'tsx scripts/launch/gate.ts') {
        findings.push('package.json must expose launch:gate as tsx scripts/launch/gate.ts.');
    }
    if (packageJson.scripts?.['launch:phase1'] !== 'tsx scripts/launch/phase-one.ts') {
        findings.push('package.json must expose launch:phase1 as tsx scripts/launch/phase-one.ts.');
    }
    if (packageJson.scripts?.['launch:rc'] !== 'tsx scripts/launch/release-candidate.ts') {
        findings.push('package.json must expose launch:rc as tsx scripts/launch/release-candidate.ts.');
    }
    if (packageJson.scripts?.['launch:sequence'] !== 'tsx scripts/launch/sequence-audit.ts') {
        findings.push('package.json must expose launch:sequence as tsx scripts/launch/sequence-audit.ts.');
    }
    if (packageJson.scripts?.['launch:seo'] !== 'tsx scripts/launch/seo-audit.ts') {
        findings.push('package.json must expose launch:seo as tsx scripts/launch/seo-audit.ts.');
    }
    if (packageJson.scripts?.['launch:public-visual'] !== 'tsx scripts/launch/public-visual-smoke.ts') {
        findings.push('package.json must expose launch:public-visual as tsx scripts/launch/public-visual-smoke.ts.');
    }
    if (packageJson.scripts?.['launch:legal'] !== 'tsx scripts/launch/legal-audit.ts') {
        findings.push('package.json must expose launch:legal as tsx scripts/launch/legal-audit.ts.');
    }
    if (packageJson.scripts?.['launch:manual-evidence:init'] !== 'tsx scripts/launch/manual-evidence-init.ts') {
        findings.push('package.json must expose launch:manual-evidence:init as tsx scripts/launch/manual-evidence-init.ts.');
    }
    if (packageJson.scripts?.['launch:manual-evidence:record'] !== 'tsx scripts/launch/manual-evidence-record.ts') {
        findings.push('package.json must expose launch:manual-evidence:record as tsx scripts/launch/manual-evidence-record.ts.');
    }
    if (packageJson.scripts?.['launch:manual-evidence'] !== 'tsx scripts/launch/manual-evidence-audit.ts') {
        findings.push('package.json must expose launch:manual-evidence as tsx scripts/launch/manual-evidence-audit.ts.');
    }
    if (!gateScript) {
        findings.push('scripts/launch/gate.ts is missing.');
    }
    if (!publicVisualSmoke.includes("'outputs', 'launch-public-visual'")
        || !publicVisualSmoke.includes("DEMO_GUIDE_ENABLED: 'false'")
        || !publicVisualSmoke.includes("DEMO_GUIDE_LOGIN_ENABLED: 'false'")
        || !publicVisualSmoke.includes("name: 'home en'")
        || !publicVisualSmoke.includes("name: 'home ru'")
        || !publicVisualSmoke.includes("name: 'blog index en'")
        || !publicVisualSmoke.includes("name: 'blog index ru'")
        || !publicVisualSmoke.includes("name: 'blog article en'")
        || !publicVisualSmoke.includes("name: 'blog article ru'")
        || !publicVisualSmoke.includes('/es/espanol-para-vivir-en-espana')
        || !publicVisualSmoke.includes('/es/espanol-para-profesionales')
        || !publicVisualSmoke.includes('/es/clases-de-conversacion-en-espanol')
        || !publicVisualSmoke.includes('mojibakeMarkers')
        || !publicVisualSmoke.includes('privateLinks')
        || !publicVisualSmoke.includes('Horizontal overflow')) {
        findings.push('scripts/launch/public-visual-smoke.ts must write launch-public-visual evidence, keep demo disabled, cover ES/EN/RU homes and blog plus the three Spanish segment pages, and detect mojibake, private links and horizontal overflow.');
    }
    if (!phaseOneScript.includes("'outputs', 'launch-phase-1'")
        || !phaseOneScript.includes('launch:cleanup')
        || !phaseOneScript.includes('launch:content')
        || !phaseOneScript.includes('launch:accessibility')
        || !phaseOneScript.includes('launch:operations')
        || !phaseOneScript.includes('launch:security')
        || !phaseOneScript.includes('phaseOneClosurePackPath')) {
        findings.push('scripts/launch/phase-one.ts must run the immediate Phase 1 support audits and expose the Phase 1 closure pack.');
    }
    if (!legalAudit.includes("'outputs', 'launch-legal'")
        || !legalAudit.includes('LEGAL_INPUTS_REQUIRED.md')
        || !legalAudit.includes('next-actions.md')) {
        findings.push('scripts/launch/legal-audit.ts must write outputs/launch-legal evidence and legal next-actions.md.');
    }
    if (!sequenceAudit.includes("'outputs', 'launch-sequence'")
        || !sequenceAudit.includes('LAUNCH_SEQUENCE.md')
        || !sequenceAudit.includes('final-only')
        || !sequenceAudit.includes('POST_LAUNCH_BACKLOG.md')
        || !sequenceAudit.includes('checkPostLaunchBacklog')
        || !sequenceAudit.includes('Telemetria de uso')
        || !sequenceAudit.includes('Prueba de nivel definitiva')
        || !sequenceAudit.includes('No activar telemetria sin revisar legal/cookies/consentimiento')) {
        findings.push('scripts/launch/sequence-audit.ts must write outputs/launch-sequence evidence and enforce the launch sequence/final-only/post-launch backlog policy.');
    }

    const expectedSteps = [
        "'launch:verify'",
        "'launch:phase1'",
        "'launch:secondary-review'",
        "'launch:status'",
    ];
    const stepIndexes = expectedSteps.map((step) => gateScript.indexOf(step));
    if (stepIndexes.some((index) => index < 0)) {
        findings.push(`scripts/launch/gate.ts must include steps: ${expectedSteps.join(', ')}.`);
    } else if (!stepIndexes.every((index, position) => position === 0 || index > stepIndexes[position - 1])) {
        findings.push('scripts/launch/gate.ts must run launch steps in primary, manual, secondary, status order.');
    }
    if (!gateScript.includes("'outputs', 'launch-gate'")) {
        findings.push('scripts/launch/gate.ts must write evidence under outputs/launch-gate/.');
    }
    if (!gateScript.includes('evidence-index.json') || !gateScript.includes("'--evidence-index'")) {
        findings.push('scripts/launch/gate.ts must write and pass a gate evidence index to secondary review.');
    }
    if (!gateScript.includes('phaseOneSummaryPath')) {
        findings.push('scripts/launch/gate.ts must include Phase 1 evidence in the gate evidence index.');
    }
    if (!gateScript.includes("report.status === 'BLOCKED'") || !gateScript.includes('process.exit(1)')) {
        findings.push('scripts/launch/gate.ts must exit non-zero while the gate is BLOCKED.');
    }
    if (!gateScript.includes('readLatestStatusSummary')) {
        findings.push('scripts/launch/gate.ts must include the consolidated launch:status summary.');
    }
    if (!gateScript.includes('urgencySummary') || !gateScript.includes('Urgency Summary')) {
        findings.push('scripts/launch/gate.ts must render the consolidated urgency summary so the full gate separates immediate work from final-only blockers.');
    }
    if (!secondaryReview.includes('--evidence-index')
        || !secondaryReview.includes('manual evidence freshness')
        || !secondaryReview.includes('phase 1 evidence freshness')
        || !secondaryReview.includes('launch status dashboard')
        || !secondaryReview.includes('manual evidence next actions')
        || !secondaryReview.includes('phase 1 closure pack')
        || !secondaryReview.includes('launch status final closure pack')
        || !secondaryReview.includes('reviewLaunchStatusFinalClosurePack')
        || !secondaryReview.includes('final-closure-pack.md')
        || !secondaryReview.includes('Final Closure Pack')
        || !secondaryReview.includes('phase-aware manual evidence plan')
        || !secondaryReview.includes('phase-aware launch status dashboard')
        || !secondaryReview.includes('launch status current evidence')
        || !secondaryReview.includes('reviewLaunchStatusCurrentEvidence')
        || !secondaryReview.includes('Current Evidence')
        || !secondaryReview.includes('manualEvidencePhaseSummary')
        || !secondaryReview.includes('statusDashboardReferences')
        || !secondaryReview.includes('hasCurrentEvidenceReference')
        || !secondaryReview.includes('reviewDynamicGoNoGoEvidenceReferences')
        || !secondaryReview.includes('dynamic evidence references')
        || !secondaryReview.includes('gateSourceIsStale')
        || !secondaryReview.includes('Phase 1 Focus')
        || !secondaryReview.includes('buildPhaseOneFocus')
        || !secondaryReview.includes('openManualCheckIdsFromSummary')
        || !secondaryReview.includes('manualEvidenceCoverage')
        || !secondaryReview.includes('Manual Evidence Coverage')
        || !secondaryReview.includes('releaseCandidateReadiness.strictQaOpenChecks')
        || !secondaryReview.includes('statusSummaryStrictQaBlockers')
        || !secondaryReview.includes('final-only and strict-QA blockers')
        || !secondaryReview.includes('Launch status dashboard references the latest primary launch verification evidence')) {
        findings.push('scripts/launch/secondary-review.ts must accept gate evidence indexes and launch status dashboard sources while checking manual evidence/status/action-plan/closure-pack/final-closure-pack/current-evidence phase coverage and freshness.');
    }
    if (!manualEvidenceInit.includes('--sync-missing')
        || !manualEvidenceInit.includes('--dry-run')
        || !manualEvidenceInit.includes('MANUAL_EVIDENCE.local.json')
        || !manualEvidenceInit.includes('MANUAL_EVIDENCE.example.json')
        || !manualEvidenceInit.includes('Existing checks were left untouched')) {
        findings.push('scripts/launch/manual-evidence-init.ts must scaffold and sync missing manual checks safely without overwriting existing local evidence.');
    }
    const manualEvidenceRecord = readIfExists(path.join('scripts', 'launch', 'manual-evidence-record.ts'));
    if (!manualEvidenceRecord.includes('Dry run')
        || !manualEvidenceRecord.includes('--write')
        || !manualEvidenceRecord.includes('accepted_risk')
        || !manualEvidenceRecord.includes('riskAcceptedBy')
        || !manualEvidenceRecord.includes('Refusing to record secret-like evidence')
        || !manualEvidenceRecord.includes('MANUAL_EVIDENCE.local.json')) {
        findings.push('scripts/launch/manual-evidence-record.ts must safely record local manual evidence with dry-run default, explicit write, accepted-risk fields and secret-like value rejection.');
    }
    if (!operationsAudit.includes('Supabase Advisor')
        || !operationsAudit.includes('btree_gist')
        || !operationsAudit.includes('public.jobs')
        || !operationsAudit.includes('staging migration history')) {
        findings.push('scripts/launch/operations-audit.ts must carry Supabase Advisor, legacy jobs and migration-history decisions into the generated database readiness worksheet.');
    }
    if (!paymentsAudit.includes('Stripe evidence source')
        || !paymentsAudit.includes('Codex Stripe connector cannot list products/prices')
        || !paymentsAudit.includes('Do not block closure on MCP list output alone')) {
        findings.push('scripts/launch/payments-audit.ts must document that final payment evidence can use Stripe dashboard/checkout/webhook evidence when the Stripe MCP cannot list products or prices.');
    }
    if (!finalReadinessAudit.includes('Cloudflare legacy Workers')
        || !finalReadinessAudit.includes('espanol-honesto-reminders')
        || !finalReadinessAudit.includes('Stripe evidence source')
        || !finalReadinessAudit.includes('Codex Stripe connector cannot list products/prices')) {
        findings.push('scripts/launch/final-readiness-audit.ts must carry Cloudflare legacy Worker and Stripe evidence-source decisions into the generated integration readiness worksheet.');
    }
    if (!statusScript.includes("'launch-gate'") || !statusScript.includes('summarizeGateSource')) {
        findings.push('scripts/launch/status.ts must include the latest pnpm launch:gate run as a dashboard source.');
    }
    if (!statusScript.includes('newerEvidenceAfterSummary')
        || !statusScript.includes('STALE:')
        || !statusScript.includes('Do not rerun pnpm launch:gate only to clear stale status while final-only blockers remain')
        || !statusScript.includes('rerun pnpm launch:gate before Go/No-Go')) {
        findings.push('scripts/launch/status.ts must flag stale full-gate evidence when newer primary/manual/secondary evidence exists.');
    }
    if (!statusScript.includes("'launch-rc'")
        || !statusScript.includes('summarizeReleaseCandidateGateSource')
        || !statusScript.includes('Release Candidate Gate')) {
        findings.push('scripts/launch/status.ts must include the latest pnpm launch:rc run as a dashboard source.');
    }
    if (!releaseCandidate.includes('strictQaOpenChecks')
        || !releaseCandidate.includes('Strict-QA Open')
        || !releaseCandidate.includes('Final-Only Open')) {
        findings.push('scripts/launch/release-candidate.ts must render standalone strict-QA blockers alongside final-only blockers in the Release Candidate summary.');
    }
    if (!releaseCandidate.includes('DEFAULT_WORKER_STAGING_URL')
        || !releaseCandidate.includes('CLOUDFLARE_WORKERS_STAGING_URL')
        || !releaseCandidate.includes('stagingUrl')) {
        findings.push('scripts/launch/release-candidate.ts must default RC no-real-payments probes to the direct Worker staging URL when no explicit staging URL is provided.');
    }
    const releaseCandidateFreshnessBlock = statusScript.match(/const releaseCandidateFreshnessInputs:[\s\S]*?\];/)?.[0] ?? '';
    if (!releaseCandidateFreshnessBlock
        || releaseCandidateFreshnessBlock.includes("label: 'primary verification'")
        || !releaseCandidateFreshnessBlock.includes('RC freshness is scoped to the commands run by `pnpm launch:rc`')
        || !releaseCandidateFreshnessBlock.includes("label: 'phase 1 gate'")
        || !releaseCandidateFreshnessBlock.includes("label: 'manual evidence'")
        || !releaseCandidateFreshnessBlock.includes("label: 'payments audit'")
        || !statusScript.includes('CURRENT_FOR_RC_SCOPE')
        || !statusScript.includes('isReleaseCandidateCurrentForScope')
        || !statusScript.includes('newer final-only evidence')
        || !statusScript.includes('Do not rerun pnpm launch:rc only to clear stale RC status while Phase 1 and RC checks are clear')) {
        findings.push('scripts/launch/status.ts must keep release candidate freshness scoped to launch:rc-owned evidence and must not let primary verification stale the RC gate.');
    }
    if (!statusScript.includes("'launch-phase-1'") || !statusScript.includes('summarizePhaseOneSource')) {
        findings.push('scripts/launch/status.ts must include the latest pnpm launch:phase1 run as a dashboard source.');
    }
    if (!statusScript.includes('manualEvidenceByPhase')
        || !statusScript.includes('manualEvidencePhaseSummary')
        || !statusScript.includes('manualEvidenceCoverage')
        || !statusScript.includes('currentEvidence')
        || !statusScript.includes('urgencySummary')
        || !statusScript.includes('phaseOneFocus')
        || !statusScript.includes('phaseOneClosurePackPath')
        || !statusScript.includes('finalClosurePackPath')
        || !statusScript.includes('renderFinalClosurePack')
        || !statusScript.includes('manualEvidencePassCommand')
        || !statusScript.includes('manualEvidenceAcceptedRiskCommand')
        || !statusScript.includes('Record Final Evidence')
        || !statusScript.includes('preflightDecisions')
        || !statusScript.includes('Preflight Decisions')
        || !statusScript.includes('Stripe evidence source')
        || !statusScript.includes('espanol-honesto-reminders')
        || !statusScript.includes('btree_gist')
        || !statusScript.includes('public.jobs')
        || !statusScript.includes('staging migration history')
        || !statusScript.includes('pnpm launch:manual-evidence:record')
        || !statusScript.includes('--status accepted_risk')
        || !statusScript.includes('--risk-accepted-by')
        || !statusScript.includes('Accepted-risk command: not generated for this check.')
        || !statusScript.includes('final-closure-pack.md')
        || !statusScript.includes('Final Closure Pack')
        || !statusScript.includes('Current Evidence')
        || !statusScript.includes('Urgency Summary')
        || !statusScript.includes('Phase 1 Focus')
        || !statusScript.includes('Do not use legal real data, Stripe live, final API key rotation or production smoke')
        || !statusScript.includes('Manual Evidence Phase Summary')
        || !statusScript.includes('Manual Evidence Coverage')
        || !statusScript.includes('Open Manual Evidence By Phase')
        || !statusScript.includes('Strict-QA Open')
        || !statusScript.includes('Strict-QA tracker blockers')
        || !statusScript.includes('Open Go/No-Go Breakdown')
        || !statusScript.includes('command-level rows are derived blockers')
        || !statusScript.includes('only when you have real final evidence or an explicit accepted risk')
        || !statusScript.includes('buildCurrentEvidence')
        || !statusScript.includes('buildPhaseOneFocus')
        || !statusScript.includes('buildUrgencySummary')
        || !statusScript.includes('automatic_legal')
        || !statusScript.includes('phase_1_now')
        || !statusScript.includes('phase_3_final')) {
        findings.push('scripts/launch/status.ts must expose current evidence, final closure pack, final preflight decisions, and group open manual evidence by launch phase and urgency so immediate work is separated from final-only blockers.');
    }
    if (!readme.includes('pnpm launch:gate') || !readme.includes('outputs/launch-gate/') || !readme.includes('pnpm launch:legal')) {
        findings.push('README.md must document pnpm launch:gate, pnpm launch:legal and outputs/launch-gate/.');
    }
    if (!readme.includes('pnpm launch:phase1') || !readme.includes('outputs/launch-phase-1/')) {
        findings.push('README.md must document pnpm launch:phase1 and outputs/launch-phase-1/.');
    }
    if (!readme.includes('pnpm launch:rc') || !readme.includes('Release Candidate')) {
        findings.push('README.md must document pnpm launch:rc as the Release Candidate gate.');
    }
    if (!readme.includes('pnpm launch:manual-evidence:init')) {
        findings.push('README.md must document pnpm launch:manual-evidence:init for safe local evidence scaffolding.');
    }
    if (!readme.includes('pnpm launch:manual-evidence:record')) {
        findings.push('README.md must document pnpm launch:manual-evidence:record as the dry-run helper for local ignored evidence.');
    }
    if (!readme.includes('pnpm launch:final-readiness') || !readme.includes('integration_readiness') || !readme.includes('final_smoke')) {
        findings.push('README.md must document pnpm launch:final-readiness and the final integration/smoke worksheets it supports.');
    }
    if (!readme.includes('pnpm launch:sequence') || !readme.includes('docs/launch/LAUNCH_SEQUENCE.md')) {
        findings.push('README.md must document pnpm launch:sequence and docs/launch/LAUNCH_SEQUENCE.md.');
    }
    if (!readme.includes('pnpm launch:seo') || !readme.includes('outputs/launch-seo/')) {
        findings.push('README.md must document pnpm launch:seo and outputs/launch-seo/.');
    }
    if (!readme.includes('final-closure-pack.md')) {
        findings.push('README.md must document the final-closure-pack.md generated by pnpm launch:status.');
    }
    if (!checklist.includes('pnpm launch:gate') || !checklist.includes('pnpm launch:legal') || !checklist.includes('pnpm launch:sequence') || !checklist.includes('outputs/launch-gate/<timestamp>/')) {
        findings.push('docs/launch/CHECKLIST.md must document pnpm launch:gate, pnpm launch:legal, pnpm launch:sequence and outputs/launch-gate/<timestamp>/.');
    }
    if (!checklist.includes('pnpm launch:phase1') || !checklist.includes('outputs/launch-phase-1/<timestamp>/')) {
        findings.push('docs/launch/CHECKLIST.md must document pnpm launch:phase1 and outputs/launch-phase-1/<timestamp>/.');
    }
    if (!checklist.includes('pnpm launch:rc') || !checklist.includes('outputs/launch-rc/<timestamp>/')) {
        findings.push('docs/launch/CHECKLIST.md must document pnpm launch:rc and outputs/launch-rc/<timestamp>/.');
    }
    if (!checklist.includes('pnpm launch:seo') || !checklist.includes('outputs/launch-seo/<timestamp>/')) {
        findings.push('docs/launch/CHECKLIST.md must document pnpm launch:seo and outputs/launch-seo/<timestamp>/.');
    }
    if (!sequence.includes('## Fase 1: ordenar ahora')
        || !sequence.includes('## Fase 3: cierre final')
        || !sequence.includes('Antes de declarar `READY`')) {
        findings.push('docs/launch/LAUNCH_SEQUENCE.md must separate current work from final-only blockers while keeping READY gated.');
    }
    if (!legalInputs.includes('pnpm launch:legal')) {
        findings.push('docs/launch/LEGAL_INPUTS_REQUIRED.md must document pnpm launch:legal as part of legal closure.');
    }
    if (!manualEvidence.includes('pnpm launch:gate')) {
        findings.push('docs/launch/MANUAL_EVIDENCE.md must require pnpm launch:gate before READY.');
    }
    if (!manualEvidence.includes('pnpm launch:manual-evidence:init -- --sync-missing')) {
        findings.push('docs/launch/MANUAL_EVIDENCE.md must document sync-missing for new manual evidence checks.');
    }
    if (!manualEvidence.includes('pnpm launch:manual-evidence:record') || !manualEvidenceRunbook.includes('pnpm launch:manual-evidence:record')) {
        findings.push('Manual evidence docs must document pnpm launch:manual-evidence:record as a dry-run helper for local ignored evidence.');
    }
    if (!manualEvidenceAudit.includes('next-actions.md')
        || !manualEvidenceAudit.includes('manual-evidence-index.md')
        || !manualEvidenceAudit.includes('nextActionsPath')
        || !manualEvidenceAudit.includes('manualEvidenceIndexPath')
        || !manualEvidenceAudit.includes('phaseOneClosurePackPath')
        || !manualEvidenceAudit.includes('manualEvidencePhaseSummary')
        || !manualEvidenceAudit.includes('manualEvidenceByPhase')
        || !manualEvidenceAudit.includes('renderManualEvidenceIndex')
        || !manualEvidenceAudit.includes('renderPhaseOneClosurePack')
        || !manualEvidenceAudit.includes('latestSupportSummaryFor')
        || !manualEvidenceAudit.includes('latestWorksheetFor')
        || !manualEvidenceAudit.includes('Latest support summary')
        || !manualEvidenceAudit.includes('relativeToManualEvidence')
        || !manualEvidenceAudit.includes('groupManualEvidenceByPhase')
        || !manualEvidenceAudit.includes('Blocking Checks By Phase')
        || !manualEvidenceAudit.includes('reviewManualEvidenceDocumentation')
        || !manualEvidenceAudit.includes('manual evidence documentation coverage')
        || !manualEvidenceAudit.includes('phase_1_now')
        || !manualEvidence.includes('next-actions.md')
        || !manualEvidence.includes('manual-evidence-index.md')
        || !manualEvidence.includes('phase-1-closure-pack.md')) {
        findings.push('Manual evidence workflow must generate, expose and document next-actions.md, manual-evidence-index.md and phase-1-closure-pack.md, and verify docs/example/checklist consistency for unresolved human checks.');
    }
    const requiredManualCheckIds = [
        'cleanup_agents_decision',
        'legal_owner_controller',
        'legal_human_review',
        'accessibility_manual',
        'security_external',
        'payments_staging',
        'operations_external',
        'content_review',
        'database_readiness',
        'integration_readiness',
        'seo_llm_final',
        'final_smoke',
    ];
    const missingRunbookIds = requiredManualCheckIds.filter((id) => !manualEvidenceRunbook.includes(id));
    if (!manualEvidence.includes('MANUAL_EVIDENCE_RUNBOOK.md')
        || !checklist.includes('MANUAL_EVIDENCE_RUNBOOK.md')
        || missingRunbookIds.length > 0) {
        findings.push(`Manual evidence runbook must be documented and cover all required checks: ${missingRunbookIds.join(', ') || 'links missing'}.`);
    }

    return {
        name: 'launch gate automation coverage',
        status: findings.length === 0 ? 'ok' : 'failed',
        message: findings.length === 0
            ? 'Canonical launch:gate command is present, ordered, documented and fails closed while blocked.'
            : 'Canonical launch:gate command is missing, misordered or under-documented.',
        evidence: 'package.json, scripts/launch/gate.ts, README.md, docs/launch/CHECKLIST.md, docs/launch/MANUAL_EVIDENCE.md',
        details: findings,
    };
}

function checkCleanupReadiness(): GateResult {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
        scripts?: Record<string, string>;
    };
    const removedOrIgnoredCandidates = [
        'db/audit_fixes.sql',
        'docs/launch/CURRENT_STATUS.md',
        'outputs/demo-runs',
    ].filter((file) => existsSync(file));
    const cleanupDoc = readIfExists(path.join('docs', 'launch', 'CLEANUP.md'));
    const cleanupAudit = readIfExists(path.join('scripts', 'launch', 'cleanup-audit.ts'));
    const readme = readIfExists('README.md');
    const checklist = readIfExists(path.join('docs', 'launch', 'CHECKLIST.md'));
    const agentFolders = ['.agent', '.agents'].filter((file) => existsSync(file));
    const agentBackupCandidates = agentFolders
        .flatMap((folder) => filesUnder(folder))
        .filter((file) => /\.(?:backup|bak|tmp|old)$/i.test(file));
    const findings: string[] = [];

    if (packageJson.scripts?.['launch:cleanup'] !== 'tsx scripts/launch/cleanup-audit.ts') {
        findings.push('package.json must expose launch:cleanup as tsx scripts/launch/cleanup-audit.ts.');
    }
    if (!cleanupAudit.includes("'outputs', 'launch-cleanup'")
        || !cleanupAudit.includes('This audit is non-destructive')
        || !cleanupAudit.includes('agent-tooling-decision-worksheet.md')
        || !cleanupAudit.includes('Keep In Repo Snippet')
        || !cleanupAudit.includes('Move Outside Repo Snippet')
        || !cleanupAudit.includes('Delete After Backup Snippet')) {
        findings.push('scripts/launch/cleanup-audit.ts must write outputs/launch-cleanup evidence, generate agent-tooling-decision-worksheet.md with keep/move/delete snippets, and be non-destructive.');
    }
    if (!readme.includes('pnpm launch:cleanup') || !readme.includes('no destructiva')) {
        findings.push('README.md must document pnpm launch:cleanup as a non-destructive cleanup audit.');
    }
    if (!checklist.includes('pnpm launch:cleanup')
        || !checklist.includes('limpieza no destructiva')
        || !checklist.includes('agent-tooling-decision-worksheet.md')) {
        findings.push('docs/launch/CHECKLIST.md must document pnpm launch:cleanup, cleanup evidence and the agent tooling decision worksheet.');
    }
    if (removedOrIgnoredCandidates.length > 0) {
        findings.push(`Known removed/ignored cleanup candidates still exist: ${removedOrIgnoredCandidates.join(', ')}.`);
    }
    if (!cleanupDoc) {
        findings.push('docs/launch/CLEANUP.md is missing.');
    }
    if (agentFolders.length > 0) {
        const requiredSnippets = [
            '.agent/',
            '.agents/',
            'Decision pendiente',
            'No borrar herramientas de agente versionadas sin confirmacion humana',
        ];
        const missingSnippets = requiredSnippets.filter((snippet) => !cleanupDoc.includes(snippet));
        if (missingSnippets.length > 0) {
            findings.push(`docs/launch/CLEANUP.md does not fully document the agent-tools decision: ${missingSnippets.join(', ')}.`);
        }
        for (const backup of agentBackupCandidates) {
            const normalized = backup.replace(/\\/g, '/');
            if (!cleanupDoc.includes(normalized)) {
                findings.push(`Agent backup candidate is not recorded in docs/launch/CLEANUP.md: ${normalized}.`);
            }
        }
    }

    const details = [
        ...removedOrIgnoredCandidates.map((file) => `cleanup candidate still present: ${file}`),
        ...agentFolders.map((folder) => `manual Go/No-Go decision pending for ${folder}/`),
        ...agentBackupCandidates.map((file) => `recorded agent backup candidate: ${file.replace(/\\/g, '/')}`),
    ];

    return {
        name: 'cleanup proposal coverage',
        status: findings.length === 0 ? 'ok' : 'warning',
        message: findings.length === 0
            ? 'Known cleanup candidates are removed or documented; agent-tool cleanup remains a manual Go/No-Go decision.'
            : 'Cleanup candidates need documentation or explicit keep/delete decisions.',
        evidence: 'scripts/launch/cleanup-audit.ts, docs/launch/CLEANUP.md, workspace scan',
        details: findings.length > 0 ? findings : details,
    };
}

function checkDemoQuarantine(): GateResult {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
        scripts?: Record<string, string>;
    };
    const layout = readFileSync(path.join('src', 'layouts', 'BaseLayout.astro'), 'utf8');
    const demoRoute = readFileSync(path.join('src', 'pages', 'demo.astro'), 'utf8');
    const localizedDemoRoute = readFileSync(path.join('src', 'pages', '[lang]', 'demo.astro'), 'utf8');
    const loginRoute = readFileSync(path.join('src', 'pages', 'api', 'demo', 'login.ts'), 'utf8');
    const demoDev = readFileSync(path.join('scripts', 'demo', 'dev.ts'), 'utf8');
    const astroConfig = readIfExists('astro.config.mjs');
    const robots = readIfExists(path.join('public', 'robots.txt'));
    const sitemapPublic = readIfExists(path.join('src', 'pages', 'sitemap-public.xml.ts'));
    const envTestExample = readIfExists('.env.test.example');
    const environmentDoc = readIfExists(path.join('docs', 'launch', 'ENVIRONMENT.md'));
    const accessibilitySmoke = readIfExists(path.join('scripts', 'launch', 'accessibility-smoke.ts'));

    const findings: string[] = [];
    const normalDevScript = packageJson.scripts?.dev ?? '';
    if (normalDevScript.includes('scripts/demo') || normalDevScript.includes('--mode test')) {
        findings.push('pnpm dev must stay normal launch-like local dev and must not load demo/test mode by default.');
    }
    if (packageJson.scripts?.['dev:demo'] !== 'tsx scripts/demo/dev.ts') {
        findings.push('pnpm dev:demo must be the explicit entry point for local demo mode.');
    }
    if (!layout.includes('demoGuideEnabled && <DemoGuide />')) {
        findings.push('BaseLayout must render DemoGuide only behind demoGuideEnabled.');
    }
    if (!layout.includes("import.meta.env.DEMO_GUIDE_ENABLED === 'true'")) {
        findings.push('BaseLayout must derive demoGuideEnabled from DEMO_GUIDE_ENABLED.');
    }
    if (!demoRoute.includes("import.meta.env.DEMO_GUIDE_ENABLED === 'true'")) {
        findings.push('/demo route must enable the launcher only when DEMO_GUIDE_ENABLED=true.');
    }
    if (!localizedDemoRoute.includes("import.meta.env.DEMO_GUIDE_ENABLED === 'true'")) {
        findings.push('/[lang]/demo route must enable the launcher only when DEMO_GUIDE_ENABLED=true.');
    }
    if (!demoRoute.includes('Astro.response.status = 404')
        || !demoRoute.includes("Astro.response.headers.set('x-robots-tag', 'noindex, nofollow')")
        || demoRoute.includes("return Astro.redirect('/es', 302)")) {
        findings.push('/demo route must fail closed with 404/noindex instead of redirecting into public pages when disabled.');
    }
    if (!localizedDemoRoute.includes('Astro.response.status = 404')
        || !localizedDemoRoute.includes("Astro.response.headers.set('x-robots-tag', 'noindex, nofollow')")
        || localizedDemoRoute.includes("return Astro.redirect(`/${lang}`, 302)")) {
        findings.push('/[lang]/demo route must fail closed with 404/noindex instead of redirecting into public pages when disabled.');
    }
    if (loginRoute.includes('import.meta.env.DEV ||')) {
        findings.push('/api/demo/login must not be enabled merely because Astro is in DEV mode.');
    }
    if (!loginRoute.includes("hostname.endsWith('.trycloudflare.com')") || !loginRoute.includes('if (!isAllowedHost)')) {
        findings.push('/api/demo/login must reject non-local/non-trycloudflare hosts even when demo flags are enabled.');
    }
    if (!loginRoute.includes("readFlag('DEMO_GUIDE_LOGIN_ENABLED')")) {
        findings.push('/api/demo/login must require DEMO_GUIDE_ENABLED or DEMO_GUIDE_LOGIN_ENABLED.');
    }
    if (!loginRoute.includes('return json({ error: enabled.message }, 403)')) {
        findings.push('/api/demo/login must fail closed with HTTP 403 when demo login is disabled.');
    }
    if (!demoDev.includes("process.env.DEMO_GUIDE_ENABLED ||= 'true'")) {
        findings.push('pnpm dev:demo must explicitly enable DEMO_GUIDE_ENABLED.');
    }
    if (!demoDev.includes("process.env.DEMO_GUIDE_LOGIN_ENABLED ||= 'true'")) {
        findings.push('pnpm dev:demo must explicitly enable DEMO_GUIDE_LOGIN_ENABLED.');
    }
    if (!astroConfig.includes("!page.includes('/demo')")) {
        findings.push('Astro sitemap integration must exclude /demo routes.');
    }
    for (const demoPath of ['/demo', '/es/demo', '/en/demo', '/ru/demo']) {
        if (!robots.includes(`Disallow: ${demoPath}`)) {
            findings.push(`public/robots.txt must disallow ${demoPath}.`);
        }
    }
    if (sitemapPublic.includes('/demo')) {
        findings.push('src/pages/sitemap-public.xml.ts must not include demo routes.');
    }
    if (!envTestExample.includes('DEMO_GUIDE_ENABLED=false') || !envTestExample.includes('DEMO_GUIDE_LOGIN_ENABLED=false')) {
        findings.push('.env.test.example must keep demo flags false for normal local/E2E runs.');
    }
    if (!environmentDoc.includes('DEMO_GUIDE_ENABLED=false')
        || !environmentDoc.includes('DEMO_GUIDE_LOGIN_ENABLED=false')
        || !environmentDoc.includes('pnpm dev:demo')) {
        findings.push('docs/launch/ENVIRONMENT.md must document that demo flags stay false except for pnpm dev:demo.');
    }
    if (!accessibilitySmoke.includes("DEMO_GUIDE_ENABLED: 'false'")
        || !accessibilitySmoke.includes("DEMO_GUIDE_LOGIN_ENABLED: 'false'")) {
        findings.push('launch accessibility smoke must explicitly disable demo guide and demo login.');
    }
    if (!accessibilitySmoke.includes('/es/espanol-para-vivir-en-espana')
        || !accessibilitySmoke.includes('/es/espanol-para-profesionales')
        || !accessibilitySmoke.includes('/es/clases-de-conversacion-en-espanol')) {
        findings.push('launch accessibility smoke must cover the Spanish segment landing pages.');
    }
    if (!accessibilitySmoke.includes("{ name: 'blog index es', path: '/es/blog' }")
        || !accessibilitySmoke.includes("{ name: 'blog index en', path: '/en/blog' }")
        || !accessibilitySmoke.includes("{ name: 'blog index ru', path: '/ru/blog' }")
        || !accessibilitySmoke.includes('/es/blog/cuanto-tiempo-hablar-espanol-fluido')
        || !accessibilitySmoke.includes('/en/blog/how-long-to-speak-spanish-fluently')
        || !accessibilitySmoke.includes('/ru/blog/how-long-to-speak-spanish-fluently')) {
        findings.push('launch accessibility smoke must cover localized blog indexes and one published article in ES/EN/RU.');
    }
    const publicDemoReferences = findUnexpectedPublicDemoReferences();
    if (publicDemoReferences.length > 0) {
        findings.push(`Demo references must not appear in public launch surfaces outside the allowed demo/gating files: ${publicDemoReferences.join(', ')}.`);
    }

    return {
        name: 'demo quarantine',
        status: findings.length === 0 ? 'ok' : 'failed',
        message: findings.length === 0
            ? 'Demo UI, demo login and demo routes are opt-in, fail closed when disabled, absent from public navigation, and excluded from launch SEO/runtime by default.'
            : 'Demo quarantine requirements are not met.',
        evidence: 'BaseLayout, /demo routes, /api/demo/login, scripts/demo/dev.ts, astro.config.mjs, robots.txt, src public-surface scan',
        details: findings,
    };
}

function findUnexpectedPublicDemoReferences(): string[] {
    const allowedDemoFiles = new Set([
        'src/components/DemoGuide.astro',
        'src/env.d.ts',
        'src/layouts/BaseLayout.astro',
        'src/lib/runtime-env.ts',
        'src/pages/[lang]/demo.astro',
        'src/pages/api/demo/login.ts',
        'src/pages/demo.astro',
    ]);
    const demoReferencePatterns = [
        /\bDEMO_GUIDE(?:_LOGIN)?_ENABLED\b/,
        /\bDemoGuide\b/,
        /\/api\/demo\b/,
        /(?:href|to)=["'`][^"'`]*\/(?:es|en|ru\/)?demo\b/i,
        /["'`]\/(?:es|en|ru)?\/?demo\b/,
        /\?demo(?:=|&|$)/,
        /\bdemoStart\b/,
        /\bdemoLauncher\b/,
    ];

    return filesUnder('src')
        .filter((file) => /\.(?:astro|ts|tsx|js|jsx|md|mdoc)$/.test(file))
        .filter((file) => !allowedDemoFiles.has(toPosixPath(file)))
        .flatMap((file) => {
            const content = readFileSync(file, 'utf8');
            const matches = demoReferencePatterns
                .filter((pattern) => pattern.test(content))
                .map((pattern) => pattern.source);

            return matches.length > 0
                ? [`${toPosixPath(file)} (${matches.join(' | ')})`]
                : [];
        });
}

function checkSeoReadiness(): GateResult {
    const findings: string[] = [];
    const astroConfig = readIfExists('astro.config.mjs');
    const robots = readIfExists(path.join('public', 'robots.txt'));
    const baseLayout = readIfExists(path.join('src', 'layouts', 'BaseLayout.astro'));
    const campusLayout = readIfExists(path.join('src', 'layouts', 'CampusLayout.astro'));
    const login = readIfExists(path.join('src', 'pages', '[lang]', 'login.astro'));
    const resetPassword = readIfExists(path.join('src', 'pages', '[lang]', 'reset-password.astro'));
    const success = readIfExists(path.join('src', 'pages', '[lang]', 'success.astro'));
    const cancel = readIfExists(path.join('src', 'pages', '[lang]', 'cancel.astro'));
    const sitemapPublic = readIfExists(path.join('src', 'pages', 'sitemap-public.xml.ts'));
    const llmsTxt = readIfExists(path.join('public', 'llms.txt'));
    const landingData = readIfExists(path.join('src', 'lib', 'landing-data.ts'));
    const landingSchema = readIfExists(path.join('src', 'lib', 'landing-schema.ts'));
    const landingPage = readIfExists(path.join('src', 'components', 'LandingPage.astro'));
    const landingRoutes = ['es', 'en', 'ru'].map((lang) => ({
        file: `src/pages/${lang}/index.astro`,
        content: readIfExists(path.join('src', 'pages', lang, 'index.astro')),
    }));

    const requiredSnippets: Array<[string, string, string]> = [
        ['astro.config.mjs', astroConfig, 'sitemap({'],
        ['astro.config.mjs', astroConfig, "!page.includes('/campus/')"],
        ['public/robots.txt', robots, 'Disallow: /api/'],
        ['public/robots.txt', robots, 'Disallow: /es/campus/'],
        ['public/robots.txt', robots, 'Disallow: /es/login'],
        ['public/robots.txt', robots, 'Sitemap: https://espanolhonesto.com/sitemap-index.xml'],
        ['src/layouts/BaseLayout.astro', baseLayout, '<link rel="canonical"'],
        ['src/layouts/BaseLayout.astro', baseLayout, 'hreflang="x-default"'],
        ['src/layouts/BaseLayout.astro', baseLayout, 'property="og:image"'],
        ['src/layouts/BaseLayout.astro', baseLayout, 'name="robots" content="noindex, nofollow"'],
        ['src/layouts/CampusLayout.astro', campusLayout, 'noindex={true}'],
        ['src/pages/[lang]/login.astro', login, 'noindex={true}'],
        ['src/pages/[lang]/reset-password.astro', resetPassword, 'noindex={true}'],
        ['src/pages/[lang]/success.astro', success, 'noindex={true}'],
        ['src/pages/[lang]/cancel.astro', cancel, 'noindex={true}'],
        ['src/pages/sitemap-public.xml.ts', sitemapPublic, 'hreflang="x-default"'],
        ['src/pages/sitemap-public.xml.ts', sitemapPublic, '/espanol-para-vivir-en-espana'],
        ['src/pages/sitemap-public.xml.ts', sitemapPublic, '/espanol-para-profesionales'],
        ['src/pages/sitemap-public.xml.ts', sitemapPublic, '/clases-de-conversacion-en-espanol'],
        ['public/llms.txt', llmsTxt, '# Español Honesto'],
        ['public/llms.txt', llmsTxt, 'https://espanolhonesto.com/es/espanol-para-vivir-en-espana'],
        ['public/llms.txt', llmsTxt, 'https://espanolhonesto.com/es/espanol-para-profesionales'],
        ['public/llms.txt', llmsTxt, 'https://espanolhonesto.com/es/clases-de-conversacion-en-espanol'],
        ['public/llms.txt', llmsTxt, 'Do Not Use As Public Source Material'],
        ['public/llms.txt', llmsTxt, '/api'],
        ['public/llms.txt', llmsTxt, '/campus'],
        ['src/lib/landing-data.ts', landingData, "from('packages')"],
        ['src/lib/landing-schema.ts', landingSchema, 'buildLandingSchema'],
        ['src/lib/landing-schema.ts', landingSchema, 'courseNodes(lang, packages)'],
        ['src/components/LandingPage.astro', landingPage, 'launchPricingPlans'],
    ];

    for (const [file, content, snippet] of requiredSnippets) {
        if (!content.includes(snippet)) {
            findings.push(`${file} is missing expected SEO/private-indexing snippet: ${snippet}`);
        }
    }

    for (const { file, content } of landingRoutes) {
        if (!content.includes('getLandingPageData(Astro)') || !content.includes('buildLandingSchema(lang, t, packages)')) {
            findings.push(`${file} must build landing JSON-LD from active Supabase packages.`);
        }
        for (const legacyPlan of ['pricing.plans.essential', 'pricing.plans.intensive', 'pricing.plans.premium']) {
            if (content.includes(legacyPlan)) {
                findings.push(`${file} must not generate landing JSON-LD from legacy plan key ${legacyPlan}.`);
            }
        }
    }

    return {
        name: 'SEO and private indexing readiness',
        status: findings.length === 0 ? 'ok' : 'failed',
        message: findings.length === 0
            ? 'SEO metadata, sitemap/robots rules, JSON-LD package schema, llms.txt and private noindex guards are present.'
            : 'SEO or private indexing readiness checks failed.',
        evidence: 'astro.config.mjs, public/robots.txt, public/llms.txt, layouts, landing schema, sitemap-public.xml.ts',
        details: findings,
    };
}

function checkEnvironmentDocumentation(): GateResult {
    const requiredEnv = [
        'PUBLIC_SUPABASE_URL',
        'SUPABASE_EXPECTED_PROJECT_REF',
        'PUBLIC_SUPABASE_ANON_KEY',
        'SUPABASE_SERVICE_ROLE_KEY',
        'STRIPE_SECRET_KEY',
        'STRIPE_WEBHOOK_SECRET',
        'STRIPE_EXPECTED_ACCOUNT_ID',
        'STRIPE_PORTAL_CONFIGURATION_ID',
        'PUBLIC_STRIPE_PUBLISHABLE_KEY',
        'FULFILLMENT_WORKER_URL',
        'INTERNAL_JOB_SECRET',
        'GOOGLE_SERVICE_ACCOUNT_EMAIL',
        'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
        'GOOGLE_ADMIN_EMAIL',
        'GOOGLE_DRIVE_ROOT_FOLDER_ID',
        'GOOGLE_TEMPLATE_DOC_ID',
        'RESEND_API_KEY',
        'EMAIL_FROM',
        'PUBLIC_TURNSTILE_SITE_KEY',
        'TURNSTILE_SECRET_KEY',
        'PUBLIC_SENTRY_DSN',
        'SENTRY_AUTH_TOKEN',
        'CRON_SECRET',
    ];
    const envExample = readIfExists('.env.example');
    const environmentDoc = readIfExists(path.join('docs', 'launch', 'ENVIRONMENT.md'));
    const runbook = readIfExists(path.join('docs', 'launch', 'RUNBOOK.md'));
    const missingFromExample = requiredEnv.filter((key) => !envExample.includes(key));
    const missingFromDocs = requiredEnv.filter((key) => !environmentDoc.includes(key));
    const details = [
        ...missingFromExample.map((key) => `.env.example missing ${key}`),
        ...missingFromDocs.map((key) => `docs/launch/ENVIRONMENT.md missing ${key}`),
    ];
    if (!envExample.includes('SENTRY_UPLOAD_SOURCEMAPS=false')) {
        details.push('.env.example must document SENTRY_UPLOAD_SOURCEMAPS=false for local builds.');
    }
    if (!environmentDoc.includes('SENTRY_UPLOAD_SOURCEMAPS')) {
        details.push('docs/launch/ENVIRONMENT.md must document SENTRY_UPLOAD_SOURCEMAPS.');
    }
    const rotationRequiredText = [
        'Rotacion Final De Claves',
        'KeePassXC',
        'pnpm secrets:check',
        'pnpm launch:security',
        'pnpm launch:operations',
        'pnpm launch:final-readiness',
        'revocar',
    ];
    for (const expected of rotationRequiredText) {
        if (!environmentDoc.includes(expected)) {
            details.push(`docs/launch/ENVIRONMENT.md must document final key rotation item: ${expected}.`);
        }
        if (!runbook.includes(expected)) {
            details.push(`docs/launch/RUNBOOK.md must document final key rotation item: ${expected}.`);
        }
    }

    return {
        name: 'environment documentation coverage',
        status: missingFromExample.length > 0 ? 'failed' : details.length > 0 ? 'warning' : 'ok',
        message: details.length === 0
            ? 'Required launch environment variables are present in .env.example and docs/launch/ENVIRONMENT.md.'
            : 'Required launch environment variables are not fully documented.',
        evidence: '.env.example, docs/launch/ENVIRONMENT.md, docs/launch/RUNBOOK.md',
        details,
    };
}

function runCommandCheck(name: string, command: string, args: string[]): GateResult {
    const logName = `${slug(name)}.log`;
    const logPath = path.join(outputDir, logName);
    const started = Date.now();
    const result = spawnSync(command, args, {
        cwd: process.cwd(),
        encoding: 'utf8',
        shell: process.platform === 'win32',
        maxBuffer: 50 * 1024 * 1024,
    });
    const durationMs = Date.now() - started;
    const output = [
        `$ ${[command, ...args].join(' ')}`,
        `exitCode=${result.status ?? 'null'}`,
        `durationMs=${durationMs}`,
        '',
        '--- stdout ---',
        result.stdout || '',
        '',
        '--- stderr ---',
        result.stderr || '',
        result.error ? `\n--- error ---\n${result.error.message}\n` : '',
    ].join('\n');
    writeFileSync(logPath, output, 'utf8');

    const stdout = result.stdout || '';
    const completedWithWarnings = result.status === 0 && /\[launch:[^\]]+\] Status: WARNING/.test(stdout);
    const status: GateStatus = result.status === 0 ? (completedWithWarnings ? 'warning' : 'ok') : 'failed';

    return {
        name,
        status,
        message: result.status === 0
            ? completedWithWarnings ? `${name} completed with warnings.` : `${name} passed.`
            : `${name} failed with exit code ${result.status ?? 'unknown'}.`,
        evidence: logPath,
        details: result.error ? [result.error.message] : undefined,
    };
}

function readIfExists(file: string): string {
    return existsSync(file) ? readFileSync(file, 'utf8') : '';
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

function findForbiddenApiRuntimeImports(apiDir: string): string[] {
    return filesUnder(apiDir)
        .filter((file) => /\.(ts|astro)$/.test(file))
        .flatMap((file) => {
            const content = readFileSync(file, 'utf8');
            return moduleSpecifiersFrom(content)
                .map((specifier) => ({
                    specifier,
                    normalized: normalizeModuleSpecifier(file, specifier),
                }))
                .filter(({ normalized }) => isForbiddenApiRuntimeImport(normalized))
                .map(({ specifier }) => `${toPosixPath(file)} imports forbidden runtime module ${specifier}`);
        });
}

function moduleSpecifiersFrom(source: string): string[] {
    const patterns = [
        /\bimport\s+(?:type\s+)?[\s\S]*?\sfrom\s*['"]([^'"]+)['"]/g,
        /\bimport\s*['"]([^'"]+)['"]/g,
        /\bexport\s+(?:type\s+)?[\s\S]*?\sfrom\s*['"]([^'"]+)['"]/g,
        /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
        /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];

    return patterns.flatMap((pattern) => Array.from(source.matchAll(pattern), (match) => match[1]));
}

function normalizeModuleSpecifier(fromFile: string, specifier: string): string {
    const withoutExtension = (value: string) => value
        .replace(/\\/g, '/')
        .replace(/\.(?:[cm]?[jt]sx?)$/, '');

    if (!specifier.startsWith('.')) return withoutExtension(specifier);

    return withoutExtension(path.relative(
        process.cwd(),
        path.resolve(path.dirname(fromFile), specifier)
    ));
}

function isForbiddenApiRuntimeImport(specifier: string): boolean {
    return /(?:^|\/)(?:src\/)?lib\/google(?:\/|$)/.test(specifier)
        || /(?:^|\/)(?:src\/)?lib\/fulfillment\/jobs(?:\/|$)/.test(specifier);
}

function runGitOutput(args: string[]): { exitCode: number | null; stdout: string; stderr: string } {
    const result = spawnSync('git', args, {
        cwd: process.cwd(),
        encoding: 'utf8',
        shell: process.platform === 'win32',
        maxBuffer: 1024 * 1024,
    });

    return {
        exitCode: result.status,
        stdout: result.stdout || '',
        stderr: result.stderr || result.error?.message || '',
    };
}

function renderMarkdown(summary: typeof summary): string {
    const lines = [
        '# Launch Verification Evidence',
        '',
        `- Status: ${summary.status}`,
        `- Started: ${summary.startedAt}`,
        `- Ended: ${summary.endedAt}`,
        `- Output: ${summary.outputDir}`,
        '',
        '| Status | Gate | Evidence | Message |',
        '| --- | --- | --- | --- |',
    ];

    for (const result of summary.results) {
        lines.push(`| ${result.status} | ${escapeCell(result.name)} | ${escapeCell(result.evidence || '')} | ${escapeCell(result.message)} |`);
        if (result.details?.length) {
            lines.push(`|  |  |  | ${escapeCell(result.details.join(' / '))} |`);
        }
    }

    lines.push('');
    lines.push('## Secondary Review Rule');
    lines.push('');
    lines.push('This evidence can only produce READY_CANDIDATE_REQUIRES_SECONDARY_REVIEW. A separate review must inspect the evidence and unresolved checklist items before launch can be declared READY.');
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function pnpmCheck(name: string, args: string[]): { name: string; command: string; args: string[] } {
    return { name, command: pnpmCommand(), args };
}

function pnpmCommand(): string {
    return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}

function slug(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'check';
}

function escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function toPosixPath(filePath: string): string {
    return filePath.replace(/\\/g, '/');
}
