import { route, HttpError } from "@/lib/api";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { gestaoAtiva, historicoGestao, GESTAO_SITE } from "@/lib/gestao";

// Histórico de pedidos e propostas do cliente da conversa (vínculo manual ou pelo telefone).
export const GET = route(async (req) => {
  if (!gestaoAtiva()) return { ativo: false };
  const contactId = new URL(req.url).searchParams.get("contact_id");
  if (!contactId) throw new HttpError(400, "informe o contato");
  const { data: ct, error } = await supabaseAdmin()
    .from("contacts")
    .select("id, phone, is_group, gestao_cliente_id, gestao_cliente_nome")
    .eq("id", contactId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!ct) throw new HttpError(404, "contato não encontrado");
  const vinculado = !!ct.gestao_cliente_id;
  const dados = vinculado || (!ct.is_group && !String(ct.phone).startsWith("ig:")) ? await historicoGestao({ cliente: ct.gestao_cliente_id, telefone: vinculado || String(ct.phone).startsWith("ig:") ? null : ct.phone }) : null;
  return {
    ativo: true,
    site: GESTAO_SITE,
    grupo: !!ct.is_group,
    vinculo: vinculado ? { id: ct.gestao_cliente_id, nome: ct.gestao_cliente_nome } : null,
    ...(dados ?? { cliente: null, pedidos: [], propostas: [], via: null }),
  };
});
