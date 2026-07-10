import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type FindingStatus = 'ok' | 'warning' | 'failed';
type ReportStatus = 'OK' | 'WARNING' | 'FAILED';
type ManualStatus = 'pass' | 'accepted_risk' | 'pending' | 'blocked';
type ManualEvidencePhase = 'phase_1_now' | 'phase_2_release_candidate' | 'phase_3_final';

interface Finding {
    status: FindingStatus;
    area: string;
    message: string;
    details?: string[];
}

interface EvidenceItem {
    type?: string;
    value?: string;
    note?: string;
}

interface ManualCheck {
    id?: string;
    status?: ManualStatus;
    owner?: string;
    verifiedAt?: string;
    environment?: string;
    summary?: string;
    evidence?: EvidenceItem[];
    riskAcceptedBy?: string;
    riskRationale?: string;
    rollbackPlan?: string;
}

interface ManualEvidenceFile {
    schemaVersion?: number;
    updatedAt?: string;
    launchDecision?: 'blocked' | 'ready_with_accepted_risks' | 'ready';
    checks?: ManualCheck[];
}

interface RequiredCheck {
    id: string;
    area: string;
    phase: ManualEvidencePhase;
    requirement: string;
    maxAgeDays: number;
    readyWhen: string;
    nextActions: string[];
    evidenceExamples: string[];
}

interface PhaseManualCheck {
    id: string;
    phase: ManualEvidencePhase;
    heading: string;
    area: string;
    status: 'failed' | 'warning';
    message: string;
    details: string[];
}

interface ManualEvidencePhaseSummary {
    phase: ManualEvidencePhase;
    heading: string;
    openCount: number;
    failedCount: number;
    warningCount: number;
    checkIds: string[];
}

interface ManualEvidenceReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: ReportStatus;
    evidenceFile: string;
    manualEvidenceIndexPath: string;
    nextActionsPath: string;
    phaseOneWorksheetPath: string;
    phaseOneClosurePackPath: string;
    manualEvidencePhaseSummary: ManualEvidencePhaseSummary[];
    manualEvidenceByPhase: Record<ManualEvidencePhase, PhaseManualCheck[]>;
    findings: Finding[];
    outputDir: string;
}

const phaseOrder: ManualEvidencePhase[] = [
    'phase_1_now',
    'phase_2_release_candidate',
    'phase_3_final',
];

const phaseHeadings: Record<ManualEvidencePhase, string> = {
    phase_1_now: 'Fase 1: Ordenar Ahora',
    phase_2_release_candidate: 'Fase 2: Release Candidate',
    phase_3_final: 'Fase 3: Cierre Final',
};

