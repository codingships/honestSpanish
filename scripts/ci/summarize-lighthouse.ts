import { appendFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type AuditValue = {
    details?: unknown;
    numericValue?: number;
    score?: number | null;
};

export type LighthouseResult = {
    audits: Record<string, AuditValue | undefined>;
    categories: Record<string, { score: number | null } | undefined>;
    configSettings?: { formFactor?: string };
    fetchTime: string;
    finalUrl: string;
    lighthouseVersion: string;
    requestedUrl: string;
};

type Direction = 'higher' | 'lower';

type Distribution = {
    median: number | null;
    worst: number | null;
};

type RouteSummary = {
    categories: Record<string, Distribution>;
    metrics: Record<string, Distribution>;
    runs: number;
    url: string;
};

const categoryIds = ['performance', 'accessibility', 'best-practices', 'seo'] as const;
const metricIds = {
    cls: 'cumulative-layout-shift',
    fcpMs: 'first-contentful-paint',
    lcpMs: 'largest-contentful-paint',
    speedIndexMs: 'speed-index',
    tbtMs: 'total-blocking-time',
    transferKiB: 'total-byte-weight',
} as const;

function finite(values: Array<number | null | undefined>): number[] {
    return values.filter((value): value is number => Number.isFinite(value));
}

function rounded(value: number): number {
    return Math.round(value * 100) / 100;
}

export function distribution(
    values: Array<number | null | undefined>,
    direction: Direction,
): Distribution {
    const sorted = finite(values).sort((left, right) => left - right);
    if (sorted.length === 0) return { median: null, worst: null };
    const middle = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0
        ? (sorted[middle - 1]! + sorted[middle]!) / 2
        : sorted[middle]!;
    return {
        median: rounded(median),
        worst: rounded(direction === 'higher' ? sorted[0]! : sorted.at(-1)!),
    };
}

export function summarizeLighthouse(results: LighthouseResult[]): RouteSummary[] {
    const byUrl = new Map<string, LighthouseResult[]>();
    for (const result of results) {
        const url = result.finalUrl || result.requestedUrl;
        const current = byUrl.get(url) ?? [];
        current.push(result);
        byUrl.set(url, current);
    }

    return [...byUrl.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([url, runs]) => ({
            url,
            runs: runs.length,
            categories: Object.fromEntries(categoryIds.map((category) => [
                category,
                distribution(
                    runs.map((run) => {
                        const score = run.categories[category]?.score;
                        return typeof score === 'number' ? score * 100 : null;
                    }),
                    'higher',
                ),
            ])),
            metrics: Object.fromEntries(Object.entries(metricIds).map(([label, auditId]) => [
                label,
                distribution(
                    runs.map((run) => {
                        const value = run.audits[auditId]?.numericValue;
                        if (typeof value !== 'number') return null;
                        return label === 'transferKiB' ? value / 1024 : value;
                    }),
                    'lower',
                ),
            ])),
        }));
}

function formatted(value: number | null): string {
    return value === null ? '—' : String(value);
}

export function renderMarkdown(routes: RouteSummary[], metadata: Record<string, unknown>): string {
    const rows = routes.map((route) => {
        const path = new URL(route.url).pathname;
        const performance = route.categories.performance!;
        const accessibility = route.categories.accessibility!;
        const bestPractices = route.categories['best-practices']!;
        const seo = route.categories.seo!;
        const lcp = route.metrics.lcpMs!;
        const tbt = route.metrics.tbtMs!;
        const cls = route.metrics.cls!;
        return `| ${path} | ${route.runs} | ${formatted(performance.median)}/${formatted(performance.worst)} | ${formatted(lcp.median)}/${formatted(lcp.worst)} | ${formatted(tbt.median)}/${formatted(tbt.worst)} | ${formatted(cls.median)}/${formatted(cls.worst)} | ${formatted(accessibility.median)} | ${formatted(bestPractices.median)} | ${formatted(seo.median)} |`;
    });

    return [
        '## Lighthouse reproducible',
        '',
        `- SHA: \`${String(metadata.sourceSha)}\``,
        `- Perfil: \`${String(metadata.profile)}\``,
        `- Scope: \`${String(metadata.scope)}\``,
        `- Lighthouse: \`${String(metadata.lighthouseVersions)}\``,
        '- Cada celda de métrica muestra `mediana/peor`; las puntuaciones muestran 0–100.',
        '',
        '| Ruta | Runs | Perf. | LCP ms | TBT ms | CLS | A11y | Buenas prácticas | SEO |',
        '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
        ...rows,
        '',
    ].join('\n');
}

function argument(name: '--input'): string | undefined {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

export function writeLighthouseSummary(inputPath: string): void {
    const input = resolve(inputPath);
    const reportPaths = readdirSync(input)
        .filter((name) => name.endsWith('.report.json'))
        .map((name) => join(input, name));
    if (reportPaths.length === 0) throw new Error(`No Lighthouse JSON reports found in ${input}.`);

    const results = reportPaths.map((path) => JSON.parse(readFileSync(path, 'utf8')) as LighthouseResult);
    const routes = summarizeLighthouse(results);
    const metadata = {
        generatedAt: new Date().toISOString(),
        lighthouseVersions: [...new Set(results.map((result) => result.lighthouseVersion))].join(', '),
        profile: process.env.LHCI_PROFILE || results[0]?.configSettings?.formFactor || 'unknown',
        scope: process.env.LHCI_SCOPE || 'unknown',
        sourceSha: process.env.GITHUB_SHA || 'local',
    };
    const summary = { schemaVersion: 1, metadata, routes };
    const markdown = renderMarkdown(routes, metadata);

    writeFileSync(join(input, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    writeFileSync(join(input, 'summary.md'), `${markdown}\n`, 'utf8');
    if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`, 'utf8');
    }
    process.stdout.write(markdown);
}

function run(): void {
    writeLighthouseSummary(
        argument('--input') ?? `test-results/lighthouse/${process.env.LHCI_PROFILE || 'mobile'}`,
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
