import { HttpError, route } from "@/lib/api";
import { EvolutionProvider } from "@/lib/whatsapp/evolution";

// Conexão do WhatsApp pela Evolution API, feita pela tela de Configurações.
function evolution() {
  if (process.env.WHATSAPP_PROVIDER === "meta") throw new HttpError(400, "o sistema está usando a API oficial da Meta");
  return new EvolutionProvider();
}

function webhookUrl(req: Request) {
  const host = req.headers.get("x-forwarded-host");
  const origin =
    process.env.RENDER_EXTERNAL_URL ??
    (host ? `${req.headers.get("x-forwarded-proto") ?? "https"}://${host}` : new URL(req.url).origin);
  return `${origin}/api/webhooks/whatsapp?token=${encodeURIComponent(process.env.WEBHOOK_SECRET ?? "")}`;
}

export const GET = route(async () => ({ state: await evolution().connectionState() }));

export const POST = route(async (req) => {
  if (!process.env.WEBHOOK_SECRET) throw new HttpError(500, "WEBHOOK_SECRET não configurado");
  return evolution().connect(webhookUrl(req));
});
