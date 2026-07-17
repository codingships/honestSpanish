import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type Status = 'ok' | 'warning' | 'failed';

interface Check {
    status: Status;
    name: string;
    message: string;
    details?: string[];
}

interface FetchSnapshot {
    requestedUrl: string;
    finalUrl: string;
    status: number | null;
    ok: boolean;
    redirected: boolean;
    contentType: string;
    body: string;
    error?: string;
}

interface Report {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: 'OK' | 'WARNING' | 'FAILED';
    outputDir: string;
    baseUrl: string;
    checks: Check[];
    redaction: string[];
}

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-live-domain-readonly-evidence', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const baseUrl = normalizeBaseUrl(readArgValue('--base-url') ?? 'https://espanolhonesto.com');
const hostVariants = readListArg('--host-variant');
const publicPaths = [
    '/',
    '/es',
    '/en',
    '/ru',
    '/es/espanol-para-vivir-en-espana',
    '/es/espanol-para-profesionales',
    '/es/clases-de-conversacion-en-espanol',
    '/es/blog',
    '/en/blog',
    '/ru/blog',
    '/robots.txt',
    '/sitemap-index.xml',
    '/sitemap-public.xml',
    '/sitemap-0.xml',
    '/llms.txt',
];

const snapshots = new Map<string, FetchSnapshot>();
for (const url of [
    baseUrl,
    ...hostVariants,
    ...publicPaths.map((publicPath) => absoluteUrl(publicPath)),
]) {
    snapshots.set(url, await fetchSnapshot(url));
}

const checks: Check[] = [
    checkCanonicalDomain(),
    checkRobotsTxt(),
    checkSitemapIndex(),
    checkPublicSitemap(),
    checkLlmsTxt(),
    ...checkPublicHtmlRoutes(),
];

const failed = checks.filter((check) => check.status === 'failed');
const warnings = checks.filter((check) => check.status === 'warning');
const status: Report['status'] = failed.length > 0 ? 'FAILED' : warnings.length > 0 ? 'WARNING' : 'OK';
const report: Report = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status,
    outputDir,
    baseUrl,
    checks,
    redaction: [
        'Only public URLs, HTTP status codes, final URLs and aggregate metadata checks are stored.',
        'No cookies, authorization headers, API tokens, Search Console data, analytics exports, form submissions, personal data or dashboard screenshots are stored.',
        'This check does not mutate DNS, Cloudflare, Search Console, Supabase, Stripe, Google, Resend or application data.',
    ],
};

writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(path.join(outputDir, 'summary.md'), renderMarkdown(report), 'utf8');

console.log(`[launch:live-domain-readonly] Status: ${status}`);
console.log(`[launch:live-domain-readonly] Failed: ${failed.length}`);
console.log(`[launch:live-domain-readonly] Warnings: ${warnings.length}`);
console.log(`[launch:live-domain-readonly] Base URL: ${baseUrl}`);
console.log(`[launch:live-domain-readonly] Summary: ${path.join(outputDir, 'summary.md')}`);

if (failed.length > 0) process.exit(1);

function checkCanonicalDomain(): Check {
    const base = snapshots.get(baseUrl);
    const variantSnapshots = hostVariants.map((url) => snapshots.get(url)).filter(Boolean) as FetchSnapshot[];
    const baseHost = hostname(baseUrl);
    const details = [
        describeSnapshot('base', base),
        ...variantSnapshots.map((snapshot, index) => describeSnapshot(`variant_${index + 1}`, snapshot)),
    ];

    if (!base || !base.ok) {
        return {
            status: 'failed',
            name: 'canonical_domain_reachability',
            message: 'The configured production base URL is not reachable with a successful public GET.',
            details,
        };
    }

    const variantIssues = variantSnapshots.filter((snapshot) => {
        const finalHost = hostname(snapshot.finalUrl);
        return snapshot.ok && finalHost !== baseHost;
    });

    return {
        status: variantIssues.length > 0 ? 'warning' : 'ok',
        name: 'canonical_domain_reachability',
        message: variantIssues.length === 0
            ? 'Production base URL is publicly reachable and tested host variants resolve to the canonical host.'
            : 'Production base URL is reachable, but one or more tested host variants do not resolve to the canonical host.',
        details,
    };
}

