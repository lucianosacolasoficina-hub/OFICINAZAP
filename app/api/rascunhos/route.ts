import { NextResponse } from "next/server";
import { emailDaGestao } from "@/lib/gestaoAuth";
import { RASCUNHO_MAX_BYTES, salvarRascunho } from "@/lib/rascunhos";
import { normalizePhone } from "@/lib/phone";
import { entregar, estaAberto } from "@/lib/rascunhosAoVivo";

// O sistema de gestão deixa aqui uma mensagem pronta (texto + PDF/Excel) para o atendente enviar
// pela conversa do cliente no OficinaZap. Quem chama manda o token da sessão do sistema de gestão
// (o mesmo do acesso sem senha) — por isso esta rota não exige o login do OficinaZap.
// Em seguida o sistema abre /abrir?tel=…&r=<id> (ou /api/auth/sso com r=<id>).

const MIMES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

function cors(req: Request) {
  // Só o token do sistema de gestão autoriza (não há cookie), então qualquer origem pode chamar.
  return {
    "Access-Control-Allow-Origin": req.headers.get("origin") || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  };
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: cors(req) });
}

export async function POST(req: Request) {
  const h = cors(req);
  const erro = (status: number, error: string) => NextResponse.json({ error }, { status, headers: h });
  const form = await req.formData().catch(() => null);
  if (!form) return erro(400, "envie como multipart/form-data");
  const token = String(form.get("token") ?? "");
  const email = token ? await emailDaGestao(token) : null;
  if (!email) return erro(401, "sessão do sistema de gestão inválida — entre de novo no sistema");

  const texto = String(form.get("texto") ?? "").slice(0, 4000);
  const tel = normalizePhone(String(form.get("tel") ?? "")) ?? "";
  const nome = String(form.get("nome") ?? "").slice(0, 80);
  const f = form.get("arquivo");
  let arquivo: { nome: string; mimeType: string; data: Buffer } | null = null;
  if (f && typeof f !== "string") {
    const mime = (f.type || "").split(";")[0] || "application/octet-stream";
    if (!MIMES.has(mime)) return erro(400, "tipo de arquivo não aceito (use PDF, Excel, Word, CSV ou imagem)");
    if (f.size > RASCUNHO_MAX_BYTES) return erro(400, "arquivo muito grande (máximo 15 MB)");
    arquivo = { nome: String(form.get("nomeArquivo") || f.name || "arquivo"), mimeType: mime, data: Buffer.from(await f.arrayBuffer()) };
  }
  if (!texto && !arquivo) return erro(400, "rascunho vazio");
  const r = await salvarRascunho({ texto, tel, nome, arquivo });
  // OficinaZap deste atendente já aberto: a mensagem vai direto para a aba aberta (sem abrir outra janela).
  const aberto = estaAberto(email);
  if (aberto && String(form.get("aoVivo") ?? "1") !== "0") entregar(email, { id: r.id, tel, nome, em: Date.now() });
  return NextResponse.json({ id: r.id, arquivo: r.arquivo?.nome ?? null, aberto }, { headers: h });
}
