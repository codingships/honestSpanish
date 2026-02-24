# Arquitectura y Reglas de Desarrollo (Español Honesto)

Este documento centraliza el conocimiento del proyecto `espanol-honesto-web` para que los desarrolladores y agentes de IA puedan continuar construyendo de manera segura sin romper la estructura principal.

---

## 🏗️ 1. Core Stack y Reglas de Oro

1.  **Astro + React Híbrido:** 
    *   Este es un proyecto Astro 5 en modo SSR (Server-Side Rendering). 
    *   **Regla estricta:** Solo usamos componentes de React (`.tsx`) cuando necesitamos interactividad en el cliente (ej. Dashboards, Formularios, Calendarios). Las páginas (`.astro`) y el layout principal deben escribirse en código Astro puro para maximizar el rendimiento.
2.  **Alojamiento en el Edge:** 
    *   La app corre íntegramente en Cloudflare Pages usando el adaptador oficial `@astrojs/cloudflare`. Todo endpoint de `/api` es en realidad una Cloudflare Function ejecutándose en el Edge.
3.  **Estilos:** 
    *   Usamos **Tailwind CSS**. No instales librerías de componentes UI pesadas (como Material-UI), CSS-in-JS, ni CSS Modules.
    *   Toda la marca gira en torno a estos colores clave presentes en el tailwind.config: Crimson (`#6A131C`) y Amarillo Flúor (`#F6FE51`).
4.  **i18n (Internacionalización):** 
    *   *No instales `i18next` ni ninguna librería externa para traducciones.* 
    *   Tenemos un sistema propio, ultra-ligero basado en rutas dinámicas (`src/pages/[lang]`). Los idiomas disponibles son `es`, `en`, `ru`.
    *   Los textos de la interfaz viven centralizados en un único diccionario: `src/i18n/translations.ts`.

---

## 🗄️ 2. Base de Datos, Roles y Autenticación (Supabase)

La base de datos PostgreSQL está hosteada en Supabase y **tiene RLS (Row Level Security) estricto activo en todas sus tablas.**

### 👥 Jerarquía de Roles de Usuario
Existen 3 roles inmutables controlados por la tabla `profiles` (columna `role`):

1.  **`student`**: Nivel base. Solo tienen acceso a `/campus` y pueden ver/cancelar *sus propias clases* asociadas, así como navegar por su propio material compartido.
2.  **`teacher`**: Profesores contratados. Acceden a `/campus/teacher` para definir su disponibilidad, ver el listado de alumnos a los que "tutorizan" y escribir notas (`teacher_notes`) sobre su progreso.
3.  **`admin`**: Nivel maestro. Acceden a `/campus/admin`. Su tarea es asignar parejas (Student <=> Teacher), dar de alta o revocar accesos a profesores y revisar volumen de facturación.

### 🛡️ Autenticación y Carga Híbrida
*   El servidor utiliza **SSR (Server-Side Rendering)**. Es decir, las cookies (`sb-access-token`) y la validación Auth ocurren *antes* de que se pinte la página, evaluando los roles en middlewares y en el inicio del SSR. **Evitamos guardar la sesión exclusivamente en LocalStorage.**
*   El archivo crítico responsable del chequeo global es: `src/pages/api/auth/post-login.ts` el cual redirige (302) a `/campus`, `/campus/teacher` o `/campus/admin` en base al rol que descubra en Supabase.

---

## 🔌 3. Integración de Servicios Externos

### 💳 A) Stripe (Facturación)
*   **Modelo de Negocio:** Suscripción mensual (recurrente). El estudiante contrata un nivel (Essential, Intensive, Premium) que le otorga una "bolsa" de clases disponibles al mes baseadas en `packages`.
*   **Seguridad:** Nadie escribe en la BBDD sobre pagos de forma manual. Todo lo que tiene que ver con facturas o activar cuentas lo tramitan en la sombra los **Stripe Webhooks** (`src/pages/api/stripe-webhook.ts`). 

### 📅 B) Ecosistema de Google Workspace
Se utiliza un Service Account de Google Cloud con permisos Domain Wide Delegation delegados e impersonando a `calendar@espanolhonesto.com`. No hay OAuth de usuario final; la plataforma es la dueña del ecosistema de Google.

*   **Google Calendar API (`src/lib/google/calendar.ts`):** 
    *   Cuando un estudiante o profesor programa una clase, el servidor automáticamente inyecta la invitación en el calendario del Profesor, añade al estudiante y genera el Google Meet Link sincrónicamente.
*   **Google Drive API (`src/lib/google/drive.ts`):** 
    *   Al crearse una cuenta, el sistema crea automáticamente una carpeta en la nube llamada "Nombre_del_alumno - Español Honesto".
    *   Dentro de esa carpeta, clona en milisegundos una "Plantilla de Clase" de Google Docs que sirve como repositorio compartido bidireccional entre el alumno y su tutor.

### ✉️ C) Resend (Emails)
*   **Ubicación:** `src/lib/email`. Emite correos transaccionales desde `alejandro@espanolhonesto.com`.
*   **Cronjob:** Tenemos una automatización (Cron) en `src/pages/api/cron/send-reminders.ts`. Éste se despliega en Cloudflare, y cada día busca en Supabase las clases que empiezan en "24 horas" para enviarle un recordatorio simultáneo al maestro y al alumno, a fin de minimizar olvidances (no-shows).

---

## 🧪 4. Pruebas y CI/CD (Testing)

Antes de fusionar código o proponer nuevas pull requests, la Integración Continua (GitHub Actions) espera que **2 Suites principales terminen en verde**, cubriendo cerca de 100 pruebas diferentes:

1.  **Vitest (`npm run test:run`)**: Verifica la robustez modular de los Hooks Reactivos, componentes lógicos complejos (ej: `TeacherCalendar.tsx`, `StudentClassList.tsx`), los interceptores SSR y los APIs de utilidades y de Supabase.
2.  **Playwright (`npm run test:e2e`)**: Corre 4 tests simultáneos montando navegadores headless. Verifica la Landing general, el Login y garantiza que un `student` jamás pueda entrar al panel de `teacher` (testeando los perfiles `.auth` previamente grabados).

*Siempre* que se modifique lógica de UI o ruteo, es mandatorio comprobar localmente la suit usando **`npm run test:all`**.
