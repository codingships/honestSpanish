const fs = require('fs');
const path = require('path');

const resultDir = path.join(__dirname, '..', 'test-results');
const files = ['public-results.json', 'auth-results.json', 'results.json'];
const output = [];

for (const file of files) {
    const filePath = path.join(resultDir, file);
    if (!fs.existsSync(filePath)) continue;

    // Read raw content and strip non-JSON lines (dotenv logs, BOM, etc)
    let raw = fs.readFileSync(filePath, 'utf-8');
    // Strip BOM if present
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    // Normalize line endings
    raw = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Find the real JSON start: a { at the beginning of a line (skip inline { from dotenv logs)
    let jsonStart = raw.indexOf('\n{');
    if (jsonStart !== -1) jsonStart++; // skip the \n, point at {
    else jsonStart = raw.startsWith('{') ? 0 : -1; // fallback if file starts with {
    const jsonEnd = raw.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) { output.push(`\n========== ${file}: NO JSON FOUND ==========`); continue; }
    raw = raw.substring(jsonStart, jsonEnd + 1);

    let data;
    try { data = JSON.parse(raw); } catch (e) { output.push(`\n========== ${file}: PARSE ERROR (${e.message}) ==========`); continue; }

    output.push(`\n========== ${file} ==========`);
    let passed = 0, failed = 0, skipped = 0;
    const failures = [];

    function walkSuite(suite, parentPath) {
        const suitePath = parentPath ? parentPath + ' > ' + suite.title : suite.title;
        for (const spec of (suite.specs || [])) {
            for (const test of (spec.tests || [])) {
                for (const result of (test.results || [])) {
                    if (result.status === 'passed') { passed++; continue; }
                    if (result.status === 'skipped') { skipped++; continue; }
                    failed++;
                    let err = result.error?.message || 'No error message';
                    if (err.length > 300) err = err.substring(0, 300) + '...';
                    failures.push({ test: suitePath + ' > ' + spec.title, file: spec.file || '', line: spec.line || 0, status: result.status, error: err });
                }
            }
        }
        for (const child of (suite.suites || [])) walkSuite(child, suitePath);
    }

    for (const suite of (data.suites || [])) walkSuite(suite, '');

    output.push('PASSED: ' + passed + ' | FAILED: ' + failed + ' | SKIPPED: ' + skipped);
    output.push('');
    for (let i = 0; i < failures.length; i++) {
        const f = failures[i];
        output.push('--- FAILURE ' + (i + 1) + ' ---');
        output.push('TEST: ' + f.test);
        output.push('FILE: ' + f.file + ':' + f.line);
        output.push('STATUS: ' + f.status);
        output.push('ERROR: ' + f.error);
        output.push('');
    }
}

const outputPath = path.join(resultDir, 'failures-summary.txt');
fs.writeFileSync(outputPath, output.join('\n'), 'utf-8');
console.log('Done -> ' + outputPath);
