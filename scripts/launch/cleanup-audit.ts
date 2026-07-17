import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type FindingStatus = 'ok' | 'warning' | 'failed';
type CleanupStatus = 'OK' | 'WARNING' | 'FAILED';

interface Finding {
    status: FindingStatus;
    area: string;
    message: string;
    details?: string[];
}

interface CleanupReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: CleanupStatus;
    agentToolingInventoryPath: string;
    agentToolingDecisionWorksheetPath: string;
    findings: Finding[];
    outputDir: string;
}

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-cleanup', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const findings: Finding[] = [
    reviewSourceOfTruth(),
    reviewHistoricalCleanup(),
    reviewIgnoreRules(),
    reviewAgentToolingDecision(),
    reviewBackupCandidates(),
    reviewBuildArtifactSafety(),
    reviewLocalIgnoredArtifacts(),
];

const failed = findings.filter((finding) => finding.status === 'failed');
const warnings = findings.filter((finding) => finding.status === 'warning');
const status: CleanupStatus = failed.length > 0 ? 'FAILED' : warnings.length > 0 ? 'WARNING' : 'OK';
const agentToolingInventoryPath = path.join(outputDir, 'agent-tooling-inventory.md');
const agentToolingDecisionWorksheetPath = path.join(outputDir, 'agent-tooling-decision-worksheet.md');
const report: CleanupReport = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status,
    agentToolingInventoryPath,
    agentToolingDecisionWorksheetPath,
    findings,
    outputDir,
};

writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(path.join(outputDir, 'summary.md'), renderMarkdown(report), 'utf8');
writeFileSync(agentToolingInventoryPath, renderAgentToolingInventory(), 'utf8');
writeFileSync(agentToolingDecisionWorksheetPath, renderAgentToolingDecisionWorksheet(report), 'utf8');

console.log(`[launch:cleanup] Status: ${status}`);
console.log(`[launch:cleanup] Failed: ${failed.length}`);
console.log(`[launch:cleanup] Warnings: ${warnings.length}`);
console.log(`[launch:cleanup] Summary: ${path.join(outputDir, 'summary.md')}`);
console.log(`[launch:cleanup] Agent tooling inventory: ${agentToolingInventoryPath}`);
console.log(`[launch:cleanup] Agent tooling decision worksheet: ${agentToolingDecisionWorksheetPath}`);

if (failed.length > 0) process.exit(1);

function reviewSourceOfTruth(): Finding {
    const requiredFiles = [
        'README.md',
        'ARCHITECTURE.md',
        path.join('docs', 'launch', 'DECISIONS.md'),
        path.join('docs', 'launch', 'ENVIRONMENT.md'),
        path.join('docs', 'launch', 'PRODUCTS.md'),
        path.join('docs', 'launch', 'RUNBOOK.md'),
        path.join('docs', 'launch', 'CHECKLIST.md'),
        path.join('docs', 'launch', 'CLEANUP.md'),
        path.join('docs', 'launch', 'GIT_WORKTREE_PLAN.md'),
        path.join('docs', 'launch', 'LAUNCH_SEQUENCE.md'),
        path.join('docs', 'launch', 'LEGAL_INPUTS_REQUIRED.md'),
        path.join('docs', 'launch', 'MANUAL_EVIDENCE.md'),
        path.join('docs', 'launch', 'MANUAL_EVIDENCE.example.json'),
        path.join('scripts', 'launch', 'verify.ts'),
        path.join('scripts', 'launch', 'sequence-audit.ts'),
        path.join('scripts', 'launch', 'worktree-audit.ts'),
        path.join('scripts', 'launch', 'gate.ts'),
        path.join('scripts', 'launch', 'secondary-review.ts'),
        path.join('scripts', 'launch', 'status.ts'),
    ];
    const missing = requiredFiles.filter((file) => !existsSync(file));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        area: 'current launch sources',
        message: missing.length === 0
            ? 'Current launch source-of-truth docs and launch scripts are present.'
            : 'Required launch source-of-truth docs or scripts are missing.',
        details: missing,
    };
}

