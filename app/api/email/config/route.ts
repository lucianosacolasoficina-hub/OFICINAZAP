import { route } from "@/lib/api";
import { emailUrl, getEmailConfig, saveEmailConfig } from "@/lib/email";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Ligação do Outlook: o que configurar na Microsoft e as contas conectadas (sem expor a chave secreta).
export const GET = route(async () => {
  const cfg = await getEmailConfig();
  const { data: contas } = await supabaseAdmin()
    .from("whatsapp_connections")
    .select("id, name, connected_at, tok:email_tokens(address, last_sync, last_error)")
    .eq("channel", "email")
    .order("created_at");
  return { client_id: cfg.client_id, tem_chave: !!cfg.client_secret, tenant: cfg.tenant, redirect_uri: emailUrl("/api/email/callback"), contas: contas ?? [] };
});

export const PUT = route(async (req) => {
  await saveEmailConfig((await req.json()) as { client_id?: string; client_secret?: string; tenant?: string });
  return { ok: true };
});
