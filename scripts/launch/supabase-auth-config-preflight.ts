import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
    createProductionAuthInertReceipt,
    getSafeAuthConfig,
    productionAuthConfigIsInert,
    redactedPreflight,
    safeErrorMessage,
    SUPABASE_AUTH_TARGETS,
} from './supabase-auth-config-shared';
import { withSupabaseAuthManagementClient } from './supabase-cli-windows-credential';

type TargetName = keyof typeof SUPABASE_AUTH_TARGETS;

const startedAt = new Date();
const targetName = process.argv[2] as TargetName | undefined;
const target = targetName ? SUPABASE_AUTH_TARGETS[targetName] : undefined;
const outputDir = path.join(
    process.cwd(),
    'outputs',
    'launch-supabase-auth-config-preflight',
    stamp(startedAt),
);
const summaryPath = path.join(outputDir, 'summary.json');
mkdirSync(outputDir, { recursive: true });

if (!target || !['staging', 'production'].includes(targetName ?? '') || process.argv.length !== 3) {
    finish({
        schemaVersion: 1,
        status: 'BLOCKED',
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        externalWritePerformed: false,
        error: 'Usage: pnpm exec tsx scripts/launch/supabase-auth-config-preflight.ts <staging|production>',
    }, 1);
} else {
    try {
        const config = await withSupabaseAuthManagementClient(
            target.projectRef,
            async (client) => await getSafeAuthConfig(client),
        );
        const observedAt = new Date();
        const productionAuthInert = targetName === 'production' && productionAuthConfigIsInert(config);
        const receiptPath = productionAuthInert
            ? path.join(outputDir, 'auth-inert-receipt.json')
            : null;
        if (receiptPath) {
            writeFileSync(
                receiptPath,
                `${JSON.stringify(createProductionAuthInertReceipt(config, observedAt), null, 2)}\n`,
                'utf8',
            );
        }
        finish({
            ...redactedPreflight(target, config),
            status: targetName === 'production'
                ? productionAuthInert ? 'AUTH_INERT_VERIFIED' : 'AUTH_NOT_INERT'
                : 'OK',
            startedAt: startedAt.toISOString(),
            endedAt: observedAt.toISOString(),
            authInertReceiptIssued: productionAuthInert,
            authInertReceiptFile: receiptPath ? path.basename(receiptPath) : null,
            externalWritePerformed: false,
        }, targetName === 'production' && !productionAuthInert ? 2 : 0);
    } catch (error) {
        finish({
            schemaVersion: 1,
            redacted: true,
            status: 'FAILED',
            startedAt: startedAt.toISOString(),
            endedAt: new Date().toISOString(),
            externalWritePerformed: false,
            target,
            error: safeErrorMessage(error),
        }, 1);
    }
}

function finish(payload: Record<string, unknown>, exitCode: number): void {
    writeFileSync(summaryPath, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`[launch:supabase-auth-config-preflight] Status: ${String(payload.status)}`);
    console.log(`[launch:supabase-auth-config-preflight] Summary: ${summaryPath}`);
    process.exitCode = exitCode;
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}
