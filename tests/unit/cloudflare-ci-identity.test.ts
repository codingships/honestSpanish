import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
    parseMixedJsonOutput,
    runCloudflareIdentityCli,
    verifyCloudflareWhoamiOutput,
} from '../../scripts/ci/verify-cloudflare-identity';

const expectedAccountId = 'd1a22bcf6477ff2ff31d2bfb83084e44';
const otherAccountId = '0123456789abcdef0123456789abcdef';

function identity(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        loggedIn: true,
        accounts: [
            { id: otherAccountId, name: 'Other account' },
            { id: expectedAccountId, name: 'Approved } account with [brackets] and "quotes"' },
        ],
        ...overrides,
    };
}

describe('Cloudflare CI identity verification', () => {
    it('extracts and verifies Wrangler JSON after the observed noisy stdout notice', () => {
        const stdout = [
            'Cloudflare agent skills are available for: building agents, Workers, and more.',
            JSON.stringify(identity(), null, 2),
            'Wrangler finished.',
        ].join('\n');

        expect(verifyCloudflareWhoamiOutput(stdout, expectedAccountId)).toEqual({
            loggedIn: true,
            expectedAccountId,
            matchedAccountCount: 1,
        });
    });

    it('strips ANSI notices and ignores invalid brace fragments before the first valid JSON value', () => {
        const escape = String.fromCharCode(27);
        const stdout = `${escape}[33mNotice {not-json}${escape}[0m\n${JSON.stringify(identity())}`;

        expect(parseMixedJsonOutput(stdout)).toEqual(identity());
    });

    it('fails closed on an earlier unrelated valid JSON value', () => {
        const stdout = `notice {"status":"ok"}\n${JSON.stringify(identity())}`;
        expect(() => verifyCloudflareWhoamiOutput(stdout, expectedAccountId)).toThrow(
            'Wrangler identity is not logged in.',
        );
    });

    it.each([
        ['', 'Wrangler output did not contain JSON.'],
        ['notice only', 'complete JSON object or array'],
        ['notice {"loggedIn": true', 'complete JSON object or array'],
    ])('rejects missing or incomplete JSON without echoing stdout', (stdout, expectedError) => {
        expect(() => verifyCloudflareWhoamiOutput(stdout, expectedAccountId)).toThrow(expectedError);
    });

    it('requires loggedIn=true and an accounts array', () => {
        expect(() => verifyCloudflareWhoamiOutput(JSON.stringify(identity({ loggedIn: false })), expectedAccountId))
            .toThrow('Wrangler identity is not logged in.');
        expect(() => verifyCloudflareWhoamiOutput(JSON.stringify(identity({ accounts: null })), expectedAccountId))
            .toThrow('Wrangler identity accounts must be an array.');
    });

    it('requires exactly one occurrence of the approved account ID', () => {
        expect(() => verifyCloudflareWhoamiOutput(
            JSON.stringify(identity({ accounts: [{ id: otherAccountId }] })),
            expectedAccountId,
        )).toThrow('exactly one match');

        expect(() => verifyCloudflareWhoamiOutput(
            JSON.stringify(identity({
                accounts: [
                    { id: expectedAccountId },
                    { id: expectedAccountId },
                ],
            })),
            expectedAccountId,
        )).toThrow('exactly one match');
    });

    it('rejects malformed account entries and expected account IDs', () => {
        expect(() => verifyCloudflareWhoamiOutput(
            JSON.stringify(identity({ accounts: [expectedAccountId] })),
            expectedAccountId,
        )).toThrow('malformed account entry');
        expect(() => verifyCloudflareWhoamiOutput(JSON.stringify(identity()), 'not-an-account-id'))
            .toThrow('Expected Cloudflare account ID is invalid.');
    });

    it('prints only a safe confirmation when invoked through the reusable CLI', () => {
        const directory = mkdtempSync(join(tmpdir(), 'cloudflare-ci-identity-'));
        const input = join(directory, 'whoami.txt');
        writeFileSync(input, `Wrangler notice\n${JSON.stringify(identity())}`, 'utf8');
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        try {
            runCloudflareIdentityCli([
                '--input',
                input,
                '--expected-account-id',
                expectedAccountId,
            ]);
            expect(log).toHaveBeenCalledOnce();
            expect(log).toHaveBeenCalledWith('Cloudflare identity verification passed.');
            expect(log.mock.calls.flat().join(' ')).not.toContain(expectedAccountId);
        } finally {
            log.mockRestore();
            rmSync(directory, { recursive: true, force: true });
        }
    });
});
