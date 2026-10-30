import { HttpError, route, type IdCtx } from "@/lib/api";
import { addMessage, updateConversation, type Conversation } from "@/lib/db";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { whatsapp } from "@/lib/whatsapp";

// Atendente envia uma mensagem. Ao responder, ele assume a conversa e a IA para de responder nela.
export const POST = route<IdCtx>(async (req, { params }, userId) => {
  const { id } = await params;
  const { body } = (await req.json()) as { body?: string };
  const text = body?.trim();
  if (!text) throw new HttpError(400, "mensagem vazia");

  const { data, error } = await supabaseAdmin()
    .from("conversations")
    .select("*, contact:contacts(phone, is_group), connection:whatsapp_connections(instance)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new HttpError(404, "conversa não encontrada");
  const conversation = data as Conversation & { contact: { phone: string; is_group: boolean }; connection: { instance: string } | null };

  // Responde pelo mesmo número de WhatsApp em que o cliente escreveu.
  const { phone, is_group } = conversation.contact;
  const sent = await whatsapp(conversation.connection?.instance).sendText(is_group ? `${phone}@g.us` : phone, text);
  if (conversation.status !== "open" || conversation.assigned_to !== userId) {
    await updateConversation(id, { status: "open", assigned_to: userId });
  }
  return addMessage(id, {
    direction: "out",
    sender: "agent",
    agent_id: userId,
    body: text,
    wa_message_id: sent.waMessageId ?? null,
  });
});

// Só as mensagens novas desde `after` (a tela pergunta a cada poucos segundos, sem baixar tudo de novo).
export const GET = route<IdCtx>(async (req, { params }) => {
  const { id } = await params;
  const after = new URL(req.url).searchParams.get("after");
  let q = supabaseAdmin().from("messages").select("*").eq("conversation_id", id).order("created_at", { ascending: true }).limit(200);
  if (after) q = q.gt("created_at", after);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
});
