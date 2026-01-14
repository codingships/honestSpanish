/**
 * Authentication Helpers for E2E Tests
 */
import { Page, expect } from '@playwright/test';
import { TEST_USERS, UserRole } from '../fixtures/test-users';

/**
 * Login as a specific role
 */
export async function loginAs(page: Page, role: UserRole, lang = 'es'): Promise<void> {
    const user = TEST_USERS[role];

    await page.goto(`/${lang}/login`);

    // Wait for form to be ready
    await page.waitForSelector('input[type="email"]');

    await page.fill('input[type="email"]', user.email);
    await page.fill('input[type="password"]', user.password);
    await page.click('button[type="submit"]');

    // Wait for redirect to campus
    await page.waitForURL(`**/${lang}/campus/**`, { timeout: 15000 });
}

/**
 * Logout current user
 */
export async function logout(page: Page): Promise<void> {
    const logoutBtn = page.locator('[data-testid="logout-button"], button:has-text("Cerrar sesión"), a:has-text("Cerrar sesión")');

    if (await logoutBtn.isVisible()) {
        await logoutBtn.click();
        await page.waitForURL('**/login');
    }
}

/**
 * Check if user is logged in
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
    return page.url().includes('/campus');
}

/**
 * Save authentication state to file for reuse
 */
export async function saveAuthState(page: Page, path: string): Promise<void> {
    await page.context().storageState({ path });
}

/**
 * Get expected dashboard URL for role
 */
export function getDashboardUrl(role: UserRole, lang = 'es'): string {
    const paths = {
        student: `/${lang}/campus`,
        teacher: `/${lang}/campus/teacher`,
        admin: `/${lang}/campus/admin`,
    };
    return paths[role];
}

/**
 * Wait for page to be fully loaded (no pending network requests)
 */
export async function waitForPageLoad(page: Page): Promise<void> {
    await page.waitForLoadState('networkidle');
}
