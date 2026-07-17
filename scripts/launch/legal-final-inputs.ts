import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type CheckStatus = 'ok' | 'warning' | 'failed';
type PackageStatus = 'OK' | 'WARNING' | 'FAILED';
type LegalClosureStatus = 'READY_FOR_HUMAN_INPUTS' | 'BLOCKED_BY_PLACEHOLDERS' | 'BLOCKED_BY_PACKAGE_ERRORS';

interface PackageCheck {
    status: CheckStatus;
    name: string;
    message: string;
    details: string[];
}

interface PlaceholderMatch {
    file: string;
    line: number;
    placeholder: string;
}

interface LegalInputReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: PackageStatus;
    legalClosureStatus: LegalClosureStatus;
    outputDir: string;
    latestLegalAuditSummaryPath: string | null;
    placeholderCount: number;
    packagePath: string;
    manifestPath: string;
    ownerControllerDryRunPath: string;
    humanReviewDryRunPath: string;
    summaryPath: string;
    checks: PackageCheck[];
}

const legalFiles = [
    path.join('src', 'pages', '[lang]', 'legal.astro'),
    path.join('src', 'pages', '[lang]', 'legal', 'aviso-legal.astro'),
    path.join('src', 'pages', '[lang]', 'legal', 'privacidad.astro'),
    path.join('src', 'pages', '[lang]', 'legal', 'terminos.astro'),
    path.join('src', 'pages', '[lang]', 'legal', 'cookies.astro'),
];

const legalInputsPath = path.join('docs', 'launch', 'LEGAL_INPUTS_REQUIRED.md');
const manualEvidencePath = path.join('docs', 'launch', 'MANUAL_EVIDENCE.md');
const manualRunbookPath = path.join('docs', 'launch', 'MANUAL_EVIDENCE_RUNBOOK.md');

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-legal-final-inputs', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const placeholders = collectPlaceholders();
const latestLegalAuditSummaryPath = latestGeneratedPath('launch-legal', 'summary.md');
const checks: PackageCheck[] = [
    validateLegalRoutes(),
    validateLegalInputsDoc(),
    validateManualEvidenceWorkflow(),
    validateTermsRouteCurrent(),
    validateLatestLegalAudit(),
    validatePlaceholderInventory(placeholders),
];

const failed = checks.filter((check) => check.status === 'failed');
const warnings = checks.filter((check) => check.status === 'warning');
const status: PackageStatus = failed.length > 0 ? 'FAILED' : warnings.length > 0 ? 'WARNING' : 'OK';
const legalClosureStatus: LegalClosureStatus = failed.length > 0
    ? 'BLOCKED_BY_PACKAGE_ERRORS'
    : placeholders.length > 0
        ? 'BLOCKED_BY_PLACEHOLDERS'
        : 'READY_FOR_HUMAN_INPUTS';

const report: LegalInputReport = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status,
    legalClosureStatus,
    outputDir,
    latestLegalAuditSummaryPath,
    placeholderCount: placeholders.length,
    packagePath: path.join(outputDir, 'legal-final-inputs-package.md'),
    manifestPath: path.join(outputDir, 'legal-final-inputs-manifest.json'),
    ownerControllerDryRunPath: path.join(outputDir, 'manual-evidence-dry-run-legal-owner-controller.txt'),
    humanReviewDryRunPath: path.join(outputDir, 'manual-evidence-dry-run-legal-human-review.txt'),
    summaryPath: path.join(outputDir, 'summary.md'),
    checks,
};

const packageMarkdown = renderPackage(report, placeholders);
const ownerDryRun = renderOwnerControllerDryRun(report);
const humanDryRun = renderHumanReviewDryRun(report);
const summaryMarkdown = renderSummary(report);
const manifest = renderManifest(report, placeholders, packageMarkdown, ownerDryRun, humanDryRun, summaryMarkdown);

