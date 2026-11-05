import { NextResponse } from "next/server";
import { emailDaGestao } from "@/lib/gestaoAuth";
import { estaAberto } from "@/lib/rascunhosAoVivo";

// O sistema de gestão pergunta (com o token da sessão dele) se o OficinaZap deste usuário já está
// aberto. Se estiver, a mensagem vai para a aba aberta e o sistema não abre outra janela.
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
  return NextResponse.json({ aberto: estaAberto(email) }, { headers: h });
}
