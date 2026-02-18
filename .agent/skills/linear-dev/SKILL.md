---
name: linear-dev
description: A rigid, contract-first development workflow that enforces defining types and assets before implementation to minimize reactive refactoring.
---

# Linear Development Methodology

This skill enforces a **Linear Workflow** (Plan -> Define -> Code -> Done) to prevent "trial and error" loops.

## The Golden Rule: "Contract First"
**You effectively cannot write implementation code until the interface is defined.**

## Workflow Steps

### 1. 🛑 The Contract Phase (Definition)
**Before creating any `.tsx`, `.jsx`, or `.astro` file:**

1.  **Define the Interface**:
    *   Create the file, but ONLY write the TypeScript `interface` or Zod schema.
    *   *Do not write the component logic yet.*
    *   Example:
        ```typescript
        // src/components/Card.tsx
        export interface CardProps {
          title: string;
          image: ImageMetadata; // Enforces strict asset type
        }
        ```

2.  **Define Assets**:
    *   Place all required images/icons in `src/assets/`.
    *   **Strict Rule**: No `https://placeholder.com` or local temporary paths.

3.  **Define Copy**:
    *   Add all needed keys to `src/i18n/translations.ts`.
    *   **Strict Rule**: No hardcoded strings in components.

### 2. 🛡️ The Implementation Phase (Code)
**Only proceed when Phase 1 is complete.**

1.  **Scaffold the Component**:
    *   Import your Interface.
    *   Import your Assets.
    *   Hook up `useTranslations`.
2.  **Fill the Logic**:
    *   Because the interface is strict, your IDE will guide you.
3.  **Strict Linting**:
    *   **No `any`**: If you type `any`, stop and define the interface.
    *   **No Console Logs**: Use a logger or remove before saving.

### 3. ✅ The Verification Phase (Gate)
1.  **Run `npm run typecheck`**: It must pass.
2.  **Run `npm run lint`**: It must pass.
3.  **Run Tests**: If logic is complex, write a unit test.

## Usage
To use this methodology in your daily work, pretend you are a "Contractor" who has been given a spec. You cannot build the house until you have the blueprints (Types) and the materials (Assets).

## Helper Scripts
*   `scripts/pre-work-check.js`: Verifies that assets and i18n keys exist before you code.