writeFileSync(report.packagePath, packageMarkdown, 'utf8');
writeFileSync(report.ownerControllerDryRunPath, ownerDryRun, 'utf8');
writeFileSync(report.humanReviewDryRunPath, humanDryRun, 'utf8');
writeFileSync(report.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(report.summaryPath, summaryMarkdown, 'utf8');

console.log(`[launch:legal-final-inputs] Status: ${status}`);
console.log(`[launch:legal-final-inputs] Legal closure: ${legalClosureStatus}`);
console.log(`[launch:legal-final-inputs] Placeholders: ${placeholders.length}`);
console.log(`[launch:legal-final-inputs] Failed: ${failed.length}`);
console.log(`[launch:legal-final-inputs] Warnings: ${warnings.length}`);
console.log(`[launch:legal-final-inputs] Summary: ${report.summaryPath}`);
console.log(`[launch:legal-final-inputs] Package: ${report.packagePath}`);
console.log(`[launch:legal-final-inputs] Manifest: ${report.manifestPath}`);

if (failed.length > 0) process.exit(1);

function validateLegalRoutes(): PackageCheck {
    const missing = legalFiles.filter((file) => !existsSync(file));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'legal_route_files',
        message: missing.length === 0
            ? 'Legal index, notice, privacy, terms and cookie route files exist.'
            : 'Required legal route files are missing.',
        details: missing.length === 0 ? legalFiles : missing.map((file) => `missing=${file}`),
    };
}

function validateLegalInputsDoc(): PackageCheck {
    if (!existsSync(legalInputsPath)) {
        return {
            status: 'failed',
            name: 'legal_inputs_doc',
            message: 'Legal inputs document is missing.',
            details: [legalInputsPath],
        };
    }

    const legalInputs = readFileSync(legalInputsPath, 'utf8');
    const required = [
        'Datos del titular',
        'Responsable del tratamiento',
        'Subprocesadores a revisar',
        'Cookies y tecnologias similares',
        'Terminos comerciales',
        'Regla de cierre',
    ];
    const missing = required.filter((snippet) => !legalInputs.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'legal_inputs_doc',
        message: missing.length === 0
            ? 'Legal inputs document lists owner/controller, privacy, subprocessors, cookies, commercial terms and closure rule.'
            : 'Legal inputs document is missing required sections.',
        details: missing.length === 0 ? [legalInputsPath] : missing.map((snippet) => `missing=${snippet}`),
    };
}

function validateManualEvidenceWorkflow(): PackageCheck {
    const required: Array<[string, string]> = [
        [manualEvidencePath, 'legal_owner_controller'],
        [manualEvidencePath, 'legal_human_review'],
        [manualRunbookPath, 'legal_owner_controller'],
        [manualRunbookPath, 'legal_human_review'],
    ];
    const missing = required.filter(([file, snippet]) => !readIfExists(file).includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'manual_evidence_workflow',
        message: missing.length === 0
            ? 'Manual evidence workflow covers legal owner/controller and human review.'
            : 'Manual evidence workflow is missing legal closure IDs.',
        details: missing.length === 0
            ? [manualEvidencePath, manualRunbookPath]
            : missing.map(([file, snippet]) => `missing=${file}::${snippet}`),
    };
}

function validateTermsRouteCurrent(): PackageCheck {
    const termsPath = path.join('src', 'pages', '[lang]', 'legal', 'terminos.astro');
    if (!existsSync(termsPath)) {
        return {
            status: 'warning',
            name: 'commercial_terms_route',
            message: 'Dedicated public terms route is missing; commercial terms must be reviewed elsewhere before launch.',
            details: [termsPath],
        };
    }

    const terms = readFileSync(termsPath, 'utf8');
    const required = ['checkout', 'Stripe', '30, 40 or 50', 'no-show', 'Support'];
    const missing = required.filter((snippet) => !terms.toLowerCase().includes(snippet.toLowerCase()));

    return {
        status: missing.length === 0 ? 'ok' : 'warning',
        name: 'commercial_terms_route',
        message: missing.length === 0
            ? 'Dedicated terms route exists and covers checkout, Stripe, class duration, no-show and support topics.'
            : 'Dedicated terms route exists but may be missing commercial review topics.',
        details: missing.length === 0 ? [termsPath] : missing.map((snippet) => `missing=${snippet}`),
    };
}

