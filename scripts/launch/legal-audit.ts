import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type FindingStatus = 'ok' | 'warning' | 'failed';
type ReportStatus = 'OK' | 'WARNING' | 'FAILED';

interface Finding {
    status: FindingStatus;
    area: string;
    message: string;
    details?: string[];
}

interface LegalReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: ReportStatus;
    outputDir: string;
    nextActionsPath: string;
    legalClosureWorksheetPath: string;
    findings: Finding[];
}

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-legal', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const legalFiles = [
    path.join('src', 'pages', '[lang]', 'legal.astro'),
    path.join('src', 'pages', '[lang]', 'legal', 'aviso-legal.astro'),
    path.join('src', 'pages', '[lang]', 'legal', 'privacidad.astro'),
    path.join('src', 'pages', '[lang]', 'legal', 'terminos.astro'),
    path.join('src', 'pages', '[lang]', 'legal', 'cookies.astro'),
];

const findings: Finding[] = [
    reviewLegalRouteFiles(),
    reviewOwnerControllerPlaceholders(),
    reviewSubprocessors(),
    reviewCookieDisclosure(),
    reviewLegalInputRunbook(),
    reviewCommercialTermsDecision(),
];

const failed = findings.filter((finding) => finding.status === 'failed');
const warnings = findings.filter((finding) => finding.status === 'warning');
const status: ReportStatus = failed.length > 0 ? 'FAILED' : warnings.length > 0 ? 'WARNING' : 'OK';
const nextActionsPath = path.join(outputDir, 'next-actions.md');
const legalClosureWorksheetPath = path.join(outputDir, 'legal-closure-worksheet.md');

const report: LegalReport = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status,
    outputDir,
    nextActionsPath,
    legalClosureWorksheetPath,
    findings,
};

writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(path.join(outputDir, 'summary.md'), renderMarkdown(report), 'utf8');
writeFileSync(nextActionsPath, renderNextActions(report), 'utf8');
writeFileSync(legalClosureWorksheetPath, renderLegalClosureWorksheet(report), 'utf8');

console.log(`[launch:legal] Status: ${status}`);
console.log(`[launch:legal] Failed: ${failed.length}`);
console.log(`[launch:legal] Warnings: ${warnings.length}`);
console.log(`[launch:legal] Summary: ${path.join(outputDir, 'summary.md')}`);
console.log(`[launch:legal] Next actions: ${nextActionsPath}`);
console.log(`[launch:legal] Legal worksheet: ${legalClosureWorksheetPath}`);

if (failed.length > 0) process.exit(1);

function reviewLegalRouteFiles(): Finding {
    const missing = legalFiles.filter((file) => !existsSync(file));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        area: 'legal route files',
        message: missing.length === 0
            ? 'Legal index, notice, privacy, terms and cookie route files exist.'
            : 'Required legal route files are missing.',
        details: missing,
    };
}

function reviewOwnerControllerPlaceholders(): Finding {
    const placeholderPattern = /\[(?:N[^\]\r\n]{1,80}|DIRECCI[^\]\r\n]{1,80}|FULL[^\]\r\n]{1,80}|NUMBER|ADDRESS[^\]\r\n]{0,80}|NAME[^\]\r\n]{0,80}|COMPANY[^\]\r\n]{0,80}|[\u0080-\uFFFF][^\]\r\n]{1,80})\]/gi;
    const details = legalFiles
        .filter((file) => existsSync(file))
        .flatMap((file) => findLineMatches(file, placeholderPattern));
    const identityFile = path.join('src', 'lib', 'legal-identity.ts');
    const identitySource = readIfExists(identityFile);
    if (/LEGAL_IDENTITY_MODE\s*=\s*['"]example['"]/.test(identitySource)) {
        details.unshift(`${identityFile}: LEGAL_IDENTITY_MODE is example; verified public owner/controller data is still required.`);
    }

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'owner and controller data',
        message: details.length === 0
            ? 'Verified owner/controller mode is active and no placeholders were detected in legal pages.'
            : 'Legal identity is still example data or contains launch-blocking owner/controller placeholders.',
        details,
    };
}

