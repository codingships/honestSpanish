# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⚠️ INSTRUCCIONES PARA EL AGENTE QUE EMPIEZA

**IMPORTANTE: Antes de hacer cualquier cosa, haz estas preguntas al usuario:**

1. "¿Quieres continuar donde lo dejamos (integración de Sentry), o tienes otra prioridad ahora mismo?"
2. "¿Ha pasado algo desde la última sesión que deba saber? (errores en producción, cambios en el código, etc.)"
3. Si vas a instalar paquetes o modificar código: "¿Tienes el servidor de dev parado? ¿Hay algo en staging que no deba romperse?"

**No asumas nada. El usuario es el dueño del proyecto y puede haber cambiado de prioridades.**

---

## Estado del proyecto (actualizado 2026-02-19)

### ✅ Completado en sesiones anteriores

**Test suite completa (119 tests, 0 fallos):**
- 87 unit + API tests (`npm run test:run`) — pasan en CI
- 32 E2E tests Playwright por rol (public/student/teacher/admin)
- CI/CD en GitHub Actions configurado y verde
- Coverage thresholds ajustados a 14/13/15/14

**Auditoría de seguridad y producción:**
- RLS verificado en todas las tablas (profiles, sessions, subscriptions, payments, student_teachers)
- **Fix crítico aplicado:** trigger `prevent_role_change` en profiles (evita escalada de rol)
- **Fix crítico aplicado:** política sessions ALL → SELECT + UPDATE para teachers
- **Fix aplicado:** race condition en `sessions_used` → optimistic locking
- Índices verificados (todos existían)
- Schema inicial exportado a `supabase/migrations/000_initial_schema.sql`

**Skills de Claude Code creados:**
- `~/.claude/skills/commit/SKILL.md` — `/commit`
- `~/.claude/skills/audit-security/SKILL.md` — `/audit-security`

### 🔴 Siguiente paso inmediato: Sentry

**Contexto:** El usuario ya tiene cuenta en Sentry y ha obtenido:
- DSN: disponible (el usuario lo tiene)
- Auth Token: el usuario buscaba el token real en User Settings → Auth Tokens
  (lo que encontró antes era una URL de OTLP, no el token)

**Lo que hay que hacer:**
1. `npm install @sentry/astro`
2. Añadir integración Sentry a `astro.config.mjs`
3. Crear `sentry.client.config.ts`
4. Crear `sentry.server.config.ts`
5. Añadir `PUBLIC_SENTRY_DSN` a `.env` y a Cloudflare Pages env vars
6. Añadir `SENTRY_AUTH_TOKEN` a GitHub secrets y al CI workflow
7. Hacer build y verificar que sube source maps
8. Provocar un error de prueba y verificar que llega a Sentry

**Nota técnica:** Stack es Astro 5 SSR + Cloudflare Pages adapter. Usar `@sentry/astro`.
El DSN apunta a la región EU (ingest.de.sentry.io) — normal para cuentas europeas.

### 🟠 Pendiente tras Sentry

**Stripe en modo live:**
- Verificar que las claves de producción están en Cloudflare Pages
- Hacer un pago real de prueba end-to-end
- Verificar que el webhook llega correctamente a la URL de producción

**Email deliverability:**
- Verificar Resend está configurado con el dominio real (SPF, DKIM)
- Confirmar que los emails de confirmación de clase no van a spam

**Variables de entorno en producción:**
- Auditar que todas las vars están en Cloudflare Pages production

**Legal (GDPR):**
- Política de privacidad y términos de servicio completos
- El banner de cookies existe pero las páginas legales necesitan revisión

---

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
npm run test:e2e         # Playwright E2E (headless)
npm run test:e2e:ui      # Playwright E2E (UI mode)
npm run test:e2e:debug   # Playwright E2E (debug mode)
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

Key endpoint groups:
- `/api/calendar/*` — sessions, available slots, recurring classes
- `/api/admin/*` — teacher assignment/removal
- `/api/teacher/*` — teacher availability
- `/api/account/*` — profile updates, Stripe portal
- `/api/auth/*` — post-login handling
- `/api/google/*` — Drive folder creation, recording processing
- `/api/email/*` — test email sending
- `/api/cron/*` — scheduled email reminders
- `/api/create-checkout.ts` — Stripe checkout session
- `/api/stripe-webhook.ts` — payment events

### Integrations

- **Stripe** (`src/lib/stripe.ts`) — Checkout sessions, webhooks, customer portal. (v20.1.2)
- **Google APIs** (`src/lib/google/`) — Calendar (scheduling), Drive (student folders), Docs (class documents). Uses service account with domain-wide delegation.
- **Resend** (`src/lib/email/`) — Transactional emails with templates.
- **Supabase** — Postgres DB + Auth. Browser client (`@supabase/supabase-js` v2.90+), SSR client (`@supabase/ssr`).

### Database Schema (Supabase/PostgreSQL)

Key tables: `profiles`, `sessions` (class bookings), `packages` (subscription tiers), `subscriptions`, `payments`. Types auto-generated in `src/types/database.types.ts`.

Full schema versionado en `supabase/migrations/000_initial_schema.sql`.

RLS activo en todas las tablas. Trigger `prevent_role_change` en profiles impide escalada de privilegios.

### Testing Setup

- **Unit tests** (`tests/unit/`): Vitest + jsdom + Testing Library. 4 archivos: i18n, StudentClassList, TeacherCalendar, AvailabilityManager.
- **API tests** (`tests/api/`): 5 archivos testando auth guards, input validation y success paths.
- **E2E tests** (`tests/e2e/`): Playwright con proyectos por rol (public, student, teacher, admin).
- Global setup en `tests/setup.ts` — MSW server, UTC timezone, Testing Library matchers.
- Coverage thresholds: 14/13/15/14 (statements/branches/functions/lines).

### Playwright E2E Projects

Tests organizados por rol: `<name>.public.spec.ts`, `<name>.student.spec.ts`, `<name>.teacher.spec.ts`, `<name>.admin.spec.ts`. CI corre solo Chrome; local corre en paralelo.

### Styling

Tailwind CSS with custom theme: brand colors red `#6A131C` and yellow `#F6FE51`, custom fonts (Boldonse/Unbounded for display, Pretendard for body).

### Content

Blog posts as Markdown content collections in `src/content/blog/{es,en,ru}/`, with Zod schema validation and RSS feed generation.
