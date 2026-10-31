import { route } from "@/lib/api";
import { getEtapas } from "@/lib/crm";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const GET = route(async () => {
  const db = supabaseAdmin();
  const now = new Date();
  // Início do dia no horário de Brasília (UTC-3).
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 3));
  if (today > now) today.setUTCDate(today.getUTCDate() - 1);
  const days30 = new Date(now.getTime() - 30 * 864e5).toISOString();
  const days7 = new Date(now.getTime() - 7 * 864e5).toISOString();

  const count = async (q: PromiseLike<{ count: number | null; error: { message: string } | null }>) => {
    const { count, error } = await q;
    if (error) throw new Error(error.message);
    return count ?? 0;
  };
  const conv = () => db.from("conversations").select("id", { count: "exact", head: true });

  const [newToday, msgsToday, waiting, open, bot, newContacts, conv30] = await Promise.all([
    count(conv().gte("created_at", today.toISOString())),
    count(db.from("messages").select("id", { count: "exact", head: true }).eq("direction", "in").gte("created_at", today.toISOString())),
    count(conv().eq("status", "waiting")),
    count(conv().eq("status", "open")),
    count(conv().eq("status", "bot")),
    count(db.from("contacts").select("id", { count: "exact", head: true }).gte("created_at", days7)),
    count(conv().gte("created_at", days30)),
  ]);

  // Conversas dos últimos 30 dias em que um humano precisou responder.
  const { data: humanRows, error: hErr } = await db
    .from("messages")
    .select("conversation_id")
    .eq("sender", "agent")
    .gte("created_at", days30)
    .limit(10000);
  if (hErr) throw new Error(hErr.message);
  const withHuman = new Set(humanRows.map((r) => r.conversation_id)).size;

  const { data: deals, error: dErr } = await db.from("deals").select("stage, value, updated_at").limit(5000);
  if (dErr) throw new Error(dErr.message);
  const etapas = await getEtapas();
  const funnel = etapas.map((s) => {
    const rows = deals.filter((d) => d.stage === s.key);
    return { key: s.key, label: s.label, count: rows.length, value: rows.reduce((t, d) => t + (Number(d.value) || 0), 0) };
  });
  // Ganhos: da etapa que manda para o Bling em diante (sem contar as encerradas como perdido).
  const iB = etapas.findIndex((e) => e.bling);
  const ganhas = new Set(iB >= 0 ? etapas.slice(iB).filter((e) => !/perd/i.test(e.label)).map((e) => e.key) : []);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const wonMonth = deals
    .filter((d) => ganhas.has(d.stage) && d.updated_at >= monthStart)
    .reduce((t, d) => t + (Number(d.value) || 0), 0);

  return {
    newToday,
    msgsToday,
    waiting,
    open,
    bot,
    newContacts,
    conv30,
    aiOnlyRate: conv30 ? Math.max(0, Math.round(((conv30 - withHuman) / conv30) * 100)) : null,
    funnel,
    wonMonth,
  };
});
