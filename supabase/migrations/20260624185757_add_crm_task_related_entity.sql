ALTER TABLE public.crm_tasks
    ADD COLUMN IF NOT EXISTS related_entity_type TEXT,
    ADD COLUMN IF NOT EXISTS related_entity_id TEXT,
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS crm_tasks_related_entity_idx
    ON public.crm_tasks (related_entity_type, related_entity_id)
    WHERE related_entity_type IS NOT NULL
      AND related_entity_id IS NOT NULL;
