import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
    activeStagingVersion,
    findStagingVersionByOwnership,
    runCloudflareStagingStateCli,
    STAGING_WORKERS,
    verifyStagingVersionOwnership,
} from '../../scripts/ci/cloudflare-staging-state';

const baselineVersion = '8f90a491-99f9-4347-a793-b762a782a8d3';
const otherVersion = '4dd8e219-0389-4186-91eb-e1cfec2e7728';
const commitSha = '80108aae91e1133483b6d74b9672fb34e9b2cc44';
const deployMessage = `staging:${commitSha}:run:123:1`;

function deployment(versions: Array<Record<string, unknown>>): string {
    return JSON.stringify({ versions });
}

function versionView(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
        id: baselineVersion,
        annotations: {
            'workers/tag': commitSha,
            'workers/message': deployMessage,
        },
        ...overrides,
    });
}

function versionsList(entries: Array<Record<string, unknown>>): string {
    return JSON.stringify(entries);
}

function listedVersion(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: baselineVersion,
        annotations: {
            'workers/tag': commitSha,
            'workers/message': deployMessage,
        },
        ...overrides,
    };
}

describe('Cloudflare staging deployment state', () => {
    it('accepts one canonical staging version at 100 percent', () => {
        expect(activeStagingVersion(
            deployment([{ version_id: baselineVersion, percentage: '100' }]),
            STAGING_WORKERS.web,
        )).toEqual({
            percentage: 100,
            versionId: baselineVersion,
            worker: STAGING_WORKERS.web,
        });
    });

    it('fails closed for split traffic, malformed state and non-staging Workers', () => {
        expect(() => activeStagingVersion(deployment([
            { version_id: baselineVersion, percentage: 90 },
            { version_id: otherVersion, percentage: 10 },
        ]), STAGING_WORKERS.fulfillment)).toThrow('exactly one active Worker version');

        expect(() => activeStagingVersion(
            deployment([{ version_id: 'not-a-version', percentage: 100 }]),
            STAGING_WORKERS.web,
        )).toThrow('invalid Worker version ID');

        expect(() => activeStagingVersion(
            deployment([{ version_id: baselineVersion, percentage: 100 }]),
            'unrelated-worker',
        )).toThrow('canonical staging Workers');
    });

    it('requires an exact version ID, commit tag and run-specific message', () => {
        const expected = {
            message: deployMessage,
            tag: commitSha,
            versionId: baselineVersion,
            worker: STAGING_WORKERS.web,
        } as const;

        expect(verifyStagingVersionOwnership(versionView(), expected)).toEqual(expected);
        expect(() => verifyStagingVersionOwnership(versionView({
            annotations: {
                'workers/tag': commitSha,
                'workers/message': `${deployMessage}:other`,
            },
        }), expected)).toThrow('not owned by this deployment run');
        expect(() => verifyStagingVersionOwnership(versionView({
            id: otherVersion,
        }), expected)).toThrow('does not match the expected version ID');
    });

    it('finds exactly one uploaded version by its commit tag and run-specific message', () => {
        const expected = {
            message: deployMessage,
            tag: commitSha,
            worker: STAGING_WORKERS.fulfillment,
        } as const;

        expect(findStagingVersionByOwnership(versionsList([
            listedVersion({
                id: otherVersion,
                annotations: {
                    'workers/tag': commitSha,
                    'workers/message': `${deployMessage}:older`,
                },
            }),
            listedVersion(),
        ]), expected)).toEqual({
            ...expected,
            versionId: baselineVersion,
        });

        expect(() => findStagingVersionByOwnership(
            versionsList([]),
            expected,
        )).toThrow('exactly one version owned');
        expect(() => findStagingVersionByOwnership(
            versionsList([listedVersion(), listedVersion({ id: otherVersion })]),
            expected,
        )).toThrow('exactly one version owned');
        expect(() => findStagingVersionByOwnership(
            versionsList([listedVersion()]),
            { ...expected, worker: 'unrelated-worker' as typeof STAGING_WORKERS.web },
        )).toThrow('canonical staging Workers');
    });

    it('rechecks the baseline before version activation and does not deploy triggers', () => {
        const workflow = readFileSync('.github/workflows/deploy-staging.yml', 'utf8');

        expect(workflow.match(/pnpm exec wrangler versions upload/gu)).toHaveLength(2);
        expect(workflow.match(/pnpm exec wrangler versions deploy/gu)).toHaveLength(2);
        expect(workflow.match(/if \[ "\$pre_activation_version" != "\$BASELINE_VERSION" \]; then/gu))
            .toHaveLength(2);
        expect(workflow).not.toMatch(/pnpm exec wrangler deploy\s/gu);
        expect(workflow).not.toContain('wrangler triggers deploy');

        for (const worker of ['fulfillment', 'web']) {
            const marker = `$RUNNER_TEMP/${worker}-before-version-activation.json`;
            const markerIndex = workflow.indexOf(marker);
            const activationIndex = workflow.indexOf(
                'pnpm exec wrangler versions deploy',
                markerIndex,
            );
            expect(markerIndex).toBeGreaterThan(-1);
            expect(activationIndex).toBeGreaterThan(markerIndex);
        }
    });

    it('keeps each rollback config in the rollback function scope', () => {
        const workflow = readFileSync('.github/workflows/deploy-staging.yml', 'utf8');
        const rollbackStart = workflow.indexOf('          rollback_one() {');
        const rollbackEnd = workflow.indexOf(
            '          printf \'%s\\n\' "### Automatic staging rollback"',
            rollbackStart,
        );
        const rollbackFunction = workflow.slice(rollbackStart, rollbackEnd);
        const ownershipStart = workflow.indexOf('          owned_by_this_run() {');
        const ownershipEnd = workflow.indexOf('          rollback_one() {', ownershipStart);
        const ownershipFunction = workflow.slice(ownershipStart, ownershipEnd);

        expect(rollbackStart).toBeGreaterThan(-1);
        expect(rollbackEnd).toBeGreaterThan(rollbackStart);
        expect(rollbackFunction).toContain(
            'local -a config_args=(--config dist/server/wrangler.json)',
        );
        expect(rollbackFunction).toContain('--config workers/fulfillment/wrangler.toml');
        expect(rollbackFunction).toContain('"${config_args[@]}"');
        expect(ownershipFunction).not.toContain('config_args');
    });

    it('offers a reusable CLI without echoing ownership metadata', () => {
        const directory = mkdtempSync(join(tmpdir(), 'cloudflare-staging-state-'));
        const statusFile = join(directory, 'status.json');
        const versionsFile = join(directory, 'versions.json');
        const versionFile = join(directory, 'version.json');
        writeFileSync(statusFile, deployment([{ version_id: baselineVersion, percentage: 100 }]), 'utf8');
        writeFileSync(versionsFile, versionsList([listedVersion()]), 'utf8');
        writeFileSync(versionFile, versionView(), 'utf8');
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

        try {
            runCloudflareStagingStateCli([
                'active',
                '--input',
                statusFile,
                '--worker',
                STAGING_WORKERS.web,
            ]);
            expect(log).toHaveBeenLastCalledWith(baselineVersion);

            runCloudflareStagingStateCli([
                'find-owned',
                '--input',
                versionsFile,
                '--worker',
                STAGING_WORKERS.web,
                '--tag',
                commitSha,
                '--message',
                deployMessage,
            ]);
            expect(log).toHaveBeenLastCalledWith(baselineVersion);

            runCloudflareStagingStateCli([
                'assert-owned',
                '--input',
                versionFile,
                '--worker',
                STAGING_WORKERS.web,
                '--version-id',
                baselineVersion,
                '--tag',
                commitSha,
                '--message',
                deployMessage,
            ]);
            expect(log).toHaveBeenLastCalledWith(
                'Cloudflare staging version ownership verification passed.',
            );
            expect(log.mock.calls.at(-1)?.join(' ')).not.toContain(commitSha);
            expect(log.mock.calls.at(-1)?.join(' ')).not.toContain(deployMessage);
        } finally {
            log.mockRestore();
            rmSync(directory, { recursive: true, force: true });
        }
    });
});
