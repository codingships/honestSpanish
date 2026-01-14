import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
});

// Configuration
const CONFIG = {
    admins: 2,
    teachers: 5,
    students: 500,
    domain: 'test.espanolhonesto.com',
    // Student distribution
    activeSubscriptionPercent: 30,
    expiredSubscriptionPercent: 20,
};

interface CreatedUser {
    id: string;
    email: string;
    role: 'admin' | 'teacher' | 'student';
}

const createdUsers: CreatedUser[] = [];

async function createUser(
    email: string,
    password: string,
    role: 'admin' | 'teacher' | 'student',
    fullName: string
): Promise<string | null> {
    try {
        // Create auth user
        const { data, error } = await supabase.auth.admin.createUser({
            email,
            password,
            email_confirm: true, // Skip email confirmation
            user_metadata: { full_name: fullName }
        });

        if (error) {
            if (error.message.includes('already been registered')) {
                console.log(`  ⚠️ ${email} already exists, skipping...`);
                return null;
            }
            throw error;
        }

        const userId = data.user!.id;

        // Update profile with role (trigger creates profile, we just update role)
        await supabase
            .from('profiles')
            .update({ role, full_name: fullName })
            .eq('id', userId);

        createdUsers.push({ id: userId, email, role });
        return userId;
    } catch (err: any) {
        console.error(`  ❌ Error creating ${email}:`, err.message);
        return null;
    }
}

async function createSubscription(
    studentId: string,
    isExpired: boolean
): Promise<void> {
    // Get a random package
    const { data: packages } = await supabase
        .from('packages')
        .select('id, sessions_per_month')
        .limit(3);

    if (!packages || packages.length === 0) return;

    const pkg = packages[Math.floor(Math.random() * packages.length)];
    const durationMonths = [1, 3, 6][Math.floor(Math.random() * 3)];

    const startsAt = isExpired
        ? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) // 90 days ago
        : new Date();

    const endsAt = new Date(startsAt);
    endsAt.setMonth(endsAt.getMonth() + durationMonths);

    await supabase.from('subscriptions').insert({
        student_id: studentId,
        package_id: pkg.id,
        status: isExpired ? 'expired' : 'active',
        duration_months: durationMonths,
        starts_at: startsAt.toISOString().split('T')[0],
        ends_at: endsAt.toISOString().split('T')[0],
        sessions_total: pkg.sessions_per_month * durationMonths,
        sessions_used: Math.floor(Math.random() * (pkg.sessions_per_month * durationMonths)),
    });
}

async function assignTeacher(studentId: string, teacherIds: string[]): Promise<void> {
    if (teacherIds.length === 0) return;

    const teacherId = teacherIds[Math.floor(Math.random() * teacherIds.length)];

    await supabase.from('student_teachers').insert({
        student_id: studentId,
        teacher_id: teacherId,
        is_primary: true,
    });
}

async function main() {
    console.log('🚀 Starting test data generation...\n');
    console.log(`📊 Plan: ${CONFIG.admins} admins, ${CONFIG.teachers} teachers, ${CONFIG.students} students\n`);

    // Create Admins
    console.log('👑 Creating ADMINS...');
    for (let i = 1; i <= CONFIG.admins; i++) {
        const email = `admin-${i}@${CONFIG.domain}`;
        const password = `Admin123!${i}`;
        const name = `Admin User ${i}`;

        const id = await createUser(email, password, 'admin', name);
        if (id) console.log(`  ✅ Created: ${email} (${password})`);
    }

    // Create Teachers
    console.log('\n👨‍🏫 Creating TEACHERS...');
    const teacherIds: string[] = [];
    for (let i = 1; i <= CONFIG.teachers; i++) {
        const email = `teacher-${i}@${CONFIG.domain}`;
        const password = `Teacher123!${i}`;
        const name = `Teacher User ${i}`;

        const id = await createUser(email, password, 'teacher', name);
        if (id) {
            teacherIds.push(id);
            console.log(`  ✅ Created: ${email} (${password})`);
        }
    }

    // Create Students
    console.log('\n🎓 Creating STUDENTS...');
    let created = 0;
    let withActive = 0;
    let withExpired = 0;
    let withoutSub = 0;

    for (let i = 1; i <= CONFIG.students; i++) {
        const email = `student-${i}@${CONFIG.domain}`;
        const password = 'Student123!';
        const name = `Student User ${i}`;

        const id = await createUser(email, password, 'student', name);

        if (id) {
            created++;

            // Determine subscription status
            const rand = Math.random() * 100;
            if (rand < CONFIG.activeSubscriptionPercent) {
                await createSubscription(id, false);
                withActive++;
            } else if (rand < CONFIG.activeSubscriptionPercent + CONFIG.expiredSubscriptionPercent) {
                await createSubscription(id, true);
                withExpired++;
            } else {
                withoutSub++;
            }

            // Assign teacher (50% chance)
            if (Math.random() < 0.5) {
                await assignTeacher(id, teacherIds);
            }

            // Progress log
            if (i % 50 === 0) {
                console.log(`  📦 Progress: ${i}/${CONFIG.students} students created...`);
            }
        }
    }

    // Summary
    console.log('\n========================================');
    console.log('✅ SEED COMPLETED');
    console.log('========================================');
    console.log(`Admins:   ${createdUsers.filter(u => u.role === 'admin').length}`);
    console.log(`Teachers: ${createdUsers.filter(u => u.role === 'teacher').length}`);
    console.log(`Students: ${created}`);
    console.log(`  - Active subscription: ${withActive}`);
    console.log(`  - Expired subscription: ${withExpired}`);
    console.log(`  - No subscription: ${withoutSub}`);
    console.log('========================================\n');

    // Save credentials to file
    const credentials = createdUsers.map(u => ({
        email: u.email,
        password: u.role === 'student' ? 'Student123!' :
            u.role === 'teacher' ? `Teacher123!${u.email.match(/\d+/)![0]}` :
                `Admin123!${u.email.match(/\d+/)![0]}`,
        role: u.role
    }));

    const fs = await import('fs');
    fs.writeFileSync(
        'scripts/test-credentials.json',
        JSON.stringify(credentials, null, 2)
    );
    console.log('📄 Credentials saved to scripts/test-credentials.json');
}

main().catch(console.error);
