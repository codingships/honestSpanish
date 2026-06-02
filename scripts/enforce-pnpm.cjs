#!/usr/bin/env node

const userAgent = process.env.npm_config_user_agent || "";

if (!userAgent.startsWith("pnpm/")) {
  console.error("This project is pnpm-only. Use pnpm instead of npm, npx, yarn, bun, or bunx.");
  process.exit(1);
}
