import { addMessage, getSetting, updateConversation, type Contact, type Conversation } from "./db";
import { supabaseAdmin } from "./supabase/admin";
import { whatsapp } from "./whatsapp";
import { getLimites } from "./whatsapp/trava";

// Mensagem de ausência e mensagem de saudação, como no WhatsApp Business.
// Ausência: cliente escreve fora do horário de atendimento e recebe um aviso fixo (no máximo uma vez a cada 12 horas).
// Saudação: cliente novo, ou que não falava com a loja há alguns dias, recebe uma mensagem de boas-vindas.
// Quando a IA está atendendo a conversa, ela já responde; por padrão estas mensagens só saem quando a IA não vai responder.

export type Ausencia = {
  ausencia_ligada: boolean;
  mensagem_ausencia: string;
  /** Dias de atendimento (0 = domingo ... 6 = sábado). */
  dias: number[];
  /** Horário de atendimento, "HH:MM", hora de Brasília. */
  inicio: string;
  fim: string;
  saudacao_ligada: boolean;
  saudacao: string;
  /** Cliente que não conversa há este número de dias recebe a saudação de novo. */
  saudacao_dias: number;
  /** Mandar também quando a IA estiver atendendo a conversa. */
  com_ia: boolean;
};

export const AUSENCIA_PADRAO: Ausencia = {
  ausencia_ligada: false,
  mensagem_ausencia:
    "Olá! Obrigado pela mensagem 😊 Nosso horário de atendimento é de segunda a sexta, das 8h às 18h, e sábado das 8h às 12h. Assim que voltarmos, respondemos você.",
  dias: [1, 2, 3, 4, 5, 6],
  inicio: "08:00",
  fim: "18:00",
  saudacao_ligada: false,
  saudacao: "Olá! Aqui é da Sacolas Oficina 👋 Como podemos te ajudar?",
  saudacao_dias: 14,
  com_ia: false,
};

const hora = (v: unknown, padrao: string) => (typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : padrao);
const texto = (v: unknown, padrao: string) => (typeof v === "string" ? v.slice(0, 1000) : padrao);

