---
description: Testing workflow with Playwright E2E, Vitest, and k6 load tests
---

# Testing Workflow

This project uses three testing layers: unit tests (Vitest), E2E tests (Playwright), and load tests (k6).

## Unit Tests (Vitest)

```bash
# Run all unit tests
pnpm test:run

# Run with coverage
pnpm test:coverage

# Run specific file
pnpm exec vitest run tests/api/create-checkout.test.ts
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
pnpm test:e2e

# Run specific role tests
pnpm test:e2e -- --grep "student"

# Run in UI mode
pnpm exec playwright test --ui

# Run headed (visible browser)
pnpm exec playwright test --headed
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
pnpm test:load

# Run specific scenario
k6 run tests/load/api-load.js
```

## Pre-PR Checklist

// turbo-all
1. `pnpm lint`
2. `pnpm typecheck`
3. `pnpm test:run`
4. `pnpm test:e2e`

## Skill References

| Testing Type | Skill | Key Patterns |
|-------------|-------|--------------|
| E2E | playwright-skill | `.agents/skills/playwright-skill/SKILL.md` |
| Unit | vitest | `.agents/skills/vitest/SKILL.md` |
