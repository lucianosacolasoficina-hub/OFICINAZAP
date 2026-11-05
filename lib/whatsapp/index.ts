import { EvolutionProvider } from "./evolution";
import { MetaProvider } from "./meta";
import { comTrava } from "./trava";
import type { WhatsAppProvider } from "./types";

export type { IncomingMessage, MediaFile, WhatsAppProvider } from "./types";

// Troque de provedor mudando WHATSAPP_PROVIDER no .env ("evolution" ou "meta").
// Com a Evolution API, cada número conectado é uma instância; sem instância usa a padrão do .env.
// Todo envio passa pela trava (fila com intervalo, limites por número, sem mensagem repetida): ver trava.ts.
export function whatsapp(instance?: string | null): WhatsAppProvider {
  if (process.env.WHATSAPP_PROVIDER === "meta") return comTrava(new MetaProvider(), "meta");
  return comTrava(new EvolutionProvider(instance ?? undefined), instance || process.env.EVOLUTION_INSTANCE || "padrao");
}
