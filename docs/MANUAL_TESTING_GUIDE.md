# 🧪 Guía Exhaustiva de Pruebas Manuales - Español Honesto

> **Objetivo**: Verificar que todas las funcionalidades de la plataforma funcionan correctamente desde la perspectiva del usuario.

## 📋 Requisitos Previos

### Usuarios de Prueba
| Rol | Email | Contraseña |
|-----|-------|------------|
| Estudiante | `test-student@espanolhonesto.com` | `TestPassword123!` |
| Profesor | `test-teacher@espanolhonesto.com` | `TestPassword123!` |
| Admin | `test-admin@espanolhonesto.com` | `TestPassword123!` |

### URLs Base
- **Local**: `http://localhost:4321`
- **Staging**: (añadir cuando exista)
- **Producción**: `https://espanolhonesto.com`

---

## 1️⃣ LANDING PAGE Y NAVEGACIÓN PÚBLICA

### 1.1 Landing Page (`/es`, `/en`, `/ru`)

| # | Acción | Resultado Esperado | ✓/✗ |
|---|--------|-------------------|-----|
| 1.1.1 | Abrir `/es` | La página carga con textos en español |  |
| 1.1.2 | Abrir `/en` | La página carga con textos en inglés |  |
| 1.1.3 | Abrir `/ru` | La página carga con textos en ruso |  |
| 1.1.4 | Scroll hasta la sección "Método" | Se muestra la sección con 3 columnas (Clase invertida, Spacing Effect, Situaciones reales) |  |
| 1.1.5 | Scroll hasta "Progreso" | Se muestran los 4 milestones (Mes 1-2, 3-4, 5-7, 8-10) |  |
| 1.1.6 | Scroll hasta "Equipo" | Se muestran los perfiles de Alejandro y Alin |  |
| 1.1.7 | Scroll hasta "FAQ" | Se muestran 6 preguntas frecuentes expandibles |  |
| 1.1.8 | Hacer clic en una pregunta FAQ | Se expande mostrando la respuesta |  |
| 1.1.9 | Scroll hasta "Planes" | Se muestran 3 planes (Esencial, Intensivo, Premium) |  |

### 1.2 Selector de Idioma

| # | Acción | Resultado Esperado | ✓/✗ |
|---|--------|-------------------|-----|
| 1.2.1 | Desde `/es`, cambiar a EN | Redirige a `/en`, contenido en inglés |  |
| 1.2.2 | Desde `/en`, cambiar a RU | Redirige a `/ru`, contenido en ruso |  |
| 1.2.3 | Desde `/ru`, cambiar a ES | Redirige a `/es`, contenido en español |  |

### 1.3 Navegación Principal

| # | Acción | Resultado Esperado | ✓/✗ |
|---|--------|-------------------|-----|
| 1.3.1 | Clic en "Método" | Scroll suave a la sección del método |  |
| 1.3.2 | Clic en "Progreso" | Scroll suave a la sección de progreso |  |
| 1.3.3 | Clic en "Planes" | Scroll suave a la sección de precios |  |
| 1.3.4 | Clic en "FAQ" | Scroll suave a la sección de FAQ |  |
| 1.3.5 | Clic en "Login" | Navega a `/es/login` |  |
| 1.3.6 | Clic en "Empieza ahora" | Scroll a planes o abre modal |  |

---

## 2️⃣ AUTENTICACIÓN

### 2.1 Login

| # | Acción | Resultado Esperado | ✓/✗ |
|---|--------|-------------------|-----|
| 2.1.1 | Abrir `/es/login` | Formulario de login visible con campos email y contraseña |  |
| 2.1.2 | Intentar login con campos vacíos | Validación HTML5 impide envío |  |
| 2.1.3 | Login con email inválido | Validación HTML5 para formato email |  |
| 2.1.4 | Login con credenciales incorrectas | Error: "Email o contraseña incorrectos" |  |
| 2.1.5 | Login como **estudiante** (correcto) | Redirige a `/es/campus` |  |
| 2.1.6 | Login como **profesor** (correcto) | Redirige a `/es/campus/teacher` |  |
| 2.1.7 | Login como **admin** (correcto) | Redirige a `/es/campus/admin` |  |
| 2.1.8 | Clic en "¿No tienes cuenta?" | El formulario cambia a modo registro |  |

