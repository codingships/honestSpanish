/**
 * Email Templates
 * Branded HTML templates for transactional emails
 */

// ============================================
// Base Template
// ============================================

export function baseTemplate(content: string): string {
    const year = new Date().getFullYear();

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Español Honesto</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: Arial, sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
        <tr>
            <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 4px; overflow: hidden; max-width: 100%;">
                    <!-- Header -->
                    <tr>
                        <td style="background-color: #006064; padding: 30px; text-align: center;">
                            <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: bold; letter-spacing: 2px;">
                                ESPAÑOL HONESTO
                            </h1>
                        </td>
                    </tr>
                    
                    <!-- Content -->
                    <tr>
                        <td style="padding: 40px 30px;">
                            ${content}
                        </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #E0F7FA; padding: 25px 30px; text-align: center; border-top: 3px solid #006064;">
                            <p style="margin: 0 0 10px 0; color: #006064; font-size: 14px;">
                                ¿Tienes preguntas? Responde a este email.
                            </p>
                            <p style="margin: 0; color: #666666; font-size: 12px;">
                                © ${year} Español Honesto · Madrid, España
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
    `.trim();
}

// ============================================
// Welcome Email
// ============================================

export interface WelcomeEmailData {
    studentName: string;
    packageName: string;
    loginUrl: string;
    driveFolderUrl?: string;
}

export function welcomeEmailTemplate(data: WelcomeEmailData): string {
    const content = `
        <h2 style="color: #006064; margin: 0 0 20px 0;">¡Bienvenido/a, ${data.studentName}!</h2>
        
        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            Tu suscripción al plan <strong>${data.packageName}</strong> está activa. 
            Estamos encantados de tenerte con nosotros.
        </p>
        
        <div style="background-color: #E0F7FA; padding: 20px; margin: 25px 0; border-left: 4px solid #006064;">
            <p style="margin: 0 0 10px 0; color: #006064; font-weight: bold;">Próximos pasos:</p>
            <ol style="margin: 0; padding-left: 20px; color: #333333;">
                <li style="margin-bottom: 8px;">Accede a tu campus para ver tu dashboard</li>
                <li style="margin-bottom: 8px;">Tu profesor se pondrá en contacto contigo pronto</li>
                <li style="margin-bottom: 8px;">Prepárate para tu primera clase</li>
            </ol>
        </div>
        
        <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0;">
            <tr>
                <td align="center">
                    <a href="${data.loginUrl}" style="display: inline-block; background-color: #006064; color: #ffffff; padding: 15px 40px; text-decoration: none; font-weight: bold; font-size: 16px;">
                        ACCEDER AL CAMPUS
                    </a>
                </td>
            </tr>
        </table>
        
        ${data.driveFolderUrl ? `
        <p style="color: #666666; font-size: 14px;">
            📁 Tu carpeta de materiales: <a href="${data.driveFolderUrl}" style="color: #006064;">${data.driveFolderUrl}</a>
        </p>
        ` : ''}
        
        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            ¡Nos vemos pronto!<br>
            <strong>El equipo de Español Honesto</strong>
        </p>
    `;

    return baseTemplate(content);
}

// ============================================
// Class Confirmation Email
// ============================================

export interface ClassConfirmationData {
    recipientName: string;
    isTeacher: boolean;
    otherPartyName: string;
    date: string;
    time: string;
    duration: number;
    meetLink?: string;
    documentLink?: string;
}

export function classConfirmationTemplate(data: ClassConfirmationData): string {
    const roleText = data.isTeacher ? 'alumno' : 'profesor';
    const title = data.isTeacher ? '📅 Nueva clase programada' : '🎉 ¡Tu clase está confirmada!';

    const content = `
        <h2 style="color: #006064; margin: 0 0 20px 0;">${title}</h2>
        
        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            Hola ${data.recipientName},
        </p>
        
        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            ${data.isTeacher ? 'Se ha programado una clase con tu alumno:' : 'Tu próxima clase de español está confirmada:'}
        </p>
        
        <div style="background-color: #f9f9f9; padding: 25px; margin: 25px 0; border: 2px solid #006064;">
            <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                    <td style="padding: 8px 0; color: #666666; font-size: 14px;">📆 Fecha:</td>
                    <td style="padding: 8px 0; color: #333333; font-size: 16px; font-weight: bold;">${data.date}</td>
                </tr>
                <tr>
                    <td style="padding: 8px 0; color: #666666; font-size: 14px;">🕐 Hora:</td>
                    <td style="padding: 8px 0; color: #333333; font-size: 16px; font-weight: bold;">${data.time}</td>
                </tr>
                <tr>
                    <td style="padding: 8px 0; color: #666666; font-size: 14px;">⏱️ Duración:</td>
                    <td style="padding: 8px 0; color: #333333; font-size: 16px;">${data.duration} minutos</td>
                </tr>
                <tr>
                    <td style="padding: 8px 0; color: #666666; font-size: 14px;">👤 ${data.isTeacher ? 'Alumno' : 'Profesor'}:</td>
                    <td style="padding: 8px 0; color: #333333; font-size: 16px;">${data.otherPartyName}</td>
                </tr>
            </table>
        </div>
        
        ${data.meetLink ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin: 25px 0;">
            <tr>
                <td align="center">
                    <a href="${data.meetLink}" style="display: inline-block; background-color: #006064; color: #ffffff; padding: 15px 40px; text-decoration: none; font-weight: bold; font-size: 16px;">
                        🎥 UNIRSE A LA VIDEOLLAMADA
                    </a>
                </td>
            </tr>
        </table>
        ` : ''}
        
        ${data.documentLink ? `
        <p style="color: #666666; font-size: 14px; margin-top: 20px;">
            📄 Documento de la clase: <a href="${data.documentLink}" style="color: #006064;">Abrir documento</a>
        </p>
        ` : ''}
        
        <p style="color: #333333; font-size: 16px; line-height: 1.6; margin-top: 30px;">
            ¡Hasta pronto!<br>
            <strong>Español Honesto</strong>
        </p>
    `;

    return baseTemplate(content);
}

// ============================================
// Class Reminder Email
// ============================================

export interface ClassReminderData {
    recipientName: string;
    isTeacher: boolean;
    otherPartyName: string;
    date: string;
    time: string;
    meetLink?: string;
    documentLink?: string;
}

export function classReminderTemplate(data: ClassReminderData): string {
    const content = `
        <h2 style="color: #006064; margin: 0 0 20px 0;">⏰ Tu clase es mañana</h2>
        
        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            Hola ${data.recipientName},
        </p>
        
        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            Te recordamos que tienes una clase de español programada para mañana.
        </p>
        
        <div style="background-color: #E0F7FA; padding: 25px; margin: 25px 0; border-left: 4px solid #006064;">
            <p style="margin: 0 0 10px 0; font-size: 18px; color: #006064; font-weight: bold;">
                ${data.date} a las ${data.time}
            </p>
            <p style="margin: 0; color: #333333; font-size: 14px;">
                Con ${data.isTeacher ? 'tu alumno' : 'tu profesor'} ${data.otherPartyName}
            </p>
        </div>
        
        ${data.meetLink ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin: 25px 0;">
            <tr>
                <td align="center">
                    <a href="${data.meetLink}" style="display: inline-block; background-color: #006064; color: #ffffff; padding: 15px 40px; text-decoration: none; font-weight: bold; font-size: 16px;">
                        🎥 LINK DE LA VIDEOLLAMADA
                    </a>
                </td>
            </tr>
        </table>
        ` : ''}
        
        ${data.documentLink ? `
        <p style="color: #666666; font-size: 14px;">
            📄 <a href="${data.documentLink}" style="color: #006064;">Ver documento de la clase</a>
        </p>
        ` : ''}
        
        <p style="color: #333333; font-size: 16px; line-height: 1.6; margin-top: 30px;">
            ¡Nos vemos mañana!<br>
            <strong>Español Honesto</strong>
        </p>
    `;

    return baseTemplate(content);
}

// ============================================
// Class Cancelled Email
// ============================================

export interface ClassCancelledData {
    recipientName: string;
    date: string;
    time: string;
    cancelledBy: 'student' | 'teacher' | 'admin';
    reason?: string;
}

export function classCancelledTemplate(data: ClassCancelledData): string {
    const cancellerText = {
        student: 'el estudiante',
        teacher: 'el profesor',
        admin: 'la administración',
    }[data.cancelledBy];

    const content = `
        <h2 style="color: #006064; margin: 0 0 20px 0;">❌ Clase cancelada</h2>
        
        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            Hola ${data.recipientName},
        </p>
        
        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            Te informamos que la clase programada ha sido cancelada por ${cancellerText}.
        </p>
        
        <div style="background-color: #fff3cd; padding: 25px; margin: 25px 0; border-left: 4px solid #856404;">
            <p style="margin: 0 0 10px 0; color: #856404; font-weight: bold;">Detalles de la clase cancelada:</p>
            <p style="margin: 0; color: #333333;">
                📆 ${data.date}<br>
                🕐 ${data.time}
            </p>
            ${data.reason ? `
            <p style="margin: 15px 0 0 0; color: #666666; font-size: 14px;">
                <em>Motivo: ${data.reason}</em>
            </p>
            ` : ''}
        </div>
        
        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            La sesión está disponible para reprogramar. Si tienes alguna pregunta, no dudes en contactarnos.
        </p>
        
        <p style="color: #333333; font-size: 16px; line-height: 1.6; margin-top: 30px;">
            Un saludo,<br>
            <strong>Español Honesto</strong>
        </p>
    `;

    return baseTemplate(content);
}
