const fingerprintVersion = 'v1';
const minimumSecretBytes = 32;
const maximumClientAddressLength = 128;

const encoder = new TextEncoder();

function containsUnsafeAddressCharacter(value: string): boolean {
    return Array.from(value).some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return /\s/u.test(character) || codePoint <= 31 || codePoint === 127;
    });
}

function normalizeIpv4(value: string): string | null {
    const octets = value.split('.');
    if (octets.length !== 4) return null;

    const normalized: string[] = [];
    for (const octet of octets) {
        if (!/^(?:0|[1-9][0-9]{0,2})$/u.test(octet)) return null;
        const number = Number(octet);
        if (!Number.isInteger(number) || number > 255) return null;
        normalized.push(String(number));
    }
    return normalized.join('.');
}

function normalizeIpv6(value: string): string | null {
    if (!value.includes(':') || value.includes('[') || value.includes(']')) return null;

    try {
        const hostname = new URL(`http://[${value}]/`).hostname;
        if (!hostname.startsWith('[') || !hostname.endsWith(']')) return null;
        return hostname.slice(1, -1).toLowerCase();
    } catch {
        return null;
    }
}

function ipv6Hextets(value: string): number[] | null {
    const halves = value.split('::');
    if (halves.length > 2) return null;

    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    const missing = 8 - left.length - right.length;
    if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;

    const hextets = [
        ...left,
        ...Array.from({ length: missing }, () => '0'),
        ...right,
    ].map((hextet) => Number.parseInt(hextet, 16));
    return hextets.length === 8 && hextets.every((hextet) => (
        Number.isInteger(hextet) && hextet >= 0 && hextet <= 0xffff
    ))
        ? hextets
        : null;
}

function checkoutNetworkIdentity(normalizedAddress: string): string | null {
    const ipv4 = normalizeIpv4(normalizedAddress);
    if (ipv4) return `ipv4:${ipv4}`;

    const hextets = ipv6Hextets(normalizedAddress);
    if (!hextets) return null;
    if (
        hextets.slice(0, 5).every((hextet) => hextet === 0)
        && hextets[5] === 0xffff
    ) {
        const ipv4 = [
            hextets[6]! >> 8,
            hextets[6]! & 0xff,
            hextets[7]! >> 8,
            hextets[7]! & 0xff,
        ].join('.');
        return `ipv4:${ipv4}`;
    }
    const prefix = hextets.slice(0, 4).map((hextet) => hextet.toString(16)).join(':');
    return `ipv6:${prefix}::/64`;
}

export function normalizeCheckoutClientAddress(value: unknown): string | null {
    if (typeof value !== 'string') return null;

    const normalized = value.trim().toLowerCase();
    if (
        normalized.length === 0
        || normalized.length > maximumClientAddressLength
        || containsUnsafeAddressCharacter(normalized)
    ) return null;

    return normalizeIpv4(normalized) ?? normalizeIpv6(normalized);
}

export async function createCheckoutHoldFingerprint(input: {
    clientAddress: string;
    secret: string;
}): Promise<string | null> {
    const normalizedAddress = normalizeCheckoutClientAddress(input.clientAddress);
    const secretBytes = encoder.encode(input.secret);
    if (!normalizedAddress || secretBytes.byteLength < minimumSecretBytes) return null;

    const networkIdentity = checkoutNetworkIdentity(normalizedAddress);
    if (!networkIdentity) return null;

    try {
        const key = await globalThis.crypto.subtle.importKey(
            'raw',
            secretBytes,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign'],
        );
        const signature = await globalThis.crypto.subtle.sign(
            'HMAC',
            key,
            encoder.encode(networkIdentity),
        );
        const hex = Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
        return `${fingerprintVersion}:${hex}`;
    } catch {
        return null;
    }
}
