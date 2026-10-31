import { route } from "@/lib/api";
import { getEtapas } from "@/lib/crm";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Atendimentos por atendente (só administrador): situação da conversa e etapa do funil de cada cliente.
export const GET = route(async (req) => {
  const dias = Number(new URL(req.url).searchParams.get("dias") ?? 30);
  const desde = dias > 0 ? new Date(Date.now() - dias * 864e5).toISOString() : null;
  const db = supabaseAdmin();
  let convQ = db
    .from("conversations")
    .select("id, status, assigned_to, contact_id, last_message_at, last_message_preview, waiting_since, contact:contacts!inner(name, phone, is_group)")
    .eq("contact.is_group", false)
    .order("last_message_at", { ascending: false })
    .limit(5000);
  // Encerradas só do período escolhido; as abertas aparecem sempre.
  if (desde) convQ = convQ.or(`status.neq.closed,last_message_at.gte.${desde}`);
  const [{ data: convs, error }, { data: agents }, { data: deals }] = await Promise.all([
    convQ,
    db.from("agents").select("id, name, role, active").order("name"),
    db.from("deals").select("contact_id, stage, value, updated_at").order("updated_at", { ascending: true }).limit(10000),
  ]);
  if (error) throw new Error(error.message);
  // Etapa mais recente do funil de cada cliente.
  const etapa = new Map<string, { stage: string; value: number | null }>();
  for (const d of deals ?? []) etapa.set(d.contact_id, { stage: d.stage, value: d.value });
  return {
    stages: await getEtapas(),
    agents: agents ?? [],
    rows: (convs ?? []).map((c) => {
      const ct = c.contact as unknown as { name: string | null; phone: string };
      const e = etapa.get(c.contact_id);
      return {
        id: c.id,
        status: c.status,
        agent: c.assigned_to,
        nome: ct?.name || ct?.phone || "",
        phone: ct?.phone ?? "",
        stage: e?.stage ?? null,
        valor: e?.value ?? null,
        last: c.last_message_at,
        preview: c.last_message_preview,
      };
    }),
  };
});
