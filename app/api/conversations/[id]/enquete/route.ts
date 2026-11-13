import { HttpError, route, type IdCtx } from "@/lib/api";
import { addMessage, updateConversation } from "@/lib/db";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { whatsapp } from "@/lib/whatsapp";

// Envia uma enquete no WhatsApp (o cliente vota tocando nas opções). Ex.: escolher cor ou modelo da sacola.
export const POST = route<IdCtx>(async (req, { params }, userId) => {
  const { id } = await params;
  const { pergunta, opcoes, varias } = (await req.json()) as { pergunta?: string; opcoes?: string[]; varias?: boolean };
  const q = pergunta?.trim().slice(0, 255) ?? "";
  const ops = [...new Set((opcoes ?? []).map((o) => String(o).trim().slice(0, 100)).filter(Boolean))];
  if (!q) throw new HttpError(400, "escreva a pergunta");
  if (ops.length < 2) throw new HttpError(400, "coloque pelo menos 2 opções diferentes");
  if (ops.length > 12) throw new HttpError(400, "no máximo 12 opções");
  const { data } = await supabaseAdmin()
    .from("conversations")
    .select("status, assigned_to, contact:contacts(phone, is_group), connection:whatsapp_connections(instance, channel)")
    .eq("id", id)
    .maybeSingle();
  if (!data) throw new HttpError(404, "conversa não encontrada");
  const c = data as unknown as { status: string; assigned_to: string | null; contact: { phone: string; is_group: boolean }; connection: { instance: string; channel?: string } | null };
  if (c.connection?.channel && c.connection.channel !== "whatsapp") throw new HttpError(400, "enquete só funciona nas conversas de WhatsApp");
  // Trava contra banimento: no máximo 3 enquetes por hora na mesma conversa (a trava de envio também barra a mesma enquete para muitos clientes).
  const { count } = await supabaseAdmin()
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", id)
    .eq("direction", "out")
    .like("body", "📊 Enquete:%")
    .gte("created_at", new Date(Date.now() - 3600_000).toISOString());
  if ((count ?? 0) >= 3) throw new HttpError(400, "trava contra banimento: já foram 3 enquetes nesta conversa na última hora");
  const zap = whatsapp(c.connection?.instance);
  if (!zap.sendPoll) throw new HttpError(400, "esta conexão não envia enquete");
  const sent = await zap.sendPoll(c.contact.is_group ? `${c.contact.phone}@g.us` : c.contact.phone, q, ops, !!varias);
  if (c.status !== "open" || c.assigned_to !== userId) await updateConversation(id, { status: "open", assigned_to: userId });
  return addMessage(id, {
    direction: "out",
    sender: "agent",
    agent_id: userId,
    body: `📊 Enquete: ${q}\n${ops.map((o) => `• ${o}`).join("\n")}${varias ? "\n(pode escolher mais de uma)" : ""}`,
    wa_message_id: sent.waMessageId ?? null,
  });
});
