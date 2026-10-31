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

/** Mensagem antiga (histórico) já convertida, nossa ou do cliente. */
export type HistMsg = {
  waMessageId: string;
  jid: string;
  phone: string;
  isGroup: boolean;
  fromMe: boolean;
  name?: string;
  text: string;
  mediaType?: string;
  ts: number;
};

type EvolutionRecord = {
  key?: { remoteJid?: string; remoteJidAlt?: string; senderPn?: string; participant?: string; fromMe?: boolean; id?: string };
  pushName?: string | null;
  message?: EvolutionMessage | null;
  messageTimestamp?: number | string | { low?: number };
};

type EvolutionUpsert = {
  event?: string;
  instance?: string;
  data?: {
    key?: { remoteJid?: string; remoteJidAlt?: string; senderPn?: string; participant?: string; fromMe?: boolean; id?: string };
    pushName?: string;
    message?: EvolutionMessage;
  };
};

export class EvolutionProvider implements WhatsAppProvider {
  private baseUrl: string;

  constructor(
    private instance = process.env.EVOLUTION_INSTANCE!,
    baseUrl = process.env.EVOLUTION_API_URL!,
    private apiKey = process.env.EVOLUTION_API_KEY!,
  ) {
    // Na rede interna do Render o endereço vem sem "http://" (ex.: oficinazap-evolution:8080).
    this.baseUrl = /^https?:\/\//.test(baseUrl) ? baseUrl.replace(/\/$/, "") : `http://${baseUrl}`;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", apikey: this.apiKey },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {}
    return { status: res.status, data: data as T };
  }

  /** Estado da conexão: "open" (conectado), "connecting", "close" ou "missing" (instância não criada). */
  async connectionState(): Promise<string> {
    const { status, data } = await this.call<{ instance?: { state?: string } }>(
      "GET",
      `/instance/connectionState/${this.instance}`,
    );
    if (status === 404) return "missing";
    if (status >= 400) throw new Error(`Evolution API ${status}: ${JSON.stringify(data)}`);
    return data.instance?.state ?? "close";
  }

  /** Número do celular conectado (somente dígitos), quando a instância está conectada. */
  async ownerPhone(): Promise<string | null> {
    const { status, data } = await this.call<{ ownerJid?: string | null; number?: string | null }[]>(
      "GET",
      `/instance/fetchInstances?instanceName=${encodeURIComponent(this.instance)}`,
    );
    if (status >= 400 || !Array.isArray(data) || !data[0]) return null;
    const jid = data[0].ownerJid ?? data[0].number ?? "";
    return jid.split("@")[0].split(":")[0] || null;
  }

  /** Desconecta o celular, mas mantém a instância para conectar de novo depois. */
  async logout() {
    const { status, data } = await this.call("DELETE", `/instance/logout/${this.instance}`);
    if (status >= 400 && status !== 404) throw new Error(`Evolution API ${status}: ${JSON.stringify(data)}`);
  }

  /** Apaga a instância na Evolution API (desconecta o celular, se estiver conectado). */
  /** Reinicia a sessão do número na Evolution (sem precisar ler o QR Code de novo). */
  async restart() {
    let r = await this.call("POST", `/instance/restart/${this.instance}`);
    if (r.status === 404 || r.status === 405) r = await this.call("PUT", `/instance/restart/${this.instance}`);
    if (r.status >= 400) throw new Error(`Evolution API ${r.status}: ${JSON.stringify(r.data)}`);
    return r.data;
  }

  async remove() {
    await this.logout().catch(() => {});
    const { status, data } = await this.call("DELETE", `/instance/delete/${this.instance}`);
    if (status >= 400 && status !== 404) throw new Error(`Evolution API ${status}: ${JSON.stringify(data)}`);
  }

  /** Cria a instância se preciso, aponta o webhook para o sistema e devolve o QR Code (imagem base64). */
  async connect(webhookUrl: string, phone?: string): Promise<{ state: string; qr?: string; pairingCode?: string }> {
    // MESSAGES_SET: o WhatsApp manda as conversas antigas logo depois de conectar (histórico).
    const webhook = { enabled: true, url: webhookUrl, byEvents: false, base64: false, events: ["MESSAGES_UPSERT", "MESSAGES_SET"] };
    let state = await this.connectionState();
    if (state === "missing") {
      const created = await this.call<{ qrcode?: { base64?: string } }>("POST", "/instance/create", {
        instanceName: this.instance,
        integration: "WHATSAPP-BAILEYS",
        qrcode: true,
        webhook,
      });
      if (created.status >= 400) throw new Error(`Evolution API ${created.status}: ${JSON.stringify(created.data)}`);
      state = "connecting";
      if (created.data.qrcode?.base64) return { state, qr: created.data.qrcode.base64 };
    } else {
      const set = await this.call("POST", `/webhook/set/${this.instance}`, { webhook });
      if (set.status >= 400) throw new Error(`Evolution API ${set.status}: ${JSON.stringify(set.data)}`);
    }
    if (state === "open") return { state };
    // Com o número, a Evolution devolve também um código de 8 letras para conectar sem câmera.
    const q = phone ? `?number=${encodeURIComponent(phone)}` : "";
    const { status, data } = await this.call<{ base64?: string; pairingCode?: string | null }>("GET", `/instance/connect/${this.instance}${q}`);
    if (status >= 400) throw new Error(`Evolution API ${status}: ${JSON.stringify(data)}`);
    return { state, qr: data.base64, pairingCode: data.pairingCode ?? undefined };
  }

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
    const isGroup = jid.endsWith("@g.us");
    // Ignora mensagens nossas e de status.
    if (key.fromMe || !(isGroup || jid.endsWith("@s.whatsapp.net")) || !key.id || !message) return [];

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
    // Em grupo, a mensagem mostra quem escreveu.
    const author = isGroup ? pushName || key.participant?.split("@")[0] : undefined;
    if (author) text = `${author}: ${text || (mediaType ? `[${mediaType}]` : "")}`;

