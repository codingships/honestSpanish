/**
 * Email Templates
 * Branded HTML templates for transactional emails.
 */

import { legalIdentity } from '../legal-identity';

// ============================================
// Base Template
// ============================================

export function baseTemplate(content: string, locale: 'es' | 'en' | 'ru' = 'en'): string {
    const year = new Date().getFullYear();
    const footer = {
        es: { questions: '¿Tienes dudas? Responde a este correo.', location: 'Madrid, España' },
        en: { questions: 'Questions? Reply to this email.', location: 'Madrid, Spain' },
        ru: { questions: 'Есть вопросы? Ответьте на это письмо.', location: 'Мадрид, Испания' },
    }[locale];

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
                    <tr>
                        <td style="background-color: #006064; padding: 30px; text-align: center;">
                            <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: bold; letter-spacing: 2px;">
                                ESPAÑOL HONESTO
                            </h1>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 40px 30px;">
                            ${content}
                        </td>
                    </tr>
                    <tr>
                        <td style="background-color: #E0F7FA; padding: 25px 30px; text-align: center; border-top: 3px solid #006064;">
                            <p style="margin: 0 0 10px 0; color: #006064; font-size: 14px;">
                                ${footer.questions}
                            </p>
                            <p style="margin: 0; color: #666666; font-size: 12px;">
                                © ${year} Español Honesto · ${footer.location}
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

export type WelcomeEmailLocale = 'es' | 'en' | 'ru';

export interface WelcomeEmailData {
    locale: WelcomeEmailLocale;
    studentName: string;
    packageName: string;
    loginUrl: string;
    driveFolderUrl?: string;
    durationMonths?: number;
    startsAt?: string;
    endsAt?: string;
    sessionsTotal?: number;
    amountTotal?: number;
    currency?: string;
    legalPolicyVersion?: string;
    policyAcceptedAt?: string;
    termsUrl?: string;
    supportUrl?: string;
    contractSchemaVersion?: number;
    classDurationMinutes?: number;
    teacherName?: string;
    slotWeekday?: number;
    slotLocalStartTime?: string;
    timezoneName?: string;
    classStartsAt?: string[];
    renewalAnchorAt?: string;
}

const welcomeEmailCopy = {
    es: {
        subject: 'Confirmación de tu suscripción - Español Honesto',
        welcome: 'Bienvenido/a',
        planActive: 'Tu plan está activo',
        contractSummary: 'Confirmación contractual',
        plan: 'Plan',
        period: 'Periodo de suscripción',
        months: 'mes(es)',
        from: 'del',
        to: 'al',
        allowance: 'Sesiones disponibles en este periodo',
        charged: 'Importe cobrado al inicio del periodo',
        renewal: 'Renovación automática: se repetirán el mismo periodo y el mismo importe hasta que desactives la renovación antes del siguiente cobro.',
        expiry: 'Las sesiones no utilizadas caducan al terminar el periodo y no se acumulan, salvo derecho legal o excepción aprobada.',
        cancellation: 'Cancelar con al menos 24 horas devuelve la sesión al saldo; con menos antelación o por no-show se consume, salvo incidencia justificada aprobada.',
        termsVersion: 'Versión de las condiciones',
        accepted: 'aceptada',
        durableTitle: 'Condiciones conservadas en este correo',
        provider: 'Prestador',
        adultOnly: 'Servicio exclusivo para personas de 18 años o más.',
        service: 'Las clases duran 30, 40 o 50 minutos según el producto confirmado; la duración estándar es de 50 minutos. Google Meet no corta automáticamente la llamada.',
        checkoutV2Plan: '4 clases individuales de 50 minutos',
        checkoutV2Offer: '259 EUR cobrados al reservar por cuatro clases individuales de 50 minutos.',
        teacher: 'Profesor',
        weeklySlot: 'Franja semanal',
        classDates: 'Tus cuatro clases',
        renewalDate: 'Siguiente cobro',
        renewalRule: 'La siguiente cuota de 259 EUR se cobra exactamente 28 días después de la primera clase. Solo un cambio mediante autoservicio antes de empezar, solicitado con al menos 24 horas y hasta un máximo inclusivo de 28 días desde la fecha original, mueve las cuatro fechas y el ancla. Un cambio gestionado por soporte fuera de ese límite no la mueve automáticamente. Tras comenzar la primera clase, el ancla queda fija.',
        guaranteeTitle: 'Garantía del primer ciclo',
        guarantee: 'Después de completar la primera clase y antes de comenzar la segunda, puedes solicitar la devolución de 194,25 EUR por las tres clases restantes. La devolución cancela todas las renovaciones futuras.',
        guaranteeWindow: 'Reprogramar la segunda clase con al menos 24 horas de antelación mantiene abierta la garantía. Una cancelación tardía o un no-show consume esa segunda clase y cierra la ventana, salvo que soporte reclasifique una incidencia justificada.',
        checkoutV2Service: 'Este contrato incluye exclusivamente cuatro clases individuales de 50 minutos por cada ciclo literal de 28 días.',
        cancellationChannel: 'Puedes desactivar la renovación desde el portal de pagos o solicitarlo a soporte. Mantendrás el acceso hasta el final del periodo pagado, salvo reembolso o derecho legal distinto.',
        withdrawal: 'Desistimiento: como consumidor dispones de 14 días naturales desde la celebración del contrato. Si pediste el inicio durante ese plazo, podrá descontarse la parte proporcional ya prestada cuando legalmente proceda.',
        withdrawalLoss: 'El derecho de desistimiento solo se pierde tras la ejecución íntegra del servicio cuando solicitaste expresamente su inicio y reconociste esa consecuencia.',
        refund: 'Todo reembolso debido se realizará por el mismo medio de pago y dentro del plazo legal. Cancelar la renovación no reembolsa por sí solo un periodo ya iniciado.',
        modelTitle: 'Modelo de desistimiento',
        model: 'Comunico que desisto de mi contrato. Indicaré el servicio, la fecha de contratación, mi nombre y domicilio y la fecha de esta comunicación. La firma solo es necesaria si se presenta en papel.',
        webReference: 'La versión web de las condiciones también está disponible en',
        support: 'Para cancelar la renovación, comunicar una incidencia o ejercer el desistimiento, usa soporte o responde a este correo.',
        nextSteps: 'Siguientes pasos',
        steps: [
            'Abre el campus y comprueba que puedes acceder a tu panel y materiales.',
            'Responde con cualquier limitación de horario antes de la primera clase.',
            'Coordinaremos manualmente la primera clase respetando la disponibilidad real.',
            'Tu carpeta de materiales debería estar lista antes de la primera clase.',
        ],
        checkoutV2Steps: [
            'Abre el campus y comprueba que puedes acceder a tu panel y materiales.',
            'Revisa debajo el profesor, la franja semanal, la zona horaria y las cuatro fechas que reservaste.',
            'Si necesitas reprogramar, hazlo con al menos 24 horas de antelación desde el campus o pide ayuda a soporte.',
            'Tu carpeta de materiales debería estar lista antes de la primera clase.',
        ],
        openCampus: 'ABRIR CAMPUS',
        materials: 'Tu carpeta de materiales',
        signoff: 'Hasta pronto',
        team: 'El equipo de Español Honesto',
    },
    en: {
        subject: 'Your subscription confirmation - Español Honesto',
        welcome: 'Welcome',
        planActive: 'Your plan is active',
        contractSummary: 'Contract confirmation',
        plan: 'Plan',
        period: 'Subscription period',
        months: 'month(s)',
        from: 'from',
        to: 'to',
        allowance: 'Classes available in this period',
        charged: 'Amount charged at the start of the period',
        renewal: 'Automatic renewal: the same period and amount recur until you disable renewal before the next charge.',
        expiry: 'Unused classes expire at the end of the period and do not roll over, except where a statutory right or approved exception applies.',
        cancellation: 'Cancelling at least 24 hours ahead restores the class credit; later cancellation or a no-show consumes it unless a justified incident is approved.',
        termsVersion: 'Terms version',
        accepted: 'accepted',
        durableTitle: 'Terms preserved in this email',
        provider: 'Provider',
        adultOnly: 'The service is available only to people aged 18 or over.',
        service: 'Classes last 30, 40 or 50 minutes according to the confirmed product; the standard duration is 50 minutes. Google Meet does not automatically end the call.',
        checkoutV2Plan: '4 individual 50-minute classes',
        checkoutV2Offer: 'EUR 259 charged when you reserved the place for four individual 50-minute classes.',
        teacher: 'Teacher',
        weeklySlot: 'Weekly time',
        classDates: 'Your four classes',
        renewalDate: 'Next charge',
        renewalRule: 'The next EUR 259 charge is collected exactly 28 days after the first class. Only a self-service change before classes begin, requested at least 24 hours ahead and up to an inclusive maximum of 28 days from the original date, moves all four dates and the renewal anchor. A change handled by support outside that limit does not move the anchor automatically. Once the first class begins, the renewal anchor is fixed.',
        guaranteeTitle: 'First-cycle guarantee',
        guarantee: 'After completing the first class and before the second begins, you may request a EUR 194.25 refund for the three remaining classes. The refund cancels all future renewals.',
        guaranteeWindow: 'Rescheduling the second class at least 24 hours ahead keeps the guarantee window open. A late cancellation or no-show consumes that second class and closes the window, unless support reclassifies a justified incident.',
        checkoutV2Service: 'This contract includes exactly four individual 50-minute classes in each literal 28-day cycle.',
        cancellationChannel: 'You may disable renewal through the billing portal or ask support. Access remains until the end of the paid period unless a refund or another statutory right applies.',
        withdrawal: 'Withdrawal: as a consumer you have 14 calendar days from conclusion of the contract. If you requested an early start, the proportion already supplied may be deducted where legally applicable.',
        withdrawalLoss: 'The withdrawal right is lost only after full performance where you expressly requested commencement and acknowledged that consequence.',
        refund: 'Any refund due will be made to the original payment method within the statutory period. Stopping renewal does not by itself refund a period already begun.',
        modelTitle: 'Model withdrawal notice',
        model: 'I hereby give notice that I withdraw from my contract. I will state the service, contract date, my name and address, and the date of this notice. A signature is needed only if submitted on paper.',
        webReference: 'The web version of the terms is also available at',
        support: 'To stop renewal, report an incident or exercise withdrawal, use support or reply to this email.',
        nextSteps: 'Next steps',
        steps: [
            'Open the campus and check that you can access your dashboard and materials.',
            'Reply with any schedule limits before your first class.',
            'We will coordinate your first class manually, respecting real availability.',
            'Your materials folder should be ready before the first class.',
        ],
        checkoutV2Steps: [
            'Open the campus and check that you can access your dashboard and materials.',
            'Review below the teacher, weekly time, time zone and four dates you reserved.',
            'If you need to reschedule, do so at least 24 hours ahead from the campus or ask support for help.',
            'Your materials folder should be ready before the first class.',
        ],
        openCampus: 'OPEN CAMPUS',
        materials: 'Your materials folder',
        signoff: 'Speak soon',
        team: 'The Español Honesto team',
    },
    ru: {
        subject: 'Подтверждение вашей подписки - Español Honesto',
        welcome: 'Добро пожаловать',
        planActive: 'Ваш план активен',
        contractSummary: 'Подтверждение договора',
        plan: 'План',
        period: 'Период подписки',
        months: 'мес.',
        from: 'с',
        to: 'по',
        allowance: 'Занятия на этот период',
        charged: 'Сумма, списанная в начале периода',
        renewal: 'Автопродление: тот же период и сумма повторяются, пока вы не отключите продление до следующего списания.',
        expiry: 'Неиспользованные занятия сгорают в конце периода и не переносятся, кроме случаев, предусмотренных законом или одобренных как исключение.',
        cancellation: 'При отмене не менее чем за 24 часа занятие возвращается на баланс; более поздняя отмена или неявка списывает его, если не одобрено обоснованное исключение.',
        termsVersion: 'Версия условий',
        accepted: 'принята',
        durableTitle: 'Условия, сохранённые в этом письме',
        provider: 'Исполнитель',
        adultOnly: 'Услуга доступна только лицам от 18 лет.',
        service: 'Занятия длятся 30, 40 или 50 минут в зависимости от продукта; стандартная длительность — 50 минут. Google Meet не завершает звонок автоматически.',
        checkoutV2Plan: '4 индивидуальных занятия по 50 минут',
        checkoutV2Offer: '259 EUR списаны при бронировании места за четыре индивидуальных занятия по 50 минут.',
        teacher: 'Преподаватель',
        weeklySlot: 'Еженедельное время',
        classDates: 'Ваши четыре занятия',
        renewalDate: 'Следующее списание',
        renewalRule: 'Следующие 259 EUR списываются ровно через 28 дней после первого занятия. Только самостоятельный перенос до начала, оформленный не менее чем за 24 часа и не позднее чем через 28 дней включительно от исходной даты, сдвигает все четыре даты и дату продления. Изменение через службу поддержки вне этого предела не переносит дату продления автоматически. После начала первого занятия дата продления фиксируется.',
        guaranteeTitle: 'Гарантия первого цикла',
        guarantee: 'После завершения первого занятия и до начала второго можно запросить возврат 194,25 EUR за три оставшихся занятия. Возврат отменяет все будущие продления.',
        guaranteeWindow: 'Перенос второго занятия не менее чем за 24 часа сохраняет гарантийное окно. Поздняя отмена или неявка списывает второе занятие и закрывает окно, если только служба поддержки не переклассифицирует подтверждённый уважительный случай.',
        checkoutV2Service: 'Этот договор включает ровно четыре индивидуальных занятия по 50 минут в каждом цикле продолжительностью 28 календарных дней.',
        cancellationChannel: 'Отключить продление можно в платёжном портале или через поддержку. Доступ сохраняется до конца оплаченного периода, если иное не следует из возврата или закона.',
        withdrawal: 'Отказ от договора: у потребителя есть 14 календарных дней с момента заключения договора. При запросе досрочного начала может быть удержана пропорциональная стоимость оказанной части, если это допускается законом.',
        withdrawalLoss: 'Право на отказ утрачивается только после полного исполнения, если вы прямо попросили начать услугу и подтвердили понимание этого последствия.',
        refund: 'Причитающийся возврат выполняется тем же способом оплаты в установленный законом срок. Отключение продления само по себе не возвращает оплату за начавшийся период.',
        modelTitle: 'Образец заявления об отказе',
        model: 'Сообщаю, что отказываюсь от договора. Укажу услугу, дату договора, мои имя и адрес, а также дату этого уведомления. Подпись нужна только при подаче на бумаге.',
        webReference: 'Веб-версия условий также доступна по адресу',
        support: 'Чтобы отключить продление, сообщить о проблеме или отказаться от договора, обратитесь в поддержку или ответьте на это письмо.',
        nextSteps: 'Следующие шаги',
        steps: [
            'Откройте личный кабинет и проверьте доступ к панели и материалам.',
            'Сообщите о любых ограничениях по расписанию до первого занятия.',
            'Мы вручную согласуем первое занятие с учётом реальной доступности.',
            'Папка с материалами должна быть готова до первого занятия.',
        ],
        checkoutV2Steps: [
            'Откройте личный кабинет и проверьте доступ к панели и материалам.',
            'Ниже проверьте преподавателя, еженедельное время, часовой пояс и четыре выбранные даты.',
            'Если нужен перенос, оформите его не менее чем за 24 часа в личном кабинете или обратитесь в поддержку.',
            'Папка с материалами должна быть готова до первого занятия.',
        ],
        openCampus: 'ОТКРЫТЬ КАБИНЕТ',
        materials: 'Ваша папка с материалами',
        signoff: 'До скорой встречи',
        team: 'Команда Español Honesto',
    },
} as const;

export function welcomeEmailSubject(locale: WelcomeEmailLocale): string {
    return welcomeEmailCopy[locale].subject;
}

export function welcomeEmailTemplate(data: WelcomeEmailData): string {
    const copy = welcomeEmailCopy[data.locale];
    const studentName = escapeEmailHtml(data.studentName);
    const packageName = escapeEmailHtml(data.packageName);
    const loginUrl = safeEmailUrl(data.loginUrl);
    const driveFolderUrl = safeEmailUrl(data.driveFolderUrl);
    const termsUrl = safeEmailUrl(data.termsUrl);
    const supportUrl = safeEmailUrl(data.supportUrl);
    const durationMonths = Number.isInteger(data.durationMonths) ? String(data.durationMonths) : '';
    const sessionsTotal = Number.isInteger(data.sessionsTotal) ? String(data.sessionsTotal) : '';
    const startsAt = escapeEmailHtml(data.startsAt || '');
    const endsAt = escapeEmailHtml(data.endsAt || '');
    const legalPolicyVersion = escapeEmailHtml(data.legalPolicyVersion || '');
    const policyAcceptedAt = escapeEmailHtml(data.policyAcceptedAt || '');
    const currency = typeof data.currency === 'string' && /^[a-z]{3}$/i.test(data.currency)
        ? data.currency.toUpperCase()
        : 'EUR';
    const intlLocale = { es: 'es-ES', en: 'en-IE', ru: 'ru-RU' }[data.locale];
    const amountPaid = Number.isInteger(data.amountTotal) && (data.amountTotal ?? 0) >= 0
        ? new Intl.NumberFormat(intlLocale, { style: 'currency', currency }).format((data.amountTotal ?? 0) / 100)
        : '';
    const isCheckoutV2 = data.contractSchemaVersion === 2;
    const hasLegacyContractDetails = !isCheckoutV2
        && Boolean(durationMonths && startsAt && endsAt && sessionsTotal && amountPaid);
    let checkoutV2WeeklySlot = '';
    let checkoutV2ClassDates: string[] = [];
    let checkoutV2RenewalAt = '';

    if (isCheckoutV2) {
        const classStartsAt = data.classStartsAt;
        const timezoneName = data.timezoneName;
        const firstClassAt = new Date(classStartsAt?.[0] ?? '');
        const renewalAnchorAt = new Date(data.renewalAnchorAt ?? '');
        let instantFormatter: Intl.DateTimeFormat;
        let weekdayFormatter: Intl.DateTimeFormat;
        let timeFormatter: Intl.DateTimeFormat;
        let localDateFormatter: Intl.DateTimeFormat;
        try {
            instantFormatter = new Intl.DateTimeFormat(intlLocale, {
                timeZone: timezoneName,
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hourCycle: 'h23',
            });
            weekdayFormatter = new Intl.DateTimeFormat(intlLocale, {
                timeZone: timezoneName,
                weekday: 'long',
            });
            timeFormatter = new Intl.DateTimeFormat('en-GB', {
                timeZone: timezoneName,
                hour: '2-digit',
                minute: '2-digit',
                hourCycle: 'h23',
            });
            localDateFormatter = new Intl.DateTimeFormat('en-US', {
                timeZone: timezoneName,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
            });
            instantFormatter.format(firstClassAt);
        } catch {
            throw new Error('Checkout V2 welcome contract has an invalid time zone or date');
        }

        const expectedLocalTime = data.slotLocalStartTime?.slice(0, 5);
        const parsedClassDates = classStartsAt?.map((startsAt) => new Date(startsAt)) ?? [];
        const hasInvalidClassDate = parsedClassDates.some((date) => Number.isNaN(date.getTime()));
        const localClassDays = hasInvalidClassDate ? [] : parsedClassDates.map((date) => {
            const parts = Object.fromEntries(
                localDateFormatter.formatToParts(date).map((part) => [part.type, part.value]),
            );
            return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
        });
        if (
            data.amountTotal !== 25_900
            || currency !== 'EUR'
            || data.sessionsTotal !== 4
            || data.classDurationMinutes !== 50
            || typeof data.teacherName !== 'string'
            || !data.teacherName.trim()
            || !Number.isInteger(data.slotWeekday)
            || !/^\d{2}:\d{2}(?::\d{2})?$/.test(data.slotLocalStartTime ?? '')
            || !timezoneName
            || parsedClassDates.length !== 4
            || hasInvalidClassDate
            || parsedClassDates.some((date, index) => (
                (index > 0 && date.getTime() <= parsedClassDates[index - 1].getTime())
                || timeFormatter.format(date) !== expectedLocalTime
                || new Date(localClassDays[index]).getUTCDay() !== data.slotWeekday
                || (index > 0 && localClassDays[index] - localClassDays[index - 1] !== 7 * 24 * 60 * 60 * 1000)
            ))
            || Number.isNaN(renewalAnchorAt.getTime())
            || renewalAnchorAt.getTime() !== firstClassAt.getTime() + 28 * 24 * 60 * 60 * 1000
        ) {
            throw new Error('Checkout V2 welcome contract is incomplete or incoherent');
        }

        checkoutV2WeeklySlot = `${weekdayFormatter.format(firstClassAt)}, ${expectedLocalTime} (${timezoneName})`;
        checkoutV2ClassDates = parsedClassDates.map((date) => `${instantFormatter.format(date)} (${timezoneName})`);
        checkoutV2RenewalAt = `${instantFormatter.format(renewalAnchorAt)} (${timezoneName})`;
    }
    const providerDetails = [
        legalIdentity.ownerName,
        legalIdentity.taxId,
        legalIdentity.address,
        legalIdentity.email,
        legalIdentity.activity,
    ].map(escapeEmailHtml).join(' · ');
    const content = `
        <h2 style="color: #006064; margin: 0 0 20px 0;">${copy.welcome}, ${studentName}</h2>

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
             ${copy.planActive}: <strong>${isCheckoutV2 ? copy.checkoutV2Plan : packageName}</strong>.
         </p>

         ${isCheckoutV2 ? `
         <div style="background-color: #f9f9f9; padding: 20px; margin: 25px 0; border: 2px solid #006064;">
             <p style="margin: 0 0 12px 0; color: #006064; font-weight: bold;">${copy.contractSummary}</p>
             <ul style="margin: 0; padding-left: 20px; color: #333333; line-height: 1.7;">
                 <li>${copy.checkoutV2Offer}</li>
                 <li>${copy.teacher}: ${escapeEmailHtml(data.teacherName ?? '')}</li>
                 <li>${copy.weeklySlot}: ${escapeEmailHtml(checkoutV2WeeklySlot)}</li>
                 <li>${copy.classDates}:
                     <ol style="margin: 8px 0 0; padding-left: 20px;">
                         ${checkoutV2ClassDates.map((date) => `<li>${escapeEmailHtml(date)}</li>`).join('')}
                     </ol>
                 </li>
                 <li>${copy.renewalDate}: ${escapeEmailHtml(checkoutV2RenewalAt)}. ${copy.renewalRule}</li>
             </ul>
             <p style="margin: 16px 0 8px; color: #006064; font-weight: bold;">${copy.guaranteeTitle}</p>
             <p style="margin: 0 0 8px; color: #333333; font-size: 13px; line-height: 1.7;">${copy.guarantee}</p>
             <p style="margin: 0; color: #333333; font-size: 13px; line-height: 1.7;">${copy.guaranteeWindow}</p>
             ${legalPolicyVersion ? `<p style="margin: 12px 0 0 0; color: #666666; font-size: 12px;">${copy.termsVersion}: ${legalPolicyVersion}${policyAcceptedAt ? ` · ${copy.accepted} ${policyAcceptedAt}` : ''}</p>` : ''}
         </div>
         ` : hasLegacyContractDetails ? `
         <div style="background-color: #f9f9f9; padding: 20px; margin: 25px 0; border: 2px solid #006064;">
            <p style="margin: 0 0 12px 0; color: #006064; font-weight: bold;">${copy.contractSummary}</p>
            <ul style="margin: 0; padding-left: 20px; color: #333333; line-height: 1.7;">
                <li>${copy.plan}: ${packageName}</li>
                <li>${copy.period}: ${durationMonths} ${copy.months}, ${copy.from} ${startsAt} ${copy.to} ${endsAt}</li>
                <li>${copy.allowance}: ${sessionsTotal}</li>
                <li>${copy.charged}: ${escapeEmailHtml(amountPaid)}</li>
                <li>${copy.renewal}</li>
                <li>${copy.expiry}</li>
                <li>${copy.cancellation}</li>
            </ul>
            ${legalPolicyVersion ? `<p style="margin: 12px 0 0 0; color: #666666; font-size: 12px;">${copy.termsVersion}: ${legalPolicyVersion}${policyAcceptedAt ? ` · ${copy.accepted} ${policyAcceptedAt}` : ''}</p>` : ''}
        </div>
        ` : ''}

        <div style="background-color: #fff; padding: 20px; margin: 25px 0; border: 1px solid #006064;">
            <p style="margin: 0 0 12px 0; color: #006064; font-weight: bold;">${copy.durableTitle}</p>
            <p style="color: #333333; font-size: 13px; line-height: 1.6;"><strong>${copy.provider}:</strong> ${providerDetails}</p>
            <ul style="margin: 0; padding-left: 20px; color: #333333; font-size: 13px; line-height: 1.7;">
                <li>${copy.adultOnly}</li>
                 <li>${isCheckoutV2 ? copy.checkoutV2Service : copy.service}</li>
                <li>${copy.cancellationChannel}</li>
                <li>${copy.withdrawal}</li>
                <li>${copy.withdrawalLoss}</li>
                <li>${copy.refund}</li>
            </ul>
            <p style="margin: 14px 0 5px; color: #006064; font-weight: bold;">${copy.modelTitle}</p>
            <p style="margin: 0; color: #333333; font-size: 13px; line-height: 1.6;">${copy.model}</p>
            ${termsUrl ? `<p style="color: #333333; font-size: 13px; line-height: 1.6;">${copy.webReference} <a href="${termsUrl}" style="color: #006064;">${termsUrl}</a>.</p>` : ''}
            <p style="color: #333333; font-size: 13px; line-height: 1.6;">${copy.support}${supportUrl ? ` <a href="${supportUrl}" style="color: #006064;">${supportUrl}</a>` : ''}</p>
        </div>

        <div style="background-color: #E0F7FA; padding: 20px; margin: 25px 0; border-left: 4px solid #006064;">
            <p style="margin: 0 0 10px 0; color: #006064; font-weight: bold;">${copy.nextSteps}:</p>
            <ol style="margin: 0; padding-left: 20px; color: #333333;">
                 ${(isCheckoutV2 ? copy.checkoutV2Steps : copy.steps).map((step) => `<li style="margin-bottom: 8px;">${step}</li>`).join('')}
            </ol>
        </div>

        ${loginUrl ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0;">
            <tr>
                <td align="center">
                    <a href="${loginUrl}" style="display: inline-block; background-color: #006064; color: #ffffff; padding: 15px 40px; text-decoration: none; font-weight: bold; font-size: 16px;">
                        ${copy.openCampus}
                    </a>
                </td>
            </tr>
        </table>
        ` : ''}

        ${driveFolderUrl ? `
        <p style="color: #666666; font-size: 14px;">
            ${copy.materials}: <a href="${driveFolderUrl}" style="color: #006064;">${driveFolderUrl}</a>
        </p>
        ` : ''}

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            ${copy.signoff},<br>
            <strong>${copy.team}</strong>
        </p>
    `;

    return baseTemplate(content, data.locale);
}

// ============================================
// Upcoming Renewal Notice
// ============================================

export type RenewalNoticeLocale = 'es' | 'en' | 'ru';

export interface RenewalNoticeEmailData {
    locale: RenewalNoticeLocale;
    studentName: string;
    packageName: string;
    renewalAt: string;
    cancelBy: string;
    durationMonths?: number;
    billingIntervalUnit?: 'day' | 'week' | 'month' | 'year';
    billingIntervalCount?: number;
    amountTotal: number;
    currency: string;
    accountUrl: string;
    supportUrl: string;
    termsUrl: string;
}

const renewalNoticeCopy = {
    es: {
        subject: 'Aviso de renovación de tu suscripción - Español Honesto',
        title: 'Tu suscripción se renovará próximamente',
        hello: 'Hola',
        intro: 'Te avisamos con antelación de la próxima renovación automática de tu suscripción.',
        plan: 'Plan',
        chargeDate: 'Fecha prevista de cobro',
        amount: 'Importe',
        period: 'Nuevo periodo',
        deadline: 'Plazo de cancelación',
        deadlineText: 'antes de la fecha prevista de cobro indicada arriba',
        cancel: 'Puedes desactivar la renovación desde tu cuenta. También puedes solicitarlo por soporte o respondiendo a este correo antes del plazo.',
        consequence: 'Si no cancelas a tiempo, se cobrará el importe indicado y la suscripción se renovará por el mismo periodo.',
        accountButton: 'GESTIONAR RENOVACIÓN',
        support: 'Contactar con soporte',
        terms: 'Consultar condiciones',
        signoff: 'Equipo de Español Honesto',
    },
    en: {
        subject: 'Your subscription renewal notice - Español Honesto',
        title: 'Your subscription will renew soon',
        hello: 'Hello',
        intro: 'This is advance notice of the upcoming automatic renewal of your subscription.',
        plan: 'Plan',
        chargeDate: 'Expected charge date',
        amount: 'Amount',
        period: 'New period',
        deadline: 'Cancellation deadline',
        deadlineText: 'before the expected charge date shown above',
        cancel: 'You can turn off renewal from your account. You may also ask support or reply to this email before the deadline.',
        consequence: 'If you do not cancel in time, the stated amount will be charged and the subscription will renew for the same period.',
        accountButton: 'MANAGE RENEWAL',
        support: 'Contact support',
        terms: 'View terms',
        signoff: 'The Español Honesto team',
    },
    ru: {
        subject: 'Уведомление о продлении подписки - Español Honesto',
        title: 'Ваша подписка скоро продлится',
        hello: 'Здравствуйте',
        intro: 'Заранее уведомляем вас о предстоящем автоматическом продлении подписки.',
        plan: 'Тариф',
        chargeDate: 'Предполагаемая дата списания',
        amount: 'Сумма',
        period: 'Новый период',
        deadline: 'Срок отмены',
        deadlineText: 'до указанной выше предполагаемой даты списания',
        cancel: 'Отключить продление можно в личном кабинете. До истечения срока также можно обратиться в поддержку или ответить на это письмо.',
        consequence: 'Если вы не отмените продление вовремя, указанная сумма будет списана, а подписка продлится на тот же период.',
        accountButton: 'УПРАВЛЯТЬ ПРОДЛЕНИЕМ',
        support: 'Связаться с поддержкой',
        terms: 'Посмотреть условия',
        signoff: 'Команда Español Honesto',
    },
} as const;

const renewalIntlLocales: Record<RenewalNoticeLocale, string> = {
    es: 'es-ES',
    en: 'en-GB',
    ru: 'ru-RU',
};

function renewalPeriodLabel(
    locale: RenewalNoticeLocale,
    count: number,
    interval: 'day' | 'week' | 'month' | 'year'
): string {
    if (locale === 'ru') {
        const units = {
            day: ['день', 'дня', 'дней'],
            week: ['неделя', 'недели', 'недель'],
            month: ['месяц', 'месяца', 'месяцев'],
            year: ['год', 'года', 'лет'],
        } as const;
        const absoluteCount = Math.abs(count);
        const lastTwoDigits = absoluteCount % 100;
        const lastDigit = absoluteCount % 10;
        const form = lastTwoDigits >= 11 && lastTwoDigits <= 14
            ? 2
            : lastDigit === 1
                ? 0
                : lastDigit >= 2 && lastDigit <= 4
                    ? 1
                    : 2;
        return `${count} ${units[interval][form]}`;
    }

    const units = {
        es: {
            day: ['día', 'días'], week: ['semana', 'semanas'],
            month: ['mes', 'meses'], year: ['año', 'años'],
        },
        en: {
            day: ['day', 'days'], week: ['week', 'weeks'],
            month: ['month', 'months'], year: ['year', 'years'],
        },
    } as const;
    const names = units[locale][interval];
    return `${count} ${count === 1 ? names[0] : names[1]}`;
}

export function renewalNoticeSubject(locale: RenewalNoticeLocale): string {
    return renewalNoticeCopy[locale].subject;
}

export function renewalNoticeEmailTemplate(data: RenewalNoticeEmailData): string {
    const copy = renewalNoticeCopy[data.locale];
    const intlLocale = renewalIntlLocales[data.locale];
    const renewalDate = new Date(data.renewalAt);
    const cancelDate = new Date(data.cancelBy);
    if (!Number.isFinite(renewalDate.getTime()) || !Number.isFinite(cancelDate.getTime())) {
        throw new Error('Renewal notice requires valid renewal and cancellation dates');
    }

    const currency = /^[a-z]{3}$/i.test(data.currency) ? data.currency.toUpperCase() : 'EUR';
    const amountTotal = Number.isInteger(data.amountTotal) && data.amountTotal >= 0 ? data.amountTotal : 0;
    const hasVersionedInterval = ['day', 'week', 'month', 'year'].includes(
        data.billingIntervalUnit ?? ''
    ) && Number.isInteger(data.billingIntervalCount) && (data.billingIntervalCount ?? 0) > 0;
    const interval = hasVersionedInterval
        ? data.billingIntervalUnit as 'day' | 'week' | 'month' | 'year'
        : 'month';
    const intervalCount = hasVersionedInterval
        ? data.billingIntervalCount as number
        : Number.isInteger(data.durationMonths) && (data.durationMonths ?? 0) > 0
            ? data.durationMonths as number
            : 1;
    const formatDate = (value: Date) => new Intl.DateTimeFormat(intlLocale, {
        dateStyle: 'long',
        timeZone: 'Europe/Madrid',
    }).format(value);
    const amount = new Intl.NumberFormat(intlLocale, {
        style: 'currency',
        currency,
    }).format(amountTotal / 100);
    const studentName = escapeEmailHtml(data.studentName);
    const packageName = escapeEmailHtml(data.packageName);
    const accountUrl = safeEmailUrl(data.accountUrl);
    const supportUrl = safeEmailUrl(data.supportUrl);
    const termsUrl = safeEmailUrl(data.termsUrl);

    const content = `
        <h2 style="color: #006064; margin: 0 0 20px 0;">${copy.title}</h2>
        <p style="color: #333333; font-size: 16px; line-height: 1.6;">${copy.hello} ${studentName},</p>
        <p style="color: #333333; font-size: 16px; line-height: 1.6;">${copy.intro}</p>

        <div style="background-color: #f9f9f9; padding: 20px; margin: 25px 0; border: 2px solid #006064;">
            <p style="margin: 0; color: #333333; font-size: 15px; line-height: 1.8;">
                <strong>${copy.plan}:</strong> ${packageName}<br>
                <strong>${copy.chargeDate}:</strong> ${escapeEmailHtml(formatDate(renewalDate))}<br>
                <strong>${copy.amount}:</strong> ${escapeEmailHtml(amount)}<br>
                <strong>${copy.period}:</strong> ${escapeEmailHtml(renewalPeriodLabel(data.locale, intervalCount, interval))}<br>
                <strong>${copy.deadline}:</strong> ${copy.deadlineText} (${escapeEmailHtml(formatDate(cancelDate))})
            </p>
        </div>

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">${copy.cancel}</p>
        <p style="color: #333333; font-size: 16px; line-height: 1.6;"><strong>${copy.consequence}</strong></p>

        ${accountUrl ? `<p style="text-align: center; margin: 30px 0;"><a href="${accountUrl}" style="display: inline-block; background-color: #006064; color: #ffffff; padding: 15px 32px; text-decoration: none; font-weight: bold;">${copy.accountButton}</a></p>` : ''}
        <p style="color: #666666; font-size: 14px; line-height: 1.7;">
            ${supportUrl ? `<a href="${supportUrl}" style="color: #006064;">${copy.support}</a>` : ''}
            ${supportUrl && termsUrl ? ' · ' : ''}
            ${termsUrl ? `<a href="${termsUrl}" style="color: #006064;">${copy.terms}</a>` : ''}
        </p>
        <p style="color: #333333; font-size: 16px; line-height: 1.6;">${copy.signoff}</p>
    `;

    return baseTemplate(content, data.locale);
}

// ============================================
// Checkout V2 Guarantee Refund
// ============================================

export type GuaranteeRefundLocale = 'es' | 'en' | 'ru';

export interface GuaranteeRefundEmailData {
    locale: GuaranteeRefundLocale;
    studentName: string;
    refundAmount: number;
    currency: string;
    accountUrl: string;
    supportUrl: string;
}

const guaranteeRefundCopy = {
    es: {
        subject: 'Devolución de tu garantía confirmada - Español Honesto',
        title: 'Tu garantía ya se ha aplicado',
        hello: 'Hola',
        intro: 'Hemos confirmado la devolución correspondiente a las tres clases restantes de tu primer ciclo.',
        refund: 'Importe devuelto',
        method: 'La devolución se ha enviado al mismo medio de pago de la compra. Tu banco puede tardar varios días en reflejarla.',
        firstClass: 'La primera clase permanece pagada.',
        remainingClasses: 'Las otras tres clases han quedado invalidadas y retiradas del calendario.',
        renewal: 'La renovación automática y los cobros futuros de esta suscripción están cancelados.',
        accountButton: 'VER ESTADO EN MI CUENTA',
        support: 'Contactar con soporte',
        signoff: 'Equipo de Español Honesto',
    },
    en: {
        subject: 'Your guarantee refund is confirmed - Español Honesto',
        title: 'Your guarantee has been applied',
        hello: 'Hello',
        intro: 'We have confirmed the refund for the three remaining classes in your first cycle.',
        refund: 'Amount refunded',
        method: 'The refund was sent to the original payment method. Your bank may take several days to display it.',
        firstClass: 'Your first class remains paid.',
        remainingClasses: 'The other three classes have been invalidated and removed from the calendar.',
        renewal: 'Automatic renewal and future charges for this subscription are cancelled.',
        accountButton: 'VIEW STATUS IN MY ACCOUNT',
        support: 'Contact support',
        signoff: 'The Español Honesto team',
    },
    ru: {
        subject: 'Возврат по гарантии подтверждён - Español Honesto',
        title: 'Гарантия применена',
        hello: 'Здравствуйте',
        intro: 'Мы подтвердили возврат стоимости трёх оставшихся занятий первого цикла.',
        refund: 'Сумма возврата',
        method: 'Возврат отправлен на исходный способ оплаты. Банку может потребоваться несколько дней, чтобы отобразить его.',
        firstClass: 'Первое занятие остаётся оплаченным.',
        remainingClasses: 'Остальные три занятия аннулированы и удалены из календаря.',
        renewal: 'Автопродление и будущие списания по этой подписке отменены.',
        accountButton: 'ПОСМОТРЕТЬ СТАТУС',
        support: 'Связаться с поддержкой',
        signoff: 'Команда Español Honesto',
    },
} as const;

export function guaranteeRefundSubject(locale: GuaranteeRefundLocale): string {
    return guaranteeRefundCopy[locale].subject;
}

export function guaranteeRefundEmailTemplate(data: GuaranteeRefundEmailData): string {
    const copy = guaranteeRefundCopy[data.locale];
    const currency = /^[a-z]{3}$/i.test(data.currency) ? data.currency.toUpperCase() : 'EUR';
    if (!Number.isInteger(data.refundAmount) || data.refundAmount <= 0) {
        throw new Error('Guarantee refund email requires a positive integer amount');
    }
    const amount = new Intl.NumberFormat(renewalIntlLocales[data.locale], {
        style: 'currency',
        currency,
    }).format(data.refundAmount / 100);
    const studentName = escapeEmailHtml(data.studentName);
    const accountUrl = safeEmailUrl(data.accountUrl);
    const supportUrl = safeEmailUrl(data.supportUrl);

    const content = `
        <h2 style="color: #006064; margin: 0 0 20px 0;">${copy.title}</h2>
        <p style="color: #333333; font-size: 16px; line-height: 1.6;">${copy.hello} ${studentName},</p>
        <p style="color: #333333; font-size: 16px; line-height: 1.6;">${copy.intro}</p>

        <div style="background-color: #f9f9f9; padding: 20px; margin: 25px 0; border: 2px solid #006064;">
            <p style="margin: 0; color: #006064; font-size: 18px;"><strong>${copy.refund}: ${escapeEmailHtml(amount)}</strong></p>
        </div>

        <ul style="color: #333333; font-size: 16px; line-height: 1.8; padding-left: 22px;">
            <li>${copy.firstClass}</li>
            <li>${copy.remainingClasses}</li>
            <li>${copy.renewal}</li>
        </ul>
        <p style="color: #333333; font-size: 16px; line-height: 1.6;">${copy.method}</p>

        ${accountUrl ? `<p style="text-align: center; margin: 30px 0;"><a href="${accountUrl}" style="display: inline-block; background-color: #006064; color: #ffffff; padding: 15px 32px; text-decoration: none; font-weight: bold;">${copy.accountButton}</a></p>` : ''}
        ${supportUrl ? `<p style="color: #666666; font-size: 14px;"><a href="${supportUrl}" style="color: #006064;">${copy.support}</a></p>` : ''}
        <p style="color: #333333; font-size: 16px; line-height: 1.6;">${copy.signoff}</p>
    `;

    return baseTemplate(content, data.locale);
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
    const title = data.isTeacher ? 'New class scheduled' : 'Your class is confirmed';
    const recipientName = escapeEmailHtml(data.recipientName);
    const otherPartyName = escapeEmailHtml(data.otherPartyName);
    const date = escapeEmailHtml(data.date);
    const time = escapeEmailHtml(data.time);
    const duration = escapeEmailHtml(String(data.duration));
    const meetLink = safeEmailUrl(data.meetLink);
    const documentLink = safeEmailUrl(data.documentLink);

    const content = `
        <h2 style="color: #006064; margin: 0 0 20px 0;">${title}</h2>

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            Hi ${recipientName},
        </p>

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            ${data.isTeacher ? 'A class has been scheduled with your student:' : 'Your next Spanish class is confirmed:'}
        </p>

        <div style="background-color: #f9f9f9; padding: 25px; margin: 25px 0; border: 2px solid #006064;">
            <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                    <td style="padding: 8px 0; color: #666666; font-size: 14px;">Date:</td>
                    <td style="padding: 8px 0; color: #333333; font-size: 16px; font-weight: bold;">${date}</td>
                </tr>
                <tr>
                    <td style="padding: 8px 0; color: #666666; font-size: 14px;">Time:</td>
                    <td style="padding: 8px 0; color: #333333; font-size: 16px; font-weight: bold;">${time}</td>
                </tr>
                <tr>
                    <td style="padding: 8px 0; color: #666666; font-size: 14px;">Duration:</td>
                    <td style="padding: 8px 0; color: #333333; font-size: 16px;">${duration} minutes</td>
                </tr>
                <tr>
                    <td style="padding: 8px 0; color: #666666; font-size: 14px;">${data.isTeacher ? 'Student' : 'Teacher'}:</td>
                    <td style="padding: 8px 0; color: #333333; font-size: 16px;">${otherPartyName}</td>
                </tr>
            </table>
        </div>

        ${meetLink ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin: 25px 0;">
            <tr>
                <td align="center">
                    <a href="${meetLink}" style="display: inline-block; background-color: #006064; color: #ffffff; padding: 15px 40px; text-decoration: none; font-weight: bold; font-size: 16px;">
                        JOIN THE VIDEO CALL
                    </a>
                </td>
            </tr>
        </table>
        ` : ''}

        ${documentLink ? `
        <p style="color: #666666; font-size: 14px; margin-top: 20px;">
            Class document: <a href="${documentLink}" style="color: #006064;">Open document</a>
        </p>
        ` : ''}

        <p style="color: #333333; font-size: 15px; line-height: 1.6;">
            We schedule ${duration} minutes for the class, and the video call is not cut automatically at the minute mark.
        </p>

        <p style="color: #333333; font-size: 16px; line-height: 1.6; margin-top: 30px;">
            See you soon,<br>
            <strong>Español Honesto</strong>
        </p>
    `;

    return baseTemplate(content);
}

// ============================================
// Class Rescheduled Email
// ============================================

export interface ClassRescheduledData {
    locale: 'es' | 'en' | 'ru';
    recipientName: string;
    isTeacher: boolean;
    otherPartyName: string;
    previousScheduledAt: string;
    scheduledAt: string;
    duration: number;
    meetLink?: string;
    documentLink?: string;
}

const classRescheduledCopy = {
    es: {
        subject: 'Clase reprogramada - Español Honesto',
        title: 'La clase se ha reprogramado',
        hello: 'Hola',
        introStudent: 'Tu clase de español tiene una nueva fecha.',
        introTeacher: 'La clase con tu estudiante tiene una nueva fecha.',
        previous: 'Fecha anterior',
        next: 'Nueva fecha',
        duration: 'Duración',
        minutes: 'minutos',
        teacher: 'Profesor',
        student: 'Estudiante',
        timeZone: 'Zona horaria',
        join: 'UNIRSE A LA VIDEOLLAMADA',
        document: 'Abrir documento de clase',
    },
    en: {
        subject: 'Class rescheduled - Español Honesto',
        title: 'The class has been rescheduled',
        hello: 'Hello',
        introStudent: 'Your Spanish class has a new date and time.',
        introTeacher: 'The class with your student has a new date and time.',
        previous: 'Previous date',
        next: 'New date',
        duration: 'Duration',
        minutes: 'minutes',
        teacher: 'Teacher',
        student: 'Student',
        timeZone: 'Time zone',
        join: 'JOIN THE VIDEO CALL',
        document: 'Open class document',
    },
    ru: {
        subject: 'Занятие перенесено - Español Honesto',
        title: 'Занятие перенесено',
        hello: 'Здравствуйте',
        introStudent: 'У вашего занятия по испанскому новое время.',
        introTeacher: 'У занятия с вашим учеником новое время.',
        previous: 'Прежнее время',
        next: 'Новое время',
        duration: 'Продолжительность',
        minutes: 'минут',
        teacher: 'Преподаватель',
        student: 'Ученик',
        timeZone: 'Часовой пояс',
        join: 'ПРИСОЕДИНИТЬСЯ К ВИДЕОЗВОНКУ',
        document: 'Открыть документ занятия',
    },
} as const;

export function classRescheduledSubject(locale: ClassRescheduledData['locale']): string {
    return classRescheduledCopy[locale].subject;
}

export function classRescheduledTemplate(data: ClassRescheduledData): string {
    const copy = classRescheduledCopy[data.locale];
    const intlLocale = { es: 'es-ES', en: 'en-GB', ru: 'ru-RU' }[data.locale];
    const format = (value: string) => {
        const date = new Date(value);
        if (!Number.isFinite(date.getTime())) throw new Error('Class reschedule requires valid dates');
        return new Intl.DateTimeFormat(intlLocale, {
            dateStyle: 'full',
            timeStyle: 'short',
            timeZone: 'Europe/Madrid',
        }).format(date);
    };
    const recipientName = escapeEmailHtml(data.recipientName);
    const otherPartyName = escapeEmailHtml(data.otherPartyName);
    const previous = escapeEmailHtml(format(data.previousScheduledAt));
    const next = escapeEmailHtml(format(data.scheduledAt));
    const meetLink = safeEmailUrl(data.meetLink);
    const documentLink = safeEmailUrl(data.documentLink);
    const content = `
        <h2 style="color: #006064; margin: 0 0 20px 0;">${copy.title}</h2>
        <p style="color: #333333; font-size: 16px; line-height: 1.6;">${copy.hello} ${recipientName},</p>
        <p style="color: #333333; font-size: 16px; line-height: 1.6;">${data.isTeacher ? copy.introTeacher : copy.introStudent}</p>
        <div style="background-color: #f9f9f9; padding: 25px; margin: 25px 0; border: 2px solid #006064;">
            <p style="margin: 0; color: #333333; line-height: 1.9;">
                <strong>${copy.previous}:</strong> ${previous}<br>
                <strong>${copy.next}:</strong> ${next}<br>
                <strong>${copy.duration}:</strong> ${escapeEmailHtml(String(data.duration))} ${copy.minutes}<br>
                <strong>${data.isTeacher ? copy.student : copy.teacher}:</strong> ${otherPartyName}
            </p>
        </div>
        ${meetLink ? `<p style="text-align: center; margin: 30px 0;"><a href="${meetLink}" style="display: inline-block; background-color: #006064; color: #ffffff; padding: 15px 32px; text-decoration: none; font-weight: bold;">${copy.join}</a></p>` : ''}
        ${documentLink ? `<p style="color: #666666; font-size: 14px;"><a href="${documentLink}" style="color: #006064;">${copy.document}</a></p>` : ''}
    `;
    return baseTemplate(content, data.locale);
}

// ============================================
// Checkout V2 Initial Cycle Rescheduled Email
// ============================================

export interface CheckoutV2CycleRescheduledData {
    locale: 'es' | 'en' | 'ru';
    recipientName: string;
    isTeacher: boolean;
    otherPartyName: string;
    classStartsAt: string[];
    renewalAnchorAt: string;
    timezoneName: string;
    amountCents: number;
    currency: string;
}

const checkoutV2CycleRescheduledCopy = {
    es: {
        subjectStudent: 'Tus cuatro clases tienen nuevas fechas - Español Honesto',
        subjectTeacher: 'Primer ciclo reprogramado - Español Honesto',
        title: 'El primer ciclo se ha reprogramado',
        hello: 'Hola',
        introStudent: 'Estas son las cuatro fechas nuevas de tus clases.',
        introTeacher: 'Estas son las cuatro fechas nuevas con tu estudiante.',
        classDates: 'Nuevas fechas',
        teacher: 'Profesor',
        student: 'Estudiante',
        timeZone: 'Zona horaria',
        nextCharge: 'Próximo cobro',
        exactAmount: '259 EUR',
        renewalRule: 'La fecha de renovación se ha movido con la primera clase y quedará fija cuando esta comience.',
    },
    en: {
        subjectStudent: 'Your four classes have new dates - Español Honesto',
        subjectTeacher: 'First cycle rescheduled - Español Honesto',
        title: 'The first cycle has been rescheduled',
        hello: 'Hello',
        introStudent: 'These are the four new dates for your classes.',
        introTeacher: 'These are the four new dates with your student.',
        classDates: 'New dates',
        teacher: 'Teacher',
        student: 'Student',
        timeZone: 'Time zone',
        nextCharge: 'Next charge',
        exactAmount: 'EUR 259',
        renewalRule: 'The renewal date moved with the first class and becomes fixed when that class begins.',
    },
    ru: {
        subjectStudent: 'Новые даты четырёх занятий - Español Honesto',
        subjectTeacher: 'Первый цикл перенесён - Español Honesto',
        title: 'Первый цикл перенесён',
        hello: 'Здравствуйте',
        introStudent: 'Вот четыре новые даты ваших занятий.',
        introTeacher: 'Вот четыре новые даты занятий с вашим учеником.',
        classDates: 'Новые даты',
        teacher: 'Преподаватель',
        student: 'Ученик',
        timeZone: 'Часовой пояс',
        nextCharge: 'Следующее списание',
        exactAmount: '259 EUR',
        renewalRule: 'Дата продления сдвинулась вместе с первым занятием и будет зафиксирована после его начала.',
    },
} as const;

export function checkoutV2CycleRescheduledSubject(
    locale: CheckoutV2CycleRescheduledData['locale'],
    isTeacher: boolean,
): string {
    const copy = checkoutV2CycleRescheduledCopy[locale];
    return isTeacher ? copy.subjectTeacher : copy.subjectStudent;
}

export function checkoutV2CycleRescheduledTemplate(
    data: CheckoutV2CycleRescheduledData,
): string {
    const copy = checkoutV2CycleRescheduledCopy[data.locale];
    const intlLocale = { es: 'es-ES', en: 'en-GB', ru: 'ru-RU' }[data.locale];
    if (
        data.classStartsAt.length !== 4
        || data.amountCents !== 25_900
        || data.currency.toUpperCase() !== 'EUR'
    ) {
        throw new Error('Checkout V2 cycle reschedule contract is incomplete');
    }
    let formatter: Intl.DateTimeFormat;
    try {
        formatter = new Intl.DateTimeFormat(intlLocale, {
            timeZone: data.timezoneName,
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
        });
    } catch {
        throw new Error('Checkout V2 cycle reschedule has an invalid time zone');
    }
    const classDates = data.classStartsAt.map((value) => {
        const date = new Date(value);
        if (!Number.isFinite(date.getTime())) {
            throw new Error('Checkout V2 cycle reschedule requires valid class dates');
        }
        return `${formatter.format(date)} (${data.timezoneName})`;
    });
    if (classDates.some((_, index) => (
        index > 0
        && new Date(data.classStartsAt[index]).getTime()
            <= new Date(data.classStartsAt[index - 1]).getTime()
    ))) {
        throw new Error('Checkout V2 cycle reschedule requires ordered class dates');
    }
    const renewalAnchor = new Date(data.renewalAnchorAt);
    const firstClass = new Date(data.classStartsAt[0]);
    if (
        !Number.isFinite(renewalAnchor.getTime())
        || renewalAnchor.getTime() !== firstClass.getTime() + 28 * 24 * 60 * 60 * 1000
    ) {
        throw new Error('Checkout V2 cycle reschedule requires the exact renewal anchor');
    }
    const recipientName = escapeEmailHtml(data.recipientName);
    const otherPartyName = escapeEmailHtml(data.otherPartyName);
    const timezoneName = escapeEmailHtml(data.timezoneName);
    const content = `
        <h2 style="color: #006064; margin: 0 0 20px 0;">${copy.title}</h2>
        <p style="color: #333333; font-size: 16px; line-height: 1.6;">${copy.hello} ${recipientName},</p>
        <p style="color: #333333; font-size: 16px; line-height: 1.6;">${data.isTeacher ? copy.introTeacher : copy.introStudent}</p>
        <div style="background-color: #f9f9f9; padding: 25px; margin: 25px 0; border: 2px solid #006064;">
            <p style="margin: 0 0 10px; color: #006064; font-weight: bold;">${copy.classDates}</p>
            <ol style="margin: 0 0 14px; padding-left: 22px; color: #333333; line-height: 1.9;">
                ${classDates.map((date) => `<li>${escapeEmailHtml(date)}</li>`).join('')}
            </ol>
            <p style="margin: 0; color: #333333; line-height: 1.7;">
                <strong>${data.isTeacher ? copy.student : copy.teacher}:</strong> ${otherPartyName}<br>
                <strong>${copy.timeZone}:</strong> ${timezoneName}
                ${data.isTeacher ? '' : `<br><strong>${copy.nextCharge}:</strong> ${copy.exactAmount} · ${escapeEmailHtml(formatter.format(renewalAnchor))} (${timezoneName})`}
            </p>
        </div>
        ${data.isTeacher ? '' : `<p style="color: #333333; font-size: 14px; line-height: 1.6;">${copy.renewalRule}</p>`}
    `;
    return baseTemplate(content, data.locale);
}

// ============================================
// Class Reminder Email
// ============================================

export interface ClassReminderData {
    recipientName: string;
    date: string;
    time: string;
    teacherName?: string;
    studentName?: string;
    meetLink?: string;
    documentLink?: string;
}

export function classReminderTemplate(data: ClassReminderData): string {
    const isTeacher = !!data.studentName;
    const otherPartyLabel = isTeacher ? 'your student' : 'your teacher';
    const otherPartyName = isTeacher ? data.studentName : data.teacherName;
    const recipientName = escapeEmailHtml(data.recipientName);
    const date = escapeEmailHtml(data.date);
    const time = escapeEmailHtml(data.time);
    const safeOtherPartyName = otherPartyName ? escapeEmailHtml(otherPartyName) : '';
    const meetLink = safeEmailUrl(data.meetLink);
    const documentLink = safeEmailUrl(data.documentLink);

    const content = `
        <h2 style="color: #006064; margin: 0 0 20px 0;">Your class is tomorrow</h2>

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            Hi ${recipientName},
        </p>

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            This is a reminder that you have a Spanish class scheduled for tomorrow.
        </p>

        <div style="background-color: #E0F7FA; padding: 25px; margin: 25px 0; border-left: 4px solid #006064;">
            <p style="margin: 0 0 10px 0; font-size: 18px; color: #006064; font-weight: bold;">
                ${date} at ${time}
            </p>
            ${safeOtherPartyName ? `
            <p style="margin: 0; color: #333333; font-size: 14px;">
                With ${otherPartyLabel} ${safeOtherPartyName}
            </p>
            ` : ''}
        </div>

        ${meetLink ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin: 25px 0;">
            <tr>
                <td align="center">
                    <a href="${meetLink}" style="display: inline-block; background-color: #00897B; color: #ffffff; padding: 15px 40px; text-decoration: none; font-weight: bold; font-size: 16px; border-radius: 4px;">
                        JOIN THE VIDEO CALL
                    </a>
                </td>
            </tr>
        </table>
        ` : ''}

        ${documentLink ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin: 15px 0;">
            <tr>
                <td align="center">
                    <a href="${documentLink}" style="display: inline-block; background-color: #4285F4; color: #ffffff; padding: 12px 30px; text-decoration: none; font-weight: bold; font-size: 14px; border-radius: 4px;">
                        OPEN CLASS DOCUMENT
                    </a>
                </td>
            </tr>
        </table>
        ` : ''}

        <p style="color: #333333; font-size: 16px; line-height: 1.6; margin-top: 30px;">
            See you tomorrow,<br>
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
    cancelledBy: 'student' | 'teacher' | 'admin' | 'guarantee';
    reason?: string;
}

export function classCancelledTemplate(data: ClassCancelledData): string {
    const cancellerText = {
        student: 'the student',
        teacher: 'the teacher',
        admin: 'the admin team',
        guarantee: 'the first-class guarantee',
    }[data.cancelledBy];
    const recipientName = escapeEmailHtml(data.recipientName);
    const date = escapeEmailHtml(data.date);
    const time = escapeEmailHtml(data.time);
    const reason = data.reason ? escapeEmailHtml(data.reason) : '';

    const content = `
        <h2 style="color: #006064; margin: 0 0 20px 0;">Class cancelled</h2>

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            Hi ${recipientName},
        </p>

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            The scheduled class has been cancelled by ${cancellerText}.
        </p>

        <div style="background-color: #fff3cd; padding: 25px; margin: 25px 0; border-left: 4px solid #856404;">
            <p style="margin: 0 0 10px 0; color: #856404; font-weight: bold;">Cancelled class details:</p>
            <p style="margin: 0; color: #333333;">
                Date: ${date}<br>
                Time: ${time}
            </p>
            ${reason ? `
            <p style="margin: 15px 0 0 0; color: #666666; font-size: 14px;">
                <em>Reason: ${reason}</em>
            </p>
            ` : ''}
        </div>

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            The session is available to reschedule. If you have any questions, reply to this email.
        </p>

        <p style="color: #333333; font-size: 16px; line-height: 1.6; margin-top: 30px;">
            Best,<br>
            <strong>Español Honesto</strong>
        </p>
    `;

    return baseTemplate(content);
}

// ============================================
// Lead Welcome Email
// ============================================

export interface LeadWelcomeEmailData {
    recipientName?: string;
}

export function leadWelcomeTemplate(data: LeadWelcomeEmailData): string {
    const name = data.recipientName ? escapeEmailHtml(data.recipientName) : 'there';
    const content = `
        <h2 style="color: #006064; margin: 0 0 20px 0;">Your details are saved, ${name}</h2>

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            Thanks for your interest in <strong>Español Honesto</strong>. When direct booking is enabled, you will be
            able to book from the real places shown on the website. The information you shared helps us understand and
            support you, but it is not an application and will not require approval before purchase.
        </p>

        <div style="background-color: #E0F7FA; padding: 25px; margin: 25px 0; border-left: 4px solid #006064;">
            <p style="margin: 0 0 10px 0; font-size: 18px; color: #006064; font-weight: bold;">
                One offer, direct booking
            </p>
            <p style="margin: 0; color: #333333; font-size: 15px; line-height: 1.6;">
                Four individual 50-minute classes cost EUR 259 and renew every 28 days. When checkout is enabled, each
                real available place will show the teacher, weekly time, time zone, all four dates and the exact next
                charge before payment.
            </p>
        </div>

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            Any diagnostic or extra context is optional and will never become a booking gate. When booking opens, if no
            displayed place works for you, or you want help before choosing, reply to this email and we will support you.
        </p>

        <p style="color: #333333; font-size: 16px; line-height: 1.6; margin-top: 30px;">
            Speak soon,<br>
            <strong>The Español Honesto team</strong>
        </p>
    `;

    return baseTemplate(content);
}

// ============================================
// Sales Follow-Up Emails
// ============================================

export interface MissingInfoEmailData {
    recipientName?: string;
    diagnosticUrl?: string;
}

export function missingInfoEmailTemplate(data: MissingInfoEmailData): string {
    const name = data.recipientName ? escapeEmailHtml(data.recipientName) : 'there';
    const diagnosticUrl = safeEmailUrl(data.diagnosticUrl);
    const content = `
        <h2 style="color: #006064; margin: 0 0 20px 0;">Optional context, ${name}</h2>

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            If you would like more tailored support, you can share a little more context. This is optional. When direct
            booking is enabled, you will be able to book a real available place without a review, recommendation or approval.
        </p>

        <div style="background-color: #E0F7FA; padding: 25px; margin: 25px 0; border-left: 4px solid #006064;">
            <p style="margin: 0 0 10px 0; font-size: 18px; color: #006064; font-weight: bold;">
                Helpful context, if you want to share it
            </p>
            <ol style="margin: 0; padding-left: 20px; color: #333333; font-size: 14px; line-height: 1.6;">
                <li style="margin-bottom: 8px;">where you use Spanish now, or where you want to use it;</li>
                <li style="margin-bottom: 8px;">what usually blocks you when you speak;</li>
                <li style="margin-bottom: 0;">your realistic availability for live classes.</li>
            </ol>
        </div>

        ${diagnosticUrl ? `
        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            If it is easier, you can share the same optional context through this short diagnostic:
        </p>

        <table width="100%" cellpadding="0" cellspacing="0" style="margin: 25px 0;">
            <tr>
                <td align="center">
                    <a href="${diagnosticUrl}" style="display: inline-block; background-color: #006064; color: #ffffff; padding: 15px 40px; text-decoration: none; font-weight: bold; font-size: 16px;">
                        OPEN DIAGNOSTIC
                    </a>
                </td>
            </tr>
        </table>
        ` : ''}

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            Our single offer is four individual 50-minute classes for EUR 259, renewed every 28 days. The website
            will show the teacher, weekly time, four dates and exact next charge before payment when checkout is enabled.
            A direct reply to this email is also welcome if you want support.
        </p>

        <p style="color: #333333; font-size: 16px; line-height: 1.6; margin-top: 30px;">
            Speak soon,<br>
            <strong>The Español Honesto team</strong>
        </p>
    `;

    return baseTemplate(content);
}

export interface ProposalNextStepEmailData {
    recipientName?: string;
    planRecommendation?: string | null;
}

export function proposalNextStepEmailTemplate(data: ProposalNextStepEmailData): string {
    const name = data.recipientName ? escapeEmailHtml(data.recipientName) : 'there';
    const content = `
        <h2 style="color: #006064; margin: 0 0 20px 0;">How direct booking will work, ${name}</h2>

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            Español Honesto currently has one offer: four individual 50-minute classes for EUR 259,
            renewed every 28 days until you cancel before the next charge.
        </p>

        <div style="background-color: #E0F7FA; padding: 25px; margin: 25px 0; border-left: 4px solid #006064;">
            <p style="margin: 0 0 10px 0; font-size: 18px; color: #006064; font-weight: bold;">
                Choose a real available place when booking opens
            </p>
            <p style="margin: 0; color: #333333; font-size: 15px; line-height: 1.6;">
                When checkout is enabled, each place will show the teacher, weekly time, time zone, all four class dates
                and the exact next charge date before payment. Booking will be direct: no plan recommendation or manual
                approval will be required.
            </p>
        </div>

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            When booking opens, return to the availability shown on the website. If no displayed place works for you,
            or you have a question beforehand, reply to this email and we will help without creating a purchase gate.
        </p>

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            Once checkout is enabled, payment will be taken only after you choose a specific teacher and weekly time
            and accept the displayed conditions.
        </p>

        <p style="color: #333333; font-size: 16px; line-height: 1.6; margin-top: 30px;">
            Speak soon,<br>
            <strong>The Español Honesto team</strong>
        </p>
    `;

    return baseTemplate(content);
}

// ============================================
// Support Ticket Received Email
// ============================================

export interface SupportTicketReceivedEmailData {
    recipientName?: string;
    issueTitle: string;
    ticketId: string;
    supportUrl?: string;
}

export interface SupportTicketUpdatedEmailData {
    recipientName?: string;
    issueTitle: string;
    ticketId: string;
    status: string;
    adminNote?: string | null;
    supportUrl?: string;
}

function escapeEmailHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function safeEmailUrl(value: string | undefined): string | null {
    if (!value) return null;

    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
        return escapeEmailHtml(url.toString());
    } catch {
        return null;
    }
}

function supportStatusLabel(status: string): string {
    const labels: Record<string, string> = {
        open: 'Open',
        triaged: 'In review',
        closed: 'Closed',
    };
    return labels[status] || status;
}

export function supportTicketReceivedTemplate(data: SupportTicketReceivedEmailData): string {
    const name = data.recipientName ? escapeEmailHtml(data.recipientName) : 'there';
    const issueTitle = escapeEmailHtml(data.issueTitle);
    const ticketId = escapeEmailHtml(data.ticketId);
    const supportUrl = safeEmailUrl(data.supportUrl);
    const content = `
        <h2 style="color: #006064; margin: 0 0 20px 0;">We received your support request, ${name}</h2>

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            Thanks for letting us know. We have created a support ticket and will review it manually.
        </p>

        <div style="background-color: #E0F7FA; padding: 25px; margin: 25px 0; border-left: 4px solid #006064;">
            <p style="margin: 0 0 10px 0; font-size: 18px; color: #006064; font-weight: bold;">
                Ticket details
            </p>
            <p style="margin: 0; color: #333333; font-size: 15px; line-height: 1.6;">
                Issue: ${issueTitle}<br>
                Ticket: ${ticketId}
            </p>
        </div>

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            If the issue affects an upcoming class, we will prioritize it. You can also reply to this email
            with any extra detail that may help.
        </p>

        ${supportUrl ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin: 25px 0;">
            <tr>
                <td align="center">
                    <a href="${supportUrl}" style="display: inline-block; background-color: #006064; color: #ffffff; padding: 15px 40px; text-decoration: none; font-weight: bold; font-size: 16px;">
                        OPEN SUPPORT
                    </a>
                </td>
            </tr>
        </table>
        ` : ''}

        <p style="color: #333333; font-size: 16px; line-height: 1.6; margin-top: 30px;">
            Speak soon,<br>
            <strong>The Espanol Honesto team</strong>
        </p>
    `;

    return baseTemplate(content);
}

export function supportTicketUpdatedTemplate(data: SupportTicketUpdatedEmailData): string {
    const name = data.recipientName ? escapeEmailHtml(data.recipientName) : 'there';
    const statusLabel = escapeEmailHtml(supportStatusLabel(data.status));
    const note = data.adminNote?.trim();
    const safeNote = note ? escapeEmailHtml(note).replace(/\r?\n/g, '<br>') : '';
    const supportUrl = safeEmailUrl(data.supportUrl);
    const closingText = data.status === 'closed'
        ? 'If anything still feels unresolved, reply to this email and we will reopen the conversation.'
        : 'You can reply to this email with any extra detail that may help us resolve it cleanly.';

    const content = `
        <h2 style="color: #006064; margin: 0 0 20px 0;">Update on your support request, ${name}</h2>

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            We reviewed your support ticket and updated its status.
        </p>

        <div style="background-color: #E0F7FA; padding: 25px; margin: 25px 0; border-left: 4px solid #006064;">
            <p style="margin: 0 0 10px 0; font-size: 18px; color: #006064; font-weight: bold;">
                Ticket update
            </p>
            <p style="margin: 0; color: #333333; font-size: 15px; line-height: 1.6;">
                Issue: ${escapeEmailHtml(data.issueTitle)}<br>
                Status: ${statusLabel}<br>
                Ticket: ${escapeEmailHtml(data.ticketId)}
            </p>
        </div>

        ${safeNote ? `
        <div style="background-color: #f9f9f9; padding: 20px; margin: 25px 0; border-left: 4px solid #999999;">
            <p style="margin: 0 0 10px 0; color: #333333; font-weight: bold;">Note from us</p>
            <p style="margin: 0; color: #333333; font-size: 15px; line-height: 1.6;">${safeNote}</p>
        </div>
        ` : ''}

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            ${closingText}
        </p>

        ${supportUrl ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin: 25px 0;">
            <tr>
                <td align="center">
                    <a href="${supportUrl}" style="display: inline-block; background-color: #006064; color: #ffffff; padding: 15px 40px; text-decoration: none; font-weight: bold; font-size: 16px;">
                        OPEN SUPPORT
                    </a>
                </td>
            </tr>
        </table>
        ` : ''}

        <p style="color: #333333; font-size: 16px; line-height: 1.6; margin-top: 30px;">
            Speak soon,<br>
            <strong>The Espanol Honesto team</strong>
        </p>
    `;

    return baseTemplate(content);
}

// ============================================
// Lightweight Level Check Email
// ============================================

export interface LevelCheckInviteEmailData {
    recipientName?: string;
    diagnosticUrl: string;
}

export function levelCheckInviteTemplate(data: LevelCheckInviteEmailData): string {
    const name = data.recipientName ? escapeEmailHtml(data.recipientName) : 'there';
    const diagnosticUrl = safeEmailUrl(data.diagnosticUrl);
    const content = `
        <h2 style="color: #006064; margin: 0 0 20px 0;">Optional Spanish context, ${name}</h2>

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            If you want, these short questions can help your teacher understand how you actually use Spanish.
            This is optional context, not an official exam, eligibility check or condition for booking.
        </p>

        <div style="background-color: #E0F7FA; padding: 25px; margin: 25px 0; border-left: 4px solid #006064;">
            <p style="margin: 0 0 10px 0; font-size: 18px; color: #006064; font-weight: bold;">
                What you can share
            </p>
            <ol style="margin: 0; padding-left: 20px; color: #333333; font-size: 14px; line-height: 1.6;">
                <li style="margin-bottom: 8px;">A few closed questions about your level and main blocker.</li>
                <li style="margin-bottom: 8px;">A short written sample in Spanish.</li>
                <li style="margin-bottom: 0;">Optional audio only later, if you want and if it is useful.</li>
            </ol>
        </div>

        ${diagnosticUrl ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0;">
            <tr>
                <td align="center">
                    <a href="${diagnosticUrl}" style="display: inline-block; background-color: #006064; color: #ffffff; padding: 15px 40px; text-decoration: none; font-weight: bold; font-size: 16px;">
                        OPEN DIAGNOSTIC
                    </a>
                </td>
            </tr>
        </table>
        ` : ''}

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            This diagnostic will not create a review or recommendation gate. Español Honesto has one offer: four
            individual 50-minute classes for EUR 259, renewed every 28 days. When direct booking is enabled, you will
            choose a real available teacher and weekly time on the website; reply to this email if you want help.
        </p>

        <p style="color: #333333; font-size: 16px; line-height: 1.6; margin-top: 30px;">
            Speak soon,<br>
            <strong>The Español Honesto team</strong>
        </p>
    `;

    return baseTemplate(content);
}
