/**
 * Email Module - Main exports
 */
export { resend, getEmailFrom, getResend } from './client';

export {
    baseTemplate,
    welcomeEmailTemplate,
    classConfirmationTemplate,
    classReminderTemplate,
    classCancelledTemplate,
    leadWelcomeTemplate,
    type WelcomeEmailData,
    type ClassConfirmationData,
    type ClassReminderData,
    type ClassCancelledData,
    type LeadWelcomeEmailData,
} from './templates';

export {
    sendWelcomeEmail,
    sendClassConfirmation,
    sendClassReminder,
    sendClassCancelled,
    sendClassConfirmationToBoth,
    sendClassCancelledToBoth,
    sendLeadWelcomeEmail,
} from './send';

