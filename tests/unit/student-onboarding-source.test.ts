import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const campusDashboardSource = readFileSync('src/pages/[lang]/campus/index.astro', 'utf8');

describe('student campus onboarding surface', () => {
    it('keeps post-payment onboarding visible for teacher, materials, first class and support', () => {
        expect(campusDashboardSource).toContain("type AssignedTeacher");
        expect(campusDashboardSource).toContain(".from('student_teachers')");
        expect(campusDashboardSource).toContain('Teacher assigned');
        expect(campusDashboardSource).toContain('Drive folder prepared');
        expect(campusDashboardSource).toContain('First class scheduled');
        expect(campusDashboardSource).toContain('Support available');
        expect(campusDashboardSource).toContain('We coordinate availability manually');
        expect(campusDashboardSource).toContain('alwaysShowAction: true');
    });

    it('keeps no-plan campus CTAs application-first while checkout live is final-only', () => {
        expect(campusDashboardSource).toContain("requestPlace: 'Apply for a place'");
        expect(campusDashboardSource).toContain('href: `/${lang}#contacto`');
        expect(campusDashboardSource).toContain('href={`/${lang}#contacto`}');
        expect(campusDashboardSource).toContain('{onboardingCopy.requestPlace}');
        expect(campusDashboardSource).not.toContain('href: `/${lang}/#pricing`');
        expect(campusDashboardSource).not.toContain('href={`/${lang}/#pricing`}');
    });
});
