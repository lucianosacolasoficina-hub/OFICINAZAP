import type { Connection } from "./connections";
import { getSetting, setSetting, upsertContact, upsertGroup } from "./db";
import { supabaseAdmin } from "./supabase/admin";
import { EvolutionProvider, type HistMsg } from "./whatsapp/evolution";

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
  for (const [, lista] of porChat) {
    lista.sort((a, b) => a.ts - b.ts);
    const ult = lista[lista.length - 1];
    const nome = lista.find((m) => !m.fromMe && m.name)?.name;
    const contato = ult.isGroup ? await upsertGroup(ult.phone) : await upsertContact(ult.phone, nome);
    // Usa a conversa mais recente desse cliente neste número; se não houver, cria uma.
    const { data: existente } = await db
      .from("conversations")
      .select("id, last_message_at, status")
      .eq("contact_id", contato.id)
      .eq("connection_id", conn.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const ultIso = new Date(ult.ts * 1000).toISOString();
    const recente = !ult.fromMe && !ult.isGroup && Date.now() - ult.ts * 1000 < 2 * 864e5;
    let convId = existente?.id as string | undefined;
    if (!convId) {
      const { data: nova, error } = await db
        .from("conversations")
        .insert({
          contact_id: contato.id,
          connection_id: conn.id,
          department_id: conn.department_id,
          status: recente ? "waiting" : "closed",
          last_message_at: ultIso,
          last_message_preview: (ult.text || `[${ult.mediaType}]`).slice(0, 200),
          waiting_since: recente ? ultIso : null,
          unread_count: 0,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      convId = nova.id;
      conversas++;
    } else if (!existente?.last_message_at || existente.last_message_at < ultIso) {
      await db.from("conversations").update({ last_message_at: ultIso, last_message_preview: (ult.text || `[${ult.mediaType}]`).slice(0, 200) }).eq("id", convId);
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
  // Quem respondeu pelo celular atendeu o cliente: para de contar o tempo de espera.
  if (!msg.isGroup) {
    const { data: m } = await db.from("messages").select("conversation_id").eq("wa_message_id", msg.waMessageId).maybeSingle();
    if (m?.conversation_id) await db.from("conversations").update({ waiting_since: null, unread_count: 0 }).eq("id", m.conversation_id);
  }
}

/** Puxa da Evolution todas as conversas guardadas deste número (últimos `dias` dias), sem limite de mensagens por conversa. Grava o andamento em settings. */
export async function puxarHistorico(conn: Connection, dias: number) {
  const chave = `historico_${conn.id}`;
  const ev = new EvolutionProvider(conn.instance);
  const desde = Date.now() / 1000 - dias * 86400;
  const andamento = { status: "rodando", inicio: new Date().toISOString(), dias, chats: 0, feitos: 0, conversas: 0, mensagens: 0, erro: "" };
  await setSetting(chave, andamento);
  try {
    const chats = (await ev.findChats()).filter(
      (c) => c.remoteJid && /@(s\.whatsapp\.net|g\.us|lid)$/.test(c.remoteJid) && (!c.updatedAt || new Date(c.updatedAt).getTime() / 1000 >= desde),
    );
    andamento.chats = chats.length;
    await setSetting(chave, andamento);
    let falhas = 0;
    for (const c of chats) {
      // Pedido de parar (botão na tela) ou outra importação começou depois desta.
      const atual = await getSetting<{ status?: string; inicio?: string }>(chave, {});
      if (atual.status === "parar" || (atual.inicio && atual.inicio !== andamento.inicio)) {
        await setSetting(chave, { ...andamento, status: "parado", fim: new Date().toISOString() });
        return;
      }
      await new Promise((r) => setTimeout(r, 300));
      try {
        const msgs: HistMsg[] = [];
        for (let page = 1; page <= 100; page++) {
          let recs: Awaited<ReturnType<typeof ev.findMessages>> = [];
          for (let t = 0; t < 3; t++) {
            try {
              recs = await ev.findMessages(c.remoteJid, page, 100);
              break;
            } catch (e) {
              if (t === 2) throw e;
              await new Promise((r) => setTimeout(r, 1500 * (t + 1)));
            }
          }
          const parsed = recs.map((r) => EvolutionProvider.parseRecord(r)).filter((m): m is HistMsg => !!m);
          msgs.push(...parsed.filter((m) => m.ts >= desde));
          if (recs.length < 100 || parsed.some((m) => m.ts < desde)) break;
          // Página inteira já guardada: o resto (mais antigo) também já está aqui — não sobrecarrega a Evolution.
          const ids = parsed.map((m) => m.waMessageId);
          if (ids.length) {
            const { count } = await supabaseAdmin().from("messages").select("id", { count: "exact", head: true }).in("wa_message_id", ids);
            if ((count ?? 0) >= ids.length) break;
          }
          await new Promise((r) => setTimeout(r, 400));
        }
        if (msgs.length) {
          const r = await importarMensagens(conn, msgs);
          andamento.conversas += r.conversas;
          andamento.mensagens += r.mensagens;
        }
      } catch (e) {
        // Uma conversa com problema não interrompe as outras.
        falhas++;
        andamento.erro = `${falhas} conversa(s) não puderam ser lidas (última: ${(e as Error).message})`;
      }
      andamento.feitos++;
      if (andamento.feitos % 10 === 0) await setSetting(chave, andamento);
    }
    await setSetting(chave, { ...andamento, status: "ok", fim: new Date().toISOString() });
  } catch (err) {
    await setSetting(chave, { ...andamento, status: "erro", erro: (err as Error).message });
  }
}
