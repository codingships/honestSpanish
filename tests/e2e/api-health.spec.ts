import { test, expect } from '@playwright/test';

test.describe('API Health Checks', () => {
    test('create-checkout should reject unauthenticated requests', async ({ request }) => {
        const response = await request.post('/api/create-checkout', {
            data: { priceId: 'price_123', lang: 'es' },
        });

        expect(response.status()).toBe(401);
    });

    test('assign-teacher should reject unauthenticated requests', async ({ request }) => {
        const response = await request.post('/api/admin/assign-teacher', {
            data: { studentId: 'student-1', teacherId: 'teacher-1' },
        });

        expect(response.status()).toBe(401);
    });

    test('update-profile should reject unauthenticated requests', async ({ request }) => {
        const response = await request.post('/api/account/update-profile', {
            data: { fullName: 'Test' },
        });

        expect(response.status()).toBe(401);
    });
});
