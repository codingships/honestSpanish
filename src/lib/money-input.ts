export function eurosToCents(raw: string, allowNegative = false): number | null {
    const normalized = raw.trim().replace(',', '.');
    const pattern = allowNegative ? /^-?\d{1,9}(?:\.\d{1,2})?$/ : /^\d{1,9}(?:\.\d{1,2})?$/;
    if (!pattern.test(normalized)) return null;

    const negative = normalized.startsWith('-');
    const unsigned = negative ? normalized.slice(1) : normalized;
    const [euros, decimals = ''] = unsigned.split('.');
    const value = (BigInt(euros) * 100n) + BigInt(decimals.padEnd(2, '0'));
    const signed = negative ? -value : value;
    if (signed > BigInt(Number.MAX_SAFE_INTEGER) || signed < BigInt(Number.MIN_SAFE_INTEGER)) return null;
    return Number(signed);
}
