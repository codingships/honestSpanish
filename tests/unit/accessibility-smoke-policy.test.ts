import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    ADULT_CONFIRMATION_PATH,
    classifyAuthLanding,
    describeStudentAdultGate,
} from '../../scripts/launch/accessibility-auth-policy';

describe('launch accessibility authentication policy', () => {
    it('accepts the adult gate only for a student who has not attested yet', () => {
        expect(classifyAuthLanding('student', ADULT_CONFIRMATION_PATH).kind).toBe('adult-gate');
        expect(classifyAuthLanding('teacher', ADULT_CONFIRMATION_PATH).kind).toBe('unexpected');
        expect(classifyAuthLanding('admin', ADULT_CONFIRMATION_PATH).kind).toBe('unexpected');
    });

    it('keeps direct campus audits for every role when its expected landing is reached', () => {
        expect(classifyAuthLanding('student', '/es/campus').kind).toBe('role-surface');
        expect(classifyAuthLanding('teacher', '/es/campus/teacher/').kind).toBe('role-surface');
        expect(classifyAuthLanding('admin', '/es/campus/admin').kind).toBe('role-surface');
        expect(classifyAuthLanding('student', '/es/campus/classes').kind).toBe('unexpected');
    });

    it('states exactly which student content was protected but not audited', () => {
        const scope = describeStudentAdultGate([
            '/es/campus',
            '/es/campus/classes',
            '/es/campus/support',
        ]);

        expect(scope).toContain('Axe audited /es/adult-confirmation');
        expect(scope).toContain('protected student route content was not audited');
        expect(scope).toContain('/es/campus/classes');
        expect(scope).toContain('already persisted is audited on those routes instead');
    });

    it('starts the fail-closed staging wrapper and never submits the adult attestation', () => {
        const source = readFileSync('scripts/launch/accessibility-smoke.ts', 'utf8');

        expect(source).toContain("['pnpm', 'dev', '--', '--host', '127.0.0.1', '--port', String(port)]");
        expect(source).not.toContain("['pnpm', 'exec', 'astro', 'dev'");
        expect(source).toContain('consecutiveReadyResponses >= 2');
        expect(source).toContain("new URL('/es', url)");
        expect(source).toContain("? 'adult-gate-audited'");
        expect(source).toContain('student route content not audited');
        expect(source).not.toContain('/api/auth/confirm-adult');
        expect(source).not.toMatch(/adult-confirmed[^\n]*\.check\(/u);
    });

    it('keeps the audited adult gate copy at an Axe-safe solid text contrast', () => {
        const page = readFileSync('src/pages/[lang]/adult-confirmation.astro', 'utf8');

        expect(page).not.toMatch(/text-\[#006064\]\/(?:60|70|75)/u);
        expect(page).toContain('tracking-widest text-[#006064]');
        expect(page).toContain('text-xs leading-5 text-[#006064]');
    });
});
