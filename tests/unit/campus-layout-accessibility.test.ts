import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('CampusLayout accessibility contract', () => {
    const source = readFileSync('src/layouts/CampusLayout.astro', 'utf8');

    it('provides a localized skip link and a focusable main target', () => {
        expect(source).toContain('href="#main-content"');
        expect(source).toContain('id="main-content" tabindex="-1"');
        expect(source).toContain("skip: 'Saltar al contenido principal'");
        expect(source).toContain("skip: 'Skip to main content'");
        expect(source).toContain("skip: 'Перейти к основному содержанию'");
    });

    it('treats the mobile sidebar as a labelled disclosure', () => {
        expect(source).toContain('aria-controls="sidebar"');
        expect(source).toContain('aria-expanded="false"');
        expect(source).toContain("sidebar.setAttribute('inert', '')");
        expect(source).toContain("sidebar.setAttribute('aria-hidden', 'true')");
        expect(source).toContain("closeBtn?.focus()");
        expect(source).toContain("if (e.key === 'Escape')");
    });

    it('keeps focus inside the open sidebar and restores disclosure focus', () => {
        expect(source).toContain("if (e.key === 'Tab' && sidebarOpen && sidebar)");
        expect(source).toContain("last.focus()");
        expect(source).toContain("first.focus()");
        expect(source).toContain("if (returnFocus) btn?.focus()");
    });

    it('labels and exposes the user navigation state', () => {
        expect(source).toContain('aria-controls="user-menu"');
        expect(source).toContain('aria-haspopup="true"');
        expect(source).toContain('aria-label={accessibilityCopy.userMenu}');
        expect(source).toContain("userBtn.setAttribute('aria-expanded', String(open))");
        expect(source).toContain("setUserMenuOpen(false, true)");
    });
});
