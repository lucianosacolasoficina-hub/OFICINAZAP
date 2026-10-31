import { after, NextResponse } from "next/server";
import { handleIncoming } from "@/lib/inbound";
import { whatsapp } from "@/lib/whatsapp";
import { EvolutionProvider } from "@/lib/whatsapp/evolution";
import { connectionByInstance } from "@/lib/connections";
import { importarMensagens, registrarEnviada } from "@/lib/historico";

export const maxDuration = 60;

// Verificação do webhook pela Meta (só é usada com a API oficial).
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  if (params.get("hub.mode") === "subscribe" && params.get("hub.verify_token") === process.env.META_VERIFY_TOKEN) {
    return new Response(params.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const provider = whatsapp();
  const raw = await req.text();
  if (!(await provider.verifyWebhook(req, raw))) {
    return NextResponse.json({ error: "assinatura inválida" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "json inválido" }, { status: 400 });
  }

  // Responde logo ao provedor e processa depois (a IA pode levar alguns segundos).
  // Com vários números, o webhook de cada um traz o nome da instância na URL (reserva, caso não venha no corpo).
  const instance = new URL(req.url).searchParams.get("instance") ?? undefined;
  const incoming = provider.parseWebhook(payload).map((m) => ({ ...m, instance: m.instance ?? instance }));
  // Conversas antigas (histórico) que o WhatsApp manda logo depois de conectar.
  const hist = EvolutionProvider.parseHistorySet(payload);
  if (hist.msgs.length) {
    after(async () => {
      try {
        const conn = await connectionByInstance(hist.instance ?? instance ?? "");
        if (conn) await importarMensagens(conn, hist.msgs);
      } catch (err) {
        console.error("Erro ao importar histórico", err);
      }
    });
    return NextResponse.json({ ok: true, historico: hist.msgs.length });
  }
  // Enviada pelo celular do número (fromMe): guarda como mensagem enviada.
  const meu = EvolutionProvider.parseSentByMe(payload);
  if (meu.msg) {
    const enviada = meu.msg;
    after(async () => {
      try {
        // Espera um pouco: se saiu pelo OficinaZap, ela já foi gravada e não duplica.
        await new Promise((r) => setTimeout(r, 4000));
        const conn = await connectionByInstance(meu.instance ?? instance ?? "");
        if (conn) await registrarEnviada(conn, enviada);
      } catch (err) {
        console.error("Erro ao guardar mensagem enviada pelo celular", err);
      }
    });
    return NextResponse.json({ ok: true, enviada: true });
  }
  after(async () => {
    for (const msg of incoming) {
      try {
        await handleIncoming(msg);
      } catch (err) {
        console.error("Erro ao processar mensagem", msg.waMessageId, err);
      }
    }
  });
  return NextResponse.json({ ok: true });
}
