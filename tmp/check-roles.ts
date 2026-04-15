import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
    console.log('Querying roles...');
    const { data, error } = await supabase.from('profiles').select('email, role, full_name');
    if (error) console.error('Error:', error);
    else console.log(JSON.stringify(data, null, 2));
    process.exit(0);
}
main();
