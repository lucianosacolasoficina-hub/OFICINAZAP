import { route } from "@/lib/api";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const GET = route(async (req) => {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  let query = supabaseAdmin().from("contacts").select("*").order("created_at", { ascending: false }).limit(500);
  if (q) {
    const safe = q.replace(/[%,()]/g, "");
    query = query.or(`name.ilike.%${safe}%,phone.ilike.%${safe}%`);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
});
