import { HttpError, route, type IdCtx } from "@/lib/api";
import type { Agendada } from "@/lib/agendadas";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Mensagens agendadas da conversa: as que ainda vão sair e as que deram erro (para o atendente ver).
export const GET = route<IdCtx>(async (_req, { params }) => {
  const { id } = await params;
  const { data, error } = await supabaseAdmin()
    .from("agendadas")
    .select("*")
    .eq("conversation_id", id)
    .in("status", ["pendente", "enviando", "erro"])
    .order("enviar_em");
  if (error) throw new Error(error.message);
  return (data ?? []) as Agendada[];
});

// Agenda uma mensagem: { body, enviar_em (data e hora ISO) }.
export const POST = route<IdCtx>(async (req, { params }, userId) => {
  const { id } = await params;
  const { body, enviar_em } = (await req.json()) as { body?: string; enviar_em?: string };
  const texto = body?.trim() ?? "";
  if (!texto) throw new HttpError(400, "escreva a mensagem antes de agendar");
  if (texto.length > 4000) throw new HttpError(400, "mensagem muito grande para agendar");
  const quando = new Date(enviar_em ?? "");
  if (!Number.isFinite(quando.getTime())) throw new HttpError(400, "escolha o dia e a hora");
  if (quando.getTime() < Date.now() + 30_000) throw new HttpError(400, "escolha um horário daqui a pelo menos 1 minuto");
  if (quando.getTime() > Date.now() + 90 * 86_400_000) throw new HttpError(400, "dá para agendar até 90 dias para frente");
  const db = supabaseAdmin();
  const { data: conv } = await db.from("conversations").select("id").eq("id", id).maybeSingle();
  if (!conv) throw new HttpError(404, "conversa não encontrada");
  // Travas contra banimento: agendamento não pode virar disparo em massa.
  const { count: daConversa } = await db.from("agendadas").select("id", { count: "exact", head: true }).eq("conversation_id", id).eq("status", "pendente");
  if ((daConversa ?? 0) >= 5) throw new HttpError(400, "esta conversa já tem 5 mensagens agendadas. Cancele uma antes de agendar outra.");
  const ini = new Date(quando.getTime() - 30 * 60_000).toISOString();
  const fim = new Date(quando.getTime() + 30 * 60_000).toISOString();
  const { data: mesmoTexto } = await db.from("agendadas").select("conversation_id").eq("status", "pendente").eq("body", texto).gte("enviar_em", ini).lte("enviar_em", fim);
  if (new Set((mesmoTexto ?? []).map((a) => a.conversation_id).filter((c) => c !== id)).size >= 2) {
    throw new HttpError(400, "trava contra banimento: esta mesma mensagem já está agendada para outros clientes perto deste horário. Mudar o texto ou o horário de cada um evita parecer disparo em massa.");
  }
  const { count: naJanela } = await db
    .from("agendadas")
    .select("id", { count: "exact", head: true })
    .eq("status", "pendente")
    .gte("enviar_em", new Date(quando.getTime() - 5 * 60_000).toISOString())
    .lte("enviar_em", new Date(quando.getTime() + 5 * 60_000).toISOString());
  if ((naJanela ?? 0) >= 15) throw new HttpError(400, "trava contra banimento: já há 15 mensagens agendadas para perto deste horário. Escolha outro horário.");
  const { data, error } = await db
    .from("agendadas")
    .insert({ conversation_id: id, agent_id: userId, body: texto, enviar_em: quando.toISOString() })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Agendada;
});

// Cancela (?ag=<id>) uma agendada que ainda não saiu, ou tira da lista uma que deu erro.
export const DELETE = route<IdCtx>(async (req, { params }) => {
  const { id } = await params;
  const ag = new URL(req.url).searchParams.get("ag");
  if (!ag) throw new HttpError(400, "qual mensagem agendada?");
  const { data, error } = await supabaseAdmin()
    .from("agendadas")
    .update({ status: "cancelada" })
    .eq("id", ag)
    .eq("conversation_id", id)
    .in("status", ["pendente", "erro"])
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new HttpError(409, "essa mensagem já foi enviada ou está saindo agora");
});
