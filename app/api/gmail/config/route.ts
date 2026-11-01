import { HttpError, route } from "@/lib/api";
import { getAgent } from "@/lib/perms";
import { emailUrl } from "@/lib/email";
import { getGmailConfig } from "@/lib/emailImap";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Dados do app do Google para o botão "Conectar com Google" (sem expor o segredo).
export const GET = route(async () => {
  const cfg = await getGmailConfig();
  return { client_id: cfg.client_id, tem_chave: !!cfg.client_secret, redirect_uri: emailUrl("/api/gmail/callback"), origem: emailUrl("/").replace(/\/$/, "") };
});

export const PUT = route(async (req, _ctx, userId) => {
  const agent = await getAgent(userId);
  if (!agent || agent.role !== "admin") throw new HttpError(403, "só o administrador");
  const b = (await req.json()) as { client_id?: string; client_secret?: string };
  const p: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (b.client_id !== undefined) {
    const id = b.client_id.trim();
    if (id && !/^[\w-]+\.apps\.googleusercontent\.com$/.test(id)) throw new HttpError(400, "o ID do cliente do Google termina com .apps.googleusercontent.com");
    p.client_id = id || null;
  }
  if (b.client_secret?.trim()) {
    const s = b.client_secret.trim();
    if (!/^GOCSPX-[\w-]{20,}$/.test(s)) throw new HttpError(400, "a chave secreta do Google começa com GOCSPX- (copie a 'Chave secreta do cliente')");
    p.client_secret = s;
  }
  const { error } = await supabaseAdmin().from("gmail_config").update(p).eq("id", 1);
  if (error) throw new Error(error.message);
  return { ok: true };
});