function validateLatestLegalAudit(): PackageCheck {
    if (!latestLegalAuditSummaryPath) {
        return {
            status: 'warning',
            name: 'latest_legal_audit',
            message: 'No launch:legal output was found; run pnpm launch:legal before final legal closure.',
            details: ['outputs/launch-legal/<timestamp>/summary.md'],
        };
    }

    return {
        status: 'ok',
        name: 'latest_legal_audit',
        message: 'Latest launch:legal output is available for final legal closure evidence.',
        details: [latestLegalAuditSummaryPath],
    };
}

function validatePlaceholderInventory(matches: PlaceholderMatch[]): PackageCheck {
    return {
        status: matches.length === 0 ? 'ok' : 'warning',
        name: 'owner_controller_placeholder_inventory',
        message: matches.length === 0
            ? 'No owner/controller placeholders were detected in current legal pages.'
            : 'Current legal pages still contain owner/controller placeholders; this is expected until real legal data is provided.',
        details: matches.length === 0
            ? ['placeholderCount=0']
            : [`placeholderCount=${matches.length}`, ...matches.slice(0, 24).map((match) => `${match.file}:${match.line} ${match.placeholder}`)],
    };
}

function collectPlaceholders(): PlaceholderMatch[] {
    const placeholderPattern = /\[(?:N[^\]\r\n]{1,80}|DIRECCI[^\]\r\n]{1,80}|FULL[^\]\r\n]{1,80}|NUMBER|ADDRESS[^\]\r\n]{0,80}|NAME[^\]\r\n]{0,80}|COMPANY[^\]\r\n]{0,80}|[\u0080-\uFFFF][^\]\r\n]{1,80})\]/giu;
    const matches: PlaceholderMatch[] = [];

    for (const file of legalFiles) {
        if (!existsSync(file)) continue;
        const lines = readFileSync(file, 'utf8').split(/\r?\n/);
        lines.forEach((line, index) => {
            const linePattern = new RegExp(placeholderPattern.source, placeholderPattern.flags);
            for (const match of line.matchAll(linePattern)) {
                matches.push({ file, line: index + 1, placeholder: match[0] });
            }
        });
    }

    return dedupePlaceholders(matches);
}