const requiredChecks: RequiredCheck[] = [
    {
        id: 'cleanup_agents_decision',
        area: 'cleanup',
        phase: 'phase_1_now',
        requirement: '.agent/ and .agents/ keep/delete/move decision is recorded.',
        maxAgeDays: 90,
        readyWhen: 'Alin has recorded keep/delete/move for .agent/ and .agents/, including recovery path if moved.',
        nextActions: [
            'Choose keep, delete, or move outside the repo for .agent/ and .agents/.',
            'If moving, copy useful skills/workflows to a recoverable global location before deleting repo copies.',
            'Record the decision in docs/launch/MANUAL_EVIDENCE.local.json without secrets.',
        ],
        evidenceExamples: [
            'manual_note: "Decision: keep .agents through launch; review after release."',
            'path: "CLEANUP.md"',
        ],
    },
    {
        id: 'legal_owner_controller',
        area: 'legal',
        phase: 'phase_3_final',
        requirement: 'Real owner/controller data is filled and legal placeholders are removed.',
        maxAgeDays: 90,
        readyWhen: 'Legal pages contain real owner/controller data and pnpm launch:legal plus pnpm launch:verify no longer report legal placeholders.',
        nextActions: [
            'Fill the real owner/controller inputs listed in docs/launch/LEGAL_INPUTS_REQUIRED.md.',
            'Apply those values to the legal pages in ES/EN/RU as appropriate.',
            'Run pnpm launch:legal and confirm the legal audit is OK.',
            'Run pnpm launch:verify and confirm the primary gate is no longer blocked by legal checks.',
        ],
        evidenceExamples: [
            'path: "LEGAL_INPUTS_REQUIRED.md"',
            'command_output: "../../outputs/launch-legal/<timestamp>/summary.md"',
            'command_output: "../../outputs/launch-verification/<timestamp>/summary.md"',
        ],
    },
    {
        id: 'legal_human_review',
        area: 'legal',
        phase: 'phase_3_final',
        requirement: 'Privacy, cookies, terms and subprocessors are reviewed by a human owner or advisor.',
        maxAgeDays: 90,
        readyWhen: 'A human owner or legal advisor has reviewed privacy, cookies, terms and subprocessors.',
        nextActions: [
            'Review privacy, cookies, terms, legal notice and subprocessors.',
            'Confirm Stripe, Supabase, Google, Resend, Sentry and Cloudflare processing language is acceptable.',
            'Record who reviewed it, the date, scope and any accepted risk.',
        ],
        evidenceExamples: [
            'manual_note: "Alin reviewed legal pages and subprocessors on YYYY-MM-DD."',
            'document: "legal-review-note.md"',
        ],
    },
    {
        id: 'accessibility_manual',
        area: 'accessibility',
        phase: 'phase_1_now',
        requirement: 'Keyboard, visible focus, screen reader, 200% zoom, real mobile and critical forms are manually reviewed.',
        maxAgeDays: 30,
        readyWhen: 'Manual accessibility pass covers keyboard, focus, screen reader, zoom, mobile and critical forms.',
        nextActions: [
            'Test public pages, login, checkout entry, campus navigation and key forms using keyboard only.',
            'Check visible focus, screen reader labels, zoom 200%, mobile real device and error states.',
            'Record failures fixed before closing Fase 1.',
        ],
        evidenceExamples: [
            'screenshot: "evidence/accessibility-mobile.png"',
            'manual_note: "Keyboard/focus/VoiceOver pass completed on staging."',
        ],
    },
    {
        id: 'security_external',
        area: 'security',
        phase: 'phase_1_now',
        requirement: 'Phase 1 security baseline is reviewed for RC: hosted Supabase RLS, server-only privileged key placement, current Cloudflare/Turnstile/log posture and third-party access where visible. Final key rotation remains final-only.',
        maxAgeDays: 30,
        readyWhen: 'External security posture is reviewed enough for RC, with final key rotation, live-domain review and any deeper permission audit tracked for final closure.',
        nextActions: [
            'Review Supabase RLS and service role usage in the real staging/production projects.',
            'Review Cloudflare/Turnstile logs and posture visible for the current staging/production setup.',
            'Confirm no final key rotation is required for RC; keep final rotation and live-domain review under final closure.',
        ],
        evidenceExamples: [
            'dashboard: "Supabase production RLS policies reviewed, no screenshots with secrets."',
            'screenshot: "outputs/launch-user-evidence/<date>/cloudflare-turnstile-landing-analytics.png"',
            'manual_note: "Current Cloudflare security posture reviewed; final key rotation remains tracked in integration_readiness."',
        ],
    },
    {
        id: 'payments_staging',
        area: 'payments',
        phase: 'phase_3_final',
        requirement: 'Stripe test staging purchase, webhook delivery, subscription/payment, portal and reconciliation are verified before enabling real payments; if launching without payments, checkout is disabled, hidden or blocked by configuration/data.',
        maxAgeDays: 14,
        readyWhen: 'Stripe test purchase evidence exists before payments are enabled, or the no-real-payments launch mode has checkout disabled, hidden or blocked and tracked for final closure.',
        nextActions: [
            'If payments are enabled for the candidate, run a staging checkout with Stripe test card.',
            'Confirm Stripe webhook delivery, subscription/payment rows, portal access and reconciliation before accepting real payments.',
            'If payments are deferred, confirm checkout is disabled, hidden or blocked by configuration/data until Stripe is closed.',
            'Record Stripe dashboard references or the no-real-payments decision without secret keys or full payment details.',
        ],
        evidenceExamples: [
            'url: "https://dashboard.stripe.com/test/events/<event-id>"',
            'manual_note: "Staging test purchase completed; subscription row reconciled."',
            'manual_note: "No-real-payments launch mode: checkout disabled/blocked until Stripe final closure."',
        ],
    },
    {
        id: 'operations_external',
        area: 'operations',
        phase: 'phase_1_now',
        requirement: 'RC operations baseline is verified: Cloudflare fulfillment Worker staging, fulfillment_jobs recovery, Resend staging visibility, cron configuration, Workers Logs/observability visibility, Supabase Free backup posture and rollback baseline. Production Worker, final Drive smoke and unclear Google closure remain final-only.',
        maxAgeDays: 14,
        readyWhen: 'Staging operations and recoverability are verified externally, with Supabase Free/no native scheduled backups documented and production Worker, final Drive smoke and final backup action tracked for closure.',
        nextActions: [
            'Run pnpm launch:staging-operations -- --include-wrangler to refresh public Worker health/auth and read-only Wrangler evidence.',
            'Run pnpm launch:operations-external-closure and open outputs/launch-operations-external-closure/<timestamp>/operations-external-closure-pack.md.',
            'Use read-only Wrangler commands where available to confirm account, staging Worker deployment status/history, version and secret names; never run deploy, rollback, secret put/delete or tail sessions as part of this evidence refresh without explicit confirmation.',
            'Check Cloudflare fulfillment Worker staging service, health check, secrets, deploy settings and Pages-to-Worker URL alignment.',
            'Verify fulfillment_jobs processing and admin recovery path after database_readiness closes; if staging DB is still unavailable, record only an explicit scoped RC substitute based on local UI/API/tests.',
            'Verify Resend staging delivery/suppression visibility and Cloudflare Workers Logs/observability visibility; cron config, staging deployment and secret-name evidence are covered by the staging preflight.',
            'Record Supabase Free backup posture and final manual backup/Pro-upgrade action; keep production Worker and final Drive smoke in final closure.',
        ],
        evidenceExamples: [
            'manual_note: "Wrangler read-only preflight confirmed staging Worker deployment and expected secret names; no values recorded."',
            'command_output: "outputs/launch-operations-external-closure/<timestamp>/operations-external-closure-pack.md"',
            'dashboard: "Cloudflare fulfillment Worker staging logs/observability visible; cron config covered by preflight."',
            'screenshot: "outputs/launch-user-evidence/<date>/cloudflare-worker-staging-overview-metrics-triggers.png"',
            'screenshot: "outputs/launch-user-evidence/<date>/resend-staging-smoke-delivered.png"',
            'path: "RUNBOOK.md"',
        ],
    },
    {
        id: 'content_review',
        area: 'content',
        phase: 'phase_1_now',
        requirement: 'ES/EN/RU copy, prices, emails, empty states and error states are reviewed by a human.',
        maxAgeDays: 30,
        readyWhen: 'Human review confirms public copy, prices, emails, empty states and error states in ES/EN/RU.',
        nextActions: [
            'Review public pages and campus surfaces in ES, EN and RU.',
            'Review prices, package descriptions, transactional emails, empty states and error states.',
            'Record routes reviewed and any copy changes.',
        ],
        evidenceExamples: [
            'manual_note: "Reviewed ES/EN/RU homepage, pricing, login and campus empty states."',
            'screenshot: "evidence/content-pricing-es.png"',
        ],
    },
    {
        id: 'database_readiness',
        area: 'database',
        phase: 'phase_1_now',
        requirement: 'Supabase staging/production separation, hosted migrations/RLS, staging data flow, audit/job tables and Supabase Free backup posture are verified for RC.',
        maxAgeDays: 14,
        readyWhen: 'Hosted Supabase state is checked directly for RC, including staging migration-history decision and explicit Free-plan backup posture: no destructive production database work before manual logical backup/export or Pro upgrade.',
        nextActions: [
            'Run the generated hosted schema check SQL from outputs/launch-operations/<timestamp>/hosted-schema-check.sql against staging first; record only aggregate/missing metadata, not table rows.',
            'Resolve or explicitly explain any missing launch-critical tables, columns, indexes, RLS policies or privileges before marking database_readiness as pass.',
            'Verify staging assignments, subscriptions and package rows using safe test data.',
            'Confirm production migrations are applied from supabase/migrations and match db/schema.sql only after staging passes and Alin confirms production is in scope.',
            'Confirm RLS and admin_audit_log/fulfillment_jobs readiness.',
            'Record that Supabase Free has no native scheduled backups and final manual backup/export or Pro upgrade is required before production deploy/destructive migration.',
        ],
        evidenceExamples: [
            'command_output: "outputs/launch-operations/<timestamp>/hosted-schema-drift-worksheet.md"',
            'manual_note: "Hosted schema check passed with 0 missing critical metadata entries on staging; production verified or explicitly scoped out."',
            'dashboard: "Supabase staging-first migrations/RLS reviewed; production and Free backup posture documented."',
            'screenshot: "outputs/launch-user-evidence/<date>/supabase-production-free-plan-no-scheduled-backups.png"',
            'manual_note: "Staging assignment/subscription flow verified."',
        ],
    },
    {
        id: 'integration_readiness',
        area: 'integrations',
        phase: 'phase_3_final',
        requirement: 'Stripe test rehearsal and Stripe live readiness for real payments from day one, including CHECKOUT_ENABLED_OVERRIDE rollback, Cloudflare Pages-vs-Worker/domain ownership, production Worker secret-name posture, Google, Resend, Turnstile domains and fulfillment/reminder worker configuration are verified.',
        maxAgeDays: 14,
        readyWhen: 'Stripe test evidence is complete and Stripe live evidence supports real payments from day one, while CHECKOUT_ENABLED_OVERRIDE remains closed until Go/No-Go and is proven as rollback; Cloudflare custom domains serve the intended final runtime, production Worker and required secret names are verified, and Google, Resend, Turnstile and reminders are verified for the intended environment.',
        nextActions: [
            'Verify Stripe test end to end, then Stripe live mode, webhook endpoints and CHECKOUT_ENABLED_OVERRIDE rollback before accepting real payments.',
            'Review outputs/019f1a5e-2745-7c43-870d-544e6ba4e0b1/strict-qa-v2/cloudflare-domain-worker-preflight.md and close Cloudflare in phases: production Worker creation, secret-name setup, direct Worker URL probes, then custom-domain move only after separate explicit approval.',
            'Verify Google Drive template/root folder/admin account and Resend sender/domain.',
            'Run pnpm launch:turnstile-readonly -- --env-file <env-file> as runtime support evidence, then separately verify the Cloudflare Turnstile widget domains in dashboard/API before marking this check pass.',
            'Verify Turnstile domains and fulfillment/reminder worker configuration.',
        ],
        evidenceExamples: [
            'manual_note: "Payment posture verified: Stripe test mode for final rehearsal; no real payments accepted before live switch."',
            'command_output: "outputs/019f1a5e-2745-7c43-870d-544e6ba4e0b1/strict-qa-v2/cloudflare-domain-worker-preflight.md"',
            'manual_note: "Cloudflare final custom domains serve the intended runtime; production Worker and secret-name posture verified without printing values."',
            'dashboard: "Stripe live webhook endpoints reviewed before accepting real payments."',
            'manual_note: "Google template/root folder and Resend sender verified."',
            'command_output: "outputs/launch-turnstile-readonly-evidence/<timestamp>/summary.md"',
            'dashboard: "Turnstile widget site key prefix and allowed domains reviewed; no secret key copied."',
        ],
    },
    {
        id: 'seo_llm_final',
        area: 'marketing/seo',
        phase: 'phase_3_final',
        requirement: 'Final SEO/LLM readiness and premium Russian/Cyrillic typography are reviewed after production domain, copy, legal content and payment mode are stable.',
        maxAgeDays: 14,
        readyWhen: 'Final domain/copy/legal/payment mode are stable, pnpm launch:seo is OK, sitemap/robots/canonical/hreflang/JSON-LD/llms.txt/snippets/Search Console or equivalent checks are reviewed, premium Russian font/Cyrillic rendering is bought/licensed or explicitly accepted as fallback, and private/demo/campus/API routes remain excluded.',
        nextActions: [
            'Run pnpm launch:seo and open outputs/launch-seo/<timestamp>/seo-llm-final-worksheet.md.',
            'Verify production robots, sitemap, canonical/hreflang, JSON-LD, snippets and llms.txt after final copy/legal/domain.',
            'Verify `/ru` uses the intended official Cyrillic-capable family after purchase/licensing, or record Alin accepted the current fallback for launch.',
            'Decide legal page index policy and align sitemap/noindex with that decision.',
            'Record Search Console or equivalent URL inspection evidence when available, without secrets.',
        ],
        evidenceExamples: [
            'command_output: "../../outputs/launch-seo/<timestamp>/summary.md"',
            'manual_note: "Final SEO/LLM review completed on production domain; private routes excluded; `/ru` Cyrillic typography decision recorded."',
            'dashboard: "Search Console sitemap submitted and key URLs inspected."',
        ],
    },
    {
        id: 'final_smoke',
        area: 'smoke final',
        phase: 'phase_3_final',
        requirement: 'Registration, checkout, webhook, Drive, email, booking, Doc, Calendar/Meet, reminder, cancellation and retry are verified end-to-end.',
        maxAgeDays: 7,
        readyWhen: 'End-to-end final smoke passes in staging and, at launch time, production smoke is documented.',
        nextActions: [
            'Run registration, checkout, webhook, Drive, email and booking end-to-end.',
            'Verify Doc, Calendar/Meet, reminder, cancellation and failed-job retry.',
            'Record exact environment, timestamp, accounts used and non-secret evidence.',
        ],
        evidenceExamples: [
            'manual_note: "Final staging smoke passed: registration -> booking -> cancellation."',
            'command_output: "../../outputs/<smoke-run>/summary.md"',
        ],
    },
];

