import { HttpError, route } from "@/lib/api";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const GET = route(async () => {
  const { data, error } = await supabaseAdmin().from("quick_replies").select("*").order("shortcut");
  if (error) throw new Error(error.message);
  return data;
});

export const POST = route(async (req) => {
  const { shortcut, body } = (await req.json()) as { shortcut?: string; body?: string };
  const clean = shortcut?.trim().replace(/^\//, "").toLowerCase();
  if (!clean || !body?.trim()) throw new HttpError(400, "atalho e texto são obrigatórios");
  const { data, error } = await supabaseAdmin()
    .from("quick_replies")
    .upsert({ shortcut: clean, body: body.trim() }, { onConflict: "shortcut" })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
});
