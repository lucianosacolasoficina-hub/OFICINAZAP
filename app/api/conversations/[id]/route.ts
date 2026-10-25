import { HttpError, route, type IdCtx } from "@/lib/api";
import {
  addMessage,
  getQuote,
  recentMessages,
  transferToDepartment,
  updateConversation,
  type ConversationStatus,
  type Department,
} from "@/lib/db";
import { CONVERSATION_SELECT } from "@/lib/inbox";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const GET = route<IdCtx>(async (_req, { params }) => {
  const { id } = await params;
  const db = supabaseAdmin();
  const { data: conversation, error } = await db
    .from("conversations")
    .select(CONVERSATION_SELECT)
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
  const body = (await req.json()) as { status?: ConversationStatus; department_id?: string | null };

  // Transferir para um departamento (ou tirar do departamento, com null).
  if (body.department_id !== undefined) {
    if (body.department_id === null) {
      await updateConversation(id, { department_id: null });
      await addMessage(id, { direction: "out", sender: "system", body: "Conversa tirada do departamento", agent_id: userId });
      return;
    }
    const { data: department, error } = await supabaseAdmin()
      .from("departments")
      .select("*")
      .eq("id", body.department_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!department) throw new HttpError(404, "departamento não encontrado");
    await transferToDepartment(id, department as Department, undefined, userId);
    return;
  }

  const { status } = body as { status: ConversationStatus };
  if (!(status in LABELS)) throw new HttpError(400, "status inválido");
  await updateConversation(id, {
    status,
    assigned_to: status === "open" ? userId : status === "bot" ? null : undefined,
  });
  await addMessage(id, { direction: "out", sender: "system", body: LABELS[status], agent_id: userId });
});
