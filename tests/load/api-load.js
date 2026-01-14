/**
 * k6 Load Tests - API Endpoints
 * 
 * Tests API performance under load:
 * - Homepage and public pages
 * - Authentication endpoints
 * - Session/Calendar APIs
 * - Concurrent user simulations
 * 
 * Run with: k6 run tests/load/api-load.js
 * 
 * Options:
 *   --vus 10 --duration 30s   (10 users for 30 seconds)
 *   --vus 50 --duration 60s   (stress test)
 */
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const homepageLatency = new Trend('homepage_latency');
const loginLatency = new Trend('login_latency');
const apiLatency = new Trend('api_latency');

// Test configuration
export const options = {
    // Stages define load ramping
    stages: [
        { duration: '30s', target: 10 },   // Ramp up to 10 users
        { duration: '1m', target: 10 },    // Stay at 10 users for 1 min
        { duration: '30s', target: 25 },   // Ramp up to 25 users
        { duration: '1m', target: 25 },    // Stay at 25 users for 1 min
        { duration: '30s', target: 0 },    // Ramp down to 0
    ],

    // Thresholds for pass/fail
    thresholds: {
        http_req_duration: ['p(95)<2000'],   // 95% of requests < 2s
        http_req_failed: ['rate<0.05'],       // Error rate < 5%
        errors: ['rate<0.1'],                  // Custom error rate < 10%
    },
};

// Base URL from environment or default
const BASE_URL = __ENV.BASE_URL || 'http://localhost:4321';

export default function () {
    // Run different test scenarios
    group('Public Pages', () => {
        testHomepage();
        testLoginPage();
        testLegalPages();
    });

    group('API Endpoints', () => {
        testAvailabilityAPI();
        testPackagesAPI();
    });

    // Think time between requests
    sleep(Math.random() * 2 + 1);
}

// Test homepage load
function testHomepage() {
    const res = http.get(`${BASE_URL}/es`, {
        tags: { name: 'homepage' },
    });

    homepageLatency.add(res.timings.duration);

    const success = check(res, {
        'homepage status 200': (r) => r.status === 200,
        'homepage has content': (r) => r.body.length > 1000,
        'homepage loads fast': (r) => r.timings.duration < 3000,
    });

    errorRate.add(!success);
}

// Test login page
function testLoginPage() {
    const res = http.get(`${BASE_URL}/es/login`, {
        tags: { name: 'login_page' },
    });

    loginLatency.add(res.timings.duration);

    const success = check(res, {
        'login page status 200': (r) => r.status === 200,
        'login page has form': (r) => r.body.includes('email') || r.body.includes('password'),
    });

    errorRate.add(!success);
}

// Test legal pages
function testLegalPages() {
    const pages = [
        '/es/legal/privacidad',
        '/es/legal/aviso-legal',
        '/es/legal/cookies',
    ];

    const page = pages[Math.floor(Math.random() * pages.length)];
    const res = http.get(`${BASE_URL}${page}`, {
        tags: { name: 'legal_pages' },
    });

    check(res, {
        'legal page status 200': (r) => r.status === 200,
    });
}

// Test availability API
function testAvailabilityAPI() {
    const today = new Date().toISOString().split('T')[0];
    const res = http.get(`${BASE_URL}/api/calendar/available-slots?date=${today}`, {
        tags: { name: 'available_slots' },
    });

    apiLatency.add(res.timings.duration);

    const success = check(res, {
        'slots API responds': (r) => r.status === 200 || r.status === 401,
        'slots API fast': (r) => r.timings.duration < 1000,
    });

    errorRate.add(!success);
}

// Test packages API
function testPackagesAPI() {
    const res = http.get(`${BASE_URL}/api/packages`, {
        tags: { name: 'packages' },
    });

    apiLatency.add(res.timings.duration);

    check(res, {
        'packages API responds': (r) => r.status === 200 || r.status === 404,
    });
}

// Summary handler
export function handleSummary(data) {
    console.log('\n========== LOAD TEST SUMMARY ==========\n');

    const metrics = data.metrics;

    console.log('📊 Request Metrics:');
    console.log(`   Total Requests: ${metrics.http_reqs.values.count}`);
    console.log(`   Failed Requests: ${metrics.http_req_failed.values.passes || 0}`);
    console.log(`   Avg Duration: ${metrics.http_req_duration.values.avg.toFixed(2)}ms`);
    console.log(`   P95 Duration: ${metrics.http_req_duration.values['p(95)'].toFixed(2)}ms`);
    console.log(`   P99 Duration: ${metrics.http_req_duration.values['p(99)'].toFixed(2)}ms`);

    console.log('\n📈 Custom Metrics:');
    if (metrics.homepage_latency) {
        console.log(`   Homepage Avg: ${metrics.homepage_latency.values.avg.toFixed(2)}ms`);
    }
    if (metrics.api_latency) {
        console.log(`   API Avg: ${metrics.api_latency.values.avg.toFixed(2)}ms`);
    }

    console.log('\n========================================\n');

    return {
        'stdout': JSON.stringify(data, null, 2),
        'load-test-results.json': JSON.stringify(data, null, 2),
    };
}
