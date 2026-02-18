---
description: Testing workflow with Playwright E2E, Vitest, and k6 load tests
---

# Testing Workflow

This project uses three testing layers: unit tests (Vitest), E2E tests (Playwright), and load tests (k6).

## Unit Tests (Vitest)

```bash
# Run all unit tests
npm run test:unit

# Run with coverage
npm run test:coverage

# Run specific file
npx vitest run tests/api/create-checkout.test.ts
```

### Writing Unit Tests

Location: `tests/api/` and `tests/unit/`

```typescript
import { describe, it, expect } from 'vitest';

describe('FeatureName', () => {
    it('should do something', () => {
        expect(true).toBe(true);
    });
});
```

## E2E Tests (Playwright)

```bash
# Run all E2E tests
npm run test:e2e

# Run specific role tests
npm run test:e2e -- --grep "student"

# Run in UI mode
npx playwright test --ui

# Run headed (visible browser)
npx playwright test --headed
```

### E2E Test Structure

Location: `tests/e2e/`

- `*.public.spec.ts` - Public pages (no auth)
- `*.student.spec.ts` - Student flows (needs auth)
- `*.teacher.spec.ts` - Teacher flows (needs auth)
- `*.admin.spec.ts` - Admin flows (needs auth)

### Auth Setup

Edit `tests/e2e/*.setup.ts` for auth state.

## Load Tests (k6)

```bash
# Run load tests
npm run test:load

# Run specific scenario
k6 run tests/load/api-load.js
```

## Pre-PR Checklist

// turbo-all
1. `npm run lint`
2. `npm run typecheck`
3. `npm run test:unit`
4. `npm run test:e2e`

## Skill References

| Testing Type | Skill | Key Patterns |
|-------------|-------|--------------|
| E2E | playwright-skill | `.agents/skills/playwright-skill/SKILL.md` |
| Unit | vitest | `.agents/skills/vitest/SKILL.md` |
