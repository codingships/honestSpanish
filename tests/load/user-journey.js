/**
 * k6 Load Tests - User Journey Simulation
 * 
 * Simulates realistic user journeys through the application:
 * - New visitor browsing
 * - Student checking classes
 * - Teacher checking calendar
 * 
 * Run with: k6 run tests/load/user-journey.js
 */
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend } from 'k6/metrics';

// Journey-specific metrics
const visitorJourney = new Trend('visitor_journey_duration');
const studentJourney = new Trend('student_journey_duration');

export const options = {
    scenarios: {
        // Scenario 1: New visitors browsing (most common)
        visitors: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '30s', target: 20 },
                { duration: '1m', target: 20 },
                { duration: '30s', target: 0 },
            ],
            exec: 'visitorJourney',
        },

        // Scenario 2: Students checking their classes
        students: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '30s', target: 10 },
                { duration: '1m', target: 10 },
                { duration: '30s', target: 0 },
            ],
            exec: 'studentJourney',
            startTime: '10s', // Start 10s after visitors
        },
    },

    thresholds: {
        'visitor_journey_duration': ['p(95)<10000'],
        'student_journey_duration': ['p(95)<15000'],
    },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4321';

// Journey 1: New visitor browsing the site
export function visitorJourney() {
    const journeyStart = Date.now();

    group('Visitor Journey', () => {
        // 1. Land on homepage
        const homepage = http.get(`${BASE_URL}/es`, {
            tags: { journey: 'visitor', step: '1_homepage' },
        });

        check(homepage, {
            'homepage loads': (r) => r.status === 200,
        });

        sleep(2 + Math.random() * 3); // Read homepage

        // 2. Scroll and find pricing
        const pricing = http.get(`${BASE_URL}/es#pricing`, {
            tags: { journey: 'visitor', step: '2_pricing' },
        });

        check(pricing, {
            'pricing section accessible': (r) => r.status === 200,
        });

        sleep(3 + Math.random() * 4); // Compare packages

        // 3. Maybe check another language
        if (Math.random() > 0.7) {
            const enPage = http.get(`${BASE_URL}/en`, {
                tags: { journey: 'visitor', step: '3_english' },
            });

            check(enPage, {
                'english page loads': (r) => r.status === 200,
            });

            sleep(1);
        }

        // 4. Go to login page
        const login = http.get(`${BASE_URL}/es/login`, {
            tags: { journey: 'visitor', step: '4_login' },
        });

        check(login, {
            'login page loads': (r) => r.status === 200,
        });

        sleep(1);
    });

    visitorJourney.add(Date.now() - journeyStart);
}

// Journey 2: Student checking their classes
export function studentJourney() {
    const journeyStart = Date.now();

    group('Student Journey', () => {
        // 1. Go to login
        const login = http.get(`${BASE_URL}/es/login`, {
            tags: { journey: 'student', step: '1_login' },
        });

        check(login, {
            'login page loads': (r) => r.status === 200,
        });

        sleep(1);

        // 2. Try to access campus (will redirect without auth)
        const campus = http.get(`${BASE_URL}/es/campus`, {
            tags: { journey: 'student', step: '2_campus' },
            redirects: 5,
        });

        check(campus, {
            'campus responds': (r) => r.status === 200 || r.status === 302,
        });

        sleep(1.5);

        // 3. Try to access classes page
        const classes = http.get(`${BASE_URL}/es/campus/classes`, {
            tags: { journey: 'student', step: '3_classes' },
            redirects: 5,
        });

        check(classes, {
            'classes page responds': (r) => r.status === 200 || r.status === 302,
        });

        sleep(2);

        // 4. Check account
        const account = http.get(`${BASE_URL}/es/campus/account`, {
            tags: { journey: 'student', step: '4_account' },
            redirects: 5,
        });

        check(account, {
            'account page responds': (r) => r.status === 200 || r.status === 302,
        });

        sleep(1);
    });

    studentJourney.add(Date.now() - journeyStart);
}

export function handleSummary(data) {
    const m = data.metrics;

    console.log('\n========== USER JOURNEY RESULTS ==========\n');

    console.log('👤 Visitor Journey:');
    if (m.visitor_journey_duration) {
        console.log(`   Avg Duration: ${m.visitor_journey_duration.values.avg.toFixed(2)}ms`);
        console.log(`   P95 Duration: ${m.visitor_journey_duration.values['p(95)'].toFixed(2)}ms`);
    }

    console.log('\n🎓 Student Journey:');
    if (m.student_journey_duration) {
        console.log(`   Avg Duration: ${m.student_journey_duration.values.avg.toFixed(2)}ms`);
        console.log(`   P95 Duration: ${m.student_journey_duration.values['p(95)'].toFixed(2)}ms`);
    }

    console.log('\n📊 Overall:');
    console.log(`   Total Requests: ${m.http_reqs.values.count}`);
    console.log(`   Avg Response: ${m.http_req_duration.values.avg.toFixed(2)}ms`);
    console.log(`   Failed: ${m.http_req_failed.values.passes || 0}`);

    console.log('\n==========================================\n');

    return {
        'user-journey-results.json': JSON.stringify(data, null, 2),
    };
}
