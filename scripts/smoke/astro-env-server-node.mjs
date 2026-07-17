export function getSecret(key) {
    const value = process.env[key];
    return value === '' ? undefined : value;
}
