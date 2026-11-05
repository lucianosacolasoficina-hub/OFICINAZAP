import { getConnection } from "./connections";
import { setMessageMedia } from "./db";
import { saveMedia } from "./media";
import { supabaseAdmin } from "./supabase/admin";
import { whatsapp, type IncomingMessage } from "./whatsapp";

// Foto, áudio ou PDF que entrou na conversa sem o arquivo (enviado pelo celular do número,
// ou vindo do histórico): busca o arquivo na Evolution, guarda no Storage e devolve o caminho.

type Linha = { id: string; conversation_id: string; media_type: string | null; media_url: string | null; wa_message_id: string | null };

const emAndamento = new Map<string, Promise<string | null>>();

export async function buscarMidiaFaltando(m: Linha): Promise<string | null> {
  if (m.media_url) return m.media_url;
  if (!m.media_type || !m.wa_message_id) return null;
  const ja = emAndamento.get(m.id);
  if (ja) return ja;
  const p = (async () => {
    const { data: c } = await supabaseAdmin().from("conversations").select("connection_id").eq("id", m.conversation_id).maybeSingle();
    const conn = c?.connection_id ? await getConnection(c.connection_id) : null;
    if (!conn?.instance) return null;
    const file = await whatsapp(conn.instance).downloadMedia({ mediaRef: m.wa_message_id } as IncomingMessage);
    const path = file && (await saveMedia(m.conversation_id, m.id, file));
    if (path) await setMessageMedia(m.id, path);
    return path || null;
  })().finally(() => emAndamento.delete(m.id));
  emAndamento.set(m.id, p);
  return p;
}

/** Mensagem recém-registrada pelo número de WhatsApp: já guarda o arquivo junto. */
export async function guardarMidiaPorWaId(waMessageId: string) {
  const { data } = await supabaseAdmin()
    .from("messages")
    .select("id, conversation_id, media_type, media_url, wa_message_id")
    .eq("wa_message_id", waMessageId)
    .maybeSingle();
  if (!data) return null;
  const m = data as Linha;
  if (m.media_type && !m.media_url) m.media_url = await buscarMidiaFaltando(m);
  return m;
}