### 2.2 Registro

| # | Acción | Resultado Esperado | ✓/✗ |
|---|--------|-------------------|-----|
| 2.2.1 | Cambiar a modo registro | Título cambia a "Registrarse" |  |
| 2.2.2 | Registrar con email ya existente | Error: "Este email ya está registrado" |  |
| 2.2.3 | Registrar con contraseña débil | Error de validación (mínimo 6 caracteres) |  |
| 2.2.4 | Registro exitoso | Mensaje "Cuenta creada. Revisa tu email." O login automático |  |

### 2.3 Logout

| # | Acción | Resultado Esperado | ✓/✗ |
|---|--------|-------------------|-----|
| 2.3.1 | Clic en "Cerrar sesión" | Redirige a `/es` o `/es/login` |  |
| 2.3.2 | Intentar acceder a `/es/campus` después de logout | Redirige a `/es/login` |  |

### 2.4 Edge Cases de Autenticación

| # | Acción | Resultado Esperado | ✓/✗ |
|---|--------|-------------------|-----|
| 2.4.1 | Acceder a `/es/campus` sin login | Redirige a `/es/login` |  |
| 2.4.2 | Acceder a `/es/campus/teacher` como estudiante | Redirige a `/es/campus` |  |
| 2.4.3 | Acceder a `/es/campus/admin` como profesor | Redirige a `/es/campus/teacher` |  |
| 2.4.4 | Acceder a `/es/campus/admin` como estudiante | Redirige a `/es/campus` |  |
| 2.4.5 | Usuario ya logueado accede a `/es/login` | Redirige a su área correspondiente |  |

---

## 3️⃣ PANEL DE ESTUDIANTE

### 3.1 Dashboard (`/es/campus`)

| # | Acción | Resultado Esperado | ✓/✗ |
|---|--------|-------------------|-----|
| 3.1.1 | Acceder al dashboard | Se muestra: Plan, Sesiones, Próxima clase, Drive |  |
| 3.1.2 | **Con suscripción activa**: Ver tarjeta "Tu plan" | Muestra nombre del plan, estado "Active", fecha expiración |  |
| 3.1.3 | **Sin suscripción**: Ver tarjeta "Tu plan" | Muestra "No tienes un plan activo" + botón "Ver planes" |  |
| 3.1.4 | Clic en "Ver planes" (sin plan) | Redirige a landing `/#pricing` |  |
| 3.1.5 | **Con sesiones**: Ver contador de sesiones | Muestra X/Y usadas con barra de progreso |  |
| 3.1.6 | **Con clase programada**: Ver "Próxima clase" | Muestra fecha, hora, nombre del profesor |  |
| 3.1.7 | **Sin clases**: Ver "Próxima clase" | "Aún no tienes clases programadas" |  |
| 3.1.8 | **Con carpeta Drive**: Clic "Abrir carpeta" | Abre Google Drive en nueva pestaña |  |
| 3.1.9 | **Sin carpeta Drive**: Ver Drive | "Tu carpeta se creará pronto" |  |

### 3.2 Mis Clases (`/es/campus/classes`)

| # | Acción | Resultado Esperado | ✓/✗ |
|---|--------|-------------------|-----|
| 3.2.1 | Abrir página de clases | Se muestran tabs "Próximas" y "Historial" |  |
| 3.2.2 | Tab "Próximas" activo por defecto | Lista de clases futuras (o mensaje vacío) |  |
| 3.2.3 | Clic en tab "Historial" | Muestra clases pasadas |  |
| 3.2.4 | **Clase próxima (<15min)**: Ver botón | "Unirse a la clase" habilitado |  |
| 3.2.5 | **Clase próxima (>15min)**: Ver botón | "Link disponible 15 min antes" |  |
| 3.2.6 | Clic en "Unirse a la clase" | Abre Google Meet en nueva pestaña |  |
| 3.2.7 | Clic en "Cancelar" en una clase | Abre modal de confirmación |  |
| 3.2.8 | Confirmar cancelación | La clase desaparece de "Próximas", sesión se devuelve |  |
| 3.2.9 | Cancelar cancelación | Modal se cierra, clase permanece |  |

