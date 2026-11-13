import { addMessage } from "./db";
import { enviarTexto, IG_PREFIX } from "./instagram";
import { enviarMessenger, FB_PREFIX } from "./messenger";
import { supabaseAdmin } from "./supabase/admin";
import { whatsapp } from "./whatsapp";

// Mensagens agendadas: o atendente escreve agora e escolhe o dia e a hora em que ela sai para o cliente
// (lembrete de orçamento, aviso de pedido pronto, cobrança). A cada 30 segundos o servidor envia as que chegaram na hora.

export type Agendada = {
  id: string;
  conversation_id: string;
  agent_id: string | null;
  body: string;
  enviar_em: string;
  status: "pendente" | "enviando" | "enviada" | "erro" | "cancelada";
  erro: string | null;
  message_id: string | null;
  created_at: string;
};

/** Envia um texto na conversa pelo mesmo número/canal dela e grava como mensagem do atendente. */
export async function enviarTextoNaConversa(conversationId: string, text: string, agentId: string | null) {
  const { data, error } = await supabaseAdmin()
    .from("conversations")
    .select("id, contact:contacts(phone, is_group), connection:whatsapp_connections(id, instance, channel)")
    .eq("id", conversationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("conversa não encontrada");
  const c = data as unknown as { contact: { phone: string; is_group: boolean }; connection: { id: string; instance: string; channel?: string } | null };
  const { phone, is_group } = c.contact;
  const canal = c.connection?.channel;
  const sent =
    canal === "instagram"
      ? await enviarTexto(c.connection!.id, phone.slice(IG_PREFIX.length), text)
      : canal === "messenger"
      ? await enviarMessenger(c.connection!.id, phone.slice(FB_PREFIX.length), text)
      : canal === "email"
      ? (() => {
          throw new Error("mensagem agendada ainda não sai por e-mail");
        })()
      : await whatsapp(c.connection?.instance).sendText(is_group ? `${phone}@g.us` : phone, text);
  return addMessage(conversationId, {
    direction: "out",
    sender: "agent",
    agent_id: agentId,
    body: text,
    wa_message_id: sent.waMessageId ?? null,
  });
}

let rodando = false;
export async function enviarAgendadas() {
  if (rodando) return;
  rodando = true;
  try {
    const db = supabaseAdmin();
    // Ficou "enviando" por mais de 10 minutos (o servidor reiniciou no meio): marca erro para o atendente ver.
    await db
      .from("agendadas")
      .update({ status: "erro", erro: "o servidor reiniciou na hora do envio; confira na conversa se saiu e agende de novo se precisar" })
      .eq("status", "enviando")
      .lt("enviar_em", new Date(Date.now() - 10 * 60_000).toISOString());
    const { data } = await db
      .from("agendadas")
      .select("*")
      .eq("status", "pendente")
      .lte("enviar_em", new Date().toISOString())
      .order("enviar_em")
      .limit(20);
    for (const a of (data ?? []) as Agendada[]) {
      // Marca como "enviando" antes: se dois servidores rodarem juntos, só um envia.
      const { data: peguei } = await db.from("agendadas").update({ status: "enviando" }).eq("id", a.id).eq("status", "pendente").select("id");
      if (!peguei?.length) continue;
      try {
        const msg = await enviarTextoNaConversa(a.conversation_id, a.body, a.agent_id);
        await db.from("agendadas").update({ status: "enviada", message_id: msg?.id ?? null, erro: null }).eq("id", a.id);
      } catch (err) {
        const motivo = err instanceof Error ? err.message : "falha no envio";
        await db.from("agendadas").update({ status: "erro", erro: motivo.slice(0, 500) }).eq("id", a.id);
        await addMessage(a.conversation_id, { direction: "out", sender: "system", body: `⏰ A mensagem agendada não saiu: ${motivo}` }).catch(() => null);
      }
    }
  } finally {
    rodando = false;
  }
}
