import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const allowedHexColors = new Set([
    '#004d40',
    '#006064',
    '#3367d6',
    '#4285f4',
    '#6a131c',
    '#8a1924',
    '#e0f7fa',
    '#f0fdfa',
    '#f6fe51',
]);

const scanTargets = [
    'src/components/admin',
    'src/pages/[lang]/campus/admin',
    'src/layouts/CampusLayout.astro',
    'src/styles/global.css',
    'tailwind.config.js',
];

const allowedExtensions = new Set(['.astro', '.css', '.js', '.jsx', '.ts', '.tsx']);
const hexPattern = /#[0-9a-fA-F]{3,8}\b/g;

const violations: Array<{ file: string; color: string }> = [];

for (const target of scanTargets) {
    const absoluteTarget = path.resolve(target);
    if (!existsSync(absoluteTarget)) continue;

    for (const file of listFiles(absoluteTarget)) {
        const text = readFileSync(file, 'utf8');
        const matches = text.match(hexPattern) ?? [];

        for (const match of matches) {
            const normalized = match.toLowerCase();
            if (!allowedHexColors.has(normalized)) {
                violations.push({ file: path.relative(process.cwd(), file), color: match });
            }
        }
    }
}

if (violations.length > 0) {
    console.error('Admin style token check failed. New raw hex colors must be added as approved design tokens first.');
    for (const violation of violations) {
        console.error(`- ${violation.file}: ${violation.color}`);
    }
    process.exit(1);
}

console.log(`Admin style token check passed. Allowed colors: ${Array.from(allowedHexColors).sort().join(', ')}`);

function listFiles(target: string): string[] {
    const stats = statSync(target);
    if (stats.isFile()) {
        return allowedExtensions.has(path.extname(target)) ? [target] : [];
    }

    const files: string[] = [];
    for (const entry of readdirSync(target)) {
        const fullPath = path.join(target, entry);
        const entryStats = statSync(fullPath);
        if (entryStats.isDirectory()) {
            files.push(...listFiles(fullPath));
        } else if (allowedExtensions.has(path.extname(fullPath))) {
            files.push(fullPath);
        }
    }
    return files;
}
