import { createHash, randomBytes } from "node:crypto";
import { activeConversation, addMessage, setMessageMedia, upsertContact } from "./db";
import { saveMedia } from "./media";
import { supabaseAdmin } from "./supabase/admin";

// E-mail do Outlook pessoal pela API oficial da Microsoft (Microsoft Graph).
// Cada e-mail vira mensagem de uma conversa com o remetente, na mesma tela das conversas do WhatsApp.

const GRAPH = "https://graph.microsoft.com/v1.0";
export const MAIL_PREFIX = "mail:";
export const MAIL_SCOPES = ["offline_access", "User.Read", "Mail.ReadWrite", "Mail.Send"];
export const EMAIL_BASE = process.env.IG_BASE_URL || "https://zap.sacolasoficina.com.br";
export const emailUrl = (path: string) => new URL(path, EMAIL_BASE).toString();

export type EmailConfig = { client_id: string | null; client_secret: string | null; tenant: string };
type Tok = {
  connection_id: string;
  address: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  delta_inbox: string | null;
  delta_sent: string | null;
};

export async function getEmailConfig(): Promise<EmailConfig> {
  const { data } = await supabaseAdmin().from("email_config").select("client_id, client_secret, tenant").eq("id", 1).maybeSingle();
  return (data as EmailConfig) ?? { client_id: null, client_secret: null, tenant: "consumers" };
}

export async function saveEmailConfig(p: { client_id?: string; client_secret?: string; tenant?: string }) {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (p.client_id !== undefined) patch.client_id = p.client_id.trim() || null;
  if (p.client_secret !== undefined && p.client_secret.trim()) patch.client_secret = p.client_secret.trim();
  if (p.tenant && /^(consumers|common|organizations|[0-9a-f-]{36})$/.test(p.tenant)) patch.tenant = p.tenant;
  const { error } = await supabaseAdmin().from("email_config").update(patch).eq("id", 1);
  if (error) throw new Error(error.message);
}

const authBase = (cfg: EmailConfig) => `https://login.microsoftonline.com/${cfg.tenant || "consumers"}/oauth2/v2.0`;

/** Sem segredo: o app funciona como "cliente público" e a troca do código é protegida por PKCE. */
export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function urlAutorizacaoEmail(cfg: EmailConfig, state: string, challenge?: string) {
  const u = new URL(`${authBase(cfg)}/authorize`);
  u.searchParams.set("client_id", cfg.client_id ?? "");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", emailUrl("/api/email/callback"));
  u.searchParams.set("response_mode", "query");
  u.searchParams.set("scope", MAIL_SCOPES.join(" "));
  u.searchParams.set("prompt", "select_account");
  u.searchParams.set("state", state);
  if (challenge) {
    u.searchParams.set("code_challenge", challenge);
    u.searchParams.set("code_challenge_method", "S256");
  }
  return u.toString();
}

