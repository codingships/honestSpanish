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

    it('sends no-plan students to real availability while keeping contact secondary', () => {
        expect(campusDashboardSource).toContain("viewPlaces: 'View places'");
        expect(campusDashboardSource).toContain('href: `/${lang}/#planes`');
        expect(campusDashboardSource).toContain('href={`/${lang}/#planes`}');
        expect(campusDashboardSource).toContain('{onboardingCopy.viewPlaces}');
        expect(campusDashboardSource).toContain('href={`/${lang}/#contacto`}');
        expect(campusDashboardSource).toContain('{onboardingCopy.contact}');
        expect(campusDashboardSource).not.toContain('Apply for a place');
    });
});
