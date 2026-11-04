import { HttpError, route, type IdCtx } from "@/lib/api";
import { addMessage, setMessageMedia, threadIds, updateConversation, type Conversation } from "@/lib/db";
import { saveMedia } from "@/lib/media";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { whatsapp } from "@/lib/whatsapp";
import { enviarTexto, IG_PREFIX } from "@/lib/instagram";
import { enviarEmail, MAIL_PREFIX } from "@/lib/email";
import { contaImap, enviarImap } from "@/lib/emailImap";
import { enviarMessenger, FB_PREFIX } from "@/lib/messenger";

// Atendente envia uma mensagem. Ao responder, ele assume a conversa e a IA para de responder nela.
export const POST = route<IdCtx>(async (req, { params }, userId) => {
  const { id } = await params;
  const { body, image } = (await req.json()) as { body?: string; image?: { data?: string; mimeType?: string } };
  const text = body?.trim() ?? "";
  // Foto colada (Ctrl+V de um recorte de tela) ou escolhida no 📎; o texto vira a legenda.
  const foto =
    image?.data && /^image\/(png|jpeg|webp|gif)$/.test(image.mimeType ?? "")
      ? { data: Buffer.from(image.data, "base64"), mimeType: image.mimeType! }
      : null;
  if (image && !foto) throw new HttpError(400, "formato de imagem não suportado (use PNG, JPG, WEBP ou GIF)");
  if (foto && foto.data.length > 10 * 1024 * 1024) throw new HttpError(400, "imagem muito grande (máximo 10 MB)");
  if (!text && !foto) throw new HttpError(400, "mensagem vazia");

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
  if (foto && (canal === "instagram" || canal === "messenger" || canal === "email")) {
    throw new HttpError(400, "por enquanto o envio de imagem funciona só nas conversas de WhatsApp");
  }
  const sent = foto
    ? await whatsapp(conversation.connection?.instance).sendImage(is_group ? `${phone}@g.us` : phone, foto, text || undefined)
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
    body: text,
    ...(foto && { media_type: "image" }),
    wa_message_id: sent.waMessageId ?? null,
  });
  // Guarda a foto enviada para ela aparecer na conversa (se falhar, a foto já foi para o cliente).
  if (msg && foto) {
    const path = await saveMedia(id, msg.id, foto).catch(() => null);
    if (path) {
      await setMessageMedia(msg.id, path).catch(() => {});
      msg.media_url = path;
    }
  }
  return msg;
});

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
