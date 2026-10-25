import { HttpError, route, type IdCtx } from "@/lib/api";
import { deleteConnection, getConnection, requireEvolution, syncState, updateConnection } from "@/lib/connections";
import { EvolutionProvider } from "@/lib/whatsapp/evolution";

function webhookUrl(req: Request, instance: string) {
  const host = req.headers.get("x-forwarded-host");
  const origin =
    process.env.RENDER_EXTERNAL_URL ??
    (host ? `${req.headers.get("x-forwarded-proto") ?? "https"}://${host}` : new URL(req.url).origin);
  return `${origin}/api/webhooks/whatsapp?token=${encodeURIComponent(process.env.WEBHOOK_SECRET ?? "")}&instance=${instance}`;
}

async function load(params: IdCtx["params"]) {
  requireEvolution();
  const conn = await getConnection((await params).id);
  if (!conn) throw new HttpError(404, "número não encontrado");
  return conn;
}

// Situação do número (a tela consulta enquanto o QR Code está aberto).
export const GET = route<IdCtx>(async (_req, { params }) => syncState(await load(params)));

// Troca o nome ou o departamento.
export const PATCH = route<IdCtx>(async (req, { params }) => {
  const conn = await load(params);
  const { name, department_id } = (await req.json()) as { name?: string; department_id?: string | null };
  if (name !== undefined && !name.trim()) throw new HttpError(400, "informe um nome para o número");
  return updateConnection(conn.id, {
    ...(name !== undefined && { name: name.trim() }),
    ...(department_id !== undefined && { department_id: department_id || null }),
  });
});

// action "connect": gera o QR Code (ou só religa o webhook se já está conectado).
// action "logout": desconecta o celular, mas mantém o card para conectar de novo.
export const POST = route<IdCtx>(async (req, { params }) => {
  const conn = await load(params);
  const { action } = (await req.json()) as { action?: string };
  const evolution = new EvolutionProvider(conn.instance);
  if (action === "logout") {
    await evolution.logout();
    return updateConnection(conn.id, { connected_at: null });
  }
  if (!process.env.WEBHOOK_SECRET) throw new HttpError(500, "WEBHOOK_SECRET não configurado");
  return evolution.connect(webhookUrl(req, conn.instance));
});

// Remove o número: apaga a instância na Evolution API. As conversas antigas continuam no sistema.
export const DELETE = route<IdCtx>(async (_req, { params }) => {
  const conn = await load(params);
  await new EvolutionProvider(conn.instance).remove();
  await deleteConnection(conn.id);
});
