import { route } from "@/lib/api";
import { buscarClientesGestao } from "@/lib/gestao";

// Busca clientes do sistema de gestão por nome, CNPJ/CPF ou telefone (para vincular à conversa).
export const GET = route(async (req) => {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return { clientes: [] };
  return { clientes: (await buscarClientesGestao(q)) ?? [] };
});
