import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
    activeStagingVersion,
    assertStagingVersionBindingInventory,
    EXPECTED_STAGING_VERSION_BINDINGS,
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

function bindingVersion(
    worker: keyof typeof EXPECTED_STAGING_VERSION_BINDINGS,
    bindings: readonly { name: string; type: string }[] = EXPECTED_STAGING_VERSION_BINDINGS[worker].map((binding) => ({
        ...binding,
        value: 'withheld-by-version-view-fixture',
    })),
): string {
    return JSON.stringify({
        id: baselineVersion,
        resources: { bindings },
    });
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

    it.each([STAGING_WORKERS.web, STAGING_WORKERS.fulfillment])(
        'accepts only the exact name/type binding inventory for %s',
        (worker) => {
            const expected = EXPECTED_STAGING_VERSION_BINDINGS[worker];
            expect(assertStagingVersionBindingInventory(bindingVersion(worker), worker)).toEqual({
                bindings: expected.map(({ name, type }) => ({ name, type })).sort((left, right) => (
                    `${left.name}\u0000${left.type}`.localeCompare(`${right.name}\u0000${right.type}`)
                )),
                worker,
            });

            expect(() => assertStagingVersionBindingInventory(bindingVersion(worker, [
                ...expected,
                { name: 'STALE_SECRET', type: 'secret_text' },
            ]), worker)).toThrow('does not exactly match');

            expect(() => assertStagingVersionBindingInventory(bindingVersion(worker, expected.slice(1)), worker))
                .toThrow('does not exactly match');

            expect(() => assertStagingVersionBindingInventory(bindingVersion(worker, expected.map((binding, index) => (
                index === 0 ? { ...binding, type: 'plain_text' } : binding
            ))), worker)).toThrow('does not exactly match');
        },
    );

    it('rejects malformed and duplicate binding records before comparison', () => {
        expect(() => assertStagingVersionBindingInventory(JSON.stringify({ resources: {} }), STAGING_WORKERS.web))
            .toThrow('resources.bindings array');
        expect(() => assertStagingVersionBindingInventory(bindingVersion(STAGING_WORKERS.web, [
            { name: 'A', type: 'plain_text' },
            { name: 'A', type: 'secret_text' },
        ]), STAGING_WORKERS.web)).toThrow('duplicate binding name');
        expect(() => assertStagingVersionBindingInventory(bindingVersion(STAGING_WORKERS.web, [
            { name: 'A', type: '' },
        ]), STAGING_WORKERS.web)).toThrow('malformed binding');
    });

    it('rejects wrong or missing non-secret binding semantics', () => {
        const webBindings = EXPECTED_STAGING_VERSION_BINDINGS[STAGING_WORKERS.web];
        const fulfillmentBindings = EXPECTED_STAGING_VERSION_BINDINGS[STAGING_WORKERS.fulfillment];
        const replace = (
            bindings: readonly { name: string; type: string }[],
            name: string,
            replacement: Record<string, unknown>,
        ): Array<{ name: string; type: string }> => bindings.map((binding) => (
            binding.name === name
                ? { ...binding, ...replacement } as { name: string; type: string }
                : binding
        ));

        expect(() => assertStagingVersionBindingInventory(bindingVersion(
            STAGING_WORKERS.web,
            replace(webBindings, 'CHECKOUT_ENABLED', { text: 'true' }),
        ), STAGING_WORKERS.web)).toThrow('exact staging plain-text value');

        expect(() => assertStagingVersionBindingInventory(bindingVersion(
            STAGING_WORKERS.web,
            replace(webBindings, 'CHECKOUT_ENABLED', { text: undefined }),
        ), STAGING_WORKERS.web)).toThrow('exact staging plain-text value');

        expect(() => assertStagingVersionBindingInventory(bindingVersion(
            STAGING_WORKERS.web,
            replace(webBindings, 'FULFILLMENT_SERVICE', { service: 'wrong-service' }),
        ), STAGING_WORKERS.web)).toThrow('exact staging service');

        expect(() => assertStagingVersionBindingInventory(bindingVersion(
            STAGING_WORKERS.web,
            replace(webBindings, 'FULFILLMENT_SERVICE', { environment: undefined }),
        ), STAGING_WORKERS.web)).toThrow('exact staging service');

        expect(() => assertStagingVersionBindingInventory(bindingVersion(
            STAGING_WORKERS.web,
            replace(webBindings, 'FULFILLMENT_SERVICE', { entrypoint: 'named-entrypoint' }),
        ), STAGING_WORKERS.web)).toThrow('exact staging service');

        expect(() => assertStagingVersionBindingInventory(bindingVersion(
            STAGING_WORKERS.fulfillment,
            replace(fulfillmentBindings, 'FULFILLMENT_QUEUE', { queue_name: 'wrong-queue' }),
        ), STAGING_WORKERS.fulfillment)).toThrow('exact staging queue');

        expect(() => assertStagingVersionBindingInventory(bindingVersion(
            STAGING_WORKERS.fulfillment,
            replace(fulfillmentBindings, 'FULFILLMENT_QUEUE', { queue_name: undefined }),
        ), STAGING_WORKERS.fulfillment)).toThrow('exact staging queue');
    });

    it('rechecks the baseline before version activation and does not deploy triggers', () => {
        const workflow = readFileSync('.github/workflows/deploy-staging.yml', 'utf8');
        const rollbackIndex = workflow.indexOf('      - name: Roll back failed staging deployment');
        const forwardDeployment = workflow.slice(0, rollbackIndex);

        expect(rollbackIndex).toBeGreaterThan(-1);
        expect(forwardDeployment.match(/pnpm exec wrangler versions upload/gu)).toHaveLength(2);
        expect(forwardDeployment.match(/pnpm exec wrangler versions deploy/gu)).toHaveLength(2);
        expect(workflow.match(/cloudflare-staging-state\.ts assert-bindings/gu)).toHaveLength(2);
        expect(workflow.match(/--secrets-file "\$secrets_file"/gu))
            .toHaveLength(2);
        expect(workflow.match(/if \[ "\$pre_activation_version" != "\$BASELINE_VERSION" \]; then/gu))
            .toHaveLength(2);
        expect(workflow).not.toMatch(/pnpm exec wrangler deploy\s/gu);
        expect(workflow).not.toContain('wrangler triggers deploy');
        expect(workflow).toContain('scripts/ci/write-cloudflare-version-secrets.ts');
        expect(workflow.match(/trap 'rm -f -- "\$secrets_file"' EXIT/gu)).toHaveLength(2);
        expect(workflow.match(/rm -f -- "\$secrets_file"/gu)).toHaveLength(4);
        expect(workflow.match(/trap - EXIT/gu)).toHaveLength(2);
        expect(workflow.match(/--role (web|fulfillment)/gu)).toHaveLength(2);
        expect(workflow).not.toContain('--keep-vars');

        for (const worker of ['fulfillment', 'web']) {
            const uploadedMarker = `$RUNNER_TEMP/${worker}-uploaded-version.json`;
            const marker = `$RUNNER_TEMP/${worker}-before-version-activation.json`;
            const uploadedIndex = workflow.indexOf(uploadedMarker);
            const bindingAssertionIndex = workflow.indexOf(
                'cloudflare-staging-state.ts assert-bindings',
                uploadedIndex,
            );
            const markerIndex = workflow.indexOf(marker);
            const activationIndex = workflow.indexOf(
                'pnpm exec wrangler versions deploy',
                markerIndex,
            );
            expect(uploadedIndex).toBeGreaterThan(-1);
            expect(bindingAssertionIndex).toBeGreaterThan(uploadedIndex);
            expect(markerIndex).toBeGreaterThan(bindingAssertionIndex);
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

    it('authenticates the immutable baseline before mutation and reuses only that contract for rollback', () => {
        const workflow = readFileSync('.github/workflows/deploy-staging.yml', 'utf8');
        const captureIndex = workflow.indexOf('--capture-baseline');
        const firstMutationIndex = workflow.indexOf('id: attempt_fulfillment');
        const rollbackIndex = workflow.indexOf('--verify-rollback');
        const finalActiveCheckIndex = workflow.indexOf('&& active_baselines_are_exact', rollbackIndex);

        expect(captureIndex).toBeGreaterThan(-1);
        expect(firstMutationIndex).toBeGreaterThan(captureIndex);
        expect(rollbackIndex).toBeGreaterThan(firstMutationIndex);
        expect(workflow).toContain('--web-bindings-file "$web_bindings_file"');
        expect(workflow).toContain('--fulfillment-bindings-file "$fulfillment_bindings_file"');
        expect(workflow).toContain('--contract "$ROLLBACK_CONTRACT"');
        expect(workflow).toContain('ROLLBACK_CONTRACT: ${{ steps.rollback_contract.outputs.path }}');
        expect(workflow).toContain('timeout-minutes: 4');
        expect(workflow).toContain('cleanup_budget_seconds=210');
        expect(workflow).toContain('timeout --signal=TERM --kill-after=3s');
        expect(workflow).toContain('local required_stable_observations=3');
        expect(workflow).toContain('local max_observations=6');
        expect(workflow).toContain('force_baseline() {');
        expect(workflow).toContain('wrangler rollback "$baseline"');
        expect(workflow).toContain('rollback_max_rounds=2');
        expect(workflow).toContain('rollback_max_rounds=1');
        expect(workflow).toContain(
            'for ((rollback_round = 1; rollback_round <= rollback_max_rounds; rollback_round += 1)); do',
        );
        expect(workflow).toContain('STAGING_RUNTIME_MAX_ATTEMPTS: "1"');
        expect(finalActiveCheckIndex).toBeGreaterThan(rollbackIndex);
    });

    it('offers a reusable CLI without echoing ownership metadata', () => {
        const directory = mkdtempSync(join(tmpdir(), 'cloudflare-staging-state-'));
        const statusFile = join(directory, 'status.json');
        const versionsFile = join(directory, 'versions.json');
        const versionFile = join(directory, 'version.json');
        const bindingFile = join(directory, 'bindings.json');
        writeFileSync(statusFile, deployment([{ version_id: baselineVersion, percentage: 100 }]), 'utf8');
        writeFileSync(versionsFile, versionsList([listedVersion()]), 'utf8');
        writeFileSync(versionFile, versionView(), 'utf8');
        writeFileSync(bindingFile, bindingVersion(STAGING_WORKERS.web), 'utf8');
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

            runCloudflareStagingStateCli([
                'assert-bindings',
                '--input',
                bindingFile,
                '--worker',
                STAGING_WORKERS.web,
            ]);
            expect(log).toHaveBeenLastCalledWith(
                'Cloudflare staging binding inventory verification passed.',
            );
        } finally {
            log.mockRestore();
            rmSync(directory, { recursive: true, force: true });
        }
    });
});
