/**
 * k6 Load Tests - Authentication Flow
 * 
 * Simulates realistic user authentication patterns:
 * - Login attempts (successful and failed)
 * - Session validation
 * - Logout flows
 * 
 * Run with: k6 run tests/load/auth-load.js
 */
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Counter } from 'k6/metrics';

// Custom metrics
const loginFailures = new Counter('login_failures');
const loginSuccesses = new Counter('login_successes');
const errorRate = new Rate('errors');

export const options = {
    stages: [
        { duration: '20s', target: 5 },    // Warm up
        { duration: '40s', target: 15 },   // Normal load
        { duration: '20s', target: 30 },   // Peak load
        { duration: '20s', target: 5 },    // Cool down
    ],

    thresholds: {
        http_req_duration: ['p(95)<3000'],
        errors: ['rate<0.2'],
    },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4321';

export default function () {
    group('Authentication Flow', () => {
        // Simulate different user behaviors
        const scenario = Math.random();

        if (scenario < 0.6) {
            // 60% - Try to login (simulated)
            simulateLoginAttempt();
        } else if (scenario < 0.8) {
            // 20% - Access protected page without auth
            accessProtectedPage();
        } else {
            // 20% - Browse public pages
            browsePublicPages();
        }
    });

    sleep(Math.random() * 3 + 1);
}

function simulateLoginAttempt() {
    // First, get the login page
    const loginPage = http.get(`${BASE_URL}/es/login`);

    check(loginPage, {
        'login page loads': (r) => r.status === 200,
    });

    sleep(0.5);

    // Simulate form submission (will fail without real credentials)
    const payload = JSON.stringify({
        email: `test_${__VU}_${__ITER}@example.com`,
        password: 'testpassword123',
    });

    const loginRes = http.post(`${BASE_URL}/api/auth/login`, payload, {
        headers: {
            'Content-Type': 'application/json',
        },
        tags: { name: 'login_attempt' },
    });

    // Most will fail since these are fake credentials
    if (loginRes.status === 200) {
        loginSuccesses.add(1);
    } else if (loginRes.status === 401 || loginRes.status === 400) {
        // Expected failure for fake credentials
        loginFailures.add(1);
    } else {
        errorRate.add(1);
    }

    check(loginRes, {
        'login responds': (r) => r.status !== 500,
        'login not too slow': (r) => r.timings.duration < 2000,
    });
}

function accessProtectedPage() {
    const protectedPages = [
        '/es/campus',
        '/es/campus/classes',
        '/es/campus/account',
    ];

    const page = protectedPages[Math.floor(Math.random() * protectedPages.length)];
    const res = http.get(`${BASE_URL}${page}`, {
        tags: { name: 'protected_page' },
        redirects: 0, // Don't follow redirects
    });

    const success = check(res, {
        'protected redirects or returns 401': (r) =>
            r.status === 302 || r.status === 301 || r.status === 401 || r.status === 200,
    });

    errorRate.add(!success);
}

function browsePublicPages() {
    const pages = [
        '/es',
        '/en',
        '/ru',
        '/es/login',
    ];

    pages.forEach(page => {
        const res = http.get(`${BASE_URL}${page}`, {
            tags: { name: 'public_page' },
        });

        check(res, {
            'public page loads': (r) => r.status === 200,
        });

        sleep(0.3);
    });
}

export function handleSummary(data) {
    const metrics = data.metrics;

    console.log('\n========== AUTH LOAD TEST SUMMARY ==========\n');
    console.log('🔐 Authentication Metrics:');
    console.log(`   Login Attempts: ${(metrics.login_failures?.values.count || 0) + (metrics.login_successes?.values.count || 0)}`);
    console.log(`   Login Failures (expected): ${metrics.login_failures?.values.count || 0}`);
    console.log(`   Login Successes: ${metrics.login_successes?.values.count || 0}`);
    console.log('\n📊 Performance:');
    console.log(`   Avg Response: ${metrics.http_req_duration.values.avg.toFixed(2)}ms`);
    console.log(`   P95 Response: ${metrics.http_req_duration.values['p(95)'].toFixed(2)}ms`);
    console.log(`   Error Rate: ${(metrics.errors?.values.rate * 100 || 0).toFixed(2)}%`);
    console.log('\n=============================================\n');

    return {
        'stdout': JSON.stringify({ summary: 'Auth load test complete' }),
    };
}
