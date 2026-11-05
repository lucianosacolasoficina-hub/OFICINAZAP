import { HttpError, route } from "@/lib/api";
import { MSG_APAGADA, threadIds, type Message } from "@/lib/db";
import { removeMedia } from "@/lib/media";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { whatsapp } from "@/lib/whatsapp";

type Ctx = { params: Promise<{ id: string; msgId: string }> };

/**
 * Apaga uma mensagem da conversa (qualquer atendente que pode abrir a conversa).
 * Mensagem nossa no WhatsApp: apaga para todos (some também do celular do cliente), como no WhatsApp.
 * Mensagem do cliente (ou com `soAqui`): apaga só aqui no OficinaZap; o WhatsApp não deixa apagar a do cliente.
 * No lugar do balão fica "Mensagem apagada".
 */
export const DELETE = route<Ctx>(async (req, { params }) => {
  const { id, msgId } = await params;
  const { soAqui } = ((await req.json().catch(() => ({}))) ?? {}) as { soAqui?: boolean };
  const db = supabaseAdmin();
  const { data: m } = await db.from("messages").select("*").eq("id", msgId).in("conversation_id", await threadIds(id)).maybeSingle();
  const msg = m as Message | null;
  if (!msg) throw new HttpError(404, "mensagem não encontrada");
  if (msg.sender === "system") throw new HttpError(400, "aviso do sistema não pode ser apagado");
  if (msg.body === MSG_APAGADA && !msg.media_type) return { ...msg, paraTodos: false };

  let paraTodos = false;
  if (!soAqui && msg.direction === "out" && msg.wa_message_id) {
    const { data: c } = await db
      .from("conversations")
      .select("contact:contacts(phone, is_group), connection:whatsapp_connections(instance, channel)")
      .eq("id", msg.conversation_id)
      .maybeSingle();
    const conv = c as unknown as { contact: { phone: string; is_group: boolean } | null; connection: { instance: string; channel?: string } | null } | null;
    const canal = conv?.connection?.channel;
    if (conv?.contact && canal !== "instagram" && canal !== "messenger" && canal !== "email") {
      const zap = whatsapp(conv.connection?.instance);
      if (!zap.deleteForEveryone) throw new HttpError(400, "esta conexão não permite apagar para todos. Use \"Apagar só aqui\".");
      const { phone, is_group } = conv.contact;
      try {
        await zap.deleteForEveryone({ id: msg.wa_message_id, remoteJid: is_group ? `${phone}@g.us` : `${phone}@s.whatsapp.net`, fromMe: true });
      } catch (err) {
        console.error("apagar para todos", err);
        throw new HttpError(
          502,
          "O WhatsApp não deixou apagar para todos (ele só permite nas primeiras horas depois do envio, ou o número está desconectado). Se quiser, apague só aqui no OficinaZap.",
        );
      }
      paraTodos = true;
    }
  }

  if (msg.media_url) await removeMedia(msg.media_url).catch(() => {});
  const { data: atualizada, error } = await db
    .from("messages")
    .update({ body: MSG_APAGADA, media_type: null, media_url: null, transcricao: null })
    .eq("id", msg.id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return { ...(atualizada as Message), paraTodos };
});
