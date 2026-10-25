import { HttpError, route } from "@/lib/api";
import { blingConfigured, blingConnected, disconnectBling, saveAppKeys } from "@/lib/bling";

export const GET = route(async () => ({ configured: await blingConfigured(), connected: await blingConnected() }));

// Salva o Client Id e o Client Secret do app do Bling colados na tela de Configurações.
export const PUT = route(async (req) => {
  const body = (await req.json()) as { client_id?: string; client_secret?: string };
  if (!body.client_id?.trim() || !body.client_secret?.trim()) throw new HttpError(400, "preencha o Client Id e o Client Secret");
  await saveAppKeys(body.client_id, body.client_secret);
});

export const DELETE = route(async () => {
  await disconnectBling();
});
