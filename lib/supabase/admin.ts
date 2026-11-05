import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Cliente com service role: usado somente no servidor (webhook e rotas da API).
// Um só cliente para o servidor inteiro: criar um novo a cada consulta (eram centenas por minuto)
// acumulava memória até o servidor cair a cada ~7 horas.
const g = globalThis as unknown as { __supabaseAdmin?: SupabaseClient };

export function supabaseAdmin(): SupabaseClient {
  if (g.__supabaseAdmin) return g.__supabaseAdmin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias");
  g.__supabaseAdmin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return g.__supabaseAdmin;
}
