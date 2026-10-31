// Ligação com o sistema de gestão da Sacolas Oficina (sistema.sacolasoficina.com.br).
// Consulta cliente, pedidos, etapas e saldo pelo telefone ou pelo número do pedido.

export type GestaoPedido = {
  numero: string;
  etapa: string;
  entrada: string;
  entrega: string | null;
  atrasado: boolean;
  total: number;
  aberto: number;
  envio: string;
  itens: string | null;
  os: { numero: string; etapa: string }[];
};

export type GestaoConsulta = {
  cliente: {
    id: string;
    nome: string | null;
    fantasia: string | null;
    documento: string | null;
    cidade: string | null;
    uf: string | null;
    email: string | null;
    responsavel: string | null;
  } | null;
  pedidos: GestaoPedido[];
  aReceber: number;
  creditos: number;
  pedido: (Partial<GestaoPedido> & { cliente?: string; restrito?: boolean; doCliente?: boolean }) | null;
  atualizadoEm: string | null;
};

const URL_GESTAO = process.env.GESTAO_SUPABASE_URL || "https://rfgucnwytkoitawnljju.supabase.co";
export const GESTAO_SITE = process.env.GESTAO_SITE_URL || "https://sistema.sacolasoficina.com.br";

export function gestaoAtiva() {
  return !!(process.env.GESTAO_ZAP_KEY && process.env.GESTAO_SUPABASE_ANON_KEY);
}

/**
 * Consulta o sistema de gestão. `staff` libera a busca de qualquer pedido (uso do painel);
 * sem `staff` (uso da IA) só mostra pedidos do próprio telefone do cliente.
 */
export async function consultarGestao(opts: { telefone?: string; pedido?: string; staff?: boolean }): Promise<GestaoConsulta | null> {
  if (!gestaoAtiva()) return null;
  const res = await fetch(`${URL_GESTAO}/rest/v1/rpc/zap_consulta`, {
    method: "POST",
    headers: {
      apikey: process.env.GESTAO_SUPABASE_ANON_KEY!,
      Authorization: `Bearer ${process.env.GESTAO_SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_chave: process.env.GESTAO_ZAP_KEY,
      p_tel: opts.telefone ?? null,
      p_pedido: opts.pedido ?? null,
      p_staff: !!opts.staff,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    console.error("Gestão respondeu", res.status, await res.text().catch(() => ""));
    return null;
  }
  return (await res.json()) as GestaoConsulta;
}

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dBR = (d?: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "sem data");

/** Resumo em texto para a IA (sem valores, a não ser o saldo quando houver). */
export function resumoParaIA(c: GestaoConsulta | null) {
  if (!c) return "Sistema de gestão indisponível no momento.";
  const linhas: string[] = [];
  if (c.cliente) linhas.push(`Cliente cadastrado: ${c.cliente.fantasia || c.cliente.nome}${c.cliente.cidade ? ` (${c.cliente.cidade})` : ""}.`);
  else linhas.push("Telefone não encontrado no cadastro de clientes.");
  const ativos = c.pedidos.filter((p) => p.etapa !== "Concluído");
  if (ativos.length) {
    linhas.push("Pedidos em andamento:");
    for (const p of ativos) {
      const os = p.os.length ? ` (produção: ${p.os.map((o) => o.etapa).join(", ")})` : "";
      linhas.push(`- Pedido ${p.numero}: etapa "${p.etapa}"${os}; previsão de entrega ${dBR(p.entrega)}${p.atrasado ? " (atrasado)" : ""}; ${p.itens ?? ""}`.trim());
    }
  } else if (c.cliente) linhas.push("Nenhum pedido em andamento.");
  if (c.aReceber > 0.009) linhas.push(`Saldo em aberto do cliente: ${brl(c.aReceber)} (só informe se o cliente perguntar sobre pagamento).`);
  if (c.creditos > 0.009) linhas.push(`Crédito a favor do cliente: ${brl(c.creditos)}.`);
  if (c.pedido) {
    if (c.pedido.restrito) linhas.push(`O pedido ${c.pedido.numero} não pertence a este telefone: não passe informações dele; transfira para um atendente.`);
    else linhas.push(`Pedido ${c.pedido.numero} consultado: etapa "${c.pedido.etapa}", previsão ${dBR(c.pedido.entrega)}${c.pedido.atrasado ? " (atrasado)" : ""}.`);
  }
  return linhas.join("\n");
}

// ---------- Histórico completo do cliente (tela de conversas) ----------
export type HistPedido = {
  id: string; numero: string; etapa: string; entrada: string; entrega: string | null; atrasado: boolean;
  total: number; aberto: number; pagamento: string | null; representada: boolean; nfe: string | null;
  itens: string | null; os: { numero: string; etapa: string }[];
};
export type HistProposta = { id: string; numero: string; data: string; situacao: string | null; total: number; itens: string | null };
export type HistCliente = { id: string; nome: string | null; fantasia?: string | null; documento?: string | null; cidade?: string | null; uf?: string | null; email?: string | null; telefone?: string | null };
export type GestaoHistorico = {
  cliente: HistCliente | null;
  via: "vinculo" | "telefone" | null;
  pedidos: HistPedido[];
  propostas: HistProposta[];
  resumo?: { qtd: number; total: number; primeiro: string | null; ultimo: string | null; andamento: number };
  aReceber?: number;
  creditos?: number;
  atualizadoEm?: string | null;
};
export type ClienteBusca = { id: string; nome: string | null; razao: string | null; documento: string | null; cidade: string | null; telefone: string | null; pedidos: number };

async function rpcGestao<T>(fn: string, body: Record<string, unknown>): Promise<T | null> {
  if (!gestaoAtiva()) return null;
  const res = await fetch(`${URL_GESTAO}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: process.env.GESTAO_SUPABASE_ANON_KEY!,
      Authorization: `Bearer ${process.env.GESTAO_SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_chave: process.env.GESTAO_ZAP_KEY, ...body }),
    cache: "no-store",
  });
  if (!res.ok) {
    console.error(`Gestão ${fn} respondeu`, res.status, await res.text().catch(() => ""));
    return null;
  }
  return (await res.json()) as T;
}

export function historicoGestao(opts: { telefone?: string | null; cliente?: string | null; limite?: number }) {
  return rpcGestao<GestaoHistorico>("zap_historico", { p_tel: opts.telefone ?? null, p_cliente: opts.cliente ?? null, p_limite: opts.limite ?? 100 });
}

export function buscarClientesGestao(q: string) {
  return rpcGestao<ClienteBusca[]>("zap_clientes_busca", { p_q: q });
}
