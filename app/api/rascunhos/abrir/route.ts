import { NextResponse } from "next/server";
import { emailDaGestao } from "@/lib/gestaoAuth";
import { normalizePhone } from "@/lib/phone";
import { entregar, estaAberto } from "@/lib/rascunhosAoVivo";

// O sistema de gestão pede para abrir algo no OficinaZap que já está aberto (conversa do cliente
// pelo telefone, ou uma lista como "pendentes"), sem mensagem pronta. Se a aba estiver aberta, o
// pedido vai direto para ela e o sistema não abre outra janela. Autoriza pelo token do sistema.
function cors(req: Request) {
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
  const form = await req.formData().catch(() => null);
  const email = await emailDaGestao(String(form?.get("token") ?? ""));
  if (!email) return NextResponse.json({ aberto: false, error: "sessão inválida" }, { status: 401, headers: h });
  const tel = normalizePhone(String(form?.get("tel") ?? "")) ?? "";
  const nome = String(form?.get("nome") ?? "").slice(0, 80);
  const v = String(form?.get("v") ?? "").replace(/[^a-z]/g, "").slice(0, 20);
  const aberto = estaAberto(email);
  if (aberto) entregar(email, { id: "", tel, nome, v, em: Date.now() });
  return NextResponse.json({ aberto }, { headers: h });
}
