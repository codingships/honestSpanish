import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
    console.log('Fixing roles...');

    // Admin
    const { error: err1 } = await supabase.from('profiles').update({ role: 'admin' }).eq('email', 'alejandro@espanolhonesto.com');
    if (err1) console.error('Error updating admin:', err1);
    else console.log('Admin updated');

    // Teacher
    const { error: err2 } = await supabase.from('profiles').update({ role: 'teacher' }).eq('email', 'alindev95@gmail.com');
    if (err2) console.error('Error updating teacher:', err2);
    else console.log('Teacher updated');

    // Student (alinandrei74@gmail.com) is already student, but let's confirm
    const { error: err3 } = await supabase.from('profiles').update({ role: 'student' }).eq('email', 'alinandrei74@gmail.com');
    if (err3) console.error('Error updating student:', err3);
    else console.log('Student updated');

    process.exit(0);
}
main();
