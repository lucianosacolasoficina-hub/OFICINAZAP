export type IncomingMessage = {
  waMessageId: string;
  phone: string; // somente dígitos, com DDI
  name?: string;
  text: string;
  mediaType?: "image" | "audio" | "video" | "document" | "sticker";
};

export interface WhatsAppProvider {
  /** Confere se a requisição do webhook veio mesmo do provedor. */
  verifyWebhook(req: Request, rawBody: string): Promise<boolean>;
  /** Extrai as mensagens recebidas de clientes (ignora as enviadas por nós). */
  parseWebhook(payload: unknown): IncomingMessage[];
  sendText(phone: string, text: string): Promise<{ waMessageId?: string }>;
}