async function token(cfg: EmailConfig, form: Record<string, string>) {
  const r = await fetch(`${authBase(cfg)}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.client_id ?? "", ...(cfg.client_secret ? { client_secret: cfg.client_secret } : {}), scope: MAIL_SCOPES.join(" "), ...form }),
  });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!r.ok || !j.access_token) throw new Error(`Microsoft: ${j.error_description?.split("\n")[0] ?? j.error ?? r.status}`);
  return { access: j.access_token, refresh: j.refresh_token ?? form.refresh_token ?? "", expiresAt: new Date(Date.now() + (j.expires_in ?? 3600) * 1000 - 60000).toISOString() };
}

export async function trocarCodigoEmail(cfg: EmailConfig, code: string, verifier?: string) {
  const t = await token(cfg, { grant_type: "authorization_code", code, redirect_uri: emailUrl("/api/email/callback"), ...(verifier ? { code_verifier: verifier } : {}) });
  const me = (await (await fetch(`${GRAPH}/me?$select=mail,userPrincipalName,displayName`, { headers: { Authorization: `Bearer ${t.access}` } })).json()) as {
    mail?: string;
    userPrincipalName?: string;
    displayName?: string;
  };
  const address = (me.mail || me.userPrincipalName || "").toLowerCase();
  if (!address) throw new Error("não consegui ler o endereço de e-mail da conta");
  return { ...t, address, name: me.displayName ?? null };
}

async function tokValido(t: Tok): Promise<string> {
  if (new Date(t.expires_at).getTime() > Date.now()) return t.access_token;
  const cfg = await getEmailConfig();
  const n = await token(cfg, { grant_type: "refresh_token", refresh_token: t.refresh_token });
  t.access_token = n.access;
  t.refresh_token = n.refresh || t.refresh_token;
  t.expires_at = n.expiresAt;
  await supabaseAdmin()
    .from("email_tokens")
    .update({ access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at, updated_at: new Date().toISOString() })
    .eq("connection_id", t.connection_id);
  return t.access_token;
}

async function graph<T>(t: Tok, url: string, init?: RequestInit): Promise<T> {
  const access = await tokValido(t);
  const r = await fetch(url.startsWith("http") ? url : `${GRAPH}${url}`, {
    ...init,
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json", Prefer: 'outlook.body-content-type="text"', ...(init?.headers ?? {}) },
  });
  if (r.status === 202 || r.status === 204) return {} as T;
  const j = (await r.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!r.ok) throw new Error(`Outlook: ${j.error?.message ?? r.status}`);
  return j;
}

type GMsg = {
  id: string;
  internetMessageId?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { content?: string };
  from?: { emailAddress?: { address?: string; name?: string } };
  toRecipients?: { emailAddress?: { address?: string; name?: string } }[];
  receivedDateTime?: string;
  sentDateTime?: string;
  hasAttachments?: boolean;
  isDraft?: boolean;
  "@removed"?: unknown;
};

const limpar = (s: string) =>
  s
    .replace(/\r/g, "")
    // Corta o histórico citado ("Em ... escreveu:" / "From: ...") para a conversa não repetir tudo.
    .split(/\n(?:Em .{5,120} escreveu:|On .{5,120} wrote:|De: .+\nEnviado:|From: .+\nSent:|-{2,} ?Mensagem original|_{10,})/)[0]
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 20000);

async function guardar(t: Tok, conn: { id: string; department_id: string | null }, m: GMsg, deMim: boolean) {
  if (m["@removed"] || m.isDraft) return;
  const wa = `mail:${m.internetMessageId ?? m.id}`;
  const db = supabaseAdmin();
  const { data: ja } = await db.from("messages").select("id").eq("wa_message_id", wa).maybeSingle();
  if (ja) return;
  const outro = deMim ? m.toRecipients?.[0]?.emailAddress : m.from?.emailAddress;
  const addr = outro?.address?.toLowerCase();
  if (!addr || addr === t.address) return;
  const contato = await upsertContact(MAIL_PREFIX + addr, outro?.name && outro.name !== outro.address ? outro.name : addr);
  const quando0 = m.receivedDateTime ?? m.sentDateTime ?? new Date().toISOString();
  const antigo0 = Date.now() - new Date(quando0).getTime() > 2 * 864e5;
  // Usa a conversa mais recente desse remetente nesta caixa (mesmo encerrada); e-mail novo do cliente reabre.
  const { data: ex } = await db
    .from("conversations")
    .select("*")
    .eq("contact_id", contato.id)
    .eq("connection_id", conn.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  let conversa = ex as { id: string; status: string } | null;
  if (conversa && conversa.status === "closed" && !deMim && !antigo0) {
    await db.from("conversations").update({ status: "waiting" }).eq("id", conversa.id);
  }
  if (!conversa) {
    conversa = antigo0
      ? (await db.from("conversations").insert({ contact_id: contato.id, connection_id: conn.id, department_id: conn.department_id, status: "closed" }).select("*").single()).data
      : await activeConversation(contato.id, false, conn);
  }
  if (!conversa) return;
  const texto = `✉️ ${m.subject?.trim() || "(sem assunto)"}\n\n${limpar(m.body?.content ?? m.bodyPreview ?? "")}`;
  const salvo = await addMessage(conversa.id, {
    direction: deMim ? "out" : "in",
    sender: deMim ? "agent" : "contact",
    body: texto,
    media_type: m.hasAttachments ? "document" : null,
    wa_message_id: wa,
  });
  if (!salvo) return;
  const quando = m.receivedDateTime ?? m.sentDateTime;
  if (quando) {
    await db.from("messages").update({ created_at: quando }).eq("id", salvo.id);
    // Data da conversa = e-mail mais recente; e-mail antigo (mais de 2 dias) não fica "aguardando resposta".
    const { data: mx } = await db.from("messages").select("created_at").eq("conversation_id", conversa.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const antigo = Date.now() - new Date(quando).getTime() > 2 * 864e5;
    await db
      .from("conversations")
      .update({
        last_message_at: mx?.created_at ?? quando,
        ...(antigo ? { waiting_since: null, unread_count: 0 } : {}),
      })
      .eq("id", conversa.id);
  }
  // Guarda o primeiro anexo (até 15 MB) para abrir pela conversa; os demais ficam listados no texto.
  if (m.hasAttachments) {
    try {
      const at = await graph<{ value: { name: string; contentType: string; contentBytes?: string; size: number; isInline?: boolean }[] }>(
        t,
        `/me/messages/${m.id}/attachments?$select=name,contentType,size,isInline`,
      );
      const arqs = at.value.filter((a) => !a.isInline);
      if (arqs.length) {
        await db.from("messages").update({ body: `${texto}\n\n📎 ${arqs.map((a) => a.name).join(", ")}` }).eq("id", salvo.id);
        const primeiro = arqs[0];
        if (primeiro.size <= 15 * 1024 * 1024) {
          const full = await graph<{ value: { name: string; contentType: string; contentBytes?: string }[] }>(t, `/me/messages/${m.id}/attachments`);
          const b = full.value.find((x) => x.name === primeiro.name);
          if (b?.contentBytes) {
            const path = await saveMedia(conversa.id, salvo.id, { data: Buffer.from(b.contentBytes, "base64"), mimeType: b.contentType || "application/octet-stream" }).catch(() => null);
            if (path) await setMessageMedia(salvo.id, path);
          }
        }
      }
    } catch (e) {
      console.error("anexo do e-mail", e);
    }
  }
}

/** Busca os e-mails novos (entrada e enviados) desde a última vez, usando o "delta" do Graph. */
export async function sincronizarEmail(connectionId: string, primeiraVezDias = 30) {
  const db = supabaseAdmin();
  const { data } = await db.from("email_tokens").select("*").eq("connection_id", connectionId).maybeSingle();
  if (!data) return { novos: 0 };
  const t = data as Tok;
  const { data: conn } = await db.from("whatsapp_connections").select("id, department_id").eq("id", connectionId).maybeSingle();
  if (!conn) return { novos: 0 };
  let novos = 0;
  const desde = new Date(Date.now() - primeiraVezDias * 864e5).toISOString();
  const campos = "$select=id,internetMessageId,subject,bodyPreview,body,from,toRecipients,receivedDateTime,sentDateTime,hasAttachments,isDraft";
  try {
    for (const [pasta, col, deMim] of [
      ["inbox", "delta_inbox", false],
      ["sentitems", "delta_sent", true],
    ] as const) {
      let url: string | null =
        (t[col] as string | null) ??
        `${GRAPH}/me/mailFolders/${pasta}/messages/delta?${campos}&$filter=${encodeURIComponent(`receivedDateTime ge ${desde}`)}`;
      let delta: string | null = null;
      for (let pag = 0; url && pag < 50; pag++) {
        const r: { value: GMsg[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string } = await graph(t, url, { headers: { Prefer: 'odata.maxpagesize=50, outlook.body-content-type="text"' } });
        const lista = [...r.value].sort((a, b) => String(a.receivedDateTime ?? a.sentDateTime).localeCompare(String(b.receivedDateTime ?? b.sentDateTime)));
        for (const m of lista) {
          try {
            await guardar(t, conn, m, deMim);
            novos++;
          } catch (e) {
            console.error("e-mail", m.id, e);
          }
        }
        url = r["@odata.nextLink"] ?? null;
        delta = r["@odata.deltaLink"] ?? delta;
      }
      if (delta) await db.from("email_tokens").update({ [col]: delta }).eq("connection_id", connectionId);
    }
    await db.from("email_tokens").update({ last_sync: new Date().toISOString(), last_error: null }).eq("connection_id", connectionId);
  } catch (e) {
    await db.from("email_tokens").update({ last_sync: new Date().toISOString(), last_error: (e as Error).message.slice(0, 300) }).eq("connection_id", connectionId);
    throw e;
  }
  return { novos };
}

let rodando = false;
/** Sincroniza todas as contas de e-mail (chamado a cada minuto pelo servidor). */
export async function sincronizarTodos() {
  if (rodando) return;
  rodando = true;
  try {
    const { data } = await supabaseAdmin().from("email_tokens").select("connection_id");
    for (const r of data ?? []) await sincronizarEmail(r.connection_id as string).catch((e) => console.error("sync e-mail", e));
  } finally {
    rodando = false;
  }
}

/** Responde o cliente: continua o último e-mail dele (mesmo assunto) ou manda um novo. */
export async function enviarEmail(connectionId: string, para: string, texto: string, conversationIds: string[]) {
  const db = supabaseAdmin();
  const { data } = await db.from("email_tokens").select("*").eq("connection_id", connectionId).maybeSingle();
  if (!data) throw new Error("Outlook desconectado: conecte de novo na tela WhatsApp");
  const t = data as Tok;
  const { data: ult } = await db
    .from("messages")
    .select("wa_message_id, body")
    .in("conversation_id", conversationIds)
    .eq("direction", "in")
    .like("wa_message_id", "mail:%")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const assuntoAnt = ult?.body?.match(/^✉️ (.+)/)?.[1];
  let msgId: string | null = null;
  if (ult?.wa_message_id) {
    const imid = ult.wa_message_id.slice(5);
    const busca = await graph<{ value: { id: string }[] }>(t, `/me/messages?$select=id&$filter=${encodeURIComponent(`internetMessageId eq '${imid.replace(/'/g, "''")}'`)}`).catch(() => ({ value: [] }));
    msgId = busca.value[0]?.id ?? null;
  }
  // Cria o rascunho (resposta no mesmo assunto ou e-mail novo) e envia: assim já sabemos o id do e-mail e não duplica.
  const rascunho = msgId
    ? await graph<{ id: string; internetMessageId?: string }>(t, `/me/messages/${msgId}/createReply`, { method: "POST", body: JSON.stringify({ comment: texto }) })
    : await graph<{ id: string; internetMessageId?: string }>(t, `/me/messages`, {
        method: "POST",
        body: JSON.stringify({
          subject: assuntoAnt ? `Re: ${assuntoAnt.replace(/^re:\s*/i, "")}` : "Sacolas Oficina",
          body: { contentType: "Text", content: texto },
          toRecipients: [{ emailAddress: { address: para } }],
        }),
      });
  await graph(t, `/me/messages/${rascunho.id}/send`, { method: "POST" });
  return { waMessageId: rascunho.internetMessageId ? `mail:${rascunho.internetMessageId}` : undefined };
}
