import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export interface VerifiedCloudflareIdentity {
    loggedIn: true;
    expectedAccountId: string;
    matchedAccountCount: 1;
}

const accountIdPattern = /^[0-9a-f]{32}$/iu;
const ansiEscapePattern = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'gu');

function matchingJsonEnd(value: string, start: number): number {
    const stack: string[] = [];
    let quoted = false;
    let escaped = false;

    for (let index = start; index < value.length; index += 1) {
        const character = value[index];
        if (quoted) {
            if (escaped) escaped = false;
            else if (character === '\\') escaped = true;
            else if (character === '"') quoted = false;
            continue;
        }

        if (character === '"') {
            quoted = true;
            continue;
        }
        if (character === '{' || character === '[') {
            stack.push(character);
            continue;
        }
        if (character !== '}' && character !== ']') continue;

        const opening = stack.pop();
        const mismatched = (opening === '{' && character !== '}')
            || (opening === '[' && character !== ']');
        if (opening === undefined || mismatched) return -1;
        if (stack.length === 0) return index;
    }

    return -1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseMixedJsonOutput(source: string): unknown {
    const sanitized = source.replace(ansiEscapePattern, '').trim();
    if (sanitized === '') throw new Error('Wrangler output did not contain JSON.');

    try {
        return JSON.parse(sanitized);
    } catch {
        // Wrangler can prepend informational notices even when --json is used.
    }

    for (let start = 0; start < sanitized.length; start += 1) {
        const opening = sanitized[start];
        if (opening !== '{' && opening !== '[') continue;

        const end = matchingJsonEnd(sanitized, start);
        if (end === -1) continue;
        try {
            return JSON.parse(sanitized.slice(start, end + 1));
        } catch {
            // Keep looking for the first complete, valid JSON value.
        }
    }

    throw new Error('Wrangler output did not contain a complete JSON object or array.');
}

export function verifyCloudflareWhoamiOutput(
    source: string,
    expectedAccountId: string,
): VerifiedCloudflareIdentity {
    if (!accountIdPattern.test(expectedAccountId)) {
        throw new Error('Expected Cloudflare account ID is invalid.');
    }

    const identity = parseMixedJsonOutput(source);
    if (!isRecord(identity)) throw new Error('Wrangler identity JSON must be an object.');
    if (identity.loggedIn !== true) throw new Error('Wrangler identity is not logged in.');
    if (!Array.isArray(identity.accounts)) {
        throw new Error('Wrangler identity accounts must be an array.');
    }

    for (const account of identity.accounts) {
        if (!isRecord(account) || typeof account.id !== 'string') {
            throw new Error('Wrangler identity contains a malformed account entry.');
        }
    }

    const exactMatches = identity.accounts.filter(
        (account) => isRecord(account) && account.id === expectedAccountId,
    );
    if (exactMatches.length !== 1) {
        throw new Error('Wrangler identity must contain exactly one match for the approved account.');
    }

    return {
        loggedIn: true,
        expectedAccountId,
        matchedAccountCount: 1,
    };
}

interface CliOptions {
    input: string;
    expectedAccountId: string;
}

function parseCliOptions(args: string[]): CliOptions {
    let input: string | undefined;
    let expectedAccountId: string | undefined;

    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument !== '--input' && argument !== '--expected-account-id') {
            throw new Error('Unknown command-line argument.');
        }

        const value = args[index + 1];
        if (!value || value.startsWith('--')) throw new Error('A command-line argument value is missing.');
        index += 1;

        if (argument === '--input') {
            if (input !== undefined) throw new Error('The input argument was provided more than once.');
            input = value;
        } else {
            if (expectedAccountId !== undefined) {
                throw new Error('The expected account argument was provided more than once.');
            }
            expectedAccountId = value;
        }
    }

    if (!input || !expectedAccountId) {
        throw new Error('Both --input and --expected-account-id are required.');
    }
    return { input, expectedAccountId };
}

export function runCloudflareIdentityCli(args: string[]): void {
    const options = parseCliOptions(args);
    let source: string;
    try {
        source = readFileSync(options.input, 'utf8');
    } catch {
        throw new Error('Unable to read the Wrangler identity input file.');
    }
    verifyCloudflareWhoamiOutput(source, options.expectedAccountId);
    console.log('Cloudflare identity verification passed.');
}

const invokedScriptPath = process.argv[1];
if (invokedScriptPath && import.meta.url === pathToFileURL(path.resolve(invokedScriptPath)).href) {
    try {
        runCloudflareIdentityCli(process.argv.slice(2));
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Cloudflare identity verification failed.';
        console.error(`[cloudflare-identity] ${message}`);
        process.exitCode = 1;
    }
}