### 3.3 Edge Cases - Clases

| # | Acción | Resultado Esperado | ✓/✗ |
|---|--------|-------------------|-----|
| 3.3.1 | Cancelar clase con <24h de antelación | Verificar si hay restricción o warning |  |
| 3.3.2 | Ver clase pasada con estado "completada" | Muestra badge verde "Completada" |  |
| 3.3.3 | Ver clase pasada con estado "cancelada" | Muestra badge gris "Cancelada" |  |
| 3.3.4 | Ver clase pasada con estado "no asistió" | Muestra badge rojo "No asistió" |  |
| 3.3.5 | Ver notas del profesor en clase pasada | Si hay notas, se muestran correctamente |  |

### 3.4 Mi Cuenta (`/es/campus/account`)

| # | Acción | Resultado Esperado | ✓/✗ |
|---|--------|-------------------|-----|
| 3.4.1 | Abrir página de cuenta | Formulario con nombre, email, teléfono, idioma |  |
| 3.4.2 | Editar nombre y guardar | Mensaje "Cambios guardados" |  |
| 3.4.3 | Editar teléfono y guardar | Se actualiza correctamente |  |
| 3.4.4 | **Con suscripción**: Clic "Gestionar pagos" | Abre Stripe Customer Portal |  |
| 3.4.5 | **Sin suscripción**: Ver sección de pagos | No hay botón o mensaje apropiado |  |

---

## 4️⃣ PANEL DE PROFESOR

### 4.1 Dashboard (`/es/campus/teacher`)

| # | Acción | Resultado Esperado | ✓/✗ |
|---|--------|-------------------|-----|
| 4.1.1 | Acceder como profesor | Se muestra panel con estadísticas de estudiantes |  |
| 4.1.2 | Ver contador "Total estudiantes" | Número correcto de estudiantes asignados |  |
| 4.1.3 | Buscar estudiante por nombre | Lista se filtra en tiempo real |  |
| 4.1.4 | Clic en "Ver detalles" de un estudiante | Navega a `/es/campus/teacher/student/[id]` |  |
| 4.1.5 | **Sin estudiantes**: Ver mensaje | "No tienes estudiantes asignados todavía" |  |

### 4.2 Detalle de Estudiante (`/es/campus/teacher/student/[id]`)

| # | Acción | Resultado Esperado | ✓/✗ |
|---|--------|-------------------|-----|
| 4.2.1 | Ver información del estudiante | Nombre, email, plan actual, sesiones |  |
| 4.2.2 | Escribir notas y "Guardar notas" | Mensaje "Notas guardadas", notas persisten |  |
| 4.2.3 | Clic en "Abrir carpeta" | Abre Drive del estudiante |  |
| 4.2.4 | Clic en "Volver a mis estudiantes" | Navega a `/es/campus/teacher` |  |
| 4.2.5 | **Estudiante sin plan**: Ver info | Plan muestra "Sin plan" |  |

### 4.3 Calendario del Profesor (`/es/campus/teacher/calendar`)

