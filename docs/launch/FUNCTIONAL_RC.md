# Functional RC

Estado: apoyo automatico para el release candidate sin cobros reales.

`corepack pnpm launch:functional-rc` agrupa tests ya existentes de los flujos operativos que deben quedar listos antes de legal real, Stripe live, fuente premium rusa, secretos production, servicios production, dominio/Search Console y smoke real.

El contrato de alcance tambien se escribe en `outputs/launch-functional-rc/<timestamp>/summary.json` bajo `contract`, para que `launch:status`, revisiones secundarias o auditorias manuales puedan comprobar que la evidencia cubre lo que dice cubrir sin parsear Markdown.

## Que Cubre

- Solicitud de plaza y CRM.
- Emails transaccionales y trazabilidad CRM.
- Diagnostico ligero de nivel.
- Onboarding post-pago con mocks/staging, sin pagos reales.
- Calendario, disponibilidad de profesor, hora Madrid, duraciones soportadas y ventana de union a clases de 50 minutos sin corte brusco.
- Checkout fail-closed cuando no se habilita explicitamente.
- Soporte y recuperacion admin.

## Contrato De Flujo Comercial

- La solicitud de plaza crea o actualiza contacto CRM, oportunidad, consentimiento, actividad de timeline y tarea de revision.
- La tarea inicial tiene SLA de 24h para primera respuesta humana.
- La tarea inicial queda en cola compartida de fundadores hasta que un admin se la asigna manualmente.
- La etapa de oportunidad CRM guia las decisiones de propuesta, posponer, perder o ganar.
- Los emails comerciales manuales quedan trazados en CRM y separados del consentimiento de marketing.

## Contrato De Activacion Post-Pago

Post-pago no significa solo cuenta creada. Para este RC sin cobros reales, la activacion operativa queda definida asi:

- Email de bienvenida aceptado por Resend o mock equivalente.
- Campus accesible con una accion clara antes de la primera clase.
- Carpeta/materiales preparados antes de la primera clase.
- Primera clase coordinada manualmente con disponibilidad real.
- Tarea CRM compartida con SLA 24h hasta programar o reprogramar la primera clase.
- Actividad CRM de cierre cuando la primera clase se completa.
- Duraciones 30/40/50 soportadas; Google Meet no se corta automaticamente al llegar al minuto previsto.

## Que No Cubre

- Supabase alojado ni migraciones remotas.
- Cloudflare cron/logs, Resend staging real ni Admin Jobs staging UI/runtime.
- Stripe live.
- Legal real.
- Fuente rusa premium.
- Secretos y servicios production.
- Dominio, Search Console y smoke production.

## Uso

```bash
corepack pnpm launch:functional-rc
```

El comando escribe:

- `outputs/launch-functional-rc/<timestamp>/summary.json`
- `outputs/launch-functional-rc/<timestamp>/summary.md`
- `outputs/launch-functional-rc/<timestamp>/<group>.log`

Si falla, abrir primero el log del grupo fallido. Si pasa, usarlo como evidencia automatica de que la parte funcional local del RC sigue coherente; no usarlo para cerrar evidencias externas.

Reglas de evidencia:

- Usarlo solo como evidencia funcional local/mock del RC.
- No usarlo para cerrar evidencia de servicios externos.
- No usarlo para cerrar final-only: legal real, Stripe live, fuente premium rusa, secretos production, servicios production, dominio/Search Console o smoke production.
