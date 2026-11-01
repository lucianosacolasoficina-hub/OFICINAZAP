import { ImapFlow } from "imapflow";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import nodemailer from "nodemailer";
import { supabaseAdmin } from "./supabase/admin";
import { guardarEmail, type Anexos, type GMsg } from "./email";

// Gmail (ou outro e-mail com IMAP/SMTP) por senha de app: cada colaborador liga a própria caixa.
// Recebe pelo IMAP (entrada e enviados) e envia pelo SMTP; os e-mails entram nas mesmas conversas do e-mail.

export type ImapConta = {
  connection_id: string;
  address: string;
  password: string;
  imap_host: string;
  smtp_host: string;
  uid_inbox: number | null;
  uid_sent: number | null;
  uidv_inbox: number | null;
  uidv_sent: number | null;
};

const PRIMEIRA_VEZ_DIAS = 30;
const MAX_POR_VEZ = 200;

/** Gmail mostra a senha de app em 4 blocos ("abcd efgh ijkl mnop"): tira os espaços. */
export const limparSenhaApp = (s: string) => s.replace(/\s+/g, "");

function cliente(c: Pick<ImapConta, "address" | "password" | "imap_host">) {
  return new ImapFlow({ host: c.imap_host, port: 993, secure: true, auth: { user: c.address, pass: c.password }, logger: false });
}

/** Confere usuário e senha de app antes de salvar. */
export async function testarLogin(c: Pick<ImapConta, "address" | "password" | "imap_host">) {
  const cl = cliente(c);
  try {
    await cl.connect();
  } catch (e) {
    const msg = (e as { responseText?: string; message?: string }).responseText ?? (e as Error).message;
    throw new Error(
      /AUTHENTICATIONFAILED|Invalid credentials|auth/i.test(msg)
        ? "o Google recusou o e-mail ou a senha de app. Confira se copiou a senha de app (16 letras) da conta certa"
        : `não consegui entrar no e-mail: ${msg}`,
    );
  } finally {
    await cl.logout().catch(() => {});
  }
}

function endereco(a: AddressObject | AddressObject[] | undefined) {
  const v = (Array.isArray(a) ? a[0] : a)?.value?.[0];
  return v?.address ? { address: v.address, name: v.name || undefined } : undefined;
}

function paraGMsg(p: ParsedMail, data: Date | undefined): GMsg {
  const id = p.messageId || `${p.date?.toISOString() ?? ""}-${p.subject ?? ""}`;
  const quando = (p.date ?? data ?? new Date()).toISOString();
  const anexos = p.attachments.filter((a) => a.contentDisposition !== "inline" || !a.related);
  return {
    id,
    internetMessageId: id,
    subject: p.subject,
    body: { content: p.text ?? "" },
    bodyPreview: (p.text ?? "").slice(0, 200),
    from: { emailAddress: endereco(p.from) },
    toRecipients: [{ emailAddress: endereco(p.to) }],
    receivedDateTime: quando,
    sentDateTime: quando,
    hasAttachments: anexos.length > 0,
  };
}

function anexosDe(p: ParsedMail): Anexos {
  const arqs = p.attachments.filter((a) => a.contentDisposition !== "inline" || !a.related);
  const primeiro = arqs[0];
  return {
    nomes: arqs.map((a, i) => a.filename || `anexo-${i + 1}`),
    primeiro: primeiro && primeiro.size <= 15 * 1024 * 1024 ? { data: primeiro.content, mimeType: primeiro.contentType || "application/octet-stream" } : null,
  };
}

