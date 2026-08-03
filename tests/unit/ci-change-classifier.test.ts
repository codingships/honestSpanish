import { describe, expect, it } from 'vitest';
import { classifyChangedPaths } from '../../scripts/ci/classify-changes';

describe('CI change classifier', () => {
    it('keeps documentation-only changes on the lightweight safety path', () => {
        expect(classifyChangedPaths([
            'AGENTS.md',
            'docs/PRODUCT.md',
            '.github/pull_request_template.md',
        ])).toEqual({ application: false, browser: false, database: false });
    });

    it('runs only the database contract for isolated schema work', () => {
        expect(classifyChangedPaths([
            'db/schema.sql',
            'supabase/migrations/20260803000000_example.sql',
            'tests/sql/example.sql',
        ])).toEqual({ application: false, browser: false, database: true });
    });

    it('does not pay the browser cost for server-only tooling', () => {
        expect(classifyChangedPaths([
            'workers/fulfillment/src/index.ts',
            'tests/unit/fulfillment-worker.test.ts',
        ])).toEqual({ application: true, browser: false, database: false });
    });

    it('runs application and browser verification for public runtime changes', () => {
        expect(classifyChangedPaths([
            'src/pages/index.astro',
            'public/favicon.svg',
        ])).toEqual({ application: true, browser: true, database: false });
    });

    it('fails closed for an empty diff or a change to the classifier contract', () => {
        expect(classifyChangedPaths([])).toEqual({ application: true, browser: true, database: true });
        expect(classifyChangedPaths(['.github/workflows/ci.yml']))
            .toEqual({ application: true, browser: true, database: true });
        expect(classifyChangedPaths(['.github/workflows/deploy-staging.yml']))
            .toEqual({ application: true, browser: true, database: true });
    });
});
