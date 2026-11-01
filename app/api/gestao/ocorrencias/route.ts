import { HttpError, route } from "@/lib/api";
import { getAgent } from "@/lib/perms";
import { gestaoAtiva, lancarOcorrenciaGestao, ocorrenciasGestao } from "@/lib/gestao";

const COLS = ["pedidos", "orcamentos"] as const;
type Col = (typeof COLS)[number];
const col = (v: string | null): Col => {
  if (!v || !COLS.includes(v as Col)) throw new HttpError(400, "tipo inválido");
  return v as Col;
};

// Ocorrências de um pedido/orçamento do sistema de gestão.
export const GET = route(async (req) => {
  if (!gestaoAtiva()) throw new HttpError(400, "ligação com o sistema de gestão não configurada");
  const u = new URL(req.url);
  const id = u.searchParams.get("id");
  if (!id) throw new HttpError(400, "informe o pedido");
  const r = await ocorrenciasGestao(col(u.searchParams.get("col")), id);
  if (!r) throw new HttpError(502, "o sistema de gestão não respondeu");
  return r;
});

// Lança uma ocorrência nova (fica registrada no pedido/orçamento do sistema de gestão).
export const POST = route(async (req, _ctx, userId) => {
  if (!gestaoAtiva()) throw new HttpError(400, "ligação com o sistema de gestão não configurada");
  const b = (await req.json()) as { col?: string; id?: string; texto?: string; tipo?: string };
  const texto = b.texto?.trim();
  if (!b.id || !texto) throw new HttpError(400, "escreva a ocorrência");
  const agent = await getAgent(userId);
  const r = await lancarOcorrenciaGestao(col(b.col ?? null), b.id, texto.slice(0, 2000), b.tipo || "nota", `${agent?.name ?? "Atendente"} (OficinaZap)`);
  if (!r?.ok) throw new HttpError(502, "não consegui lançar no sistema de gestão");
  return r;
});
