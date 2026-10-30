import { HttpError, route } from "@/lib/api";
import { PERMS } from "@/lib/perms";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Equipe (só administrador): atendentes com e-mail, papel, permissões e situação. */
export const GET = route(async () => {
  const db = supabaseAdmin();
  const [{ data: agents, error }, users] = await Promise.all([
    db.from("agents").select("*").order("created_at"),
    db.auth.admin.listUsers({ perPage: 200 }),
  ]);
  if (error) throw new Error(error.message);
  const emails = new Map((users.data?.users ?? []).map((u) => [u.id, u.email ?? ""]));
  return {
    perms: Object.entries(PERMS).map(([key, p]) => ({ key, ...p })),
    agents: (agents ?? []).map((a) => ({ ...a, email: emails.get(a.id) ?? "" })),
  };
});

/** Cadastra um novo atendente com e-mail e senha inicial (ele pode trocar depois). */
export const POST = route(async (req) => {
  const b = (await req.json()) as { name?: string; email?: string; password?: string; role?: string; permissions?: Record<string, boolean> };
  const name = b.name?.trim(), email = b.email?.trim().toLowerCase();
  if (!name || !email) throw new HttpError(400, "informe nome e e-mail");
  if (!b.password || b.password.length < 8) throw new HttpError(400, "a senha inicial precisa ter pelo menos 8 caracteres");
  const db = supabaseAdmin();
  const { data, error } = await db.auth.admin.createUser({ email, password: b.password, email_confirm: true, user_metadata: { name } });
  if (error) throw new HttpError(400, /already|registered|exists/i.test(error.message) ? "já existe um usuário com esse e-mail" : error.message);
  const id = data.user.id;
  const { error: e2 } = await db
    .from("agents")
    .upsert({ id, name, role: b.role === "admin" ? "admin" : "agent", permissions: b.permissions ?? {}, active: true });
  if (e2) throw new Error(e2.message);
  return { id };
});
