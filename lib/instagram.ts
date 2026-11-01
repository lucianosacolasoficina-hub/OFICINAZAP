import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "./supabase/admin";

// Instagram Direct pela API oficial da Meta.
// Apps novos da Meta só aceitam o "login unificado" (Login do Facebook para Empresas com config_id):
// o token é de usuário do sistema (não vence) e as chamadas vão para graph.facebook.com/{id da conta}.
// Sem config_id, usa o login antigo do Instagram (graph.instagram.com/me).
// O app da Meta (App ID, config_id e chave secreta) e os tokens ficam em tabelas que só o servidor lê.

const GRAPH = "https://graph.instagram.com/v23.0";
const FB_GRAPH = "https://graph.facebook.com/v23.0";
// Endereço fixo usado com a Meta (o redirecionamento precisa ser exatamente igual ao cadastrado no app).
export const IG_BASE = process.env.IG_BASE_URL || "https://zap.sacolasoficina.com.br";
export const igUrl = (path: string) => new URL(path, IG_BASE).toString();
export const IG_SCOPES = ["instagram_business_basic", "instagram_business_manage_messages"];

export type IgConfig = { app_id: string | null; app_secret: string | null; verify_token: string; config_id: string | null };
export const unificado = (cfg: IgConfig) => !!cfg.config_id;
export type IgToken = { connection_id: string; ig_user_id: string; username: string | null; access_token: string; expires_at: string | null };

export async function getIgConfig(): Promise<IgConfig> {
  const { data, error } = await supabaseAdmin().from("instagram_config").select("app_id, app_secret, verify_token, config_id").eq("id", 1).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as IgConfig) ?? { app_id: null, app_secret: null, verify_token: "", config_id: null };
}

export async function saveIgConfig(patch: { app_id?: string; app_secret?: string; config_id?: string }) {
  const p: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.app_id !== undefined) p.app_id = patch.app_id.trim() || null;
  if (patch.config_id !== undefined) p.config_id = patch.config_id.trim() || null;
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
  if (unificado(cfg)) {
    const f = new URL("https://www.facebook.com/dialog/oauth");
    f.searchParams.set("client_id", cfg.app_id ?? "");
    f.searchParams.set("config_id", cfg.config_id ?? "");
    f.searchParams.set("redirect_uri", redirectUri);
    f.searchParams.set("response_type", "code");
    f.searchParams.set("override_default_response_type", "true");
    f.searchParams.set("state", state);
    return f.toString();
  }
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
  if (unificado(cfg)) return trocarCodigoUnificado(cfg, code, redirectUri);
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

/** Login unificado: o código vira um token de usuário do sistema (não vence) com a conta do Instagram escolhida. */
async function trocarCodigoUnificado(cfg: IgConfig, code: string, redirectUri: string) {
  const u = new URL(`${FB_GRAPH}/oauth/access_token`);
  u.searchParams.set("client_id", cfg.app_id ?? "");
  u.searchParams.set("client_secret", cfg.app_secret ?? "");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("code", code);
  const r = await jsonOuErro(await fetch(u, { cache: "no-store" }));
  let token = String(r.access_token);
  // Token de usuário (configuração por Página): troca por um de longa duração antes de pegar o token da Página.
  try {
    const dbg = await jsonOuErro(await fetch(`${FB_GRAPH}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(`${cfg.app_id}|${cfg.app_secret}`)}`, { cache: "no-store" }));
    if ((dbg.data as { type?: string })?.type === "USER") {
      const ll = await jsonOuErro(await fetch(`${FB_GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${cfg.app_id}&client_secret=${encodeURIComponent(cfg.app_secret ?? "")}&fb_exchange_token=${encodeURIComponent(token)}`, { cache: "no-store" }));
      if (ll.access_token) token = String(ll.access_token);
    }
  } catch (e) {
    console.warn("Instagram: não deu para trocar por token de longa duração", e);
  }
  let conta: ContaAchada;
  try {
    conta = await acharContaInstagram(cfg, token);
  } catch (e) {
    // Guarda o acesso para terminar a ligação depois (tela de diagnóstico do administrador).
    await supabaseAdmin().from("instagram_config").update({ pending_token: token }).eq("id", 1);
    throw e;
  }
  const usar = conta.token ?? token;
  const me = await jsonOuErro(await fetch(`${FB_GRAPH}/${conta.id}?fields=id,username,name&access_token=${encodeURIComponent(usar)}`)).catch(() => ({}) as Record<string, unknown>);
  return {
    token: usar,
    pageId: conta.pageId ?? null,
    expiresAt: conta.token ? null : r.expires_in ? new Date(Date.now() + Number(r.expires_in) * 1000).toISOString() : null,
    igUserId: String(conta.id),
    username: ((me.username as string) ?? conta.username) || null,
    name: (me.name as string) ?? null,
  };
}

