import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
    applyVerifiedAuthConfigChange,
    exactApprovalMatched,
    PRODUCTION_AUTH_APPROVALS,
    productionDesiredPatch,
    safeErrorMessage,
    verifyExactSafePatch,
} from './supabase-auth-config-shared';
import {
    SUPABASE_CLI_WINDOWS_CREDENTIAL_TARGET,
    withSupabaseAuthManagementClient,
} from './supabase-cli-windows-credential';

type Phase = keyof typeof PRODUCTION_AUTH_APPROVALS;

const startedAt = new Date();
const phase = process.argv[2] as Phase | undefined;
const approval = phase ? PRODUCTION_AUTH_APPROVALS[phase] : undefined;
const executeRequested = process.argv.includes('--execute-approved');
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== phase && arg !== '--execute-approved');
const outputDir = path.join(
    process.cwd(),
    'outputs',
    'launch-supabase-auth-production-gate',
    stamp(startedAt),
);
const summaryPath = path.join(outputDir, 'summary.json');
mkdirSync(outputDir, { recursive: true });

if (!approval || !['inert', 'final'].includes(phase ?? '') || unknownArgs.length > 0) {
    finish({
        schemaVersion: 1,
        status: 'BLOCKED',
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        externalWritePerformed: false,
        error: 'Usage: pnpm exec tsx scripts/launch/supabase-auth-production-gate.ts <inert|final> [--execute-approved]',
    }, 1);
} else {
    const desiredPatch = productionDesiredPatch(phase);
    const approvalMatched = exactApprovalMatched(approval, process.argv, process.env);

    if (!executeRequested) {
        finish({
            schemaVersion: 1,
            status: 'PLAN_ONLY',
            startedAt: startedAt.toISOString(),
            endedAt: new Date().toISOString(),
            externalWritePerformed: false,
            phase,
            target: { environment: approval.environment, projectRef: approval.projectRef },
            desiredPatch,
            approvalGate: {
                envVar: approval.approvalEnvVar,
                exactSentence: approval.exactApprovalSentence,
                flag: '--execute-approved',
                matched: false,
            },
            credentialSource: SUPABASE_CLI_WINDOWS_CREDENTIAL_TARGET,
            credentialReadDeferred: true,
            rollback: 'Only disable_signup and mailer_autoconfirm are restored from the redacted GET baseline.',
        }, 0);
    } else if (!approvalMatched) {
        finish({
            schemaVersion: 1,
            status: 'BLOCKED',
            startedAt: startedAt.toISOString(),
            endedAt: new Date().toISOString(),
            externalWritePerformed: false,
            phase,
            target: { environment: approval.environment, projectRef: approval.projectRef },
            desiredPatch,
            approvalGate: {
                envVar: approval.approvalEnvVar,
                flag: '--execute-approved',
                matched: approvalMatched,
            },
            credentialReadDeferred: true,
            error: 'Exact approval did not match',
        }, 1);
    } else {
        try {
            const result = await withSupabaseAuthManagementClient(
                approval.projectRef,
                async (client) => await applyVerifiedAuthConfigChange({
                    client,
                    buildDesiredPatch: () => desiredPatch,
                    verifyDesired: verifyExactSafePatch,
                }),
            );
            const ok = result.status === 'applied' || result.status === 'already_applied';
            finish({
                schemaVersion: 1,
                redacted: true,
                status: ok ? 'OK' : 'FAILED',
                startedAt: startedAt.toISOString(),
                endedAt: new Date().toISOString(),
                externalWritePerformed: result.status !== 'already_applied',
                phase,
                target: { environment: approval.environment, projectRef: approval.projectRef },
                approvalMatched: true,
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
                phase,
                target: { environment: approval.environment, projectRef: approval.projectRef },
                approvalMatched: true,
                error: safeErrorMessage(error),
            }, 1);
        }
    }
}

function finish(payload: Record<string, unknown>, exitCode: number): void {
    writeFileSync(summaryPath, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`[launch:supabase-auth-production-gate] Status: ${String(payload.status)}`);
    console.log(`[launch:supabase-auth-production-gate] Summary: ${summaryPath}`);
    process.exitCode = exitCode;
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}
