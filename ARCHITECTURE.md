# Arquitectura de "Español Honesto"

El proyecto `Español Honesto` aborda dos universos completamente distintos en un solo repositorio de Astro:
1.  **Frontend Público e Internacional (SSG):** Rutas ultra-rápidas para adquirir *Leads*, optimizadas para SEO en tres idiomas.
2.  **Dashboard Privado (SSR):** Aplicación interactiva bajo autenticación estricta donde conviven Alumnos, Profesores y Administrador.

---

## 1. El Patrón de Renderizado (Astro SSR/SSG Híbrido)

El enrutador está configurado en `output: 'server'` (dentro de `astro.config.mjs`) para soportar sesiones dinámicas, pero usamos `export const prerender = true;` en las rutas que necesitan coste computacional cero y latencia CDN absoluta.

*   **Rutas Prerenderizadas (SSG - Estáticas):**
    *   `/` (Landing Page)
    *   `/[lang]/` (Página de Inicio traducida)
    *   `/[lang]/blog/` (Lista de artículos)
    *   `/[lang]/blog/[slug]` (Post individual generado mediante las colecciones de Keystatic en `src/content/blog`)
    *   *En estas rutas, no hay acceso al objeto dinámico `Astro.request`.*

*   **Rutas Server-Side (SSR - Dinámicas):**
    *   `/[lang]/campus/*` (Todo el panel de estudiante, profesor y administrador)
    *   `/[lang]/login` (Verifica si ya hay sesión abierta)
    *   `/[lang]/checkout/*` (Recupera precios dinámicos de Stripe)
    *   *Aquí se ejecutan consultas a BBDD en milisegundos y actúan los Guardianes de Ruta.*

---

## 2. Base de Datos (Supabase PostgreSQL)

La jerarquía del esquema de datos (`/db/schema.sql`) gira alrededor del objeto `auth.users` nativo de Supabase, extendido mediante triggers.

### Relaciones Core
1.  **Profiles (Perfiles):** La tabla maestra. Define el `role` (`student`, `teacher`, `admin`), el idioma y guarda el `stripe_customer_id`.
2.  **Packages (Paquetes):** El catálogo de productos (`essential`, `intensive`, `premium`). Enlazan con los IDs de precio reales de Stripe (`stripe_price_1m`, `3m`, `6m`).
3.  **Subscriptions (Suscripciones):** Une un `profile` con un `package`. Controla la fecha de fin (`ends_at`) y el total de sesiones de clase (`sessions_total` vs `sessions_used`).
4.  **Student_Teachers (Asignación):** Tabla pivote (N:M). Define qué Profesor imparte clase a qué Estudiante (`is_primary = true`).
5.  **Sessions (Clases):** El calendario de clases consumidas y programadas y sus *meet_links*.
6.  **Leads:** Registro legal (GDPR) de los usuarios que dejan su email en el formulario para cumplir normativas.

### Row Level Security (RLS)
El frontend de Campus se comunican a través del Cliente SSR de Supabase. Supabase inyecta automáticametne las "Cookies" generadas en `login` hacia la conexión de PostgreSQL. 

> [!TIP]
> **Regla RLS:** Un `Student` *únicamente* puede leer las filas de la BBDD donde su `id` coincida. Intentar hacer un SELECT global devolverá una matriz vacía sin crashear.

---

## 3. Webhooks & Bypass de Seguridad (Serverless APIs)

En `src/pages/api/`, Astro expone endpoints "Edge" desplegados como Cloudflare Workers. 

### /api/stripe-webhook.ts
*   **Misión:** Escuchar asíncronamente a los servidores de Stripe y actualizar a los estudiantes.
*   **Bypass:** Usa `SUPABASE_SERVICE_ROLE_KEY` (Cliente Admin). Esto ignora las políticas RLS. 
*   **Lógica:** Cuando llega `checkout.session.completed`, el script extrae los metadatos de Stripe para buscar al Alumno, crea su suscripción en Postgres, y manda un email de bienvenida.

