import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const campusDashboardSource = readFileSync('src/pages/[lang]/campus/index.astro', 'utf8');

describe('student campus onboarding surface', () => {
    it('keeps post-payment onboarding visible for teacher, materials, first class and support', () => {
        expect(campusDashboardSource).toContain("type AssignedTeacher");
        expect(campusDashboardSource).toContain(".from('student_teachers')");
        expect(campusDashboardSource).toContain('Teacher for your place');
        expect(campusDashboardSource).toContain('Drive folder prepared');
        expect(campusDashboardSource).toContain('Dates for your place');
        expect(campusDashboardSource).toContain('Support available');
        expect(campusDashboardSource).toContain('Your teacher is shown with the place you choose');
        expect(campusDashboardSource).toContain('Your dates are shown with the place you choose');
        expect(campusDashboardSource).not.toContain('We coordinate availability manually');
        expect(campusDashboardSource).not.toContain('Assigned before we coordinate the first class');
        expect(campusDashboardSource).toContain('alwaysShowAction: true');
    });

    it('sends no-plan students to real availability while keeping contact secondary', () => {
        expect(campusDashboardSource).toContain("viewPlaces: 'View places'");
        expect(campusDashboardSource).toContain("planStatus === 'unavailable' ? retryHref : `/${lang}/#planes`");
        expect(campusDashboardSource).toContain('href={`/${lang}/#planes`}');
        expect(campusDashboardSource).toContain('{onboardingCopy.viewPlaces}');
        expect(campusDashboardSource).toContain('href={`/${lang}/#contacto`}');
        expect(campusDashboardSource).toContain('{onboardingCopy.contact}');
        expect(campusDashboardSource).not.toContain('Apply for a place');
    });

    it('keeps unavailable reads distinct from pending onboarding work', () => {
        expect(campusDashboardSource).toContain("status: 'ready' | 'pending' | 'unavailable'");
        expect(campusDashboardSource).toContain("subscriptionState.status === 'error'");
        expect(campusDashboardSource).toContain("assignmentState.status === 'error'");
        expect(campusDashboardSource).toContain("profilePrivateState.status === 'error'");
        expect(campusDashboardSource).toContain("nextSessionRowState.status === 'error'");
        expect(campusDashboardSource).toContain("t('campus.loadError.retry')");
        expect(campusDashboardSource).toContain('<CampusLoadError');
        expect(campusDashboardSource).not.toContain('// Fail gracefully');
    });
});