const allowedEvidenceTypes = new Set([
    'url',
    'path',
    'screenshot',
    'command_output',
    'dashboard',
    'document',
    'manual_note',
]);

const startedAt = new Date();
const evidenceFile = path.resolve(process.cwd(), parseEvidenceFileArg());
const outputDir = path.join(process.cwd(), 'outputs', 'launch-manual-evidence', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const findings = [
    ...reviewManualEvidenceDocumentation(),
    ...reviewEvidenceFile(evidenceFile),
];
const failed = findings.filter((finding) => finding.status === 'failed');
const warnings = findings.filter((finding) => finding.status === 'warning');
const status: ReportStatus = failed.length > 0 ? 'FAILED' : warnings.length > 0 ? 'WARNING' : 'OK';
const manualEvidenceIndexPath = path.join(outputDir, 'manual-evidence-index.md');
const nextActionsPath = path.join(outputDir, 'next-actions.md');
const phaseOneWorksheetPath = path.join(outputDir, 'phase-1-worksheet.md');
const phaseOneClosurePackPath = path.join(outputDir, 'phase-1-closure-pack.md');
const manualEvidenceByPhase = groupManualEvidenceByPhase(findings);
const manualEvidencePhaseSummary = summarizeManualEvidenceByPhase(manualEvidenceByPhase);

const report: ManualEvidenceReport = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status,
    evidenceFile,
    manualEvidenceIndexPath,
    nextActionsPath,
    phaseOneWorksheetPath,
    phaseOneClosurePackPath,
    manualEvidencePhaseSummary,
    manualEvidenceByPhase,
    findings,
    outputDir,
};

writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(path.join(outputDir, 'summary.md'), renderMarkdown(report), 'utf8');
writeFileSync(manualEvidenceIndexPath, renderManualEvidenceIndex(report), 'utf8');
writeFileSync(nextActionsPath, renderNextActions(report), 'utf8');
writeFileSync(phaseOneWorksheetPath, renderPhaseOneWorksheet(report), 'utf8');
writeFileSync(phaseOneClosurePackPath, renderPhaseOneClosurePack(report), 'utf8');

console.log(`[launch:manual-evidence] Status: ${status}`);
console.log(`[launch:manual-evidence] Failed: ${failed.length}`);
console.log(`[launch:manual-evidence] Warnings: ${warnings.length}`);
console.log(`[launch:manual-evidence] Evidence file: ${evidenceFile}`);
console.log(`[launch:manual-evidence] Summary: ${path.join(outputDir, 'summary.md')}`);
console.log(`[launch:manual-evidence] Manual evidence index: ${manualEvidenceIndexPath}`);
console.log(`[launch:manual-evidence] Next actions: ${nextActionsPath}`);
console.log(`[launch:manual-evidence] Phase 1 worksheet: ${phaseOneWorksheetPath}`);
console.log(`[launch:manual-evidence] Phase 1 closure pack: ${phaseOneClosurePackPath}`);

if (failed.length > 0) process.exit(1);

function reviewManualEvidenceDocumentation(): Finding[] {
    const requiredIds = requiredChecks.map((required) => required.id);
    const details: string[] = [];
    const documentationFiles = [
        {
            label: 'manual evidence guide',
            file: path.join('docs', 'launch', 'MANUAL_EVIDENCE.md'),
            snippets: [
                'MANUAL_EVIDENCE_RUNBOOK.md',
                'LAUNCH_SEQUENCE.md',
                'manual-evidence-index.md',
                'phase-1-closure-pack.md',
                'pnpm launch:gate',
                ...requiredIds,
            ],
        },
        {
            label: 'manual evidence runbook',
            file: path.join('docs', 'launch', 'MANUAL_EVIDENCE_RUNBOOK.md'),
            snippets: requiredIds.map((id) => `## ${id}`),
        },
        {
            label: 'launch sequence',
            file: path.join('docs', 'launch', 'LAUNCH_SEQUENCE.md'),
            snippets: [
                '## Evidencia manual por momento',
                ...requiredIds,
            ],
        },
        {
            label: 'launch checklist',
            file: path.join('docs', 'launch', 'CHECKLIST.md'),
            snippets: [
                'MANUAL_EVIDENCE_RUNBOOK.md',
                'resumen por urgencia/final-only',
                ...requiredIds,
            ],
        },
    ];

    for (const doc of documentationFiles) {
        const content = readIfExists(doc.file);
        if (!content) {
            details.push(`${doc.label} is missing: ${doc.file}`);
            continue;
        }

        for (const snippet of doc.snippets) {
            if (!content.includes(snippet)) {
                details.push(`${doc.label} missing ${snippet}.`);
            }
        }
    }

    details.push(...reviewManualEvidenceExample(requiredIds));

    return [{
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'manual evidence documentation coverage',
        message: details.length === 0
            ? 'Manual evidence script, example, runbook, sequence and checklist cover the same required checks.'
            : 'Manual evidence documentation is out of sync with required checks.',
        details,
    }];
}

