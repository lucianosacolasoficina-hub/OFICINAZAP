import { HttpError, route } from "@/lib/api";
import { getAgent } from "@/lib/perms";
import { assinarWebhook, getIgConfig, gravarConexao, graphGet } from "@/lib/instagram";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Diagnóstico da ligação do Instagram (só administrador). Usa o acesso guardado quando a conta não foi achada.
async function tokenPendente(userId: string) {
  const agent = await getAgent(userId);
  if (!agent || agent.role !== "admin") throw new HttpError(403, "só o administrador");
  const { data } = await supabaseAdmin().from("instagram_config").select("pending_token").eq("id", 1).maybeSingle();
  const t = data?.pending_token as string | null;
  if (!t) throw new HttpError(404, "nenhum acesso pendente: clique em Conectar Instagram de novo");
  return t;
}

// GET ?path=me/assigned_instagram_accounts → resposta da Graph API (sem o token).
export const GET = route(async (req, _ctx, userId) => {
  const token = await tokenPendente(userId);
  const path = new URL(req.url).searchParams.get("path") ?? "me?fields=id,name";
  if (!/^[\w/{},.?=&%-]+$/.test(path)) throw new HttpError(400, "caminho inválido");
  if (path.startsWith("debug_token")) {
    const cfg = await getIgConfig();
    return graphGet(`debug_token?input_token=${encodeURIComponent(token)}`, `${cfg.app_id}|${cfg.app_secret}`);
  }
  return graphGet(path, token);
});

// POST {ig_user_id} → termina a ligação com o acesso guardado.
export const POST = route(async (req, _ctx, userId) => {
  const token = await tokenPendente(userId);
  const { ig_user_id } = (await req.json()) as { ig_user_id?: string };
  if (!ig_user_id || !/^\d{5,25}$/.test(ig_user_id)) throw new HttpError(400, "id da conta inválido");
  const me = await graphGet(`${ig_user_id}?fields=id,username,name`, token);
  const b = (me.body ?? {}) as { username?: string; error?: { message?: string } };
  if (me.status !== 200) throw new HttpError(400, `Instagram: ${b.error?.message ?? "não consegui ler a conta"}`);
  const id = await gravarConexao({ token, igUserId: ig_user_id, username: b.username ?? null, expiresAt: null });
  let webhook = "ok";
  try {
    await assinarWebhook(token, ig_user_id);
  } catch (e) {
    webhook = (e as Error).message;
  }
  await supabaseAdmin().from("instagram_config").update({ pending_token: null }).eq("id", 1);
  return { connection_id: id, username: b.username ?? null, webhook };
});
