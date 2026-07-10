/** Normalize the common dotenv/secret-manager encodings of a PEM key. */
export function normalizeGooglePrivateKey(value: string): string {
    return value
        .replace(/\\r\\n/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/\\(?=\r?\n|$)/g, '')
        .replace(/\r\n/g, '\n')
        .trim();
}
