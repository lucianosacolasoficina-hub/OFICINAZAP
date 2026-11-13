import { after, NextResponse } from "next/server";
import { handleIncoming } from "@/lib/inbound";
import { whatsapp } from "@/lib/whatsapp";
import { EvolutionProvider } from "@/lib/whatsapp/evolution";
import { connectionByInstance, religarConversas, updateConnection } from "@/lib/connections";
import { importarMensagens, naFilaDoHistorico, registrarEnviada } from "@/lib/historico";
import { completarLid } from "@/lib/recuperar";
import { aplicarEntrega } from "@/lib/db";

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

  // Celular terminou de conectar (depois de ler o QR Code): marca o número como conectado na hora,
  // para a janela do QR Code fechar sozinha mesmo que a Evolution esteja lenta para responder.
  const conexao = EvolutionProvider.parseConnectionUpdate(payload);
  if (conexao) {
    if (conexao.state === "open") {
      try {
        const conn = await connectionByInstance(conexao.instance ?? new URL(req.url).searchParams.get("instance") ?? "");
        if (conn && (!conn.connected_at || (conexao.phone && conn.phone !== conexao.phone))) {
          await updateConnection(conn.id, {
            connected_at: conn.connected_at ?? new Date().toISOString(),
            ...(conexao.phone && { phone: conexao.phone }),
          });
        }
        // Antes do histórico chegar: as conversas de um card antigo deste celular voltam para ele.
        if (conn) await religarConversas({ id: conn.id, phone: conexao.phone ?? conn.phone });
      } catch (err) {
        console.error("Erro ao marcar número conectado", err);
      }
    }
    return NextResponse.json({ ok: true });
  }

  // Tracinhos: mensagem nossa entregue ou lida pelo cliente.
  const entregas = EvolutionProvider.parseStatusUpdate(payload);
  if (entregas.length) {
    after(async () => {
      for (const e of entregas) {
        try {
          // O aviso pode chegar antes de a mensagem ser gravada (logo depois do envio): tenta de novo em instantes.
          if (!(await aplicarEntrega(e.id, e.entrega))) {
            await new Promise((r) => setTimeout(r, 5000));
            await aplicarEntrega(e.id, e.entrega);
          }
        } catch (err) {
          console.error("Erro ao marcar tracinho", e.id, err);
        }
      }
    });
    return NextResponse.json({ ok: true, entregas: entregas.length });
  }
  if ((payload as { event?: string })?.event === "messages.update") return NextResponse.json({ ok: true });

  // Contato com número oculto (@lid) e sem o número junto: completa com o número já conhecido.
  const up = payload as { event?: string; data?: { key?: { remoteJid?: string; remoteJidAlt?: string; senderPn?: string }; pushName?: string | null } };
  if (up?.event === "messages.upsert" && up.data?.key) await completarLid(up.data.key, up.data);

  // Responde logo ao provedor e processa depois (a IA pode levar alguns segundos).
  // Com vários números, o webhook de cada um traz o nome da instância na URL (reserva, caso não venha no corpo).
  const instance = new URL(req.url).searchParams.get("instance") ?? undefined;
  const incoming = provider.parseWebhook(payload).map((m) => ({ ...m, instance: m.instance ?? instance }));
  // Conversas antigas (histórico) que o WhatsApp manda logo depois de conectar.
  const hist = EvolutionProvider.parseHistorySet(payload);
  if (hist.msgs.length) {
    // Um bloco por vez (ver naFilaDoHistorico): vários ao mesmo tempo derrubavam o servidor.
    after(() =>
      naFilaDoHistorico(async () => {
        const conn = await connectionByInstance(hist.instance ?? instance ?? "");
        if (conn) await religarConversas(conn).catch(() => 0);
        if (conn) await importarMensagens(conn, hist.msgs);
      }),
    );
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
