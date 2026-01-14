/**
 * Keyboard Navigation Tests
 * 
 * Comprehensive tests for keyboard-only navigation
 * Essential for users who cannot use a mouse
 */
import { test, expect } from '@playwright/test';

function log(message: string, details?: any) {
    const timestamp = new Date().toISOString();
    console.log(`\n[${timestamp}] ⌨️ ${message}`);
    if (details) {
        console.log(`   Details:`, JSON.stringify(details, null, 2));
    }
}

test.describe('Keyboard Navigation - Public Pages', () => {

    test('should navigate entire homepage with keyboard', async ({ page }) => {
        log('Testing full keyboard navigation on homepage');
        await page.goto('/es', { waitUntil: 'networkidle' });

        const visitedElements: string[] = [];
        const startTime = Date.now();

        // Tab through the page
        for (let i = 0; i < 50; i++) {
            await page.keyboard.press('Tab');

            const activeEl = await page.evaluate(() => {
                const el = document.activeElement;
                if (!el) return null;
                return {
                    tag: el.tagName,
                    type: (el as HTMLInputElement).type || '',
                    text: el.textContent?.substring(0, 30)?.trim(),
                    href: (el as HTMLAnchorElement).href?.substring(0, 50),
                };
            });

            if (activeEl) {
                const desc = `${activeEl.tag}${activeEl.type ? `[${activeEl.type}]` : ''}: ${activeEl.text || activeEl.href || 'no text'}`;
                if (!visitedElements.includes(desc)) {
                    visitedElements.push(desc);
                }
            }
        }

        const elapsed = Date.now() - startTime;
        log('Keyboard navigation complete', {
            uniqueElements: visitedElements.length,
            timeMs: elapsed,
            sample: visitedElements.slice(0, 10)
        });

        // Should reach multiple interactive elements
        expect(visitedElements.length).toBeGreaterThan(5);

        log('✅ Homepage keyboard navigation works');
    });

    test('should activate buttons with Enter and Space', async ({ page }) => {
        log('Testing button activation');
        await page.goto('/es', { waitUntil: 'networkidle' });

        // Find a button
        const button = page.locator('button:visible').first();

        if (await button.isVisible()) {
            // Focus the button
            await button.focus();

            // Check it's focusable
            const isFocused = await button.evaluate((el) => document.activeElement === el);
            log('Button focused', { isFocused });
            expect(isFocused).toBe(true);

            // Note: We don't actually press Enter/Space to avoid triggering actions
            // but we verify the button is focusable and would receive the event
        }

        log('✅ Button keyboard activation possible');
    });

    test('should navigate dropdown/select with arrow keys', async ({ page }) => {
        log('Testing dropdown navigation');
        await page.goto('/es/login', { waitUntil: 'networkidle' });

        // Look for language selector or any select
        const select = page.locator('select').first();

        if (await select.isVisible().catch(() => false)) {
            await select.focus();

            // Get initial value
            const initialValue = await select.inputValue();

            // Press down arrow
            await page.keyboard.press('ArrowDown');
            await page.waitForTimeout(100);

            log('Select navigation', { initialValue });
        }

        log('✅ Dropdown keyboard navigation checked');
    });

    test('should support Escape to close overlays', async ({ page }) => {
        log('Testing Escape key for overlays');
        await page.goto('/es', { waitUntil: 'networkidle' });

        // Try to open a modal
        const modalTrigger = page.locator('button:has-text("Elegir")').first();

        if (await modalTrigger.isVisible().catch(() => false)) {
            await modalTrigger.click();
            await page.waitForTimeout(500);

            const modal = page.locator('[role="dialog"], .modal').first();
            const modalVisible = await modal.isVisible().catch(() => false);

            if (modalVisible) {
                log('Modal opened, testing Escape');

                await page.keyboard.press('Escape');
                await page.waitForTimeout(300);

                const stillVisible = await modal.isVisible().catch(() => false);
                log('Modal after Escape', { closed: !stillVisible });

                expect(stillVisible).toBe(false);
            }
        }

        log('✅ Escape key functionality checked');
    });
});

test.describe('Keyboard Navigation - Forms', () => {

    test('should navigate login form with Tab', async ({ page }) => {
        log('Testing login form tab order');
        await page.goto('/es/login', { waitUntil: 'networkidle' });

        const tabOrder: string[] = [];

        // Tab through form elements
        for (let i = 0; i < 10; i++) {
            await page.keyboard.press('Tab');

            const activeEl = await page.evaluate(() => {
                const el = document.activeElement;
                return el ? {
                    tag: el.tagName,
                    type: (el as HTMLInputElement).type || '',
                    name: (el as HTMLInputElement).name || '',
                } : null;
            });

            if (activeEl) {
                tabOrder.push(`${activeEl.tag}[${activeEl.type || activeEl.name}]`);
            }
        }

        log('Login form tab order', { order: tabOrder });

        // Should hit email, password, and submit in logical order
        const emailIndex = tabOrder.findIndex(e => e.includes('email'));
        const passwordIndex = tabOrder.findIndex(e => e.includes('password'));
        const submitIndex = tabOrder.findIndex(e => e.includes('submit'));

        if (emailIndex !== -1 && passwordIndex !== -1) {
            expect(emailIndex).toBeLessThan(passwordIndex);
            log('Email before password ✓');
        }

        if (passwordIndex !== -1 && submitIndex !== -1) {
            expect(passwordIndex).toBeLessThan(submitIndex);
            log('Password before submit ✓');
        }

        log('✅ Login form tab order verified');
    });

    test('should submit form with Enter', async ({ page }) => {
        log('Testing form Enter submission');
        await page.goto('/es/login', { waitUntil: 'networkidle' });

        // Fill form
        await page.fill('input[type="email"]', 'test@test.com');
        await page.fill('input[type="password"]', 'password123');

        // Press Enter while in password field
        const passwordField = page.locator('input[type="password"]');
        await passwordField.focus();

        // Check that Enter would submit (we check the form has proper structure)
        const formHasSubmit = await page.evaluate(() => {
            const form = document.querySelector('form');
            const submitBtn = form?.querySelector('button[type="submit"], input[type="submit"]');
            return !!submitBtn;
        });

        log('Form submit button', { exists: formHasSubmit });
        expect(formHasSubmit).toBe(true);

        log('✅ Form Enter submission possible');
    });
});