    return [
      {
        waMessageId: key.id,
        phone: jid.split("@")[0],
        name: pushName,
        text,
        mediaType,
        mediaRef: mediaType && key.id,
        instance: body.instance,
        isGroup,
      },
    ];
  }

  /** Liga a sincronização do histórico completo (vale na próxima vez que o celular conectar). */
  async ligarHistoricoCompleto() {
    const atual = await this.call<Record<string, unknown>>("GET", `/settings/find/${this.instance}`);
    const base = atual.status < 400 && atual.data && typeof atual.data === "object" ? atual.data : {};
    const body = {
      rejectCall: false,
      msgCall: "",
      groupsIgnore: false,
      alwaysOnline: false,
      readMessages: false,
      readStatus: false,
      ...Object.fromEntries(Object.entries(base).filter(([k]) => ["rejectCall", "msgCall", "groupsIgnore", "alwaysOnline", "readMessages", "readStatus"].includes(k))),
      syncFullHistory: true,
    };
    const r = await this.call("POST", `/settings/set/${this.instance}`, body);
    return r.status < 400;
  }

  /** Conversas que a Evolution guardou para este número. */
  async findChats(): Promise<{ remoteJid: string; name?: string | null; pushName?: string | null; updatedAt?: string | null }[]> {
    const { status, data } = await this.call<unknown>("POST", `/chat/findChats/${this.instance}`, {});
    if (status >= 400 || !Array.isArray(data)) return [];
    return data as { remoteJid: string; name?: string | null; pushName?: string | null; updatedAt?: string | null }[];
  }

  /** Mensagens guardadas de uma conversa (mais novas primeiro, em páginas). */
  async findMessages(remoteJid: string, page = 1, offset = 100): Promise<EvolutionRecord[]> {
    const { status, data } = await this.call<unknown>("POST", `/chat/findMessages/${this.instance}`, {
      where: { key: { remoteJid } },
      page,
      offset,
    });
    if (status >= 400) return [];
    const d = data as { messages?: { records?: EvolutionRecord[] } } | EvolutionRecord[];
    return Array.isArray(d) ? d : (d.messages?.records ?? []);
  }

  /** Converte uma mensagem guardada/antiga (inclusive as que nós enviamos). */
  static parseRecord(rec: EvolutionRecord): HistMsg | null {
    const key = rec.key;
    const message = rec.message;
    if (!key?.id || !message) return null;
    let jid = key.remoteJid ?? "";
    if (jid.endsWith("@lid")) jid = key.remoteJidAlt ?? key.senderPn ?? jid;
    const isGroup = jid.endsWith("@g.us");
    if (!(isGroup || jid.endsWith("@s.whatsapp.net"))) return null;
    let text =
      message.conversation ??
      message.extendedTextMessage?.text ??
      message.imageMessage?.caption ??
      message.videoMessage?.caption ??
      message.documentMessage?.caption ??
      "";
    let mediaType: string | undefined;
    if (message.imageMessage) mediaType = "image";
    else if (message.audioMessage) mediaType = "audio";
    else if (message.videoMessage) mediaType = "video";
    else if (message.documentMessage) mediaType = "document";
    else if (message.stickerMessage) mediaType = "sticker";
    if (!text && message.documentMessage?.fileName) text = message.documentMessage.fileName;
    if (!text && !mediaType) return null;
    const author = isGroup && !key.fromMe ? rec.pushName || key.participant?.split("@")[0] : undefined;
    if (author) text = `${author}: ${text || `[${mediaType}]`}`;
    const t = rec.messageTimestamp;
    const ts = Number(typeof t === "object" && t ? t.low : t) || 0;
    return {
      waMessageId: key.id,
      jid,
      phone: jid.split("@")[0],
      isGroup,
      fromMe: !!key.fromMe,
      name: key.fromMe ? undefined : rec.pushName ?? undefined,
      text: text || "",
      mediaType,
      ts: ts > 1e12 ? Math.floor(ts / 1000) : ts,
    };
  }

  /** Mensagens antigas que chegam no webhook "messages.set" (logo depois de conectar). */
  /** Mensagem que o próprio número enviou pelo celular (ou WhatsApp Web) — chega no webhook como fromMe. */
  static parseSentByMe(payload: unknown): { instance?: string; msg: HistMsg | null } {
    const body = payload as { event?: string; instance?: string; data?: EvolutionRecord };
    if (body.event !== "messages.upsert" || !body.data?.key?.fromMe) return { msg: null };
    return { instance: body.instance, msg: EvolutionProvider.parseRecord(body.data) };
  }

  static parseHistorySet(payload: unknown): { instance?: string; msgs: HistMsg[] } {
    const body = payload as { event?: string; instance?: string; data?: unknown };
    if (body.event !== "messages.set") return { msgs: [] };
    const d = body.data as { messages?: EvolutionRecord[] } | EvolutionRecord[] | undefined;
    const recs = Array.isArray(d) ? d : (d?.messages ?? []);
    return { instance: body.instance, msgs: recs.map((r) => EvolutionProvider.parseRecord(r)).filter((m): m is HistMsg => !!m) };
  }

  async groupName(groupId: string) {
    const { status, data } = await this.call<{ subject?: string }>(
      "GET",
      `/group/findGroupInfos/${this.instance}?groupJid=${encodeURIComponent(`${groupId}@g.us`)}`,
    );
    return status < 400 ? data.subject || null : null;
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

