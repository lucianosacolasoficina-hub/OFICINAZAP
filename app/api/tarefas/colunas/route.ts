import { route, HttpError } from "@/lib/api";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const POST = route(async (req) => {
  const b = (await req.json()) as { board_id?: string; name?: string };
  if (!b.board_id || !b.name?.trim()) throw new HttpError(400, "informe o nome da coluna");
  const db = supabaseAdmin();
  const { data: ult } = await db.from("task_columns").select("position").eq("board_id", b.board_id).order("position", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await db
    .from("task_columns")
    .insert({ board_id: b.board_id, name: b.name.trim().slice(0, 40), position: (ult?.position ?? 0) + 1 })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
});
