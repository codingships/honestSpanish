import { describe, expect, it } from 'vitest';
import {
    requiredAdminActorCapabilityForRequest,
    requiredAdminCapabilityForCampusPath,
    requiredAdminCapabilityForRequest,
} from '../../src/lib/admin-route-capabilities';

describe('administrator route capability map', () => {
    it.each([
        ['/api/admin/packages', 'GET', 'catalog.read'],
        ['/api/admin/packages', 'POST', 'catalog.write'],
        ['/api/admin/catalog-v2', 'GET', 'catalog.read'],
        ['/api/admin/catalog-v2', 'POST', 'catalog.write'],
        ['/api/admin/content', 'GET', 'content.read'],
        ['/api/admin/content', 'POST', 'content.write'],
        ['/api/admin/access', 'GET', 'access.read'],
        ['/api/admin/access', 'POST', 'access.write'],
        ['/api/admin/audit', 'GET', 'access.read'],
        ['/api/admin/profitability', 'GET', 'finance.read'],
        ['/api/admin/guarantees', 'POST', 'finance.write'],
        ['/api/admin/support-tickets', 'GET', 'operations.read'],
        ['/api/admin/support-tickets', 'POST', 'operations.write'],
        ['/api/admin/staff-invitations', 'POST', 'operations.write'],
        ['/api/email/preview-frame', 'GET', 'content.read'],
        ['/api/email/send-test', 'POST', 'content.write'],
    ])('%s %s requires %s', (path, method, capability) => {
        expect(requiredAdminCapabilityForRequest(path, method)).toBe(capability);
    });

    it.each([
        ['/api/calendar/sessions', 'POST'],
        ['/api/drive/append-homework', 'POST'],
        ['/api/example', 'GET'],
        ['/en', 'GET'],
    ])('does not classify shared or public route %s %s as administrator-only', (path, method) => {
        expect(requiredAdminCapabilityForRequest(path, method)).toBeNull();
    });

    it.each([
        ['/es/campus/admin', 'dashboard.read'],
        ['/en/campus/admin/packages', 'catalog.read'],
        ['/ru/campus/admin/emails', 'content.read'],
        ['/en/campus/admin/content', 'content.read'],
        ['/en/campus/admin/content/preview/example', 'content.read'],
        ['/es/campus/admin/access', 'access.read'],
        ['/es/campus/admin/audit', 'access.read'],
        ['/es/campus/admin/payments', 'finance.read'],
        ['/es/campus/admin/teachers', 'operations.read'],
    ])('%s requires %s to render', (path, capability) => {
        expect(requiredAdminCapabilityForCampusPath(path)).toBe(capability);
    });

    it.each([
        ['/api/calendar/sessions', 'GET', 'operations.read'],
        ['/api/calendar/sessions', 'POST', 'operations.write'],
        ['/api/calendar/session-action', 'POST', 'operations.write'],
        ['/api/teacher/availability', 'GET', 'operations.read'],
        ['/api/teacher/compensation-export', 'GET', 'finance.read'],
        ['/api/drive/append-homework', 'POST', 'operations.write'],
    ])('requires %s only from an admin actor on %s %s', (path, method, capability) => {
        expect(requiredAdminActorCapabilityForRequest(path, method)).toBe(capability);
    });
});
