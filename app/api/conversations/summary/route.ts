import { route } from "@/lib/api";
import { countAll, parseFilter } from "@/lib/inbox";
import { can, getAgent } from "@/lib/perms";
import { listConnections, syncState } from "@/lib/connections";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getAlertas } from "@/lib/alertas";

// Situação dos números (conectado ou não), consultada na Evolution no máximo a cada 60 segundos.
let cache: { t: number; data: { id: string; name: string; phone: string | null; connected_at: string | null }[] } | null = null;
async function estadosNumeros() {
  if (cache && Date.now() - cache.t < 60_000) return cache.data;
  const lista = await listConnections();
  const data = await Promise.all(
    lista.map(async (c) => {
      const s = await syncState(c).catch(() => ({ ...c, state: "error" }));
      // Só conta como conectado quando a Evolution diz "open" (ou não deu para consultar e estava conectado).
      const online = s.state === "open" || (s.state === "error" && !!s.connected_at);
      return { id: s.id, name: s.name, phone: s.phone, connected_at: online ? s.connected_at ?? new Date().toISOString() : null };
    }),
  );
  cache = { t: Date.now(), data };
  return data;
}

// Contadores do lado esquerdo da tela de conversas e os números de WhatsApp (para iniciar conversa).
export const GET = route(async (req, _ctx, userId) => {
  const filter = parseFilter(new URL(req.url).searchParams);
  const db = supabaseAdmin();
  const agent = await getAgent(userId);
  const total = can(agent, "ver_todas");
  const conns = await estadosNumeros();
  const [counts, connections, agents, abertas, alertas] = await Promise.all([
    countAll(userId, filter, (conns ?? []).map((c) => c.id)),
    Promise.resolve({ data: conns }),
    total ? db.from("agents").select("id, name, active").eq("active", true).order("name") : Promise.resolve({ data: [] }),
    total ? db.from("conversations").select("assigned_to").neq("status", "closed").not("assigned_to", "is", null).limit(5000) : Promise.resolve({ data: [] }),
    getAlertas(),
  ]);
  // Atendentes com quantas conversas abertas cada um tem (só para quem tem acesso total).
  const n: Record<string, number> = {};
  for (const c of (abertas.data ?? []) as { assigned_to: string }[]) n[c.assigned_to] = (n[c.assigned_to] ?? 0) + 1;
  const atendentes = ((agents.data ?? []) as { id: string; name: string }[]).map((a) => ({ id: a.id, name: a.name, abertas: n[a.id] ?? 0 }));
  return { ...counts, connections: connections.data ?? [], me: userId, atendentes, alertas };
});
