import { getConnection, type Connection } from "./connections";
import { addMessage, getSetting, setSetting } from "./db";
import { supabaseAdmin } from "./supabase/admin";
import { whatsapp } from "./whatsapp";

// Número antigo redirecionado para outro (ex.: a Lorena passou a atender pelo fixo).
// O número antigo continua conectado: o que chega nele entra na conversa do número novo,
// a resposta sai pelo número novo, e o cliente recebe uma vez, pelo número antigo, o aviso com o contato novo.
// Configuração em settings, chave `redirecionar_<id do número antigo>`:
//   { "para": "<id do número novo>", "aviso": "texto do aviso (opcional)" }

export type Redirecionamento = { para: string; aviso?: string | null };

const cache = new Map<string, { t: number; v: Redirecionamento | null }>();

export async function redirecionamento(connId: string): Promise<Redirecionamento | null> {
  const c = cache.get(connId);
  if (c && Date.now() - c.t < 60_000) return c.v;
  const v = await getSetting<Redirecionamento | null>(`redirecionar_${connId}`, null).catch(() => null);
  const ok = v && typeof v.para === "string" && v.para ? v : null;
  cache.set(connId, { t: Date.now(), v: ok });
  return ok;
}

/** Número para onde vão as conversas deste número (ele mesmo, se não estiver redirecionado). */
export async function destinoDe<T extends Connection | null>(conn: T): Promise<T> {
  if (!conn) return conn;
  const r = await redirecionamento(conn.id);
  if (!r || r.para === conn.id) return conn;
  return ((await getConnection(r.para).catch(() => null)) as T) ?? conn;
}

/** Números antigos que foram redirecionados para este (para achar arquivos guardados neles). */
export async function origensDe(connId: string): Promise<Connection[]> {
  const { data } = await supabaseAdmin().from("settings").select("key, value").like("key", "redirecionar_%");
  const ids = ((data ?? []) as { key: string; value: Redirecionamento | null }[])
    .filter((r) => r.value?.para === connId)
    .map((r) => r.key.slice("redirecionar_".length));
  const conns = await Promise.all(ids.map((id) => getConnection(id).catch(() => null)));
  return conns.filter((c): c is Connection => !!c?.instance);
}

const avisando = new Set<string>();

/**
 * Manda o aviso com o contato novo, pelo número antigo, uma vez por cliente.
 * Espera alguns segundos antes (para não parecer robô e não arriscar o número).
 */
export async function avisarNumeroNovo(antigo: Connection, phone: string, conversationId: string) {
  const r = await redirecionamento(antigo.id);
  const aviso = r?.aviso?.trim();
  if (!aviso) return;
  const fone = phone.replace(/\D/g, "");
  const chave = `redirecionar_avisados_${antigo.id}`;
  const marca = `${antigo.id}:${fone}`;
  if (avisando.has(marca)) return;
  avisando.add(marca);
  try {
    const avisados = await getSetting<string[]>(chave, []);
    if (avisados.includes(fone)) return;
    await setSetting(chave, [...avisados, fone]);
    await new Promise((res) => setTimeout(res, 5000 + Math.random() * 10_000));
    try {
      await whatsapp(antigo.instance).sendText(fone, aviso);
      await addMessage(conversationId, {
        direction: "out",
        sender: "system",
        body: `Aviso automático enviado pelo número antigo (${antigo.name}): ${aviso}`,
      });
    } catch (err) {
      // Não enviou: tira da lista para tentar de novo na próxima mensagem do cliente.
      const atual = await getSetting<string[]>(chave, []);
      await setSetting(chave, atual.filter((p) => p !== fone));
      console.error("Falha ao enviar aviso do número novo", fone, err);
    }
  } finally {
    avisando.delete(marca);
  }
}
