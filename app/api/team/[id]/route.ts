import { HttpError, route, type IdCtx } from "@/lib/api";
import { limparCacheAgent } from "@/lib/perms";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Altera nome, papel, permissões, situação (ativo) ou senha de um atendente. */
export const PATCH = route(async (req, ctx: IdCtx, userId) => {
  const { id } = await ctx.params;
  const b = (await req.json()) as { name?: string; role?: string; permissions?: Record<string, boolean>; active?: boolean; password?: string };
  const db = supabaseAdmin();
  if (id === userId && (b.active === false || b.role === "agent")) {
    throw new HttpError(400, "você não pode tirar o seu próprio acesso de administrador");
  }
  const patch: Record<string, unknown> = {};
  if (typeof b.name === "string" && b.name.trim()) patch.name = b.name.trim();
  if (b.role === "admin" || b.role === "agent") patch.role = b.role;
  if (b.permissions && typeof b.permissions === "object") patch.permissions = b.permissions;
  if (typeof b.active === "boolean") patch.active = b.active;
  limparCacheAgent();
  if (Object.keys(patch).length) {
    const { error } = await db.from("agents").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
  }
  if (b.password) {
    if (b.password.length < 8) throw new HttpError(400, "a senha precisa ter pelo menos 8 caracteres");
    const { error } = await db.auth.admin.updateUserById(id, { password: b.password });
    if (error) throw new HttpError(400, error.message);
  }
});
