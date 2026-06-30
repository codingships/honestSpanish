# SEO/LLM Final Runbook

Estado: final-only.

Este runbook cierra `seo_llm_final` cuando el dominio publico, el copy final, las paginas legales, el modo de pagos y la decision de tipografia rusa premium ya esten estables. No sustituye asesoria legal, Search Console, Core Web Vitals de campo, licencia de fuente ni la decision final de Alin.

## Regla

No cerrar `seo_llm_final` durante el RC solo porque `pnpm launch:seo` pase. El comando prueba la superficie tecnica; el cierre final exige evidencia no secreta del dominio real y una revision humana de lo que buscadores y asistentes pueden ver.

No guardar en el repo:

- Tokens de Search Console, Cloudflare, Stripe, Supabase, Sentry o similares.
- Capturas con secretos, IDs sensibles, emails privados de alumnos o datos de pagos.
- Exportaciones completas de analytics o logs con datos personales.
- Prompts/resultados que incluyan informacion privada del campus.
- Fuentes comerciales sin licencia, facturas o datos fiscales.

## Estado RC Ya Cubierto

Estos puntos ya deben quedar protegidos por automatizacion antes del cierre final:

| Area | Evidencia tecnica |
| --- | --- |
| Robots y sitemap | `pnpm launch:seo`, `pnpm launch:status`, `tests/unit/seo-surface.test.ts` |
| Canonical/hreflang/noindex | `src/layouts/BaseLayout.astro`, `tests/unit/seo-surface.test.ts` |
| JSON-LD de landing | `src/lib/landing-schema.ts`, `src/lib/landing-data.ts`: cursos/ofertas desde paquetes activos, `ApplyAction` hacia solicitud de plaza y `FAQPage` desde FAQ visible |
| Respuestas AEO/FAQ de segmentos | `/es/espanol-para-vivir-en-espana`, `/es/espanol-para-profesionales`, `/es/clases-de-conversacion-en-espanol`, contextos concretos, `FAQPage` JSON-LD, `pnpm launch:seo` |
| Mapa para asistentes | `public/llms.txt`, notas de paginas de segmento, `tests/unit/seo-surface.test.ts` |
| Mapa de intencion | `docs/launch/SEO_INTENT_MAP.md`, enlaces internos desde `/es` |
| Plan comercial canonico | `docs/launch/LAUNCH_MARKETING_PLAN.md`, promesa, cliente principal, jerarquia de planes, CTA de solicitud y limites final-only |
| Demo/campus/API fuera de indexacion publica | `robots.txt`, sitemap publico, `llms.txt`, launch gate |

## Orden Final

1. Congelar copy publico ES/EN/RU, precios visibles, paginas legales y modo de pagos.
2. Desplegar en el dominio final que se vaya a revisar.
3. Confirmar la decision de tipografia rusa premium: comprar/licenciar la familia oficial con soporte cirilico o aceptar mantener el fallback actual.
4. Ejecutar:

```bash
pnpm launch:seo
pnpm launch:verify
pnpm launch:status
```

5. Abrir el worksheet generado por `pnpm launch:seo` en `outputs/launch-seo/<timestamp>/seo-llm-final-worksheet.md`.
6. Completar las comprobaciones manuales de este runbook.
7. Registrar evidencia no secreta en `docs/launch/MANUAL_EVIDENCE.local.json` para `seo_llm_final`.
8. Reejecutar `pnpm launch:manual-evidence`, `pnpm launch:secondary-review` y `pnpm launch:status`.

## Tipografia Rusa Premium

El problema actual es visual: el ruso se muestra legible, pero no usa la misma familia que ES/EN. Esto queda final-only porque depende de licencia/compra o de una decision explicita de aceptar fallback.

Rutas permitidas:

| Ruta | Que hacer | Evidencia aceptable |
| --- | --- | --- |
| Comprar/licenciar | Usar la familia oficial con soporte cirilico, instalar solo archivos permitidos por licencia y revisar `/ru` tras deploy. | Nota con proveedor/familia, alcance de licencia y rutas revisadas; no guardar factura ni datos fiscales. |
| Mantener fallback | Confirmar que el ruso se lee correctamente y que Alin acepta no igualar la familia visual antes de launch. | `accepted_risk` o nota manual con owner, razon y seguimiento post-launch. |

No usar una fuente "parecida" como cierre si la decision final exige la familia oficial. No guardar fuentes comerciales sin licencia en `public/`, `src/`, `outputs/` ni `.codex-ops`.

## Checks Manuales

El check automatico `marketing plan parity` protege que el SEO/LLM final no se separe del plan comercial canonico.

