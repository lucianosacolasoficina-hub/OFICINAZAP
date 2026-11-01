import { route, HttpError, type IdCtx } from "@/lib/api";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const PATCH = route<IdCtx>(async (req, { params }) => {
  const { id } = await params;
  const { name } = (await req.json()) as { name?: string };
  if (!name?.trim()) throw new HttpError(400, "dê um nome ao quadro");
  const { error } = await supabaseAdmin().from("task_boards").update({ name: name.trim().slice(0, 60) }).eq("id", id);
  if (error) throw new Error(error.message);
});

// Apagar o quadro inteiro (com colunas e cartões): só o administrador.
export const DELETE = route<IdCtx>(async (_req, { params }) => {
  const { id } = await params;
  const { error } = await supabaseAdmin().from("task_boards").delete().eq("id", id);
  if (error) throw new Error(error.message);
});
