import { HttpError, route } from "@/lib/api";
import { createConnection, listConnections, MAX_CONNECTIONS, requireEvolution, syncState } from "@/lib/connections";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Números de WhatsApp conectados pela Evolution API (QR Code), na tela WhatsApp.
export const GET = route(async () => {
  requireEvolution();
  const [connections, departments] = await Promise.all([
    listConnections(),
    supabaseAdmin().from("departments").select("id, name").order("name"),
  ]);
  return {
    connections: await Promise.all(connections.filter((c) => c.channel !== "instagram").map(syncState)),
    departments: departments.data ?? [],
    max: MAX_CONNECTIONS,
  };
});

// Cadastra um número novo; o QR Code é gerado em seguida por /api/whatsapp/[id].
export const POST = route(async (req) => {
  requireEvolution();
  const { name, department_id } = (await req.json()) as { name?: string; department_id?: string | null };
  if (!name?.trim()) throw new HttpError(400, "informe um nome para o número");
  if ((await listConnections()).filter((c) => c.channel !== "instagram").length >= MAX_CONNECTIONS) {
    throw new HttpError(400, `limite de ${MAX_CONNECTIONS} números atingido`);
  }
  return createConnection(name.trim(), department_id || null);
});