function renderPackage(report: LegalInputReport, matches: PlaceholderMatch[]): string {
    const lines = [
        '# Legal Final Inputs Package',
        '',
        `- Generated: ${report.endedAt}`,
        `- Status: ${report.status}`,
        `- Legal closure status: ${report.legalClosureStatus}`,
        `- Placeholder count: ${matches.length}`,
        '- External writes performed: none.',
        '- Legal values changed: none.',
        '',
        'This package is evidence guidance, not legal advice. Do not paste identity documents, tax documents, private addresses beyond the public legal text, private advisor notes, secrets, dashboard tokens or API keys into tracked files or generated evidence.',
        '',
        '## Current Automated Evidence',
        '',
        `- Latest launch:legal summary: ${report.latestLegalAuditSummaryPath ?? 'missing'}`,
        `- Current generated manifest: ${toPosix(path.relative(process.cwd(), report.manifestPath))}`,
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
    ];

    for (const check of report.checks) {
        lines.push(`| ${check.status} | ${check.name} | ${escapeCell(check.message)} | ${escapeCell(check.details.join(' / '))} |`);
    }

    lines.push(
        '',
        '## Required Human Inputs',
        '',
        'Source checklist: `docs/launch/LEGAL_INPUTS_REQUIRED.md`.',
        '',
        'Owner data:',
        '',
        '- Owner type: natural person, self-employed/autonomo, or company.',
        '- Exact full name or legal company name.',
        '- NIF, NIE, or CIF.',
        '- Fiscal address or legal address that should appear in the legal notice.',
        '- Legal/privacy email.',
        '- Phone, only if it should be public.',
        '- Mercantile registry or other registration, if applicable.',
        '',
        'Privacy and legal review data:',
        '',
        '- Data controller, matching the owner.',
        '- Legal basis for students, leads, payments, support, emails, calendar, analytics and monitoring.',
        '- Retention period by data category.',
        '- GDPR rights and official channel to exercise them.',
        '- Minors policy, if applicable.',
        '- Subprocessor review: Supabase, Stripe, Google Workspace, Resend, Sentry and Cloudflare.',
        '- Cookie/checkout review, including Stripe, Supabase Auth, Cloudflare/Turnstile and Sentry.',
        '- Commercial terms review: purchase, cancellation, refund/withdrawal, duration, no-show and support.',
        '',
        '## Exact Placeholder Inventory',
        '',
    );

    if (matches.length === 0) {
        lines.push('No owner/controller placeholders detected in current legal pages.', '');
    } else {
        lines.push('| File | Line | Placeholder |', '| --- | ---: | --- |');
        for (const match of matches) {
            lines.push(`| \`${match.file}\` | ${match.line} | \`${escapeCell(match.placeholder)}\` |`);
        }
        lines.push('');
    }

    lines.push(
        '## Closure Steps',
        '',
        '1. Fill real owner/controller values in the legal pages in all shipped languages; do not invent values.',
        '2. Review privacy, cookies, terms, subprocessors, retention, rights and minors policy with the chosen human/legal reviewer.',
        '3. Run `corepack pnpm --config.verify-deps-before-run=false launch:legal` until owner/controller placeholders are gone.',
        '4. Record `legal_owner_controller` and `legal_human_review` in `docs/launch/MANUAL_EVIDENCE.local.json` using non-secret evidence.',
        '5. Rerun `launch:verify`, `launch:manual-evidence`, `launch:secondary-review` and `launch:status`.',
        '',
        '## Before And After Ledger',
        '',
        'Before this package:',
        '',
        '- Legal pages still contain owner/controller placeholders until real public legal values are provided.',
        '- The previous static strict-QA legal package could become stale as legal routes changed.',
        '',
        'After this package:',
        '',
        '- No legal values, public copy, runtime behavior, UX style or external service state changed.',
        '- Current legal inputs, placeholder inventory, terms-route status, manual-evidence dry runs and verification commands are generated from the current workspace.',
        '',
        'Cost/benefit:',
        '',
        '- Benefit: avoids stale legal handoff evidence, avoids invented data, and makes the final legal edit/review path auditable.',
        '- Cost: one additional local support script and generated output folder to maintain.',
        '',
        'Rollback:',
        '',
        '- Remove `scripts/launch/legal-final-inputs.ts`, the package script and related status/runbook/test/tracker references.',
        '- No service rollback is required because this package performs no external writes and changes no legal values.',
        '',
    );

    return `${lines.join('\n')}\n`;
}

function renderOwnerControllerDryRun(report: LegalInputReport): string {
    const packagePath = `../../${toPosix(path.relative(process.cwd(), report.packagePath))}`;
    const manifestPath = `../../${toPosix(path.relative(process.cwd(), report.manifestPath))}`;

    return `${[
        'corepack pnpm launch:manual-evidence:record --',
        '  --id legal_owner_controller',
        '  --status pass',
        '  --summary "Real owner/controller legal data applied to public legal pages and legal audit passes."',
        '  --environment production',
        '  --owner Alin',
        '  --evidence "path=docs/launch/LEGAL_INPUTS_REQUIRED.md"',
        `  --evidence "command_output=${packagePath}::current placeholder inventory and required legal inputs reviewed"`,
        `  --evidence "command_output=${manifestPath}::legal inputs package manifest reviewed"`,
        '  --evidence "command_output=../../outputs/launch-legal/<timestamp>/summary.md::pnpm launch:legal passes after real data is applied"',
        '  --evidence "manual_note=Replace with concrete non-secret result: reviewed public legal pages; no private identity documents stored in repo evidence."',
        '',
        '# Add --write only after replacing the placeholder note with real non-secret evidence.',
        '',
    ].join(' \\\n')}`;
}

