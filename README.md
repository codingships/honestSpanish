# 🎓 Español Honesto - Academia Online

Plataforma educativa para expatriados en España que buscan fluidez en español. Construida con un stack moderno SSR sobre el archipiélago de Cloudflare, optimizada para CRO internacionalizado y SEO técnico avanzado.

## 🚀 Arquitectura Técnica (Stack Core)
*   **Framework Frontend:** Astro 5 (Modo Híbrido / SSR) para servir páginas de forma ultrarrápida.
*   **Componentes Reactivos:** React 18, reservado únicamente para Islands interactivas de Onboarding, Auth y Dashboards.
*   **Alojamiento & Edge:** Cloudflare Pages (vía `@astrojs/cloudflare`).
*   **Base de Datos & Auth:** Supabase (PostgreSQL + RLS estricto) con cookies para acceso sin fricciones.
*   **Diseño:** Vanilla CSS potenciado con Tailwind CSS.

## 🔌 Integraciones Clave
*   **Pagos:** Stripe (Facturación y webhooks 100% integrados).
*   **Email Transaccional:** Resend (Notificaciones de nuevas clases, modificaciones y bienvenida).
*   **Google Workspace Ecosystem:**
    *   **Google Calendar API:** Autoprogramación de clases mediante Service Accounts.
    *   **Google Drive API:** Automate Folder creation y enlaces privados de materiales (Google Docs) por alumno.
*   **Observabilidad:** Sentry Metrics integrado globalmente contra caídas de UI y backend.

## 👥 Sistema de Roles (RBAC)
La academia utiliza un esquema de capas mediante la tabla `profiles`:
1.  **Público:** Landing (disponible en /es, /en y /ru) con captura optimizada de leads.
2.  **Student (Alumno):** Acceso estricto a `/campus`. Solo ve su calendario personal, su balance de horas pagadas, próxima clase con link de GMeet inyectado y sus materiales privados.
3.  **Teacher (Profesor):** Acceso a `/campus/teacher`. Ve y gestiona únicamente a *sus* alumnos asignados. Puede agendar clases, dejarlas pre-canceladas/completadas y adjuntar notas del progreso del estudiante.
4.  **Admin:** Acceso integral en `/campus/admin`. Métricas de facturación reales (mediante webhooks procesados), gestión de asignaciones de alumnos a profesores y revocación de invitaciones.

## ⚙️ Configuración y Puesta en Marcha (Dev)

### Prerrequisitos
Asegúrate de clonar el archivo `.env.example` y bautizarlo como `.env`, configurando:
*   Bases: `SUPABASE_URL` y `SUPABASE_ANON_KEY`.
*   Facturación: Claves de Stripe public/secret y firma webhook (Webhooks expuestos para Cloudflare).
*   Comunicaciones: `RESEND_API_KEY` con un dominio verificado configurado (ej: `@espanolhonesto.com`).
*   Google Cloud: El JSON unificado de credenciales base64 de tu Service Account de GCP con Domain-Wide-Delegation activo en Google Workspace para calendar@espanolhonesto.com.

### Levantar el entorno local
1. Instalar dependencias puras: `npm install`
2. Correr Node: `npm run dev`
*(El host de Astro iniciará típicamente en `http://localhost:4321`)*

## 🧪 Testing y QA (Vitest + Playwright)
El proyecto contiene robustas suites de testing para prevenir regresiones en facturación o calendarios.

*   `npm run test` -> Modo watch de pruebas unitarias (Vitest).
*   `npm run test:run` -> Ejecuta 1 pase completo de Unit Tests (Vitest).
*   `npm run test:e2e` -> Ejecuta el framework de Playwright inyectando las cuentas temporales (Student, Teacher, Admin) para revisar todo el flujo en Chromium, Safari y Firefox.
*   `npm run test:all` -> El estándar para pre-commits. Corre absolutamente todos los tests inyectados.

## 🌳 Estructura de i18n
La academia no recurre a pesos de red por dependencias externas para traducciones; emplea un diccionario interno puro con estructura de carpetas `[lang]`. Para editar cualquier literal de la UI, interviene sobre `src/i18n/translations.ts`.

---
*Mantenido por el equipo base de Español Honesto.*