| # | Acción | Resultado Esperado | ✓/✗ |
|---|--------|-------------------|-----|
| 4.3.1 | Abrir calendario | Vista semanal con clases programadas |  |
| 4.3.2 | Navegar semana anterior | Flechas funcionan, fechas cambian |  |
| 4.3.3 | Navegar semana siguiente | Flechas funcionan, fechas cambian |  |
| 4.3.4 | Clic en "Programar clase" | Abre modal de programación |  |
| 4.3.5 | Completar modal: seleccionar estudiante | Dropdown muestra estudiantes asignados |  |
| 4.3.6 | Seleccionar fecha futura | Calendar picker funciona |  |
| 4.3.7 | Seleccionar horario disponible | Horarios disponibles visibles |  |
| 4.3.8 | Confirmar programación | Clase aparece en calendario, notificación |  |
| 4.3.9 | Clic en una clase existente | Abre modal de detalle de sesión |  |

### 4.4 Modal de Detalle de Sesión (Profesor)

| # | Acción | Resultado Esperado | ✓/✗ |
|---|--------|-------------------|-----|
| 4.4.1 | Ver información de la sesión | Nombre estudiante, email, fecha, hora, estado |  |
| 4.4.2 | Ver link de Meet | Link clickable, abre Meet |  |
| 4.4.3 | "Marcar completada" | Estado cambia a "Completada", badge verde |  |
| 4.4.4 | "Marcar no asistió" | Estado cambia a "No asistió", badge rojo |  |
| 4.4.5 | "Cancelar clase" | Modal de confirmación, clase se cancela |  |
| 4.4.6 | Añadir notas de clase | Notas se guardan y persisten |  |

### 4.5 Edge Cases - Profesor

| # | Acción | Resultado Esperado | ✓/✗ |
|---|--------|-------------------|-----|
| 4.5.1 | Programar clase en pasado | No debería permitirse |  |
| 4.5.2 | Programar clase en horario ocupado | Horario no disponible o error |  |
| 4.5.3 | Acceder a estudiante no asignado | Error 403 o redirección |  |
| 4.5.4 | Cancelar clase que ya fue completada | No debería permitirse |  |

---

## 5️⃣ PANEL DE ADMIN

### 5.1 Dashboard Admin (`/es/campus/admin`)

| # | Acción | Resultado Esperado | ✓/✗ |
|---|--------|-------------------|-----|
| 5.1.1 | Acceder como admin | Panel con métricas globales |  |
| 5.1.2 | Ver "Revenue este mes" | Cantidad en € correcta |  |
| 5.1.3 | Ver "Estudiantes totales" | Contador correcto |  |
| 5.1.4 | Ver "Suscripciones activas" | Contador correcto |  |
| 5.1.5 | Ver "Profesores" | Contador correcto |  |
| 5.1.6 | Ver gráfico de suscripciones por plan | Barras/donut mostrando distribución |  |
| 5.1.7 | Ver últimos pagos | Lista de transacciones recientes |  |

### 5.2 Gestión de Estudiantes (`/es/campus/admin/students`)

| # | Acción | Resultado Esperado | ✓/✗ |
|---|--------|-------------------|-----|
| 5.2.1 | Abrir lista de estudiantes | Tabla con todos los estudiantes |  |
| 5.2.2 | Filtrar por "Con plan activo" | Solo muestra estudiantes con suscripción |  |
| 5.2.3 | Filtrar por "Sin plan" | Solo estudiantes sin suscripción |  |
| 5.2.4 | Buscar por nombre/email | Resultados filtrados en tiempo real |  |
| 5.2.5 | Clic en un estudiante | Navega a detalle del estudiante |  |

### 5.3 Detalle de Estudiante Admin (`/es/campus/admin/student/[id]`)

| # | Acción | Resultado Esperado | ✓/✗ |
|---|--------|-------------------|-----|
| 5.3.1 | Ver información completa | Nombre, email, plan, profesor asignado |  |
| 5.3.2 | Clic "Asignar profesor" | Abre modal de asignación |  |
| 5.3.3 | Seleccionar profesor del dropdown | Lista de profesores disponibles |  |
| 5.3.4 | Marcar "Profesor principal" | Checkbox funciona |  |
| 5.3.5 | Confirmar asignación | Profesor aparece en el perfil |  |
| 5.3.6 | "Quitar asignación" | Profesor se elimina del estudiante |  |

