import { spawn } from 'node:child_process';

const targetUrl = process.env.DEMO_TUNNEL_URL || 'http://localhost:4321';

console.log(`[demo:tunnel] Publicando ${targetUrl}`);

const child = spawn('cloudflared', ['tunnel', '--url', targetUrl], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
});

child.on('error', () => {
    console.error('[demo:tunnel] No se encontro cloudflared en PATH.');
    console.error('[demo:tunnel] Instala Cloudflare Tunnel y vuelve a ejecutar: pnpm demo:tunnel');
    console.error('[demo:tunnel] En Windows suele funcionar: winget install --id Cloudflare.cloudflared');
    process.exitCode = 1;
});

child.on('exit', (code) => {
    if (code === 0 || code === null) return;
    console.error(`[demo:tunnel] cloudflared termino con codigo ${code}.`);
    console.error('[demo:tunnel] Si no esta instalado, instala Cloudflare Tunnel y repite el comando.');
    process.exitCode = code;
});
