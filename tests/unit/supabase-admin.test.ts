import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    createClient: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
    createClient: mocks.createClient,
}));

vi.mock('../../src/lib/runtime-env', () => ({
    readRuntimeEnv: vi.fn(),
    requireRuntimeEnv: vi.fn(),
}));

import { createSupabaseAdminClient } from '../../src/lib/supabase-admin';

describe('explicit Supabase admin runtime bindings', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('constructs the client from the exact Worker bindings', () => {
        const client = { from: vi.fn() };
        mocks.createClient.mockReturnValue(client);

        const result = createSupabaseAdminClient({
            PUBLIC_SUPABASE_URL: ' https://mzjyvmlxfpzdfdjzxxyj.supabase.co ',
            SUPABASE_EXPECTED_PROJECT_REF: ' mzjyvmlxfpzdfdjzxxyj ',
            SUPABASE_SERVICE_ROLE_KEY: ' staging-service-role ',
        });

        expect(result).toBe(client);
        expect(mocks.createClient).toHaveBeenCalledWith(
            'https://mzjyvmlxfpzdfdjzxxyj.supabase.co',
            'staging-service-role',
        );
    });

    it('fails closed when the URL does not match the expected project', () => {
        expect(() => createSupabaseAdminClient({
            PUBLIC_SUPABASE_URL: 'https://different-project.supabase.co',
            SUPABASE_EXPECTED_PROJECT_REF: 'mzjyvmlxfpzdfdjzxxyj',
            SUPABASE_SERVICE_ROLE_KEY: 'staging-service-role',
        })).toThrow('Explicit Supabase admin runtime bindings are missing or invalid');

        expect(mocks.createClient).not.toHaveBeenCalled();
    });

    it('fails closed when a required binding is absent', () => {
        expect(() => createSupabaseAdminClient({
            PUBLIC_SUPABASE_URL: 'https://mzjyvmlxfpzdfdjzxxyj.supabase.co',
            SUPABASE_EXPECTED_PROJECT_REF: 'mzjyvmlxfpzdfdjzxxyj',
        })).toThrow('Explicit Supabase admin runtime bindings are missing or invalid');

        expect(mocks.createClient).not.toHaveBeenCalled();
    });
});
