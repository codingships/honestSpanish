#!/bin/bash

OUTPUT="project_context.txt"

echo "========================================" > $OUTPUT
echo "PROYECTO: Español Honesto - Context Dump" >> $OUTPUT
echo "Fecha: $(date)" >> $OUTPUT
echo "========================================" >> $OUTPUT

# 1. Estructura del proyecto
echo -e "\n\n### ESTRUCTURA DEL PROYECTO ###\n" >> $OUTPUT
find src -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.astro" \) 2>/dev/null >> $OUTPUT

# 2. Package.json
echo -e "\n\n### PACKAGE.JSON ###\n" >> $OUTPUT
cat package.json >> $OUTPUT 2>/dev/null

# 3. Configuración Astro
echo -e "\n\n### ASTRO.CONFIG.MJS ###\n" >> $OUTPUT
cat astro.config.mjs >> $OUTPUT 2>/dev/null

# 4. Variables de entorno (ejemplo)
echo -e "\n\n### .ENV.EXAMPLE ###\n" >> $OUTPUT
cat .env.example >> $OUTPUT 2>/dev/null || cat .env.local >> $OUTPUT 2>/dev/null | grep -v "=" | head -20

# 5. APIs críticas
echo -e "\n\n### API: CREATE-CHECKOUT.TS ###\n" >> $OUTPUT
cat src/pages/api/create-checkout.ts >> $OUTPUT 2>/dev/null

echo -e "\n\n### API: STRIPE-WEBHOOK.TS ###\n" >> $OUTPUT
cat src/pages/api/stripe-webhook.ts >> $OUTPUT 2>/dev/null

echo -e "\n\n### API: ASSIGN-TEACHER.TS ###\n" >> $OUTPUT
cat src/pages/api/admin/assign-teacher.ts >> $OUTPUT 2>/dev/null

echo -e "\n\n### API: UPDATE-PROFILE.TS ###\n" >> $OUTPUT
cat src/pages/api/account/update-profile.ts >> $OUTPUT 2>/dev/null

# 6. Autenticación y middleware
echo -e "\n\n### LIB: SUPABASE.TS ###\n" >> $OUTPUT
cat src/lib/supabase.ts >> $OUTPUT 2>/dev/null

echo -e "\n\n### LIB: SUPABASE-SERVER.TS ###\n" >> $OUTPUT
cat src/lib/supabase-server.ts >> $OUTPUT 2>/dev/null

echo -e "\n\n### MIDDLEWARE.TS ###\n" >> $OUTPUT
cat src/middleware.ts >> $OUTPUT 2>/dev/null

# 7. Schema de DB si existe
echo -e "\n\n### DB SCHEMA (si existe) ###\n" >> $OUTPUT
cat db/schema.sql >> $OUTPUT 2>/dev/null || cat db/migrations/*.sql >> $OUTPUT 2>/dev/null

# 8. Stripe config
echo -e "\n\n### LIB: STRIPE.TS ###\n" >> $OUTPUT
cat src/lib/stripe.ts >> $OUTPUT 2>/dev/null

echo -e "\n\n========================================" >> $OUTPUT
echo "FIN DEL CONTEXT DUMP" >> $OUTPUT
echo "========================================" >> $OUTPUT

echo "✅ Archivo generado: $OUTPUT"
echo "📊 Tamaño: $(wc -l < $OUTPUT) líneas"