# 🗺️ Estructura de Enlaces - Español Honesto

> Mapa exhaustivo de todas las rutas y endpoints de la aplicación.

## 📁 Estructura de Directorios

```
src/pages/
├── 404.astro                    # Página de error 404
├── index.astro                  # Raíz (redirect a /es)
│
├── es/                          # Landing estático español
│   └── index.astro
├── en/                          # Landing estático inglés
│   └── index.astro  
├── ru/                          # Landing estático ruso
│   └── index.astro
│
├── [lang]/                      # Rutas dinámicas con idioma
│   ├── login.astro
│   ├── logout.astro
│   ├── success.astro            # Post-pago exitoso
│   ├── cancel.astro             # Post-pago cancelado
│   ├── legal.astro
│   │
│   ├── legal/
│   │   ├── aviso-legal.astro
│   │   ├── cookies.astro
│   │   └── privacidad.astro
│   │
│   ├── blog/
│   │   ├── index.astro          # Lista de posts
│   │   ├── [slug].astro         # Post individual
│   │   └── rss.xml.ts           # Feed RSS
│   │
│   └── campus/                  # 🔐 ÁREA PROTEGIDA
│       ├── index.astro          # Dashboard estudiante
│       ├── classes.astro        # Clases del estudiante
│       ├── account.astro        # Mi cuenta
│       │
│       ├── teacher/             # 🔐 SOLO PROFESOR/ADMIN
│       │   ├── index.astro      # Dashboard profesor
│       │   ├── calendar.astro   # Calendario profesor
│       │   └── student/
│       │       └── [id].astro   # Detalle estudiante
│       │
│       └── admin/               # 🔐 SOLO ADMIN
│           ├── index.astro      # Dashboard admin
│           ├── calendar.astro   # Calendario global
│           ├── students.astro   # Lista estudiantes
│           ├── payments.astro   # Historial pagos
│           └── student/
│               └── [id].astro   # Detalle estudiante (admin)
│
└── api/                         # 🔌 ENDPOINTS API
    ├── create-checkout.ts       # Crear sesión Stripe
    ├── stripe-webhook.ts        # Webhook de Stripe
    ├── update-student-notes.ts  # Actualizar notas
    │
    ├── account/
    │   ├── create-portal-session.ts  # Portal Stripe
    │   └── update-profile.ts         # Actualizar perfil
    │
    ├── admin/
    │   ├── assign-teacher.ts    # Asignar profesor
    │   └── remove-teacher.ts    # Quitar profesor
    │
    ├── calendar/
    │   ├── available-slots.ts   # Horarios disponibles
    │   ├── sessions.ts          # CRUD sesiones
    │   └── session-action.ts    # Acciones sobre sesión
    │
    ├── teacher/
    │   └── availability.ts      # Disponibilidad profesor
    │
    ├── google/
    │   ├── create-student-folder.ts  # Crear carpeta Drive
    │   └── process-recording.ts      # Procesar grabación
    │
    └── email/
        └── send-test.ts         # Email de prueba
```

---

## 🌐 PÁGINAS PÚBLICAS

| URL | Descripción | Archivo |
|-----|-------------|---------|
| `/` | Redirect → `/es` | `index.astro` |
| `/es` | Landing español | `es/index.astro` |
| `/en` | Landing inglés | `en/index.astro` |
| `/ru` | Landing ruso | `ru/index.astro` |

---

## 🔐 AUTENTICACIÓN

| URL | Método | Descripción |
|-----|--------|-------------|
| `/{lang}/login` | GET | Formulario login/registro |
| `/{lang}/logout` | GET | Cerrar sesión |

**Idiomas válidos**: `es`, `en`, `ru`

---

## 💳 PAGOS (STRIPE)

| URL | Descripción |
|-----|-------------|
| `/{lang}/success` | Página post-pago exitoso |
| `/{lang}/cancel` | Página post-pago cancelado |

---

## 📜 LEGAL

| URL | Descripción |
|-----|-------------|
| `/{lang}/legal` | Índice de páginas legales |
| `/{lang}/legal/aviso-legal` | Aviso legal |
| `/{lang}/legal/privacidad` | Política de privacidad |
| `/{lang}/legal/cookies` | Política de cookies |

---

## 📝 BLOG

| URL | Descripción |
|-----|-------------|
| `/{lang}/blog` | Lista de artículos |
| `/{lang}/blog/{slug}` | Artículo individual |
| `/{lang}/blog/rss.xml` | Feed RSS |

---

