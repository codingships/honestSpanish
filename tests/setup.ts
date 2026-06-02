/// <reference types="@testing-library/jest-dom" />
// Force UTC timezone for consistent snapshot tests across different systems
process.env.TZ = 'UTC';
process.env.PUBLIC_SUPABASE_URL ??= 'https://placeholder.supabase.co';
process.env.PUBLIC_SUPABASE_ANON_KEY ??= 'placeholder-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'placeholder-service-role-key';
process.env.STRIPE_SECRET_KEY ??= 'sk_test_placeholder';
process.env.STRIPE_WEBHOOK_SECRET ??= 'whsec_placeholder';
process.env.PUBLIC_STRIPE_PUBLISHABLE_KEY ??= 'pk_test_placeholder';
process.env.RESEND_API_KEY ??= 're_placeholder';
process.env.EMAIL_FROM ??= 'Español Honesto <test@example.com>';

import { beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { handlers } from './mocks/handlers';
import '@testing-library/jest-dom/vitest';

// Setup MSW server for mocking HTTP requests
export const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());
