-- =============================================
-- ESPAÑOL HONESTO - ADD LEADS STATUS
-- =============================================
-- Añade la columna 'status' a la tabla de leads para el seguimiento en el CRM.

ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'new' 
CHECK (status IN ('new', 'contacted', 'discarded'));

-- Opcional: Si ya tenías datos en la tabla, todos adoptarán 'new' por defecto.
