import { HttpError, route, type IdCtx } from "@/lib/api";
import { addMessage, setMessageMedia, threadIds, updateConversation, type Conversation } from "@/lib/db";
import { saveMedia } from "@/lib/media";
import { apagarRascunho, arquivoDoRascunho, lerRascunho, type Rascunho } from "@/lib/rascunhos";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { whatsapp, type MediaFile } from "@/lib/whatsapp";
import { enviarTexto, IG_PREFIX } from "@/lib/instagram";
import { enviarEmail, MAIL_PREFIX } from "@/lib/email";
import { contaImap, enviarImap } from "@/lib/emailImap";
import { enviarMessenger, FB_PREFIX } from "@/lib/messenger";

// Atendente envia uma mensagem. Ao responder, ele assume a conversa e a IA para de responder nela.
export const POST = route<IdCtx>(async (req, { params }, userId) => {
  const { id } = await params;
  const { body, image, document, rascunho } = (await req.json()) as {
    body?: string;
    image?: { data?: string; mimeType?: string };
    document?: { data?: string; mimeType?: string; name?: string };
    rascunho?: string;
  };
  const text = body?.trim() ?? "";
  // Foto colada (Ctrl+V de um recorte de tela) ou escolhida no 📎; o texto vira a legenda.
  let foto: MediaFile | null =
    image?.data && /^image\/(png|jpeg|webp|gif)$/.test(image.mimeType ?? "")
      ? { data: Buffer.from(image.data, "base64"), mimeType: image.mimeType! }
      : null;
  if (image && !foto) throw new HttpError(400, "formato de imagem não suportado (use PNG, JPG, WEBP ou GIF)");
  if (foto && foto.data.length > 10 * 1024 * 1024) throw new HttpError(400, "imagem muito grande (máximo 10 MB)");
  // Arquivo (PDF, Excel…) escolhido no 📎; o texto vira a legenda.
  let doc: (MediaFile & { nome: string }) | null = document?.data && DOC_MIMES.has(document.mimeType ?? "") ? { data: Buffer.from(document.data, "base64"), mimeType: document.mimeType!, nome: nomeArquivo(document.name, document.mimeType!) } : null;
  if (document && !doc) throw new HttpError(400, "tipo de arquivo não aceito (use PDF, Excel, Word ou CSV)");
  if (doc && doc.data.length > 15 * 1024 * 1024) throw new HttpError(400, "arquivo muito grande (máximo 15 MB)");
  // Rascunho deixado pelo sistema de gestão (proposta, pedido, OS… em PDF): o arquivo já está guardado aqui.
  let rasc: Rascunho | null = null;
  if (rascunho) {
    rasc = await lerRascunho(rascunho);
    if (!rasc) throw new HttpError(404, "esse rascunho não existe mais (já foi enviado ou venceu). Gere de novo no sistema.");
    const f = await arquivoDoRascunho(rasc);
    if (rasc.arquivo && !f) throw new HttpError(404, "o arquivo do rascunho não foi encontrado. Gere de novo no sistema.");
    if (f) {
      if (/^image\/(png|jpeg|webp)$/.test(f.mimeType)) foto = { data: f.data, mimeType: f.mimeType };
      else doc = { data: f.data, mimeType: f.mimeType, nome: f.nome };
    }
  }
  if (foto && doc) doc = null;
  if (!text && !foto && !doc) throw new HttpError(400, "mensagem vazia");

  const { data, error } = await supabaseAdmin()
    .from("conversations")
    .select("*, contact:contacts(phone, is_group), connection:whatsapp_connections(id, instance, channel)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new HttpError(404, "conversa não encontrada");
  const conversation = data as Conversation & { contact: { phone: string; is_group: boolean }; connection: { id: string; instance: string; channel?: string } | null };

  // Responde pelo mesmo número de WhatsApp em que o cliente escreveu.
  const { phone, is_group } = conversation.contact;
  const canal = conversation.connection?.channel;
  if ((foto || doc) && (canal === "instagram" || canal === "messenger" || canal === "email")) {
    throw new HttpError(400, "por enquanto o envio de imagem e arquivo funciona só nas conversas de WhatsApp");
  }
  const destino = is_group ? `${phone}@g.us` : phone;
  const sent = foto
    ? await whatsapp(conversation.connection?.instance).sendImage(destino, foto, text || undefined)
    : doc
    ? await whatsapp(conversation.connection?.instance).sendDocument(destino, doc, doc.nome, text || undefined)
    : conversation.connection?.channel === "instagram"
      ? await enviarTexto(conversation.connection.id, phone.slice(IG_PREFIX.length), text)
      : conversation.connection?.channel === "messenger"
      ? await enviarMessenger(conversation.connection.id, phone.slice(FB_PREFIX.length), text)
      : conversation.connection?.channel === "email"
      ? await enviarPorEmail(conversation.connection.id, phone.slice(MAIL_PREFIX.length), text, await threadIds(id))
      : await whatsapp(conversation.connection?.instance).sendText(is_group ? `${phone}@g.us` : phone, text);
  if (conversation.status !== "open" || conversation.assigned_to !== userId) {
    await updateConversation(id, { status: "open", assigned_to: userId });
  }
  const msg = await addMessage(id, {
    direction: "out",
    sender: "agent",
    agent_id: userId,
    body: doc && !text ? `📄 ${doc.nome}` : text,
    ...(foto && { media_type: "image" }),
    ...(doc && { media_type: "document" }),
    wa_message_id: sent.waMessageId ?? null,
  });
  // Guarda o arquivo enviado para ele aparecer na conversa (se falhar, o arquivo já foi para o cliente).
  const guardar = foto ?? doc;
  if (msg && guardar) {
    const path = await saveMedia(id, msg.id, guardar).catch(() => null);
    if (path) {
      await setMessageMedia(msg.id, path).catch(() => {});
      msg.media_url = path;
    }
  }
  if (rasc) await apagarRascunho(rasc.id).catch(() => {});
  return msg;
});

const DOC_MIMES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv",
]);
const DOC_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/csv": "csv",
};
function nomeArquivo(nome: string | undefined, mime: string) {
  const limpo = String(nome || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const ext = DOC_EXT[mime] ?? "bin";
  if (!limpo) return `arquivo.${ext}`;
  return limpo.toLowerCase().endsWith("." + ext) ? limpo : `${limpo}.${ext}`;
}

// Só as mensagens novas desde `after` (a tela pergunta a cada poucos segundos, sem baixar tudo de novo).
export const GET = route<IdCtx>(async (req, { params }) => {
  const { id } = await params;
  const after = new URL(req.url).searchParams.get("after");
  const ids = await threadIds(id);
  let q = supabaseAdmin().from("messages").select("*").in("conversation_id", ids).order("created_at", { ascending: true }).limit(200);
  if (after) q = q.gt("created_at", after);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
});

/** E-mail: Gmail/IMAP (senha de app) ou Outlook (Microsoft). */
async function enviarPorEmail(connectionId: string, para: string, texto: string, ids: string[]) {
  const c = await contaImap(connectionId);
  return c ? enviarImap(c, para, texto, ids) : enviarEmail(connectionId, para, texto, ids);
}
