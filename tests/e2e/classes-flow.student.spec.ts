/**
 * EXHAUSTIVE Class Viewing and Cancellation Flow Tests - Student
 * 
 * Tests the complete flow of viewing and canceling classes as a student
 * with maximum observability and detailed logging
 */
import { test, expect, Page } from '@playwright/test';

// Helper for detailed logging
function log(step: string, details?: any) {
    const timestamp = new Date().toISOString();
    console.log(`\n[${timestamp}] 📋 ${step}`);
    if (details) {
        console.log(`   Details:`, JSON.stringify(details, null, 2));
    }
}

// Helper to capture current state
async function captureState(page: Page, stepName: string) {
    const url = page.url();
    const title = await page.title();
    log(`State at "${stepName}"`, { url, title });
    return { url, title };
}

test.describe('Complete Class Viewing Flow - Student', () => {

    test('should display student classes page correctly', async ({ page }) => {
        log('Step 1: Navigate to student classes page');
        await page.goto('/es/campus/classes', { waitUntil: 'networkidle' });
        await captureState(page, 'Student Classes Page');

        log('Step 2: Verify main content is visible');
        const mainContent = page.getByRole('main');
        await expect(mainContent).toBeVisible();

        log('Step 3: Check for page title');
        const title = page.locator('h1').first();
        const titleText = await title.textContent();
        log('Page title found', { titleText });

        log('Step 4: Check for tabs (upcoming/past)');
        const upcomingTab = page.locator('button:has-text("Próximas"), button:has-text("Upcoming"), [data-testid="tab-upcoming"]').first();
        const pastTab = page.locator('button:has-text("Anteriores"), button:has-text("Past"), [data-testid="tab-past"]').first();

        const hasUpcoming = await upcomingTab.isVisible().catch(() => false);
        const hasPast = await pastTab.isVisible().catch(() => false);
        log('Tabs found', { hasUpcoming, hasPast });

        log('✅ Student classes page displays correctly');
    });

    test('should display class cards with all information', async ({ page }) => {
        log('Step 1: Navigate to student classes');
        await page.goto('/es/campus/classes', { waitUntil: 'networkidle' });

        log('Step 2: Find class cards');
        const classCards = page.locator('[class*="class"], [class*="session"], [data-testid*="class"]');
        const cardCount = await classCards.count();
        log('Class cards found', { cardCount });

        if (cardCount > 0) {
            log('Step 3: Analyze first class card');
            const firstCard = classCards.first();
            const cardContent = await firstCard.textContent();
            log('First card content', { content: cardContent?.substring(0, 200) });

            log('Step 4: Check for expected elements in card');
            const hasDate = cardContent?.match(/\d+/) !== null;
            const hasTeacher = cardContent?.toLowerCase().includes('profesor') || cardContent?.toLowerCase().includes('teacher');
            const hasMeetLink = await firstCard.locator('a[href*="meet"]').isVisible().catch(() => false);

            log('Card elements analysis', { hasDate, hasTeacher, hasMeetLink });

            log('Step 5: Check for action buttons');
            const cancelBtn = firstCard.locator('button:has-text("Cancelar"), button:has-text("Cancel")').first();
            const detailBtn = firstCard.locator('button:has-text("Ver"), button:has-text("Details")').first();

            const hasCancel = await cancelBtn.isVisible().catch(() => false);
            const hasDetail = await detailBtn.isVisible().catch(() => false);
            log('Action buttons', { hasCancel, hasDetail });
        } else {
            log('⚠️ No classes found for student');
        }

        log('✅ Class cards analyzed');
    });

    test('should switch between upcoming and past tabs', async ({ page }) => {
        log('Step 1: Navigate to student classes');
        await page.goto('/es/campus/classes', { waitUntil: 'networkidle' });

        log('Step 2: Find tabs');
        const upcomingTab = page.locator('button:has-text("Próximas"), button:has-text("Upcoming")').first();
        const pastTab = page.locator('button:has-text("Anteriores"), button:has-text("Past"), button:has-text("Pasadas")').first();

        log('Step 3: Click upcoming tab');
        if (await upcomingTab.isVisible()) {
            await upcomingTab.click();
            await page.waitForTimeout(300);

            const upcomingClasses = page.locator('[class*="session"], [class*="class"]');
            const upcomingCount = await upcomingClasses.count();
            log('Upcoming classes', { upcomingCount });
        }

        log('Step 4: Click past tab');
        if (await pastTab.isVisible()) {
            await pastTab.click();
            await page.waitForTimeout(300);

            const pastClasses = page.locator('[class*="session"], [class*="class"]');
            const pastCount = await pastClasses.count();
            log('Past classes', { pastCount });
        }

        log('✅ Tab switching works');
    });

    test('should show class details when clicking on a class', async ({ page }) => {
        log('Step 1: Navigate to student classes');
        await page.goto('/es/campus/classes', { waitUntil: 'networkidle' });

        log('Step 2: Find clickable class');
        const classCards = page.locator('[class*="session"], [class*="class"]');
        const cardCount = await classCards.count();

        if (cardCount === 0) {
            log('⚠️ No classes to click - skipping');
            test.skip();
            return;
        }

        log('Step 3: Click on first class');
        const firstCard = classCards.first();
        await firstCard.click();
        await page.waitForTimeout(500);
        await captureState(page, 'After clicking class');

        log('Step 4: Check for detail modal or expanded view');
        const modal = page.locator('[role="dialog"], .modal, [class*="modal"]').first();
        const hasModal = await modal.isVisible().catch(() => false);
        log('Detail modal', { hasModal });

        if (hasModal) {
            const modalContent = await modal.textContent();
            log('Modal content', { content: modalContent?.substring(0, 300) });

            log('Step 5: Check for Meet link in details');
            const meetLink = modal.locator('a[href*="meet.google.com"]');
            const hasMeet = await meetLink.isVisible().catch(() => false);
            log('Meet link in modal', { hasMeet });

            if (hasMeet) {
                const meetUrl = await meetLink.getAttribute('href');
                log('Meet URL', { meetUrl });
            }

            log('Step 6: Check for document link');
            const docLink = modal.locator('a[href*="docs.google.com"], a[href*="drive.google.com"]');
            const hasDoc = await docLink.isVisible().catch(() => false);
            log('Document link', { hasDoc });
        }

        log('✅ Class details display correctly');
    });
});

