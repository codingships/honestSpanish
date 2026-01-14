/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
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

        // Enhanced coverage configuration
        coverage: {
            provider: 'v8',
            enabled: true,

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
                'src/types/**/*',
                '**/node_modules/**',
                '**/tests/**',
            ],

            // Coverage thresholds (fail if below)
            thresholds: {
                statements: 50,
                branches: 40,
                functions: 50,
                lines: 50,
            },

            // Show uncovered lines in console
            all: true,

            // Clean coverage before running
            clean: true,
        },
    },
});