function reviewManualEvidenceExample(requiredIds: string[]): string[] {
    const details: string[] = [];
    const examplePath = path.join('docs', 'launch', 'MANUAL_EVIDENCE.example.json');
    const raw = readIfExists(examplePath);

    if (!raw) return [`manual evidence example is missing: ${examplePath}`];

    let parsed: ManualEvidenceFile;
    try {
        parsed = JSON.parse(raw) as ManualEvidenceFile;
    } catch (error) {
        return [`manual evidence example is invalid JSON: ${error instanceof Error ? error.message : String(error)}`];
    }

    if (parsed.schemaVersion !== 1) details.push('manual evidence example schemaVersion must be 1.');
    if (parsed.launchDecision !== 'blocked') details.push('manual evidence example launchDecision must stay blocked.');
    if (!Array.isArray(parsed.checks)) {
        details.push('manual evidence example checks must be an array.');
        return details;
    }

    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const check of parsed.checks) {
        if (!check.id) continue;
        if (seen.has(check.id)) duplicates.add(check.id);
        seen.add(check.id);
    }

    const missing = requiredIds.filter((id) => !seen.has(id));
    const extra = Array.from(seen).filter((id) => !requiredIds.includes(id)).sort();

    if (duplicates.size > 0) details.push(`manual evidence example duplicate checks: ${Array.from(duplicates).sort().join(', ')}.`);
    if (missing.length > 0) details.push(`manual evidence example missing checks: ${missing.join(', ')}.`);
    if (extra.length > 0) details.push(`manual evidence example has extra checks: ${extra.join(', ')}.`);

    return details;
}

function reviewEvidenceFile(file: string): Finding[] {
    if (!existsSync(file)) {
        return [{
            status: 'failed',
            area: 'manual evidence file',
            message: 'Manual launch evidence file is missing.',
            details: [
                `Expected ${file}. Copy docs/launch/MANUAL_EVIDENCE.example.json to docs/launch/MANUAL_EVIDENCE.local.json and fill it with non-secret evidence.`,
            ],
        }];
    }

    const raw = readFileSync(file, 'utf8');
    const secretFindings = scanForSecretsOrPlaceholders(raw, file);
    let parsed: ManualEvidenceFile;
    try {
        parsed = JSON.parse(raw) as ManualEvidenceFile;
    } catch (error) {
        return [
            ...secretFindings,
            {
                status: 'failed',
                area: 'manual evidence file',
                message: 'Manual launch evidence file is not valid JSON.',
                details: [error instanceof Error ? error.message : String(error)],
            },
        ];
    }

    const findings: Finding[] = [...secretFindings];

    findings.push(reviewFileHeader(parsed));
    findings.push(...reviewChecks(parsed, file));
    findings.push(reviewLaunchDecisionConsistency(parsed));

    return findings;
}

function reviewFileHeader(parsed: ManualEvidenceFile): Finding {
    const details: string[] = [];
    if (parsed.schemaVersion !== 1) {
        details.push(`schemaVersion is ${String(parsed.schemaVersion)}, expected 1.`);
    }
    const updatedAt = parseDate(parsed.updatedAt);
    if (!updatedAt) {
        details.push('updatedAt is missing or invalid.');
    } else if (updatedAt > startedAt) {
        details.push('updatedAt is in the future.');
    }
    if (!['blocked', 'ready_with_accepted_risks', 'ready'].includes(parsed.launchDecision || '')) {
        details.push('launchDecision must be blocked, ready_with_accepted_risks or ready.');
    }
    if (!Array.isArray(parsed.checks)) {
        details.push('checks must be an array.');
    }

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'manual evidence file header',
        message: details.length === 0
            ? 'Manual evidence file header is valid.'
            : 'Manual evidence file header is incomplete or invalid.',
        details,
    };
}

function reviewChecks(parsed: ManualEvidenceFile, file: string): Finding[] {
    if (!Array.isArray(parsed.checks)) return [];

    const findings: Finding[] = [];
    const checksById = new Map<string, ManualCheck>();
    const duplicateIds = new Set<string>();

    for (const check of parsed.checks) {
        if (!check.id) continue;
        if (checksById.has(check.id)) duplicateIds.add(check.id);
        checksById.set(check.id, check);
    }

    if (duplicateIds.size > 0) {
        findings.push({
            status: 'failed',
            area: 'manual evidence duplicate ids',
            message: 'Manual evidence has duplicate check ids.',
            details: Array.from(duplicateIds).sort(),
        });
    }

    for (const required of requiredChecks) {
        const check = checksById.get(required.id);
        if (!check) {
            findings.push({
                status: 'failed',
                area: required.area,
                message: `Missing manual evidence check: ${required.id}.`,
                details: [required.requirement],
            });
            continue;
        }

        findings.push(reviewSingleCheck(required, check, file));
    }

    const extraIds = Array.from(checksById.keys())
        .filter((id) => !requiredChecks.some((required) => required.id === id))
        .sort();
    if (extraIds.length > 0) {
        findings.push({
            status: 'warning',
            area: 'manual evidence extra ids',
            message: 'Manual evidence includes extra check ids not used by the Launch Gate.',
            details: extraIds,
        });
    }

    return findings;
}

function reviewLaunchDecisionConsistency(parsed: ManualEvidenceFile): Finding {
    if (!Array.isArray(parsed.checks) || !['blocked', 'ready_with_accepted_risks', 'ready'].includes(parsed.launchDecision || '')) {
        return {
            status: 'ok',
            area: 'manual launch decision',
            message: 'Launch decision consistency is deferred until the evidence header and checks are valid.',
        };
    }

    const requiredStatuses = requiredChecks
        .map((required) => parsed.checks?.find((check) => check.id === required.id)?.status)
        .filter((status): status is ManualStatus => Boolean(status));
    const hasPendingOrBlocked = requiredStatuses.some((status) => status === 'pending' || status === 'blocked');
    const hasAcceptedRisk = requiredStatuses.some((status) => status === 'accepted_risk');
    const details: string[] = [];

    if (hasPendingOrBlocked && parsed.launchDecision !== 'blocked') {
        details.push('launchDecision must stay blocked while any required check is pending or blocked.');
    }
    if (!hasPendingOrBlocked && parsed.launchDecision === 'blocked') {
        details.push('launchDecision is still blocked even though no required check is pending or blocked.');
    }
    if (!hasPendingOrBlocked && hasAcceptedRisk && parsed.launchDecision !== 'ready_with_accepted_risks') {
        details.push('launchDecision must be ready_with_accepted_risks when any required check is accepted_risk.');
    }
    if (!hasPendingOrBlocked && !hasAcceptedRisk && parsed.launchDecision !== 'ready') {
        details.push('launchDecision must be ready when all required checks pass without accepted risks.');
    }

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'manual launch decision',
        message: details.length === 0
            ? 'Manual launch decision is consistent with required check statuses.'
            : 'Manual launch decision is inconsistent with required check statuses.',
        details,
    };
}

