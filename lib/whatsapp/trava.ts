import { createHash } from "node:crypto";
import { HttpError } from "../api";
import { getSetting, setSetting } from "../db";
import type { MediaFile, WhatsAppProvider } from "./types";

// Trava de envio do WhatsApp (proteção contra banimento).
// Os números estão ligados por QR Code (Evolution, não oficial): mandar muita mensagem em pouco tempo,
// a mesma mensagem repetida ou responder em ciclo com outro robô são os sinais que o WhatsApp pune.
// Toda mensagem que sai pelo OficinaZap passa por aqui:
//  - fila por número, uma de cada vez, com intervalo e uma variação aleatória entre elas;
//  - limite por minuto, por hora e por dia em cada número;
//  - bloqueio da mesma mensagem para o mesmo contato em sequência (clique duplo, reenvio);
//  - passou do limite: o número fica pausado e o master recebe um aviso no topo do OficinaZap.

export type Limites = {
  por_minuto: number;
  por_hora: number;
  por_dia: number;
  /** Segundos mínimos entre duas mensagens do mesmo número (a fila soma uma variação aleatória). */
  intervalo_seg: number;
  /** Minutos que o número fica pausado depois de passar do limite. */
  pausa_min: number;
  /** Respostas do robô na mesma conversa em 10 minutos antes de ele parar e chamar um atendente. */
  robo_10min: number;
};

// Calibrado pelo uso real (nov/2026): o pico foi 11 por minuto, 51 por hora e 346 por dia num número.
export const LIMITES_PADRAO: Limites = { por_minuto: 15, por_hora: 120, por_dia: 600, intervalo_seg: 2, pausa_min: 15, robo_10min: 4 };

