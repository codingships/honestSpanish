import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
    getSafeAuthConfig,
    redactedPreflight,
    safeErrorMessage,
    SUPABASE_ACCESS_TOKEN_ENV,
    SUPABASE_AUTH_TARGETS,
} from './supabase-auth-config-shared';

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
    const token = process.env[SUPABASE_ACCESS_TOKEN_ENV]?.trim() ?? '';
    if (!token) {
        finish({
            schemaVersion: 1,
            status: 'BLOCKED',
            startedAt: startedAt.toISOString(),
            endedAt: new Date().toISOString(),
            externalWritePerformed: false,
            target,
            error: `Missing ${SUPABASE_ACCESS_TOKEN_ENV}`,
        }, 1);
    } else {
        try {
            const config = await getSafeAuthConfig({ projectRef: target.projectRef, token });
            finish({
                ...redactedPreflight(target, config),
                status: 'OK',
                startedAt: startedAt.toISOString(),
                endedAt: new Date().toISOString(),
                externalWritePerformed: false,
            }, 0);
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
