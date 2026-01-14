/**
 * Email Module - Main exports
 */
export { resend, EMAIL_FROM } from './client';

export {
    baseTemplate,
    welcomeEmailTemplate,
    classConfirmationTemplate,
    classReminderTemplate,
    classCancelledTemplate,
    type WelcomeEmailData,
    type ClassConfirmationData,
    type ClassReminderData,
    type ClassCancelledData,
} from './templates';

export {
    sendWelcomeEmail,
    sendClassConfirmation,
    sendClassReminder,
    sendClassCancelled,
    sendClassConfirmationToBoth,
    sendClassCancelledToBoth,
} from './send';
