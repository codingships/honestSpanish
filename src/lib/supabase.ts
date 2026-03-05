import { createBrowserClient } from '@supabase/ssr';
// 👇 1. Importamos la definición de la Base de Datos
import type { Database } from '../types/database.types';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables');
}

// Use createBrowserClient from @supabase/ssr for cookie-based auth
// This ensures the session is stored in cookies and accessible by the server
// 👇 2. Inyectamos el tipo <Database> aquí
export const supabase = createBrowserClient<Database>(supabaseUrl, supabaseKey);