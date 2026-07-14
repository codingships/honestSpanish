import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function typescriptFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const candidate = path.join(directory, entry.name);
        if (entry.isDirectory()) return typescriptFiles(candidate);
        return entry.isFile() && /\.[cm]?tsx?$/u.test(entry.name) ? [candidate] : [];
    });
}

describe('pnpm executable policy', () => {
    it('does not execute pnpm through Corepack anywhere in project scripts', () => {
        const forbidden = [
            /\bcorepack\.cmd\b/u,
            /\bfunction\s+corepackCommand\s*\(/u,
            /\bspawn(?:Sync)?\([^\r\n]*['"]corepack(?:\.cmd)?['"]/u,
            /\bconst\s+(?:command|corepack)\s*=.*['"]corepack(?:\.cmd)?['"]/u,
        ];

        for (const file of typescriptFiles('scripts')) {
            const source = readFileSync(file, 'utf8');
            for (const pattern of forbidden) {
                expect(source.match(pattern), `${file} matched ${pattern}`).toBeNull();
            }
        }
    });

    it('keeps package scripts on direct pnpm invocations', () => {
        const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
            packageManager?: unknown;
            scripts?: Record<string, unknown>;
        };

        expect(packageJson.packageManager).toBe('pnpm@10.33.0');
        for (const [name, command] of Object.entries(packageJson.scripts ?? {})) {
            expect(String(command), name).not.toMatch(/\bcorepack\s+pnpm\b/u);
        }
    });
});