function checkRobotsTxt(): Check {
    const snapshot = snapshots.get(absoluteUrl('/robots.txt'));
    const body = snapshot?.body ?? '';
    const required = [
        'User-agent: *',
        'Allow: /',
        'Disallow: /api/',
        'Disallow: /demo',
        'Sitemap:',
    ];
    const missing = required.filter((snippet) => !body.includes(snippet));

    return checkPublicTextResource({
        name: 'robots_txt',
        snapshot,
        okMessage: 'robots.txt is reachable and contains the expected public/private crawl controls.',
        warningMessage: 'robots.txt is reachable but does not contain all expected modern launch crawl controls.',
        missing,
    });
}

function checkSitemapIndex(): Check {
    const snapshot = snapshots.get(absoluteUrl('/sitemap-index.xml'));
    const body = snapshot?.body ?? '';
    const hasKnownPublicSitemap = body.includes('sitemap-public.xml') || body.includes('sitemap-0.xml');
    const missing = [
        ['<sitemapindex', body.includes('<sitemapindex')],
        ['<loc>', body.includes('<loc>')],
        ['sitemap-public.xml or sitemap-0.xml', hasKnownPublicSitemap],
    ].filter(([, ok]) => !ok).map(([snippet]) => snippet as string);

    return checkPublicTextResource({
        name: 'sitemap_index',
        snapshot,
        okMessage: 'sitemap-index.xml is reachable and points to the public sitemap.',
        warningMessage: 'sitemap-index.xml is reachable but does not look like the modern public sitemap index.',
        missing,
    });
}

function checkPublicSitemap(): Check {
    const candidates = [
        snapshots.get(absoluteUrl('/sitemap-public.xml')),
        snapshots.get(absoluteUrl('/sitemap-0.xml')),
    ].filter(Boolean) as FetchSnapshot[];
    const required = [
        '<urlset',
        '/es/espanol-para-vivir-en-espana',
        '/es/espanol-para-profesionales',
        '/es/clases-de-conversacion-en-espanol',
    ];
    const candidateResults = candidates.map((candidate) => {
        const body = candidate.body;
        const forbidden = ['/campus', '/api', '/demo', '/keystatic'].filter((snippet) => body.includes(snippet));
        const missing = required.filter((snippet) => !body.includes(snippet));
        return {
            candidate,
            issues: [...missing, ...forbidden.map((snippet) => `forbidden ${snippet}`)],
        };
    });
    const passing = candidateResults.find((result) => result.candidate.ok && result.issues.length === 0);

    if (passing) {
        return {
            status: 'ok',
            name: 'sitemap_public',
            message: 'A public sitemap is reachable, includes the key public segment routes and excludes private/demo/API routes.',
            details: [
                describeSnapshot('resource', passing.candidate),
                ...candidateResults
                    .filter((result) => result.candidate.requestedUrl !== passing.candidate.requestedUrl)
                    .map((result) => `alternate_${describeSnapshot('resource', result.candidate)} issues=${result.issues.join(' | ') || 'none'}`),
            ],
        };
    }

    return checkPublicTextResource({
        name: 'sitemap_public',
        snapshot: candidates.find((candidate) => candidate.ok) ?? candidates[0],
        okMessage: 'A public sitemap is reachable, includes the key public segment routes and excludes private/demo/API routes.',
        warningMessage: 'Reachable public sitemap candidates do not fully match the modern public sitemap expectations.',
        missing: candidateResults.flatMap((result) => {
            const label = new URL(result.candidate.requestedUrl).pathname;
            return result.issues.map((issue) => `${label}: ${issue}`);
        }),
    });
}

