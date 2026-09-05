# Academia de idiomas

Treat the current task, code, migrations, executable configuration, and tests as the source of truth. Read durable documentation only when relevant: `docs/PRODUCT.md` for offer or copy, `docs/ENVIRONMENTS.md` and `docs/OPERATIONS.md` for providers or deployment, `docs/LAUNCH_WEBMCP_SPEC.md` for official launch or WebMCP work, and `ARCHITECTURE.md` for structural changes.

Do not reconstruct work from old chats or create persistent workflow, handoff, status, evidence, checkpoint, or planning systems. Native Codex subagents may be used when genuinely useful; they are not required by this project.

Use proportional verification: focused tests while editing, then typecheck/lint/build as relevant. Use `pnpm run verify:staging-runtime` only for an explicitly requested runtime or staging deployment check. Never deploy or mutate an external service merely because its connector is available.