const lim = (n: unknown, min: number, max: number, padrao: number) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : padrao;
};
export function normalizaLimites(v: Partial<Limites> | null | undefined): Limites {
  const p = LIMITES_PADRAO;
  return {
    por_minuto: lim(v?.por_minuto, 1, 60, p.por_minuto),
    por_hora: lim(v?.por_hora, 5, 1000, p.por_hora),
    por_dia: lim(v?.por_dia, 10, 5000, p.por_dia),
    intervalo_seg: lim(v?.intervalo_seg, 1, 30, p.intervalo_seg),
    pausa_min: lim(v?.pausa_min, 1, 24 * 60, p.pausa_min),
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
type Pausas = Record<string, { ate: string; motivo: string }>;

// Estado de cada número (fica na memória do servidor; as pausas e os avisos ficam no banco).
type Estado = {
  envios: number[]; // horários (ms) das mensagens enviadas nas últimas 24 horas
  ultimo: number;
  fila: Promise<unknown>;
  naFila: number;
  recentes: Map<string, number>; // assinatura da mensagem -> quando foi enviada
};
const g = globalThis as unknown as { __travaZap?: Map<string, Estado>; __travaPausas?: { t: number; v: Pausas } };
const estados: Map<string, Estado> = (g.__travaZap ??= new Map());
function estado(instance: string): Estado {
  let e = estados.get(instance);
  if (!e) {
    e = { envios: [], ultimo: 0, fila: Promise.resolve(), naFila: 0, recentes: new Map() };
    estados.set(instance, e);
  }
  return e;
}

const MAX_FILA = 15;
const DUPLICADA_MS = 2 * 60_000;

async function lerPausas(): Promise<Pausas> {
  if (g.__travaPausas && Date.now() - g.__travaPausas.t < 15_000) return g.__travaPausas.v;
  const v = await getSetting<Pausas>("trava_pausas", {}).catch(() => ({}) as Pausas);
  g.__travaPausas = { t: Date.now(), v };
  return v;
}
async function gravarPausas(p: Pausas) {
  await setSetting("trava_pausas", p);
  g.__travaPausas = { t: Date.now(), v: p };
}

/** Pausa ativa do número (ou null). */
export async function pausaDe(instance: string) {
  const p = (await lerPausas())[instance];
  return p && new Date(p.ate).getTime() > Date.now() ? p : null;
}

export async function liberarNumero(instance: string) {
  const p = { ...(await lerPausas()) };
  delete p[instance];
  await gravarPausas(p);
  const e = estados.get(instance);
  // Recomeça a contagem do minuto e da hora, senão o número voltaria a pausar na mensagem seguinte.
  if (e) e.envios = [];
}

export async function lerAvisos(): Promise<Aviso[]> {
  return getSetting<Aviso[]>("trava_avisos", []).catch(() => []);
}
export async function marcarAvisosLidos() {
  const a = await lerAvisos();
  await setSetting("trava_avisos", a.map((x) => ({ ...x, lido: true })));
}
/** Guarda um aviso para o master (aparece em vermelho no topo do OficinaZap). */
export async function avisarMaster(instance: string, motivo: string) {
  console.error(`TRAVA WhatsApp [${instance}]: ${motivo}`);
  try {
    const a = await lerAvisos();
    await setSetting("trava_avisos", [{ quando: new Date().toISOString(), instance, motivo }, ...a].slice(0, 30));
  } catch (err) {
    console.error("aviso da trava", err);
  }
}

async function pausar(instance: string, motivo: string, l: Limites) {
  const ate = new Date(Date.now() + l.pausa_min * 60_000);
  await gravarPausas({ ...(await lerPausas()), [instance]: { ate: ate.toISOString(), motivo } }).catch((err) => console.error("pausa da trava", err));
  await avisarMaster(instance, `${motivo}. Envios pausados por ${l.pausa_min} min (até ${hora(ate)}).`);
}

const hora = (d: Date) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

/** Contagem atual de um número (para a tela de Configurações). */
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

function assinatura(destino: string, conteudo: string | Buffer) {
  return createHash("sha1").update(destino.replace(/\D/g, "")).update("|").update(conteudo).digest("hex");
}

/**
 * Passa um envio pela trava: espera a vez na fila do número, confere pausa, limites e repetição, e só então envia.
 * Se não puder enviar, lança um erro com a explicação (o atendente vê a mensagem na tela).
 */
export async function enviarComTrava<T>(instance: string, destino: string, conteudo: string | Buffer, enviar: () => Promise<T>): Promise<T> {
  const e = estado(instance);
  const pausa = await pausaDe(instance);
  if (pausa) {
    throw new HttpError(429, `Este número está pausado por segurança até ${hora(new Date(pausa.ate))} (${pausa.motivo}). O master pode liberar em Configurações.`);
  }
  if (e.naFila >= MAX_FILA) {
    await pausar(instance, `Mais de ${MAX_FILA} mensagens esperando para sair ao mesmo tempo`, await getLimites());
    throw new HttpError(429, "Muitas mensagens saindo ao mesmo tempo por este número: os envios foram pausados por segurança.");
  }
  const chave = assinatura(destino, conteudo);
  e.naFila++;
  const vez = e.fila.then(async () => {
    const l = await getLimites();
    const agora = Date.now();
    e.envios = e.envios.filter((t) => agora - t < 86_400_000);
    for (const [k, t] of e.recentes) if (agora - t > DUPLICADA_MS) e.recentes.delete(k);

    // Mesma mensagem para o mesmo contato há pouco: não manda de novo.
    const ja = e.recentes.get(chave);
    if (ja) {
      throw new HttpError(409, `Essa mesma mensagem já foi enviada para este contato há ${Math.max(1, Math.round((agora - ja) / 1000))} segundos. Para proteger o número, ela não foi enviada de novo.`);
    }
    if (await pausaDe(instance)) throw new HttpError(429, "Este número foi pausado por segurança. O master pode liberar em Configurações.");

    const c = contagem(instance);
    const passou =
      c.minuto >= l.por_minuto ? `Passou de ${l.por_minuto} mensagens em 1 minuto` :
      c.hora >= l.por_hora ? `Passou de ${l.por_hora} mensagens em 1 hora` :
      c.dia >= l.por_dia ? `Passou de ${l.por_dia} mensagens em 24 horas` : null;
    if (passou) {
      await pausar(instance, passou, l);
      throw new HttpError(429, `${passou} por este número. Os envios foram pausados por ${l.pausa_min} minutos para proteger o WhatsApp contra bloqueio. O master pode liberar antes em Configurações.`);
    }

    // Intervalo entre mensagens, com variação (envios em ritmo de máquina chamam atenção).
    const espera = e.ultimo + l.intervalo_seg * 1000 * (1 + Math.random() * 0.8) - Date.now();
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));

    e.recentes.set(chave, Date.now());
    e.ultimo = Date.now();
    e.envios.push(Date.now());
    try {
      return await enviar();
    } catch (err) {
      // Não saiu: pode tentar de novo.
      e.recentes.delete(chave);
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
