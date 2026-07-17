export type Sha256CspHash = `sha256-${string}`;

export function serializeJsonForHtml(value: unknown): string {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
        throw new TypeError('CSP JSON serialization requires a JSON-serializable value');
    }
    return serialized.replace(/</gu, '\\u003c');
}

export async function sha256CspHash(content: string): Promise<Sha256CspHash> {
    const bytes = new TextEncoder().encode(content);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    let binary = '';
    for (const byte of digest) binary += String.fromCharCode(byte);
    return `sha256-${btoa(binary)}`;
}
