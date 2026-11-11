import { getConnection, type Connection } from "./connections";
import { getSetting, setSetting, upsertContact, upsertGroup } from "./db";
import { guardarMidiaPorWaId } from "./midiaFaltando";
import { transcreverMensagem, transcricaoLigada } from "./transcrever";
import { supabaseAdmin } from "./supabase/admin";
import { EvolutionProvider, type HistMsg } from "./whatsapp/evolution";
import { destinoDe } from "./redirecionar";

// Conversas antigas do WhatsApp (histórico) entram no OficinaZap sem acionar a IA e sem notificar.
// Conversa antiga fica "encerrada"; só fica aguardando se a última mensagem for do cliente nos últimos 2 dias.

export async function importarMensagens(conn: Connection, msgs: HistMsg[]) {
  const db = supabaseAdmin();
  const porChat = new Map<string, HistMsg[]>();
  for (const m of msgs) {
    if (!m.ts) continue;
    const l = porChat.get(m.jid) ?? [];
    l.push(m);
    porChat.set(m.jid, l);
  }
  let conversas = 0;
  let mensagens = 0;
  // Número antigo redirecionado para outro: as conversas entram no número novo (grupos ficam onde estão).
  const destino = await destinoDe(conn);
  for (const [, lista] of porChat) {
    lista.sort((a, b) => a.ts - b.ts);
    const ult = lista[lista.length - 1];
    const nome = lista.find((m) => !m.fromMe && m.name)?.name;
    const contato = ult.isGroup ? await upsertGroup(ult.phone) : await upsertContact(ult.phone, nome);
    const alvo = ult.isGroup ? conn : destino;
    // Usa a conversa em andamento desse cliente neste número (a mesma em que o cliente escreve);
    // só se não houver nenhuma, a mais recente (mesmo encerrada); se não houver nenhuma, cria uma.
    // Antes pegava sempre a mais nova: uma cópia encerrada criada depois "roubava" as mensagens
    // enviadas pelo celular e a conversa aparecia como encerrada no meio do atendimento.
    const { data: candidatas } = await db
      .from("conversations")
      .select("id, last_message_at, status")
      .eq("contact_id", contato.id)
      .eq("connection_id", alvo.id)
      .order("created_at", { ascending: false })
      .limit(20);
    const existente = (candidatas ?? []).find((c) => c.status !== "closed") ?? (candidatas ?? [])[0];
    const ultIso = new Date(ult.ts * 1000).toISOString();
    const recente = !ult.fromMe && !ult.isGroup && Date.now() - ult.ts * 1000 < 2 * 864e5;
    let convId = existente?.id as string | undefined;
    if (!convId) {
      const { data: nova, error } = await db
        .from("conversations")
        .insert({
          contact_id: contato.id,
          connection_id: alvo.id,
          department_id: alvo.department_id,
          status: recente ? "waiting" : "closed",
          last_message_at: ultIso,
          last_message_preview: (ult.text || `[${ult.mediaType}]`).slice(0, 200),
          waiting_since: recente ? ultIso : null,
          unread_count: 0,
          last_from_me: ult.fromMe,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      convId = nova.id;
      conversas++;
    } else if (!existente?.last_message_at || existente.last_message_at < ultIso) {
      await db.from("conversations").update({ last_message_at: ultIso, last_message_preview: (ult.text || `[${ult.mediaType}]`).slice(0, 200), last_from_me: ult.fromMe }).eq("id", convId);
    }
    const linhas = lista.map((m) => ({
      conversation_id: convId,
      direction: m.fromMe ? "out" : "in",
      sender: m.fromMe ? "agent" : "contact",
      body: m.text || "",
      media_type: m.mediaType ?? null,
      wa_message_id: m.waMessageId,
      created_at: new Date(m.ts * 1000).toISOString(),
    }));
    for (let i = 0; i < linhas.length; i += 500) {
      const { error, count } = await db
        .from("messages")
        .upsert(linhas.slice(i, i + 500), { onConflict: "wa_message_id", ignoreDuplicates: true, count: "exact" });
      if (error) throw new Error(error.message);
      mensagens += count ?? 0;
    }
  }
  return { conversas, mensagens };
}

/** Mensagem enviada pelo celular do número: entra na conversa como enviada (sem duplicar as que saíram pelo OficinaZap). */
export async function registrarEnviada(conn: Connection, msg: HistMsg) {
  const db = supabaseAdmin();
  const { data: ja } = await db.from("messages").select("id").eq("wa_message_id", msg.waMessageId).maybeSingle();
  if (ja) return;
  await importarMensagens(conn, [msg]);
  // Foto, áudio ou PDF enviado pelo celular: guarda o arquivo para aparecer no balão.
  if (msg.mediaType) {
    const m = await guardarMidiaPorWaId(msg.waMessageId).catch((err) => console.error("Falha ao baixar mídia enviada", msg.waMessageId, err));
    if (m && msg.mediaType === "audio" && transcricaoLigada()) {
      transcreverMensagem(m).catch((err) => console.error("Falha ao transcrever", msg.waMessageId, err));
    }
  }
  // Quem respondeu pelo celular atendeu o cliente: para de contar o tempo de espera.
  if (!msg.isGroup) {
    const { data: m } = await db.from("messages").select("conversation_id").eq("wa_message_id", msg.waMessageId).maybeSingle();
    if (m?.conversation_id) await db.from("conversations").update({ waiting_since: null, unread_count: 0 }).eq("id", m.conversation_id);
  }
}

/**
 * Puxa as conversas antigas deste número (últimos `dias` dias) que ainda não estão no OficinaZap.
 * Lê direto do banco onde a Evolution guarda as mensagens, em lotes de 200 com pausa entre eles:
 * não pede nada ao servidor da Evolution (que já caiu por falta de memória com esse trabalho).
 * Grava o andamento em settings; se o servidor reiniciar no meio, continua sozinho ao voltar.
 */
export async function puxarHistorico(conn: Connection, dias: number) {
  const chave = `historico_${conn.id}`;
  const desde = Math.floor(Date.now() / 1000 - dias * 86400);
  const andamento = { status: "rodando", inicio: new Date().toISOString(), dias, chats: 0, feitos: 0, conversas: 0, mensagens: 0, erro: "" };
  await setSetting(chave, andamento);
  const db = supabaseAdmin();
  try {
    // O número pode ter mensagens guardadas também numa conexão antiga (card excluído e criado de novo).
    let instancias = [conn.instance];
    if (conn.phone) {
      const { data: outras } = await db.rpc("zap_instancias_do_numero", { p_phone: conn.phone });
      instancias = [...new Set([conn.instance, ...((outras ?? []) as string[])])];
    }
    for (const instancia of instancias) {
      let aposTs = 0;
      let aposId = "";
      for (let lote = 0; lote < 5000; lote++) {
        // Pedido de parar (botão na tela) ou outra importação começou depois desta.
        const atual = await getSetting<{ status?: string; inicio?: string }>(chave, {});
        if (atual.status === "parar" || (atual.inicio && atual.inicio !== andamento.inicio)) {
          await setSetting(chave, { ...andamento, status: "parado", fim: new Date().toISOString() });
          return;
        }
        // Falha passageira do banco (resposta cortada, tempo limite): tenta o mesmo lote de novo.
        let data: unknown[] | null = null;
        for (let t = 1; ; t++) {
          const r = await db.rpc("zap_historico_lote", {
            p_instance: instancia, p_desde: desde, p_apos_ts: aposTs, p_apos_id: aposId, p_limite: 300,
          });
          if (!r.error) { data = r.data as unknown[]; break; }
          if (t === 4) throw new Error(r.error.message);
          await new Promise((res) => setTimeout(res, 5000 * t));
        }
        const linhas = (data ?? []) as { ts: number; id: string; rec: Parameters<typeof EvolutionProvider.parseRecord>[0] | null }[];
        if (!linhas.length) break;
        aposTs = linhas[linhas.length - 1].ts;
        aposId = linhas[linhas.length - 1].id;
        const msgs: HistMsg[] = [];
        for (const { rec } of linhas) {
          if (!rec) continue; // já está no OficinaZap
          // O nome que vem com o @lid às vezes é só o número do @lid: não serve como nome.
          if (rec.pushName && rec.pushName === rec.key?.remoteJid?.split("@")[0]) rec.pushName = null;
          const m = EvolutionProvider.parseRecord(rec);
          if (m) msgs.push(m);
        }
        andamento.feitos += linhas.filter((l) => l.rec).length;
        if (msgs.length) {
          const r = await importarMensagens(conn, msgs);
          andamento.conversas += r.conversas;
          andamento.mensagens += r.mensagens;
        }
        await setSetting(chave, andamento);
        if (linhas.length < 300) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    await setSetting(chave, { ...andamento, status: "ok", fim: new Date().toISOString() });
  } catch (err) {
    await setSetting(chave, { ...andamento, status: "erro", erro: (err as Error).message });
  }
}

/** Retoma importações de histórico pedidas ou interrompidas por um reinício do servidor (uma por vez). */
export async function retomarHistoricos() {
  const { data } = await supabaseAdmin().from("settings").select("key, value").like("key", "historico_%");
  for (const row of (data ?? []) as { key: string; value: { status?: string; dias?: number } }[]) {
    if (row.value?.status !== "rodando" && row.value?.status !== "pedido") continue;
    const conn = await getConnection(row.key.slice("historico_".length)).catch(() => null);
    if (!conn) continue;
    await puxarHistorico(conn, row.value.dias ?? 3650);
  }
}

// Ao reconectar um número, o WhatsApp manda o histórico em dezenas de blocos de uma vez.
// Gravar todos ao mesmo tempo esgotava a memória do servidor e o banco: aqui eles entram numa fila, um por vez.
const gf = globalThis as unknown as { __filaHistorico?: Promise<unknown>; __filaHistoricoN?: number };
export function naFilaDoHistorico(tarefa: () => Promise<void>): Promise<void> {
  gf.__filaHistoricoN = (gf.__filaHistoricoN ?? 0) + 1;
  const p = (gf.__filaHistorico ?? Promise.resolve())
    .then(tarefa)
    .catch((err) => console.error("Erro ao importar histórico", err))
    .finally(() => {
      gf.__filaHistoricoN = (gf.__filaHistoricoN ?? 1) - 1;
    });
  gf.__filaHistorico = p;
  return p;
}
export const blocosDeHistoricoNaFila = () => gf.__filaHistoricoN ?? 0;
