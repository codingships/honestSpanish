# Configuración de Resend para Español Honesto

## Requisitos Previos

1. Cuenta en [Resend](https://resend.com)
2. Acceso al panel DNS del dominio `espanolhonesto.com`

## Variables de Entorno

```env
RESEND_API_KEY=re_xxxxxxxxxxxx
EMAIL_FROM=Español Honesto <clases@espanolhonesto.com>
```

## Registros DNS Necesarios

Para enviar emails desde `@espanolhonesto.com`, añade estos registros en tu proveedor DNS:

### 1. SPF Record (TXT)

| Tipo | Nombre | Valor |
|------|--------|-------|
| TXT | @ | `v=spf1 include:_spf.resend.com ~all` |

Si ya tienes un SPF record, añade `include:_spf.resend.com` antes del `~all`.

### 2. DKIM Record (TXT)

| Tipo | Nombre | Valor |
|------|--------|-------|
| TXT | resend._domainkey | (proporcionado por Resend en el panel) |

### 3. DMARC Record (TXT) - Recomendado

| Tipo | Nombre | Valor |
|------|--------|-------|
| TXT | _dmarc | `v=DMARC1; p=none; rua=mailto:admin@espanolhonesto.com` |

## Pasos en Resend Dashboard

1. **Ir a** [resend.com/domains](https://resend.com/domains)
2. **Añadir dominio**: `espanolhonesto.com`
3. **Copiar los registros DNS** que proporciona Resend
4. **Añadir los registros** en tu proveedor DNS (ej: Cloudflare, Namecheap, etc.)
5. **Esperar propagación** (puede tardar hasta 48h, normalmente 1-2h)
6. **Verificar en Resend** haciendo clic en "Verify DNS Records"

## Verificación

### 1. Desde el Dashboard de Resend

- Estado del dominio debe mostrar "Verified" ✓

### 2. Test Programático

```bash
# Como admin, enviar email de prueba
curl -X POST http://localhost:4321/api/email/send-test \
  -H "Content-Type: application/json" \
  -H "Cookie: sb-access-token=..." \
  -d '{"type": "welcome", "email": "test@example.com"}'
```

### 3. Verificar Logs del Servidor

```
[Email] Welcome email sent to test@example.com
```

## Templates de Email Disponibles

| Tipo | Función | Cuándo se envía |
|------|---------|-----------------|
| `welcome` | `sendWelcomeEmail` | Después de pago exitoso |
| `confirmation` | `sendClassConfirmation` | Al reservar una clase |
| `reminder` | `sendClassReminder` | 24h antes de la clase (CRON) |
| `cancelled` | `sendClassCancelled` | Al cancelar una clase |

## Troubleshooting

### "API key is invalid"

- Verificar que `RESEND_API_KEY` está configurada correctamente
- La key debe empezar con `re_`

### Emails no llegan

1. Revisar spam/junk
2. Verificar que el dominio está verificado en Resend
3. Revisar logs del servidor para errores

### "Domain not verified"

- Los registros DNS aún no han propagado
- Esperar 1-2 horas y volver a verificar
- Usar `dig TXT resend._domainkey.espanolhonesto.com` para verificar

## Límites de Resend

| Plan | Emails/mes | Emails/día |
|------|------------|------------|
| Free | 3,000 | 100 |
| Pro | 50,000+ | Ilimitado |

Para una academia con ~50 estudiantes activos, el plan gratuito debería ser suficiente inicialmente.