/** Busca os e-mails novos da conta (entrada e enviados) desde o último UID lido. */
export async function sincronizarImap(connectionId: string) {
  const db = supabaseAdmin();
  const { data } = await db.from("email_imap").select("*").eq("connection_id", connectionId).maybeSingle();
  if (!data) return { novos: 0 };
  const c = data as ImapConta;
  const { data: conn } = await db.from("whatsapp_connections").select("id, department_id").eq("id", connectionId).maybeSingle();
  if (!conn) return { novos: 0 };
  const cl = cliente(c);
  let novos = 0;
  try {
    await cl.connect();
    const pastas = await cl.list();
    const enviados = pastas.find((p) => p.specialUse === "\\Sent")?.path;
    const alvos: { path: string; deMim: boolean; uidCol: "uid_inbox" | "uid_sent"; uidvCol: "uidv_inbox" | "uidv_sent" }[] = [
      { path: "INBOX", deMim: false, uidCol: "uid_inbox", uidvCol: "uidv_inbox" },
      ...(enviados ? [{ path: enviados, deMim: true, uidCol: "uid_sent" as const, uidvCol: "uidv_sent" as const }] : []),
    ];
    for (const alvo of alvos) {
      const lock = await cl.getMailboxLock(alvo.path);
      try {
        const box = cl.mailbox;
        const uidv = box ? Number(box.uidValidity) : null;
        let ultimo = c[alvo.uidvCol] && uidv && Number(c[alvo.uidvCol]) === uidv ? Number(c[alvo.uidCol] ?? 0) : 0;
        let uids: number[];
        if (ultimo > 0) {
          const r = await cl.search({ uid: `${ultimo + 1}:*` }, { uid: true });
          uids = (r || []).filter((u) => u > ultimo);
        } else {
          const r = await cl.search({ since: new Date(Date.now() - PRIMEIRA_VEZ_DIAS * 864e5) }, { uid: true });
          uids = r || [];
        }
        uids.sort((a, b) => a - b);
        // Primeira leitura: só os mais recentes, para não travar.
        const lote = uids.slice(-MAX_POR_VEZ);
        for (const uid of lote) {
          try {
            const msg = await cl.fetchOne(String(uid), { source: true, internalDate: true }, { uid: true });
            if (msg && msg.source) {
              const p = await simpleParser(msg.source);
              const internal = msg.internalDate ? new Date(msg.internalDate) : undefined;
              await guardarEmail(c.address, conn, paraGMsg(p, internal), alvo.deMim, async () => anexosDe(p));
              novos++;
            }
          } catch (e) {
            console.error("e-mail imap", c.address, uid, e);
          }
          ultimo = Math.max(ultimo, uid);
        }
        if (!lote.length && uids.length === 0 && box && !c[alvo.uidCol]) ultimo = Math.max(0, Number(box.uidNext ?? 1) - 1);
        await db.from("email_imap").update({ [alvo.uidCol]: ultimo || null, [alvo.uidvCol]: uidv }).eq("connection_id", connectionId);
      } finally {
        lock.release();
      }
    }
    await db.from("email_imap").update({ last_sync: new Date().toISOString(), last_error: null }).eq("connection_id", connectionId);
  } catch (e) {
    await db.from("email_imap").update({ last_sync: new Date().toISOString(), last_error: (e as Error).message.slice(0, 300) }).eq("connection_id", connectionId);
    throw e;
  } finally {
    await cl.logout().catch(() => {});
  }
  return { novos };
}

let rodando = false;
/** Sincroniza todas as caixas Gmail/IMAP (chamado a cada minuto pelo servidor). */
export async function sincronizarTodosImap() {
  if (rodando) return;
  rodando = true;
  try {
    const { data } = await supabaseAdmin().from("email_imap").select("connection_id");
    for (const r of data ?? []) await sincronizarImap(r.connection_id as string).catch((e) => console.error("sync imap", e));
  } finally {
    rodando = false;
  }
}

export async function contaImap(connectionId: string) {
  const { data } = await supabaseAdmin().from("email_imap").select("*").eq("connection_id", connectionId).maybeSingle();
  return (data as ImapConta | null) ?? null;
}

/** Responde pelo SMTP: continua o último e-mail do cliente (mesmo assunto) ou manda um novo. */
export async function enviarImap(c: ImapConta, para: string, texto: string, conversationIds: string[]) {
  const db = supabaseAdmin();
  const { data: ult } = await db
    .from("messages")
    .select("wa_message_id, body")
    .in("conversation_id", conversationIds)
    .eq("direction", "in")
    .like("wa_message_id", "mail:%")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const assuntoAnt = ult?.body?.match(/^✉️ (.+)/)?.[1]?.trim();
  const refId = ult?.wa_message_id?.slice(5);
  const transp = nodemailer.createTransport({ host: c.smtp_host, port: 465, secure: true, auth: { user: c.address, pass: c.password } });
  const info = await transp.sendMail({
    from: c.address,
    to: para,
    subject: assuntoAnt && assuntoAnt !== "(sem assunto)" ? `Re: ${assuntoAnt.replace(/^re:\s*/i, "")}` : "Sacolas Oficina",
    text: texto,
    ...(refId && refId.startsWith("<") ? { inReplyTo: refId, references: [refId] } : {}),
  });
  return { waMessageId: info.messageId ? `mail:${info.messageId}` : undefined };
}
