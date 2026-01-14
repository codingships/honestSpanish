/**
 * k6 Load Tests - Stress Test
 * 
 * Pushes the system to its limits to find breaking points:
 * - Gradual ramp up to high load
 * - Sustained high load
 * - Spike tests
 * - Recovery testing
 * 
 * Run with: k6 run tests/load/stress-test.js
 * 
 * WARNING: This test is intensive. Run carefully.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Counter, Trend } from 'k6/metrics';

// Custom metrics
const errors = new Rate('errors');
const timeouts = new Counter('timeouts');
const responseTime = new Trend('response_time');

export const options = {
    // Stress test stages
    stages: [
        { duration: '1m', target: 20 },    // Below normal load
        { duration: '2m', target: 50 },    // Normal load
        { duration: '2m', target: 100 },   // Around breaking point
        { duration: '2m', target: 150 },   // Beyond breaking point
        { duration: '1m', target: 200 },   // WAY beyond
        { duration: '2m', target: 0 },     // Recovery
    ],

    thresholds: {
        http_req_duration: ['p(99)<5000'],  // Allow slower for stress
        http_req_failed: ['rate<0.3'],       // Higher failure tolerance
        errors: ['rate<0.5'],                // Expect some errors
    },

    // Don't fail the whole test for individual errors
    noConnectionReuse: false,
    userAgent: 'k6-stress-test/1.0',
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4321';

export default function () {
    // Mix of different request types
    const requests = [
        () => testEndpoint('/es', 'homepage'),
        () => testEndpoint('/es/login', 'login'),
        () => testEndpoint('/en', 'homepage_en'),
        () => testEndpoint('/ru', 'homepage_ru'),
        () => testAPI('/api/packages', 'packages'),
    ];

    // Pick random endpoints
    const request = requests[Math.floor(Math.random() * requests.length)];
    request();

    // Very short sleep for high RPS
    sleep(Math.random() * 0.5);
}

function testEndpoint(path, name) {
    const start = Date.now();

    const res = http.get(`${BASE_URL}${path}`, {
        tags: { name },
        timeout: '10s',
    });

    const duration = Date.now() - start;
    responseTime.add(duration);

    if (res.status === 0) {
        timeouts.add(1);
        errors.add(1);
        return;
    }

    const success = check(res, {
        'status is 2xx or 3xx': (r) => r.status >= 200 && r.status < 400,
        'response has body': (r) => r.body && r.body.length > 0,
    });

    errors.add(!success);
}

function testAPI(path, name) {
    const res = http.get(`${BASE_URL}${path}`, {
        tags: { name },
        timeout: '5s',
    });

    responseTime.add(res.timings.duration);

    if (res.status === 0) {
        timeouts.add(1);
        errors.add(1);
        return;
    }

    const success = check(res, {
        'API responds': (r) => r.status !== 0,
    });

    errors.add(!success);
}

export function handleSummary(data) {
    const m = data.metrics;

    console.log('\n============ STRESS TEST RESULTS ============\n');

    console.log('🔥 Load Statistics:');
    console.log(`   Total Requests: ${m.http_reqs.values.count}`);
    console.log(`   Requests/sec: ${m.http_reqs.values.rate.toFixed(2)}`);
    console.log(`   Data Received: ${(m.data_received.values.count / 1024 / 1024).toFixed(2)} MB`);

    console.log('\n⏱️ Response Times:');
    console.log(`   Average: ${m.http_req_duration.values.avg.toFixed(2)}ms`);
    console.log(`   Median: ${m.http_req_duration.values.med.toFixed(2)}ms`);
    console.log(`   P90: ${m.http_req_duration.values['p(90)'].toFixed(2)}ms`);
    console.log(`   P95: ${m.http_req_duration.values['p(95)'].toFixed(2)}ms`);
    console.log(`   P99: ${m.http_req_duration.values['p(99)'].toFixed(2)}ms`);
    console.log(`   Max: ${m.http_req_duration.values.max.toFixed(2)}ms`);

    console.log('\n❌ Errors:');
    console.log(`   Failed Requests: ${m.http_req_failed.values.passes || 0}`);
    console.log(`   Timeouts: ${m.timeouts?.values.count || 0}`);
    console.log(`   Error Rate: ${((m.errors?.values.rate || 0) * 100).toFixed(2)}%`);

    console.log('\n🎯 Thresholds:');
    console.log(`   P99 < 5000ms: ${m.http_req_duration.values['p(99)'] < 5000 ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   Error Rate < 30%: ${(m.http_req_failed?.values.rate || 0) < 0.3 ? '✅ PASS' : '❌ FAIL'}`);

    console.log('\n=============================================\n');

    return {
        'stress-test-results.json': JSON.stringify(data, null, 2),
    };
}
