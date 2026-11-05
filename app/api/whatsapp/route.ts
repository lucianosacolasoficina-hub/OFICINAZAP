import { HttpError, route } from "@/lib/api";
import { createConnection, listConnections, MAX_CONNECTIONS, requireEvolution, syncState } from "@/lib/connections";
import { canaisDe, getAgent } from "@/lib/perms";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Números de WhatsApp conectados pela Evolution API (QR Code), na tela WhatsApp.
export const GET = route(async (_req, _ctx, userId) => {
  requireEvolution();
  const liberados = canaisDe(await getAgent(userId));
  const [connections, departments, soltas] = await Promise.all([
    listConnections().then((l) => l.filter((c) => !liberados || liberados.includes(c.id))),
    supabaseAdmin().from("departments").select("id, name").order("name"),
    // Conversas sem número (card apagado): não aparecem para os atendentes. Só o administrador vê o aviso.
    liberados
      ? Promise.resolve({ count: 0 })
      : supabaseAdmin().from("conversations").select("id", { count: "exact", head: true }).is("connection_id", null),
  ]);
  return {
    connections: await Promise.all(connections.filter((c) => !c.channel || c.channel === "whatsapp").map(syncState)),
    departments: departments.data ?? [],
    max: MAX_CONNECTIONS,
    soltas: soltas.count ?? 0,
  };
});

// Cadastra um número novo; o QR Code é gerado em seguida por /api/whatsapp/[id].
export const POST = route(async (req) => {
  requireEvolution();
  const { name, department_id } = (await req.json()) as { name?: string; department_id?: string | null };
  if (!name?.trim()) throw new HttpError(400, "informe um nome para o número");
  if ((await listConnections()).filter((c) => !c.channel || c.channel === "whatsapp").length >= MAX_CONNECTIONS) {
    throw new HttpError(400, `limite de ${MAX_CONNECTIONS} números atingido`);
  }
  return createConnection(name.trim(), department_id || null);
});
