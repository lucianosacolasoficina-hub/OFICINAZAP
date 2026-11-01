import { route, type IdCtx } from "@/lib/api";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const PATCH = route<IdCtx>(async (req, { params }) => {
  const { id } = await params;
  const b = (await req.json()) as { name?: string; color?: string; position?: number; done?: boolean };
  const patch: Record<string, unknown> = {};
  if (b.name?.trim()) patch.name = b.name.trim().slice(0, 40);
  if (b.color && /^#[0-9a-f]{6}$/i.test(b.color)) patch.color = b.color;
  if (typeof b.position === "number") patch.position = b.position;
  if (typeof b.done === "boolean") patch.done = b.done;
  const { error } = await supabaseAdmin().from("task_columns").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
});

// Apaga a coluna e os cartões dela (a tela pede confirmação antes).
export const DELETE = route<IdCtx>(async (_req, { params }) => {
  const { id } = await params;
  const { error } = await supabaseAdmin().from("task_columns").delete().eq("id", id);
  if (error) throw new Error(error.message);
});
