import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** true cuando .env.local tiene los dos valores reales (no POR_CONFIGURAR). */
export const supabaseConfigurado =
  !!url && !!anonKey && !url.includes('POR_CONFIGURAR') && !anonKey.includes('POR_CONFIGURAR');

// La anon key es pública por diseño: la seguridad real vive en RLS y en las funciones del servidor.
export const supabase: SupabaseClient = createClient(
  supabaseConfigurado ? url! : 'http://localhost',
  supabaseConfigurado ? anonKey! : 'sin-configurar',
  { auth: { persistSession: true, autoRefreshToken: true } }
);
