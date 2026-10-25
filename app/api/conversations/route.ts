import { route } from "@/lib/api";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const GET = route(async (req) => {
  const status = new URL(req.url).searchParams.get("status");
  let query = supabaseAdmin()
    .from("conversations")
    .select("*, contact:contacts(*)")
    .order("last_message_at", { ascending: false })
    .limit(200);
  if (status === "active") query = query.neq("status", "closed");
  else if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
});
