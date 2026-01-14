#!/bin/bash
# Script para generar contexto del admin para el agente de IA

OUTPUT="admin_context_for_ai.txt"

echo "========================================" > $OUTPUT
echo "CONTEXTO ADMIN - ESPAÑOL HONESTO" >> $OUTPUT
echo "Generado: $(date)" >> $OUTPUT
echo "========================================" >> $OUTPUT

# 1. PÁGINAS ADMIN
echo -e "\n\n### ======================================== ###" >> $OUTPUT
echo "### PÁGINAS ADMIN (src/pages/[lang]/campus/admin/)" >> $OUTPUT
echo "### ======================================== ###" >> $OUTPUT

echo -e "\n\n--- src/pages/[lang]/campus/admin/index.astro ---\n" >> $OUTPUT
cat "src/pages/[lang]/campus/admin/index.astro" >> $OUTPUT 2>/dev/null

echo -e "\n\n--- src/pages/[lang]/campus/admin/students.astro ---\n" >> $OUTPUT
cat "src/pages/[lang]/campus/admin/students.astro" >> $OUTPUT 2>/dev/null

echo -e "\n\n--- src/pages/[lang]/campus/admin/payments.astro ---\n" >> $OUTPUT
cat "src/pages/[lang]/campus/admin/payments.astro" >> $OUTPUT 2>/dev/null

echo -e "\n\n--- src/pages/[lang]/campus/admin/student/[id].astro ---\n" >> $OUTPUT
cat "src/pages/[lang]/campus/admin/student/[id].astro" >> $OUTPUT 2>/dev/null

# 2. APIS ADMIN
echo -e "\n\n### ======================================== ###" >> $OUTPUT
echo "### APIS ADMIN (src/pages/api/admin/)" >> $OUTPUT
echo "### ======================================== ###" >> $OUTPUT

echo -e "\n\n--- src/pages/api/admin/assign-teacher.ts ---\n" >> $OUTPUT
cat "src/pages/api/admin/assign-teacher.ts" >> $OUTPUT 2>/dev/null

echo -e "\n\n--- src/pages/api/admin/remove-teacher.ts ---\n" >> $OUTPUT
cat "src/pages/api/admin/remove-teacher.ts" >> $OUTPUT 2>/dev/null

# 3. COMPONENTES ADMIN
echo -e "\n\n### ======================================== ###" >> $OUTPUT
echo "### COMPONENTES ADMIN (src/components/admin/)" >> $OUTPUT
echo "### ======================================== ###" >> $OUTPUT

echo -e "\n\n--- src/components/admin/AssignTeacherButton.tsx ---\n" >> $OUTPUT
cat "src/components/admin/AssignTeacherButton.tsx" >> $OUTPUT 2>/dev/null

echo -e "\n\n--- src/components/admin/AssignTeacherModal.tsx ---\n" >> $OUTPUT
cat "src/components/admin/AssignTeacherModal.tsx" >> $OUTPUT 2>/dev/null

echo -e "\n\n--- src/components/admin/StudentFilters.tsx ---\n" >> $OUTPUT
cat "src/components/admin/StudentFilters.tsx" >> $OUTPUT 2>/dev/null

# 4. SCHEMA BD
echo -e "\n\n### ======================================== ###" >> $OUTPUT
echo "### SCHEMA BD (db/schema.sql)" >> $OUTPUT
echo "### ======================================== ###" >> $OUTPUT

echo -e "\n\n--- db/schema.sql ---\n" >> $OUTPUT
cat "db/schema.sql" >> $OUTPUT 2>/dev/null

# 5. STRIPE WEBHOOK
echo -e "\n\n### ======================================== ###" >> $OUTPUT
echo "### STRIPE WEBHOOK (src/pages/api/stripe-webhook.ts)" >> $OUTPUT
echo "### ======================================== ###" >> $OUTPUT

echo -e "\n\n--- src/pages/api/stripe-webhook.ts ---\n" >> $OUTPUT
cat "src/pages/api/stripe-webhook.ts" >> $OUTPUT 2>/dev/null

# 6. MIDDLEWARE
echo -e "\n\n### ======================================== ###" >> $OUTPUT
echo "### MIDDLEWARE (src/middleware.ts)" >> $OUTPUT
echo "### ======================================== ###" >> $OUTPUT

echo -e "\n\n--- src/middleware.ts ---\n" >> $OUTPUT
cat "src/middleware.ts" >> $OUTPUT 2>/dev/null

echo -e "\n\n========================================" >> $OUTPUT
echo "FIN DEL CONTEXTO" >> $OUTPUT
echo "========================================" >> $OUTPUT

echo "✅ Archivo generado: $OUTPUT"
echo "📊 Tamaño: $(wc -l < $OUTPUT) líneas"
