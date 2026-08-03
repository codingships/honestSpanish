import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export type ChangeClassification = {
    application: boolean;
    browser: boolean;
    database: boolean;
};

const forceAllPaths = new Set([
    '.github/workflows/ci.yml',
    'scripts/ci/classify-changes.ts',
]);

function normalized(path: string): string {
    return path.trim().replaceAll('\\', '/').replace(/^\.\//u, '');
}

function isDocumentationOnly(path: string): boolean {
    return path.startsWith('docs/')
        || path === '.github/pull_request_template.md'
        || /^[^/]+\.md$/iu.test(path);
}

function affectsDatabaseContract(path: string): boolean {
    return path === 'db/schema.sql'
        || path.startsWith('supabase/migrations/')
        || path.startsWith('tests/sql/');
}

function affectsBrowserContract(path: string): boolean {
    return path.startsWith('src/')
        || path.startsWith('public/')
        || path.startsWith('tests/e2e/')
        || path.startsWith('scripts/dev/')
        || path.startsWith('scripts/demo/')
        || path === 'package.json'
        || path === 'pnpm-lock.yaml'
        || /^(astro|playwright|tailwind|vite)\.config\.[^/]+$/u.test(path);
}

export function classifyChangedPaths(inputPaths: readonly string[]): ChangeClassification {
    const paths = [...new Set(inputPaths.map(normalized).filter(Boolean))];
    if (
        paths.length === 0
        || paths.some((path) => forceAllPaths.has(path) || path.startsWith('.github/workflows/'))
    ) {
        return { application: true, browser: true, database: true };
    }

    let application = false;
    let browser = false;
    let database = false;

    for (const path of paths) {
        if (affectsDatabaseContract(path)) {
            database = true;
            continue;
        }
        if (isDocumentationOnly(path)) continue;

        application = true;
        if (affectsBrowserContract(path)) browser = true;
    }

    return { application, browser, database };
}

function argument(name: '--files' | '--output' | '--summary'): string | undefined {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

function run(): void {
    const filesPath = argument('--files');
    const outputPath = argument('--output');
    if (!filesPath || !outputPath) {
        throw new Error('Usage: classify-changes.ts --files <path> --output <github-output> [--summary <path>] [--force-all]');
    }

    const paths = readFileSync(filesPath, 'utf8').split(/\r?\n/u).filter(Boolean);
    const classification = process.argv.includes('--force-all')
        ? { application: true, browser: true, database: true }
        : classifyChangedPaths(paths);
    const lines = Object.entries(classification)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join('\n');

    appendFileSync(outputPath, `${lines}\n`, 'utf8');
    const summaryPath = argument('--summary');
    if (summaryPath) {
        appendFileSync(
            summaryPath,
            [
                '### CI change classification',
                '',
                `- Changed paths: ${paths.length}`,
                `- Database contract: ${classification.database ? 'run' : 'skip'}`,
                `- Application quality: ${classification.application ? 'run' : 'skip'}`,
                `- Public browser: ${classification.browser ? 'run' : 'skip'}`,
                '',
            ].join('\n'),
            'utf8',
        );
    }
    console.log(`[ci-classifier] ${lines.replaceAll('\n', ' ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
