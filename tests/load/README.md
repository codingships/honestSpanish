# Load Testing with k6

Este directorio contiene tests de carga usando [k6](https://k6.io/).

## Requisitos

Instalar k6:
```bash
# Windows (Chocolatey)
choco install k6

# macOS
brew install k6

# Docker
docker pull grafana/k6
```

## Tests Disponibles

| Script | Descripción | Duración |
|--------|-------------|----------|
| `api-load.js` | Test de carga de APIs | ~4 min |
| `auth-load.js` | Simulación de autenticación | ~2 min |
| `stress-test.js` | Test de estrés (breaking point) | ~10 min |
| `user-journey.js` | Simulación de user journeys | ~2.5 min |

## Uso Básico

```bash
# Test de carga API (recomendado para empezar)
k6 run tests/load/api-load.js

# Test de autenticación
k6 run tests/load/auth-load.js

# Test de estrés (¡cuidado con recursos!)
k6 run tests/load/stress-test.js

# Simulación de user journeys
k6 run tests/load/user-journey.js
```

## Configuración

Cambiar el base URL:
```bash
k6 run -e BASE_URL=https://staging.example.com tests/load/api-load.js
```

Cambiar usuarios y duración:
```bash
k6 run --vus 50 --duration 1m tests/load/api-load.js
```

## Métricas Clave

- **http_req_duration**: Tiempo de respuesta
- **http_req_failed**: Tasa de errores
- **http_reqs**: Requests por segundo

## Thresholds (Umbrales)

| Métrica | Umbral | Descripción |
|---------|--------|-------------|
| P95 Response | < 2000ms | 95% de requests < 2s |
| Error Rate | < 5% | Menos del 5% de errores |
| P99 Response | < 5000ms | 99% de requests < 5s (stress) |

## Resultados

Los resultados se guardan en archivos JSON:
- `load-test-results.json`
- `stress-test-results.json`
- `user-journey-results.json`

## Integración CI/CD

```bash
# En CI, con thresholds estrictos
k6 run --out json=results.json tests/load/api-load.js

# Check exit code para pasar/fallar
echo $?  # 0 = pass, non-zero = threshold failed
```
