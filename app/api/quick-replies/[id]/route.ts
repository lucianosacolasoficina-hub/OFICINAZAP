import { route, type IdCtx } from "@/lib/api";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const DELETE = route<IdCtx>(async (_req, { params }) => {
  const { id } = await params;
  const { error } = await supabaseAdmin().from("quick_replies").delete().eq("id", id);
  if (error) throw new Error(error.message);
});