function reviewSubprocessors(): Finding {
    const corpus = legalFiles
        .filter((file) => existsSync(file))
        .map((file) => readFileSync(file, 'utf8').toLowerCase())
        .join('\n');
    const requiredSubprocessors = ['Stripe', 'Supabase', 'Google', 'Resend', 'Sentry', 'Cloudflare'];
    const missing = requiredSubprocessors.filter((vendor) => !corpus.includes(vendor.toLowerCase()));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        area: 'subprocessors',
        message: missing.length === 0
            ? 'Legal pages mention the required launch subprocessors.'
            : 'Legal pages do not mention all required launch subprocessors.',
        details: missing.map((vendor) => `Missing ${vendor}.`),
    };
}

function reviewCookieDisclosure(): Finding {
    const cookieFile = path.join('src', 'pages', '[lang]', 'legal', 'cookies.astro');
    const cookies = readIfExists(cookieFile);
    const requiredSnippets = ['Supabase', 'Cloudflare', 'Sentry', 'cookie_consent', 'cf-turnstile'];
    const missing = requiredSnippets
        .filter((snippet) => !cookies.includes(snippet))
        .map((snippet) => `${cookieFile}: missing ${snippet}.`);
    const checkoutMentioned = /Stripe|checkout/i.test(cookies);

    return {
        status: missing.length > 0 ? 'failed' : checkoutMentioned ? 'ok' : 'warning',
        area: 'cookie disclosure',
        message: missing.length > 0
            ? 'Cookie policy is missing launch-critical technical cookie/provider disclosures.'
            : checkoutMentioned
                ? 'Cookie policy covers technical providers and checkout-related cookie context.'
                : 'Cookie policy covers technical providers, but Stripe/checkout cookie behavior still needs human confirmation.',
        details: missing.length > 0
            ? missing
            : checkoutMentioned
                ? undefined
                : [`${cookieFile}: no Stripe/checkout cookie mention detected.`],
    };
}

function reviewLegalInputRunbook(): Finding {
    const legalInputs = readIfExists(path.join('docs', 'launch', 'LEGAL_INPUTS_REQUIRED.md'));
    const manualEvidence = readIfExists(path.join('docs', 'launch', 'MANUAL_EVIDENCE.md'));
    const manualRunbook = readIfExists(path.join('docs', 'launch', 'MANUAL_EVIDENCE_RUNBOOK.md'));
    const requiredSnippets: Array<[string, string, string]> = [
        ['docs/launch/LEGAL_INPUTS_REQUIRED.md', legalInputs, 'Datos del titular'],
        ['docs/launch/LEGAL_INPUTS_REQUIRED.md', legalInputs, 'Responsable del tratamiento'],
        ['docs/launch/LEGAL_INPUTS_REQUIRED.md', legalInputs, 'Subprocesadores a revisar'],
        ['docs/launch/LEGAL_INPUTS_REQUIRED.md', legalInputs, 'Terminos comerciales'],
        ['docs/launch/MANUAL_EVIDENCE.md', manualEvidence, 'legal_owner_controller'],
        ['docs/launch/MANUAL_EVIDENCE.md', manualEvidence, 'legal_human_review'],
        ['docs/launch/MANUAL_EVIDENCE_RUNBOOK.md', manualRunbook, 'legal_owner_controller'],
        ['docs/launch/MANUAL_EVIDENCE_RUNBOOK.md', manualRunbook, 'legal_human_review'],
    ];
    const missing = requiredSnippets
        .filter(([, content, snippet]) => !content.includes(snippet))
        .map(([file, , snippet]) => `${file}: missing ${snippet}.`);

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        area: 'legal evidence workflow',
        message: missing.length === 0
            ? 'Legal owner/controller and human-review evidence workflow is documented.'
            : 'Legal evidence workflow is incomplete.',
        details: missing,
    };
}