### 5.4 Historial de Pagos (`/es/campus/admin/payments`)

| # | Acción | Resultado Esperado | ✓/✗ |
|---|--------|-------------------|-----|
| 5.4.1 | Abrir historial de pagos | Tabla con todas las transacciones |  |
| 5.4.2 | Filtrar "Este mes" | Solo transacciones del mes actual |  |
| 5.4.3 | Filtrar "Últimos 3 meses" | Transacciones de 3 meses |  |
| 5.4.4 | Filtrar "Todo" | Todas las transacciones |  |
| 5.4.5 | Ver métricas: Total, Transacciones, Ticket medio | Valores correctos |  |
| 5.4.6 | Clic "Ver en Stripe" de un pago | Abre Stripe Dashboard |  |
| 5.4.7 | Ver badges de estado | Exitoso (verde), Fallido (rojo), Reembolsado (gris) |  |

### 5.5 Calendario Global (`/es/campus/admin/calendar`)

| # | Acción | Resultado Esperado | ✓/✗ |
|---|--------|-------------------|-----|
| 5.5.1 | Abrir calendario global | Vista de todas las clases de todos los profesores |  |
| 5.5.2 | Filtrar por profesor | Solo clases del profesor seleccionado |  |
| 5.5.3 | Ver estadísticas del mes | Total, Completadas, Programadas, Canceladas |  |
| 5.5.4 | Programar clase manualmente | Modal permite seleccionar profesor + estudiante |  |
| 5.5.5 | Clic en una clase | Abre modal de detalle |  |

---

## 6️⃣ SISTEMA DE PAGOS (STRIPE)

### 6.1 Flujo de Compra desde Landing

| # | Acción | Resultado Esperado | ✓/✗ |
|---|--------|-------------------|-----|
| 6.1.1 | Clic en "Seleccionar" en plan Esencial | Abre modal de selección de duración |  |
| 6.1.2 | Ver opciones: 1 mes, 3 meses, 6 meses | Precios correctos, descuentos mostrados |  |
| 6.1.3 | **Sin login**: Clic "Continuar al pago" | Redirige a login con redirect a pricing |  |
| 6.1.4 | **Con login**: Clic "Continuar al pago" | Redirige a Stripe Checkout |  |
| 6.1.5 | Completar pago en Stripe (test) | Redirige a `/es/success` |  |
| 6.1.6 | Ver página de éxito | "¡Gracias por tu compra!" + enlace al campus |  |
| 6.1.7 | Cancelar en Stripe Checkout | Redirige a `/es/cancel` |  |

### 6.2 Tarjetas de Test de Stripe

| Tarjeta | Resultado |
|---------|-----------|
| `4242 4242 4242 4242` | Pago exitoso |
| `4000 0000 0000 0002` | Pago rechazado |
| `4000 0000 0000 9995` | Fondos insuficientes |

### 6.3 Webhook de Stripe

| # | Acción | Resultado Esperado | ✓/✗ |
|---|--------|-------------------|-----|
| 6.3.1 | Pago completado exitosamente | Suscripción creada en BD, sesiones asignadas |  |
| 6.3.2 | Verificar en campus del estudiante | Plan aparece como activo |  |
| 6.3.3 | Verificar contador de sesiones | Sesiones correctas según plan |  |

---

## 7️⃣ INTEGRACIÓN GOOGLE

### 7.1 Creación de Carpeta de Estudiante

| # | Acción | Resultado Esperado | ✓/✗ |
|---|--------|-------------------|-----|
| 7.1.1 | Admin asigna profesor a nuevo estudiante | Se crea carpeta en Drive |  |
| 7.1.2 | Verificar estructura en Drive | Carpeta raíz > Nivel > Ejercicios > Audio |  |
| 7.1.3 | Verificar permisos | Estudiante tiene acceso writer |  |

### 7.2 Creación de Eventos de Calendario

