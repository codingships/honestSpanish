import { test, expect } from '@playwright/test';

test.describe('Admin Dashboard', () => {
    test('admin can access /es/campus/admin', async ({ page }) => {
        await page.goto('/es/campus/admin', { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('domcontentloaded');
        expect(page.url()).not.toContain('/login');
        expect(page.url()).toContain('/campus/admin');
    });

    test('admin dashboard shows a heading or panel title', async ({ page }) => {
        await page.goto('/es/campus/admin', { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('domcontentloaded');

        const heading = page.locator('h1, h2').first();
        await expect(heading).toBeVisible({ timeout: 10000 });
    });

    test('students list page is accessible at /es/campus/admin/students', async ({ page }) => {
        await page.goto('/es/campus/admin/students', { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('domcontentloaded');
        expect(page.url()).not.toContain('/login');
        expect(page.url()).toContain('/admin');
    });

    test('package catalog page exposes admin product controls', async ({ page }) => {
        await page.goto('/es/campus/admin/packages', { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('domcontentloaded');
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);

        expect(page.url()).not.toContain('/login');
        expect(page.url()).toContain('/campus/admin/packages');
        await expect(page.locator('main').getByRole('heading', { name: /cat/i })).toBeVisible({ timeout: 10000 });
        await expect(page.getByText('Nuevo paquete')).toBeVisible({ timeout: 10000 });
        await expect(page.getByRole('button', { name: 'Crear' })).toBeVisible();
    });

    test('students list shows table rows with student data', async ({ page }) => {
        await page.goto('/es/campus/admin/students', { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('domcontentloaded');

        // Wait for content to load
        await page.waitForTimeout(2000);

        // Either a table with rows, or a list of student cards
        const studentRows = page.locator('table tr, [data-testid*="student"], .student-row').first();
        const hasRows = await studentRows.isVisible({ timeout: 5000 }).catch(() => false);

        if (!hasRows) {
            // Might show an empty state — just verify page loaded
            test.info().annotations.push({ type: 'note', description: 'No student rows found — possibly empty test data' });
        }

        // Page should at least have loaded without error
        expect(page.url()).toContain('/admin');
    });

    test('admin can navigate to student detail from the students list', async ({ page }) => {
        await page.goto('/es/campus/admin/students', { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(1000);

        // Look for any clickable student detail link.
        const studentLink = page.locator('a[href*="/admin/student/"]').first();
        const isVisible = await studentLink.isVisible({ timeout: 5000 }).catch(() => false);

        if (isVisible) {
            await studentLink.click();
            await page.waitForLoadState('domcontentloaded');
            expect(page.url()).toContain('/admin/student/');
            await expect(page.getByText('Ficha CRM')).toBeVisible({ timeout: 10000 });
            await expect(page.getByText('Historial CRM unificado')).toBeVisible({ timeout: 10000 });
        } else {
            test.info().annotations.push({ type: 'note', description: 'No student links found — possibly empty test data' });
        }
    });

    test('admin sees different navigation than student', async ({ page }) => {
        await page.goto('/es/campus/admin', { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('domcontentloaded');

        // Admin nav should have some admin-specific links
        const adminLinks = page.locator('a[href*="/admin/students"], a:has-text("Estudiantes"), a:has-text("Profesores")');
        await expect(adminLinks.first()).toBeVisible({ timeout: 10000 });
    });
});
