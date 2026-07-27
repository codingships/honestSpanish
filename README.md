# Español Honesto

Aplicación SSR de una academia de español. Incluye web pública, campus, administración/CRM, pagos preparados en modo seguro y un Worker separado para tareas de Google Workspace y Resend.

## Stack

- Astro 6, React y TypeScript.
- Cloudflare Pages en producción; Workers web y fulfillment separados en staging.
- Supabase: Auth y Postgres con RLS.
- Stripe para catálogo, checkout y suscripciones.
- Google Workspace para calendario/documentos y Resend para email.
- Turnstile y Sentry.

Docker no forma parte del stack actual: el desarrollo usa Node/pnpm y los servicios gestionados de staging. No se añade una infraestructura local paralela sin una necesidad concreta.

## Desarrollo

Requisitos: Node 22.12 y pnpm 10.33.

Crear `.env.staging` desde `.env.example` y sustituir todos los placeholders por los recursos de staging indicados en `docs/ENVIRONMENTS.md`. `.env.test` se crea desde `.env.test.example` solo para demo o seed explícitos; la suite pública no lee ninguno de los dos archivos.

```bash
pnpm install
pnpm run env:staging:sync
pnpm run dev
```

Comprobaciones habituales:

```bash
pnpm run typecheck
pnpm run lint
pnpm run test:run
pnpm run fulfillment:typecheck
pnpm run secrets:check
pnpm run build
```

La cobertura es voluntaria (`pnpm run test:coverage`). Playwright se usa de forma focal durante el desarrollo; la CI ejecuta una sola suite pública completa.

## Forma de trabajar

`origin/main` es el producto canónico. Cada tarea parte de un `main` limpio, usa una rama/worktree aislados, entrega un resultado por PR y deja que GitHub ejecute la CI. Las reglas completas están en `AGENTS.md`.

El despliegue de staging se despacha manualmente desde `main` mediante `.github/workflows/deploy-staging.yml`; GitHub fija automáticamente el SHA del evento y exige que su CI esté verde. No existe despliegue automático a producción.

## Fuentes duraderas

- `docs/PRODUCT.md`: producto, oferta y límites actuales.
- `docs/ENVIRONMENTS.md`: mapa inequívoco de recursos.
- `docs/OPERATIONS.md`: desarrollo, despliegue y recuperación.
- `ARCHITECTURE.md`: arquitectura técnica.
- `docs/crm/custom-crm-model.md`: modelo CRM.
- `docs/crm/privacy-operations.md`: operación de privacidad CRM.

Las conversaciones, ramas antiguas y staging no sustituyen estas fuentes ni `main`.
