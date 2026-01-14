import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate } from 'k6/metrics';

// Custom metrics
const pageLoadDuration = new Trend('page_load_duration');
const checkSuccess = new Rate('check_success');

// SCALED LOAD TEST - 100 USERS
// Ramps up from 2 to 100 users
export const options = {
    scenarios: {
        scaled_load: {
            executor: 'ramping-vus',
            startVUs: 2,
            stages: [
                { duration: '15s', target: 10 },   // Warm up: 2→10 users
                { duration: '20s', target: 25 },   // Light load: 10→25 users
                { duration: '20s', target: 50 },   // Medium load: 25→50 users
                { duration: '20s', target: 75 },   // Heavy load: 50→75 users
                { duration: '20s', target: 100 },  // Peak load: 75→100 users
                { duration: '30s', target: 100 },  // Sustain peak
                { duration: '15s', target: 0 },    // Ramp down
            ],
        },
    },
    thresholds: {
        http_req_duration: ['p(95)<8000'],   // 95% under 8 seconds
        http_req_failed: ['rate<0.40'],      // Less than 40% failures
        check_success: ['rate>0.50'],         // 50%+ checks pass
    },
};

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:4321';

export default function () {
    // Test 1: Landing page
    group('Landing', () => {
        const start = Date.now();
        const res = http.get(`${BASE_URL}/es`, { timeout: '10s' });
        pageLoadDuration.add(Date.now() - start);

        const ok = check(res, {
            'landing 200': (r) => r.status === 200,
        });
        checkSuccess.add(ok);
    });

    sleep(1);

    // Test 2: Login page
    group('Login', () => {
        const res = http.get(`${BASE_URL}/es/login`, { timeout: '10s' });
        const ok = check(res, {
            'login 200': (r) => r.status === 200,
        });
        checkSuccess.add(ok);
    });

    sleep(1);

    // Test 3: Campus (redirect expected)
    group('Campus', () => {
        const res = http.get(`${BASE_URL}/es/campus`, { timeout: '10s' });
        const ok = check(res, {
            'campus responds': (r) => r.status === 200 || r.status === 302,
        });
        checkSuccess.add(ok);
    });

    // User think time between iterations
    sleep(1 + Math.random());
}

export function handleSummary(data) {
    const duration = data.metrics.http_req_duration;
    const reqs = data.metrics.http_reqs;
    const failed = data.metrics.http_req_failed;
    const checks = data.metrics.checks;

    const passRate = checks ? (checks.values.passes / (checks.values.passes + checks.values.fails) * 100) : 0;

    console.log('\n╔════════════════════════════════════════╗');
    console.log('║    📊 SCALED LOAD TEST RESULTS         ║');
    console.log('╠════════════════════════════════════════╣');
    console.log(`║ Peak VUs:         100 concurrent users ║`);
    console.log(`║ Duration:         ~2.5 minutes         ║`);
    console.log('╠════════════════════════════════════════╣');
    console.log(`║ Total Requests:   ${String(reqs?.values?.count || 0).padEnd(19)}║`);
    console.log(`║ Request Rate:     ${String((reqs?.values?.rate || 0).toFixed(1) + ' req/s').padEnd(19)}║`);
    console.log(`║ Failed Rate:      ${String(((failed?.values?.rate || 0) * 100).toFixed(1) + '%').padEnd(19)}║`);
    console.log(`║ Checks Passed:    ${String(passRate.toFixed(1) + '%').padEnd(19)}║`);
    console.log('╠════════════════════════════════════════╣');
    console.log('║ Response Times:                        ║');
    console.log(`║   Average:        ${String((duration?.values?.avg || 0).toFixed(0) + 'ms').padEnd(19)}║`);
    console.log(`║   Median (P50):   ${String((duration?.values?.med || 0).toFixed(0) + 'ms').padEnd(19)}║`);
    console.log(`║   P90:            ${String((duration?.values['p(90)'] || 0).toFixed(0) + 'ms').padEnd(19)}║`);
    console.log(`║   P95:            ${String((duration?.values['p(95)'] || 0).toFixed(0) + 'ms').padEnd(19)}║`);
    console.log(`║   Max:            ${String((duration?.values?.max || 0).toFixed(0) + 'ms').padEnd(19)}║`);
    console.log('╚════════════════════════════════════════╝\n');

    // Evaluation
    const p95 = duration?.values['p(95)'] || 0;
    const failRate = (failed?.values?.rate || 0) * 100;

    if (failRate < 5 && p95 < 2000) {
        console.log('✅ RESULTADO: EXCELENTE - El servidor maneja 50 usuarios sin problemas');
    } else if (failRate < 20 && p95 < 5000) {
        console.log('⚠️  RESULTADO: ACEPTABLE - Funciona pero con algo de degradación');
    } else {
        console.log('❌ RESULTADO: NECESITA OPTIMIZACIÓN - El servidor tiene dificultades bajo carga');
    }

    return {};
}
