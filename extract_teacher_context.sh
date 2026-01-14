#!/bin/bash
# Script para generar contexto del profesor para el agente de IA - ACTUALIZADO

OUTPUT="teacher_context_for_ai.txt"

echo "========================================" > $OUTPUT
echo "CONTEXTO TEACHER - ESPAÑOL HONESTO" >> $OUTPUT
echo "Generado: $(date)" >> $OUTPUT
echo "========================================" >> $OUTPUT

# 1. PAGE TEACHER DASHBOARD
echo -e "\n\n### ======================================== ###" >> $OUTPUT
echo "### DASHBOARD TEACHER (src/pages/[lang]/campus/teacher/index.astro)" >> $OUTPUT
echo "### ======================================== ###" >> $OUTPUT

echo -e "\n\n--- src/pages/[lang]/campus/teacher/index.astro ---\n" >> $OUTPUT
cat "src/pages/[lang]/campus/teacher/index.astro" >> $OUTPUT 2>/dev/null

# 2. PAGE TEACHER STUDENT DETAILS
echo -e "\n\n### ======================================== ###" >> $OUTPUT
echo "### DETALLE ESTUDIANTE (src/pages/[lang]/campus/teacher/student/[id].astro)" >> $OUTPUT
echo "### ======================================== ###" >> $OUTPUT

echo -e "\n\n--- src/pages/[lang]/campus/teacher/student/[id].astro ---\n" >> $OUTPUT
cat "src/pages/[lang]/campus/teacher/student/[id].astro" >> $OUTPUT 2>/dev/null

# 3. COMPONENTES TEACHER
echo -e "\n\n### ======================================== ###" >> $OUTPUT
echo "### COMPONENTES RELACIONADOS" >> $OUTPUT
echo "### ======================================== ###" >> $OUTPUT

echo -e "\n\n--- src/components/TeacherNotes.tsx ---\n" >> $OUTPUT
cat "src/components/TeacherNotes.tsx" >> $OUTPUT 2>/dev/null

# 4. CAMPUS LAYOUT
echo -e "\n\n### ======================================== ###" >> $OUTPUT
echo "### LAYOUT (src/layouts/CampusLayout.astro)" >> $OUTPUT
echo "### ======================================== ###" >> $OUTPUT

echo -e "\n\n--- src/layouts/CampusLayout.astro ---\n" >> $OUTPUT
cat "src/layouts/CampusLayout.astro" >> $OUTPUT 2>/dev/null

echo -e "\n\n========================================" >> $OUTPUT
echo "FIN DEL CONTEXTO" >> $OUTPUT
echo "========================================" >> $OUTPUT

echo "✅ Archivo generado: $OUTPUT"
echo "📊 Tamaño: $(wc -l < $OUTPUT) líneas"
