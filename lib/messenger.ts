import { supabaseAdmin } from "./supabase/admin";
import { FB_GRAPH, tokenDaConexao } from "./instagram";

// Messenger da Página do Facebook. Usa o mesmo token da Página guardado na ligação do Instagram
// (tabela instagram_tokens, com ig_user_id = id da Página). Contatos ficam com "fb:" + id do cliente na Página.
export const FB_PREFIX = "fb:";

async function jsonOuErro(res: Response) {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string } };
  if (!res.ok || body.error) throw new Error(`Messenger: ${body.error?.message ?? `erro ${res.status}`}`);
  return body;
}

/** Cria (ou atualiza) a conexão "Facebook" do OficinaZap para a Página e guarda o token da Página. */
export async function gravarConexaoMessenger(r: { token: string; pageId: string; pageName: string | null }) {
  const db = supabaseAdmin();
  const instance = `fb:${r.pageId}`;
  const nome = `Facebook${r.pageName ? ` ${r.pageName}` : ""}`;
  let { data: conn } = await db.from("whatsapp_connections").select("id").eq("instance", instance).maybeSingle();
  if (conn) {
    await db.from("whatsapp_connections").update({ name: nome, connected_at: new Date().toISOString() }).eq("id", conn.id);
  } else {
    const ins = await db
      .from("whatsapp_connections")
      .insert({ name: nome, instance, channel: "messenger", phone: null, connected_at: new Date().toISOString() })
      .select("id")
      .single();
    if (ins.error) throw new Error(ins.error.message);
    conn = ins.data;
  }
  const up = await db.from("instagram_tokens").upsert({
    connection_id: conn!.id,
    ig_user_id: r.pageId,
    username: r.pageName,
    access_token: r.token,
    expires_at: null,
    updated_at: new Date().toISOString(),
  });
  if (up.error) throw new Error(up.error.message);
  return conn!.id as string;
}

export async function enviarMessenger(connectionId: string, psid: string, text: string): Promise<{ waMessageId?: string }> {
  const t = await tokenDaConexao(connectionId);
  if (!t) throw new Error("Facebook desconectado: conecte de novo na tela WhatsApp");
  const r = await jsonOuErro(
    await fetch(`${FB_GRAPH}/${t.ig_user_id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${t.access_token}` },
      body: JSON.stringify({ recipient: { id: psid }, messaging_type: "RESPONSE", message: { text: text.slice(0, 2000) } }),
    }),
  );
  return { waMessageId: (r.message_id as string) ?? undefined };
}

/** Nome de quem mandou mensagem para a Página. */
export async function perfilMessenger(token: string, psid: string): Promise<string | null> {
  try {
    const r = await jsonOuErro(await fetch(`${FB_GRAPH}/${psid}?fields=name,first_name,last_name&access_token=${encodeURIComponent(token)}`));
    return (r.name as string) || [r.first_name, r.last_name].filter(Boolean).join(" ") || null;
  } catch {
    return null;
  }
}
