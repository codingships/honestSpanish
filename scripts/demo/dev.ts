import { spawn } from 'node:child_process';
import { loadStagingBrowserEnvironment } from '../staging-browser-environment';

loadStagingBrowserEnvironment();

process.env.DEMO_GUIDE_ENABLED ||= 'true';
process.env.DEMO_GUIDE_LOGIN_ENABLED ||= 'true';

const requiredKeys = [
    'TEST_STUDENT_EMAIL',
    'TEST_STUDENT_PASSWORD',
    'TEST_TEACHER_EMAIL',
    'TEST_TEACHER_PASSWORD',
    'TEST_ADMIN_EMAIL',
    'TEST_ADMIN_PASSWORD',
];

const missingKeys = requiredKeys.filter((key) => !process.env[key]);
if (missingKeys.length > 0) {
    console.warn(`[dev:demo] Faltan variables de demo: ${missingKeys.join(', ')}`);
}

const command = process.platform === 'win32' ? 'corepack.cmd' : 'corepack';
const args = ['pnpm', 'dev', '--', '--host', '0.0.0.0', ...process.argv.slice(2)];

const child = spawn(command, args, {
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
});

child.on('error', (error) => {
    console.error(`[dev:demo] No se pudo arrancar Astro: ${error.message}`);
    process.exitCode = 1;
});

child.on('exit', (code) => {
    process.exitCode = code ?? 0;
});
