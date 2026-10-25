export type IncomingMessage = {
  waMessageId: string;
  phone: string; // somente dígitos, com DDI
  name?: string;
  text: string;
  mediaType?: "image" | "audio" | "video" | "document" | "sticker";
  /** Referência para baixar o arquivo no provedor (id da mensagem ou da mídia). */
  mediaRef?: string;
  /** Instância da Evolution API (qual dos números recebeu a mensagem). */
  instance?: string;
  /** Mensagem de grupo: "phone" é o id do grupo e "name" é quem escreveu. */
  isGroup?: boolean;
};

export type MediaFile = { data: Buffer; mimeType: string };

export interface WhatsAppProvider {
  /** Confere se a requisição do webhook veio mesmo do provedor. */
  verifyWebhook(req: Request, rawBody: string): Promise<boolean>;
  /** Extrai as mensagens recebidas de clientes (ignora as enviadas por nós). */
  parseWebhook(payload: unknown): IncomingMessage[];
  sendText(phone: string, text: string): Promise<{ waMessageId?: string }>;
  /** Baixa o arquivo de uma mensagem com mídia. */
  downloadMedia(msg: IncomingMessage): Promise<MediaFile | null>;
  /** Nome de um grupo (só na conexão por QR Code). */
  groupName?(groupId: string): Promise<string | null>;
}