| Check | Que comprobar | Evidencia aceptable |
| --- | --- | --- |
| Dominio canonico | `https://espanolhonesto.com` responde y las variantes no deseadas redirigen de forma consistente. | Nota con URLs probadas y codigos de estado. |
| Robots | `/robots.txt` permite publico y bloquea API/campus/login/demo. | URL o captura redactada. |
| Sitemap | `/sitemap-index.xml` y `/sitemap-public.xml` existen y no contienen campus, demo, API ni rutas privadas. | URL o nota con rutas revisadas. |
| Landings | `/es`, `/en`, `/ru` tienen title, description, canonical, hreflang, OG/Twitter y copy final. | Nota con rutas revisadas. |
| Tipografia rusa premium | `/ru` usa la familia oficial con soporte cirilico tras compra/licencia, o queda aceptado explicitamente el fallback actual. | Nota con ruta revisada, decision de fuente y captura redactada si se usa. |
| Segmentos AEO/FAQ | `/es/espanol-para-vivir-en-espana`, `/es/espanol-para-profesionales` y `/es/clases-de-conversacion-en-espanol` mantienen respuestas autocontenidas, `FAQPage` JSON-LD y CTA a solicitud de plaza sin prometer grupos, reviews, Telegram ni prueba de nivel definitiva. | Nota con rutas revisadas, schema validado o captura redactada. |
| Blog | Indices y posts publicos no incluyen borradores ni notas de redactor. | Nota con rutas revisadas. |
| Legal | Decidir si las paginas legales finales quedan `noindex` o indexables; sitemap/noindex debe coincidir con esa decision. | Decision de Alin con fecha. |
| JSON-LD | Los cursos/precios en structured data coinciden con paquetes finales y la accion publica apunta a solicitud de plaza, no a compra inmediata. | Resultado de validator o nota con resumen. |
| `llms.txt` | Contiene fuentes publicas, paquetes actuales, flujo de solicitud antes de compra, limites de privacidad, descripcion autocontenida para asistentes y no apunta a campus/demo/API como fuente. | URL o nota. |
| Search Console | Propiedad verificada, sitemap enviado, URLs clave inspeccionadas y sin errores criticos conocidos. | Referencia de dashboard o captura redactada; nunca tokens. |
| Core Web Vitals | PageSpeed/Lighthouse o CWV para landings clave tras deploy final. | Resumen de puntuaciones o referencia de dashboard. |
| Social previews | Vista previa OG/Twitter de `/es`, `/en`, `/ru` y un post representativo. | Capturas redactadas. |
| Aprendizaje de cliente | Revisar familias de consultas y solicitudes de plaza para entender que clientes llegan sin activar telemetria rica. | Nota agregada por familias de busqueda y rutas de origen; sin exportar datos personales. |
| Plan comercial | Comparar snippets finales, `llms.txt`, paginas de segmento y respuestas de asistente contra `docs/launch/LAUNCH_MARKETING_PLAN.md`: promesa, cliente principal, jerarquia de planes, solicitud de plaza y elementos pospuestos. | Nota con fuentes revisadas y cambios aplicados, sin datos privados. |
| LLM Discoverability | Probar una consulta tipo asistente usando solo fuentes publicas y confirmar que no cite campus, API, demo ni datos privados. | Prompt/resumen del resultado sin datos privados. |

## Rutas Minimas

Revisar como minimo:

- `https://espanolhonesto.com/es`
- `https://espanolhonesto.com/es/espanol-para-vivir-en-espana`
- `https://espanolhonesto.com/es/espanol-para-profesionales`
- `https://espanolhonesto.com/es/clases-de-conversacion-en-espanol`
- `https://espanolhonesto.com/en`
- `https://espanolhonesto.com/ru`
- `https://espanolhonesto.com/es/blog`
- `https://espanolhonesto.com/en/blog`
- `https://espanolhonesto.com/ru/blog`
- `https://espanolhonesto.com/robots.txt`
- `https://espanolhonesto.com/sitemap-index.xml`
- `https://espanolhonesto.com/sitemap-public.xml`
- `https://espanolhonesto.com/llms.txt`

Si legal se decide indexable, revisar tambien las rutas legales finales. Si legal se mantiene `noindex`, registrar esa decision.

## Search Console

Cuando este disponible:

1. Verificar propiedad de dominio o URL-prefix.
2. Enviar `https://espanolhonesto.com/sitemap-index.xml`.
3. Inspeccionar `/es`, `/en`, `/ru`, los indices de blog y una pagina legal si se decide indexable.
4. Inspeccionar `/es/espanol-para-vivir-en-espana`, `/es/espanol-para-profesionales` y `/es/clases-de-conversacion-en-espanol` para confirmar canonical, indexabilidad, respuestas AEO/FAQ y `FAQPage`.
5. Confirmar que no hay bloqueos inesperados por robots/noindex/canonical.
6. Registrar solo una nota o captura redactada.

