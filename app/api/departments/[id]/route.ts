import { HttpError, route, type IdCtx } from "@/lib/api";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const PATCH = route<IdCtx>(async (req, { params }) => {
  const { id } = await params;
  const body = (await req.json()) as { name?: string; description?: string; color?: string; active?: boolean; agent_ids?: string[] };
  const db = supabaseAdmin();

  const patch: Record<string, string | boolean> = {};
  if (typeof body.name === "string") {
    if (!body.name.trim()) throw new HttpError(400, "o nome do departamento é obrigatório");
    patch.name = body.name.trim();
  }
  if (typeof body.description === "string") patch.description = body.description.trim();
  if (typeof body.color === "string") patch.color = body.color;
  if (typeof body.active === "boolean") patch.active = body.active;
  if (Object.keys(patch).length) {
    const { error } = await db.from("departments").update(patch).eq("id", id);
    if (error?.code === "23505") throw new HttpError(400, "já existe um departamento com esse nome");
    if (error) throw new Error(error.message);
  }

  // Troca a lista inteira de atendentes do departamento.
  if (Array.isArray(body.agent_ids)) {
    const del = await db.from("department_agents").delete().eq("department_id", id);
    if (del.error) throw new Error(del.error.message);
    if (body.agent_ids.length) {
      const ins = await db
        .from("department_agents")
        .insert(body.agent_ids.map((agent_id) => ({ department_id: id, agent_id })));
      if (ins.error) throw new Error(ins.error.message);
    }
  }
});

export const DELETE = route<IdCtx>(async (_req, { params }) => {
  const { id } = await params;
  // As conversas do departamento continuam existindo, só ficam sem departamento.
  const { error } = await supabaseAdmin().from("departments").delete().eq("id", id);
  if (error) throw new Error(error.message);
});
