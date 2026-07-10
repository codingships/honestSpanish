import { readRuntimeEnv } from './runtime-env';

export function shouldDisableExternalIntegrations(): boolean {
    return readRuntimeEnv('E2E_DISABLE_EXTERNAL_INTEGRATIONS') === 'true'
        && readRuntimeEnv('NODE_ENV') !== 'production';
}
