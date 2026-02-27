import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables directly from .env file
dotenv.config();

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Faltan las variables de Supabase (PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY) en el .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false,
    },
});

async function getOrCreateUser(email: string, fullName: string, role: string) {
    // Buscar si ya existe
    const { data: { users }, error: fetchError } = await supabase.auth.admin.listUsers();
    if (fetchError) throw fetchError;

    let user = users.find(u => u.email === email);

    if (!user) {
        // Crear
        const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
            email,
            password: 'test123',
            email_confirm: true,
            user_metadata: { full_name: fullName }
        });

        if (createError) throw createError;
        user = newUser.user;
        console.log(`✅ Usuario creado: ${email} (${role})`);
    } else {
        // Actualizar contraseña al valor por defecto y confirmar
        await supabase.auth.admin.updateUserById(user.id, {
            password: 'test123',
            email_confirm: true
        });
        console.log(`ℹ️ Usuario ya existente (contraseña actualizada): ${email} (${role})`);
    }

    // Asegurar que el rol en la tabla profiles es correcto
    await supabase.from('profiles').update({ role }).eq('id', user.id);

    return user.id;
}

async function setupUsers() {
    console.log('👤 Configurando cuentas del Búnker...');

    const adminId = await getOrCreateUser('alejandro@espanolhonesto.com', 'Admin Alejandro', 'admin');
    const teacherId = await getOrCreateUser('alinandrei74@gmail.com', 'Profesor Alin', 'teacher');
    const studentId = await getOrCreateUser('alindev95@gmail.com', 'Alumno Alin', 'student');

    return { adminId, teacherIds: [teacherId], studentIds: [studentId] };
}

async function assignTeachers(teacherIds: string[], studentIds: string[]) {
    console.log('🎓 Asignando el Profesor al Estudiante...');

    // Check if assignment exists
    const { data: existing } = await supabase
        .from('student_teachers')
        .select('*')
        .eq('student_id', studentIds[0])
        .eq('teacher_id', teacherIds[0]);

    if (!existing || existing.length === 0) {
        await supabase.from('student_teachers').insert({
            student_id: studentIds[0],
            teacher_id: teacherIds[0],
            is_primary: true
        });
        console.log('✅ Profesor asignado correctamente.');
    } else {
        console.log('ℹ️ El profesor ya estaba asignado al estudiante.');
    }
}

async function createSubscriptionsAndSessions(studentIds: string[], teacherIds: string[]) {
    console.log('📦 Rellenando Suscripciones y Sesiones falsas...');

    // Obtener paquetes existentes
    const { data: packages } = await supabase.from('packages').select('id, name, sessions_per_month');

    if (!packages || packages.length === 0) {
        console.error('❌ No se encontraron paquetes en la base de datos.');
        return;
    }

    const essentialPack = packages.find(p => p.name === 'essential');

    if (!essentialPack) {
        console.error('❌ No se encontró el paquete "essential".');
        return;
    }

    const today = new Date();
    const nextMonth = new Date();
    nextMonth.setMonth(today.getMonth() + 1);

    // Comprobar si ya tiene suscripción para no duplicar en cada ejecución
    const { data: existingSubs } = await supabase
        .from('subscriptions')
        .select('id')
        .eq('student_id', studentIds[0])
        .eq('status', 'active');

    let subId;

    if (!existingSubs || existingSubs.length === 0) {
        const { data: sub } = await supabase.from('subscriptions').insert({
            student_id: studentIds[0],
            package_id: essentialPack.id,
            status: 'active',
            duration_months: 1,
            starts_at: today.toISOString().split('T')[0],
            ends_at: nextMonth.toISOString().split('T')[0],
            sessions_total: essentialPack.sessions_per_month,
            sessions_used: 1 // 1 consumed
        }).select('id').single();

        if (!sub) {
            console.error('❌ Error creando suscripción.');
            return;
        }
        subId = sub.id;
        console.log('✅ Suscripción Activa generada.');
    } else {
        subId = existingSubs[0].id;
        console.log('ℹ️ El estudiante ya tenía una suscripción activa.');
    }

    // Insertar sesiones solo si no hay sesiones programadas en el futuro
    const { data: futureSessions } = await supabase
        .from('sessions')
        .select('id')
        .eq('student_id', studentIds[0])
        .eq('status', 'scheduled');

    if (!futureSessions || futureSessions.length === 0) {
        // Sesión completada (Ayer)
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        await supabase.from('sessions').insert({
            subscription_id: subId,
            student_id: studentIds[0],
            teacher_id: teacherIds[0],
            scheduled_at: yesterday.toISOString(),
            duration_minutes: 60,
            status: 'completed'
        });

        // Sesión programada (Mañana)
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        await supabase.from('sessions').insert({
            subscription_id: subId,
            student_id: studentIds[0],
            teacher_id: teacherIds[0],
            scheduled_at: tomorrow.toISOString(),
            duration_minutes: 60,
            status: 'scheduled'
        });

        console.log('✅ Clases de prueba (1 completada, 1 programada) insertadas.');
    } else {
        console.log('ℹ️ El estudiante ya tenía clases en su calendario.');
    }
}

// Ejecución principal
async function run() {
    try {
        console.log('🚀 Iniciando proceso de Setup/Seeding de Español Honesto...');
        const { teacherIds, studentIds } = await setupUsers();
        await assignTeachers(teacherIds, studentIds);
        await createSubscriptionsAndSessions(studentIds, teacherIds);
        console.log('\n🎉 Setup completado con éxito!');
        console.log('👉 Contraseña para las 3 cuentas: test123');
    } catch (error) {
        console.error('\n❌ Error fatal durante el Seeding:', error);
    }
}

run();
