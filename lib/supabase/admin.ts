import { createClient } from "@supabase/supabase-js";

// Cliente com service role: usado somente no servidor (webhook e rotas da API).
export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias");
  return createClient(url, key, { auth: { persistSession: false } });
}