function reviewHistoricalCleanup(): Finding {
    const historicalCandidates = [
        'PRODUCTION_AUDIT_STATUS.md',
        'audit_handover.md',
        path.join('db', 'audit_fixes.sql'),
        path.join('docs', 'auditoria'),
        path.join('docs', 'launch', 'CURRENT_STATUS.md'),
        'uat_test_plan.md.resolved',
        path.join('tmp', 'check-roles.ts'),
        path.join('tmp', 'fix-roles.ts'),
        path.join('tmp', 'update-email.ts'),
    ];
    const stillPresent = historicalCandidates.filter(candidateStillPresent);

    return {
        status: stillPresent.length === 0 ? 'ok' : 'failed',
        area: 'historical cleanup candidates',
        message: stillPresent.length === 0
            ? 'Historical audit/status/tmp files are absent from the working tree.'
            : 'Historical cleanup candidates still exist and can confuse the launch source of truth.',
        details: stillPresent.map(toPosix),
    };
}

function reviewIgnoreRules(): Finding {
    const gitignore = readIfExists('.gitignore');
    const requiredSnippets = [
        '*.log',
        'package-lock.json',
        'yarn.lock',
        'bun.lock',
        'bun.lockb',
        '.env',
        '.env.*',
        '.dev.vars',
        '!.env.example',
        '!.env.*.example',
        'tmp/',
        'outputs/',
        'docs/launch/MANUAL_EVIDENCE.local.json',
    ];
    const missing = requiredSnippets.filter((snippet) => !gitignore.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        area: 'ignored generated and sensitive files',
        message: missing.length === 0
            ? 'Generated outputs, local evidence, env files, logs and foreign Node lockfiles are ignored.'
            : '.gitignore is missing launch cleanup protections.',
        details: missing.map((snippet) => `.gitignore missing ${snippet}`),
    };
}

function reviewAgentToolingDecision(): Finding {
    const cleanupDoc = readIfExists(path.join('docs', 'launch', 'CLEANUP.md'));
    const manualEvidenceDoc = readIfExists(path.join('docs', 'launch', 'MANUAL_EVIDENCE.md'));
    const manualEvidenceExample = readIfExists(path.join('docs', 'launch', 'MANUAL_EVIDENCE.example.json'));
    const agentFolders = ['.agent', '.agents'].filter((folder) => existsSync(folder));
    const details: string[] = [];
    const failures: string[] = [];

    for (const folder of agentFolders) {
        const stats = folderStats(folder);
        details.push(`${folder}/ present: ${stats.files} files, ${formatBytes(stats.bytes)}.`);
    }

    const requiredCleanupSnippets = [
        '.agent/',
        '.agents/',
        'Decision pendiente',
        'No borrar herramientas de agente versionadas sin confirmacion humana',
    ];
    for (const snippet of requiredCleanupSnippets) {
        if (!cleanupDoc.includes(snippet)) {
            failures.push(`docs/launch/CLEANUP.md missing ${snippet}.`);
        }
    }
    if (!manualEvidenceDoc.includes('cleanup_agents_decision')) {
        failures.push('docs/launch/MANUAL_EVIDENCE.md must mention cleanup_agents_decision.');
    }
    if (!manualEvidenceExample.includes('"id": "cleanup_agents_decision"')) {
        failures.push('docs/launch/MANUAL_EVIDENCE.example.json must include cleanup_agents_decision.');
    }

    if (agentFolders.length > 0) {
        details.push('Keep/delete/move remains a human Go/No-Go decision; this audit only verifies it is documented.');
    } else {
        details.push('.agent/ and .agents/ are not present in the working tree.');
    }

    return {
        status: failures.length === 0 ? 'ok' : 'failed',
        area: 'agent tooling cleanup decision',
        message: failures.length === 0
            ? 'Agent tooling cleanup is documented as a manual decision and tied to manual evidence.'
            : 'Agent tooling cleanup decision is not fully documented.',
        details: [...failures, ...details],
    };
}

