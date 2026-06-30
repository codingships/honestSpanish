import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { ui } from '../../src/i18n/translations';
import { useTranslations } from '../../src/i18n/utils';

function collectStrings(value: unknown, keyPath = '(root)', output: Array<{ path: string; value: string }> = []) {
    if (typeof value === 'string') {
        output.push({ path: keyPath, value });
        return output;
    }

    if (Array.isArray(value)) {
        value.forEach((item, index) => collectStrings(item, `${keyPath}[${index}]`, output));
        return output;
    }

    if (value && typeof value === 'object') {
        for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
            collectStrings(nested, keyPath === '(root)' ? key : `${keyPath}.${key}`, output);
        }
    }

    return output;
}

function hasLikelyMojibake(value: string) {
    return [
        /\u00C3[\u0080-\u00BF\u2018-\u201D]?/,
        /\u00C2[\u0080-\u00BF\u00BF\u00A1]?/,
        /\u00E2(?:\u20AC[\u0080-\u00BF]?|[\u201E\u201C\u201D\u2019])/,
        /\u00D0[\u0080-\u00BF\u0400-\u04FF]?/,
        /\u00D1(?:[\u0080-\u00BF\u0400-\u04FF]|\u20AC)/,
        /\uFFFD/,
    ].some((pattern) => pattern.test(value));
}

function collectCriticalSourceFiles() {
    const roots = ['src/components', 'src/layouts', 'src/pages', 'src/i18n', 'src/lib/email', 'public'];
    const extensions = new Set(['.astro', '.ts', '.tsx', '.jsx', '.js', '.md', '.mdoc', '.txt']);
    const files: string[] = [];

    const walk = (directory: string) => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const filePath = join(directory, entry.name);
            if (entry.isDirectory()) {
                walk(filePath);
                continue;
            }
            if (entry.isFile() && extensions.has(extname(entry.name))) {
                files.push(filePath.replace(/\\/g, '/'));
            }
        }
    };

    roots.forEach(walk);
    return files;
}

describe('i18n encoding guard', () => {
    it('does not contain common mojibake markers in translation strings', () => {
        const findings = collectStrings(ui)
            .filter(({ value }) => hasLikelyMojibake(value))
            .map(({ path, value }) => `${path}: ${value}`);

        expect(findings).toEqual([]);
    });

    it('does not contain common mojibake markers in launch-critical source files', () => {
        const sourceFiles = collectCriticalSourceFiles();

        const findings = sourceFiles
            .map((file) => ({ file, source: readFileSync(file, 'utf8') }))
            .filter(({ source }) => hasLikelyMojibake(source))
            .map(({ file }) => file);

        expect(findings).toEqual([]);
    });

    it('returns exact critical Spanish campus labels', () => {
        const t = useTranslations('es');
        const enyeUpper = String.fromCodePoint(0x00D1);
        const oAcute = String.fromCodePoint(0x00F3);

        expect(t('nav.brand')).toBe(`ESPA${enyeUpper}OL HONESTO`);
        expect(t('auth.login')).toBe(`Iniciar sesi${oAcute}n`);
        expect(t('campus.nav.myStudents')).toBe('Mis estudiantes');
        expect(t('campus.teacher.calendar.title')).toBe('Mi Calendario');
        expect(t('campus.nav.account')).toBe('Mi cuenta');
        expect(t('campus.nav.logout')).toBe(`Cerrar sesi${oAcute}n`);
    });

    it('returns exact critical Russian campus labels', () => {
        const t = useTranslations('ru');
        const support = String.fromCodePoint(0x041F, 0x043E, 0x0434, 0x0434, 0x0435, 0x0440, 0x0436, 0x043A, 0x0430);
        const calendar = String.fromCodePoint(
            0x041C, 0x043E, 0x0439, 0x20, 0x043A, 0x0430, 0x043B, 0x0435, 0x043D, 0x0434, 0x0430, 0x0440, 0x044C,
        );

        expect(t('campus.nav.support')).toBe(support);
        expect(t('campus.teacher.calendar.title')).toBe(calendar);
    });

    it('keeps CampusLayout brand rendering and title stripping encoding-safe', () => {
        const source = readFileSync('src/layouts/CampusLayout.astro', 'utf8');

        expect(source).toContain('String.fromCodePoint(0x00F1)');
        expect(source).toContain('String.fromCodePoint(0x00D1)');
        expect(source).toContain('brandNameHtml');
        expect(source).toContain('stripBrandSuffix(title)');
    });
});
