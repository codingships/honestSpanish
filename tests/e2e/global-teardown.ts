import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

export default function cleanupE2eRuntime(): void {
    rmSync(resolve(process.cwd(), 'tests', 'e2e', 'runtime', '.dev.vars'), { force: true });
}