function reviewBackupCandidates(): Finding {
    const cleanupDoc = readIfExists(path.join('docs', 'launch', 'CLEANUP.md'));
    const candidates = filesUnder('.', new Set([
        '.astro',
        '.git',
        '.wrangler',
        'coverage',
        'dist',
        'node_modules',
        'outputs',
        'playwright-report',
        'test-results',
    ]))
        .filter((file) => /\.(?:backup|bak|tmp|old)$/i.test(file) || /~$/.test(file))
        .map(toPosix)
        .sort();
    const undocumented = candidates.filter((file) => !cleanupDoc.includes(file));

    return {
        status: undocumented.length === 0 ? 'ok' : 'failed',
        area: 'backup/temp file candidates',
        message: candidates.length === 0
            ? 'No backup/temp file candidates detected outside generated directories.'
            : undocumented.length === 0
                ? 'Backup/temp file candidates are documented for cleanup review.'
                : 'Backup/temp file candidates need explicit cleanup documentation.',
        details: undocumented.length > 0 ? undocumented : candidates,
    };
}

function reviewLocalIgnoredArtifacts(): Finding {
    const knownArtifacts = [
        '.astro',
        '.wrangler',
        'coverage',
        'dist',
        'outputs',
        'playwright-report',
        'tmp',
        'esquema_nube.sql',
        ...rootFilesMatching(/\.log$/),
    ];
    const present = Array.from(new Set(knownArtifacts))
        .filter((file) => existsSync(file))
        .map(toPosix)
        .sort();
    const localEnvFiles = localEnvLikeFiles();

    return {
        status: 'ok',
        area: 'local-only artifacts inventory',
        message: present.length === 0
            ? 'No known generated local artifacts are present.'
            : 'Known generated/local artifacts are present and ignored; they do not affect launch source of truth.',
        details: [
            ...present,
            ...localEnvFiles.map((file) => `${file} present and ignored; keep or regenerate locally, do not commit values.`),
        ],
    };
}

function reviewBuildArtifactSafety(): Finding {
    const buildOutputDir = pagesBuildOutputDir();
    const buildOutputPresent = existsSync(buildOutputDir);
    const localEnvFiles = localEnvLikeFiles();
    const docs = [
        readIfExists(path.join('docs', 'launch', 'CLEANUP.md')),
        readIfExists(path.join('docs', 'launch', 'NO_REAL_PAYMENTS.md')),
    ].join('\n');
    const missingDocs = [
        'dist/',
        '.dev.vars',
        'sanitized env',
        'delete `dist/`',
        'launch:staging-no-real-payments-remediation',
    ].filter((snippet) => !docs.includes(snippet));
    const status: FindingStatus = missingDocs.length > 0
        ? 'failed'
        : buildOutputPresent && localEnvFiles.length > 0
            ? 'warning'
            : 'ok';
    const message = status === 'failed'
        ? 'Local Pages build artifact safety is not fully documented.'
        : status === 'warning'
            ? 'Local Pages build output is present alongside local env files; delete or regenerate it before using it as a staging deploy package.'
            : 'Local Pages build artifact safety is documented and no risky build output is present.';

    return {
        status,
        area: 'local Pages build artifact safety',
        message,
        details: [
            `buildOutput=${toPosix(buildOutputDir)}`,
            `buildOutputPresent=${buildOutputPresent ? 'true' : 'false'}`,
            localEnvFiles.length > 0
                ? `localEnvFiles=${localEnvFiles.map(toPosix).join(', ')}`
                : 'localEnvFiles=none',
            ...(missingDocs.length > 0
                ? missingDocs.map((snippet) => `docs missing ${snippet}`)
                : ['rule=delete `dist/` after local builds that can see `.dev.vars` or `.env*`, or rebuild under sanitized env before staging deploy packaging.']),
        ],
    };
}

function pagesBuildOutputDir(): string {
    const wrangler = readIfExists('wrangler.toml');
    const match = wrangler.match(/pages_build_output_dir\s*=\s*"([^"]+)"/);
    return match?.[1] ?? 'dist';
}

function localEnvLikeFiles(): string[] {
    return Array.from(new Set([
        ...rootFilesMatching(/^\.env(?:\.|$)/)
            .filter((file) => !file.endsWith('.example')),
        ...rootFilesMatching(/^\.dev\.vars(?:\.|$)/),
    ])).sort();
}

