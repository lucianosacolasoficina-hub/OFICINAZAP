import { after, NextResponse } from "next/server";
import { assinaturaValida, getIgConfig } from "@/lib/instagram";
import { processarInstagram } from "@/lib/instagramInbound";
import { processarMessenger } from "@/lib/messengerInbound";

export const maxDuration = 60;

// Verificação do webhook pela Meta (quando o endereço é cadastrado no app).
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const cfg = await getIgConfig();
  if (p.get("hub.mode") === "subscribe" && cfg.verify_token && p.get("hub.verify_token") === cfg.verify_token) {
    return new Response(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

// Mensagens do Direct: confere a assinatura da Meta, responde logo e processa depois.
export async function POST(req: Request) {
  const raw = await req.text();
  const cfg = await getIgConfig();
  if (!assinaturaValida(raw, req.headers.get("x-hub-signature-256"), cfg.app_secret)) {
    return NextResponse.json({ error: "assinatura inválida" }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "json inválido" }, { status: 400 });
  }
  after(async () => {
    try {
      await processarInstagram(payload as Parameters<typeof processarInstagram>[0]);
      await processarMessenger(payload as Parameters<typeof processarMessenger>[0]);
    } catch (err) {
      console.error("Erro ao processar mensagem do Instagram", err);
    }
  });
  return NextResponse.json({ ok: true });
}
