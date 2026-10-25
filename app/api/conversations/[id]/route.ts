import { HttpError, route, type IdCtx } from "@/lib/api";
import { addMessage, getQuote, recentMessages, updateConversation, type ConversationStatus } from "@/lib/db";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const GET = route<IdCtx>(async (_req, { params }) => {
  const { id } = await params;
  const db = supabaseAdmin();
  const { data: conversation, error } = await db
    .from("conversations")
    .select("*, contact:contacts(*)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!conversation) throw new HttpError(404, "conversa não encontrada");
  if (conversation.unread_count) await updateConversation(id, { unread_count: 0 });
  const [messages, quote] = await Promise.all([recentMessages(id, 300), getQuote(id)]);
  return { conversation, messages, quote };
});

const LABELS: Record<ConversationStatus, string> = {
  bot: "Conversa devolvida para a IA",
  waiting: "Conversa colocada na fila de espera",
  open: "Atendente assumiu a conversa",
  closed: "Conversa encerrada",
};

export const PATCH = route<IdCtx>(async (req, { params }, userId) => {
  const { id } = await params;
  const { status } = (await req.json()) as { status: ConversationStatus };
  if (!(status in LABELS)) throw new HttpError(400, "status inválido");
  await updateConversation(id, {
    status,
    assigned_to: status === "open" ? userId : status === "bot" ? null : undefined,
  });
  await addMessage(id, { direction: "out", sender: "system", body: LABELS[status], agent_id: userId });
});
