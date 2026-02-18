# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Español Honesto** (espanolhonesto.com) — A Spanish language academy platform built with Astro 5 (SSR mode) + React 18, deployed to Cloudflare Pages. Features student/teacher/admin dashboards, class scheduling, Stripe payments, and Google Workspace integration.

## Commands

```bash
# Development
npm run dev              # Astro dev server (localhost:4321)
npm run build            # Production build
npm run preview          # Preview with Wrangler (Cloudflare)
npm run deploy           # Deploy to Cloudflare Pages

# Testing
npm run test             # Vitest watch mode
npm run test:run         # Single run (CI)
npm run test:coverage    # Coverage report
npm run test:e2e         # Playwright E2E (UI mode)
npm run test:all         # Unit + E2E public tests

# Code quality
npm run lint             # ESLint
npm run typecheck        # TypeScript strict check

# Run a single test file
npx vitest run tests/unit/some-test.test.ts
npx playwright test tests/e2e/some-test.spec.ts
```

## Architecture

### Routing & i18n

- File-based routing via Astro. Localized pages under `src/pages/[lang]/`.
- Three locales: `es` (default, no prefix), `en`, `ru`.
- Custom i18n system in `src/i18n/` — `useTranslations(lang)` returns a `t()` function keyed into `translations.ts`.
- Astro config sets `prefixDefaultLocale: false`, so Spanish pages have no `/es/` prefix.

### Auth & Roles

- **Supabase Auth** with cookie-based SSR sessions.
- Two Supabase clients: browser (`src/lib/supabase.ts`) and server (`src/lib/supabase-server.ts`).
- `profiles` table has a `role` field: `student`, `teacher`, or `admin`.
- Middleware (`src/middleware.ts`) validates sessions and enforces role-based route access, redirecting to the appropriate `/campus/*` dashboard.

### API Routes

All API endpoints live in `src/pages/api/` and follow this pattern:

```typescript
import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../lib/supabase-server';

export const prerender = false;

export const POST: APIRoute = async (context) => {
    const supabase = createSupabaseServerClient(context);
    const { data: { user } } = await supabase.auth.getUser();
    // Auth check, business logic, return Response
};
```

Key endpoint groups: `/api/calendar/*` (sessions, slots, recurring), `/api/admin/*` (teacher assignment), `/api/account/*` (profile, Stripe portal), `/api/stripe-webhook` (payment events), `/api/google/*` (Drive/Docs).

### Integrations

- **Stripe** (`src/lib/stripe.ts`) — Checkout sessions, webhooks, customer portal.
- **Google APIs** (`src/lib/google/`) — Calendar (scheduling), Drive (student folders), Docs (class documents). Uses service account with domain-wide delegation.
- **Resend** (`src/lib/email/`) — Transactional emails with templates.

### Database Schema (Supabase/PostgreSQL)

Key tables: `profiles`, `sessions` (class bookings), `packages` (subscription tiers), `subscriptions`, `payments`. Types auto-generated in `src/types/database.types.ts`.

### Testing Setup

- **Unit tests** (`tests/unit/`, `tests/api/`): Vitest + jsdom + Testing Library + MSW for HTTP mocking. Setup in `tests/setup.ts`.
- **E2E tests** (`tests/e2e/`): Playwright with role-based test projects (public, student, teacher, admin). Auth setup fixtures in `tests/e2e/*.setup.ts`.
- Coverage threshold: 25% (v8 provider).

### Styling

Tailwind CSS with custom theme: brand colors red `#6A131C` and yellow `#F6FE51`, custom fonts (Boldonse/Unbounded for display, Pretendard for body).

### Content

Blog posts as Markdown content collections in `src/content/blog/{es,en,ru}/`, with Zod schema validation and RSS feed generation.
