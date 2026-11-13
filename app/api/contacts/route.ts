import { route } from "@/lib/api";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Lista de contatos. A tela Contatos usa sem parâmetros; a "Nova conversa" da Central usa
// whats=1 (só contatos de WhatsApp, sem grupos), ordem=nome e paginação (limit/offset).
export const GET = route(async (req) => {
  const sp = new URL(req.url).searchParams;
  const q = sp.get("q")?.trim();
  const whats = sp.get("whats") === "1";
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 500, 1), 500);
  const offset = Math.max(Number(sp.get("offset")) || 0, 0);
  let query = supabaseAdmin().from("contacts").select("*");
  query =
    sp.get("ordem") === "nome"
      ? query.order("name", { ascending: true, nullsFirst: false }).order("phone")
      : query.order("created_at", { ascending: false });
  query = query.range(offset, offset + limit - 1);
  if (whats) query = query.eq("is_group", false).filter("phone", "match", "^[0-9]{10,15}$");
  if (q) {
    const safe = q.replace(/[%,()*:"\\]/g, " ").trim();
    const digitos = safe.replace(/\D/g, "");
    // Só número (ex.: "(77) 9944-6208"): procura pelos dígitos, do jeito que o telefone fica salvo.
    if (digitos && !/[a-zà-ú]/i.test(safe)) query = query.ilike("phone", `%${digitos}%`);
    else if (safe) query = query.or(`name.ilike.%${safe}%,phone.ilike.%${safe}%`);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
});
