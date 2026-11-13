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
  /** Reação (emoji) do cliente a uma mensagem: `alvo` é o id no WhatsApp da mensagem reagida; emoji vazio = tirou a reação. */
  reacao?: { alvo: string; emoji: string };
};

export type MediaFile = { data: Buffer; mimeType: string };

/** Mensagem que está sendo respondida (aparece citada em cima da resposta, como no WhatsApp). */
export type Citacao = {
  /** Id da mensagem no WhatsApp. */
  id: string;
  /** Conversa no WhatsApp (ex.: 5511999999999@s.whatsapp.net ou id@g.us). */
  remoteJid: string;
  /** A mensagem citada foi enviada por nós? */
  fromMe: boolean;
  /** Texto da mensagem citada (o WhatsApp mostra um pedaço dele na citação). */
  text: string;
};

export interface WhatsAppProvider {
  /** Confere se a requisição do webhook veio mesmo do provedor. */
  verifyWebhook(req: Request, rawBody: string): Promise<boolean>;
  /** Extrai as mensagens recebidas de clientes (ignora as enviadas por nós). */
  parseWebhook(payload: unknown): IncomingMessage[];
  /** Envia um texto; com `citar`, sai como resposta àquela mensagem. */
  sendText(phone: string, text: string, citar?: Citacao): Promise<{ waMessageId?: string }>;
  /** Envia uma foto (com legenda opcional). */
  sendImage(phone: string, file: MediaFile, caption?: string, citar?: Citacao): Promise<{ waMessageId?: string }>;
  /** Envia um arquivo (PDF, Excel…) com o nome que o cliente verá e legenda opcional. */
  sendDocument(phone: string, file: MediaFile, fileName: string, caption?: string, citar?: Citacao): Promise<{ waMessageId?: string }>;
  /** Envia um áudio gravado na hora (sai como mensagem de voz). */
  sendAudio?(phone: string, file: MediaFile, citar?: Citacao): Promise<{ waMessageId?: string }>;
  /** Reage (emoji) a uma mensagem; emoji vazio tira a reação. */
  sendReaction?(msg: Omit<Citacao, "text">, emoji: string): Promise<void>;
  /** Edita o texto de uma mensagem que nós enviamos (o WhatsApp deixa por 15 minutos). */
  editText?(phone: string, msg: Omit<Citacao, "text">, text: string): Promise<void>;
  /** Apaga para todos uma mensagem que nós enviamos (como o "Apagar para todos" do WhatsApp). */
  deleteForEveryone?(msg: Omit<Citacao, "text">): Promise<void>;
  /** Enquete para o cliente votar (só na conexão por QR Code). */
  sendPoll?(phone: string, pergunta: string, opcoes: string[], variasRespostas: boolean): Promise<{ waMessageId?: string }>;
  /** Mostra "digitando…" no WhatsApp do cliente por alguns segundos. */
  digitando?(phone: string): Promise<void>;
  /** Baixa o arquivo de uma mensagem com mídia. */
  downloadMedia(msg: IncomingMessage): Promise<MediaFile | null>;
  /** Nome de um grupo (só na conexão por QR Code). */
  groupName?(groupId: string): Promise<string | null>;
}
