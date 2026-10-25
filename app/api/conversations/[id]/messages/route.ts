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
    .select("*, contact:contacts(phone)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new HttpError(404, "conversa não encontrada");
  const conversation = data as Conversation & { contact: { phone: string } };

  const sent = await whatsapp().sendText(conversation.contact.phone, text);
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
