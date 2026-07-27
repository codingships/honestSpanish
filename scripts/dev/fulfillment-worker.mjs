import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
const workerRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../workers/fulfillment',
);
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

const commands = {
    dev: [
        'exec',
        'wrangler',
        'dev',
        '--config',
        'wrangler.toml',
        '--local',
        '--port',
        '8788',
        '--env',
        'staging',
    ],
    validate: [
        'exec',
        'wrangler',
        'deploy',
        '--config',
        'wrangler.toml',
        '--env',
        'staging',
        '--dry-run',
    ],
};

const args = commands[mode];
if (!args) {
    throw new Error('[fulfillment-worker] Use dev or validate.');
}

const result = spawnSync(pnpm, ['--config.verify-deps-before-run=false', ...args], {
    cwd: workerRoot,
    env: {
        ...process.env,
        CLOUDFLARE_API_TOKEN: '',
        WRANGLER_SEND_METRICS: 'false',
    },
    stdio: 'inherit',
    shell: process.platform === 'win32',
});

if (result.error || result.status !== 0) {
    throw new Error(`[fulfillment-worker] ${mode} failed with exit code ${String(result.status)}.`);
}
