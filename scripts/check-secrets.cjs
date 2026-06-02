#!/usr/bin/env node

const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");

const ignoredPathPrefixes = [
  ".agent/skills/",
  ".agents/skills/",
  "node_modules/",
  "dist/",
  ".astro/",
  "coverage/",
  "playwright-report/",
  "test-results/",
];

const ignoredExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".zip",
  ".pdf",
  ".ico",
]);

const placeholderPattern = /your|tu_|placeholder|xxx|changeme|fake|dummy|example|sample|\.\.\.|\[YOUR-PASSWORD\]|test-secret|test_key|placeholder-|secret-test|test-cron/i;

const secretPatterns = [
  { name: "Supabase service key", regex: /sb_secret_[A-Za-z0-9_-]{20,}/g },
  { name: "JWT-like token", regex: /eyJ[A-Za-z0-9_-]{50,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g },
  { name: "Stripe secret key", regex: /sk_(live|test)_[A-Za-z0-9]{20,}/g },
  { name: "Stripe webhook secret", regex: /whsec_[A-Za-z0-9]{20,}/g },
  { name: "Google API key", regex: /AIza[0-9A-Za-z_-]{30,}/g },
  { name: "Resend API key", regex: /re_[A-Za-z0-9_]{20,}/g },
  { name: "Private key block", regex: /-----BEGIN PRIVATE KEY-----/g },
  { name: "Database URL with password", regex: /(postgres|postgresql|mysql|mongodb)(:\/\/|\+srv:\/\/)[^\s"']+:[^\s"']+@/g },
];

function listedFiles() {
  const output = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    encoding: "utf8",
  });

  return output.split("\0").filter(Boolean);
}

function shouldSkip(file) {
  if (file === "scripts/check-secrets.cjs") return true;
  if (ignoredPathPrefixes.some((prefix) => file.startsWith(prefix))) return true;
  const lower = file.toLowerCase();
  return [...ignoredExtensions].some((ext) => lower.endsWith(ext));
}

function scanFile(file) {
  if (shouldSkip(file)) return [];

  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    return [];
  }

  if (content.includes("\u0000")) return [];

  const findings = [];
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    if (placeholderPattern.test(line)) return;
    if (/\$\{\{\s*secrets\.|process\.env\.|import\.meta\.env\.|secret put/i.test(line)) return;

    for (const pattern of secretPatterns) {
      pattern.regex.lastIndex = 0;
      if (pattern.regex.test(line)) {
        findings.push({
          file,
          line: index + 1,
          type: pattern.name,
        });
      }
    }
  });

  return findings;
}

const findings = listedFiles().flatMap(scanFile);

if (findings.length > 0) {
  console.error("Potential secrets found. Values are intentionally not printed.");
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} (${finding.type})`);
  }
  process.exit(1);
}

console.log("No obvious secrets found in tracked/unignored files.");
