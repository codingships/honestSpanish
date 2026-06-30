import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function apiFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) return apiFiles(fullPath);
        return entry.name.endsWith('.ts') ? [fullPath] : [];
    });
}

describe('API query construction guardrails', () => {
    it('does not build Supabase OR filters with template-literal user input', () => {
        for (const filePath of apiFiles('src/pages/api')) {
            const source = readFileSync(filePath, 'utf8');
            expect(source, `${filePath} contains a template-literal .or() filter`).not.toMatch(/\.or\(\s*`/);
        }
    });

    it('keeps all class creation endpoints behind canonical teacher availability slots', () => {
        for (const filePath of [
            'src/pages/api/calendar/sessions.ts',
            'src/pages/api/calendar/bulk-sessions.ts',
            'src/pages/api/calendar/recurring-sessions.ts',
        ]) {
            const source = readFileSync(filePath, 'utf8');
            expect(source, `${filePath} must import the shared availability slot guard`).toContain('checkTeacherAvailabilitySlots');
            expect(source, `${filePath} must reject unavailable class times`).toContain('campusAvailability.ok');
        }
    });

    it('keeps recurring class generation anchored to Madrid calendar time', () => {
        const source = readFileSync('src/pages/api/calendar/recurring-sessions.ts', 'utf8');

        expect(source).toContain('madridDateTimeToUtcIso');
        expect(source).toContain('dayOfWeekForDateKey');
        expect(source).toContain('addDaysToDateKey');
        expect(source).not.toContain('.setHours(');
        expect(source).not.toContain('.getDay()');
    });
});
