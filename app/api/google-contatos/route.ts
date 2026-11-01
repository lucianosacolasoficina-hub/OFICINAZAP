import { route, HttpError } from "@/lib/api";
import { getAgent } from "@/lib/perms";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sincronizarGoogle } from "@/lib/googleSync";

export const maxDuration = 300;

// Situação da ligação com o Google Contatos.
export const GET = route(async () => {
  const db = supabaseAdmin();
  const [{ data: c }, ligados] = await Promise.all([
    db.from("google_contatos").select("address, last_sync, last_error, stats, refresh_token").eq("id", 1).maybeSingle(),
    db.from("contacts").select("id", { count: "exact", head: true }).like("google_resource", "people/%"),
  ]);
  return { conectado: !!c?.refresh_token, conta: c?.address ?? null, ultima: c?.last_sync ?? null, erro: c?.last_error ?? null, stats: c?.stats ?? null, ligados: ligados.count ?? 0 };
});

// Sincronizar agora (só administrador). ?completo=1 relê todos os contatos do Google.
export const POST = route(async (req, _ctx, userId) => {
  const ag = await getAgent(userId);
  if (ag && ag.role !== "admin") throw new HttpError(403, "só o administrador sincroniza os contatos com o Google");
  return sincronizarGoogle({ completo: new URL(req.url).searchParams.get("completo") === "1" });
});

// Desligar (não apaga nada no Google nem aqui).
export const DELETE = route(async (_req, _ctx, userId) => {
  const ag = await getAgent(userId);
  if (ag && ag.role !== "admin") throw new HttpError(403, "só o administrador pode desligar");
  await supabaseAdmin().from("google_contatos").delete().eq("id", 1);
  return { ok: true };
});