## 👨‍🎓 CAMPUS - ESTUDIANTE

> Requiere: `role = student` (o superior)

| URL | Descripción |
|-----|-------------|
| `/{lang}/campus` | Dashboard del estudiante |
| `/{lang}/campus/classes` | Mis clases (próximas + historial) |
| `/{lang}/campus/account` | Mi cuenta (perfil + suscripción) |

---

## 👨‍🏫 CAMPUS - PROFESOR

> Requiere: `role = teacher` o `role = admin`

| URL | Descripción |
|-----|-------------|
| `/{lang}/campus/teacher` | Dashboard profesor (lista estudiantes) |
| `/{lang}/campus/teacher/calendar` | Calendario del profesor |
| `/{lang}/campus/teacher/student/{id}` | Detalle de estudiante |

---

## 👑 CAMPUS - ADMIN

> Requiere: `role = admin`

| URL | Descripción |
|-----|-------------|
| `/{lang}/campus/admin` | Dashboard admin (métricas globales) |
| `/{lang}/campus/admin/calendar` | Calendario global (todos los profesores) |
| `/{lang}/campus/admin/students` | Gestión de estudiantes |
| `/{lang}/campus/admin/payments` | Historial de pagos |
| `/{lang}/campus/admin/student/{id}` | Detalle estudiante (con asignación profesor) |

---

## 🔌 API ENDPOINTS

### Pagos (Stripe)

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/create-checkout` | POST | Crear sesión de checkout |
| `/api/stripe-webhook` | POST | Webhook de eventos Stripe |

### Cuenta

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/account/update-profile` | POST | Actualizar perfil usuario |
| `/api/account/create-portal-session` | POST | Crear portal Stripe |

### Admin

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/admin/assign-teacher` | POST | Asignar profesor a estudiante |
| `/api/admin/remove-teacher` | POST | Quitar asignación profesor |

### Calendario / Sesiones

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/calendar/sessions` | GET | Obtener sesiones |
| `/api/calendar/sessions` | POST | Crear sesión |
| `/api/calendar/sessions` | PATCH | Actualizar sesión |
| `/api/calendar/sessions` | DELETE | Eliminar sesión |
| `/api/calendar/session-action` | POST | Acciones (completar, no-show, cancelar) |
| `/api/calendar/available-slots` | GET | Obtener horarios disponibles |

### Profesor

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/teacher/availability` | GET/POST | Gestionar disponibilidad |

### Google Integration

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/google/create-student-folder` | POST | Crear carpeta en Drive |
| `/api/google/process-recording` | POST | Procesar grabación Meet |

### Otros

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/update-student-notes` | POST | Notas internas profesor → estudiante |
| `/api/email/send-test` | POST | Enviar email de prueba |

---

## 🔄 FLUJO DE REDIRECCIÓN POST-LOGIN

```mermaid
flowchart TD
    A[Usuario hace login] --> B{AuthForm.jsx}
    B --> C[window.location.href = /${lang}/campus]
    C --> D[/lang/campus/index.astro]
    D --> E{Verificar rol}
    E -->|student| F[Mostrar dashboard estudiante]
    E -->|teacher| G[Redirect → /${lang}/campus/teacher]
    E -->|admin| H[Redirect → /${lang}/campus/admin]
    
    G --> I[403 si no es teacher/admin]
    H --> J[403 si no es admin]
```

---

## 🛡️ MIDDLEWARE - Control de Acceso

Archivo: `src/middleware.ts`

| Ruta | Sin login | Estudiante | Profesor | Admin |
|------|-----------|------------|----------|-------|
| `/{lang}/login` | ✅ | Redirect a su área | Redirect a su área | Redirect a su área |
| `/{lang}/campus` | Redirect a login | ✅ | Redirect a teacher | Redirect a admin |
| `/{lang}/campus/teacher/*` | Redirect a login | Redirect a campus | ✅ | ✅ |
| `/{lang}/campus/admin/*` | Redirect a login | Redirect a campus | Redirect a teacher | ✅ |

---

## ⚠️ BUG CONOCIDO

**Redirección doble para profesor/admin:**

Cuando un profesor o admin hace login:
1. `AuthForm.jsx` redirige a `/{lang}/campus` ✅
2. `campus/index.astro` detecta rol y redirige a `/{lang}/campus/teacher` o `/{lang}/campus/admin`
3. **El navegador a veces pierde el prefijo de idioma** → termina en `/campus` (404)

**Workaround:** Navegar directamente a `/{lang}/campus/teacher` o `/{lang}/campus/admin`
