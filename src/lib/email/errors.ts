type EmailProviderErrorShape = {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
};

const EMAIL_ADDRESS_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export function redactEmailForLog(email: string): string {
    const [localPart, domain] = email.split('@');
    if (!localPart || !domain) return '[redacted-email]';

    const first = localPart[0] ?? '*';
    const last = localPart.length > 1 ? localPart[localPart.length - 1] : '*';
    return `${first}***${last}@${domain}`;
}

function redactEmailsInText(value: string): string {
    return value.replace(EMAIL_ADDRESS_PATTERN, (match) => redactEmailForLog(match));
}

export function describeEmailSendError(error: unknown): string {
    if (error instanceof Error) {
        const label = error.name && error.name !== 'Error' ? `${error.name}: ` : '';
        return redactEmailsInText(`${label}${error.message || 'Unknown email provider error'}`);
    }

    if (typeof error === 'string') {
        return redactEmailsInText(error);
    }

    if (error && typeof error === 'object') {
        const providerError = error as EmailProviderErrorShape;
        const parts: string[] = [];

        if (typeof providerError.name === 'string') {
            parts.push(redactEmailsInText(providerError.name));
        }

        if (typeof providerError.message === 'string') {
            parts.push(redactEmailsInText(providerError.message));
        }

        if (typeof providerError.code === 'string' || typeof providerError.code === 'number') {
            parts.push(`code=${redactEmailsInText(String(providerError.code))}`);
        }

        if (typeof providerError.statusCode === 'string' || typeof providerError.statusCode === 'number') {
            parts.push(`status=${redactEmailsInText(String(providerError.statusCode))}`);
        } else if (typeof providerError.status === 'string' || typeof providerError.status === 'number') {
            parts.push(`status=${redactEmailsInText(String(providerError.status))}`);
        }

        return parts.length > 0 ? parts.join(' ') : 'Unknown email provider error';
    }

    return 'Unknown email provider error';
}
