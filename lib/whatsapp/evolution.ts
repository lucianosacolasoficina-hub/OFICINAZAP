import { supabaseAdmin } from "../supabase/admin";
import type { Citacao, IncomingMessage, MediaFile, WhatsAppProvider } from "./types";

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
  reactionMessage?: { key?: { id?: string }; text?: string };
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

  private async call<T>(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<{ status: number; data: T }> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      // Toda chamada tem prazo: se a Evolution travar, o pedido não fica preso para sempre no servidor
      // (pedidos presos acumulam memória e travam as tarefas automáticas, como as fotos e a conferência).
      signal: AbortSignal.timeout(timeoutMs ?? 45_000),
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
      undefined,
      10000,
    );
    if (status === 404) return "missing";
    if (status >= 400) throw new Error(`Evolution API ${status}: ${JSON.stringify(data)}`);
    return data.instance?.state ?? "close";
  }

  /**
   * Número do celular conectado (somente dígitos), quando a instância está conectada.
   * Lido direto do banco da Evolution: o /instance/fetchInstances conta todas as mensagens guardadas
   * e chegava a levar mais de um minuto, segurando conexões do banco que a Evolution precisa para salvar mensagens.
   */
  async ownerPhone(): Promise<string | null> {
    const { data, error } = await supabaseAdmin().rpc("zap_dono_instancia", { p_instance: this.instance });
    if (error || typeof data !== "string") return null;
    return data || null;
  }

  /**
   * Testa a sessão de verdade: pergunta ao WhatsApp se o próprio número existe.
   * Sessão travada (aparece "open", mas a ligação caiu) responde "Connection Closed".
   * Devolve false só quando tem certeza de que travou.
   */
  async testarSessao(fone: string): Promise<boolean> {
    const r = await this.call("POST", `/chat/whatsappNumbers/${this.instance}`, { numbers: [fone] }, 20_000).catch(() => null);
    if (!r) return true; // Evolution lenta ou fora: não é sinal de número travado
    return !(r.status >= 400 && /Connection Closed/i.test(JSON.stringify(r.data)));
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
    if (r.status >= 400 && !/not connected/i.test(JSON.stringify(r.data))) throw new Error(`Evolution API ${r.status}: ${JSON.stringify(r.data)}`);
    // Quando a sessão já tinha caído, o "restart" da Evolution não abre outra: pede para ligar de novo
    // com os dados salvos do celular (não precisa de QR Code se o celular ainda estiver vinculado).
    await new Promise((res) => setTimeout(res, 3000));
    const state = await this.connectionState().catch(() => "");
    if (state !== "open") await this.call("GET", `/instance/connect/${this.instance}`, undefined, 20_000).catch(() => null);
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
    // CONNECTION_UPDATE: avisa o sistema na hora em que o celular termina de conectar.
    const webhook = { enabled: true, url: webhookUrl, byEvents: false, base64: false, events: ["MESSAGES_UPSERT", "MESSAGES_SET", "CONNECTION_UPDATE"] };
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
    await this.desligarHistoricoCompleto().catch(() => false);
    // Com o número, a Evolution devolve também um código de 8 letras para conectar sem câmera.
    const q = phone ? `?number=${encodeURIComponent(phone)}` : "";
    const { status, data } = await this.call<{ base64?: string; pairingCode?: string | null }>("GET", `/instance/connect/${this.instance}${q}`);
    if (status >= 400) throw new Error(`Evolution API ${status}: ${JSON.stringify(data)}`);
    return { state, qr: data.base64, pairingCode: data.pairingCode ?? undefined };
  }

  /**
   * Só busca o QR Code atual (para renovar a imagem na tela), sem mexer no webhook nem criar nada.
   * Se o número já conectou, devolve state "open" e nenhum QR Code.
   */
  async currentQr(): Promise<{ state: string; qr?: string }> {
    const state = await this.connectionState();
    if (state === "open" || state === "missing") return { state };
    const { status, data } = await this.call<{ base64?: string }>("GET", `/instance/connect/${this.instance}`, undefined, 15000);
    if (status >= 400) throw new Error(`Evolution API ${status}: ${JSON.stringify(data)}`);
    return { state, qr: data.base64 };
  }

  /** Aviso de conexão (connection.update) vindo pelo webhook: estado e número do celular. */
  static parseConnectionUpdate(payload: unknown): { instance?: string; state: string; phone?: string } | null {
    const body = payload as { event?: string; instance?: string; data?: { state?: string; wuid?: string } };
    if (body?.event !== "connection.update" || !body.data?.state) return null;
    const phone = body.data.wuid?.split("@")[0].split(":")[0] || undefined;
    return { instance: body.instance, state: body.data.state, phone };
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

    // Reação (emoji) do cliente numa mensagem: não vira balão novo, fica em cima da mensagem reagida.
    if (message.reactionMessage) {
      const alvo = message.reactionMessage.key?.id;
      if (!alvo || isGroup) return [];
      return [{ waMessageId: key.id, phone: jid.split("@")[0], name: pushName, text: "", instance: body.instance, reacao: { alvo, emoji: message.reactionMessage.text ?? "" } }];
    }

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

  /**
   * Desliga a sincronização do histórico completo (vale na próxima vez que o celular conectar).
   * Com ela ligada, cada reconexão despejava o histórico inteiro do celular (dezenas de milhares de
   * mensagens) no banco de uma vez: a Evolution ficava sem conexões livres e as mensagens novas não
   * eram salvas. O histórico antigo vem pelo "Puxar conversas antigas", que lê o banco aos poucos.
   */
  async desligarHistoricoCompleto() {
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
      syncFullHistory: false,
    };
    const r = await this.call("POST", `/settings/set/${this.instance}`, body);
    return r.status < 400;
  }

  /** Conversas que a Evolution guardou para este número. */
  async findChats(): Promise<{ remoteJid: string; name?: string | null; pushName?: string | null; updatedAt?: string | null }[]> {
    const { status, data } = await this.call<unknown>("POST", `/chat/findChats/${this.instance}`, {}, 120_000);
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

  /** Link da foto de perfil do contato ou do grupo (null quando não tem ou está oculta). */
  async profilePicture(number: string): Promise<string | null> {
    const { status, data } = await this.call<{ profilePictureUrl?: string | null }>("POST", `/chat/fetchProfilePictureUrl/${this.instance}`, { number }, 15_000);
    if (status >= 400) return null;
    const u = data?.profilePictureUrl;
    return typeof u === "string" && /^https:\/\//.test(u) ? u : null;
  }

  /** Apaga para todos uma mensagem nossa (o WhatsApp só deixa nas primeiras ~48 horas). */
  async deleteForEveryone(msg: Omit<Citacao, "text">) {
    const { status, data } = await this.call("DELETE", `/chat/deleteMessageForEveryone/${this.instance}`, {
      id: msg.id,
      remoteJid: msg.remoteJid,
      fromMe: msg.fromMe,
    }, 30_000);
    if (status >= 400) throw new Error(`Evolution API ${status}: ${JSON.stringify(data)}`);
  }

  /** Reação (emoji) numa mensagem; emoji vazio tira a reação. */
  async sendReaction(msg: Omit<Citacao, "text">, emoji: string) {
    const { status, data } = await this.call("POST", `/message/sendReaction/${this.instance}`, {
      key: { id: msg.id, remoteJid: msg.remoteJid, fromMe: msg.fromMe },
      reaction: emoji,
    }, 30_000);
    if (status >= 400) throw new Error(`Evolution API ${status}: ${JSON.stringify(data)}`);
  }

  /** Edita uma mensagem de texto nossa (o WhatsApp só deixa nos primeiros 15 minutos). */
  async editText(phone: string, msg: Omit<Citacao, "text">, text: string) {
    const { status, data } = await this.call("POST", `/chat/updateMessage/${this.instance}`, {
      number: phone,
      key: { id: msg.id, remoteJid: msg.remoteJid, fromMe: true },
      text,
    }, 30_000);
    if (status >= 400) throw new Error(`Evolution API ${status}: ${JSON.stringify(data)}`);
  }

  /** Áudio gravado na hora: a Evolution converte e ele chega como mensagem de voz. */
  async sendAudio(phone: string, file: MediaFile, citar?: Citacao) {
    const data = await this.enviar(`/message/sendWhatsAppAudio/${this.instance}`, { number: phone, audio: file.data.toString("base64"), encoding: true, ...citado(citar) }, 90_000);
    return { waMessageId: data.key?.id };
  }

  /**
   * Envia pela Evolution. Se a sessão do número caiu por dentro (a Evolution responde "Connection Closed"
   * mas o número aparece como conectado, o que acontece depois de o banco ou o servidor reiniciar),
   * reinicia a sessão sozinho e tenta mais uma vez, sem precisar ler o QR Code.
   */
  private async enviar(path: string, body: unknown, timeoutMs: number): Promise<{ key?: { id?: string } }> {
    for (let tentativa = 0; ; tentativa++) {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "Content-Type": "application/json", apikey: this.apiKey },
        body: JSON.stringify(body),
      });
      if (res.ok) return (await res.json()) as { key?: { id?: string } };
      const texto = await res.text();
      if (tentativa === 0 && /Connection Closed/i.test(texto)) {
        console.warn("Sessão caída ao enviar, reiniciando", this.instance);
        await this.restart().catch(() => {});
        await esperarAberta(this, 25_000);
        continue;
      }
      throw new Error(`Evolution API ${res.status}: ${texto}`);
    }
  }

  async sendText(phone: string, text: string, citar?: Citacao) {
    const data = await this.enviar(`/message/sendText/${this.instance}`, { number: phone, text, ...citado(citar) }, 30_000);
    return { waMessageId: data.key?.id };
  }

  async sendImage(phone: string, file: MediaFile, caption?: string, citar?: Citacao) {
    const ext = file.mimeType.split("/")[1] || "png";
    const data = await this.enviar(`/message/sendMedia/${this.instance}`, {
        number: phone,
        mediatype: "image",
        mimetype: file.mimeType,
        caption: caption ?? "",
        media: file.data.toString("base64"),
        fileName: `imagem.${ext}`,
        ...citado(citar),
      }, 90_000);
    return { waMessageId: data.key?.id };
  }

  async sendDocument(phone: string, file: MediaFile, fileName: string, caption?: string, citar?: Citacao) {
    const data = await this.enviar(`/message/sendMedia/${this.instance}`, {
        number: phone,
        mediatype: "document",
        mimetype: file.mimeType,
        caption: caption ?? "",
        media: file.data.toString("base64"),
        fileName,
        ...citado(citar),
      }, 90_000);
    return { waMessageId: data.key?.id };
  }

  async downloadMedia(msg: IncomingMessage): Promise<MediaFile | null> {
    if (!msg.mediaRef) return null;
    const res = await fetch(`${this.baseUrl}/chat/getBase64FromMediaMessage/${this.instance}`, {
      method: "POST",
      signal: AbortSignal.timeout(60_000),
      headers: { "Content-Type": "application/json", apikey: this.apiKey },
      body: JSON.stringify({ message: { key: { id: msg.mediaRef } }, convertToMp4: false }),
    });
    if (!res.ok) throw new Error(`Evolution API ${res.status}: ${await res.text()}`);
    // Arquivo grande demais (vídeo longo, por exemplo) não é guardado de qualquer jeito (limite de 15 MB):
    // para de ler no meio, em vez de carregar tudo na memória e derrubar o servidor.
    const texto = await lerAte(res, MAX_RESPOSTA_MIDIA);
    if (texto === null) {
      console.warn("Mídia grande demais, não foi baixada", msg.waMessageId);
      return null;
    }
    const data = JSON.parse(texto) as { base64?: string; mimetype?: string };
    if (!data.base64) return null;
    return { data: Buffer.from(data.base64, "base64"), mimeType: data.mimetype?.split(";")[0] || "application/octet-stream" };
  }
}

/** Campo "quoted" da Evolution: a resposta sai com a mensagem citada em cima, como no WhatsApp. */
function citado(c?: Citacao) {
  if (!c) return {};
  return { quoted: { key: { id: c.id, remoteJid: c.remoteJid, fromMe: c.fromMe }, message: { conversation: c.text || " " } } };
}

// 15 MB de arquivo viram ~20 MB em base64; com folga para o resto da resposta.
const MAX_RESPOSTA_MIDIA = 21 * 1024 * 1024;

/** Lê a resposta até `max` bytes; se passar disso, cancela e devolve null. */
async function lerAte(res: Response, max: number): Promise<string | null> {
  const tam = Number(res.headers.get("content-length") ?? 0);
  if (tam > max) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    partes.push(value);
  }
  return Buffer.concat(partes).toString("utf8");
}


/** Espera a sessão voltar a "open" depois de reiniciar (no máximo `ms`). */
async function esperarAberta(p: EvolutionProvider, ms: number) {
  const fim = Date.now() + ms;
  await new Promise((r) => setTimeout(r, 4000));
  while (Date.now() < fim) {
    if ((await p.connectionState().catch(() => "")) === "open") {
      await new Promise((r) => setTimeout(r, 2000));
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}
