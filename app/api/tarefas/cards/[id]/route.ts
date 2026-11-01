import { route, type IdCtx } from "@/lib/api";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Edita ou move o cartão (arrastar entre colunas).
export const PATCH = route<IdCtx>(async (req, { params }) => {
  const { id } = await params;
  const b = (await req.json()) as {
    title?: string;
    description?: string | null;
    assignee?: string | null;
    due_date?: string | null;
    column_id?: string;
    position?: number;
    labels?: string[];
    checklist?: { t: string; ok: boolean }[];
  };
  const db = supabaseAdmin();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (b.title?.trim()) patch.title = b.title.trim().slice(0, 200);
  if (b.description !== undefined) patch.description = b.description?.slice(0, 5000) ?? null;
  if (b.assignee !== undefined) patch.assignee = b.assignee || null;
  if (b.due_date !== undefined) patch.due_date = b.due_date || null;
  if (typeof b.position === "number") patch.position = b.position;
  if (Array.isArray(b.labels)) patch.labels = b.labels.map((l) => String(l).slice(0, 30)).slice(0, 10);
  if (Array.isArray(b.checklist)) patch.checklist = b.checklist.slice(0, 50).map((c) => ({ t: String(c.t).slice(0, 200), ok: !!c.ok }));
  if (b.column_id) {
    const { data: col } = await db.from("task_columns").select("id, done").eq("id", b.column_id).maybeSingle();
    if (col) {
      patch.column_id = col.id;
      patch.done_at = col.done ? new Date().toISOString() : null;
    }
  }
  const { data, error } = await db.from("task_cards").update(patch).eq("id", id).select("*").single();
  if (error) throw new Error(error.message);
  return data;
});

export const DELETE = route<IdCtx>(async (_req, { params }) => {
  const { id } = await params;
  const { error } = await supabaseAdmin().from("task_cards").delete().eq("id", id);
  if (error) throw new Error(error.message);
});
