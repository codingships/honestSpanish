import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    applyFreshStandalonePrimaryEvidence,
    applyFreshStandaloneSecondaryEvidence,
    readLatestJsonOrMarkdownSummary,
    selectStagingSmokeEvidence,
    summarizePrimaryResults,
    type AuditEvidenceSummary,
    type StagingSmokeEvidenceSummary,
} from '../../scripts/launch/status-evidence';

const temporaryRoots: string[] = [];

afterEach(() => {
    for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('launch status evidence freshness', () => {
    it('keeps the latest successful executed staging smoke when a newer plan-only run exists', () => {
        const executed = evidence('executed.json', {
            status: 'OK',
            closureStatus: 'EXECUTED_AND_NEEDS_REVIEW',
            executeRequested: true,
            externalWriteCommandStarted: true,
            endedAt: '2026-07-12T08:50:41.286Z',
        });
        const newerPlan = evidence('plan.json', {
            status: 'OK',
            closureStatus: 'PLAN_ONLY_READY',
            executeRequested: false,
            externalWriteCommandStarted: false,
            endedAt: '2026-07-12T09:05:21.855Z',
        });

        const selection = selectStagingSmokeEvidence([newerPlan, executed]);

        expect(selection.preferred?.file).toBe('executed.json');
        expect(selection.latestExecutedSuccess?.file).toBe('executed.json');
        expect(selection.latestPlan?.file).toBe('plan.json');
        expect(selection.latestRun?.file).toBe('plan.json');
    });

    it('supersedes only exact older primary commands and preserves legal/manual blockers', () => {
        const primaryResults = [
            failed('pnpm launch:security'),
            failed('pnpm launch:operations'),
            failed('pnpm launch:final-readiness'),
            failed('pnpm launch:legal'),
            failed('pnpm launch:manual-evidence'),
        ];

        const results = applyFreshStandalonePrimaryEvidence(
            primaryResults,
            '2026-07-10T14:22:32.627Z',
            [
                standalone('pnpm launch:security', 'OK', '2026-07-12T08:52:35.767Z'),
                standalone('pnpm launch:operations', 'OK', '2026-07-10T13:00:00.000Z'),
                standalone('pnpm launch:final-readiness', 'OK', '2026-07-12T09:27:14.664Z'),
            ],
        );

        expect(statusOf(results, 'pnpm launch:security')).toBe('ok');
        expect(statusOf(results, 'pnpm launch:final-readiness')).toBe('ok');
        expect(statusOf(results, 'pnpm launch:operations')).toBe('failed');
        expect(statusOf(results, 'pnpm launch:legal')).toBe('failed');
        expect(statusOf(results, 'pnpm launch:manual-evidence')).toBe('failed');
        expect(summarizePrimaryResults(results)).toBe('BLOCKED');
    });

    it('supersedes stale secondary audit copies without changing manual or legal findings', () => {
        const results = applyFreshStandaloneSecondaryEvidence(
            [
                secondaryFailed('security evidence'),
                secondaryFailed('final readiness evidence'),
                secondaryFailed('manual launch evidence'),
                secondaryFailed('legal evidence'),
            ],
            '2026-07-10T13:56:00.441Z',
            [
                { ...standalone('pnpm launch:security', 'OK', '2026-07-12T08:52:35.767Z'), secondaryArea: 'security evidence' },
                { ...standalone('pnpm launch:final-readiness', 'OK', '2026-07-12T09:27:14.664Z'), secondaryArea: 'final readiness evidence' },
            ],
        );

        expect(areaStatus(results, 'security evidence')).toBe('ok');
        expect(areaStatus(results, 'final readiness evidence')).toBe('ok');
        expect(areaStatus(results, 'manual launch evidence')).toBe('failed');
        expect(areaStatus(results, 'legal evidence')).toBe('failed');
    });

    it('recognizes the newest Markdown-only runner summary ahead of older JSON evidence', () => {
        const outputsRoot = mkdtempSync(path.join(tmpdir(), 'launch-status-evidence-'));
        temporaryRoots.push(outputsRoot);
        const folder = path.join(outputsRoot, 'launch-cloudflare-production-fulfillment-secrets');
        const older = path.join(folder, '2026-07-10T22-30-59-254Z');
        const newer = path.join(folder, '2026-07-10T23-10-34-430Z');
        mkdirSync(older, { recursive: true });
        mkdirSync(newer, { recursive: true });
        writeFileSync(path.join(older, 'summary.json'), JSON.stringify({
            status: 'FAILED',
            outputDir: older,
            startedAt: '2026-07-10T22:30:59.254Z',
            endedAt: '2026-07-10T22:31:00.000Z',
        }));
        writeFileSync(path.join(newer, 'summary.md'), '# Summary\n\n- Status: OK\n');

        const latest = readLatestJsonOrMarkdownSummary<AuditEvidenceSummary>(
            outputsRoot,
            'launch-cloudflare-production-fulfillment-secrets',
        );

        expect(latest?.file).toBe(path.join(newer, 'summary.md'));
        expect(latest?.data.status).toBe('OK');
        expect(latest?.data.outputDir).toBe(newer);
    });
});

function evidence(file: string, overrides: Partial<StagingSmokeEvidenceSummary>) {
    return {
        file,
        data: {
            status: 'OK',
            outputDir: path.dirname(file),
            startedAt: overrides.endedAt ?? '2026-07-12T00:00:00.000Z',
            endedAt: overrides.endedAt ?? '2026-07-12T00:00:00.000Z',
            ...overrides,
        } satisfies StagingSmokeEvidenceSummary,
    };
}

function failed(name: string) {
    return {
        status: 'failed' as const,
        name,
        message: `${name} failed in primary verification.`,
    };
}

function standalone(commandName: string, status: string, endedAt: string) {
    return {
        commandName,
        file: `${commandName}.json`,
        data: { status, endedAt },
    };
}

function secondaryFailed(area: string) {
    return {
        status: 'failed' as const,
        area,
        message: `${area} is stale.`,
    };
}

function statusOf(results: ReturnType<typeof applyFreshStandalonePrimaryEvidence>, name: string) {
    return results.find((result) => result.name === name)?.status;
}

function areaStatus(results: ReturnType<typeof applyFreshStandaloneSecondaryEvidence>, area: string) {
    return results.find((result) => result.area === area)?.status;
}