function rootFilesMatching(pattern: RegExp): string[] {
    return readdirSync('.', { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((name) => pattern.test(name));
}

function candidateStillPresent(file: string): boolean {
    if (!existsSync(file)) return false;

    const stats = statSync(file);
    if (!stats.isDirectory()) return true;

    return filesUnder(file).length > 0;
}

function folderStats(folder: string): { files: number; bytes: number } {
    const files = filesUnder(folder);
    const bytes = files.reduce((total, file) => total + statSync(file).size, 0);
    return { files: files.length, bytes };
}

function filesUnder(root: string, ignoredTopLevel = new Set<string>()): string[] {
    if (!existsSync(root)) return [];

    const output: string[] = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        const fullPath = path.join(root, entry.name);
        const topLevel = root === '.' ? entry.name : null;
        if (topLevel && ignoredTopLevel.has(topLevel)) continue;

        if (entry.isDirectory()) {
            output.push(...filesUnder(fullPath, ignoredTopLevel));
        } else if (entry.isFile()) {
            output.push(fullPath);
        }
    }
    return output;
}

function readIfExists(file: string): string {
    return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

function renderMarkdown(report: CleanupReport): string {
    const rows = report.findings.flatMap((finding) => {
        const primary = `| ${finding.status} | ${escapeTable(finding.area)} | ${escapeTable(finding.message)} |`;
        const details = (finding.details ?? []).map((detail) => `|  |  | ${escapeTable(detail)} |`);
        return [primary, ...details];
    });

    return [
        '# Launch Cleanup Audit',
        '',
        `- Status: ${report.status}`,
        `- Started: ${report.startedAt}`,
        `- Ended: ${report.endedAt}`,
        `- Output: ${report.outputDir}`,
        `- Agent tooling inventory: ${report.agentToolingInventoryPath}`,
        '',
        '| Status | Area | Message |',
        '| --- | --- | --- |',
        ...rows,
        '',
        '## Rule',
        '',
        'This audit is non-destructive. It verifies that obsolete files are absent or documented, generated artifacts are ignored, and repo-owned agent tooling is not deleted without a recorded human decision.',
        '',
    ].join('\n');
}

function renderAgentToolingInventory(): string {
    const agentFolders = ['.agent', '.agents'];
    const backupCandidates = filesUnder('.', new Set([
        '.astro',
        '.git',
        '.wrangler',
        'coverage',
        'dist',
        'node_modules',
        'outputs',
        'playwright-report',
        'test-results',
    ]))
        .filter((file) => /\.(?:backup|bak|tmp|old)$/i.test(file) || /~$/.test(file))
        .map(toPosix)
        .sort();
    const lines = [
        '# Agent Tooling Inventory',
        '',
        `- Generated: ${new Date().toISOString()}`,
        '- Scope: `.agent/` and `.agents/` only.',
        '- Rule: non-destructive inventory; no files were moved, deleted or copied.',
        '',
        '## Summary',
        '',
        '| Folder | Present | Files | Size |',
        '| --- | --- | ---: | ---: |',
    ];

    for (const folder of agentFolders) {
        if (!existsSync(folder)) {
            lines.push(`| ${folder}/ | no | 0 | 0 B |`);
            continue;
        }
        const stats = folderStats(folder);
        lines.push(`| ${folder}/ | yes | ${stats.files} | ${formatBytes(stats.bytes)} |`);
    }

    lines.push('');
    lines.push('## Skills And Workflows');
    lines.push('');
    for (const folder of agentFolders) {
        if (!existsSync(folder)) continue;
        const skillFiles = filesUnder(folder)
            .map(toPosix)
            .filter((file) => /\/SKILL\.md$/i.test(file))
            .sort();
        const workflowFiles = filesUnder(folder)
            .map(toPosix)
            .filter((file) => /\/workflows\/.+\.md$/i.test(file))
            .sort();

        lines.push(`### ${folder}/`, '');
        if (skillFiles.length === 0 && workflowFiles.length === 0) {
            lines.push('- No skill or workflow markdown files detected.', '');
            continue;
        }

        if (skillFiles.length > 0) {
            lines.push('- Skills:');
            for (const file of skillFiles) lines.push(`  - ${file}`);
        }
        if (workflowFiles.length > 0) {
            lines.push('- Workflows:');
            for (const file of workflowFiles) lines.push(`  - ${file}`);
        }
        lines.push('');
    }

    lines.push('## Backup Candidates');
    lines.push('');
    if (backupCandidates.length === 0) {
        lines.push('- No backup/temp candidates detected outside generated directories.');
    } else {
        for (const file of backupCandidates) lines.push(`- ${file}`);
    }

    lines.push('');
    lines.push('## Decision Options');
    lines.push('');
    lines.push('| Option | Use when | Evidence to record |');
    lines.push('| --- | --- | --- |');
    lines.push('| Keep in repo | These tools should travel with the project through launch. | Manual note with owner/date and follow-up review date. |');
    lines.push('| Move outside repo | They are personal/local agent tools, not product artifacts. | Destination path plus confirmation useful skills/workflows were copied. |');
    lines.push('| Delete | Alin confirms they are unused or already backed up. | Manual note plus rollback/recovery path. |');
    lines.push('');
    lines.push('Record the final choice in `docs/launch/MANUAL_EVIDENCE.local.json` under `cleanup_agents_decision` without secrets.');
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function renderAgentToolingDecisionWorksheet(report: CleanupReport): string {
    const agentFolders = ['.agent', '.agents'];
    const backupCandidates = filesUnder('.', new Set([
        '.astro',
        '.git',
        '.wrangler',
        'coverage',
        'dist',
        'node_modules',
        'outputs',
        'playwright-report',
        'test-results',
    ]))
        .filter((file) => /\.(?:backup|bak|tmp|old)$/i.test(file) || /~$/.test(file))
        .map(toPosix)
        .sort();
    const lines = [
        '# Agent Tooling Decision Worksheet',
        '',
        `- Status: ${report.status}`,
        `- Generated: ${report.endedAt}`,
        `- Output: ${report.outputDir}`,
        `- Inventory: ${report.agentToolingInventoryPath}`,
        '',
        '## Rule',
        '',
        'Use this worksheet while filling `cleanup_agents_decision` in `docs/launch/MANUAL_EVIDENCE.local.json`. Do not delete or move `.agent/` or `.agents/` until Alin records a keep, move or delete decision. This worksheet is non-destructive and does not prove the decision is made.',
        '',
        '## Current Inventory',
        '',
        '| Folder | Present | Files | Size |',
        '| --- | --- | ---: | ---: |',
    ];

    for (const folder of agentFolders) {
        if (!existsSync(folder)) {
            lines.push(`| ${folder}/ | no | 0 | 0 B |`);
            continue;
        }
        const stats = folderStats(folder);
        lines.push(`| ${folder}/ | yes | ${stats.files} | ${formatBytes(stats.bytes)} |`);
    }

    lines.push('');
    lines.push('## Decision Options');
    lines.push('');
    lines.push('| Option | Benefit | Cost/Risk | Required evidence |');
    lines.push('| --- | --- | --- | --- |');
    lines.push('| Keep in repo | Maximum continuity for project-specific agent workflows during launch. | More files in repo, more diff noise, personal tooling mixed with product code. | Manual note naming owner, reason and review date after launch. |');
    lines.push('| Move outside repo | Cleaner product repo while preserving useful tools globally. | Requires copying useful skills/workflows first and verifying Codex can still find them. | Destination path plus confirmation copied files are recoverable. |');
    lines.push('| Delete after backup | Removes non-product tooling and obvious backup file noise. | Highest risk if a workflow or reference is still useful. | Backup/recovery note plus explicit confirmation that deletion is intentional. |');
    lines.push('');
    lines.push('## Specific Candidates');
    lines.push('');
    if (backupCandidates.length === 0) {
        lines.push('- No backup/temp candidates detected outside generated directories.');
    } else {
        for (const file of backupCandidates) {
            lines.push(`- ${file}: backup/temp candidate. If agent tooling is cleaned, remove or move this first.`);
        }
    }

    lines.push('');
    lines.push('## Safe Evidence To Record');
    lines.push('');
    lines.push('- `manual_note`: decision, rationale, owner, date and follow-up timing.');
    lines.push('- `path`: `CLEANUP.md` or the latest `agent-tooling-inventory.md`.');
    lines.push('- `command_output`: latest `outputs/launch-cleanup/<timestamp>/summary.md`.');
    lines.push('- Do not paste local absolute paths that expose private folders unless you are comfortable keeping them in local evidence only.');
    lines.push('');
    lines.push('## Local Evidence Shape');
    lines.push('');
    lines.push('Use one of these snippets in `docs/launch/MANUAL_EVIDENCE.local.json` after Alin chooses the option. Keep `launchDecision` as `blocked` while other manual checks remain open.');
    lines.push('');
    lines.push('### Keep In Repo Snippet');
    lines.push('');
    lines.push('```json');
    lines.push('{');
    lines.push('  "id": "cleanup_agents_decision",');
    lines.push('  "status": "pass",');
    lines.push('  "owner": "Alin",');
    lines.push('  "verifiedAt": "2026-06-05T00:00:00.000Z",');
    lines.push('  "environment": "repo",');
    lines.push('  "summary": "Decision recorded for .agent/ and .agents/: keep through launch and review after release.",');
    lines.push('  "evidence": [');
    lines.push('    {');
    lines.push('      "type": "manual_note",');
    lines.push('      "value": "Decision: keep .agent/ and .agents/ through launch; remove backup candidates in a separate cleanup commit after release."');
    lines.push('    },');
    lines.push('    {');
    lines.push('      "type": "path",');
    lines.push('      "value": "CLEANUP.md"');
    lines.push('    }');
    lines.push('  ]');
    lines.push('}');
    lines.push('```');
    lines.push('');
    lines.push('### Move Outside Repo Snippet');
    lines.push('');
    lines.push('```json');
    lines.push('{');
    lines.push('  "id": "cleanup_agents_decision",');
    lines.push('  "status": "pass",');
    lines.push('  "owner": "Alin",');
    lines.push('  "verifiedAt": "2026-06-05T00:00:00.000Z",');
    lines.push('  "environment": "repo",');
    lines.push('  "summary": "Decision recorded for .agent/ and .agents/: move useful tools outside the repo before removing repo copies.",');
    lines.push('  "evidence": [');
    lines.push('    {');
    lines.push('      "type": "manual_note",');
    lines.push('      "value": "Decision: move .agent/ and .agents/ outside the repo. Useful skills/workflows copied to a recoverable global location; repo copies will be removed in a separate cleanup commit."');
    lines.push('    },');
    lines.push('    {');
    lines.push('      "type": "manual_note",');
    lines.push('      "value": "Destination/recovery path recorded privately or in a non-secret local note."');
    lines.push('    },');
    lines.push('    {');
    lines.push('      "type": "path",');
    lines.push('      "value": "CLEANUP.md"');
    lines.push('    }');
    lines.push('  ]');
    lines.push('}');
    lines.push('```');
    lines.push('');
    lines.push('### Delete After Backup Snippet');
    lines.push('');
    lines.push('```json');
    lines.push('{');
    lines.push('  "id": "cleanup_agents_decision",');
    lines.push('  "status": "pass",');
    lines.push('  "owner": "Alin",');
    lines.push('  "verifiedAt": "2026-06-05T00:00:00.000Z",');
    lines.push('  "environment": "repo",');
    lines.push('  "summary": "Decision recorded for .agent/ and .agents/: delete after backup/recovery confirmation.",');
    lines.push('  "evidence": [');
    lines.push('    {');
    lines.push('      "type": "manual_note",');
    lines.push('      "value": "Decision: delete .agent/ and .agents/ after confirming useful workflows are unused or backed up. Deletion will happen in a separate cleanup commit."');
    lines.push('    },');
    lines.push('    {');
    lines.push('      "type": "manual_note",');
    lines.push('      "value": "Recovery path or backup confirmation recorded without secrets."');
    lines.push('    },');
    lines.push('    {');
    lines.push('      "type": "path",');
    lines.push('      "value": "CLEANUP.md"');
    lines.push('    }');
    lines.push('  ]');
    lines.push('}');
    lines.push('```');
    lines.push('');
    lines.push('## Completion');
    lines.push('');
    lines.push('Mark `cleanup_agents_decision` as `pass` only after the keep/move/delete choice is made and recorded in local manual evidence. Keeping the folders is an acceptable launch decision if it is intentional and dated.');
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function escapeTable(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' / ');
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function toPosix(file: string): string {
    return file.replace(/\\/g, '/').replace(/^\.\//, '');
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}
