# Anexo: APIs, integraciones y variables de entorno

## Hallazgos

| ID | Fuente documental | Afirmacion | Evidencia en codigo | Veredicto | Severidad | Accion propuesta | Confianza |
|---|---|---|---|---|---|---|---|
| DOC-008 | `README.md:54`, `AGENTS.md:125`, `CLAUDE.md:125` | Variable de email: `FROM_EMAIL` | Codigo usa `EMAIL_FROM` en `src/lib/email/client.ts:15`; `.env.example` no define `EMAIL_FROM` ni `FROM_EMAIL` | divergencia | HIGH | Unificar nombre y documentar en `.env.example` | alta |
| DOC-009 | `ARCHITECTURE.md:89`, `AGENTS.md:72` | Creacion de carpeta alumno en `drive.ts`/grupo `drive/` | Endpoint real: `src/pages/api/google/create-student-folder.ts`; logica principal en `src/lib/google/student-folder.ts` | divergencia | MEDIUM | Actualizar inventario de rutas y modulos de Google | alta |
| DOC-010 | `ARCHITECTURE.md:94`, `AGENTS.md:82`, `CLAUDE.md:82` | Existe modulo `src/lib/google/recordings.ts` | `Test-Path src/lib/google/recordings.ts => False`; carpeta actual no incluye ese archivo | divergencia | HIGH | Quitar claim o implementar modulo y pipeline real | alta |
| DOC-015 | `AGENTS.md:85` | Webhook crea `profiles + subscriptions + payments` | Flujo observado: `create-checkout` requiere usuario/perfil existente (`src/pages/api/create-checkout.ts:20-33`); webhook crea/actualiza `subscriptions` y `payments` (`stripe-webhook.ts:153`, `:175`) | divergencia | MEDIUM | Corregir narrativa del flujo de pago | media |
| DOC-016 | `README.md:108` | `/api` se describe de forma muy reducida (Stripe + Turnstile) | Inventario real incluye `admin`, `calendar`, `teacher`, `google`, `cron`, `email`, `auth` | divergencia | LOW | Expandir descripcion como "ejemplos" o anadir indice completo de endpoints | alta |

## Confirmaciones (alineado)

- `checkout.session.completed` esta manejado en webhook (`src/pages/api/stripe-webhook.ts:63`).
- Cron protegido por bearer token (`src/pages/api/cron/send-reminders.ts:19`).
- Envio de recordatorios por email activo (`src/pages/api/cron/send-reminders.ts:114`, `:135`).
