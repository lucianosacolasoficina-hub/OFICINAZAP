import { HttpError, route } from "@/lib/api";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Departamentos com os atendentes de cada um, e a lista de todos os atendentes. */
export const GET = route(async () => {
  const db = supabaseAdmin();
  const [departments, members, agents] = await Promise.all([
    db.from("departments").select("*").order("name"),
    db.from("department_agents").select("department_id, agent_id"),
    db.from("agents").select("id, name").order("name"),
  ]);
  const error = departments.error ?? members.error ?? agents.error;
  if (error) throw new Error(error.message);
  return {
    departments: (departments.data ?? []).map((d) => ({
      ...d,
      agent_ids: (members.data ?? []).filter((m) => m.department_id === d.id).map((m) => m.agent_id),
    })),
    agents: agents.data,
  };
});

export const POST = route(async (req) => {
  const { name, description, color } = (await req.json()) as { name?: string; description?: string; color?: string };
  if (!name?.trim()) throw new HttpError(400, "o nome do departamento é obrigatório");
  const { data, error } = await supabaseAdmin()
    .from("departments")
    .insert({ name: name.trim(), description: description?.trim() ?? "", ...(color ? { color } : {}) })
    .select()
    .single();
  if (error?.code === "23505") throw new HttpError(400, "já existe um departamento com esse nome");
  if (error) throw new Error(error.message);
  return data;
});
