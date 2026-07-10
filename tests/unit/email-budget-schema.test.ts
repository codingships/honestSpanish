import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = 'supabase/migrations/20260710083915_enforce_resend_recipient_budget.sql';
const migration = readFileSync(migrationPath, 'utf8').replace(/\r\n/g, '\n');
const schema = readFileSync('db/schema.sql', 'utf8').replace(/\r\n/g, '\n');

function providerSendFiles(root: string): string[] {
    const matches: string[] = [];
    const visit = (directory: string) => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) {
                visit(path);
            } else if (/\.(?:astro|ts|tsx)$/.test(entry.name)) {
                const source = readFileSync(path, 'utf8');
                if (/\.emails\.send\s*\(/.test(source)) {
                    matches.push(relative('.', path).replaceAll('\\', '/'));
                }
            }
        }
    };
    visit(root);
    return matches;
}

describe('email budget persistence and bypass invariants', () => {
    it('keeps every provider send behind the shared delivery gateway', () => {
        expect([...providerSendFiles('src'), ...providerSendFiles('workers')]).toEqual([
            'src/lib/email/delivery.ts',
        ]);
    });

    it('stores only aggregate UTC recipient reservations with service-role access', () => {
        for (const source of [migration, schema]) {
            const normalized = source.toLowerCase().replaceAll('public.', '');
            expect(normalized).toContain('create table email_recipient_budget_usage');
            expect(normalized).toContain('primary key (budget_scope, period_kind, period_start)');
            expect(normalized).toContain('alter table email_recipient_budget_usage enable row level security');
            expect(normalized).toContain('revoke all on table email_recipient_budget_usage from anon');
            expect(normalized).toContain('revoke all on table email_recipient_budget_usage from authenticated');
            expect(normalized).toContain('grant select, insert, update on table email_recipient_budget_usage to service_role');
            expect(source).not.toMatch(/recipient_(?:address|email)/i);
        }
    });

    it('reserves daily and monthly budget atomically and fails closed at hard ceilings', () => {
        for (const source of [migration, schema]) {
            expect(source).toContain('CREATE OR REPLACE FUNCTION public.reserve_email_recipient_budget');
            expect(source).toContain('SECURITY INVOKER');
            expect(source).toContain("SET search_path = ''");
            expect(source.match(/ON CONFLICT \(budget_scope, period_kind, period_start\) DO UPDATE/g)).toHaveLength(2);
            expect(source).toContain('usage.recipient_count + EXCLUDED.recipient_count <= p_daily_limit');
            expect(source).toContain('usage.recipient_count + EXCLUDED.recipient_count <= p_monthly_limit');
            expect(source).toContain("p_daily_limit > 80");
            expect(source).toContain("p_monthly_limit > 2400");
            expect(source).toContain("RAISE EXCEPTION 'email_budget_daily_exceeded'");
            expect(source).toContain("RAISE EXCEPTION 'email_budget_monthly_exceeded'");
            expect(source).toContain('GRANT EXECUTE ON FUNCTION public.reserve_email_recipient_budget');
        }
    });
});
