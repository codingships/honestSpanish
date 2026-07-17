import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMixedJsonOutput } from '../../scripts/ci/verify-cloudflare-identity';
import { newestWorkerDeploymentVersionId } from '../../scripts/launch/cloudflare-deployment-order';

const oldVersion = '5d34b33b-1687-4bec-bb69-1b7d6e021e50';
const currentVersion = '597d23c1-d8ac-4db3-9d1f-ed228dba13df';

function deployment(versionId: string, createdOn: string): Record<string, unknown> {
    return {
        created_on: createdOn,
        versions: [{ version_id: versionId, percentage: 100 }],
    };
}

describe('Cloudflare production deployment selection', () => {
    it('selects the version from the newest deployment regardless of list ordering', () => {
        const oldestFirst = [
            deployment(oldVersion, '2026-07-15T17:37:41.659508Z'),
            deployment(currentVersion, '2026-07-15T18:13:06.785714Z'),
        ];

        expect(newestWorkerDeploymentVersionId(oldestFirst)).toBe(currentVersion);
        expect(newestWorkerDeploymentVersionId([...oldestFirst].reverse())).toBe(currentVersion);
    });

    it('works with the mixed informational output emitted by Wrangler', () => {
        const source = [
            'Cloudflare agent skills are available for Codex.',
            JSON.stringify([
                deployment(oldVersion, '2026-07-15T17:37:41.659508Z'),
                deployment(currentVersion, '2026-07-15T18:13:06.785714Z'),
            ]),
            'stderr follows',
        ].join('\n');

        expect(newestWorkerDeploymentVersionId(parseMixedJsonOutput(source))).toBe(currentVersion);
    });

    it('fails closed on malformed or ambiguous deployment versions', () => {
        expect(newestWorkerDeploymentVersionId({ result: [] })).toBeNull();
        expect(newestWorkerDeploymentVersionId([deployment('not-a-version', '2026-07-15T18:13:06Z')])).toBeNull();
        expect(newestWorkerDeploymentVersionId([{
            created_on: 'not-a-date',
            versions: [{ version_id: currentVersion, percentage: 100 }],
        }])).toBeNull();
        expect(newestWorkerDeploymentVersionId([{
            created_on: '2026-07-15T18:13:06Z',
            versions: [{ version_id: currentVersion, percentage: 50 }],
        }])).toBeNull();
        expect(newestWorkerDeploymentVersionId([{
            created_on: '2026-07-15T18:13:06Z',
            versions: [
                { version_id: oldVersion, percentage: 50 },
                { version_id: currentVersion, percentage: 50 },
            ],
        }])).toBeNull();
        expect(newestWorkerDeploymentVersionId([
            deployment(oldVersion, '2026-07-15T18:13:06Z'),
            deployment(currentVersion, '2026-07-15T18:13:06Z'),
        ])).toBeNull();
        expect(newestWorkerDeploymentVersionId([
            deployment(oldVersion, 'not-a-date'),
            deployment(currentVersion, '2026-07-15T18:13:06Z'),
        ])).toBeNull();
    });

    it('wires all three C-D-E runners through mixed JSON parsing and newest-deployment selection', () => {
        for (const runner of [
            'scripts/launch/cloudflare-production-fulfillment-bootstrap-secrets.ts',
            'scripts/launch/cloudflare-production-worker-phase1.ts',
            'scripts/launch/cloudflare-production-worker-bootstrap-secrets.ts',
        ]) {
            const source = readFileSync(runner, 'utf8');
            expect(source).toContain('parseMixedJsonOutput');
            expect(source).toContain('newestWorkerDeploymentVersionId(parseMixedJsonOutput(');
        }
    });
});