/**
 * Descobre qual conta do Instagram foi compartilhada na autorização.
 * Tenta, em ordem: contas atribuídas ao token, os ids das permissões concedidas (debug_token)
 * e as Páginas ligadas a uma conta do Instagram.
 */
type ContaAchada = { id: string; username?: string; token?: string; pageId?: string };
async function acharContaInstagram(cfg: IgConfig, token: string): Promise<ContaAchada> {
  const t = encodeURIComponent(token);
  const tentativas: string[] = [];
  try {
    const r = await jsonOuErro(await fetch(`${FB_GRAPH}/me/assigned_instagram_accounts?fields=id,username&access_token=${t}`, { cache: "no-store" }));
    const l = (r.data as { id: string; username?: string }[]) ?? [];
    if (l[0]) return l[0];
    tentativas.push("atribuídas: 0");
  } catch (e) {
    tentativas.push(`atribuídas: ${(e as Error).message}`);
  }
  try {
    const app = encodeURIComponent(`${cfg.app_id}|${cfg.app_secret}`);
    const r = await jsonOuErro(await fetch(`${FB_GRAPH}/debug_token?input_token=${t}&access_token=${app}`, { cache: "no-store" }));
    const scopes = ((r.data as { granular_scopes?: { scope: string; target_ids?: string[] }[] })?.granular_scopes ?? []);
    const ig = scopes.find((s) => s.scope === "instagram_manage_messages" && s.target_ids?.length) ?? scopes.find((s) => s.scope.startsWith("instagram_") && s.target_ids?.length);
    if (ig?.target_ids?.[0]) return { id: ig.target_ids[0] };
    tentativas.push(`permissões: ${scopes.map((s) => `${s.scope}(${s.target_ids?.length ?? 0})`).join(" ") || "nenhuma"}`);
  } catch (e) {
    tentativas.push(`permissões: ${(e as Error).message}`);
  }
  try {
    // Login com token de usuário: a conta do Instagram vem pela Página do Facebook ligada a ela,
    // e as mensagens usam o token da Página (não vence quando vem de um token de usuário de longa duração).
    const r = await jsonOuErro(await fetch(`${FB_GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=100&access_token=${t}`, { cache: "no-store" }));
    const pgs = (r.data as { id: string; name?: string; access_token?: string; instagram_business_account?: { id: string; username?: string } }[]) ?? [];
    const pg = pgs.find((p) => p.instagram_business_account);
    if (pg?.instagram_business_account) return { ...pg.instagram_business_account, token: pg.access_token, pageId: pg.id };
    tentativas.push(`páginas: ${pgs.length} sem Instagram ligado${pgs.length ? ` (${pgs.map((p) => p.name).join(", ").slice(0, 120)})` : ""}`);
  } catch (e) {
    tentativas.push(`páginas: ${(e as Error).message}`);
  }
  throw new Error(`não achei a conta do Instagram na autorização (${tentativas.join("; ")})`.slice(0, 400));
}

