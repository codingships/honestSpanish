/**
 * Create the 3 test users for E2E tests
 * Run: npx tsx scripts/create-test-users.ts
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
});

const USERS = [
    { email: 'alejandro@espanolhonesto.com', password: 'test123', role: 'admin', name: 'Alejandro (Admin)' },
    { email: 'alinandrei74@gmail.com', password: 'test123', role: 'teacher', name: 'Alin (Teacher)' },
    { email: 'alindev95@gmail.com', password: 'test123', role: 'student', name: 'Alin Dev (Student)' },
] as const;

async function createOrUpdateUser(user: typeof USERS[number]) {
    console.log(`\n🔄 Processing: ${user.email} (${user.role})...`);

    // Try to create user
    const { data, error } = await supabase.auth.admin.createUser({
        email: user.email,
        password: user.password,
        email_confirm: true,
        user_metadata: { full_name: user.name },
    });

    let userId: string;

    if (error) {
        if (error.message.includes('already been registered')) {
            console.log(`  ⚠️  Already exists. Updating password and role...`);

            // Find existing user
            const { data: users } = await supabase.auth.admin.listUsers();
            const existing = users?.users?.find(u => u.email === user.email);
            if (!existing) {
                console.error(`  ❌ Could not find existing user ${user.email}`);
                return;
            }
            userId = existing.id;

            // Update password
            await supabase.auth.admin.updateUserById(userId, {
                password: user.password,
                email_confirm: true,
            });
        } else {
            console.error(`  ❌ Error:`, error.message);
            return;
        }
    } else {
        userId = data.user!.id;
        console.log(`  ✅ Created auth user: ${userId}`);
    }

    // Update profile with role
    const { error: profileError } = await supabase
        .from('profiles')
        .update({ role: user.role, full_name: user.name })
        .eq('id', userId);

    if (profileError) {
        console.error(`  ❌ Profile update error:`, profileError.message);

        // Maybe profile doesn't exist yet (trigger might not have fired for existing users)
        const { error: upsertError } = await supabase
            .from('profiles')
            .upsert({
                id: userId,
                email: user.email,
                role: user.role,
                full_name: user.name,
            });

        if (upsertError) {
            console.error(`  ❌ Profile upsert also failed:`, upsertError.message);
        } else {
            console.log(`  ✅ Profile upserted with role: ${user.role}`);
        }
    } else {
        console.log(`  ✅ Profile updated with role: ${user.role}`);
    }
}

async function main() {
    console.log('🚀 Creating test users for E2E...');
    console.log(`📦 Supabase URL: ${supabaseUrl}\n`);

    for (const user of USERS) {
        await createOrUpdateUser(user);
    }

    console.log('\n========================================');
    console.log('✅ DONE — Test users ready');
    console.log('========================================');
    console.log('  admin:   alejandro@espanolhonesto.com / test123');
    console.log('  teacher: alinandrei74@gmail.com / test123');
    console.log('  student: alindev95@gmail.com / test123');
    console.log('========================================\n');
}

main().catch(console.error);
