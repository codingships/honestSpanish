import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY! // Uses Service Role to bypass RLS and admin restrictions
);

async function main() {
    console.log('Buscando usuario alinandrei75@gmail.com en Supabase Auth...');
    
    // 1. Encontrar el user en auth.users
    const { data: users, error: searchError } = await supabase.auth.admin.listUsers();
    
    if (searchError) {
        console.error('Error listing users:', searchError);
        return;
    }
    
    const targetUser = users.users.find(u => u.email === 'alinandrei75@gmail.com');
    if (!targetUser) {
        console.log('No se encontró el usuario en auth.users. Puede que este sea un entorno fresco.');
        return;
    }
    
    // 2. Actualizar email en Auth
    const { error: updateError } = await supabase.auth.admin.updateUserById(
        targetUser.id,
        { email: 'alinandrei74@gmail.com', email_confirm: true }
    );
    
    if (updateError) {
        console.error('Error actualizando email en auth.users:', updateError);
        return;
    }
    
    console.log(`Email actualizado a alinandrei74@gmail.com en auth.users para ID: ${targetUser.id}`);
    
    // 3. Profiles syncs automatically on select setups, but let's just make sure.
    // The profile table uses references to auth.users.
    
    console.log('Todo listo.');
}

main().catch(console.error);
