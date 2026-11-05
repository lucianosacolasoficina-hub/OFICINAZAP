import { NextResponse } from "next/server";
import { signedMediaUrl } from "@/lib/media";
import { currentUser } from "@/lib/supabase/server";
import { getAgent, podeAbrirConversa } from "@/lib/perms";

// Abre um arquivo recebido no WhatsApp (link temporário do Storage).
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  const path = new URL(req.url).searchParams.get("path");
  if (!path || path.includes("..")) return NextResponse.json({ error: "caminho inválido" }, { status: 400 });
  // O arquivo fica na pasta da conversa: atendente só abre os das conversas dos números liberados para ele.
  const agent = await getAgent(user.id);
  if (agent && !agent.active) return NextResponse.json({ error: "acesso desativado" }, { status: 403 });
  const conv = path.split("/")[0];
  if (agent?.canais && (!/^[0-9a-f-]{36}$/.test(conv) || !(await podeAbrirConversa(agent, conv)))) {
    return NextResponse.json({ error: "este arquivo é de um número de WhatsApp que não foi liberado para você" }, { status: 403 });
  }
  const url = await signedMediaUrl(path);
  if (!url) return NextResponse.json({ error: "arquivo não encontrado" }, { status: 404 });
  return NextResponse.redirect(url);
}
