import { NextResponse } from "next/server";
import { signedMediaUrl } from "@/lib/media";
import { buscarMidiaFaltando } from "@/lib/midiaFaltando";
import { currentUser } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getAgent, podeAbrirConversa } from "@/lib/perms";

const NEGADO = "este arquivo é de um número de WhatsApp que não foi liberado para você";

// Abre um arquivo da conversa (link temporário do Storage).
// ?path=... arquivo já guardado; ?msg=<id da mensagem> busca no WhatsApp quando ainda não foi guardado.
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const agent = await getAgent(user.id);
  if (agent && !agent.active) return NextResponse.json({ error: "acesso desativado" }, { status: 403 });

  let path = q.get("path");
  const msgId = q.get("msg");
  if (msgId) {
    if (!/^[0-9a-f-]{36}$/.test(msgId)) return NextResponse.json({ error: "mensagem inválida" }, { status: 400 });
    const { data: m } = await supabaseAdmin()
      .from("messages")
      .select("id, conversation_id, media_type, media_url, wa_message_id")
      .eq("id", msgId)
      .maybeSingle();
    if (!m) return NextResponse.json({ error: "mensagem não encontrada" }, { status: 404 });
    if (agent?.canais && !(await podeAbrirConversa(agent, m.conversation_id))) return NextResponse.json({ error: NEGADO }, { status: 403 });
    path = await buscarMidiaFaltando(m).catch((err) => {
      console.error("Falha ao buscar mídia", msgId, err);
      return null;
    });
    if (!path) return NextResponse.json({ error: "o WhatsApp não tem mais este arquivo" }, { status: 404 });
  } else {
    if (!path || path.includes("..")) return NextResponse.json({ error: "caminho inválido" }, { status: 400 });
    // O arquivo fica na pasta da conversa: atendente só abre os das conversas dos números liberados para ele.
    const conv = path.split("/")[0];
    if (agent?.canais && (!/^[0-9a-f-]{36}$/.test(conv) || !(await podeAbrirConversa(agent, conv)))) {
      return NextResponse.json({ error: NEGADO }, { status: 403 });
    }
  }
  const url = await signedMediaUrl(path);
  if (!url) return NextResponse.json({ error: "arquivo não encontrado" }, { status: 404 });
  return NextResponse.redirect(url);
}
