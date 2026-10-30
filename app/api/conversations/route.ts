import { HttpError, route } from "@/lib/api";
import { getConnection } from "@/lib/connections";
import { activeConversation, updateConversation, upsertContact } from "@/lib/db";
import { applyFilter, LIST_SELECT, loadLookups, parseFilter } from "@/lib/inbox";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const GET = route(async (req, _ctx, userId) => {
  const filter = parseFilter(new URL(req.url).searchParams);
  const lookups = await loadLookups(userId, filter.stage ? [filter.stage] : [], filter.search);
  const query = supabaseAdmin()
    .from("conversations")
    .select(LIST_SELECT)
    .order("last_message_at", { ascending: false })
    .limit(150);
  const { data, error } = await applyFilter(query, filter, userId, lookups);
  if (error) throw new Error(error.message);
  return data;
});

// Nova conversa iniciada pelo atendente (botão +). A primeira mensagem é enviada depois, pelo chat.
export const POST = route(async (req, _ctx, userId) => {
  const body = (await req.json()) as { phone?: string; name?: string; connection_id?: string | null };
  let phone = (body.phone ?? "").replace(/\D/g, "");
  // Número brasileiro digitado só com DDD: coloca o 55 na frente.
  if (phone.length === 10 || phone.length === 11) phone = `55${phone}`;
  if (phone.length < 12 || phone.length > 15) throw new HttpError(400, "telefone inválido: use DDD + número");

  const connection = body.connection_id ? await getConnection(body.connection_id) : null;
  if (body.connection_id && !connection) throw new HttpError(404, "número de WhatsApp não encontrado");

  const contact = await upsertContact(phone, body.name?.trim() || undefined);
  const conversation = await activeConversation(contact.id, false, connection);
  if (conversation.status !== "open" || conversation.assigned_to !== userId) {
    await updateConversation(conversation.id, { status: "open", assigned_to: userId });
  }
  return { id: conversation.id };
});