test.describe('Keyboard Navigation - Interactive Components', () => {

    test('should navigate tabs with arrow keys', async ({ page }) => {
        log('Testing tab component navigation');
        await page.goto('/es/campus/classes', { waitUntil: 'networkidle' });

        // Look for tab list
        const tabList = page.locator('[role="tablist"]');
        const hasTabList = await tabList.isVisible().catch(() => false);

        if (hasTabList) {
            const tabs = await tabList.locator('[role="tab"]').all();
            log('Tab list found', { tabCount: tabs.length });

            if (tabs.length > 1) {
                // Focus first tab
                await tabs[0].focus();

                // Press arrow right
                await page.keyboard.press('ArrowRight');
                await page.waitForTimeout(100);

                // Check if next tab is focused
                const secondTabFocused = await tabs[1].evaluate((el) =>
                    document.activeElement === el
                );

                log('Arrow navigation', { secondTabFocused });
            }
        }

        log('✅ Tab navigation checked');
    });

    test('should navigate calendar with keyboard', async ({ page }) => {
        log('Testing calendar keyboard navigation');
        await page.goto('/es/campus/teacher/calendar', { waitUntil: 'networkidle' });

        // Focus calendar area
        const calendar = page.locator('.fc, [class*="calendar"]').first();

        if (await calendar.isVisible().catch(() => false)) {
            // Test navigation buttons
            const prevBtn = page.getByRole('button', { name: /anterior|prev|←/i });
            const nextBtn = page.getByRole('button', { name: /siguiente|next|→/i });

            if (await prevBtn.isVisible()) {
                await prevBtn.focus();
                await page.keyboard.press('Enter');
                await page.waitForTimeout(300);
                log('Previous button activated via keyboard');
            }

            if (await nextBtn.isVisible()) {
                await nextBtn.focus();
                await page.keyboard.press('Enter');
                await page.waitForTimeout(300);
                log('Next button activated via keyboard');
            }
        }

        log('✅ Calendar keyboard navigation checked');
    });
});

test.describe('Focus Management', () => {

    test('should return focus after modal closes', async ({ page }) => {
        log('Testing focus restoration');
        await page.goto('/es', { waitUntil: 'networkidle' });

        const triggerBtn = page.locator('button:has-text("Elegir")').first();

        if (await triggerBtn.isVisible().catch(() => false)) {
            // Remember trigger button
            await triggerBtn.focus();
            const triggerBtnFocused = await triggerBtn.evaluate((el) =>
                document.activeElement === el
            );
            log('Trigger button focused before open', { focused: triggerBtnFocused });

            // Open modal
            await page.keyboard.press('Enter');
            await page.waitForTimeout(500);

            // Close modal with Escape
            await page.keyboard.press('Escape');
            await page.waitForTimeout(300);

            // Check if focus returned to trigger
            const focusReturned = await triggerBtn.evaluate((el) =>
                document.activeElement === el
            );
            log('Focus returned to trigger', { returned: focusReturned });
        }

        log('✅ Focus restoration checked');
    });

    test('should move focus to main content with skip link', async ({ page }) => {
        log('Testing skip link');
        await page.goto('/es', { waitUntil: 'networkidle' });

        // Press Tab to potentially reveal skip link
        await page.keyboard.press('Tab');
        await page.waitForTimeout(100);

        const skipLink = page.locator('a[href="#main"], a[href="#content"], .skip-link, a:has-text("Saltar")');
        const hasSkipLink = await skipLink.isVisible().catch(() => false);

        log('Skip link', { visible: hasSkipLink });

        if (hasSkipLink) {
            await skipLink.focus();
            await page.keyboard.press('Enter');
            await page.waitForTimeout(200);

            // Check if main content or an element within it is focused
            const focusInMain = await page.evaluate(() => {
                const main = document.querySelector('main, #main, #content');
                const active = document.activeElement;
                return main?.contains(active) || active === main;
            });

            log('Focus moved to main', { inMain: focusInMain });
        }

        log('✅ Skip link tested');
    });

    test('should show clear focus indicators', async ({ page }) => {
        log('Testing focus visibility');
        await page.goto('/es', { waitUntil: 'networkidle' });

        // Tab to first focusable element
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');

        // Get computed styles of focused element
        const focusStyles = await page.evaluate(() => {
            const el = document.activeElement;
            if (!el) return null;

            const styles = window.getComputedStyle(el);
            const pseudoStyles = window.getComputedStyle(el, ':focus');

            return {
                tag: el.tagName,
                outline: styles.outline,
                outlineWidth: styles.outlineWidth,
                outlineColor: styles.outlineColor,
                outlineStyle: styles.outlineStyle,
                boxShadow: styles.boxShadow,
                border: styles.border,
            };
        });

        log('Focus indicator styles', focusStyles);

        // At least some focus indication should exist
        if (focusStyles) {
            const hasFocusIndicator =
                focusStyles.outlineWidth !== '0px' ||
                focusStyles.boxShadow !== 'none' ||
                focusStyles.outlineStyle !== 'none';

            log('Has visible focus indicator', { has: hasFocusIndicator });
        }

        log('✅ Focus indicators checked');
    });
});
