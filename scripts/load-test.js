import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { SharedArray } from 'k6/data';

// Load test credentials
const credentials = new SharedArray('credentials', function () {
    // Read from file - you'll need to update this path
    return JSON.parse(open('./test-credentials.json'));
});

// Get users by role
const students = credentials.filter(c => c.role === 'student');

// Test configuration
export const options = {
    scenarios: {
        // Smoke test - minimal load
        smoke: {
            executor: 'constant-vus',
            vus: 5,
            duration: '30s',
            startTime: '0s',
            tags: { scenario: 'smoke' },
        },
        // Load test - normal load
        load: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '30s', target: 20 },  // Ramp up to 20 users
                { duration: '1m', target: 50 },   // Ramp up to 50 users
                { duration: '2m', target: 50 },   // Stay at 50 users
                { duration: '30s', target: 0 },   // Ramp down
            ],
            startTime: '30s',
            tags: { scenario: 'load' },
        },
        // Stress test - high load
        stress: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '30s', target: 100 }, // Ramp up to 100
                { duration: '1m', target: 100 },  // Stay at 100
                { duration: '30s', target: 0 },   // Ramp down
            ],
            startTime: '4m30s',
            tags: { scenario: 'stress' },
        },
    },
    thresholds: {
        http_req_duration: ['p(95)<2000'], // 95% of requests under 2s
        http_req_failed: ['rate<0.05'],    // Less than 5% failure rate
    },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4321';
const SUPABASE_URL = __ENV.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = __ENV.SUPABASE_ANON_KEY || '';

// Helper: Login and get JWT
function login(email, password) {
    const loginRes = http.post(
        `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
        JSON.stringify({ email, password }),
        {
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_ANON_KEY,
            },
        }
    );

    check(loginRes, {
        'login successful': (r) => r.status === 200,
    });

    if (loginRes.status === 200) {
        return JSON.parse(loginRes.body).access_token;
    }
    return null;
}

// Main test function
export default function () {
    // Pick random student for this VU
    const student = students[Math.floor(Math.random() * students.length)];

    group('Public Pages', () => {
        // Landing page
        const landing = http.get(`${BASE_URL}/es`);
        check(landing, {
            'landing page loads': (r) => r.status === 200,
        });
        sleep(1);

        // Login page
        const loginPage = http.get(`${BASE_URL}/es/login`);
        check(loginPage, {
            'login page loads': (r) => r.status === 200,
        });
        sleep(0.5);
    });

    group('Authentication', () => {
        // Simulated login (via Supabase API)
        if (SUPABASE_URL && SUPABASE_ANON_KEY) {
            const token = login(student.email, student.password);

            if (token) {
                // Test authenticated page
                const campusRes = http.get(`${BASE_URL}/es/campus`, {
                    headers: { 'Authorization': `Bearer ${token}` },
                });
                check(campusRes, {
                    'campus page accessible': (r) => r.status === 200 || r.status === 302,
                });
            }
        }
        sleep(1);
    });

    group('API Endpoints', () => {
        // Test public API endpoint responses
        const checkoutTest = http.post(
            `${BASE_URL}/api/create-checkout`,
            JSON.stringify({ priceId: 'test' }),
            { headers: { 'Content-Type': 'application/json' } }
        );

        check(checkoutTest, {
            'checkout API responds': (r) => r.status !== 500,
        });
        sleep(0.5);
    });

    sleep(Math.random() * 2); // Random delay between iterations
}

// Cleanup function
export function teardown(data) {
    console.log('Load test completed!');
}
