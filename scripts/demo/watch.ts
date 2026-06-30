import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const pointerPath = path.join(process.cwd(), 'outputs', 'demo-runs', 'current.json');
let activeLogPath = '';
let cursor = 0;

console.log('[demo:watch] Esperando actividad de demo. Ctrl+C para salir.');

setInterval(() => {
    void tick();
}, 500);

async function tick(): Promise<void> {
    if (!existsSync(pointerPath)) return;

    const pointer = JSON.parse(await readFile(pointerPath, 'utf8')) as {
        status: string;
        activityLogPath: string;
        outputDir: string;
    };

    if (pointer.activityLogPath !== activeLogPath) {
        activeLogPath = pointer.activityLogPath;
        cursor = 0;
        console.log(`[demo:watch] Run: ${pointer.outputDir}`);
    }

    if (!existsSync(activeLogPath)) return;

    const content = await readFile(activeLogPath, 'utf8');
    const next = content.slice(cursor);
    cursor = content.length;

    if (next.trim()) {
        process.stdout.write(next);
    }
}
