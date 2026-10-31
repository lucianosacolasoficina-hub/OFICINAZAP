import { route, HttpError } from "@/lib/api";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Liga (ou desliga) o contato da conversa a um cliente do sistema de gestão.
export const POST = route(async (req) => {
  const b = (await req.json()) as { contact_id?: string; cliente_id?: string | null; cliente_nome?: string | null };
  if (!b.contact_id) throw new HttpError(400, "informe o contato");
  const patch = b.cliente_id
    ? { gestao_cliente_id: String(b.cliente_id), gestao_cliente_nome: b.cliente_nome ? String(b.cliente_nome).slice(0, 200) : null }
    : { gestao_cliente_id: null, gestao_cliente_nome: null };
  const { error } = await supabaseAdmin().from("contacts").update(patch).eq("id", b.contact_id);
  if (error) throw new Error(error.message);
  return { ok: true };
});
