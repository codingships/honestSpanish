import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dashboard = readFileSync('src/pages/[lang]/campus/index.astro', 'utf8');
const classes = readFileSync('src/pages/[lang]/campus/classes.astro', 'utf8');
const account = readFileSync('src/pages/[lang]/campus/account.astro', 'utf8');

describe('student campus read truth', () => {
    it('uses maybeSingle only where a missing business row is legitimate', () => {
        expect(dashboard).toContain(".from('subscriptions')");
        expect(dashboard).toContain(".from('sessions')");
        expect(dashboard.match(/\.maybeSingle\(\)/g)?.length).toBeGreaterThanOrEqual(4);
        expect(account).toContain(".from('subscriptions')");
        expect(account.match(/\.maybeSingle\(\)/g)?.length).toBeGreaterThanOrEqual(2);
    });

    it('fails closed when auth or the required profile cannot be verified', () => {
        for (const source of [dashboard, classes, account]) {
            expect(source).toContain('error: authError');
            expect(source).toContain('resolveRequiredCampusQuery(profileResult)');
            expect(source).toContain("profileState.status !== 'ready'");
            expect(source).toContain("['student', 'teacher', 'admin'].includes(profile.role ?? '')");
            expect(source).toContain("{ code: 'PROFILE_ROLE_INVALID' }");
            expect(source).toContain('Astro.response.status = 503');
            expect(source).toContain('<BaseLayout');
            expect(source).toContain('<CampusLoadError');
        }
    });

    it('does not turn a failed sessions collection into empty class tabs', () => {
        expect(classes).toContain('resolveCampusCollectionQuery(sessionsResult)');
        expect(classes).toContain("sessionsState.status === 'error'");
        expect(classes).toContain("sessionsState.status === 'ready' ? sessionsState.data : []");

        const errorBranch = classes.indexOf("sessionsState.status === 'error' ?");
        const classList = classes.indexOf('<StudentClassList');
        expect(errorBranch).toBeGreaterThan(-1);
        expect(classList).toBeGreaterThan(errorBranch);
    });

    it('suppresses account purchase, Stripe and guarantee actions when subscription loading fails', () => {
        const errorBranch = account.indexOf("subscriptionState.status === 'error' ?");
        const purchaseLink = account.indexOf('href={`/${lang}/#planes`}');
        expect(errorBranch).toBeGreaterThan(-1);
        expect(purchaseLink).toBeGreaterThan(errorBranch);
        expect(account).toContain("subscriptionState.status === 'ready' && subscription");
        expect(account).toContain("profilePrivateState.status === 'error' ?");
    });

    it('loads independent dashboard reads concurrently and renders errors per surface', () => {
        expect(dashboard).toContain('await Promise.all([');
        expect(dashboard).toContain("['student_dashboard.subscription', subscriptionState]");
        expect(dashboard).toContain("['student_dashboard.next_session', nextSessionRowState]");
        expect(dashboard).toContain("['student_dashboard.assignment', assignmentState]");
        expect(dashboard).toContain("['student_dashboard.drive', profilePrivateState]");
        expect(dashboard).toContain("subscriptionState.status === 'error' ?");
        expect(dashboard).toContain("nextSessionRowState.status === 'error' ?");
        expect(dashboard).toContain("profilePrivateState.status === 'error' ?");

        const assignmentError = dashboard.indexOf("assignmentState.status === 'error' && (");
        const assignmentAlert = dashboard.indexOf(
            '<CampusLoadError lang={lang} title={onboardingCopy.teacher}',
            assignmentError,
        );
        expect(assignmentError).toBeGreaterThan(-1);
        expect(assignmentAlert).toBeGreaterThan(assignmentError);
    });

    it('derives academic progress from Checkout V2 facts instead of the reservation counter', () => {
        expect(dashboard).not.toContain('sessions_used');
        expect(dashboard).toContain('loadCheckoutV2ProgressForSubscription');
        expect(dashboard).toContain('resolveCheckoutV2AcademicProgress');
        expect(dashboard).toContain('cycleProgressTotals.consumed');
        expect(dashboard).toContain('cycleProgressTotals.total');
        expect(dashboard).toContain("cycleProgressPresentation?.state === 'inconsistent'");
        expect(dashboard).toContain('CHECKOUT_V2_PROGRESS_INCONSISTENT');
        expect(dashboard).toContain("cycleProgressState.status === 'error'");
        expect(dashboard).toContain("t('campus.dashboard.progressPending')");
        expect(dashboard).toContain("t('campus.dashboard.progressUnavailable')");
    });
});
