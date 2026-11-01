import { route, HttpError, type IdCtx } from "@/lib/api";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const GET = route<IdCtx>(async (_req, { params }) => {
  const { id } = await params;
  const { data, error } = await supabaseAdmin().from("task_comments").select("id, body, created_at, agent:agents(name)").eq("card_id", id).order("created_at");
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const POST = route<IdCtx>(async (req, { params }, userId) => {
  const { id } = await params;
  const { body } = (await req.json()) as { body?: string };
  if (!body?.trim()) throw new HttpError(400, "escreva o comentário");
  const { data, error } = await supabaseAdmin().from("task_comments").insert({ card_id: id, agent_id: userId, body: body.trim().slice(0, 3000) }).select("id, body, created_at, agent:agents(name)").single();
  if (error) throw new Error(error.message);
  return data;
});
