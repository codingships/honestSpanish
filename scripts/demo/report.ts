import path from 'node:path';
import { computeSectionStatus, findLatestRunDirectory, readRunSummary, writeRunArtifacts } from './shared';

const latestRun = await findLatestRunDirectory();

if (!latestRun) {
    console.log('[demo:report] No hay ejecuciones en test-results/demo-runs.');
    process.exit(0);
}

const summary = await readRunSummary(latestRun);

if (!summary) {
    console.log(`[demo:report] No se encontro run.json en ${latestRun}.`);
    process.exit(1);
}

summary.sectionStatus = computeSectionStatus(summary.results);
summary.activity ??= [];
await writeRunArtifacts(summary);

console.log(`[demo:report] Ultima ejecucion: ${latestRun}`);
console.log(`[demo:report] Pasos: ${summary.results.length}`);
console.log(`[demo:report] Incidencias: ${summary.notes.length}`);
console.log(`[demo:report] Errores: ${summary.errors.length}`);
console.log(`[demo:report] Markdown: ${path.join(latestRun, 'report.md')}`);
console.log(`[demo:report] HTML: ${path.join(latestRun, 'report.html')}`);
