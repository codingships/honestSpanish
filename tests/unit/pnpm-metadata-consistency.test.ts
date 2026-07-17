import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');

function readYamlScalar(value: string): string {
    const trimmed = value.trim();

    if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
        return trimmed.slice(1, -1).replaceAll("''", "'");
    }

    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        return JSON.parse(trimmed) as string;
    }

    return trimmed;
}

function readFlatWorkspaceSection(source: string, section: string): Record<string, string> {
    const lines = source.split(/\r?\n/);
    const start = lines.findIndex((line) => line === `${section}:`);

    if (start === -1) throw new Error(`Missing ${section} in pnpm-workspace.yaml`);

    const entries: Record<string, string> = {};
    for (const line of lines.slice(start + 1)) {
        if (line && !line.startsWith(' ')) break;
        if (!line.trim()) continue;

        const match = /^ {2}(.+?):\s+(.+)$/.exec(line);
        if (!match) throw new Error(`Unsupported ${section} entry: ${line}`);

        entries[readYamlScalar(match[1])] = readYamlScalar(match[2]);
    }

    return entries;
}

function readRootImporterSpecifiers(source: string): Record<string, string> {
    const lines = source.split(/\r?\n/);
    const start = lines.findIndex((line) => line === '  .:');

    if (start === -1) throw new Error('Missing root importer in pnpm-lock.yaml');

    const specifiers: Record<string, string> = {};
    let inDependencySection = false;
    let dependencyName: string | undefined;

    for (const line of lines.slice(start + 1)) {
        if (/^ {2}\S/.test(line)) break;

        if (/^ {4}(dependencies|devDependencies|optionalDependencies):$/.test(line)) {
            inDependencySection = true;
            dependencyName = undefined;
            continue;
        }

        if (/^ {4}\S/.test(line)) {
            inDependencySection = false;
            dependencyName = undefined;
            continue;
        }

        if (!inDependencySection) continue;

        const dependencyMatch = /^ {6}(.+):$/.exec(line);
        if (dependencyMatch) {
            dependencyName = readYamlScalar(dependencyMatch[1]);
            continue;
        }

        const specifierMatch = /^ {8}specifier:\s+(.+)$/.exec(line);
        if (specifierMatch && dependencyName) {
            specifiers[dependencyName] = readYamlScalar(specifierMatch[1]);
        }
    }

    return specifiers;
}

describe('pnpm metadata consistency', () => {
    const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
        pnpm?: {
            overrides?: Record<string, string>;
            patchedDependencies?: Record<string, string>;
        };
    };
    const workspace = readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8');
    const lockfile = readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8');

    it('mirrors canonical workspace overrides for pnpm 10 dependency verification', () => {
        expect(packageJson.pnpm?.overrides).toEqual(readFlatWorkspaceSection(workspace, 'overrides'));
        expect(packageJson.pnpm?.patchedDependencies).toEqual(
            readFlatWorkspaceSection(workspace, 'patchedDependencies'),
        );
    });

    it('keeps direct dependency specifiers aligned with the lockfile importer', () => {
        expect(readRootImporterSpecifiers(lockfile)).toEqual({
            ...packageJson.dependencies,
            ...packageJson.devDependencies,
            ...packageJson.optionalDependencies,
        });
    });
});
