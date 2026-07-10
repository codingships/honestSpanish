import { expect, test } from '@playwright/test';

test.describe('Residual teacher campus pages', () => {
    test('teacher student index exposes stats, search and detail links', async ({ page }) => {
        const response = await page.goto('/es/campus/teacher');

        expect(response?.status()).toBe(200);
        await expect(page).toHaveURL(/\/es\/campus\/teacher\/?$/);
        await expect(page.getByRole('main').getByRole('heading', { name: /mis estudiantes/i })).toBeVisible();
        await expect(page.getByText(/total estudiantes/i)).toBeVisible();
        await expect(page.locator('#student-search')).toBeVisible();
        await expect(page.locator('a[href*="/campus/teacher/student/"]').first()).toBeVisible();
    });

    test('teacher can open an assigned student detail page without mutating data', async ({ page }) => {
        await page.goto('/es/campus/teacher');
        const studentLink = page.locator('a[href*="/campus/teacher/student/"]').first();
        const href = await studentLink.getAttribute('href');

        expect(href).toBeTruthy();

        const response = await page.goto(href!);

        expect(response?.status()).toBe(200);
        await expect(page).toHaveURL(/\/es\/campus\/teacher\/student\/[^/]+$/);
        await expect(page.getByRole('link', { name: /volver a mis estudiantes/i })).toBeVisible();
        await expect(page.getByRole('heading', { name: /plan actual/i })).toBeVisible();
        await expect(page.getByRole('heading', { name: /materiales/i })).toBeVisible();
        await expect(page.getByRole('heading', { name: /notas/i })).toBeVisible();
    });
});
