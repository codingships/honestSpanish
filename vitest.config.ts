/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    plugins: [react()],
    resolve: {
        // Astro provides this virtual module through its adapter. Vitest does
        // not load the Astro adapter, so tests use a process-env backed shim.
        alias: {
            'astro:env/server': fileURLToPath(new URL('./tests/mocks/astro-env-server.ts', import.meta.url)),
            'astro:middleware': fileURLToPath(new URL('./tests/mocks/astro-middleware.ts', import.meta.url)),
            'cloudflare:workers': fileURLToPath(new URL('./tests/mocks/cloudflare-workers.ts', import.meta.url)),
        },
    },
    test: {
        globals: true,
        environment: 'jsdom',
        environmentOptions: {
            jsdom: {
                url: 'http://localhost:3000',
            },
        },
        setupFiles: ['./tests/setup.ts'],
        include: ['tests/**/*.{test,spec}.{js,ts,tsx}'],
        exclude: ['tests/e2e/**/*', 'tests/load/**/*'],

        // Coverage is opt-in through `pnpm run test:coverage`.
        coverage: {
            provider: 'v8',
            enabled: false,

            // Multiple reporters for different use cases
            reporter: [
                'text',           // Console output
                'text-summary',   // Summary in console
                'html',           // HTML report in coverage/
                'json',           // JSON for CI integration
                'lcov',           // For coverage badges/services
            ],

            // Output directory
            reportsDirectory: './coverage',

            // What to include in coverage
            include: [
                'src/**/*.{ts,tsx}',
                'src/lib/**/*.ts',
                'src/components/**/*.tsx',
            ],

            // What to exclude from coverage
            exclude: [
                'src/**/*.astro',
                'src/content/**/*',
                'src/**/*.d.ts',
                'src/env.d.ts',
                'src/middleware.ts',
                'src/pages/og/**/*',
                'src/pages/sitemap-public.xml.ts',
                'src/pages/**/rss.xml.ts',
                'src/types/**/*',
                '**/node_modules/**',
                '**/tests/**',
            ],

            // Coverage thresholds (fail if below)
            // Baseline reflects the new test suite: real logic tested,
            // intentionally untested: Google/Stripe integrations, email, cron, middleware
            thresholds: {
                statements: 14,
                branches: 13,
                functions: 14,
                lines: 14,
            },



            // Clean coverage before running
            clean: true,
        },
    },
});