function reviewCommercialTermsDecision(): Finding {
    const termsRoute = path.join('src', 'pages', '[lang]', 'legal', 'terminos.astro');
    const legalInputs = readIfExists(path.join('docs', 'launch', 'LEGAL_INPUTS_REQUIRED.md'));
    const checklist = readIfExists(path.join('docs', 'launch', 'CHECKLIST.md'));
    const terms = readIfExists(termsRoute);
    const checkout = readIfExists(path.join('src', 'pages', 'api', 'create-checkout.ts'));
    const stripeWebhook = readIfExists(path.join('src', 'pages', 'api', 'stripe-webhook.ts'));
    const termsInputsDocumented = [
        'Condiciones de compra',
        'Cancelaciones',
        'Devoluciones',
        'Duracion de bonos',
        'no-show',
    ].every((snippet) => legalInputs.toLowerCase().includes(snippet.toLowerCase()));

    const details: string[] = [];
    if (!termsInputsDocumented) {
        details.push('docs/launch/LEGAL_INPUTS_REQUIRED.md does not fully list commercial terms inputs.');
    }
    if (!checklist.includes('Terminos revisados')) {
        details.push('docs/launch/CHECKLIST.md does not track terms review.');
    }
    if (!existsSync(termsRoute)) {
        details.push(`${termsRoute} is not present; decide whether public terms live in a dedicated page or inside existing legal pages.`);
    }
    for (const section of [
        'eligibility',
        'purchase',
        'renewal',
        'classes-expiry',
        'cancellation',
        'withdrawal-refunds',
        'termination',
        'support',
        'changes-law',
        'withdrawal-form',
    ]) {
        if (!terms.includes(`id="${section}"`)) details.push(`${termsRoute}: missing canonical section ${section}.`);
    }
    for (const snippet of [
        'adultConfirmed',
        'termsAccepted',
        'serviceStartRequested',
        'LEGAL_POLICY_VERSION',
    ]) {
        if (!checkout.includes(snippet)) details.push(`src/pages/api/create-checkout.ts: missing ${snippet}.`);
    }
    if (!stripeWebhook.includes("case 'charge.refunded'")) {
        details.push('src/pages/api/stripe-webhook.ts: missing Stripe refund reconciliation.');
    }

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'commercial terms',
        message: details.length === 0
            ? 'Commercial terms inputs and public terms route are present.'
            : 'Commercial terms or versioned checkout acceptance are incomplete.',
        details,
    };
}

function findLineMatches(file: string, pattern: RegExp): string[] {
    const details: string[] = [];
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);

    lines.forEach((line, index) => {
        const linePattern = new RegExp(pattern.source, pattern.flags);
        for (const match of line.matchAll(linePattern)) {
            details.push(`${file}:${index + 1} placeholder ${match[0]}`);
        }
    });

    return Array.from(new Set(details));
}

