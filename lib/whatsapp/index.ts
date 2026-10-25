import { EvolutionProvider } from "./evolution";
import { MetaProvider } from "./meta";
import type { WhatsAppProvider } from "./types";

export type { IncomingMessage, WhatsAppProvider } from "./types";

// Troque de provedor mudando WHATSAPP_PROVIDER no .env ("evolution" ou "meta").
export function whatsapp(): WhatsAppProvider {
  return process.env.WHATSAPP_PROVIDER === "meta" ? new MetaProvider() : new EvolutionProvider();
}
