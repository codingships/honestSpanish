import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { createStudentFolderStructure } from '../src/lib/google/student-folder';
import { createClassDocument } from '../src/lib/google/drive';
import { createClassEvent } from '../src/lib/google/calendar';

const supabase = createClient(
    process.env.PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
);

async function run() {
    console.log('🚀 Iniciando configuración de Google Workspace para Test...');
    
    // 1. Fetch users
    const studentEmail = 'alinandrei74@gmail.com';
    const teacherEmail = 'alindev95@gmail.com';
    
    const { data: studentUsers } = await supabase.auth.admin.listUsers();
    const studentUser = studentUsers.users.find(u => u.email === studentEmail);
    const teacherUser = studentUsers.users.find(u => u.email === teacherEmail);
    
    if (!studentUser || !teacherUser) throw new Error('Estudiante o profesor no encontrados');
    
    // Fetch profiles
    const { data: student } = await supabase.from('profiles').select('*').eq('id', studentUser.id).single();
    const { data: teacher } = await supabase.from('profiles').select('*').eq('id', teacherUser.id).single();

    // 2. Folder structure
    let driveFolderId = student.drive_folder_id;
    if (!driveFolderId) {
        console.log('📁 Creando carpeta de Drive del estudiante...');
        const folderResult = await createStudentFolderStructure({
            studentName: student.full_name || 'Alumno',
            studentEmail: studentEmail,
            teacherName: teacher.full_name
        });
        driveFolderId = folderResult.rootFolderId;
        await supabase.from('profiles').update({ drive_folder_id: driveFolderId }).eq('id', student.id);
        console.log(`✅ Carpeta creada: ${folderResult.rootFolderLink}`);
    } else {
        console.log('ℹ️ El estudiante ya tenía carpeta de Drive.');
    }

    // 3. Process sessions
    console.log('📅 Procesando sesiones...');
    let { data: sessions } = await supabase
        .from('sessions')
        .select('*')
        .eq('student_id', student.id)
        .eq('teacher_id', teacher.id);
        
    if (!sessions || sessions.length === 0) {
        console.log('ℹ️ No se encontraron sesiones. Creando 2 sesiones de prueba por defecto...');
        // Insert dummy classes
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        // Fetch or create a fake subscription
        let { data: sub } = await supabase.from('subscriptions').select('id').eq('student_id', student.id).single();
        if (!sub) {
            // we create a raw package just for it if missing
            let { data: pkg } = await supabase.from('packages').select('id').limit(1).single();
            if (!pkg) {
                const { data: newPkg, error: pkgErr } = await supabase.from('packages').insert({
                    name: 'essential',
                    display_name: '{"es": "Esencial", "en": "Essential", "ru": "Базовый"}',
                    sessions_per_month: 4,
                    price_monthly: 16000,
                    stripe_price_1m: 'x',
                    stripe_price_3m: 'y',
                    is_active: true
                }).select('id').single();
                if (pkgErr) throw pkgErr;
                pkg = newPkg;
            }
            const { data: newSub } = await supabase.from('subscriptions').insert({
                student_id: student.id,
                package_id: pkg!.id,
                status: 'active',
                duration_months: 1,
                starts_at: today.toISOString().split('T')[0],
                ends_at: tomorrow.toISOString().split('T')[0],
                sessions_total: 4,
                sessions_used: 1
            }).select('id').single();
            sub = newSub;
        }

        await supabase.from('sessions').insert([
            { student_id: student.id, teacher_id: teacher.id, status: 'completed', duration_minutes: 60, scheduled_at: today.toISOString(), subscription_id: sub!.id },
            { student_id: student.id, teacher_id: teacher.id, status: 'scheduled', duration_minutes: 60, scheduled_at: tomorrow.toISOString(), subscription_id: sub!.id },
        ]);

        const { data: newSessions } = await supabase.from('sessions').select('*').eq('student_id', student.id).eq('teacher_id', teacher.id);
        sessions = newSessions;
    }

    for (const session of sessions!) {
        console.log(`\n⚙️ Configurando sesión ID: ${session.id} (Status: ${session.status})`);
        const updateData: any = {};
        
        // Document
        if (!session.drive_doc_id) {
            console.log('   📄 Creando Documento de la clase...');
            const docResult = await createClassDocument({
                studentName: student.full_name || 'Alumno',
                studentRootFolderId: driveFolderId,
                level: student.current_level || 'A2',
                classDate: new Date(session.scheduled_at)
            });
            if (docResult) {
                updateData.drive_doc_id = docResult.docId;
                updateData.drive_doc_url = docResult.docUrl;
                console.log(`   ✅ Documento creado: ${docResult.docUrl}`);
            }
        }
        
        // Calendar Event
        if (!session.calendar_event_id && session.status === 'scheduled') {
            console.log('   🗓️ Creando Evento de Google Calendar...');
            const start = new Date(session.scheduled_at);
            const end = new Date(start.getTime() + session.duration_minutes * 60000);
            
            const eventResult = await createClassEvent({
                summary: `Clase de Español - ${student.full_name}`,
                studentEmail,
                teacherEmail,
                startTime: start,
                endTime: end,
                documentLink: updateData.drive_doc_url || session.drive_doc_url,
                studentFolderLink: `https://drive.google.com/drive/folders/${driveFolderId}`
            });
            updateData.calendar_event_id = eventResult.eventId;
            updateData.meet_link = eventResult.meetLink;
            console.log(`   ✅ Evento creado: ${eventResult.htmlLink}`);
        }
        
        if (Object.keys(updateData).length > 0) {
            await supabase.from('sessions').update(updateData).eq('id', session.id);
            console.log('   💾 Sesión actualizada en base de datos.');
        } else {
            console.log('   ℹ️ Sesión ya estaba configurada.');
        }
    }
}

run().catch(console.error);