function renderMarkdown(report: LegalReport): string {
    const lines = [
        '# Launch Legal Audit',
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
    lines.push('This automated audit checks detectable legal readiness: required route files, owner/controller placeholders, subprocessors, cookie disclosure coverage and documented manual legal evidence workflow. It does not replace legal advice, human approval, real controller data, terms review, privacy review, cookie-law review, data-processing agreements or external dashboard verification.');
    lines.push('');
    lines.push(`Action plan: ${report.nextActionsPath}`);
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function renderNextActions(report: LegalReport): string {
    const failed = report.findings.filter((finding) => finding.status === 'failed');
    const warnings = report.findings.filter((finding) => finding.status === 'warning');
    const lines = [
        '# Legal Next Actions',
        '',
        `- Status: ${report.status}`,
        `- Generated: ${report.endedAt}`,
        '',
        'This file is generated by `pnpm launch:legal`. It is evidence guidance, not legal advice.',
        '',
    ];

    if (failed.length === 0 && warnings.length === 0) {
        lines.push('No automated legal blockers or warnings were detected.');
        lines.push('');
        return `${lines.join('\n')}\n`;
    }

    if (failed.length > 0) {
        lines.push('## Blocking Findings', '');
        for (const finding of failed) {
            lines.push(...renderFindingAction(finding));
        }
    }

    if (warnings.length > 0) {
        lines.push('## Warnings', '');
        for (const finding of warnings) {
            lines.push(...renderFindingAction(finding));
        }
    }

    lines.push('## Closure Steps', '');
    lines.push('- Fill real owner/controller inputs in `docs/launch/LEGAL_INPUTS_REQUIRED.md`; do not invent values.');
    lines.push('- Update legal pages in the published languages and remove placeholders.');
    lines.push('- Review the dedicated commercial terms page together with privacy, cookies and subprocessors during `legal_human_review`.');
    lines.push('- Record `legal_owner_controller` and `legal_human_review` in `docs/launch/MANUAL_EVIDENCE.local.json` with non-secret evidence.');
    lines.push('- Rerun `pnpm launch:legal`, `pnpm launch:verify`, `pnpm launch:manual-evidence`, `pnpm launch:secondary-review` and `pnpm launch:status`.');
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function renderLegalClosureWorksheet(report: LegalReport): string {
    const lines = [
        '# Legal Closure Worksheet',
        '',
        `- Status: ${report.status}`,
        `- Generated: ${report.endedAt}`,
        `- Output: ${report.outputDir}`,
        '',
        '## Rule',
        '',
        'Use this worksheet while filling `legal_owner_controller` and `legal_human_review` in `docs/launch/MANUAL_EVIDENCE.local.json`. Do not invent legal values. Do not paste personal identity documents, tax documents, private addresses beyond the public legal text, private advisor notes, secrets or dashboard tokens.',
        '',
        '## Automated Coverage',
        '',
        '| Status | Area | Message |',
        '| --- | --- | --- |',
    ];

    appendFindingsTable(lines, report.findings);

    lines.push('');
    lines.push('## legal_owner_controller');
    lines.push('');
    lines.push('| Check | How To Verify | Evidence To Record |');
    lines.push('| --- | --- | --- |');
    lines.push('| Required inputs | Complete `docs/launch/LEGAL_INPUTS_REQUIRED.md` with the real public owner/controller values Alin chooses to publish. | `path` to `docs/launch/LEGAL_INPUTS_REQUIRED.md` and `manual_note` with completion scope. |');
    lines.push('| Legal pages | Apply real values to the published legal pages and remove placeholders in all shipped languages/routes. | `path` entries for reviewed legal pages plus `command_output` from `pnpm launch:legal`. |');
    lines.push('| Placeholder audit | Run `pnpm launch:legal` and confirm owner/controller placeholders are gone. | `command_output`: `../../outputs/launch-legal/<timestamp>/summary.md`. |');
    lines.push('| Primary gate | Run `pnpm launch:verify` and confirm legal placeholders no longer block the primary gate. | `command_output`: `../../outputs/launch-verification/<timestamp>/summary.md`. |');
    lines.push('');
    lines.push('## legal_human_review');
    lines.push('');
    lines.push('| Check | How To Verify | Evidence To Record |');
    lines.push('| --- | --- | --- |');
    lines.push('| Privacy | Review privacy text, controller/processor language, data categories, retention, rights and contact path. | `manual_note` with reviewer, date and scope; optional local `document`. |');
    lines.push('| Cookies | Review cookie policy, Turnstile, Supabase, Cloudflare, Sentry and Stripe/checkout cookie behavior. | `manual_note` plus `command_output` from `pnpm launch:legal`. |');
    lines.push('| Terms | Review the dedicated public commercial terms page for purchase flow, checkout mode, class duration, cancellation, no-show and support wording. | `manual_note` with reviewer, date, scope and rollback/mitigation if any wording is deferred. |');
    lines.push('| Subprocessors | Confirm Supabase, Stripe, Google, Resend, Sentry and Cloudflare are acceptable for launch. | `manual_note` with vendor list reviewed. |');
    lines.push('| Risk acceptance | If any legal item is accepted as risk, document `riskAcceptedBy`, `riskRationale` and `rollbackPlan`. | `manual_note` and local `document`, no private advisor text required. |');
    lines.push('');
    lines.push('## Completion');
    lines.push('');
    lines.push('Mark `legal_owner_controller` as `pass` only after real public legal data is applied and `pnpm launch:legal` no longer detects placeholders. Mark `legal_human_review` as `pass` only after a human review of privacy, cookies, terms and subprocessors is recorded. This worksheet is guidance, not legal advice.');
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function appendFindingsTable(lines: string[], findings: Finding[]): void {
    for (const finding of findings) {
        lines.push(`| ${finding.status} | ${escapeCell(finding.area)} | ${escapeCell(finding.message)} |`);
        if (finding.details?.length) {
            lines.push(`|  |  | ${escapeCell(finding.details.join(' / '))} |`);
        }
    }
}

function renderFindingAction(finding: Finding): string[] {
    const lines = [
        `### ${finding.area}`,
        '',
        `- Message: ${finding.message}`,
    ];

    if (finding.details?.length) {
        lines.push('- Details:');
        for (const detail of finding.details.slice(0, 12)) {
            lines.push(`  - ${detail}`);
        }
    }

    lines.push('');
    return lines;
}

function readIfExists(file: string): string {
    return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}

function escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
