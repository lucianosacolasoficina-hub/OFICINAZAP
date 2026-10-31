import { after } from "next/server";
import { HttpError, route, type IdCtx } from "@/lib/api";
import { getConnection, requireEvolution } from "@/lib/connections";
import { getSetting } from "@/lib/db";
import { puxarHistorico } from "@/lib/historico";
import { EvolutionProvider } from "@/lib/whatsapp/evolution";

export const maxDuration = 300;

async function load(params: IdCtx["params"]) {
  requireEvolution();
  const conn = await getConnection((await params).id);
  if (!conn) throw new HttpError(404, "número não encontrado");
  return conn;
}

// Andamento da última vez que puxou o histórico deste número.
export const GET = route<IdCtx>(async (_req, { params }) => {
  const conn = await load(params);
  return (await getSetting(`historico_${conn.id}`, null)) ?? { status: "nunca" };
});

// Puxa as conversas antigas guardadas e liga o histórico completo para a próxima conexão.
export const POST = route<IdCtx>(async (req, { params }) => {
  const conn = await load(params);
  const { dias = 30 } = (await req.json().catch(() => ({}))) as { dias?: number };
  const ev = new EvolutionProvider(conn.instance);
  const historicoCompleto = await ev.ligarHistoricoCompleto().catch(() => false);
  after(() => puxarHistorico(conn, Math.min(Math.max(Number(dias) || 30, 1), 3650)));
  return { iniciado: true, historicoCompleto };
});
