import { createHash } from "node:crypto";
import { HttpError } from "../api";
import { getSetting, setSetting } from "../db";
import type { MediaFile, WhatsAppProvider } from "./types";

// Trava contra envio em massa no WhatsApp (proteção contra banimento).
// Os números estão ligados por QR Code (Evolution, não oficial). O que o WhatsApp pune é disparo em massa:
// a mesma mensagem para muitos contatos de uma vez, rajadas de mensagens saindo juntas e robôs em ciclo.
// Conversa normal (atendente falando com um cliente) fica LIVRE: não há limite por hora ou por dia nem pausa.
// Toda mensagem que sai pelo OficinaZap passa por aqui:
//  - fila por número, uma de cada vez, com um pequeno intervalo e variação entre elas;
//  - a mesma mensagem (texto ou arquivo) para muitos contatos diferentes em pouco tempo é barrada;
//  - rajada (muitas mensagens tentando sair ao mesmo tempo pelo mesmo número) é barrada;
//  - a mesma mensagem para o mesmo contato em sequência não sai de novo (clique duplo, reenvio).
// Quando barra algo, o master recebe um aviso no topo do OficinaZap.

export type Limites = {
  /** Segundos mínimos entre duas mensagens do mesmo número (a fila soma uma variação aleatória). */
  intervalo_seg: number;
  /** A mesma mensagem pode ir para até (este número - 1) contatos diferentes dentro de `massa_min`. */
  massa_contatos: number;
  massa_min: number;
  /** Respostas da IA na mesma conversa em 10 minutos antes de ela parar e chamar um atendente. */
  robo_10min: number;
};

export const LIMITES_PADRAO: Limites = { intervalo_seg: 1, massa_contatos: 5, massa_min: 10, robo_10min: 4 };

const lim = (n: unknown, min: number, max: number, padrao: number) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : padrao;
};
export function normalizaLimites(v: Partial<Limites> | null | undefined): Limites {
  const p = LIMITES_PADRAO;
  return {
    intervalo_seg: lim(v?.intervalo_seg, 0, 30, p.intervalo_seg),
    massa_contatos: lim(v?.massa_contatos, 2, 100, p.massa_contatos),
    massa_min: lim(v?.massa_min, 1, 24 * 60, p.massa_min),
    robo_10min: lim(v?.robo_10min, 1, 30, p.robo_10min),
  };
}

let cacheLim: { t: number; v: Limites } | null = null;
export async function getLimites(): Promise<Limites> {
  if (cacheLim && Date.now() - cacheLim.t < 30_000) return cacheLim.v;
  const v = normalizaLimites(await getSetting<Partial<Limites> | null>("trava_envio", null).catch(() => null));
  cacheLim = { t: Date.now(), v };
  return v;
}
export async function salvarLimites(v: Partial<Limites>) {
  const n = normalizaLimites({ ...(await getLimites()), ...v });
  await setSetting("trava_envio", n);
  cacheLim = { t: Date.now(), v: n };
  return n;
}

export type Aviso = { quando: string; instance: string; motivo: string; lido?: boolean };

// Estado de cada número (fica na memória do servidor; os avisos ficam no banco).
type Estado = {
  envios: number[]; // horários (ms) das mensagens enviadas nas últimas 24 horas (só para mostrar)
  ultimo: number;
  fila: Promise<unknown>;
  naFila: number;
  recentes: Map<string, number>; // contato + mensagem -> quando foi enviada
  conteudos: Map<string, Map<string, number>>; // mensagem -> contatos que receberam -> quando
};
const g = globalThis as unknown as { __travaZap2?: Map<string, Estado> };
const estados: Map<string, Estado> = (g.__travaZap2 ??= new Map());
function estado(instance: string): Estado {
  let e = estados.get(instance);
  if (!e) {
    e = { envios: [], ultimo: 0, fila: Promise.resolve(), naFila: 0, recentes: new Map(), conteudos: new Map() };
    estados.set(instance, e);
  }
  return e;
}

/** Mensagens esperando ao mesmo tempo no mesmo número a partir das quais é rajada (disparo em massa). */
const MAX_FILA = 10;
const DUPLICADA_MS = 2 * 60_000;
// Textos curtos ("ok", "bom dia", "obrigado") podem ir para vários clientes sem ser disparo em massa.
const TEXTO_CURTO = 25;

export async function lerAvisos(): Promise<Aviso[]> {
  return getSetting<Aviso[]>("trava_avisos", []).catch(() => []);
}
export async function marcarAvisosLidos() {
  const a = await lerAvisos();
  await setSetting("trava_avisos", a.map((x) => ({ ...x, lido: true })));
}
// O mesmo motivo no mesmo número só gera um aviso a cada 10 minutos.
const ultimoAviso = new Map<string, number>();
/** Guarda um aviso para o master (aparece em vermelho no topo do OficinaZap). */
export async function avisarMaster(instance: string, motivo: string) {
  console.error(`TRAVA WhatsApp [${instance}]: ${motivo}`);
  const k = `${instance}|${motivo.slice(0, 40)}`;
  if (Date.now() - (ultimoAviso.get(k) ?? 0) < 10 * 60_000) return;
  ultimoAviso.set(k, Date.now());
  try {
    const a = await lerAvisos();
    await setSetting("trava_avisos", [{ quando: new Date().toISOString(), instance, motivo }, ...a].slice(0, 30));
  } catch (err) {
    console.error("aviso da trava", err);
  }
}

