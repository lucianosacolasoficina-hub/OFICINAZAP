import { HttpError, route } from "@/lib/api";
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
  const b = (await req.json()) as { client_id?: string; client_secret?: string; tenant?: string };
  const sec = b.client_secret?.trim();
  if (sec && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sec))
    throw new HttpError(400, "isso é o ID secreto: copie a coluna Valor do segredo (não o ID)");
  if (sec && !/^[A-Za-z0-9~._-]{30,60}$/.test(sec))
    throw new HttpError(400, "essa não parece o Valor do segredo da Microsoft (cerca de 40 letras e números, com um ~ no meio): crie um segredo novo e copie a coluna Valor");
  await saveEmailConfig(b);
  return { ok: true };
});
