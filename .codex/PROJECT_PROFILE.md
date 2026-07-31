# Perfil Codex de HonestSpanish

Este directorio limita el contexto y las conexiones únicamente para este repositorio. El perfil global del usuario no se modifica.

## Funcionamiento

- El agente principal usa la selección global de modelo y razonamiento.
- Hasta tres subagentes pueden investigar superficies independientes; por defecto usan razonamiento `high` para evitar latencia innecesaria.
- Browser, GitHub, Cloudflare, Stripe y un Supabase de staging en solo lectura siguen disponibles.
- Las apps ajenas al proyecto, el Supabase genérico y el Sentry que apunta a otro proyecto no se cargan.
- `AGENTS.md` contiene la única metodología. Este archivo solo explica cómo recuperar o reutilizar la configuración técnica.

## Recuperar o reutilizar

La configuración completa está en `config.toml` y en Git. Para recuperar las capacidades globales dentro de HonestSpanish, elimina las secciones `apps.*`, `plugins.*` y `mcp_servers.*`, conserva las opciones de sandbox y agentes si se desean y abre una tarea nueva de Codex.

Para otro proyecto, copia `config.toml` a su carpeta `.codex/` y sustituye los IDs de apps, plugin MCP y `project_ref`; no copies el bloque literalmente. No copies archivos `.env`, credenciales OAuth ni secretos de HonestSpanish.

La configuración de herramientas se resuelve al abrir una tarea. Para verificar este perfil hay que iniciar una tarea nueva en este repositorio; la tarea que lo modificó puede conservar el catálogo anterior en memoria.
