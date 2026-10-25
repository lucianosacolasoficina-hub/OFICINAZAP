import { route } from "@/lib/api";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const GET = route(async () => {
  const { data, error } = await supabaseAdmin()
    .from("quotes")
    .select("*, contact:contacts(name, phone)")
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return data;
});
