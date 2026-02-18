/**
 * Parse Playwright JSON results and output only failures to a clean file.
 * Run: node scripts/parse-test-results.js
 */
const fs = require('fs');
const path = require('path');

const resultDir = path.join(__dirname, '..', 'test-results');
const files = ['public-results.json', 'auth-results.json', 'results.json'];
const output = [];

for (const file of files) {
    const filePath = path.join(resultDir, file);
    if (!fs.existsSync(filePath)) continue;

    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    output.push(`\n========== ${file} ==========`);

    let passed = 0, failed = 0, skipped = 0, timedOut = 0;
    const failures = [];

    function walkSuite(suite, parentPath) {
        const suitePath = parentPath ? `${parentPath} > ${suite.title}` : suite.title;

        for (const spec of (suite.specs || [])) {
            for (const test of (spec.tests || [])) {
                for (const result of (test.results || [])) {
                    if (result.status === 'passed') { passed++; continue; }
                    if (result.status === 'skipped') { skipped++; continue; }
                    if (result.status === 'timedOut') timedOut++;
                    failed++;

                    // Extract just the key error info
                    let errorMsg = result.error?.message || 'No error message';
                    // Trim to first 300 chars to keep it readable
                    if (errorMsg.length > 300) errorMsg = errorMsg.substring(0, 300) + '...';

                    failures.push({
                        test: `${suitePath} > ${spec.title}`,
                        file: spec.file || '',
                        line: spec.line || 0,
                        status: result.status,
                        error: errorMsg,
                    });
                }
            }
        }

        for (const child of (suite.suites || [])) {
            walkSuite(child, suitePath);
        }
    }

    for (const suite of (data.suites || [])) {
        walkSuite(suite, '');
    }

    output.push(`PASSED: ${passed} | FAILED: ${failed} | SKIPPED: ${skipped} | TIMED OUT: ${timedOut}`);
    output.push('');

    for (let i = 0; i < failures.length; i++) {
        const f = failures[i];
        output.push(`--- FAILURE ${i + 1} ---`);
        output.push(`TEST: ${f.test}`);
        output.push(`FILE: ${f.file}:${f.line}`);
        output.push(`STATUS: ${f.status}`);
        output.push(`ERROR: ${f.error}`);
        output.push('');
    }
}

const outputPath = path.join(resultDir, 'failures-summary.txt');
fs.writeFileSync(outputPath, output.join('\n'), 'utf-8');
console.log(`✅ Summary written to: ${outputPath}`);
console.log(`   Total lines: ${output.length}`);
