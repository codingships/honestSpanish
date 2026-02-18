import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Simple script to check for specific anti-patterns in staged/new files
// Usage: node pre-work-check.js <file-path>

const filePath = process.argv[2];

if (!filePath) {
    console.log("Usage: node pre-work-check.js <file-path>");
    process.exit(1);
}

if (!fs.existsSync(filePath)) {
    console.error(`Error: File ${filePath} not found.`);
    process.exit(1);
}

const content = fs.readFileSync(filePath, 'utf8');

// CHECK 1: NO ANY
if (content.includes(': any') || content.includes('as any')) {
    console.error("❌ STRICT MODE VIOLATION: usage of 'any' detected.");
    console.error("   -> Define a proper Interface or Type.");
    process.exit(1);
}

// CHECK 2: NO CONSOLE.LOG
if (content.includes('console.log')) {
    console.warn("⚠️ WARNING: console.log detected. Ensure this is removed before commit.");
}

console.log("✅ Basic strict checks passed.");