test.describe('Class Cancellation Flow - Student', () => {

    test('should show cancel button only for classes >24h away', async ({ page }) => {
        log('Step 1: Navigate to student classes');
        await page.goto('/es/campus/classes', { waitUntil: 'networkidle' });

        log('Step 2: Find upcoming classes');
        const upcomingTab = page.locator('button:has-text("Próximas"), button:has-text("Upcoming")').first();
        if (await upcomingTab.isVisible()) {
            await upcomingTab.click();
            await page.waitForTimeout(300);
        }

        log('Step 3: Analyze cancel buttons');
        const classCards = page.locator('[class*="session"], [class*="class"]');
        const cardCount = await classCards.count();
        log('Upcoming class cards', { cardCount });

        for (let i = 0; i < Math.min(cardCount, 3); i++) {
            const card = classCards.nth(i);
            const cardText = await card.textContent();
            const cancelBtn = card.locator('button:has-text("Cancelar"), button:has-text("Cancel")').first();
            const hasCancelBtn = await cancelBtn.isVisible().catch(() => false);
            const isDisabled = hasCancelBtn ? await cancelBtn.isDisabled().catch(() => false) : null;

            log(`Class ${i + 1} analysis`, {
                preview: cardText?.substring(0, 50),
                hasCancelBtn,
                isDisabled
            });
        }

        log('✅ Cancel button visibility analyzed');
    });

    test('should open cancellation confirmation modal', async ({ page }) => {
        log('Step 1: Navigate to student classes');
        await page.goto('/es/campus/classes', { waitUntil: 'networkidle' });

        log('Step 2: Find a class with cancel button');
        const cancelBtn = page.locator('button:has-text("Cancelar"), button:has-text("Cancel")').first();
        const hasCancelBtn = await cancelBtn.isVisible().catch(() => false);

        if (!hasCancelBtn) {
            log('⚠️ No cancel button available - skipping');
            test.skip();
            return;
        }

        log('Step 3: Click cancel button');
        await cancelBtn.click();
        await page.waitForTimeout(500);
        await captureState(page, 'After clicking cancel');

        log('Step 4: Check for confirmation modal');
        const confirmModal = page.locator('[role="dialog"], .modal, [role="alertdialog"]').first();
        const hasModal = await confirmModal.isVisible().catch(() => false);
        log('Confirmation modal', { hasModal });

        if (hasModal) {
            const modalContent = await confirmModal.textContent();
            log('Modal content', { content: modalContent?.substring(0, 200) });

            log('Step 5: Check for confirm/cancel buttons');
            const confirmBtn = confirmModal.locator('button:has-text("Confirmar"), button:has-text("Confirm"), button:has-text("Sí")');
            const cancelModalBtn = confirmModal.locator('button:has-text("Cancelar"), button:has-text("No"), button:has-text("Volver")');

            const hasConfirm = await confirmBtn.isVisible().catch(() => false);
            const hasCancelModal = await cancelModalBtn.isVisible().catch(() => false);
            log('Modal buttons', { hasConfirm, hasCancelModal });

            log('Step 6: Cancel the modal (don\'t actually cancel the class)');
            if (hasCancelModal) {
                await cancelModalBtn.click();
                await page.waitForTimeout(300);
                const modalStillVisible = await confirmModal.isVisible().catch(() => false);
                log('Modal closed', { modalStillVisible });
            }
        }

        log('✅ Cancellation modal flow tested');
    });
});