Si Search Console todavia no esta disponible el dia de cierre, `seo_llm_final` puede cerrarse solo si Alin acepta explicitamente el riesgo y queda documentado en la evidencia manual.

## Aprendizaje De Clientes Sin Telemetria Rica

El objetivo SEO no termina en "ser indexables". Tambien hay que entender que tipo de cliente esta encontrando la web y si coincide con el posicionamiento de lanzamiento.

Durante las primeras 2-4 semanas despues de que Search Console tenga datos:

1. Revisar consultas, impresiones, clics y paginas de entrada por familias, no por usuarios individuales.
2. Separar al menos estas familias: profesionales/trabajo, vivir o integrarse en Espana, conversacion A2/B1/B2, cultura/ciudades y busquedas de precio barato.
3. Comparar esas familias con solicitudes de plaza agregadas: `sourcePath`, interes, plan de interes, nivel aproximado y objetivo declarado.
4. Revisar el panel agregado de Admin > Solicitudes de plaza: rutas que convierten, interes declarado, planes de interes y nivel declarado.
5. Decidir si conviene reforzar una pagina, crear un articulo, cambiar copy, rechazar trafico no cualificado o mantener el foco.
6. Actualizar `docs/launch/SEO_INTENT_MAP.md` si cambia el aprendizaje.

Reglas:

- No exportar ni guardar en el repo emails, nombres, IPs, grabaciones, dashboards con cuentas visibles ni datos personales.
- No activar telemetria de producto/cookies para esto sin revisar legal, cookies, consentimiento, retencion y privacidad.
- Search Console y los datos agregados de solicitud de plaza bastan para el primer ciclo de aprendizaje.

## LLM Discoverability

El objetivo no es aparecer inmediatamente en todos los asistentes, sino dejar una superficie publica clara, citable y con limites:

- `llms.txt` debe decir que fuentes son publicas y que rutas no deben usarse.
- `llms.txt` debe explicar que la accion principal es solicitar plaza y que pago, grupo compatible o prueba humana vienen despues de revisar encaje.
- `llms.txt` debe describir Espanol Honesto como academia online para adultos/profesionales que quieren vivir Espana con conversacion, cultura, criterio, contacto real y comunidad con encaje.
- El resultado debe mantenerse alineado con `docs/launch/LAUNCH_MARKETING_PLAN.md`; si la promesa, cliente principal, jerarquia de planes o final-only cambian, actualizar ese plan, `llms.txt`, snippets y paginas de segmento juntos.
- Las respuestas AEO/FAQ y contextos concretos de segmentos deben ser citables sin inventar comunidad activa, reviews, presencia local o prueba de nivel definitiva.
- Campus, API, demo, dashboards, datos de alumnos, pagos y programacion no son material publico.
- Los paquetes y precios citables deben coincidir con Supabase/landing final.
- La prueba manual debe usar preguntas generales como "que ofrece Espanol Honesto" o "que paquetes tiene" y revisar que la respuesta no invente datos privados, checkout inmediato, Telegram activo, grupo garantizado ni comunidad publica ya operativa.

## Snippet Para Evidencia Manual

Usar `pnpm launch:manual-evidence:record --write` si se quiere evitar editar JSON a mano. Si se edita manualmente, el check `seo_llm_final` debe incluir algo equivalente a:

```json
{
  "id": "seo_llm_final",
  "status": "pass",
  "owner": "Alin",
  "environment": "production",
  "summary": "SEO/LLM final revisado tras dominio, copy, legal, modo de pagos y decision de tipografia rusa definitivos.",
  "evidence": [
    {
      "type": "command_output",
      "value": "../../outputs/launch-seo/<timestamp>/summary.md",
      "note": "Auditoria tecnica SEO/LLM sin fallos."
    },
    {
      "type": "manual_note",
      "value": "Dominio, robots, sitemap, canonical/hreflang, snippets, JSON-LD, llms.txt, tipografia rusa premium/fallback, Search Console/CWV y exclusion de rutas privadas revisados el <fecha>.",
      "note": "Sin secretos ni datos personales."
    }
  ]
}
```

## Criterio De Cierre

`seo_llm_final` se puede cerrar cuando:

- `pnpm launch:seo` pasa despues del deploy/copy/legal finales.
- `pnpm launch:status` no muestra pendientes SEO/LLM salvo otros final-only no relacionados.
- La evidencia manual cubre dominio real, Search Console o riesgo aceptado, Core Web Vitals o riesgo aceptado, tipografia rusa premium/fallback, `llms.txt`, snippets, legal index policy y exclusion privada.
- La evidencia manual deja preparado el primer ciclo de aprendizaje de cliente por familias de busqueda y solicitudes de plaza agregadas, sin telemetria rica.
- Alin acepta que lo que queda fuera son tareas post-launch como reviews, Telegram o telemetria.
