/// <reference types="@testing-library/jest-dom" />
// Force UTC timezone for consistent snapshot tests across different systems
process.env.TZ = 'UTC';

import { beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { handlers } from './mocks/handlers';
import '@testing-library/jest-dom/vitest';

// Setup MSW server for mocking HTTP requests
export const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());
