import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/components/admin/LeadManager.tsx', 'utf8');

describe('admin lead manager source contract', () => {
    it('keeps lead applications filterable by lifecycle status', () => {
        expect(source).toContain("useState<LeadStatus | 'all'>('new')");
        expect(source).toContain('/api/admin/leads?');
        expect(source).toContain("value: 'new', label: 'Nuevas'");
        expect(source).toContain("value: 'contacted', label: 'Contactadas'");
        expect(source).toContain("value: 'discarded', label: 'Descartadas'");
        expect(source).toContain("value: 'all', label: 'Todas'");
    });

    it('keeps admin follow-up actions explicit and non-mojibake', () => {
        expect(source).toContain('Marcar contactada');
        expect(source).toContain('Descartar');
        expect(source).toContain('Reabrir');
        expect(source).toContain('Estado y Accion');
        expect(source).not.toMatch(/Acci(?:Ã|�)/);
    });

    it('keeps fit-review fields visible before contacting a lead', () => {
        expect(source).toContain('Nivel:');
        expect(source).toContain('Plan:');
        expect(source).toContain('Origen:');
        expect(source).toContain('Disponibilidad:');
        expect(source).toContain('Diagnostico:');
        expect(source).toContain('level_check_summary');
        expect(source).toContain('Contexto crudo limpiado');
        expect(source).toContain("action: 'send_level_check'");
        expect(source).toContain("action: 'review_level_check'");
        expect(source).toContain('Enviar diagnostico');
        expect(source).toContain('Reenviar diagnostico');
        expect(source).toContain('Revisar y limpiar');
        expect(source).toContain('No hay solicitudes en este estado.');
    });

    it('keeps CRM opportunity stages visible and editable when the pipeline exists', () => {
        expect(source).toContain("type PipelineStage = 'new' | 'to_contact' | 'contacted' | 'qualified' | 'proposal' | 'won' | 'lost' | 'nurture'");
        expect(source).toContain("action: 'opportunity_stage'");
        expect(source).toContain('Etapa CRM');
        expect(source).toContain('updatePipelineStage');
        expect(source).toContain('mapPipelineStageToLeadStatus');
    });

    it('links enriched leads to the central CRM contact file', () => {
        expect(source).toContain('crmContactHref');
        expect(source).toContain('/campus/admin/crm/contact/');
        expect(source).toContain('Abrir ficha CRM');
    });

    it('surfaces actionable backend errors in admin lead actions', () => {
        expect(source).toContain('async function readApiErrorMessage');
        expect(source).toContain("typeof body?.error === 'string'");
        expect(source).toContain("await readApiErrorMessage(res, 'Failed to send follow-up email')");
        expect(source).toContain("await readApiErrorMessage(res, 'Failed to send diagnostic')");
        expect(source).toContain("await readApiErrorMessage(res, 'Failed to update CRM stage')");
    });

    it('keeps aggregated customer-discovery signals available without rich telemetry', () => {
        expect(source).toContain('Aprendizaje SEO sin cookies');
        expect(source).toContain('Rutas que convierten');
        expect(source).toContain('Planes de interes');
        expect(source).toContain('Interés declarado');
        expect(source).toContain('Nivel declarado');
        expect(source).toContain('qualifiedLeadCount');
        expect(source).toContain('topSourcePaths');
        expect(source).toContain('topInterests');
        expect(source).toContain('topPreferredPackages');
        expect(source).toContain('levelSummary');
        expect(source).toContain('LeadPipelineSummary');
        expect(source).toContain('setSummary(data.summary');
        expect(source).toContain('sourcePerformance');
        expect(source).toContain('Embudo CRM');
        expect(source).toContain('pipelineStageSummary');
    });
});
