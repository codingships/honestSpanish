import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    PRODUCTION_PROJECT,
    STAGING_ONLY_VERSION,
    mapMigrationHistory,
    normalizeMigrationName,
    type LocalMigration,
} from '../../scripts/launch/supabase-production-rollout-shared';

const preflightSource = readFileSync('scripts/launch/supabase-production-readonly-preflight.ts', 'utf8');
const planSource = readFileSync('scripts/launch/supabase-production-rollout-plan.ts', 'utf8');
const sharedSource = readFileSync('scripts/launch/supabase-production-rollout-shared.ts', 'utf8');
const packageJson = readFileSync('package.json', 'utf8');
const runbook = readFileSync('docs/launch/RUNBOOK.md', 'utf8');
const environment = readFileSync('docs/launch/ENVIRONMENT.md', 'utf8');
const checklist = readFileSync('docs/launch/CHECKLIST.md', 'utf8');

describe('Supabase production rollout safety', () => {
    it('maps one semantic migration alias without pretending the canonical version is exact', () => {
        const local = migration('021', 'harden_session_write_policies');
        const [mapped] = mapMigrationHistory([local], [{
            version: '20260703192245',
            name: 'harden_session_write_policies',
        }]);

        expect(mapped.historyStatus).toBe('alias');
        expect(mapped.remoteVersions).toEqual(['20260703192245']);
    });

    it('prefers an exact canonical version and fails closed on ambiguous semantic aliases', () => {
        const local = migration('022', 'track_stripe_webhook_processing_state');
        expect(mapMigrationHistory([local], [{
            version: '022',
            name: 'track_stripe_webhook_processing_state',
        }])[0].historyStatus).toBe('exact');

        expect(mapMigrationHistory([local], [
            { version: '20260703192307', name: 'track_stripe_webhook_processing_state' },
            { version: '20260703192308', name: 'track-stripe-webhook-processing-state' },
        ])[0].historyStatus).toBe('ambiguous');
    });

    it('preserves version/name collisions and duplicate semantic entries as explicit hazards', () => {
        const local = migration('009', 'launch_catalog_and_fulfillment');
        const [mapped] = mapMigrationHistory([local], [
            { version: '009', name: 'jobs' },
            { version: '20260701000000', name: 'launch_catalog_and_fulfillment' },
        ]);

        expect(mapped.historyStatus).toBe('exact');
        expect(mapped.versionNameMismatch).toBe(true);
        expect(mapped.duplicateSemanticHistory).toBe(true);
        expect(mapped.remoteVersions).toEqual(['009', '20260701000000']);
    });

    it('normalizes only migration naming syntax, not arbitrary versions', () => {
        expect(normalizeMigrationName('20260703192307_track-stripe webhook processing state.sql'))
            .toBe('track_stripe_webhook_processing_state');
    });

    it('locks the read-only preflight to the exact production project and aggregate-only SQL', () => {
        for (const snippet of [
            "default_transaction_read_only=on",
            "spawnSync('psql'",
            "'-w'",
            "'ON_ERROR_STOP=1'",
            'remote_migrations',
            'fixture_counts',
            'billing_legacy_hazard',
            'billing_package_price_links',
            'baseline_history_effects',
            'baseline_alias_effect_verification',
            'processed_at_posture',
            'no row identifiers, emails, Stripe IDs, payloads or secret values selected',
        ]) {
            expect(preflightSource).toContain(snippet);
        }

        expect(sharedSource).toContain(PRODUCTION_PROJECT.ref);

        expect(preflightSource).not.toContain('select email');
        expect(preflightSource).not.toContain('stripe_subscription_id as');
        expect(preflightSource).not.toContain('processing_error as');
    });

    it('keeps the rollout runner local-only and separates every write gate', () => {
        for (const snippet of [
            'PLAN_ONLY_READY',
            'networkAccessPerformed: false',
            'externalWritePerformed: false',
            'cleanupSqlGenerated: false',
            'applySqlBundleGenerated: false',
            'backup-evidence-receipt.template.json',
            'fixture-preservation-policy.template.json',
            'approval-sentences.md',
            'verification-and-rollback.md',
            "regexp_replace(coalesce(remote.name, ''), '^[0-9]+_', '')",
            'remote_versions',
            'processed_at_small_fix',
            'base_model_reconciliation',
            'destructiveFixtureCleanup',
            'billing_contract',
            'assessProcessedAtPosture',
            'assessBillingPackagePriceLinks',
            'readStrictStagingHardeningEvidence',
            'STAGING_HARDENING_CONNECTOR_QUERY_PATH',
            "values[0] === '--' ? values.slice(1) : values",
            'missing or incomplete processed_at_posture and billing_package_price_links aggregates as hard blockers',
            "wave.id !== 'processed_at_small_fix' || processedReady || processedAlreadyClosed",
            "processed?.gateStatus === 'ready'",
            'BLOQUEADO: no existe una autorizacion ejecutable para processed_at',
            'supabase db push',
            'supabase migration repair',
        ]) {
            expect(planSource).toContain(snippet);
        }

        expect(sharedSource).toContain(STAGING_ONLY_VERSION);

        expect(planSource).not.toContain("spawnSync('");
        expect(planSource).not.toContain('execSync(');
        expect(planSource).not.toContain('DELETE FROM public.');
        expect(planSource).not.toContain('TRUNCATE TABLE public.');
        expect(planSource).not.toContain('staging-hardening-evidence.template.json');
        expect(planSource).not.toContain('modelContractVerified');
        expect(planSource).not.toContain('stagingCleanupVerified');
    });

    it('exposes planning and executable gates through pnpm-only package scripts', () => {
        expect(packageJson).toContain('"launch:supabase-production-readonly-preflight": "tsx scripts/launch/supabase-production-readonly-preflight.ts"');
        expect(packageJson).toContain('"launch:supabase-production-rollout-plan": "tsx scripts/launch/supabase-production-rollout-plan.ts"');
        expect(packageJson).toContain('"launch:supabase-production-logical-backup": "tsx scripts/launch/supabase-production-logical-backup.ts"');
        expect(packageJson).toContain('"launch:supabase-production-fixture-cleanup": "tsx scripts/launch/production-fixture-cleanup-runner.ts"');
        expect(packageJson).toContain('"launch:supabase-production-auth-cleanup": "tsx scripts/launch/supabase-production-auth-cleanup.ts"');
        expect(packageJson).toContain('"launch:supabase-production-rollout": "tsx scripts/launch/supabase-production-rollout-runner.ts"');
    });

    it('keeps the current launch sources aligned with the gated production rollout', () => {
        for (const document of [runbook, environment, checklist]) {
            expect(document).toContain('launch:supabase-production-readonly-preflight');
            expect(document).toContain('launch:supabase-production-rollout-plan');
            expect(document).toContain(PRODUCTION_PROJECT.ref);
            expect(document).toContain(STAGING_ONLY_VERSION);
            expect(document).toContain('supabase migration repair');
        }

        expect(runbook).toContain('Rollout Supabase Production Inerte');
        expect(runbook).toContain('launch:supabase-production-logical-backup');
        expect(runbook).toContain('launch:supabase-production-fixture-cleanup');
        expect(runbook).toContain('launch:supabase-production-auth-cleanup');
        expect(runbook).toContain('launch:supabase-production-rollout');
        expect(runbook).toContain('public-cleanup-receipt.json');
        expect(runbook).toContain('auth-reduced-quarantined-receipt.json');
        expect(runbook).toContain('production-rollout-receipt.json');
        expect(runbook).toContain('deferred_rc_hardening');
    });
});

function migration(version: string, name: string): LocalMigration {
    return {
        order: 1,
        version,
        name,
        file: `supabase/migrations/${version}_${name}.sql`,
        sha256: 'a'.repeat(64),
        bytes: 1,
        stagingOnly: version === STAGING_ONLY_VERSION,
        plannedWave: null,
    };
}
