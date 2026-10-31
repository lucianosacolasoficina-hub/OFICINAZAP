import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "./supabase/admin";

// Instagram Direct pela API oficial da Meta ("Instagram API with Instagram Login").
// O app da Meta (App ID e chave secreta) e os tokens ficam em tabelas que só o servidor lê.

const GRAPH = "https://graph.instagram.com/v23.0";
export const IG_SCOPES = ["instagram_business_basic", "instagram_business_manage_messages"];

export type IgConfig = { app_id: string | null; app_secret: string | null; verify_token: string };
export type IgToken = { connection_id: string; ig_user_id: string; username: string | null; access_token: string; expires_at: string | null };

export async function getIgConfig(): Promise<IgConfig> {
  const { data, error } = await supabaseAdmin().from("instagram_config").select("app_id, app_secret, verify_token").eq("id", 1).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as IgConfig) ?? { app_id: null, app_secret: null, verify_token: "" };
}

export async function saveIgConfig(patch: { app_id?: string; app_secret?: string }) {
  const p: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.app_id !== undefined) p.app_id = patch.app_id.trim() || null;
  if (patch.app_secret !== undefined && patch.app_secret.trim()) p.app_secret = patch.app_secret.trim();
  const { error } = await supabaseAdmin().from("instagram_config").update(p).eq("id", 1);
  if (error) throw new Error(error.message);
}

/** Confere a assinatura X-Hub-Signature-256 que a Meta manda no webhook. */
export function assinaturaValida(raw: string, header: string | null, secret: string | null) {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const esperado = createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(header.slice(7), "hex");
  const b = Buffer.from(esperado, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function jsonOuErro(res: Response) {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string } | string; error_message?: string };
  if (!res.ok || body.error) {
    const msg = typeof body.error === "string" ? body.error : body.error?.message ?? body.error_message ?? `erro ${res.status}`;
    throw new Error(`Instagram: ${msg}`);
  }
  return body;
}

export function urlAutorizacao(cfg: IgConfig, redirectUri: string, state: string) {
  const u = new URL("https://www.instagram.com/oauth/authorize");
  u.searchParams.set("enable_fb_login", "0");
  u.searchParams.set("force_authentication", "1");
  u.searchParams.set("client_id", cfg.app_id ?? "");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", IG_SCOPES.join(","));
  u.searchParams.set("state", state);
  return u.toString();
}

/** Troca o código da autorização por um token de longa duração (60 dias) e os dados da conta. */
export async function trocarCodigo(cfg: IgConfig, code: string, redirectUri: string) {
  const form = new URLSearchParams({
    client_id: cfg.app_id ?? "",
    client_secret: cfg.app_secret ?? "",
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code: code.replace(/#_$/, ""),
  });
  const curto = await jsonOuErro(await fetch("https://api.instagram.com/oauth/access_token", { method: "POST", body: form }));
  const dados = (Array.isArray(curto.data) ? curto.data[0] : curto) as { access_token: string };
  const longo = await jsonOuErro(
    await fetch(`https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(cfg.app_secret ?? "")}&access_token=${encodeURIComponent(dados.access_token)}`),
  );
  const token = String(longo.access_token);
  const me = await jsonOuErro(await fetch(`${GRAPH}/me?fields=user_id,username,name&access_token=${encodeURIComponent(token)}`));
  return {
    token,
    expiresAt: new Date(Date.now() + Number(longo.expires_in ?? 5184000) * 1000).toISOString(),
    igUserId: String(me.user_id ?? me.id),
    username: (me.username as string) ?? null,
    name: (me.name as string) ?? null,
  };
}

/** Pede à Meta para mandar as mensagens do Direct desta conta para o nosso webhook. */
export async function assinarWebhook(token: string) {
  const campos = "messages,messaging_seen,messaging_postbacks,messaging_reactions,messaging_referrals";
  await jsonOuErro(await fetch(`${GRAPH}/me/subscribed_apps?subscribed_fields=${campos}&access_token=${encodeURIComponent(token)}`, { method: "POST" }));
}

export async function tokenDaConexao(connectionId: string): Promise<IgToken | null> {
  const { data } = await supabaseAdmin().from("instagram_tokens").select("*").eq("connection_id", connectionId).maybeSingle();
  if (!data) return null;
  const t = data as IgToken;
  // Renova sozinho quando faltam menos de 10 dias para vencer.
  if (t.expires_at && new Date(t.expires_at).getTime() - Date.now() < 10 * 864e5) {
    try {
      const r = await jsonOuErro(await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(t.access_token)}`));
      t.access_token = String(r.access_token);
      t.expires_at = new Date(Date.now() + Number(r.expires_in ?? 5184000) * 1000).toISOString();
      await supabaseAdmin().from("instagram_tokens").update({ access_token: t.access_token, expires_at: t.expires_at, updated_at: new Date().toISOString() }).eq("connection_id", connectionId);
    } catch (e) {
      console.error("Não consegui renovar o token do Instagram", e);
    }
  }
  return t;
}

export async function tokenPorConta(igUserId: string): Promise<IgToken | null> {
  const { data } = await supabaseAdmin().from("instagram_tokens").select("connection_id").eq("ig_user_id", igUserId).maybeSingle();
  return data ? tokenDaConexao(data.connection_id as string) : null;
}

/** Nome e @ de quem mandou mensagem (o Instagram identifica o cliente por um id próprio). */
export async function perfil(token: string, igsid: string): Promise<{ name: string | null; username: string | null }> {
  try {
    const r = await jsonOuErro(await fetch(`${GRAPH}/${igsid}?fields=name,username&access_token=${encodeURIComponent(token)}`));
    return { name: (r.name as string) || null, username: (r.username as string) || null };
  } catch {
    return { name: null, username: null };
  }
}

export async function enviarTexto(connectionId: string, igsid: string, text: string): Promise<{ waMessageId?: string }> {
  const t = await tokenDaConexao(connectionId);
  if (!t) throw new Error("Instagram desconectado: conecte de novo na tela WhatsApp");
  const r = await jsonOuErro(
    await fetch(`${GRAPH}/me/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${t.access_token}` },
      body: JSON.stringify({ recipient: { id: igsid }, message: { text: text.slice(0, 1000) } }),
    }),
  );
  return { waMessageId: (r.message_id as string) ?? undefined };
}

/** Contatos do Instagram ficam com "ig:" na frente do id do cliente (para não misturar com telefone). */
export const IG_PREFIX = "ig:";
export const ehInstagram = (phone: string | null | undefined) => !!phone && phone.startsWith(IG_PREFIX);
