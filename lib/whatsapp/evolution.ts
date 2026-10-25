import type { IncomingMessage, MediaFile, WhatsAppProvider } from "./types";

// Conexão não oficial via Evolution API (QR Code). Use num número secundário:
// o WhatsApp pode banir números conectados dessa forma.
type EvolutionMessage = {
  conversation?: string;
  extendedTextMessage?: { text?: string };
  imageMessage?: { caption?: string };
  videoMessage?: { caption?: string };
  documentMessage?: { caption?: string; fileName?: string };
  audioMessage?: unknown;
  stickerMessage?: unknown;
};

type EvolutionUpsert = {
  event?: string;
  data?: {
    key?: { remoteJid?: string; remoteJidAlt?: string; senderPn?: string; fromMe?: boolean; id?: string };
    pushName?: string;
    message?: EvolutionMessage;
  };
};

export class EvolutionProvider implements WhatsAppProvider {
  constructor(
    private baseUrl = process.env.EVOLUTION_API_URL!,
    private apiKey = process.env.EVOLUTION_API_KEY!,
    private instance = process.env.EVOLUTION_INSTANCE!,
  ) {}

  async verifyWebhook(req: Request) {
    const secret = process.env.WEBHOOK_SECRET;
    if (!secret) return false;
    return new URL(req.url).searchParams.get("token") === secret;
  }

  parseWebhook(payload: unknown): IncomingMessage[] {
    const body = payload as EvolutionUpsert;
    if (body.event !== "messages.upsert" || !body.data?.key) return [];
    const { key, pushName, message } = body.data;
    let jid = key.remoteJid ?? "";
    // Em versões novas do WhatsApp o contato pode vir com id anônimo (@lid); o número real vem à parte.
    if (jid.endsWith("@lid")) jid = key.remoteJidAlt ?? key.senderPn ?? jid;
    // Ignora mensagens nossas, de grupos e de status.
    if (key.fromMe || !jid.endsWith("@s.whatsapp.net") || !key.id || !message) return [];

    let text =
      message.conversation ??
      message.extendedTextMessage?.text ??
      message.imageMessage?.caption ??
      message.videoMessage?.caption ??
      message.documentMessage?.caption ??
      "";
    let mediaType: IncomingMessage["mediaType"];
    if (message.imageMessage) mediaType = "image";
    else if (message.audioMessage) mediaType = "audio";
    else if (message.videoMessage) mediaType = "video";
    else if (message.documentMessage) mediaType = "document";
    else if (message.stickerMessage) mediaType = "sticker";
    if (!text && message.documentMessage?.fileName) text = message.documentMessage.fileName;

    return [
      { waMessageId: key.id, phone: jid.split("@")[0], name: pushName, text, mediaType, mediaRef: mediaType && key.id },
    ];
  }

  async sendText(phone: string, text: string) {
    const res = await fetch(`${this.baseUrl}/message/sendText/${this.instance}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: this.apiKey },
      body: JSON.stringify({ number: phone, text }),
    });
    if (!res.ok) throw new Error(`Evolution API ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { key?: { id?: string } };
    return { waMessageId: data.key?.id };
  }

  async downloadMedia(msg: IncomingMessage): Promise<MediaFile | null> {
    if (!msg.mediaRef) return null;
    const res = await fetch(`${this.baseUrl}/chat/getBase64FromMediaMessage/${this.instance}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: this.apiKey },
      body: JSON.stringify({ message: { key: { id: msg.mediaRef } }, convertToMp4: false }),
    });
    if (!res.ok) throw new Error(`Evolution API ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { base64?: string; mimetype?: string };
    if (!data.base64) return null;
    return { data: Buffer.from(data.base64, "base64"), mimeType: data.mimetype?.split(";")[0] || "application/octet-stream" };
  }
}
