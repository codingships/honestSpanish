# Español Honesto

Plataforma educativa Serverless de Español Inmersivo. Construida bajo una arquitectura híbrida (SSG + SSR) para maximizar la velocidad de la *Landing Page* (SEO Frontend) y proteger dinámicamente el Campus de Estudiantes (React + Supabase Backend).

---

## 🚀 Tecnologías Core (Stack 2024-2025)

*   **Framework:** [Astro 5](https://astro.build) (Modo Híbrido: `prerender` por defecto para Landing, SSR para Auth/Campus).
*   **UI / Estilos:** [Tailwind CSS 3.4](https://tailwindcss.com/) + Tipografías Serif Nativas.
*   **Componentes Frontend:** [React 18](https://react.dev/) (Usado únicamente para interactividad compleja como Formularios e Islas).
*   **Base de Datos & Auth:** [Supabase](https://supabase.com/) (PostgreSQL + Row Level Security + SSR Cookies Auth).
*   **Pagos:** [Stripe API](https://stripe.com) (Checkout Sessions + Webhooks Asíncronos).
*   **Gestor de Contenido (Blog):** [Keystatic](https://keystatic.com/) (CMS Basado en Git, guarda posts como `.md` en `src/content/blog`).
*   **Automatización de Clases:** Google Workspace API (Drive, Calendar, Meet) mediante Service Account con Delegación de Dominio.
*   **Internacionalización (i18n):** Enrutamiento por subdirectorios nativo de Astro (`/[lang]/...`) y diccionarios JSON TypeScript en `src/i18n/ui.ts`.
*   **Despliegue & Edge:** [Cloudflare Pages](https://pages.cloudflare.com/) (Despliegue contínuo y Edge Caching).
*   **Emails Transaccionales:** [Resend](https://resend.com) (Envío de secuencias de Bienvenida).
*   **Protección Anti-Spam (Formularios):** Cloudflare Turnstile (React).

---

## 🛠️ Requisitos del Entorno Local

Para compilar este repositorio en tu máquina necesitas:

1.  **Node.js 20+** o superior.
2.  Una cuenta activa de Supabase (con el esquema de BBDD que hay en `/db/schema.sql` insertado).
3.  Una cuenta de Cloudflare (Para Turnstile y despliegue).
4.  Un archivo `.env` configurado.

### Configuración del `.env`

El proyecto depende íntimamente de un archivo `.env` en la raíz. Existe un `.env.example` en el repositorio para que lo dupliques:

```env
# URL de Testing Local de tu FrontEnd
PUBLIC_SITE_URL=http://localhost:4321

# Supabase (Auth + DB)
PUBLIC_SUPABASE_URL=htps://tu-id.supabase.co
PUBLIC_SUPABASE_ANON_KEY=eyJhbG...
SUPABASE_SERVICE_ROLE_KEY=eyJhbG... # Mantener en secreto (Para webhooks de Stripe y crear Leads)

# Stripe (Facturación)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...

# Resend (Emails)
RESEND_API_KEY=re_...
FROM_EMAIL=onboarding@espanolhonesto.com
ADMIN_EMAIL=tu@tu-mail.com

# Cloudflare Turnstile (Anti-Captcha)
PUBLIC_TURNSTILE_SITE_KEY=0x4A...
TURNSTILE_SECRET_KEY=0x4A...

# Google Workspace (Automatizaciones de Drive y Calendar)
GOOGLE_SERVICE_ACCOUNT_EMAIL=mi-cuenta-servicio@proyecto.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvgIBADAN...-----END PRIVATE KEY-----\n"
GOOGLE_ADMIN_EMAIL=admin@tudominio.com
GOOGLE_DRIVE_ROOT_FOLDER_ID=1AbCdEfGhIjKlMnOpQrStUvWxYz
GOOGLE_TEMPLATE_DOC_ID=1XyZaBcDeFgHiJkLmNoPqRsTuVwXy
```

> [!CAUTION]  
> **Seguridad Estricta:** Las variables que no empiecen por `PUBLIC_` jamás serán expuestas al navegador. Sólo las lee el Backend (Astro Server / Endpoints). Asegúrate de no exponer claves maestras de Supabase o Stripe en componentes de UI.

---

## 💻 Comandos de Desarrollo

La ingeniería detrás de la consola de este proyecto.

*   `npm run dev` → Inicia el servidor de desarrollo local (Astro Vite).
*   `npm run dev -- --host` → Permite acceder al servidor desde un teléfono móvil conectado al mismo Wi-Fi de tu casa.
*   `npm run build` → Compila para producción (Genera los HTMLs del `/blog` y prepara los Server Handlers para el `Campus` en Cloudflare Pages).
*   `npm run preview` → Ejecuta `wrangler` para emular el servidor final de Cloudflare en tu máquina antes de subirlo y testar las Cloudflare Pages localmente.

### Flujo de Testeo y Calidad E2E
Este proyecto incluye una suite completa de pruebas unitarias y E2E:
*   `npm run test` → Lanza el corredor de Vitest para pruebas unitarias.
*   `npm run test:e2e` → Levanta Playwright y ejecuta robots E2E para testear auth, calendarios y UI en el navegador.
*   *Otros scripts:* `test:e2e:auth`, `test:e2e:calendar`, `test:e2e:mobile`.

---

## 📚 Estructura Principal del Repositorio

El corazón de la arquitectura en `src/`:

```
/src
 ├── /assets/      --> Recursos compilados e Imágenes WebP auto-optimizadas.
 ├── /components/  --> Cápsulas de React (.tsx) e Islas de Astro (.astro).
 │    ├── /account/--> Formularios protegidos del Dashboard.
 │    ├── /admin/  --> Componentes del Panel Creador (Métricas).
 │    └── Form/Nav --> UI de la Landing.
 ├── /content/     --> Documentos Markdown estáticos y Content Collections.
 │    └── /blog/   --> Posts de Español Honesto (Generados por el CMS Keystatic).
 ├── /i18n/        --> Diccionarios (`ui.ts`) y utilidades de traducción estricta.
 ├── /layouts/     --> Cimientos visuales. `BaseLayout.astro` y `CampusLayout.astro`.
 ├── /lib/         --> Clientes asíncronos puros de TypeScript (Supabase, Resend).
 ├── /pages/       --> El Enrutador Web. Cada Astro equivale a una URL `/ruta`.
 │    ├── /api/    --> Webhooks de Stripe / Endpoints del formulario Turnstile.
 │    └── /[lang]/ --> Estructura Internacional inyectada recursivamente.
 └── /styles/      --> Tailwind Global Config (`global.css`).
```

Para adentrarte en el funcionamiento lógico de los Roles, Base de Datos y Endpoints, consulta el [ARCHITECTURE.md](./ARCHITECTURE.md) (La Biblia Técnica).
