import { route, type IdCtx } from "@/lib/api";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const PATCH = route<IdCtx>(async (req, { params }) => {
  const { id } = await params;
  const body = (await req.json()) as { name?: string; tags?: string[]; notes?: string };
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = body.name.trim() || null;
  if (body.notes !== undefined) patch.notes = body.notes;
  if (body.tags !== undefined) {
    patch.tags = [...new Set(body.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
  }
  const { data, error } = await supabaseAdmin().from("contacts").update(patch).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return data;
});
