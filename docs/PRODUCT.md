# Producto vigente

Este documento recoge decisiones actuales de producto. Si una tarea propone cambiarlas, se detiene para que el propietario decida y después se actualizan código y documento en la misma PR.

## Propuesta y entrada comercial

Español Honesto ofrece enseñanza de español orientada a conversación, cultura y uso real del idioma. La web pública muestra un equipo de tres profesores/personas y la acción principal es solicitar plaza.

La solicitud recoge interés, nivel aproximado, objetivo, disponibilidad, plan preferido y página de origen. El equipo revisa encaje antes de habilitar una compra. Las páginas públicas no ofrecen checkout directo.

El CRM es propio y vive dentro del admin Astro/Supabase. El contacto es el registro central de la relación; alumnos, pagos, sesiones y soporte conservan sus fuentes operativas.

El posicionamiento prioritario es para adultos y profesionales, normalmente de 30 años o más y con nivel aproximado A2/B1 o superior, interesados en conversación, cultura y vida real en España. Es una orientación comercial, no una regla automática de exclusión.

El servicio es exclusivamente para mayores de 18 años. Solicitud, diagnóstico, registro y compra exigen una declaración expresa de mayoría de edad; no se recoge fecha de nacimiento ni existe un flujo para menores.

## Oferta actual

| Clave | Precio mensual | Sesiones por mes | Modalidad |
|---|---:|---:|---|
| `group` | 50 EUR | 4 | Grupo guiado solo si existe compatibilidad |
| `standard` | 145 EUR | 4 | Clases privadas |
| `hybrid` | 150 EUR | 4 | Privadas más grupo compatible |
| `bootcamp` | 345 EUR | 20 | Privadas intensivas |

Duraciones: 30, 40 o 50 minutos; 50 minutos por defecto. Compromisos de 3 meses tienen 10 % de descuento y los de 6 meses, 20 %. Las sesiones del periodo forman un banco utilizable hasta su fecha final y no pasan a la renovación siguiente.

`group` no garantiza que exista un grupo. `hybrid` tampoco garantiza aún alta verificable con dos profesores. Ambos pueden mostrarse para solicitar plaza, pero siguen bloqueados para aprobación/checkout. Si se habilitan pagos, la oferta cobrable inicial se limita a `standard` y `bootcamp` hasta que una decisión de producto retire esos bloqueos.

## Pagos y proveedores

- Supabase `packages` es el catálogo editable.
- Supabase `package_prices` conserva versiones contractuales inmutables.
- Stripe ejecuta el cobro y debe coincidir con la oferta aprobada.
- Un cambio de precio crea una versión nueva; no reescribe compras previas.
- `CHECKOUT_ENABLED=false` y `CHECKOUT_ENABLED_OVERRIDE=false` son el estado normal actual.
- Si se activa el checkout, el alcance inicial es tarjeta mediante Stripe Checkout y sin códigos promocionales.
- Activar pagos reales, cambiar proveedor o abrir checkout es una decisión de producto y producción.

Stack externo confirmado: Cloudflare Workers, Supabase, Stripe, Google Workspace, Resend, Turnstile y Sentry. Los recursos exactos están en `docs/ENVIRONMENTS.md`; no se sustituye uno por otro aunque la cuenta tenga otros proyectos.

## Límites públicos actuales

- No se publican reviews o testimonios sin una fuente real y permiso.
- No se anuncia un canal público de Telegram sin operación y moderación reales.
- No se activa telemetría rica de producto sin decidir herramienta, minimización, consentimiento, cookies, retención y privacidad. Sentry queda limitado a errores técnicos.
- No se promete grupo, comunidad pública ni prueba de nivel humana definitiva mientras no estén operativos.

## Decisiones pendientes reales

Estas cuestiones no se resuelven técnicamente sin el propietario:

- Cuándo aceptar pagos reales.
- Cuándo `group` y `hybrid` cumplen lo prometido y pueden venderse.
- Prueba de nivel definitiva, si se desea una distinta de la solicitud enriquecida.
- Textos legales, plazos de conservación y procedimiento definitivo de derechos antes de producción real.
- Cualquier cambio de precio, promesa, público, proveedor o política de datos.

No se convierten en un gate general. Solo bloquean la tarea que dependa directamente de ellas.
