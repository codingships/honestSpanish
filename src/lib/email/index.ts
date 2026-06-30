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
    levelCheckInviteTemplate,
    missingInfoEmailTemplate,
    proposalNextStepEmailTemplate,
    supportTicketReceivedTemplate,
    supportTicketUpdatedTemplate,
    type WelcomeEmailData,
    type ClassConfirmationData,
    type ClassReminderData,
    type ClassCancelledData,
    type LeadWelcomeEmailData,
    type LevelCheckInviteEmailData,
    type MissingInfoEmailData,
    type ProposalNextStepEmailData,
    type SupportTicketReceivedEmailData,
    type SupportTicketUpdatedEmailData,
} from './templates';

export {
    sendWelcomeEmail,
    sendClassConfirmation,
    sendClassReminder,
    sendClassCancelled,
    sendClassConfirmationToBoth,
    sendClassCancelledToBoth,
    sendLeadWelcomeEmail,
    sendLevelCheckInviteEmail,
    sendMissingInfoEmail,
    sendProposalNextStepEmail,
    sendSupportTicketReceivedEmail,
    sendSupportTicketUpdatedEmail,
} from './send';

