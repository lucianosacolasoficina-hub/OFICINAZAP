import { HttpError, route, type IdCtx } from "@/lib/api";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Apaga o histórico de mensagens da conversa (e as fotos/arquivos guardados dela).
// O contato, a conversa, o orçamento coletado e o funil continuam.
// Só apaga no OficinaZap: as mensagens continuam no celular.
export const DELETE = route<IdCtx>(async (_req, { params }, userId) => {
  const { id } = await params;
  const db = supabaseAdmin();
  const { data: conv, error } = await db.from("conversations").select("id").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!conv) throw new HttpError(404, "conversa não encontrada");

  const { data: comMidia } = await db.from("messages").select("media_url").eq("conversation_id", id).not("media_url", "is", null);
  const paths = (comMidia ?? []).map((m) => m.media_url as string).filter(Boolean);
  for (let i = 0; i < paths.length; i += 100) {
    await db.storage.from("media").remove(paths.slice(i, i + 100));
  }

  const del = await db.from("messages").delete().eq("conversation_id", id);
  if (del.error) throw new Error(del.error.message);

  const agora = new Date().toISOString();
  await db
    .from("conversations")
    .update({ unread_count: 0, waiting_since: null, last_message_preview: "Histórico apagado", last_message_at: agora })
    .eq("id", id);
  await db.from("messages").insert({
    conversation_id: id,
    direction: "out",
    sender: "system",
    agent_id: userId,
    body: "Histórico de mensagens apagado pelo atendente",
  });
  return { ok: true, apagadas: paths.length };
});
