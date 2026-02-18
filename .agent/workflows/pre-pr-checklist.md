---
description: Pre-PR checklist to ensure code quality before merging
---

# Pre-PR Checklist

Run this checklist before creating a Pull Request.

## Automated Checks

// turbo-all

1. **Lint check**
   ```bash
   npm run lint
   ```

2. **Type check**
   ```bash
   npm run typecheck
   ```

3. **Unit tests**
   ```bash
   npm run test:unit
   ```

4. **E2E tests** (if UI changed)
   ```bash
   npm run test:e2e
   ```

5. **Build verification**
   ```bash
   npm run build
   ```

## Manual Checks

### Code Quality
- [ ] No `any` types (strict TypeScript)
- [ ] No hardcoded strings (use translations)
- [ ] No console.log/console.error (except intentional logging)
- [ ] Functions have descriptive names
- [ ] Complex logic has comments

### i18n
- [ ] New UI text added to `src/i18n/translations.ts`
- [ ] Translations for ES, EN, RU
- [ ] No hardcoded user-facing strings

### Database
- [ ] Queries use typed Supabase client
- [ ] RLS policies checked if new tables
- [ ] Migrations tested locally

### Security
- [ ] No secrets in code
- [ ] Auth checked on protected routes
- [ ] Input validation on API endpoints

## PR Description Template

```markdown
## Changes
- Brief description of changes

## Testing
- [ ] Unit tests pass
- [ ] E2E tests pass
- [ ] Manual testing done

## Screenshots (if UI changes)
```