| # | Acción | Resultado Esperado | ✓/✗ |
|---|--------|-------------------|-----|
| 7.2.1 | Profesor programa clase | Evento creado en Google Calendar |  |
| 7.2.2 | Verificar evento tiene Meet | Link de Meet presente |  |
| 7.2.3 | Verificar asistentes | Profesor y estudiante invitados |  |
| 7.2.4 | Cancelar clase | Evento se elimina/cancela en Calendar |  |

---

## 8️⃣ RESPONSIVE Y ACCESIBILIDAD

### 8.1 Responsive Design

| # | Viewport | Acción | Resultado Esperado | ✓/✗ |
|---|----------|--------|-------------------|-----|
| 8.1.1 | Desktop (1920px) | Navegar landing | Layout correcto, sin overflow |  |
| 8.1.2 | Tablet (768px) | Navegar landing | Menú hamburguesa, layouts adaptados |  |
| 8.1.3 | Mobile (375px) | Navegar landing | Todo legible, sin scroll horizontal |  |
| 8.1.4 | Mobile | Abrir menú | Menú móvil se expande correctamente |  |
| 8.1.5 | Mobile | Usar formulario login | Inputs utilizables, botón visible |  |
| 8.1.6 | Mobile | Ver calendario | Scroll horizontal o adaptación móvil |  |

### 8.2 Accesibilidad

| # | Acción | Resultado Esperado | ✓/✗ |
|---|--------|-------------------|-----|
| 8.2.1 | Navegar con Tab | Focus visible en elementos interactivos |  |
| 8.2.2 | Usar lector de pantalla | Contenido anunciado correctamente |  |
| 8.2.3 | Verificar contraste | Texto legible sobre fondos |  |
| 8.2.4 | Verificar alt en imágenes | Imágenes tienen texto alternativo |  |

---

## 9️⃣ PÁGINAS LEGALES

| # | URL | Acción | Resultado Esperado | ✓/✗ |
|---|-----|--------|-------------------|-----|
| 9.1 | `/es/legal` | Abrir | Navegación a secciones legales |  |
| 9.2 | Aviso Legal | Leer | Contenido completo visible |  |
| 9.3 | Política de Privacidad | Leer | Contenido GDPR completo |  |
| 9.4 | Política de Cookies | Leer | Detalle de cookies usadas |  |

---

## 🔟 EDGE CASES CRÍTICOS

### 10.1 Sesiones y Límites

| # | Escenario | Resultado Esperado | ✓/✗ |
|---|-----------|-------------------|-----|
| 10.1.1 | Estudiante con 0 sesiones restantes | No puede programar más clases |  |
| 10.1.2 | Suscripción expirada | Acceso al campus pero sin funciones activas |  |
| 10.1.3 | Múltiples clases en el mismo día | Todas se muestran correctamente |  |

### 10.2 Errores de Red

| # | Escenario | Resultado Esperado | ✓/✗ |
|---|-----------|-------------------|-----|
| 10.2.1 | Perder conexión durante login | Error mostrado, no crash |  |
| 10.2.2 | Timeout de API | Mensaje de error amigable |  |
| 10.2.3 | 500 Error del servidor | Página de error genérica |  |

### 10.3 Concurrencia

| # | Escenario | Resultado Esperado | ✓/✗ |
|---|-----------|-------------------|-----|
| 10.3.1 | Dos profesores programan mismo slot | Uno falla con mensaje |  |
| 10.3.2 | Estudiante y profesor cancelan a la vez | Operación atómica, sin inconsistencias |  |

---

## ✅ Checklist Final

- [ ] Todos los flujos de estudiante funcionan
- [ ] Todos los flujos de profesor funcionan  
- [ ] Todos los flujos de admin funcionan
- [ ] Pagos con Stripe funcionan (modo test)
- [ ] Integración Google Drive funciona
- [ ] Integración Google Calendar funciona
- [ ] Sitio responsive en todos los breakpoints
- [ ] No hay errores en consola del navegador
- [ ] Traducciones completas en ES/EN/RU

---

*Última actualización: 2026-01-14*
