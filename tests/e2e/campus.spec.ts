import { test, expect } from '@playwright/test';

test.describe('Campus (requires auth)', () => {
    // These tests require authentication setup
    // Skip if no test credentials available

    test.skip('should show student dashboard after login', async ({ page }) => {
        // Login first
        await page.goto('/es/login');
        await page.fill('input[type="email"]', 'test-student@example.com');
        await page.fill('input[type="password"]', 'testpassword123');
        await page.click('button[type="submit"]');

        // Should be on campus
        await expect(page).toHaveURL(/\/campus/);

        // Should show dashboard content
        await expect(page.locator('text=/panel|dashboard/i')).toBeVisible();
    });

    test.skip('admin should see admin dashboard', async ({ page }) => {
        await page.goto('/es/login');
        await page.fill('input[type="email"]', 'admin@example.com');
        await page.fill('input[type="password"]', 'adminpassword123');
        await page.click('button[type="submit"]');

        await expect(page).toHaveURL(/\/campus\/admin/);
    });

    test.skip('teacher should see teacher dashboard', async ({ page }) => {
        await page.goto('/es/login');
        await page.fill('input[type="email"]', 'teacher@example.com');
        await page.fill('input[type="password"]', 'teacherpassword123');
        await page.click('button[type="submit"]');

        await expect(page).toHaveURL(/\/campus\/teacher/);
    });
});

// Unauthenticated tests
test.describe('Campus Protection', () => {
    test('should redirect to login when not authenticated', async ({ page }) => {
        await page.goto('/es/campus');
        await expect(page).toHaveURL(/\/es\/login/);
    });

    test('should redirect admin routes to login', async ({ page }) => {
        await page.goto('/es/campus/admin');
        await expect(page).toHaveURL(/\/es\/login/);
    });

    test('should redirect teacher routes to login', async ({ page }) => {
        await page.goto('/es/campus/teacher');
        await expect(page).toHaveURL(/\/es\/login/);
    });
});
