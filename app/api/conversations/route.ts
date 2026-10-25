import { route } from "@/lib/api";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const GET = route(async (req, _ctx, userId) => {
  const params = new URL(req.url).searchParams;
  const status = params.get("status");
  const department = params.get("department");
  const db = supabaseAdmin();
  let query = db
    .from("conversations")
    .select("*, contact:contacts(*), department:departments(id, name, color)")
    .order("last_message_at", { ascending: false })
    .limit(200);
  if (status === "active") query = query.neq("status", "closed");
  else if (status) query = query.eq("status", status);

  if (department === "none") query = query.is("department_id", null);
  else if (department === "mine") {
    // Conversas dos departamentos do atendente logado, mais as que ele mesmo está atendendo.
    const { data: mine, error } = await db.from("department_agents").select("department_id").eq("agent_id", userId);
    if (error) throw new Error(error.message);
    const ids = mine.map((m) => m.department_id);
    query = ids.length
      ? query.or(`department_id.in.(${ids.join(",")}),assigned_to.eq.${userId}`)
      : query.eq("assigned_to", userId);
  } else if (department) query = query.eq("department_id", department);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
});