function reviewSingleCheck(required: RequiredCheck, check: ManualCheck, file: string): Finding {
    const details: string[] = [];
    const status = check.status;

    if (!status || !['pass', 'accepted_risk', 'pending', 'blocked'].includes(status)) {
        details.push(`${required.id}: status must be pass, accepted_risk, pending or blocked.`);
    }
    if (status === 'pending' || status === 'blocked') {
        details.push(`${required.id}: status is ${status}.`);
    }
    if (!check.owner?.trim()) {
        details.push(`${required.id}: owner is required.`);
    }
    if (!check.environment?.trim()) {
        details.push(`${required.id}: environment is required.`);
    }
    const summaryText = check.summary?.trim() ?? '';
    if (summaryText.length < 20) {
        details.push(`${required.id}: summary must describe the verification in at least 20 characters.`);
    }
    if ((status === 'pending' || status === 'blocked') && summaryText.length >= 20) {
        details.push(`${required.id}: current summary: ${summaryText}`);
    }

    const verifiedAt = parseDate(check.verifiedAt);
    if (!verifiedAt) {
        details.push(`${required.id}: verifiedAt is missing or invalid.`);
    } else {
        if (verifiedAt > startedAt) {
            details.push(`${required.id}: verifiedAt is in the future.`);
        }
        const ageDays = (startedAt.getTime() - verifiedAt.getTime()) / (1000 * 60 * 60 * 24);
        if (ageDays > required.maxAgeDays) {
            details.push(`${required.id}: verifiedAt is older than ${required.maxAgeDays} days.`);
        }
    }

    if (!Array.isArray(check.evidence) || check.evidence.length === 0) {
        details.push(`${required.id}: at least one evidence item is required.`);
    } else {
        details.push(...reviewEvidenceItems(required.id, check.evidence, file));
    }

    if (status === 'accepted_risk') {
        if (!check.riskAcceptedBy?.trim()) {
            details.push(`${required.id}: accepted_risk requires riskAcceptedBy.`);
        }
        if (!check.riskRationale || check.riskRationale.trim().length < 20) {
            details.push(`${required.id}: accepted_risk requires a specific riskRationale.`);
        }
        if (!check.rollbackPlan || check.rollbackPlan.trim().length < 20) {
            details.push(`${required.id}: accepted_risk requires a specific rollbackPlan.`);
        }
    }

    const hasFailures = details.length > 0;
    const acceptedRisk = status === 'accepted_risk' && !hasFailures;

    return {
        status: hasFailures ? 'failed' : acceptedRisk ? 'warning' : 'ok',
        area: required.area,
        message: hasFailures
            ? `Manual evidence for ${required.id} is incomplete.`
            : acceptedRisk
                ? `Manual evidence for ${required.id} is accepted as a documented risk.`
                : `Manual evidence for ${required.id} is complete.`,
        details: hasFailures ? [required.requirement, ...details] : acceptedRisk ? [required.requirement] : undefined,
    };
}

function reviewEvidenceItems(checkId: string, evidence: EvidenceItem[], evidenceFilePath: string): string[] {
    const details: string[] = [];
    const evidenceDir = path.dirname(evidenceFilePath);

    evidence.forEach((item, index) => {
        const label = `${checkId}.evidence[${index}]`;
        if (!item.type || !allowedEvidenceTypes.has(item.type)) {
            details.push(`${label}: type must be one of ${Array.from(allowedEvidenceTypes).join(', ')}.`);
        }
        if (!item.value?.trim()) {
            details.push(`${label}: value is required.`);
            return;
        }

        if (item.type === 'url') {
            try {
                const url = new URL(item.value);
                if (!['http:', 'https:'].includes(url.protocol)) {
                    details.push(`${label}: url must use http or https.`);
                }
            } catch {
                details.push(`${label}: value is not a valid URL.`);
            }
        }

        if (item.type === 'path' || item.type === 'screenshot' || item.type === 'command_output' || item.type === 'document') {
            const candidate = path.isAbsolute(item.value)
                ? item.value
                : path.resolve(evidenceDir, item.value);
            if (!existsSync(candidate)) {
                details.push(`${label}: referenced file does not exist: ${item.value}.`);
            }
        }
    });

    return details;
}

