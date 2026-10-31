import { route, HttpError } from "@/lib/api";
import { getIgConfig, saveIgConfig, igUrl } from "@/lib/instagram";
import { publicUrl } from "@/lib/origin";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Tela de ligação do Instagram: mostra o que configurar na Meta e as contas conectadas (sem expor a chave secreta).
export const GET = route(async (req) => {
  const cfg = await getIgConfig();
  const { data: contas } = await supabaseAdmin()
    .from("whatsapp_connections")
    .select("id, name, connected_at, tok:instagram_tokens(username, expires_at)")
    .eq("channel", "instagram")
    .order("created_at");
  return {
    app_id: cfg.app_id,
    tem_chave: !!cfg.app_secret,
    verify_token: cfg.verify_token,
    webhook_url: igUrl("/api/webhooks/instagram"),
    redirect_uri: igUrl("/api/instagram/callback"),
    privacidade_url: igUrl("/privacidade"),
    exclusao_url: igUrl("/exclusao-de-dados"),
    contas: contas ?? [],
  };
});

// Só o administrador grava o App ID e a chave secreta do app da Meta.
export const PUT = route(async (req) => {
  const b = (await req.json()) as { app_id?: string; app_secret?: string };
  if (b.app_id !== undefined && b.app_id.trim() && !/^\d{6,20}$/.test(b.app_id.trim())) throw new HttpError(400, "o App ID do Instagram tem só números");
  await saveIgConfig(b);
  return { ok: true };
});