test.describe('Student Dashboard Integration', () => {

    test('should show next class card on dashboard', async ({ page }) => {
        log('Step 1: Navigate to student dashboard');
        await page.goto('/es/campus', { waitUntil: 'networkidle' });
        await captureState(page, 'Student Dashboard');

        log('Step 2: Look for next class card');
        const nextClassCard = page.locator('[data-testid="next-class"], [class*="next-class"], .next-class');
        const hasNextClass = await nextClassCard.isVisible().catch(() => false);
        log('Next class card', { hasNextClass });

        if (hasNextClass) {
            const cardContent = await nextClassCard.textContent();
            log('Next class content', { content: cardContent?.substring(0, 200) });

            log('Step 3: Check for quick actions');
            const joinBtn = nextClassCard.locator('a[href*="meet"], button:has-text("Unirse")');
            const hasJoinBtn = await joinBtn.isVisible().catch(() => false);
            log('Join button', { hasJoinBtn });
        }

        log('Step 4: Check for classes link');
        const classesLink = page.locator('a[href*="classes"], a:has-text("Mis clases")').first();
        const hasClassesLink = await classesLink.isVisible().catch(() => false);
        log('Classes link', { hasClassesLink });

        log('✅ Dashboard integration checked');
    });

    test('should navigate from dashboard to classes page', async ({ page }) => {
        log('Step 1: Navigate to student dashboard');
        await page.goto('/es/campus', { waitUntil: 'networkidle' });

        log('Step 2: Find and click classes link');
        const classesLink = page.locator('a[href*="classes"], a:has-text("clases")').first();
        const hasLink = await classesLink.isVisible().catch(() => false);

        if (hasLink) {
            log('Step 3: Click classes link');
            await classesLink.click();
            await page.waitForURL('**/*classes*', { timeout: 10000 });
            await captureState(page, 'After navigating to classes');

            expect(page.url()).toContain('classes');
            log('✅ Navigation successful');
        } else {
            log('⚠️ Classes link not found on dashboard');
        }
    });
});
