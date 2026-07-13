# No-Real-Payments Mode

Estado: apoyo para operar sin cobros reales hasta el cierre final de Stripe.

`corepack pnpm launch:no-real-payments` verifica que el RC puede seguir en modo solicitud de plaza sin abrir pagos reales por accidente.

## Que Prueba

- `.env.example` mantiene `CHECKOUT_ENABLED=false`.
- `/api/create-checkout` usa `src/lib/checkout-enabled.ts` y falla cerrado con 403 antes de tocar Supabase o Stripe. `CHECKOUT_ENABLED_OVERRIDE` prevalece sobre `CHECKOUT_ENABLED`; ambos quedan en `false` para staging sin cobros.
- Las landings publicas usan `PricingSection` en modo `application`.
- Los tests de checkout y pricing publicos pasan.
- `corepack pnpm launch:payments` sigue pasando.
- Si se pasa `--deployed-url`, el entorno desplegado responde 403 `Checkout is disabled` a una prueba segura de `/api/create-checkout`.

## Que No Prueba

- Variables reales desplegadas en Cloudflare Workers, salvo que se ejecute con `--deployed-url`.
- Stripe live.
- Webhook live.
- Customer Portal live.
- Compra real o test-mode contra Stripe dashboard.

## Uso

```bash
corepack pnpm launch:no-real-payments
```

CI ejecuta `pnpm run launch:no-real-payments` en build/test y fuerza `CHECKOUT_ENABLED=false` durante el build. Tras desplegar la rama `staging`, GitHub Actions ejecuta el probe read-only contra `https://staging.espanolhonesto.com`. El cutover no debe considerarse apto para RC si DNS/TLS/routing no están verificados o si el probe no devuelve 403 `Checkout is disabled`.

Para RC local, si no se pasa URL explícita, los scripts usan como fallback el dominio canónico `https://staging.espanolhonesto.com`. Antes del cutover externo, pasar deliberadamente la URL directa solo para diagnóstico transitorio; no registrar ese resultado como evidencia final del dominio.

Para staging:

```bash
corepack pnpm launch:no-real-payments -- --deployed-url https://staging.espanolhonesto.com
```

Durante la transición puede repetirse el probe contra `https://espanolhonesto-staging.alindev95.workers.dev` como diagnóstico de rollback, pero la evidencia de cierre debe proceder del dominio canónico.

La prueba desplegada hace `POST /api/create-checkout` con body `{}`. Si checkout esta desactivado, debe devolver 403 antes de leer Supabase o Stripe. Si checkout estuviera activado, ese mismo body devolveria 400 por faltar `priceId` antes de Supabase o Stripe, sin crear Checkout Session.

Interpretacion:

- `403` con `Checkout is disabled`: el entorno desplegado esta bloqueado para cobros reales.
- `400` con `priceId is required`: el endpoint desplegado esta procesando checkout como habilitado o no tiene el fail-closed activo; corregir `CHECKOUT_ENABLED=false` en Cloudflare para ese entorno solo basta si el despliegue ya contiene el guard que lee esa variable. Si `local_deployment_gap` avisa de cambios solo locales, empaquetar/commitear y redeployar primero el codigo actual.
- Cualquier `2xx` o URL de Stripe: bloquear inmediatamente checkout y no registrar `payments_staging` como cerrado.

Si staging falla, preparar el paquete de remediacion sin escribir en Cloudflare:

```bash
corepack pnpm launch:staging-no-real-payments-remediation
```

El comando lee deployments del Worker en modo read-only, repite el probe seguro, confirma que `wrangler.toml` contiene `CHECKOUT_ENABLED = "false"` y entornos Worker, compara el guard local con el Git source desplegable mediante `local_deployment_gap`, inspecciona `dist` si existe y escribe `outputs/launch-staging-no-real-payments-remediation/<timestamp>/staging-no-real-payments-remediation-pack.md`, `outputs/launch-staging-no-real-payments-remediation/<timestamp>/worker-staging-build-manifest.json`, `outputs/launch-staging-no-real-payments-remediation/<timestamp>/approval-request.md` y `outputs/launch-staging-no-real-payments-remediation/<timestamp>/manual-evidence-dry-run.txt`.

Si `local_deployment_gap` avisa de cambios en working tree, Cloudflare no puede servir ese arreglo hasta que los cambios exactos queden empaquetados en un commit/deploy de staging. En ese caso, el `400` remoto no contradice el guard local: indica que staging esta corriendo codigo/config anterior. No tratar una variable sola como cierre suficiente si el despliegue no contiene el guard que la lee.

Si se va a usar un build local como paquete de despliegue, ejecutar primero `corepack pnpm build`, repetir `corepack pnpm launch:staging-no-real-payments-remediation` y revisar `worker-staging-build-manifest.json`. El manifest debe mostrar `readyForStagingDeployPackage=true`: registra rutas y hashes del build que contienen el guard, valida `dist/server/wrangler.json`, `entry.mjs`, assets, `CHECKOUT_ENABLED=false`, `nodejs_compat` y limites basicos del Worker/static assets, sin guardar el contenido compilado. Si falta `dist`, si el manifest no encuentra `Checkout is disabled` y `CHECKOUT_ENABLED`, o si falla la estructura basica del paquete Worker, no usar ese build para staging.

Si el build local pudo ver `.dev.vars` o `.env*`, no conservar `dist/` como evidencia ni reutilizarlo como paquete permanente. Para desplegar staging desde build local, reconstruir en sanitized env, revisar el manifest, confirmar `readyForStagingDeployPackage=true`, ejecutar `corepack pnpm secrets:check` y delete `dist/` tras la verificacion. El check `pnpm launch:cleanup` avisa cuando `dist/` convive con `.dev.vars` o `.env*` para evitar que un artefacto sensible quede normalizado.

Usar el `approval-request.md` antes de tocar Cloudflare: limita el scope al Worker staging, exige preflight de cuenta/Worker/entorno, exige revisar el `worker-staging-build-manifest.json` si se despliega un build local, permite solo `CHECKOUT_ENABLED=false` cuando el guard ya esta desplegado o redeploy de config/codigo actual cuando falta el guard, y deja fuera production Worker, Stripe live, pagos reales, secretos finales y dominio/Search Console.

Usar `manual-evidence-dry-run.txt` solo después de que el post-fix probe desplegado pase. Ejecutar `corepack pnpm launch:no-real-payments -- --deployed-url https://staging.espanolhonesto.com`; si devuelve 403 `Checkout is disabled`, sustituir la nota genérica por evidencia concreta y añadir `--write`. Si devuelve `400 priceId is required`, no registrar `payments_staging` como cerrado.

El comando escribe:

- `outputs/launch-no-real-payments/<timestamp>/summary.md`
- `outputs/launch-no-real-payments/<timestamp>/no-real-payments-closure-pack.md`
- `outputs/launch-no-real-payments/<timestamp>/manual-evidence-dry-run.txt`

Para registrar `payments_staging` como cerrado en modo sin pagos reales, primero hay que confirmar el entorno desplegado sin pegar secretos: entorno, fecha y que `CHECKOUT_ENABLED=false` o que checkout esta bloqueado/oculto. Si `--deployed-url` pasa, usar su `summary.md` como evidencia principal y dejar Stripe live para cierre final.
