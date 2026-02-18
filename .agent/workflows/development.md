---
description: Daily development workflow using project skills
---

# Development Workflow

Standard workflow for daily development tasks on this project.

## Before Coding

1. **Pull latest changes**
   ```bash
   git pull origin main
   ```

2. **Check for pending i18n issues** (optional, weekly)
   ```bash
   python .agents/skills/i18n-localization/scripts/i18n_checker.py src --locales es,en,ru
   ```

## During Development

### Creating New Pages/Components

1. **Astro pages**: Follow patterns in `src/pages/[lang]/`
   - Always include `export const prerender = false;` for SSR pages
   - Use `getRelativeLocaleUrl()` from `astro:i18n`
   - Import translations from `src/i18n/translations.ts`

2. **React islands**: Use `client:load` or `client:visible`
   - Pass translations as props (never import directly in React)
   - Type props strictly (no `any`)

3. **API endpoints**: Follow pattern in `src/pages/api/`
   - Check authentication first
   - Return proper HTTP status codes
   - Use Supabase server client

### Database Queries

1. **Always use typed client**:
   ```typescript
   import { supabaseServer } from '@/lib/supabase-server';
   import type { Database } from '@/types/database.types';
   ```

2. **Check schema before writing queries**:
   - Use Supabase MCP tool or check `db/esquema_nube.sql`

## Before Committing

1. **Run type check**:
   ```bash
   npm run typecheck
   ```

2. **Run linting**:
   ```bash
   npm run lint
   ```

3. **Run tests** (if changed related code):
   ```bash
   npm run test:unit
   ```

## Useful Skills Reference

| Task | Skill | Key File |
|------|-------|----------|
| Astro patterns | astro-framework | `.agents/skills/astro-framework/SKILL.md` |
| i18n check | i18n-localization | `.agents/skills/i18n-localization/scripts/i18n_checker.py` |
| DB optimization | supabase-postgres | `.agents/skills/supabase-postgres-best-practices/SKILL.md` |
| Cloudflare deploy | cloudflare | `.agents/skills/cloudflare/SKILL.md` |