### /api/subscribe.ts
*   **Misión:** Recibir los embudos Lead Magnet desde el Footer y la Landing Page (*React Island*).
*   **Validación Dual:** Primero comprueba el token inyectado por `@marsidev/react-turnstile` mandándolo a Cloudflare `siteverify` para cazar bots. Si es humano, usa el Service Role para meter al lead en BBDD y lanza un Resend.

---

## 4. Estructura de Roles del Sistema (Middlewares Reales)

El acceso al campus está estrictamente segregado leyendo el `role` de la tabla `profiles` en **Server Side**. El usuario no ve parpadeos de redirección, la pantalla ni siquiera compila el DOM si no tienes permiso.

*   `admin/index.astro`: Si el perfíl devuelto no es `role === 'admin'`, se destruye la request devolviendo Status 302 y derivando a `/campus`. Tiene omnipotencia para ver la facturación y los listados puros.
*   `teacher/index.astro`: Verifica que el role sea `teacher` o `admin`. Accede mediante JOINs a la tabla `student_teachers` para ver única y exclusivamente a SU cartera de clientes, y las sesiones relativas a ellos.
*   `campus/account.astro`: Panel base. Únicamente puede ver las columnas de `subscriptions` donde su propio ID cuadra en PostgreSQL.

---

## 5. El Blog y CMS Git-Based (Keystatic)

Para evitar inflar la BBDD tabular de Supabase con HTML y rich-text, los Artículos del Blog viven físicamente en el repositorio (Dentro de `src/content/blog`).

A esto se le suma el sistema **Keystatic**: Al entrar a `/keystatic` en local, levantas un mini-panel de control (React Admin) configurado por `keystatic.config.ts`. Este panel parsea los `.mdx`, te permite subir fotos y escribir artículos visualmente. 
Al darle a guardar, Keystatic escribe el archivo markdown directamente en el disco duro para que hagas Commits. 
Astro lo compila como estático (SSG) y lo sirve por 0ms desde Cloudflare. Pura eficiencia.

---

## 6. Automatizaciones de Google Workspace

El sistema se integra de manera profunda con el ecosistema de Google mediante una **Service Account con Delegación de Dominio**, lo que permite actuar en nombre del usuario Administrador sin requerir OAuth interactivo.

### Funciones Principales:
*   **Google Drive (`src/lib/google/drive.ts`):** 
    *   Genera carpetas organizadas para estudiantes de forma manual mediante el endpoint `/api/google/create-student-folder`.
    *   Por cada sesión agendada, clona automáticamente un "Documento de Clase" base vinculándolo a la carpeta de Drive del alumno específico.
*   **Google Calendar y Meet (`src/lib/google/calendar.ts`):**
    *   Almacena las sesiones de clase creando eventos de Cloudflare a Google Calendar.
    *   Genera automáticamente el enlace de videollamada de **Google Meet** que es enviado al correo del alumno y profesor, y adjuntado en la sesión de Supabase.
*   **Procesamiento de Grabaciones (`src/lib/google/recordings.ts`):**
    *   Busca grabaciones terminadas en Google Meet y genera accesos directos de la grabación enlazándolos dentro del Documento de Clase (Google Docs) de la sesión correspondiente.

> [!NOTE]
> Esta arquitectura garantiza que todo el material de clase (apuntes en Docs y grabaciones de Meet) residan siempre bajo la propiedad del correo administrador especificado en `GOOGLE_ADMIN_EMAIL`.

---

## 7. Tareas Programadas (Cron Jobs)

Existen rutinas de Backend asíncronas para el mantenimiento de los estudiantes y el Campus.

### `src/pages/api/cron/send-reminders.ts`
*   **Misión:** Buscar en Supabase de forma automatizada las sesiones programadas (*scheduled*) que van a ocurrir en las próximas horas.
*   **Acción:** Genera y envía por Resend un "Email de Recordatorio de Clase" con los enlaces de Google Meet tanto al profesor involucrado como al estudiante.
*   **Despliegue:** Preparado para integrarse con Cloudflare Cron Triggers u otros invocadores HTTP externos mediante un Bearer Token.
