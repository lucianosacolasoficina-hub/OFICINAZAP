import { HttpError, route, type IdCtx } from "@/lib/api";
import { isStage } from "@/lib/deals";
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
    if (!isStage(body.stage)) throw new HttpError(400, "etapa inválida");
    patch.stage = body.stage;
  }
  if (typeof body.position === "number") patch.position = body.position;
  if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim();
  if (body.value === null || typeof body.value === "number") patch.value = body.value;
  if (typeof body.notes === "string") patch.notes = body.notes;
  const { data, error } = await supabaseAdmin().from("deals").update(patch).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return data;
});

export const DELETE = route<IdCtx>(async (_req, { params }) => {
  const { id } = await params;
  const { error } = await supabaseAdmin().from("deals").delete().eq("id", id);
  if (error) throw new Error(error.message);
});
