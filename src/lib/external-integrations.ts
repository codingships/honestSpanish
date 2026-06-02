export function shouldDisableExternalIntegrations(): boolean {
    return process.env.E2E_DISABLE_EXTERNAL_INTEGRATIONS === 'true'
        && process.env.NODE_ENV !== 'production';
}
