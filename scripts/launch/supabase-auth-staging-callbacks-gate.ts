import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
    allowListExactlyMatches,
    applyVerifiedAuthConfigChange,
    exactApprovalMatched,
    mergeUriAllowList,
    safeErrorMessage,
    STAGING_AUTH_REDIRECTS,
    STAGING_AUTH_URLS_APPROVAL,
    STAGING_SITE_URL,
    SUPABASE_ACCESS_TOKEN_ENV,
} from './supabase-auth-config-shared';

const startedAt = new Date();
const executeRequested = process.argv.includes('--execute-approved');
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== '--execute-approved');
const approval = STAGING_AUTH_URLS_APPROVAL;
const outputDir = path.join(
    process.cwd(),
    'outputs',
    'launch-supabase-auth-staging-callbacks-gate',
    stamp(startedAt),
);
const summaryPath = path.join(outputDir, 'summary.json');
mkdirSync(outputDir, { recursive: true });

if (unknownArgs.length > 0) {
    finish({
        schemaVersion: 1,
        status: 'BLOCKED',
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        externalWritePerformed: false,
        error: 'Usage: pnpm exec tsx scripts/launch/supabase-auth-staging-callbacks-gate.ts [--execute-approved]',
    }, 1);
} else {
    const approvalMatched = exactApprovalMatched(approval, process.argv, process.env);
    const token = process.env[SUPABASE_ACCESS_TOKEN_ENV]?.trim() ?? '';

    if (!executeRequested) {
        finish({
            schemaVersion: 1,
            status: 'PLAN_ONLY',
            startedAt: startedAt.toISOString(),
            endedAt: new Date().toISOString(),
            externalWritePerformed: false,
            target: { environment: approval.environment, projectRef: approval.projectRef },
            siteUrl: STAGING_SITE_URL,
            redirects: STAGING_AUTH_REDIRECTS,
            approvalGate: {
                envVar: approval.approvalEnvVar,
                exactSentence: approval.exactApprovalSentence,
                flag: '--execute-approved',
                matched: false,
            },
            tokenAvailable: Boolean(token),
            preservation: 'site_url is pinned to the canonical staging origin. Every existing exact uri_allow_list entry is retained; the six exact confirmation and reset-password redirects are added once.',
            wildcardPolicy: 'Execution fails before PATCH if any existing or required redirect contains broad Supabase glob syntax.',
            rollback: 'The exact prior site_url and uri_allow_list values from the redacted GET baseline are restored on failure.',
        }, 0);
    } else if (!approvalMatched || !token) {
        finish({
            schemaVersion: 1,
            status: 'BLOCKED',
            startedAt: startedAt.toISOString(),
            endedAt: new Date().toISOString(),
            externalWritePerformed: false,
            target: { environment: approval.environment, projectRef: approval.projectRef },
            approvalGate: {
                envVar: approval.approvalEnvVar,
                flag: '--execute-approved',
                matched: approvalMatched,
            },
            tokenAvailable: Boolean(token),
            error: !approvalMatched ? 'Exact approval did not match' : `Missing ${SUPABASE_ACCESS_TOKEN_ENV}`,
        }, 1);
    } else {
        try {
            const result = await applyVerifiedAuthConfigChange({
                projectRef: approval.projectRef,
                token,
                buildDesiredPatch: (before) => ({
                    site_url: STAGING_SITE_URL,
                    uri_allow_list: mergeUriAllowList(before.uri_allow_list, STAGING_AUTH_REDIRECTS),
                }),
                verifyDesired: (before, after, desiredPatch) => (
                    after.disable_signup === before.disable_signup
                    && after.mailer_autoconfirm === before.mailer_autoconfirm
                    && desiredPatch.site_url === STAGING_SITE_URL
                    && after.site_url === STAGING_SITE_URL
                    && typeof desiredPatch.uri_allow_list === 'string'
                    && allowListExactlyMatches(after.uri_allow_list, desiredPatch.uri_allow_list)
                ),
                verifyRollback: (before, after) => (
                    after.disable_signup === before.disable_signup
                    && after.mailer_autoconfirm === before.mailer_autoconfirm
                    && after.site_url === before.site_url
                    && allowListExactlyMatches(after.uri_allow_list, before.uri_allow_list)
                ),
            });
            const ok = result.status === 'applied' || result.status === 'already_applied';
            finish({
                schemaVersion: 1,
                redacted: true,
                status: ok ? 'OK' : 'FAILED',
                startedAt: startedAt.toISOString(),
                endedAt: new Date().toISOString(),
                externalWritePerformed: result.status !== 'already_applied',
                target: { environment: approval.environment, projectRef: approval.projectRef },
                approvalMatched: true,
                siteUrl: STAGING_SITE_URL,
                redirects: STAGING_AUTH_REDIRECTS,
                wildcardPolicy: 'exact_only',
                change: result,
            }, ok ? 0 : 1);
        } catch (error) {
            finish({
                schemaVersion: 1,
                redacted: true,
                status: 'FAILED',
                startedAt: startedAt.toISOString(),
                endedAt: new Date().toISOString(),
                externalWritePerformed: false,
                target: { environment: approval.environment, projectRef: approval.projectRef },
                approvalMatched: true,
                error: safeErrorMessage(error),
            }, 1);
        }
    }
}

function finish(payload: Record<string, unknown>, exitCode: number): void {
    writeFileSync(summaryPath, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`[launch:supabase-auth-staging-callbacks-gate] Status: ${String(payload.status)}`);
    console.log(`[launch:supabase-auth-staging-callbacks-gate] Summary: ${summaryPath}`);
    process.exitCode = exitCode;
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}
