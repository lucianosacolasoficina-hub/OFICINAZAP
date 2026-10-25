import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, MediaFile, WhatsAppProvider } from "./types";

// API oficial do WhatsApp (Meta Cloud API).
type MetaWebhook = {
  entry?: {
    changes?: {
      value?: {
        contacts?: { wa_id?: string; profile?: { name?: string } }[];
        messages?: {
          id: string;
          from: string;
          type: string;
          text?: { body?: string };
          image?: { id?: string; caption?: string };
          video?: { id?: string; caption?: string };
          audio?: { id?: string };
          sticker?: { id?: string };
          document?: { id?: string; caption?: string; filename?: string };
          button?: { text?: string };
          interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
        }[];
      };
    }[];
  }[];
};

const GRAPH_URL = "https://graph.facebook.com/v21.0";

export class MetaProvider implements WhatsAppProvider {
  constructor(
    private token = process.env.META_ACCESS_TOKEN!,
    private phoneNumberId = process.env.META_PHONE_NUMBER_ID!,
    private appSecret = process.env.META_APP_SECRET!,
  ) {}

  async verifyWebhook(req: Request, rawBody: string) {
    const signature = req.headers.get("x-hub-signature-256") ?? "";
    if (!this.appSecret || !signature.startsWith("sha256=")) return false;
    const expected = createHmac("sha256", this.appSecret).update(rawBody).digest("hex");
    const a = Buffer.from(signature.slice(7));
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseWebhook(payload: unknown): IncomingMessage[] {
    const out: IncomingMessage[] = [];
    for (const entry of (payload as MetaWebhook).entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        const names = new Map((value?.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
        for (const m of value?.messages ?? []) {
          const text =
            m.text?.body ??
            m.image?.caption ??
            m.video?.caption ??
            m.document?.caption ??
            m.document?.filename ??
            m.button?.text ??
            m.interactive?.button_reply?.title ??
            m.interactive?.list_reply?.title ??
            "";
          const mediaType = (["image", "audio", "video", "document", "sticker"] as const).find(
            (t) => t === m.type,
          );
          const mediaRef = mediaType ? m[mediaType]?.id : undefined;
          out.push({ waMessageId: m.id, phone: m.from, name: names.get(m.from), text, mediaType, mediaRef });
        }
      }
    }
    return out;
  }

  async sendText(phone: string, text: string) {
    const res = await fetch(`${GRAPH_URL}/${this.phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ messaging_product: "whatsapp", to: phone, type: "text", text: { body: text } }),
    });
    if (!res.ok) throw new Error(`Meta API ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { messages?: { id?: string }[] };
    return { waMessageId: data.messages?.[0]?.id };
  }

  async downloadMedia(msg: IncomingMessage): Promise<MediaFile | null> {
    if (!msg.mediaRef) return null;
    const auth = { Authorization: `Bearer ${this.token}` };
    const info = await fetch(`${GRAPH_URL}/${msg.mediaRef}`, { headers: auth });
    if (!info.ok) throw new Error(`Meta API ${info.status}: ${await info.text()}`);
    const { url, mime_type } = (await info.json()) as { url?: string; mime_type?: string };
    if (!url) return null;
    const file = await fetch(url, { headers: auth });
    if (!file.ok) throw new Error(`Meta API ${file.status} ao baixar mídia`);
    return { data: Buffer.from(await file.arrayBuffer()), mimeType: mime_type?.split(";")[0] || "application/octet-stream" };
  }
}
