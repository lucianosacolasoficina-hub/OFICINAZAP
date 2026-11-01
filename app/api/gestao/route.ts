import { route, HttpError } from "@/lib/api";
import { consultarGestao, gestaoAtiva, GESTAO_SITE } from "@/lib/gestao";

// Painel: dados do cliente no sistema de gestão (pedidos, etapas e saldo).
export const GET = route(async (req) => {
  if (!gestaoAtiva()) return { ativo: false };
  const p = new URL(req.url).searchParams;
  const tel = p.get("telefone") ?? undefined;
  // Contato do Instagram não tem telefone: não procura por número.
  const telefone = tel && !/^(ig|fb|mail):/.test(tel) ? tel : undefined;
  const pedido = p.get("pedido") ?? undefined;
  if (!telefone && !pedido) return { ativo: true, cliente: null, pedidos: [] };
  const dados = await consultarGestao({ telefone, pedido, staff: true });
  return { ativo: true, site: GESTAO_SITE, ...(dados ?? {}) };
});