function renderHumanReviewDryRun(report: LegalInputReport): string {
    const packagePath = `../../${toPosix(path.relative(process.cwd(), report.packagePath))}`;

    return `${[
        'corepack pnpm launch:manual-evidence:record --',
        '  --id legal_human_review',
        '  --status pass',
        '  --summary "Human review completed for privacy, cookies, terms, subprocessors and public legal copy."',
        '  --environment production',
        '  --owner Alin',
        `  --evidence "command_output=${packagePath}::current legal review checklist and placeholder inventory reviewed"`,
        '  --evidence "command_output=../../outputs/launch-legal/<timestamp>/summary.md::legal audit result after review"',
        '  --evidence "path=docs/launch/FINAL_CLOSURE.md::final legal closure sequence followed"',
        '  --evidence "manual_note=Replace with concrete non-secret result: reviewer, date, scope and result recorded without private legal-advisor notes."',
        '',
        '# Add --write only after replacing the placeholder note with real non-secret evidence.',
        '',
    ].join(' \\\n')}`;
}

function renderSummary(report: LegalInputReport): string {
    const lines = [
        '# Legal Final Inputs Summary',
        '',
        `- Status: ${report.status}`,
        `- Legal closure status: ${report.legalClosureStatus}`,
        `- Placeholder count: ${report.placeholderCount}`,
        `- Started: ${report.startedAt}`,
        `- Ended: ${report.endedAt}`,
        `- Package: ${toPosix(path.relative(process.cwd(), report.packagePath))}`,
        `- Manifest: ${toPosix(path.relative(process.cwd(), report.manifestPath))}`,
        `- Owner/controller dry run: ${toPosix(path.relative(process.cwd(), report.ownerControllerDryRunPath))}`,
        `- Human-review dry run: ${toPosix(path.relative(process.cwd(), report.humanReviewDryRunPath))}`,
        '',
        'This is local-only. It does not change legal values, does not provide legal advice, does not write external services and does not authorize launch.',
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
    ];

    for (const check of report.checks) {
        lines.push(`| ${check.status} | ${check.name} | ${escapeCell(check.message)} | ${escapeCell(check.details.join(' / '))} |`);
    }

    lines.push('');
    return `${lines.join('\n')}\n`;
}

function renderManifest(
    report: LegalInputReport,
    matches: PlaceholderMatch[],
    packageMarkdown: string,
    ownerDryRun: string,
    humanDryRun: string,
    summaryMarkdown: string,
): Record<string, unknown> {
    return {
        schemaVersion: 1,
        generatedAt: report.endedAt,
        status: report.status,
        legalClosureStatus: report.legalClosureStatus,
        placeholderCount: matches.length,
        latestLegalAuditSummaryPath: report.latestLegalAuditSummaryPath,
        sourceFiles: legalFiles,
        workflowFiles: [legalInputsPath, manualEvidencePath, manualRunbookPath],
        files: {
            summary: fileMeta(report.summaryPath, summaryMarkdown),
            package: fileMeta(report.packagePath, packageMarkdown),
            ownerControllerDryRun: fileMeta(report.ownerControllerDryRunPath, ownerDryRun),
            humanReviewDryRun: fileMeta(report.humanReviewDryRunPath, humanDryRun),
        },
        placeholders: matches,
        checks: report.checks,
        notLegalAdvice: true,
        changesLegalValues: false,
        writesExternalServices: false,
        forbiddenEvidence: [
            'No identity documents.',
            'No tax documents.',
            'No private legal-advisor notes.',
            'No secrets, dashboard tokens or API keys.',
            'No invented owner/controller values.',
        ],
    };
}

function fileMeta(filePath: string, contents: string) {
    return {
        path: toPosix(path.relative(process.cwd(), filePath)),
        sha256: sha256(contents),
        bytes: Buffer.byteLength(contents, 'utf8'),
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

    return candidates[0] ? toPosix(path.relative(process.cwd(), candidates[0])) : null;
}

function dedupePlaceholders(matches: PlaceholderMatch[]): PlaceholderMatch[] {
    const seen = new Set<string>();
    const result: PlaceholderMatch[] = [];
    for (const match of matches) {
        const key = `${match.file}:${match.line}:${match.placeholder}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(match);
    }
    return result;
}

function readIfExists(file: string): string {
    return existsSync(file) ? readFileSync(file, 'utf8') : '';
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
