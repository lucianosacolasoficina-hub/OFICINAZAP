import { route } from "@/lib/api";
import { countAll, parseFilter } from "@/lib/inbox";
import { can, getAgent } from "@/lib/perms";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Contadores do lado esquerdo da tela de conversas e os números de WhatsApp (para iniciar conversa).
export const GET = route(async (req, _ctx, userId) => {
  const filter = parseFilter(new URL(req.url).searchParams);
  const db = supabaseAdmin();
  const agent = await getAgent(userId);
  const total = can(agent, "ver_todas");
  const [counts, connections, agents, abertas] = await Promise.all([
    countAll(userId, filter),
    db.from("whatsapp_connections").select("id, name, connected_at").order("created_at"),
    total ? db.from("agents").select("id, name, active").eq("active", true).order("name") : Promise.resolve({ data: [] }),
    total ? db.from("conversations").select("assigned_to").neq("status", "closed").not("assigned_to", "is", null).limit(5000) : Promise.resolve({ data: [] }),
  ]);
  // Atendentes com quantas conversas abertas cada um tem (só para quem tem acesso total).
  const n: Record<string, number> = {};
  for (const c of (abertas.data ?? []) as { assigned_to: string }[]) n[c.assigned_to] = (n[c.assigned_to] ?? 0) + 1;
  const atendentes = ((agents.data ?? []) as { id: string; name: string }[]).map((a) => ({ id: a.id, name: a.name, abertas: n[a.id] ?? 0 }));
  return { ...counts, connections: connections.data ?? [], me: userId, atendentes };
});