export function normalizaAusencia(v: Partial<Ausencia> | null | undefined): Ausencia {
  const p = AUSENCIA_PADRAO;
  const dias = Array.isArray(v?.dias) ? [...new Set(v!.dias.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : p.dias;
  const sd = Math.round(Number(v?.saudacao_dias));
  return {
    ausencia_ligada: typeof v?.ausencia_ligada === "boolean" ? v.ausencia_ligada : p.ausencia_ligada,
    mensagem_ausencia: texto(v?.mensagem_ausencia, p.mensagem_ausencia),
    dias,
    inicio: hora(v?.inicio, p.inicio),
    fim: hora(v?.fim, p.fim),
    saudacao_ligada: typeof v?.saudacao_ligada === "boolean" ? v.saudacao_ligada : p.saudacao_ligada,
    saudacao: texto(v?.saudacao, p.saudacao),
    saudacao_dias: Number.isFinite(sd) ? Math.min(365, Math.max(1, sd)) : p.saudacao_dias,
    com_ia: typeof v?.com_ia === "boolean" ? v.com_ia : p.com_ia,
  };
}

let cache: { t: number; v: Ausencia } | null = null;
export async function getAusencia(): Promise<Ausencia> {
  if (cache && Date.now() - cache.t < 30_000) return cache.v;
  const v = normalizaAusencia(await getSetting<Partial<Ausencia> | null>("ausencia", null).catch(() => null));
  cache = { t: Date.now(), v };
  return v;
}
export function limpaCacheAusencia() {
  cache = null;
}

/** Está dentro do horário de atendimento agora (hora de Brasília)? */
export function dentroDoHorario(cfg: Ausencia, agora = new Date()) {
  const partes = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(agora);
  const p = (t: string) => partes.find((x) => x.type === t)?.value ?? "";
  const dia = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p("weekday"));
  const min = Number(p("hour")) * 60 + Number(p("minute"));
  const [hi, mi] = cfg.inicio.split(":").map(Number);
  const [hf, mf] = cfg.fim.split(":").map(Number);
  return cfg.dias.includes(dia) && min >= hi * 60 + mi && min < hf * 60 + mf;
}

/** Já mandamos este texto para o contato nas últimas `horas`? */
async function jaMandou(contactId: string, body: string, horas: number) {
  const db = supabaseAdmin();
  const { data: convs } = await db.from("conversations").select("id").eq("contact_id", contactId);
  const ids = (convs ?? []).map((c) => c.id as string);
  if (!ids.length) return false;
  const { count } = await db
    .from("messages")
    .select("id", { count: "exact", head: true })
    .in("conversation_id", ids)
    .eq("direction", "out")
    .eq("body", body)
    .gte("created_at", new Date(Date.now() - horas * 3600_000).toISOString());
  return (count ?? 0) > 0;
}

/** O contato teve alguma outra mensagem (dele ou nossa) nos últimos `dias`, fora a que acabou de chegar? */
async function conversouRecente(contactId: string, exceto: string, dias: number) {
  const db = supabaseAdmin();
  const { data: convs } = await db.from("conversations").select("id").eq("contact_id", contactId);
  const ids = (convs ?? []).map((c) => c.id as string);
  if (!ids.length) return false;
  const { data } = await db
    .from("messages")
    .select("id")
    .in("conversation_id", ids)
    .neq("id", exceto)
    .neq("sender", "system")
    .gte("created_at", new Date(Date.now() - dias * 86_400_000).toISOString())
    .limit(1);
  return !!data?.length;
}

const recentes = new Map<string, number>();
const porNumero = new Map<string, number[]>();

/**
 * Chamado quando chega mensagem de um cliente no WhatsApp. Manda a ausência (fora do horário) ou a saudação
 * (cliente novo), se estiverem ligadas. Devolve true quando mandou alguma.
 */
export async function respostaAutomatica(opts: {
  contact: Contact;
  conversation: Conversation;
  instance?: string | null;
  mensagemId: string;
  iaVaiResponder: boolean;
}): Promise<boolean> {
  const cfg = await getAusencia();
  if (!cfg.ausencia_ligada && !cfg.saudacao_ligada) return false;
  if (opts.iaVaiResponder && !cfg.com_ia) return false;
  // Cliente mandou várias mensagens seguidas: só a primeira decide (não sai a mesma automática duas vezes).
  const ultima = recentes.get(opts.contact.id);
  if (ultima && Date.now() - ultima < 2 * 60_000) return false;
  recentes.set(opts.contact.id, Date.now());
  if (recentes.size > 2000) for (const [k, t] of recentes) if (Date.now() - t > 2 * 60_000) recentes.delete(k);
  let body = "";
  if (cfg.ausencia_ligada && cfg.mensagem_ausencia.trim() && !dentroDoHorario(cfg)) {
    if (await jaMandou(opts.contact.id, cfg.mensagem_ausencia.trim(), 12)) return false;
    body = cfg.mensagem_ausencia.trim();
  } else if (cfg.saudacao_ligada && cfg.saudacao.trim()) {
    if (await conversouRecente(opts.contact.id, opts.mensagemId, cfg.saudacao_dias)) return false;
    body = cfg.saudacao.trim();
  }
  if (!body) return false;
  // Trava contra banimento: a mesma mensagem automática para muitos clientes em pouco tempo parece disparo em massa.
  // Fica sempre abaixo do limite da trava de envio (mesma mensagem para N contatos em X minutos); passou disso, não manda.
  const lim = await getLimites();
  const chave = `${opts.instance ?? ""}|${body}`;
  const janela = lim.massa_min * 60_000;
  const envios = (porNumero.get(chave) ?? []).filter((t) => Date.now() - t < janela);
  if (envios.length >= Math.max(1, lim.massa_contatos - 2)) {
    console.warn("mensagem automática segurada pela trava (muitos clientes em pouco tempo)", opts.instance);
    return false;
  }
  porNumero.set(chave, [...envios, Date.now()]);
  const sent = await whatsapp(opts.instance).sendText(opts.contact.phone, body);
  // A mensagem automática não conta como resposta: o cliente continua esperando um atendente.
  const { data: antes } = await supabaseAdmin().from("conversations").select("waiting_since").eq("id", opts.conversation.id).maybeSingle();
  await addMessage(opts.conversation.id, { direction: "out", sender: "bot", body, wa_message_id: sent.waMessageId ?? null });
  await updateConversation(opts.conversation.id, { waiting_since: (antes?.waiting_since as string | null) ?? null, last_from_me: false });
  return true;
}
