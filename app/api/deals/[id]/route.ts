import { HttpError, route, type IdCtx } from "@/lib/api";
import { blingConnected, sendDealToBling } from "@/lib/bling";
import { etapaValida, getEtapas } from "@/lib/crm";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const PATCH = route<IdCtx>(async (req, { params }) => {
  const { id } = await params;
  const body = (await req.json()) as {
    stage?: string;
    position?: number;
    title?: string;
    value?: number | null;
    notes?: string;
  };
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.stage !== undefined) {
    if (!(await etapaValida(body.stage))) throw new HttpError(400, "etapa inválida");
    patch.stage = body.stage;
  }
  if (typeof body.position === "number") patch.position = body.position;
  if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim();
  if (body.value === null || typeof body.value === "number") patch.value = body.value;
  if (typeof body.notes === "string") patch.notes = body.notes;
  const { data, error } = await supabaseAdmin().from("deals").update(patch).eq("id", id).select().single();
  if (error) throw new Error(error.message);

  // Pedido fechado: cria o cliente e o pedido de venda no Bling (uma vez só).
  // Se o Bling falhar, o card muda de etapa do mesmo jeito e o erro fica salvo no negócio.
  if (patch.stage && (await getEtapas()).some((e) => e.key === patch.stage && e.bling) && !data.bling_order_id && (await blingConnected())) {
    try {
      const order = await sendDealToBling(id);
      return { ...data, bling_order_id: order.id, bling_order_number: order.numero, bling_error: null };
    } catch (err) {
      return { ...data, bling_error: err instanceof Error ? err.message : "erro ao enviar ao Bling" };
    }
  }
  return data;
});

export const DELETE = route<IdCtx>(async (_req, { params }) => {
  const { id } = await params;
  const { error } = await supabaseAdmin().from("deals").delete().eq("id", id);
  if (error) throw new Error(error.message);
});
