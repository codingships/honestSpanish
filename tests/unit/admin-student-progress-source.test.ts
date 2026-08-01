import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const detail = readFileSync(
    'src/pages/[lang]/campus/admin/student/[id].astro',
    'utf8',
);

describe('admin student academic progress source contract', () => {
    it('never presents the operational reservation counter as academic progress', () => {
        expect(detail).not.toContain('sessions_used');
        expect(detail).toContain('Clases consumidas');
    });

    it('loads all Checkout V2 cycle history in one batch', () => {
        expect(detail).toContain('loadCheckoutV2ProgressHistory');
        expect(detail).toContain('checkoutV2SubscriptionIds');
        expect(detail.match(/await loadCheckoutV2ProgressHistory\(/g)).toHaveLength(1);
        expect(detail).toContain('subscriptionCycleHistory');
        expect(detail).toContain('progress?.cycle_number');
    });

    it('renders only ready totals and distinguishes pending and legacy history', () => {
        expect(detail).toContain('resolveCheckoutV2AcademicProgress');
        expect(detail).toContain("academicProgress.state === 'ready'");
        expect(detail).toContain('academicProgress.consumed');
        expect(detail).toContain('academicProgress.total');
        expect(detail).toContain("academicProgress.state === 'pending'");
        expect(detail).toContain("t('campus.dashboard.progressPending')");
        expect(detail).toContain("t('campus.dashboard.progressUnavailable')");
    });

    it('fails closed for a missing, inconsistent or unreadable Checkout V2 cycle', () => {
        expect(detail).toContain('cycleProgressLoadError');
        expect(detail).toContain('cycleProgressContractError');
        expect(detail).toContain('CHECKOUT_V2_PROGRESS_INCONSISTENT');
        expect(detail).toContain('reportCampusReadError');
        expect(detail).toContain('Astro.response.status = 503');
        expect(detail).toContain('<CampusLoadError');
        expect(detail).toContain("reportCampusReadError('admin_student.subscription'");
        expect(detail.indexOf('{subscriptionError ?')).toBeLessThan(
            detail.indexOf(': subscription ?'),
        );
    });
});
