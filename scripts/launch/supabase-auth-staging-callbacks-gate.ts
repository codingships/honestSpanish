import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
    allowListExactlyMatches,
    applyVerifiedAuthConfigChange,
    exactApprovalMatched,
    mergeUriAllowList,
    safeErrorMessage,
    STAGING_AUTH_CALLBACKS,
    STAGING_CALLBACKS_APPROVAL,
    SUPABASE_ACCESS_TOKEN_ENV,
} from './supabase-auth-config-shared';

const startedAt = new Date();
const executeRequested = process.argv.includes('--execute-approved');
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== '--execute-approved');
const approval = STAGING_CALLBACKS_APPROVAL;
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
            callbacks: STAGING_AUTH_CALLBACKS,
            approvalGate: {
                envVar: approval.approvalEnvVar,
                exactSentence: approval.exactApprovalSentence,
                flag: '--execute-approved',
                matched: false,
            },
            tokenAvailable: Boolean(token),
            preservation: 'Every existing uri_allow_list entry is retained; only the three exact callbacks are added once.',
            rollback: 'The exact prior uri_allow_list string from the redacted GET baseline is restored on failure.',
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
                    uri_allow_list: mergeUriAllowList(before.uri_allow_list, STAGING_AUTH_CALLBACKS),
                }),
                verifyDesired: (before, after, desiredPatch) => (
                    after.disable_signup === before.disable_signup
                    && after.mailer_autoconfirm === before.mailer_autoconfirm
                    && after.site_url === before.site_url
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
                callbacks: STAGING_AUTH_CALLBACKS,
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
