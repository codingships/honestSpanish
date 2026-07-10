import { spawn } from 'node:child_process';

process.env.CLOUDFLARE_ENV = 'production';

const command = process.platform === 'win32' ? 'corepack.cmd' : 'corepack';
const args = [
    'pnpm',
    'exec',
    'astro',
    'dev',
    '--mode',
    'production',
    ...process.argv.slice(2),
];

const child = spawn(command, args, {
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
});

child.on('error', (error) => {
    console.error(`[dev:production-data] No se pudo arrancar Astro: ${error.message}`);
    process.exitCode = 1;
});

child.on('exit', (code) => {
    process.exitCode = code ?? 0;
});