/** Contagem atual de um número (só informativo, para a tela de Configurações). */
export function contagem(instance: string) {
  const e = estados.get(instance);
  const agora = Date.now();
  const env: number[] = e?.envios ?? [];
  return {
    minuto: env.filter((t) => agora - t < 60_000).length,
    hora: env.filter((t) => agora - t < 3_600_000).length,
    dia: env.filter((t) => agora - t < 86_400_000).length,
    fila: e?.naFila ?? 0,
  };
}

const hash = (c: string | Buffer) => createHash("sha1").update(c).digest("hex");
const normaliza = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Passa um envio pela trava: espera a vez na fila do número, confere repetição e disparo em massa, e então envia.
 * Se não puder enviar, lança um erro com a explicação (o atendente vê a mensagem na tela).
 */
export async function enviarComTrava<T>(instance: string, destino: string, conteudo: string | Buffer, enviar: () => Promise<T>): Promise<T> {
  const e = estado(instance);
  const contato = destino.replace(/\D/g, "") || destino;
  if (e.naFila >= MAX_FILA) {
    await avisarMaster(instance, `Rajada barrada: mais de ${MAX_FILA} mensagens tentando sair ao mesmo tempo (parece envio em massa)`);
    throw new HttpError(429, "Muitas mensagens saindo ao mesmo tempo por este número (parece envio em massa). Para proteger o WhatsApp, esta não foi enviada: aguarde alguns segundos e tente de novo.");
  }
  const texto = typeof conteudo === "string";
  const assinatura = hash(texto ? normaliza(conteudo) : conteudo);
  // Mensagem curta não conta como disparo em massa.
  const contaMassa = !texto || normaliza(conteudo).length >= TEXTO_CURTO;
  const chave = `${contato}|${assinatura}`;
  e.naFila++;
  const vez = e.fila.then(async () => {
    const l = await getLimites();
    const agora = Date.now();
    e.envios = e.envios.filter((t) => agora - t < 86_400_000);
    for (const [k, t] of e.recentes) if (agora - t > DUPLICADA_MS) e.recentes.delete(k);
    const janela = Math.max(l.massa_min * 60_000, DUPLICADA_MS);
    for (const [k, m] of e.conteudos) {
      for (const [c, t] of m) if (agora - t > janela) m.delete(c);
      if (!m.size) e.conteudos.delete(k);
    }

    // Mesma mensagem para o mesmo contato há pouco: não manda de novo.
    const ja = e.recentes.get(chave);
    if (ja) {
      throw new HttpError(409, `Essa mesma mensagem já foi enviada para este contato há ${Math.max(1, Math.round((agora - ja) / 1000))} segundos. Para proteger o número, ela não foi enviada de novo.`);
    }

    // Mesma mensagem para muitos contatos diferentes em pouco tempo: é disparo em massa.
    if (contaMassa) {
      const quem = e.conteudos.get(assinatura);
      const outros = quem ? [...quem.entries()].filter(([c, t]) => c !== contato && agora - t < l.massa_min * 60_000).length : 0;
      if (outros >= l.massa_contatos - 1) {
        await avisarMaster(instance, `Envio em massa barrado: a mesma mensagem já foi para ${outros} contatos em ${l.massa_min} minutos`);
        throw new HttpError(429, `Essa mesma mensagem já foi enviada para ${outros} contatos diferentes nos últimos ${l.massa_min} minutos por este número. Para proteger o WhatsApp contra bloqueio, envio em massa não é permitido. Mude o texto para este cliente ou aguarde.`);
      }
    }

    // Pequeno intervalo entre mensagens, com variação (envios em ritmo de máquina chamam atenção).
    const espera = e.ultimo + l.intervalo_seg * 1000 * (1 + Math.random() * 0.8) - Date.now();
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));

    const marcar = (t: number | null) => {
      if (t === null) {
        e.recentes.delete(chave);
        e.conteudos.get(assinatura)?.delete(contato);
        return;
      }
      e.recentes.set(chave, t);
      if (contaMassa) {
        if (!e.conteudos.has(assinatura)) e.conteudos.set(assinatura, new Map());
        e.conteudos.get(assinatura)!.set(contato, t);
      }
    };
    marcar(Date.now());
    e.ultimo = Date.now();
    try {
      const r = await enviar();
      e.envios.push(Date.now());
      return r;
    } catch (err) {
      // Não saiu: pode tentar de novo.
      marcar(null);
      throw err;
    }
  });
  e.fila = vez.catch(() => {});
  try {
    return await vez;
  } finally {
    e.naFila--;
  }
}

/** Envolve o provedor para que todo envio passe pela trava. */
export function comTrava(p: WhatsAppProvider, instance: string): WhatsAppProvider {
  return Object.assign(Object.create(p), {
    sendText: (phone: string, text: string) => enviarComTrava(instance, phone, text, () => p.sendText(phone, text)),
    sendImage: (phone: string, file: MediaFile, caption?: string) =>
      enviarComTrava(instance, phone, Buffer.concat([file.data, Buffer.from(caption ?? "")]), () => p.sendImage(phone, file, caption)),
    sendDocument: (phone: string, file: MediaFile, fileName: string, caption?: string) =>
      enviarComTrava(instance, phone, Buffer.concat([file.data, Buffer.from(fileName + (caption ?? ""))]), () => p.sendDocument(phone, file, fileName, caption)),
  }) as WhatsAppProvider;
}
