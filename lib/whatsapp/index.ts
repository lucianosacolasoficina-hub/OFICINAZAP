import { EvolutionProvider } from "./evolution";
import { MetaProvider } from "./meta";
import type { WhatsAppProvider } from "./types";

export type { IncomingMessage, MediaFile, WhatsAppProvider } from "./types";

// Troque de provedor mudando WHATSAPP_PROVIDER no .env ("evolution" ou "meta").
// Com a Evolution API, cada número conectado é uma instância; sem instância usa a padrão do .env.
export function whatsapp(instance?: string | null): WhatsAppProvider {
  return process.env.WHATSAPP_PROVIDER === "meta" ? new MetaProvider() : new EvolutionProvider(instance ?? undefined);
}