function checkLlmsTxt(): Check {
    const snapshot = snapshots.get(absoluteUrl('/llms.txt'));
    const body = snapshot?.body ?? '';
    const required = [
        {
            label: '# Español Honesto',
            ok: body.includes('# Espa\u00f1ol Honesto') || body.includes('# Espanol Honesto'),
        },
        { label: 'https://espanolhonesto.com/es', ok: body.includes('https://espanolhonesto.com/es') },
        { label: 'How To Apply', ok: body.includes('How To Apply') },
        { label: 'Do Not Use As Public Source Material', ok: body.includes('Do Not Use As Public Source Material') },
        { label: '/campus', ok: body.includes('/campus') },
        { label: '/api', ok: body.includes('/api') },
    ];
    const missing = required.filter((requirement) => !requirement.ok).map((requirement) => requirement.label);

    return checkPublicTextResource({
        name: 'llms_txt',
        snapshot,
        okMessage: 'llms.txt is reachable and contains the public assistant/source-boundary guidance.',
        warningMessage: 'llms.txt is reachable but does not fully match the modern assistant/source-boundary guidance.',
        missing,
    });
}

function checkPublicHtmlRoutes(): Check[] {
    const routes = publicPaths.filter((publicPath) => !publicPath.includes('.'));
    return routes.map((publicPath) => {
        const snapshot = snapshots.get(absoluteUrl(publicPath));
        if (!snapshot || !snapshot.ok) {
            return {
                status: publicPath === '/' ? 'warning' : 'failed',
                name: `public_route_${safeName(publicPath)}`,
                message: `Public route ${publicPath} is not reachable with a successful public GET.`,
                details: [describeSnapshot('route', snapshot)],
            };
        }

        const body = snapshot.body;
        const missing = [
            ['title', /<title>[^<]{8,}<\/title>/i.test(body)],
            ['meta_description', /<meta\s+name=["']description["']\s+content=["'][^"']{40,}/i.test(body)],
            ['canonical', /rel=["']canonical["']/i.test(body)],
            ['hreflang', /hreflang=["'](?:es|en|ru|x-default)["']/i.test(body)],
        ].filter(([, ok]) => !ok).map(([name]) => name as string);
        const hasMojibake = hasLikelyMojibake(body);

        return {
            status: missing.length === 0 && !hasMojibake ? 'ok' : 'warning',
            name: `public_route_${safeName(publicPath)}`,
            message: missing.length === 0 && !hasMojibake
                ? `Public route ${publicPath} is reachable and exposes basic modern SEO metadata.`
                : `Public route ${publicPath} is reachable but needs final SEO/metadata/rendering review.`,
            details: [
                describeSnapshot('route', snapshot),
                `missing=${missing.join(', ') || 'none'}`,
                `likely_mojibake=${hasMojibake}`,
            ],
        };
    });
}

function checkPublicTextResource(input: {
    name: string;
    snapshot: FetchSnapshot | undefined;
    okMessage: string;
    warningMessage: string;
    missing: string[];
}): Check {
    if (!input.snapshot || !input.snapshot.ok) {
        return {
            status: 'warning',
            name: input.name,
            message: `${input.name} is not reachable with a successful public GET on the tested domain.`,
            details: [describeSnapshot('resource', input.snapshot)],
        };
    }

    return {
        status: input.missing.length === 0 ? 'ok' : 'warning',
        name: input.name,
        message: input.missing.length === 0 ? input.okMessage : input.warningMessage,
        details: [
            describeSnapshot('resource', input.snapshot),
            `missing_or_unexpected=${input.missing.join(' | ') || 'none'}`,
        ],
    };
}

async function fetchSnapshot(url: string): Promise<FetchSnapshot> {
    try {
        const response = await fetch(url, {
            method: 'GET',
            redirect: 'follow',
            headers: {
                'User-Agent': 'EspanolHonesto-StrictQA-ReadOnly/1.0',
                Accept: 'text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.8',
            },
        });
        const contentType = response.headers.get('content-type') ?? '';
        const text = await response.text();
        return {
            requestedUrl: url,
            finalUrl: response.url,
            status: response.status,
            ok: response.ok,
            redirected: response.redirected,
            contentType,
            body: text.slice(0, 500_000),
        };
    } catch (error) {
        return {
            requestedUrl: url,
            finalUrl: url,
            status: null,
            ok: false,
            redirected: false,
            contentType: '',
            body: '',
            error: safeErrorMessage(error),
        };
    }
}

function absoluteUrl(publicPath: string): string {
    return new URL(publicPath, baseUrl).toString();
}

function normalizeBaseUrl(value: string): string {
    const withProtocol = value.includes('://') ? value : `https://${value}`;
    const url = new URL(withProtocol);
    url.pathname = '/';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
}

function hostname(value: string): string {
    try {
        return new URL(value).hostname.toLowerCase();
    } catch {
        return '';
    }
}

function describeSnapshot(label: string, snapshot: FetchSnapshot | undefined): string {
    if (!snapshot) return `${label}=missing`;
    return [
        `${label}_requested=${snapshot.requestedUrl}`,
        `${label}_status=${snapshot.status ?? 'error'}`,
        `${label}_final=${snapshot.finalUrl}`,
        `${label}_redirected=${snapshot.redirected}`,
        `content_type=${snapshot.contentType || 'unknown'}`,
        snapshot.error ? `error=${snapshot.error}` : '',
    ].filter(Boolean).join(' ');
}

function readArgValue(flag: string): string | null {
    const index = process.argv.indexOf(flag);
    if (index === -1) return null;
    const value = process.argv[index + 1];
    return value && !value.startsWith('--') ? value : null;
}

function readListArg(flag: string): string[] {
    const values: string[] = [];
    for (let index = 0; index < process.argv.length; index += 1) {
        if (process.argv[index] !== flag) continue;
        const value = process.argv[index + 1];
        if (value && !value.startsWith('--')) values.push(normalizeBaseUrl(value));
    }
    if (values.length > 0) return [...new Set(values)];
    const base = new URL(baseUrl);
    return [`${base.protocol}//www.${base.hostname}`];
}

function safeName(value: string): string {
    return value === '/' ? 'root' : value.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase();
}

function safeErrorMessage(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).replace(/\r?\n/g, ' ').slice(0, 400);
}

function hasLikelyMojibake(value: string): boolean {
    return [
        /\u00C3[\u0080-\u00BF\u2018-\u201D]?/,
        /\u00C2[\u0080-\u00BF\u00BF\u00A1]?/,
        /\u00E2(?:\u20AC[\u0080-\u00BF]?|[\u201E\u201C\u201D\u2019])/,
        /\u00D0[\u0080-\u00BF\u0400-\u04FF]?/,
        /\u00D1(?:[\u0080-\u00BF\u0400-\u04FF]|\u20AC)/,
        /\uFFFD/,
    ].some((pattern) => pattern.test(value));
}

function renderMarkdown(report: Report): string {
    const lines = [
        '# Live Domain Read-Only Evidence',
        '',
        `- Status: ${report.status}`,
        `- Started: ${report.startedAt}`,
        `- Ended: ${report.endedAt}`,
        `- Base URL: ${report.baseUrl}`,
        `- Output: ${report.outputDir}`,
        '',
        '## Scope',
        '',
        'This check fetches only public production-domain URLs with GET requests. It verifies reachability, canonical host behavior, robots, sitemap, llms.txt, basic metadata, hreflang and obvious encoding corruption. It does not submit forms, authenticate, write external services, mutate DNS, mutate Cloudflare, use Search Console, trigger analytics exports or store private data.',
        '',
        '## Checks',
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
    ];

    for (const check of report.checks) {
        lines.push(`| ${check.status} | ${check.name} | ${escapeCell(check.message)} | ${escapeCell((check.details ?? []).join(' / '))} |`);
    }

    lines.push('', '## Redaction', '');
    for (const item of report.redaction) {
        lines.push(`- ${item}`);
    }

    lines.push('');
    lines.push('## Final Closure Note');
    lines.push('');
    lines.push('This supports `seo_llm_final` and `integration_readiness` only as public-domain evidence. It does not replace final Search Console, Core Web Vitals, legal index-policy decision, payment-mode stability, premium Russian typography decision, Cloudflare dashboard evidence or final smoke.');
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function stamp(date: Date): string {
    return date.toISOString().replaceAll(':', '-').replaceAll('.', '-');
}
