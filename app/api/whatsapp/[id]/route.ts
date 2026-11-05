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

// action "renovar": só a imagem nova do QR Code (a tela chama a cada 30 segundos).
// action "connect": gera o QR Code (ou só religa o webhook se já está conectado).
// action "logout": desconecta o celular, mas mantém o card para conectar de novo.
export const POST = route<IdCtx>(async (req, { params }) => {
  const conn = await load(params);
  const { action, phone } = (await req.json()) as { action?: string; phone?: string };
  const evolution = new EvolutionProvider(conn.instance);
  if (action === "logout") {
    await evolution.logout();
    return updateConnection(conn.id, { connected_at: null });
  }
  if (action === "renovar") {
    // Renovação automática do QR Code na tela: só pega a imagem atual, sem recriar nada.
    // Se o celular já conectou (o aviso chegou pelo webhook), não mostra QR Code de novo.
    if (conn.connected_at) return { state: "open" };
    return evolution.currentQr();
  }
  if (!process.env.WEBHOOK_SECRET) throw new HttpError(500, "WEBHOOK_SECRET não configurado");
  if (action === "restart") {
    // Religa o webhook e reinicia a sessão: resolve número "conectado" que parou de receber mensagens.
    await evolution.restart();
    await new Promise((r) => setTimeout(r, 4000));
    const r = await evolution.connect(webhookUrl(req, conn.instance));
    return { reiniciado: true, ...r };
  }
  const digits = (phone ?? "").replace(/\D/g, "");
  const num = digits ? (digits.length <= 11 ? "55" + digits : digits) : undefined;
  const r = await evolution.connect(webhookUrl(req, conn.instance), num);
  // Vai pedir QR Code: limpa a marca de "conectado" antiga, para a tela só fechar com a leitura nova.
  if (r.state !== "open" && conn.connected_at) await updateConnection(conn.id, { connected_at: null });
  return r;
});

// Remove o número: apaga a instância na Evolution API. As conversas antigas continuam no sistema.
export const DELETE = route<IdCtx>(async (_req, { params }) => {
  const conn = await load(params);
  await new EvolutionProvider(conn.instance).remove();
  await deleteConnection(conn.id);
});
