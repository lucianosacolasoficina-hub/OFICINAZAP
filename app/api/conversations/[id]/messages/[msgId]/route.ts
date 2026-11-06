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

/**
 * Funções do balão, como no WhatsApp:
 *  - `favorita`: marca/desmarca com estrela (só no OficinaZap);
 *  - `reacao`: reage com um emoji (vai para o WhatsApp do cliente; vazio tira a reação);
 *  - `texto`: edita uma mensagem de texto nossa (o WhatsApp deixa por 15 minutos).
 */
export const PATCH = route<Ctx>(async (req, { params }) => {
  const { id, msgId } = await params;
  const body = ((await req.json().catch(() => ({}))) ?? {}) as { favorita?: boolean; reacao?: string; texto?: string };
  const db = supabaseAdmin();
  const { data: m } = await db.from("messages").select("*").eq("id", msgId).in("conversation_id", await threadIds(id)).maybeSingle();
  const msg = m as Message | null;
  if (!msg) throw new HttpError(404, "mensagem não encontrada");
  if (msg.sender === "system") throw new HttpError(400, "aviso do sistema não tem estas opções");
  const patch: Record<string, unknown> = {};

  if (typeof body.favorita === "boolean") patch.favorita = body.favorita;

  if (body.reacao !== undefined || body.texto !== undefined) {
    if (!msg.wa_message_id) throw new HttpError(400, "esta mensagem não está no WhatsApp (não dá para reagir nem editar)");
    const { data: c } = await db
      .from("conversations")
      .select("contact:contacts(phone, is_group), connection:whatsapp_connections(instance, channel)")
      .eq("id", msg.conversation_id)
      .maybeSingle();
    const conv = c as unknown as { contact: { phone: string; is_group: boolean } | null; connection: { instance: string; channel?: string } | null } | null;
    const canal = conv?.connection?.channel;
    if (!conv?.contact || canal === "instagram" || canal === "messenger" || canal === "email") {
      throw new HttpError(400, "reagir e editar funcionam só nas conversas de WhatsApp");
    }
    const { phone, is_group } = conv.contact;
    const chave = { id: msg.wa_message_id, remoteJid: is_group ? `${phone}@g.us` : `${phone}@s.whatsapp.net`, fromMe: msg.direction === "out" };
    const zap = whatsapp(conv.connection?.instance);

    if (body.reacao !== undefined) {
      const emoji = String(body.reacao).slice(0, 16);
      if (!zap.sendReaction) throw new HttpError(400, "esta conexão não permite reagir");
      try {
        await zap.sendReaction(chave, emoji);
      } catch (err) {
        if (err instanceof HttpError) throw err;
        console.error("reagir", err);
        throw new HttpError(502, "O WhatsApp não aceitou a reação agora (o número pode estar desconectado). Tente de novo.");
      }
      const r = { ...(msg.reacoes ?? {}) };
      if (emoji) r.nos = emoji;
      else delete r.nos;
      patch.reacoes = r;
    }

    if (body.texto !== undefined) {
      const texto = String(body.texto).trim();
      if (!texto) throw new HttpError(400, "o texto não pode ficar vazio");
      if (msg.direction !== "out" || msg.media_type) throw new HttpError(400, "só dá para editar mensagem de texto enviada por nós");
      if (Date.now() - new Date(msg.created_at).getTime() > 15 * 60_000) throw new HttpError(400, "o WhatsApp só deixa editar nos primeiros 15 minutos depois do envio");
      if (!zap.editText) throw new HttpError(400, "esta conexão não permite editar");
      try {
        await zap.editText(is_group ? `${phone}@g.us` : phone, chave, texto);
      } catch (err) {
        if (err instanceof HttpError) throw err;
        console.error("editar", err);
        throw new HttpError(502, "O WhatsApp não aceitou a edição (passou do prazo ou o número está desconectado).");
      }
      patch.body = texto;
      patch.editada = true;
    }
  }

  if (!Object.keys(patch).length) return msg;
  const { data: atualizada, error } = await db.from("messages").update(patch).eq("id", msg.id).select().single();
  if (error) throw new Error(error.message);
  return atualizada as Message;
});
