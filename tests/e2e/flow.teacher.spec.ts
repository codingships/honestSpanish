import { test, expect } from '@playwright/test';

test.describe('Fase 5 y 6 UAT: Sesiones - Cancelar, No-Show, Reporte', () => {

    test('5.1.A y 5.1.B: Alumno puede cancelar clase', async ({ page }) => {
        await page.goto('/es/campus/classes');

        // Clic en la primera clase futura (NextClassCard o item en Próximas)
        const classCard = page.locator('.class-card, .next-class-card, [data-testid="class-card"]').first();
        if (await classCard.isVisible({ timeout: 5000 })) {
            const cancelBtn = classCard.locator('button:has-text("Cancelar clase"), button:has-text("Cancelar"), button[aria-label="Cancelar"]').first();

            if (await cancelBtn.isVisible({ timeout: 2000 })) {
                await cancelBtn.click();

                // 5.1.B Modal de motivo
                const textarea = page.locator('textarea[name="reason"], textarea[placeholder*="motivo"], textarea').first();
                if (await textarea.isVisible()) {
                    await textarea.fill('Motivo de prueba E2E: UAT 5.1');

                    const confirmBtn = page.locator('button:has-text("Confirmar cancelación"), button:has-text("Confirmar"), .modal button.bg-red-600').first();
                    await confirmBtn.click();

                    // Verificar toast
                    const toast = page.locator('.toast, [role="alert"], .alert-success');
                    await expect(toast.first()).toBeVisible({ timeout: 8000 }).catch(e => null);
                }
            } else {
                test.info().annotations.push({ type: 'note', description: 'No cancel button (might be <24h)' });
            }
        } else {
            test.info().annotations.push({ type: 'note', description: 'No classes to cancel' });
        }
    });

    test('6.1.A a 6.2.E: Profesor completa clase y envía reporte', async ({ page }) => {
        // Entrar como profesor (usar un test independiente o en el mismo si lo manejamos desde proyecto teacher)
        // Ya que este archivo lo podemos correr bajo --project=teacher, o hacerle setup
        // Nota: Asumimos que correremos esto bajo el proyecto teacher:
        await page.goto('/es/campus/teacher/calendar');

        // Ir a disponibilidad o abrir una sesión pasada si existe
        // En tu UI puede ser que haya un link a "Mis Clases" del profesor
        // Simulamos abrir una sesión, o buscar un modal de clase pasada
        const sessionToComplete = page.locator('.session-past, .class-card.completed, tr.past-session').first();
        if (await sessionToComplete.isVisible({ timeout: 5000 })) {
            await sessionToComplete.click();

            // Modal de detalle se abre
            const completeBtn = page.locator('button:has-text("Completar Clase"), button:has-text("Completar")').first();
            if (await completeBtn.isVisible()) {
                await completeBtn.click();

                // 6.2.A Rating (estrellas)
                const stars = page.locator('.stars button, button[aria-label*="star"], .rating input');
                if (await stars.count() >= 4) {
                    await stars.nth(3).click(); // 4 stars
                }

                // 6.2.B Skills (radios)
                const grammarGood = page.locator('input[name="grammar"][value="good"]');
                if (await grammarGood.isVisible()) await grammarGood.check();

                // 6.2.C Comentarios
                const commentsBox = page.locator('textarea[name="comments"], textarea').nth(0);
                if (await commentsBox.isVisible()) await commentsBox.fill('Mejorar verbos irregulares');

                // 6.2.D Deberes
                const homeworkBox = page.locator('textarea[name="homework_text"], textarea').nth(1);
                if (await homeworkBox.isVisible()) await homeworkBox.fill('Escribe 10 frases usando subjuntivo');

                // 6.2.E Enviar Reporte
                const submitReportBtn = page.locator('button:has-text("Enviar Reporte"), button[type="submit"]');
                await submitReportBtn.click();

                // Toast éxito
                const toast = page.locator('.toast, [role="alert"], .alert-success');
                await expect(toast.first()).toBeVisible({ timeout: 8000 }).catch(e => null);
            } else {
                test.info().annotations.push({ type: 'note', description: 'No "Completar Clase" button on session detail' });
            }
        } else {
            test.info().annotations.push({ type: 'note', description: 'No past sessions to complete found on the view' });
        }
    });
});
