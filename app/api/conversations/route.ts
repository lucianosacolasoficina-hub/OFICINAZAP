import { HttpError, route } from "@/lib/api";
import { getConnection } from "@/lib/connections";
import { activeConversation, updateConversation, upsertContact } from "@/lib/db";
import { applyFilter, LIST_SELECT, loadLookups, parseFilter } from "@/lib/inbox";
import { canaisDe, getAgent } from "@/lib/perms";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const GET = route(async (req, _ctx, userId) => {
  const sp = new URL(req.url).searchParams;
  const filter = parseFilter(sp);
  // Paginação: a Central carrega de 50 em 50 ao rolar (antes parava fixo em 150).
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 150, 1), 500);
  const offset = Math.max(Number(sp.get("offset")) || 0, 0);
  const lookups = await loadLookups(userId, filter.stage ? [filter.stage] : [], filter.search);
  const fixadasNoTopo = filter.view !== "atrasadas" && filter.view !== "retomar";
  let query = supabaseAdmin().from("conversations").select(LIST_SELECT);
  // Conversas fixadas (📌) ficam no topo, como no WhatsApp.
  if (fixadasNoTopo) query = query.order("fixada_em", { ascending: false, nullsFirst: false });
  query = query
    // Quem espera há mais tempo aparece primeiro no alerta; em "Retomar", o orçamento mais antigo primeiro.
    .order(filter.view === "atrasadas" ? "waiting_since" : "last_message_at", { ascending: filter.view === "atrasadas" || filter.view === "retomar" })
    .order("id")
    .range(offset, offset + limit - 1);
  const { data, error } = await applyFilter(query, filter, userId, lookups);
  if (error) throw new Error(error.message);
  // A Central pagina e tira as repetidas do lado dela (para saber quando a lista acabou).
  if (sp.get("dedup") === "0") return data ?? [];
  // Um cliente aparece uma vez por número: fica só a conversa mais recente (as antigas entram no histórico dela).
  const vistos = new Set<string>();
  return (data ?? []).filter((c) => {
    const k = `${(c as { contact_id: string }).contact_id}|${(c as { connection_id: string | null }).connection_id ?? ""}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
});

// Nova conversa iniciada pelo atendente (botão +). A primeira mensagem é enviada depois, pelo chat.
export const POST = route(async (req, _ctx, userId) => {
  const body = (await req.json()) as { phone?: string; name?: string; connection_id?: string | null };
  let phone = (body.phone ?? "").replace(/\D/g, "");
  // Número brasileiro digitado só com DDD: coloca o 55 na frente.
  if (phone.length === 10 || phone.length === 11) phone = `55${phone}`;
  if (phone.length < 12 || phone.length > 15) throw new HttpError(400, "telefone inválido: use DDD + número");

  // Atendente só inicia conversa pelos números liberados para ele.
  const liberados = canaisDe(await getAgent(userId));
  if (liberados && (!body.connection_id || !liberados.includes(body.connection_id))) {
    throw new HttpError(403, "escolha um dos números de WhatsApp liberados para você");
  }
  const connection = body.connection_id ? await getConnection(body.connection_id) : null;
  if (body.connection_id && !connection) throw new HttpError(404, "número de WhatsApp não encontrado");

  const contact = await upsertContact(phone, body.name?.trim() || undefined);
  const conversation = await activeConversation(contact.id, false, connection);
  // Conversa que já está com outro atendente só abre (não é tirada dele); senão fica com quem iniciou.
  if (!conversation.assigned_to || conversation.assigned_to === userId) {
    if (conversation.status !== "open" || conversation.assigned_to !== userId) {
      await updateConversation(conversation.id, { status: "open", assigned_to: userId });
    }
  }
  return { id: conversation.id };
});
