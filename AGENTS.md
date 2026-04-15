# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev            # Astro dev server on http://localhost:4321
npm run build          # Production build
npm run preview        # Local Wrangler emulation (Cloudflare Pages)
npm run deploy         # Deploy to Cloudflare Pages
npm run typecheck      # TypeScript check (tsc --noEmit)
npm run lint           # ESLint
npm run db:seed        # Seed the database (tsx scripts/seed/index.ts)

# Unit + API tests (Vitest, ~87 tests)
npm run test:run                                    # Run all
npm run test:coverage                               # With coverage report
npx vitest run tests/api/sessions-create.test.ts    # Single file

# E2E tests (Playwright)
npm run test:e2e -- --project=public     # 5 tests, no auth
npm run test:e2e -- --project=student    # 12 tests
npm run test:e2e -- --project=teacher    # 8 tests
npm run test:e2e -- --project=admin      # 7 tests
npm run test:e2e:ui                      # Interactive UI mode
npm run test:e2e:report                  # View last HTML report
npm run test:e2e:debug                   # Debug mode
npm run test:e2e:firefox                 # Public tests on Firefox
npm run test:e2e:safari                  # Public tests on WebKit
npm run test:e2e:mobile                  # Public tests on mobile viewports
npm run test:all                         # vitest run + public playwright
```

## Architecture Overview

**Español Honesto** is a Spanish-language tutoring platform. Stack: Astro 5 SSR + React 18 islands + Supabase + Cloudflare Pages + Stripe + Google Workspace APIs + Sentry.

### Rendering Strategy
- `output: 'server'` (full SSR via Cloudflare adapter), image service set to `noop`
- Static/prerendered: landing pages, blog (`/src/content/blog/` via Keystatic CMS)
- Dynamic: all `/[lang]/campus/*` routes and `/api/*` endpoints
- Keystatic CMS admin panel available at `/keystatic` in local dev

### i18n
URL-prefix routing with `prefixDefaultLocale: false`. The default locale `es` **must use the URL prefix** `/es/`. The root path `/` redirects to `/es/`. Other locales: `/en/`, `/ru/`. Translation dictionary at `src/i18n/translations.ts`. The `[lang]` dynamic route param covers all supported languages (`es`, `en`, `ru`).

### Authentication & Authorization
`src/middleware.ts` is the single gate for all protected routes:
1. Calls `supabase.auth.getUser()` server-side (validates JWT, not just cookie)
2. Fetches `role` from `profiles` table (`student` | `teacher` | `admin`)
3. Guards `/{lang}/campus` (requires auth), `/{lang}/campus/teacher` (teacher+admin only), `/{lang}/campus/admin` (admin only)
4. Redirects authenticated users away from `/login`

Three Supabase clients:
- `src/lib/supabase.ts` — browser client (`createBrowserClient`, cookie-based)
- `src/lib/supabase-server.ts` — server client (`createServerClient`, reads request cookies, typed with `Database`)
- `src/lib/supabase-admin.ts` — service role client (`createClient` with `SUPABASE_SERVICE_ROLE_KEY`, **bypasses RLS entirely**, server-only)

### Database (Supabase PostgreSQL)
**Source of Truth:** `db/schema.sql` is the official and only reference file for the database schema that AIs and developers should read. Ignore `esquema_nube.sql` (it's a dump) and `supabase/migrations/` (deployment artifacts).
Key tables: `profiles` (extends auth.users, has `role`), `packages`, `subscriptions`, `sessions`, `student_teachers` (M:N), `payments`, `leads`. Full schema with RLS at `db/schema.sql`.

RLS pattern: students see own data, teachers see assigned students, admins use the admin client (bypasses RLS).

### API Routes (`src/pages/api/`)
All serverless Astro endpoints (Cloudflare Workers). Key groups:
- `calendar/` — session CRUD, bulk import, availability slots
- `admin/` — user management, teacher assignment, leads CRM
- `account/` — profile updates, Stripe billing portal
- `teacher/` — teacher-specific endpoints
- `drive/` — Google Drive folder creation
- `stripe-webhook.ts` — handles `checkout.session.completed`, `invoice.paid`, subscription lifecycle (uses admin client)
- `cron/send-reminders.ts` — bearer-token-protected scheduled job
- `subscribe.ts` — lead magnet form with Cloudflare Turnstile validation

### Google Workspace Integration (`src/lib/google/`)
Service Account with domain-wide delegation. On session creation:
1. Creates Google Calendar event + Meet link (`calendar.ts`)
2. Clones template doc → names it `Clase - [Date] - [Student]` (`drive.ts`)
3. Creates student Drive folder structure on first session (`student-folder.ts`)

### Payment Flow
`/api/create-checkout.ts` (requires existing authenticated user) → Stripe hosted checkout → `stripe-webhook.ts` processes `checkout.session.completed` → creates/updates `subscriptions` + `payments` records using admin client.

### SEO
- OG images generated on-the-fly at `src/pages/og/[slug].png.ts` (Satori + resvg-wasm)
- RSS feeds per language at `src/pages/[lang]/blog/rss.xml.ts`

## Test Architecture

### API Tests (Vitest)
Use dynamic imports because `vi.mock` hoists. Pattern:
```typescript
vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));
// then inside test:
const mockSupabase = createMockSupabaseClient(); // from tests/mocks/supabase.ts
vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);
const { POST } = await import('../../src/pages/api/...');
```

### E2E Tests (Playwright)
- Auth state saved to `tests/e2e/.auth/[role].json` by setup scripts (git-ignored)
- Credentials from `.env.test`: `TEST_STUDENT_EMAIL/PASSWORD`, `TEST_TEACHER_EMAIL/PASSWORD`, `TEST_ADMIN_EMAIL/PASSWORD`
- File naming determines which Playwright project runs it: `*.public.spec.ts`, `*.student.spec.ts`, etc.

Coverage thresholds are intentionally low (14/13/15/14) — Google/Stripe/email integrations are not unit-tested.

## Key UI Facts (verified against real pages)
- Dashboard heading: `PANEL DE CONTROL` (CSS uppercase h1)
- Classes page tabs: `PRÓXIMAS` and `HISTORIAL`
- Teacher calendar URL: `/es/campus/teacher/calendar`
- Teacher calendar tabs: `HORARIO` and `DISPONIBILIDAD`
- Schedule modal has no `role="dialog"` — identify by `button:has-text("Continuar")`
- Playwright `:has-text()` is case-insensitive; CSS comma OR selectors do NOT work — use `.or()` or `.filter({ hasText })`

## Environment Variables
Required in `.env` (dev) and `.env.test` (E2E). Key ones:
- `PUBLIC_SUPABASE_URL` + `PUBLIC_SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` + `PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` + `GOOGLE_ADMIN_EMAIL` + `GOOGLE_DRIVE_ROOT_FOLDER_ID` + `GOOGLE_TEMPLATE_DOC_ID`
- `RESEND_API_KEY` + `EMAIL_FROM`
- `PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY`
- `SENTRY_AUTH_TOKEN` (build-time, for source map uploads)
