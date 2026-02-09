# Checklist de Pruebas - Español Honesto

## Pre-requisitos

- [ ] Variables de entorno configuradas (`.env`)
- [ ] `RESEND_API_KEY` válida con dominio verificado
- [ ] Google Service Account configurado con Domain-Wide Delegation
- [ ] Stripe en modo test
- [ ] Al menos 1 estudiante, 1 profesor y 1 admin en la BD
- [ ] Estudiante tiene suscripción activa

## 1. Flujo de Pago y Onboarding

### 1.1 Checkout de Stripe
- [ ] Ir a landing (`/es`) y seleccionar un paquete
- [ ] Completar checkout con tarjeta test `4242 4242 4242 4242`
- [ ] Redirect a `/es/success` con mensaje de éxito
- [ ] Ver logs del servidor: `[Webhook] Successfully processed payment`

### 1.2 Creación de carpeta en Drive
- [ ] Verificar carpeta creada en Drive del admin
- [ ] Estructura: `[Nombre] - [Email]` → A2, B1, B2, C1
- [ ] Cada nivel tiene: `Ejercicios/` → `Audio/` + Índice doc
- [ ] Carpeta compartida con email del estudiante
- [ ] `drive_folder_id` guardado en `profiles`

### 1.3 Email de bienvenida
- [ ] Estudiante recibe email en ~1 min
- [ ] Asunto: "¡Bienvenido/a a Español Honesto!"
- [ ] Link al campus funciona
- [ ] Link a carpeta Drive incluido (si se creó)

## 2. Programar una Clase

### 2.1 Crear sesión
- [ ] Login como profesor o admin
- [ ] Ir a Calendario → seleccionar slot
- [ ] Crear sesión con estudiante
- [ ] Ver en logs: `[Sessions] Created document for session...`

### 2.2 Documento de clase en Drive
- [ ] Documento creado copiando template
- [ ] Nombre: `DD/MM/YY - Ejercicios - [Nombre]`
- [ ] Ubicado en carpeta del nivel correcto
- [ ] Índice actualizado con link al documento

### 2.3 Evento en Google Calendar
- [ ] Evento creado en calendario admin
- [ ] Profesor y estudiante como invitados
- [ ] Hora correcta (timezone Europe/Madrid)
- [ ] Descripción incluye links a Meet y Doc

### 2.4 Google Meet
- [ ] Meet link generado automáticamente
- [ ] Visible en UI del campus (botón verde)
- [ ] Link funciona y permite unirse

### 2.5 Emails de confirmación
- [ ] Estudiante recibe confirmación
- [ ] Profesor recibe confirmación
- [ ] Links de Meet y documento incluidos

## 3. Recordatorios Automáticos (CRON)

### 3.1 Test manual del endpoint
```bash
curl -X GET http://localhost:4321/api/cron/send-reminders \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

- [ ] Responde con JSON de resultados
- [ ] Requiere auth (401 sin token)
- [ ] Encuentra sesiones 23-25h en el futuro
- [ ] Marca `reminder_sent = true`

### 3.2 Emails de recordatorio
- [ ] Estudiante recibe email
- [ ] Profesor recibe email
- [ ] Fecha/hora correctas (timezone español)
- [ ] Botones de Meet y Documento incluidos

## 4. Modificar/Cancelar Clase

### 4.1 Cancelar clase
- [ ] Cancelar desde UI o API
- [ ] Evento Calendar marcado como cancelado
- [ ] Emails de cancelación enviados
- [ ] Documento de Drive NO se elimina

## 5. UI del Campus

### 5.1 Dashboard Estudiante
- [ ] Próxima clase visible
- [ ] Botón Meet aparece 15 min antes
- [ ] Botón Documento siempre visible
- [ ] Clase pasada muestra notas del profesor

### 5.2 Dashboard Profesor
- [ ] Lista de clases del día
- [ ] Botones Meet y Documento funcionan
- [ ] Puede ver detalles del estudiante

### 5.3 Dashboard Admin
- [ ] Ve todos los estudiantes y profesores
- [ ] Puede asignar profesores a estudiantes
- [ ] Puede crear/cancelar clases

## 6. Endpoint de Prueba E2E

```bash
curl -X POST http://localhost:4321/api/test/full-class-flow \
  -H "Content-Type: application/json" \
  -H "Cookie: sb-access-token=..." \
  -d '{
    "studentId": "uuid-estudiante",
    "teacherId": "uuid-profesor",
    "startTime": "2026-01-25T10:00:00+01:00"
  }'
```

Respuesta esperada:
```json
{
  "success": true,
  "step1_session": { "created": true },
  "step2_driveDoc": { "success": true, "url": "..." },
  "step3_calendarEvent": { "success": true },
  "step4_meetLink": { "success": true, "url": "..." },
  "errors": []
}
```

## Datos de Prueba

| Dato | Valor |
|------|-------|
| Tarjeta Stripe | `4242 4242 4242 4242` |
| Expiración | Cualquier fecha futura |
| CVC | `123` |
| Email test | Usar tu email real para verificar |

## Troubleshooting

### Emails no llegan
1. Verificar `RESEND_API_KEY` en `.env`
2. Verificar dominio en [Resend Dashboard](https://resend.com/domains)
3. Revisar logs: `[Email] Failed to send...`

### Drive/Calendar no funciona
1. Verificar credenciales de Service Account
2. Verificar Domain-Wide Delegation habilitado
3. Verificar `GOOGLE_ADMIN_EMAIL` configurado
4. Revisar logs: `[Drive] Error...` o `[Calendar] Error...`

### Meet link no se genera
1. Verificar que Calendar API está habilitada
2. Verificar que el evento se creó correctamente
3. El Meet se genera con `conferenceDataVersion: 1`