/** Pede à Meta para mandar as mensagens do Direct desta conta para o nosso webhook. */
export async function assinarWebhook(token: string, igUserId?: string, pageId?: string | null) {
  const cfg = await getIgConfig();
  if (unificado(cfg) && igUserId) {
    // Com token de Página, a assinatura é feita na Página; com token de usuário do sistema, na conta do Instagram.
    const no = pageId ?? igUserId;
    await jsonOuErro(await fetch(`${FB_GRAPH}/${no}/subscribed_apps?subscribed_fields=messages&access_token=${encodeURIComponent(token)}`, { method: "POST" }));
    return;
  }
  const campos = "messages,messaging_seen,messaging_postbacks,messaging_reactions,messaging_referrals";
  await jsonOuErro(await fetch(`${GRAPH}/me/subscribed_apps?subscribed_fields=${campos}&access_token=${encodeURIComponent(token)}`, { method: "POST" }));
}

/** Cria (ou atualiza) a conexão Instagram no OficinaZap e guarda o token. */
export async function gravarConexao(r: { token: string; igUserId: string; username: string | null; expiresAt: string | null }) {
  const db = supabaseAdmin();
  const instance = `ig:${r.igUserId}`;
  const nome = `Instagram${r.username ? ` @${r.username}` : ""}`;
  let { data: conn } = await db.from("whatsapp_connections").select("id").eq("instance", instance).maybeSingle();
  if (conn) {
    await db.from("whatsapp_connections").update({ name: nome, connected_at: new Date().toISOString() }).eq("id", conn.id);
  } else {
    const ins = await db
      .from("whatsapp_connections")
      .insert({ name: nome, instance, channel: "instagram", phone: null, connected_at: new Date().toISOString() })
      .select("id")
      .single();
    if (ins.error) throw new Error(ins.error.message);
    conn = ins.data;
  }
  const up = await db.from("instagram_tokens").upsert({
    connection_id: conn!.id,
    ig_user_id: r.igUserId,
    username: r.username,
    access_token: r.token,
    expires_at: r.expiresAt,
    updated_at: new Date().toISOString(),
  });
  if (up.error) throw new Error(up.error.message);
  return conn!.id as string;
}

/** Chamada GET na Graph API do Facebook com um token (usada no diagnóstico). */
export async function graphGet(path: string, token: string) {
  const u = new URL(`${FB_GRAPH}/${path.replace(/^\/+/, "")}`);
  u.searchParams.set("access_token", token);
  const res = await fetch(u, { cache: "no-store" });
  return { status: res.status, body: (await res.json().catch(() => null)) as unknown };
}

export async function tokenDaConexao(connectionId: string): Promise<IgToken | null> {
  const { data } = await supabaseAdmin().from("instagram_tokens").select("*").eq("connection_id", connectionId).maybeSingle();
  if (!data) return null;
  const t = data as IgToken;
  // Token do login unificado não vence (expires_at vazio). O do login antigo renova sozinho quando faltam menos de 10 dias para vencer.
  if (t.expires_at && !unificado(await getIgConfig()) && new Date(t.expires_at).getTime() - Date.now() < 10 * 864e5) {
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
    const base = unificado(await getIgConfig()) ? FB_GRAPH : GRAPH;
    const r = await jsonOuErro(await fetch(`${base}/${igsid}?fields=name,username&access_token=${encodeURIComponent(token)}`));
    return { name: (r.name as string) || null, username: (r.username as string) || null };
  } catch {
    return { name: null, username: null };
  }
}

export async function enviarTexto(connectionId: string, igsid: string, text: string): Promise<{ waMessageId?: string }> {
  const t = await tokenDaConexao(connectionId);
  if (!t) throw new Error("Instagram desconectado: conecte de novo na tela WhatsApp");
  const url = unificado(await getIgConfig()) ? `${FB_GRAPH}/${t.ig_user_id}/messages` : `${GRAPH}/me/messages`;
  const r = await jsonOuErro(
    await fetch(url, {
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