function scanForSecretsOrPlaceholders(raw: string, file: string): Finding[] {
    const patterns: Array<[string, RegExp]> = [
        ['Supabase service key', /sb_secret_[A-Za-z0-9_-]{20,}/g],
        ['JWT-like token', /eyJ[A-Za-z0-9_-]{50,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g],
        ['Stripe secret key', /sk_(?:live|test)_[A-Za-z0-9]{20,}/g],
        ['Stripe webhook secret', /whsec_[A-Za-z0-9]{20,}/g],
        ['Google API key', /AIza[0-9A-Za-z_-]{30,}/g],
        ['Resend API key', /re_[A-Za-z0-9_]{20,}/g],
        ['Database URL with password', /(postgres|postgresql|mysql|mongodb)(:\/\/|\+srv:\/\/)[^\s"']+:[^\s"']+@/g],
        ['URL credentials', /https?:\/\/[^/\s"']+:[^@\s"']+@/g],
        ['Sensitive URL query parameter', /[?&](?:access_token|auth|key|password|pass|refresh_token|secret|session|sig|signature|token)=[^&#\s"']{8,}/gi],
        ['Bearer token', /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/g],
        ['Supabase service role reference', /SUPABASE_SERVICE_ROLE_KEY|service_role/gi],
        ['Google private key', new RegExp('-{5}BEGIN PRIVATE KEY-{5}', 'g')],
        ['Placeholder marker', /\b(?:TODO|FIXME|PLACEHOLDER|TBD)\b/gi],
        ['Bracket placeholder', /\[(?:TODO|TBD|NAME|NOMBRE|FULL|NUMBER|DIRECCI|ADDRESS|EMAIL|PHONE|PENDIENTE)[^\]\r\n]{0,80}\]/gi],
    ];

    const details: string[] = [];
    for (const [label, pattern] of patterns) {
        const matches = raw.match(pattern);
        if (matches?.length) {
            details.push(`${file}: detected ${label} (${matches.length}).`);
        }
    }

    return [{
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'manual evidence secret and placeholder scan',
        message: details.length === 0
            ? 'Manual evidence has no detected secret-like values or placeholders.'
            : 'Manual evidence contains secret-like values or placeholders.',
        details,
    }];
}

function parseEvidenceFileArg(): string {
    const evidenceIndex = process.argv.findIndex((arg) => arg === '--evidence');
    if (evidenceIndex >= 0 && process.argv[evidenceIndex + 1]) {
        return process.argv[evidenceIndex + 1];
    }

    return process.env.LAUNCH_MANUAL_EVIDENCE || path.join('docs', 'launch', 'MANUAL_EVIDENCE.local.json');
}

function parseDate(value: unknown): Date | null {
    if (typeof value !== 'string') return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function readIfExists(file: string): string {
    return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

function renderMarkdown(report: ManualEvidenceReport): string {
    const lines = [
        '# Launch Manual Evidence Audit',
        '',
        `- Status: ${report.status}`,
        `- Started: ${report.startedAt}`,
        `- Ended: ${report.endedAt}`,
        `- Evidence file: ${report.evidenceFile}`,
        `- Output: ${report.outputDir}`,
        `- Manual evidence index: ${report.manualEvidenceIndexPath}`,
        `- Next actions: ${report.nextActionsPath}`,
        `- Phase 1 worksheet: ${report.phaseOneWorksheetPath}`,
        `- Phase 1 closure pack: ${report.phaseOneClosurePackPath}`,
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
    lines.push('## Manual Evidence Phase Summary');
    lines.push('');
    lines.push('| Phase | Open | Failed | Warnings | Checks |');
    lines.push('| --- | ---: | ---: | ---: | --- |');
    for (const phaseSummary of report.manualEvidencePhaseSummary) {
        lines.push(`| ${escapeCell(phaseSummary.heading)} | ${phaseSummary.openCount} | ${phaseSummary.failedCount} | ${phaseSummary.warningCount} | ${escapeCell(phaseSummary.checkIds.join(', ') || '-')} |`);
    }
    lines.push('');
    lines.push('## Scope');
    lines.push('');
    lines.push('This audit validates the format, freshness and non-secret evidence for launch checks that cannot be proven by static code or local automated tests. It does not perform the external checks itself.');
    lines.push('');
    lines.push(`Manual evidence index: ${report.manualEvidenceIndexPath}`);
    lines.push(`Action plan: ${report.nextActionsPath}`);
    lines.push(`Phase 1 closure pack: ${report.phaseOneClosurePackPath}`);
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function groupManualEvidenceByPhase(findingsToGroup: Finding[]): Record<ManualEvidencePhase, PhaseManualCheck[]> {
    const grouped: Record<ManualEvidencePhase, PhaseManualCheck[]> = {
        phase_1_now: [],
        phase_2_release_candidate: [],
        phase_3_final: [],
    };

    for (const finding of findingsToGroup) {
        if (finding.status !== 'failed' && finding.status !== 'warning') continue;

        const required = findRequiredCheckForFinding(finding);
        if (!required) continue;

        grouped[required.phase].push({
            id: required.id,
            phase: required.phase,
            heading: phaseHeadings[required.phase],
            area: finding.area,
            status: finding.status,
            message: finding.message,
            details: finding.details ?? [],
        });
    }

    for (const phase of phaseOrder) {
        grouped[phase].sort((a, b) => a.id.localeCompare(b.id));
    }

    return grouped;
}

function summarizeManualEvidenceByPhase(
    grouped: Record<ManualEvidencePhase, PhaseManualCheck[]>
): ManualEvidencePhaseSummary[] {
    return phaseOrder.map((phase) => {
        const checks = grouped[phase];
        return {
            phase,
            heading: phaseHeadings[phase],
            openCount: checks.length,
            failedCount: checks.filter((check) => check.status === 'failed').length,
            warningCount: checks.filter((check) => check.status === 'warning').length,
            checkIds: checks.map((check) => check.id),
        };
    });
}

function findRequiredCheckForFinding(finding: Finding): RequiredCheck | null {
    const haystack = [
        finding.message,
        ...(finding.details ?? []),
    ].join(' ');

    return requiredChecks.find((required) => haystack.includes(required.id)) ?? null;
}

function renderManualEvidenceIndex(report: ManualEvidenceReport): string {
    const lines = [
        '# Manual Evidence Index',
        '',
        `- Status: ${report.status}`,
        `- Evidence file: ${report.evidenceFile}`,
        `- Generated: ${report.endedAt}`,
        '',
        '## How To Use',
        '',
        'Use this generated index as the single map from each required manual check to its phase, support command, worksheet and minimum evidence. It is not the source of truth; update `docs/launch/MANUAL_EVIDENCE.local.json`, then rerun `pnpm launch:manual-evidence`, `pnpm launch:secondary-review` and `pnpm launch:status`.',
        '',
        '| Phase | Check | Command | Worksheet | Evidence Minimum |',
        '| --- | --- | --- | --- | --- |',
    ];

    for (const phase of phaseOrder) {
        const phaseChecks = requiredChecks.filter((required) => required.phase === phase);
        for (const required of phaseChecks) {
            lines.push([
                phaseHeadings[phase],
                `\`${required.id}\``,
                `\`${supportCommandFor(required.id)}\``,
                `\`${worksheetFor(required.id)}\``,
                escapeCell(required.readyWhen),
            ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
        }
    }

    lines.push('');
    lines.push('## Phase Detail');
    lines.push('');

    for (const phase of phaseOrder) {
        lines.push(`### ${phaseHeadings[phase]}`);
        lines.push('');
        for (const required of requiredChecks.filter((item) => item.phase === phase)) {
            lines.push(`#### ${required.id}`);
            lines.push('');
            lines.push(`- Area: ${required.area}`);
            lines.push(`- Command: \`${supportCommandFor(required.id)}\``);
            lines.push(`- Worksheet: \`${worksheetFor(required.id)}\``);
            lines.push(`- Freshness limit: ${required.maxAgeDays} days`);
            lines.push(`- Requirement: ${required.requirement}`);
            lines.push(`- Ready when: ${required.readyWhen}`);
            lines.push('- Evidence examples:');
            for (const example of required.evidenceExamples) {
                lines.push(`  - ${example}`);
            }
            lines.push('');
        }
    }

    return `${lines.join('\n')}\n`;
}

function renderNextActions(report: ManualEvidenceReport): string {
    const failedFindingsByCheck = new Map<string, Finding>();
    const warningFindingsByCheck = new Map<string, Finding>();

    for (const finding of report.findings) {
        for (const required of requiredChecks) {
            if (finding.message.includes(required.id)) {
                if (finding.status === 'failed') failedFindingsByCheck.set(required.id, finding);
                if (finding.status === 'warning') warningFindingsByCheck.set(required.id, finding);
            }
        }
    }

    const openChecks = requiredChecks.filter((required) => failedFindingsByCheck.has(required.id));
    const acceptedRiskChecks = requiredChecks.filter((required) => warningFindingsByCheck.has(required.id));
    const lines = [
        '# Manual Evidence Next Actions',
        '',
        `- Status: ${report.status}`,
        `- Evidence file: ${report.evidenceFile}`,
        `- Generated: ${report.endedAt}`,
        '',
        'This file is generated by `pnpm launch:manual-evidence`. It is safe to commit only if it contains no private URLs, screenshots or operational details; by default it lives under ignored `outputs/` evidence.',
        '',
    ];

    if (openChecks.length === 0 && acceptedRiskChecks.length === 0) {
        lines.push('No manual evidence blockers or accepted-risk warnings were found.');
        lines.push('');
        return `${lines.join('\n')}\n`;
    }

    if (openChecks.length > 0) {
        lines.push('## Blocking Checks By Phase', '');
        for (const phase of phaseOrder) {
            const phaseChecks = openChecks.filter((required) => required.phase === phase);
            if (phaseChecks.length === 0) continue;

            lines.push(`### ${phaseHeadings[phase]}`, '');
            for (const required of phaseChecks) {
                const finding = failedFindingsByCheck.get(required.id);
                lines.push(...renderRequiredCheckPlan(required, finding));
            }
        }
    }

    if (acceptedRiskChecks.length > 0) {
        lines.push('## Accepted-Risk Checks By Phase', '');
        for (const phase of phaseOrder) {
            const phaseChecks = acceptedRiskChecks.filter((required) => required.phase === phase);
            if (phaseChecks.length === 0) continue;

            lines.push(`### ${phaseHeadings[phase]}`, '');
            for (const required of phaseChecks) {
                const finding = warningFindingsByCheck.get(required.id);
                lines.push(...renderRequiredCheckPlan(required, finding));
            }
        }
    }

    lines.push('## Update Rules', '');
    lines.push('- Keep `launchDecision` as `blocked` while any required check is pending or blocked.');
    lines.push('- Use `ready_with_accepted_risks` only when every blocker is closed and at least one required check is `accepted_risk`.');
    lines.push('- Use `ready` only when every required check is `pass`.');
    lines.push('- Do not paste API keys, private keys, webhook secrets, service role keys or full card/payment details.');
    lines.push('- Do not paste URLs with tokens, embedded credentials, sensitive query params, JWTs, database URLs with passwords or Bearer headers.');
    lines.push('- Use local paths, screenshots, dashboard references, URLs or manual notes that prove the check without exposing secrets.');
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function renderPhaseOneWorksheet(report: ManualEvidenceReport): string {
    const phaseOneChecks = requiredChecks.filter((required) => required.phase === 'phase_1_now');
    const findingByCheck = new Map<string, Finding>();

    for (const finding of report.findings) {
        for (const required of phaseOneChecks) {
            if (finding.message.includes(required.id)) {
                findingByCheck.set(required.id, finding);
            }
        }
    }

    const lines = [
        '# Phase 1 Manual Evidence Worksheet',
        '',
        `- Status: ${report.status}`,
        `- Evidence file: ${report.evidenceFile}`,
        `- Generated: ${report.endedAt}`,
        '',
        'This worksheet is generated by `pnpm launch:manual-evidence`. It is not a launch status document and should not be edited as source of truth. Use it to collect safe evidence, then update `docs/launch/MANUAL_EVIDENCE.local.json` without secrets.',
        '',
        '## Rules',
        '',
        '- Do not paste API keys, private keys, webhook secrets, service role keys, recovery codes or full payment details.',
        '- Do not paste URLs with tokens, embedded credentials, sensitive query params, JWTs, database URLs with passwords or Bearer headers.',
        '- Prefer dashboard references, redacted screenshots, local paths, command outputs and specific manual notes.',
        '- Keep legal real data, Stripe live, final key rotation and production smoke for the final phase unless Alin decides otherwise.',
        '- After updating local evidence, run `pnpm launch:manual-evidence`, `pnpm launch:secondary-review` and `pnpm launch:status`.',
        '',
        '## Fase 1: Ordenar Ahora',
        '',
    ];

    for (const required of phaseOneChecks) {
        const finding = findingByCheck.get(required.id);
        lines.push(`### ${required.id}`);
        lines.push('');
        lines.push(`- Area: ${required.area}`);
        lines.push(`- Current result: ${finding?.status ?? 'unknown'}`);
        lines.push(`- Freshness limit: ${required.maxAgeDays} days`);
        lines.push(`- Ready when: ${required.readyWhen}`);
        lines.push('- Evidence to collect:');
        for (const action of required.nextActions) {
            lines.push(`  - ${action}`);
        }
        lines.push('- Safe evidence examples:');
        for (const example of required.evidenceExamples) {
            lines.push(`  - ${example}`);
        }
        lines.push('- Local JSON update: set `status`, `owner`, `verifiedAt`, `environment`, `summary` and `evidence`.');
        lines.push('');
    }

    return `${lines.join('\n')}\n`;
}

function renderPhaseOneClosurePack(report: ManualEvidenceReport): string {
    const phaseOneChecks = requiredChecks.filter((required) => required.phase === 'phase_1_now');
    const findingByCheck = new Map<string, Finding>();

    for (const finding of report.findings) {
        for (const required of phaseOneChecks) {
            if (finding.message.includes(required.id) || finding.details?.some((detail) => detail.includes(required.id))) {
                findingByCheck.set(required.id, finding);
            }
        }
    }

    const lines = [
        '# Phase 1 Closure Pack',
        '',
        `- Status: ${report.status}`,
        `- Evidence file: ${report.evidenceFile}`,
        `- Generated: ${report.endedAt}`,
        `- Manual evidence index: ${report.manualEvidenceIndexPath}`,
        `- Phase 1 worksheet: ${report.phaseOneWorksheetPath}`,
        '',
        'Use this generated pack to close the immediate launch blockers without touching legal real data, Stripe live, final API key rotation or production smoke.',
        '',
        '## Close Phase 1 In This Order',
        '',
        '1. Run the support command for the check.',
        '2. Open the worksheet generated by that command.',
        '3. Perform the external or human review.',
        '4. Add only non-secret evidence to `docs/launch/MANUAL_EVIDENCE.local.json`.',
        '5. Rerun `pnpm launch:manual-evidence`, `pnpm launch:secondary-review` and `pnpm launch:status`.',
        '',
        '## Safety Rules',
        '',
        '- Do not paste API keys, private keys, webhook secrets, service role keys, recovery codes or full payment details.',
        '- Do not paste URLs with tokens, embedded credentials, sensitive query params, JWTs, database URLs with passwords or Bearer headers.',
        '- For dashboards, record the system, environment, date and result; avoid screenshots that expose accounts, tokens or customer data.',
        '- For Phase 1, close immediate blockers as `pass`; keep `accepted_risk` for later final-only checks when Alin explicitly accepts a documented risk.',
        '',
        '## Evidence JSON Snippets',
        '',
        'These snippets are examples for the local ignored file. Replace placeholders with real non-secret notes before using them.',
        '',
    ];

    for (const required of phaseOneChecks) {
        const finding = findingByCheck.get(required.id);
        lines.push(`### ${required.id}`);
        lines.push('');
        lines.push(`- Area: ${required.area}`);
        lines.push(`- Current result: ${finding?.status ?? 'unknown'}`);
        lines.push(`- Support command: \`${supportCommandFor(required.id)}\``);
        lines.push(`- Worksheet: \`${worksheetFor(required.id)}\``);
        lines.push(`- Latest support summary: \`${latestSupportSummaryFor(required.id) ?? '../../outputs/<run>/summary.md'}\``);
        lines.push(`- Latest worksheet: \`${latestWorksheetFor(required.id) ?? worksheetFor(required.id)}\``);
        const manualEvidenceDryRun = latestManualEvidenceDryRunFor(required.id);
        if (manualEvidenceDryRun) {
            lines.push(`- Latest manual evidence dry run: \`${manualEvidenceDryRun}\``);
        }
        lines.push(`- Ready when: ${required.readyWhen}`);
        lines.push('- Required action:');
        for (const action of required.nextActions) {
            lines.push(`  - ${action}`);
        }
        lines.push('- Safe evidence examples:');
        for (const example of required.evidenceExamples) {
            lines.push(`  - ${example}`);
        }
        lines.push('- Local JSON skeleton for `pass`:');
        lines.push('```json');
        lines.push(renderManualCheckJsonSkeleton(required));
        lines.push('```');
        lines.push('');
    }

    lines.push('## Verification After Editing Local Evidence');
    lines.push('');
    lines.push('```bash');
    lines.push('pnpm launch:manual-evidence');
    lines.push('pnpm launch:secondary-review');
    lines.push('pnpm launch:status');
    lines.push('```');
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function renderManualCheckJsonSkeleton(required: RequiredCheck): string {
    const supportSummary = latestSupportSummaryFor(required.id) ?? '../../outputs/<run>/summary.md';

    return JSON.stringify({
        id: required.id,
        status: 'pass',
        owner: 'Alin',
        verifiedAt: 'YYYY-MM-DD',
        environment: 'staging-or-production',
        summary: `Verified ${required.id}: replace this with a concrete non-secret result.`,
        evidence: [
            {
                type: 'manual_note',
                value: 'Replace with concrete non-secret evidence.',
                note: required.readyWhen,
            },
            {
                type: 'command_output',
                value: supportSummary,
                note: supportCommandFor(required.id),
            },
        ],
    }, null, 2);
}

function renderRequiredCheckPlan(required: RequiredCheck, finding?: Finding): string[] {
    const lines = [
        `### ${required.id}`,
        '',
        `- Area: ${required.area}`,
        `- Phase: ${phaseHeadings[required.phase]}`,
        `- Freshness limit: ${required.maxAgeDays} days`,
        `- Requirement: ${required.requirement}`,
        `- Ready when: ${required.readyWhen}`,
    ];

    if (finding?.details?.length) {
        lines.push('- Current audit finding:');
        for (const detail of finding.details.slice(0, 12)) {
            lines.push(`  - ${detail}`);
        }
    }

    lines.push('- Next actions:');
    for (const action of required.nextActions) {
        lines.push(`  - ${action}`);
    }

    lines.push('- Acceptable evidence examples:');
    for (const example of required.evidenceExamples) {
        lines.push(`  - ${example}`);
    }

    lines.push('- JSON fields to update:');
    lines.push('  - `status`, `owner`, `verifiedAt`, `environment`, `summary`, `evidence`');
    lines.push('  - For `accepted_risk`: also `riskAcceptedBy`, `riskRationale`, `rollbackPlan`');
    lines.push('');

    return lines;
}

function supportCommandFor(checkId: string): string {
    switch (checkId) {
        case 'cleanup_agents_decision':
            return 'pnpm launch:cleanup';
        case 'legal_owner_controller':
        case 'legal_human_review':
            return 'pnpm launch:legal';
        case 'accessibility_manual':
            return 'pnpm launch:accessibility';
        case 'security_external':
            return 'pnpm launch:security';
        case 'payments_staging':
            return 'pnpm launch:payments';
        case 'operations_external':
        case 'database_readiness':
            return 'pnpm launch:operations';
        case 'content_review':
            return 'pnpm launch:content';
        case 'seo_llm_final':
            return 'pnpm launch:seo';
        case 'integration_readiness':
        case 'final_smoke':
            return 'pnpm launch:final-readiness';
        default:
            return 'pnpm launch:manual-evidence';
    }
}

function worksheetFor(checkId: string): string {
    switch (checkId) {
        case 'cleanup_agents_decision':
            return 'outputs/launch-cleanup/<timestamp>/agent-tooling-decision-worksheet.md';
        case 'legal_owner_controller':
        case 'legal_human_review':
            return 'outputs/launch-legal/<timestamp>/legal-closure-worksheet.md';
        case 'accessibility_manual':
            return 'outputs/launch-accessibility/<timestamp>/accessibility-manual-worksheet.md';
        case 'security_external':
            return 'outputs/launch-security/<timestamp>/security-external-worksheet.md';
        case 'payments_staging':
            return 'outputs/launch-payments/<timestamp>/payments-staging-worksheet.md';
        case 'operations_external':
            return 'outputs/launch-operations/<timestamp>/operations-readiness-worksheet.md';
        case 'database_readiness':
            return 'outputs/launch-operations/<timestamp>/database-readiness-worksheet.md';
        case 'content_review':
            return 'outputs/launch-content/<timestamp>/content-review-worksheet.md';
        case 'seo_llm_final':
            return 'outputs/launch-seo/<timestamp>/seo-llm-final-worksheet.md';
        case 'integration_readiness':
            return 'outputs/launch-final-readiness/<timestamp>/integration-readiness-worksheet.md';
        case 'final_smoke':
            return 'outputs/launch-final-readiness/<timestamp>/final-smoke-worksheet.md';
        default:
            return 'outputs/launch-manual-evidence/<timestamp>/manual-evidence-index.md';
    }
}

function latestSupportSummaryFor(checkId: string): string | null {
    const directory = latestOutputDirFor(checkId);
    if (!directory) return null;

    const summaryPath = path.join(directory, 'summary.md');
    return existsSync(summaryPath) ? relativeToManualEvidence(summaryPath) : null;
}

function latestWorksheetFor(checkId: string): string | null {
    const directory = latestOutputDirFor(checkId);
    const fileName = worksheetFileNameFor(checkId);
    if (!directory || !fileName) return null;

    const worksheetPath = path.join(directory, fileName);
    return existsSync(worksheetPath) ? relativeToManualEvidence(worksheetPath) : null;
}

function latestManualEvidenceDryRunFor(checkId: string): string | null {
    const outputType = manualEvidenceDryRunOutputTypeFor(checkId);
    if (!outputType) return null;

    const root = path.join(process.cwd(), 'outputs', outputType);
    if (!existsSync(root)) return null;

    const directory = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, entry.name))
        .filter((candidate) => existsSync(path.join(candidate, 'manual-evidence-dry-run.txt')))
        .sort((a, b) => b.localeCompare(a))[0] ?? null;

    if (!directory) return null;

    return relativeToManualEvidence(path.join(directory, 'manual-evidence-dry-run.txt'));
}

function manualEvidenceDryRunOutputTypeFor(checkId: string): string | null {
    switch (checkId) {
        case 'operations_external':
            return 'launch-operations-external-closure';
        case 'database_readiness':
            return 'launch-staging-database-rollout';
        case 'security_external':
            return 'launch-supabase-security-rollout';
        case 'payments_staging':
            return 'launch-no-real-payments';
        default:
            return null;
    }
}

function latestOutputDirFor(checkId: string): string | null {
    const outputType = outputTypeFor(checkId);
    if (!outputType) return null;

    const root = path.join(process.cwd(), 'outputs', outputType);
    if (!existsSync(root)) return null;

    return readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, entry.name))
        .filter((directory) => existsSync(path.join(directory, 'summary.md')))
        .sort((a, b) => b.localeCompare(a))[0] ?? null;
}

function outputTypeFor(checkId: string): string | null {
    switch (checkId) {
        case 'cleanup_agents_decision':
            return 'launch-cleanup';
        case 'legal_owner_controller':
        case 'legal_human_review':
            return 'launch-legal';
        case 'accessibility_manual':
            return 'launch-accessibility';
        case 'security_external':
            return 'launch-security';
        case 'payments_staging':
            return 'launch-payments';
        case 'operations_external':
        case 'database_readiness':
            return 'launch-operations';
        case 'content_review':
            return 'launch-content';
        case 'seo_llm_final':
            return 'launch-seo';
        case 'integration_readiness':
        case 'final_smoke':
            return 'launch-final-readiness';
        default:
            return null;
    }
}

function worksheetFileNameFor(checkId: string): string | null {
    switch (checkId) {
        case 'cleanup_agents_decision':
            return 'agent-tooling-decision-worksheet.md';
        case 'legal_owner_controller':
        case 'legal_human_review':
            return 'legal-closure-worksheet.md';
        case 'accessibility_manual':
            return 'accessibility-manual-worksheet.md';
        case 'security_external':
            return 'security-external-worksheet.md';
        case 'payments_staging':
            return 'payments-staging-worksheet.md';
        case 'operations_external':
            return 'operations-readiness-worksheet.md';
        case 'database_readiness':
            return 'database-readiness-worksheet.md';
        case 'content_review':
            return 'content-review-worksheet.md';
        case 'seo_llm_final':
            return 'seo-llm-final-worksheet.md';
        case 'integration_readiness':
            return 'integration-readiness-worksheet.md';
        case 'final_smoke':
            return 'final-smoke-worksheet.md';
        default:
            return null;
    }
}

function relativeToManualEvidence(filePath: string): string {
    return path.relative(path.join(process.cwd(), 'docs', 'launch'), filePath).replace(/\\/g, '/');
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}

function escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
