import { connectionByInstance } from "./connections";
import { importarMensagens, registrarEnviada } from "./historico";
import { handleIncoming } from "./inbound";
import { supabaseAdmin } from "./supabase/admin";
import { EvolutionProvider } from "./whatsapp/evolution";

// Rede de segurança das mensagens do WhatsApp.
// A Evolution guarda tudo o que chega nos números; se o aviso (webhook) se perdeu — o OficinaZap
// estava reiniciando, a Evolution caiu, ou o contato veio com número oculto (@lid) —, a mensagem
// fica de fora. Aqui conferimos de tempos em tempos e trazemos as que faltam.

type Key = { remoteJid?: string; remoteJidAlt?: string; senderPn?: string; fromMe?: boolean; id?: string };
type Rec = { key?: Key; pushName?: string | null; message?: unknown; messageTimestamp?: number };

/** Contato com id anônimo (@lid) sem o número junto: usa o número que já aprendemos para esse @lid. */
export async function completarLid(key: Key | undefined, rec?: { pushName?: string | null }) {
  const jid = key?.remoteJid ?? "";
  if (!key || !jid.endsWith("@lid")) return;
  const lid = jid.split("@")[0];
  // O nome que vem nesses casos às vezes é só o número do @lid: não serve como nome.
  if (rec && rec.pushName === lid) rec.pushName = null;
  if (key.remoteJidAlt || key.senderPn) return;
  try {
    const { data } = await supabaseAdmin().rpc("zap_numero_do_lid", { p_lid: jid });
    if (typeof data === "string" && data) key.remoteJidAlt = `${data}@s.whatsapp.net`;
  } catch (err) {
    console.error("número do @lid", err);
  }
}

let rodando = false;

/** Recupera as mensagens de `deSeg` até `ateSeg` segundos atrás que não entraram no OficinaZap. */
export async function recuperarPerdidas(deSeg = 3 * 3600, ateSeg = 90) {
  if (rodando) return { recuperadas: 0 };
  rodando = true;
  let recuperadas = 0;
  try {
    const { data, error } = await supabaseAdmin().rpc("zap_mensagens_perdidas", { p_de: deSeg, p_ate: ateSeg });
    if (error) throw new Error(error.message);
    const linhas = (data ?? []) as { instance: string; rec: Rec }[];
    for (const { instance, rec } of linhas) {
      try {
        const conn = await connectionByInstance(instance);
        if (!conn || !rec.key) continue;
        if (rec.pushName === rec.key.remoteJid?.split("@")[0]) rec.pushName = null;
        const msg = EvolutionProvider.parseRecord(rec as Parameters<typeof EvolutionProvider.parseRecord>[0]);
        if (!msg) continue;
        if (msg.fromMe) {
          await registrarEnviada(conn, msg);
        } else if (Date.now() / 1000 - msg.ts < 10 * 60) {
          // Ainda é recente: entra como se tivesse acabado de chegar (avisa, baixa mídia).
          // A IA só responde se a mensagem tem menos de 3 minutos; mais velha, fica para um atendente.
          // A conferência nunca reenvia nada ao cliente: só traz o que faltou para dentro do OficinaZap.
          const [inc] = new EvolutionProvider(instance).parseWebhook({ event: "messages.upsert", instance, data: rec });
          if (inc) await handleIncoming({ ...inc, instance }, { robo: Date.now() / 1000 - msg.ts < 3 * 60 });
        } else {
          // Mais antiga: entra no horário certo e a conversa fica aguardando atendimento.
          await importarMensagens(conn, [msg]);
          await marcarAguardando(msg.waMessageId, msg.ts, msg.isGroup);
        }
        recuperadas++;
      } catch (err) {
        console.error("Erro ao recuperar mensagem", rec.key?.id, err);
      }
    }
    if (recuperadas) console.log(`Mensagens recuperadas da Evolution: ${recuperadas}`);
  } catch (err) {
    console.error("recuperar mensagens", err);
  } finally {
    rodando = false;
  }
  return { recuperadas };
}

async function marcarAguardando(waMessageId: string, ts: number, isGroup: boolean) {
  const db = supabaseAdmin();
  const { data: m } = await db.from("messages").select("conversation_id").eq("wa_message_id", waMessageId).maybeSingle();
  if (!m?.conversation_id) return;
  const { data: c } = await db
    .from("conversations")
    .select("status, unread_count, waiting_since, last_message_at")
    .eq("id", m.conversation_id)
    .single();
  if (!c) return;
  const quando = new Date(ts * 1000).toISOString();
  // Só se ninguém respondeu depois dela.
  if (c.last_message_at && c.last_message_at > quando) return;
  await db
    .from("conversations")
    .update({
      unread_count: (c.unread_count ?? 0) + 1,
      waiting_since: c.waiting_since ?? quando,
      last_from_me: false,
      ...(c.status === "closed" && !isGroup ? { status: "waiting" } : {}),
    })
    .eq("id", m.conversation_id);
}
